import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import type { Sql } from '../db.js';
import { ErrorBody, Notifications, SavedView } from '../schemas.js';

/** Most views one user may keep. */
const SAVED_LIMIT = 50;
/** How far back "new" reaches when the caller does not say when they last looked. */
const DEFAULT_DAYS = 14;

// What belongs to the person using the product rather than to the records: the
// views they have saved, and what is new since they last looked.
export const accountRoutes: FastifyPluginAsyncTypebox<{ sql: Sql }> = async (app, { sql }) => {
  const signIn = { error: 'Sign in to keep saved views with your account' };

  app.get(
    '/me/saved',
    { schema: { summary: 'The views the signed-in user has saved', response: { 200: Type.Object({ views: Type.Array(SavedView) }), 401: ErrorBody } } },
    async (request, reply) => {
      if (!request.user) return reply.code(401).send(signIn);
      const views = await sql<SavedView[]>`
        select id, name, page, state, created_at from saved_view
        where user_id = ${request.user.id} order by created_at desc, id`;
      return { views };
    },
  );

  app.post(
    '/me/saved',
    {
      schema: {
        summary: 'Save a view under a name',
        body: Type.Object({
          name: Type.String({ minLength: 1, maxLength: 80 }),
          page: Type.Union([Type.Literal('map'), Type.Literal('graph'), Type.Literal('dashboard')]),
          state: Type.String({ maxLength: 2000, description: 'The share-link state of the view, without the leading #' }),
        }),
        response: { 200: SavedView, 401: ErrorBody, 422: ErrorBody },
      },
    },
    async (request, reply) => {
      if (!request.user) return reply.code(401).send(signIn);
      const name = request.body.name.trim();
      if (!name) return reply.code(422).send({ error: 'Give the view a name' });
      const [count] = await sql<{ kept: number }[]>`select count(*)::int as kept from saved_view where user_id = ${request.user.id}`;
      if (count!.kept >= SAVED_LIMIT) return reply.code(422).send({ error: `You can keep ${SAVED_LIMIT} views. Remove one to save another.` });
      const [view] = await sql<SavedView[]>`
        insert into saved_view (user_id, name, page, state)
        values (${request.user.id}, ${name}, ${request.body.page}, ${request.body.state})
        returning id, name, page, state, created_at`;
      return view!;
    },
  );

  app.delete(
    '/me/saved/:id',
    {
      schema: {
        summary: 'Remove a saved view',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
        response: { 200: Type.Object({ removed: Type.Boolean() }), 401: ErrorBody },
      },
    },
    async (request, reply) => {
      if (!request.user) return reply.code(401).send(signIn);
      // Only ever the caller's own: another user's id finds nothing.
      const gone = await sql`delete from saved_view where id = ${request.params.id} and user_id = ${request.user.id} returning id`;
      return { removed: gone.length > 0 };
    },
  );

  app.get(
    '/notifications',
    {
      schema: {
        summary: 'What has been published since a given time, and for reviewers how much is waiting',
        querystring: Type.Object({
          since: Type.Optional(Type.String({ format: 'date-time', description: `When the caller last looked. ${DEFAULT_DAYS} days ago when not given` })),
        }),
        response: { 200: Notifications },
      },
    },
    async (request) => {
      const since = request.query.since ? new Date(request.query.since) : new Date(Date.now() - DEFAULT_DAYS * 86_400_000);
      const reviews = request.user && request.user.role !== 'viewer';
      const [answer] = await sql<Notifications[]>`
        with fresh as (
          select 'organisation' as kind, g.id as organisation_id, g.name as label, null::text as detail, g.created_at as at
          from organisation g where g.status = 'published' and g.created_at > ${since}
          union all
          select 'round', g.id, g.name, coalesce(r.stage, 'Funding round'), r.created_at
          from funding_round r join organisation g on g.id = r.organisation_id and g.status = 'published'
          where r.status = 'published' and r.created_at > ${since}
        )
        select
          (select count(*)::int from fresh) as total,
          coalesce((
            select jsonb_agg(item order by item.at desc, item.label)
            from (select * from fresh order by at desc, label limit 20) item
          ), '[]'::jsonb) as items,
          ${reviews ? sql`(select count(*)::int from review_item where status = 'pending')` : sql`null::int`} as waiting_review
      `;
      return answer!;
    },
  );
};
