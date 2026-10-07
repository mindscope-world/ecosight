import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { slugify, type User } from '../auth.js';
import type { Sql } from '../db.js';
import { LINK_KINDS } from '../graph.js';
import { ErrorBody, Me, ReviewItem, ReviewList, type OrgType } from '../schemas.js';

// The review queue: what the importers could not publish by their own rules,
// waiting for a person. A reviewer approves, rejects or reopens; each decision
// is recorded with who made it, and written to the audit log.

const PROGRAMME = 'accelerated_at';
const DEFAULT_PROGRAMME = 'Programme';

interface Row {
  id: string;
  record_type: string;
  record_id: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'archived';
  reason: string | null;
  created_at: Date;
  reviewed_at: Date | null;
  reviewed_by: string | null;
  reviewer: string | null;
  payload: Record<string, unknown>;
  organisation: ReviewItem['organisation'];
}

interface OrgRef {
  id: string;
  name: string;
  types: OrgType[];
}

const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);
/** The name without a researcher's bracketed note, as the importers read it. */
const plainName = (name: string) => name.replace(/\s*\(.*$/, '').trim() || name.trim();
const isUrl = (value: string | null): value is string => value !== null && /^https?:\/\//i.test(value);

export const reviewRoutes: FastifyPluginAsyncTypebox<{ sql: Sql }> = async (app, { sql }) => {
  /** Stops the request unless a reviewer is signed in. Returns them when one is. */
  function reviewer(request: FastifyRequest, reply: FastifyReply): User | null {
    if (!request.user) {
      void reply.code(401).send({ error: 'Sign in to use the review queue' });
      return null;
    }
    if (request.user.role === 'viewer') {
      void reply.code(403).send({ error: 'This account is not a reviewer' });
      return null;
    }
    return request.user;
  }

  /** Published organisations by every name they go by, for finding the ones a proposal names. */
  async function knownOrganisations(): Promise<Map<string, OrgRef>> {
    const rows = await sql<(OrgRef & { slug: string; aliases: string[] })[]>`
      select id, name, types::text[] as types, slug, aliases from organisation where status = 'published'
    `;
    const known = new Map<string, OrgRef>();
    for (const { slug, aliases, ...org } of rows)
      for (const key of [slug, ...aliases.map(slugify)]) if (!known.has(key)) known.set(key, org);
    return known;
  }

  function describe(row: Row, known: Map<string, OrgRef>): ReviewItem {
    const relationship = row.record_type === 'organisation_link' || row.record_type === 'program';
    const from = text(row.payload.from);
    const to = text(row.payload.to);
    return {
      id: row.id,
      kind: row.record_type === 'organisation' ? 'organisation' : relationship ? 'relationship' : 'other',
      status: row.status,
      reason: row.reason,
      note: text(row.payload.review_note),
      source: text(row.payload.import),
      created_at: row.created_at.toISOString(),
      reviewed_at: row.reviewed_at?.toISOString() ?? null,
      reviewed_by: row.reviewer,
      organisation: row.organisation,
      proposal: relationship
        ? {
            kind: text(row.payload.kind),
            from,
            to,
            label: text(row.payload.label),
            source_url: text(row.payload.source_url),
            quote: text(row.payload.quote),
            // Who each name is on record, when it is: found by name, never by guesswork.
            from_match: from ? (known.get(slugify(plainName(from))) ?? null) : null,
            to_match: to ? (known.get(slugify(plainName(to))) ?? null) : null,
          }
        : null,
    };
  }

  const select = sql`
    select
      r.id, r.record_type, r.record_id, r.status::text as status, r.reason, r.created_at, r.reviewed_at,
      r.reviewed_by, u.email as reviewer, r.payload,
      case when r.record_type = 'organisation' then (
        select jsonb_build_object(
          'id', g.id, 'name', g.name, 'types', g.types, 'sectors', g.sectors, 'stage', g.stage,
          'description', g.description, 'website_domain', g.website_domain, 'status', g.status,
          'city', hq.city, 'country', hq.country,
          'sources', (select count(*) from field_source s where s.record_type = 'organisation' and s.record_id = g.id)
        )
        from organisation g
        left join lateral (
          select o.city, o.country from office o
          where o.organisation_id = g.id and o.valid_to is null order by o.is_hq desc limit 1
        ) hq on true
        where g.id = r.record_id
      ) end as organisation
    from review_item r left join app_user u on u.id = r.reviewed_by
  `;

  // Items loaded together share a timestamp; within one import they keep the order of its rows.
  const rowNumber = sql`case when r.payload->>'record' ~ '^[0-9]+$' then (r.payload->>'record')::int end`;

  async function load(id: string): Promise<Row | undefined> {
    const [row] = await sql<Row[]>`${select} where r.id = ${id}`;
    return row;
  }

  app.get(
    '/me',
    { schema: { summary: 'Who the request is from, and what they may do', response: { 200: Me } } },
    // The address is given even when it is not on the list, so the reader can be told which one to ask about.
    async (request) => ({ email: request.user?.email ?? request.signedInAs, role: request.user?.role ?? null }),
  );

  app.get(
    '/review/items',
    {
      schema: {
        summary: 'The review queue: what is waiting, or what reviewers have settled',
        querystring: Type.Object({
          status: Type.Optional(
            Type.Union([Type.Literal('pending'), Type.Literal('archived'), Type.Literal('settled')], { default: 'pending' }),
          ),
        }),
        response: { 200: ReviewList, 401: ErrorBody, 403: ErrorBody },
      },
    },
    async (request, reply) => {
      if (!reviewer(request, reply)) return reply;
      const tab = request.query.status ?? 'pending';
      // Settled means decided for good, one way or the other; what was set aside has a list of its own.
      const where = {
        pending: sql`r.status = 'pending'`,
        archived: sql`r.status = 'archived'`,
        settled: sql`r.reviewed_by is not null and r.status in ('approved', 'rejected')`,
      }[tab];
      const rows = await sql<Row[]>`
        ${select}
        where ${where}
        order by ${tab === 'pending' ? sql`r.record_type, r.created_at, ${rowNumber} nulls last, r.id` : sql`r.reviewed_at desc nulls last, r.id`}
        limit 300
      `;
      const known = await knownOrganisations();
      const [counts] = await sql<{ pending: number; archived: number; settled: number }[]>`
        select count(*) filter (where status = 'pending')::int as pending,
               count(*) filter (where status = 'archived')::int as archived,
               count(*) filter (where reviewed_by is not null and status in ('approved', 'rejected'))::int as settled
        from review_item
      `;
      return { ...counts!, items: rows.map((row) => describe(row, known)) };
    },
  );

  const params = Type.Object({ id: Type.String({ format: 'uuid' }) });
  const answers = { 200: ReviewItem, 401: ErrorBody, 403: ErrorBody, 404: ErrorBody, 409: ErrorBody, 422: ErrorBody };

  app.post(
    '/review/items/:id/approve',
    {
      schema: {
        summary: 'Publish what an item proposes',
        params,
        body: Type.Object({
            from_id: Type.Optional(Type.String({ format: 'uuid', description: 'The organisation on record that the first name means' })),
            to_id: Type.Optional(Type.String({ format: 'uuid', description: 'The organisation on record that the second name means' })),
            source_url: Type.Optional(Type.String({ maxLength: 500, description: 'A link to the evidence, when the item came without one' })),
        }),
        response: answers,
      },
    },
    async (request, reply) => {
      const user = reviewer(request, reply);
      if (!user) return reply;
      const item = await load(request.params.id);
      if (!item) return reply.code(404).send({ error: 'No such item in the queue' });
      if (item.status !== 'pending') return reply.code(409).send({ error: 'This item has already been settled' });

      if (item.record_type === 'organisation') {
        if (!item.record_id || !item.organisation) return reply.code(422).send({ error: 'The organisation is no longer on record' });
        const org = item.record_id;
        await sql.begin(async (tx) => {
          await tx`update organisation set status = 'published' where id = ${org}`;
          // Approval is the check its sources were waiting for.
          await tx`
            update field_source set verified_at = now()
            where record_type = 'organisation' and record_id = ${org} and verified_at is null`;
          await tx`
            update review_item set status = 'approved', reviewed_by = ${user.id}, reviewed_at = now() where id = ${item.id}`;
          await tx`
            insert into audit_log (actor, record_type, record_id, field, previous_value, new_value)
            values (${user.id}, 'organisation', ${org}, 'status', '"draft"', '"published"')`;
        });
        return describe((await load(item.id))!, await knownOrganisations());
      }

      if (item.record_type !== 'organisation_link')
        return reply.code(422).send({ error: 'Items of this kind cannot be approved here yet' });

      // A proposed relationship. Each side is the organisation the reviewer chose, or the one its name finds.
      const known = await knownOrganisations();
      const proposal = describe(item, known).proposal!;
      const body = request.body;
      const [chosen] = await sql<{ from_ok: boolean; to_ok: boolean }[]>`
        select
          exists (select 1 from organisation where id = ${body.from_id ?? null} and status = 'published') as from_ok,
          exists (select 1 from organisation where id = ${body.to_id ?? null} and status = 'published') as to_ok
      `;
      if ((body.from_id && !chosen!.from_ok) || (body.to_id && !chosen!.to_ok))
        return reply.code(422).send({ error: 'The organisation chosen is not a published record' });
      const from = body.from_id ?? proposal.from_match?.id;
      const to = body.to_id ?? proposal.to_match?.id;
      const url = text(body.source_url) ?? proposal.source_url;
      const kind = proposal.kind;
      if (!from || !to)
        return reply.code(422).send({ error: `Choose the record for ${!from ? proposal.from : proposal.to}, or reject the item` });
      if (from === to) return reply.code(422).send({ error: 'Both sides are the same organisation' });
      if (!kind || !([...LINK_KINDS, PROGRAMME] as string[]).includes(kind))
        return reply.code(422).send({ error: 'The relation is not one the map knows' });
      if (!isUrl(url)) return reply.code(422).send({ error: 'A relationship needs a link to its source before it is published' });

      const done = await sql.begin(async (tx) => {
        let recordType = 'organisation_link';
        let recordId: string;
        let field = 'link';
        const extra: Record<string, unknown> = { from_id: from, to_id: to, source_url: url };
        if (kind === PROGRAMME) {
          const name = proposal.label ?? DEFAULT_PROGRAMME;
          let [programme] = await tx<{ id: string }[]>`select id from program where organisation_id = ${to} and name = ${name}`;
          extra.created = !programme;
          if (!programme) [programme] = await tx<{ id: string }[]>`insert into program (organisation_id, name) values (${to}, ${name}) returning id`;
          await tx`insert into program_participant (program_id, organisation_id) values (${programme!.id}, ${from}) on conflict do nothing`;
          [recordType, recordId, field] = ['program', programme!.id, `participant:${from}`];
          extra.participant = from;
        } else {
          const [link] = await tx<{ id: string }[]>`
            insert into organisation_link (source_id, target_id, kind, label, status)
            values (${from}, ${to}, ${kind}, ${proposal.label}, 'published')
            on conflict (source_id, target_id, kind) do nothing returning id`;
          if (!link) return false;
          recordId = link.id;
        }
        await tx`
          insert into field_source (record_type, record_id, field, source_url, method, quote, verified_at)
          values (${recordType}, ${recordId}, ${field}, ${url}, 'manual', ${proposal.quote}, now())`;
        await tx`
          update review_item set
            record_type = ${recordType}, record_id = ${recordId}, status = 'approved',
            reviewed_by = ${user.id}, reviewed_at = now(), payload = payload || ${tx.json(extra as never)}
          where id = ${item.id}`;
        await tx`
          insert into audit_log (actor, record_type, record_id, field, new_value)
          values (${user.id}, ${recordType}, ${recordId}, 'status', '"published"')`;
        return true;
      });
      if (!done) return reply.code(409).send({ error: 'This relationship is already on record' });
      return describe((await load(item.id))!, await knownOrganisations());
    },
  );

  // Rejecting and archiving are the same act with a different verdict: the item
  // leaves the waiting list, unpublished. Rejected says it is wrong; archived
  // says it may be right but there is not enough to publish yet.
  for (const [action, verdict, summary] of [
    ['reject', 'rejected', 'Decide that an item is not to be published'],
    ['archive', 'archived', 'Set an item aside: not wrong, but too incomplete or unverified to publish yet'],
  ] as const)
    app.post(
      `/review/items/:id/${action}`,
      {
        schema: {
          summary,
          params,
          body: Type.Object({ note: Type.Optional(Type.String({ maxLength: 500 })) }),
          response: answers,
        },
      },
      async (request, reply) => {
        const user = reviewer(request, reply);
        if (!user) return reply;
        const item = await load(request.params.id);
        if (!item) return reply.code(404).send({ error: 'No such item in the queue' });
        if (item.status !== 'pending') return reply.code(409).send({ error: 'This item has already been settled' });
        const note = text(request.body.note);
        await sql.begin(async (tx) => {
          await tx`
            update review_item set
              status = ${verdict}, reviewed_by = ${user.id}, reviewed_at = now(),
              payload = payload || ${tx.json({ review_note: note })}
            where id = ${item.id}`;
          await tx`
            insert into audit_log (actor, record_type, record_id, field, previous_value, new_value)
            values (${user.id}, 'review_item', ${item.id}, 'status', '"pending"', ${tx.json(verdict)})`;
        });
        return describe((await load(item.id))!, await knownOrganisations());
      },
    );

  app.post(
    '/review/items/:id/reopen',
    {
      schema: { summary: "Undo a reviewer's decision and put the item back in the queue", params, body: Type.Object({}), response: answers },
    },
    async (request, reply) => {
      const user = reviewer(request, reply);
      if (!user) return reply;
      const item = await load(request.params.id);
      if (!item) return reply.code(404).send({ error: 'No such item in the queue' });
      if (item.status === 'pending' || !item.reviewed_by)
        return reply.code(409).send({ error: 'Only a decision made by a reviewer can be undone' });
      const organisation = item.record_type === 'organisation' ? item.record_id : null;
      if (item.status === 'approved' && !organisation)
        return reply.code(422).send({ error: 'An approved relationship cannot be reopened here yet' });
      await sql.begin(async (tx) => {
        if (item.status === 'approved' && organisation) {
          await tx`update organisation set status = 'draft' where id = ${organisation}`;
          await tx`
            insert into audit_log (actor, record_type, record_id, field, previous_value, new_value)
            values (${user.id}, 'organisation', ${organisation}, 'status', '"published"', '"draft"')`;
        }
        await tx`
          update review_item set status = 'pending', reviewed_by = null, reviewed_at = null, payload = payload - 'review_note'
          where id = ${item.id}`;
        await tx`
          insert into audit_log (actor, record_type, record_id, field, previous_value, new_value)
          values (${user.id}, 'review_item', ${item.id}, 'status', ${tx.json(item.status)}, '"pending"')`;
      });
      return describe((await load(item.id))!, await knownOrganisations());
    },
  );
};
