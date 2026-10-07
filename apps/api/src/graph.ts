import { countActive, type Filters } from '@atlas/schema';
import type postgres from 'postgres';
import type { Sql } from './db.js';
import { organisationConditions } from './filters.js';
import type { GraphEdge, GraphNode, OrgType } from './schemas.js';

// The graph is read from the `graph_edge` view and walked here, one level per
// query. That is enough for a graph of this size; a graph database takes over
// the walking when the data outgrows it (ADR 0003).

export const EDGE_KINDS = ['invested_in', 'accelerated_at', 'organised', 'has_role', 'located_in', 'in_sector'] as const;
export type EdgeKind = (typeof EDGE_KINDS)[number];

/**
 * Links between organisations and their events. People are left out unless
 * asked for, and so are places and sectors: nearly everything is "connected"
 * through Nairobi or fintech, which says nothing.
 */
export const DEFAULT_KINDS: EdgeKind[] = ['invested_in', 'accelerated_at', 'organised'];

/** Longest any one graph query may run. */
const QUERY_TIMEOUT_MS = 3000;
/** A path search stops after looking at this many nodes, found or not. */
const PATH_SEARCH_CAP = 5000;

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const NODE_ID = new RegExp(`^(?:(?:org|event|person):${UUID}|(?:place|sector):.{1,120})$`, 'i');
const BARE_UUID = new RegExp(`^${UUID}$`, 'i');
const KIND_ORDER = ['org', 'event', 'person', 'place', 'sector'];

type Tx = postgres.TransactionSql;

export interface GraphScope {
  kinds: EdgeKind[];
  filters: Filters;
  /** Organisations shown whatever the filters say: the ones the visitor asked about. */
  exempt: string[];
}

interface EdgeRow {
  kind: EdgeKind;
  source: string;
  target: string;
  ref_id: string | null;
  label: string | null;
}

export class GraphError extends Error {
  constructor(
    readonly status: 400 | 404 | 503,
    message: string,
  ) {
    super(message);
  }
}

/** A node id as given by a caller, in its full form. A bare id means an organisation. */
export function nodeId(given: string): string {
  const id = BARE_UUID.test(given) ? `org:${given}` : given;
  if (!NODE_ID.test(id)) throw new GraphError(400, `Not a node id: ${given}`);
  const at = id.indexOf(':');
  const prefix = id.slice(0, at).toLowerCase();
  // Ids of records are lower case; names of places and sectors are kept as written.
  return prefix === 'place' || prefix === 'sector' ? `${prefix}:${id.slice(at + 1)}` : id.toLowerCase();
}

export function parseKinds(given: string | undefined): EdgeKind[] {
  if (!given) return DEFAULT_KINDS;
  const kinds = [...new Set(given.split(',').map((kind) => kind.trim()).filter(Boolean))];
  const unknown = kinds.find((kind) => !(EDGE_KINDS as readonly string[]).includes(kind));
  if (unknown) throw new GraphError(400, `Unknown kind of link: ${unknown}`);
  return kinds as EdgeKind[];
}

const orgUuid = (id: string) => (id.startsWith('org:') ? id.slice(4) : null);
const rank = (id: string) => KIND_ORDER.indexOf(id.slice(0, id.indexOf(':')));
const byKindThenId = (a: string, b: string) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0);

/**
 * Runs graph queries with a time limit. The limit ends with the transaction, so
 * it cannot follow the connection back into the pool.
 */
export async function withinTimeLimit<T>(sql: Sql, run: (tx: Tx) => Promise<T>): Promise<T> {
  try {
    return (await sql.begin(async (tx) => {
      await tx`select set_config('statement_timeout', ${String(QUERY_TIMEOUT_MS)}, true)`;
      return run(tx);
    })) as T;
  } catch (error) {
    // 57014: the statement was cancelled, here by the time limit.
    if ((error as { code?: string }).code === '57014')
      throw new GraphError(503, 'The graph query took too long. Narrow it with filters or fewer kinds of link.');
    throw error;
  }
}

/**
 * Conditions on a `graph_edge e` row: its kind, its date where the filters give
 * one, and both of its organisations passing the organisation filters.
 */
function edgeConditions(sql: Sql, { kinds, filters: f, exempt }: GraphScope) {
  const none = sql``;
  const exemptIds = exempt.map(orgUuid).filter((id): id is string => id !== null);
  // Round years and event dates bound the links themselves; the rest bound organisations.
  const passes = (column: 'source_org' | 'target_org') => sql`
    and (
      e.${sql(column)} is null or e.${sql(column)} = any(${exemptIds}::uuid[])
      or exists (select 1 from organisation g where g.id = e.${sql(column)} ${organisationConditions(sql, f)})
    )`;
  const filtered = countActive({ ...f, eventFrom: null, eventTo: null }) > 0;
  return sql`
    and e.kind = any(${kinds}::text[])
    ${
      f.fundedFrom !== null || f.fundedTo !== null
        ? sql`and (e.kind <> 'invested_in' or extract(year from e.occurred_on) between ${f.fundedFrom ?? 0} and ${f.fundedTo ?? 9999})`
        : none
    }
    ${f.eventFrom !== null ? sql`and (e.kind <> 'organised' or e.occurred_on >= ${f.eventFrom}::date)` : none}
    ${f.eventTo !== null ? sql`and (e.kind <> 'organised' or e.occurred_on <= ${f.eventTo}::date)` : none}
    ${filtered ? sql`${passes('source_org')} ${passes('target_org')}` : none}
  `;
}

/** Every link with an end among `ids`. */
function edgesTouching(sql: Sql, tx: Tx, scope: GraphScope, ids: string[]) {
  return tx<EdgeRow[]>`
    select e.kind, e.source, e.target, e.ref_id, e.label from graph_edge e
    where (e.source = any(${ids}::text[]) or e.target = any(${ids}::text[]))
      ${edgeConditions(sql, scope)}
  `;
}

/** Every link with both ends among `ids`; when `from` is given, only those with an end in it. */
function edgesAmong(sql: Sql, tx: Tx, scope: GraphScope, ids: string[], from?: string[]) {
  const a = from ?? ids;
  return tx<EdgeRow[]>`
    select e.kind, e.source, e.target, e.ref_id, e.label from graph_edge e
    where ((e.source = any(${a}::text[]) and e.target = any(${ids}::text[]))
        or (e.target = any(${a}::text[]) and e.source = any(${ids}::text[])))
      ${edgeConditions(sql, scope)}
  `;
}

/** How many distinct neighbours each node has, within the scope. */
async function degrees(sql: Sql, tx: Tx, scope: GraphScope, ids: string[]): Promise<Map<string, number>> {
  const rows = await tx<{ node: string; degree: number }[]>`
    select node, count(distinct other)::int as degree from (
      select e.source as node, e.target as other from graph_edge e
      where e.source = any(${ids}::text[]) ${edgeConditions(sql, scope)}
      union all
      select e.target, e.source from graph_edge e
      where e.target = any(${ids}::text[]) ${edgeConditions(sql, scope)}
    ) pairs group by node
  `;
  return new Map(rows.map((row) => [row.node, row.degree]));
}

type BareNode = Omit<GraphNode, 'degree' | 'hidden'>;

/** Names and facts for node ids. An id that leads to nothing published is left out. */
async function describe(tx: Tx, ids: string[]): Promise<Map<string, BareNode>> {
  const of = (prefix: string) => ids.filter((id) => id.startsWith(`${prefix}:`)).map((id) => id.slice(prefix.length + 1));
  const found = new Map<string, BareNode>();

  const orgs = of('org');
  if (orgs.length) {
    const rows = await tx<{ id: string; name: string; types: OrgType[]; sectors: string[]; city: string | null; country: string | null }[]>`
      select g.id, g.name, g.types::text[] as types, g.sectors, hq.city, hq.country::text as country
      from organisation g
      left join lateral (
        select o.city, o.country from office o
        where o.organisation_id = g.id and o.valid_to is null
        order by o.is_hq desc, o.valid_from nulls last limit 1
      ) hq on true
      where g.id = any(${orgs}::uuid[]) and g.status = 'published'
    `;
    for (const row of rows)
      found.set(`org:${row.id}`, {
        id: `org:${row.id}`, kind: 'organisation', ref: row.id, name: row.name, types: row.types,
        sectors: row.sectors, city: row.city, country: row.country, detail: null,
      });
  }

  const events = of('event');
  if (events.length) {
    const rows = await tx<{ id: string; name: string; city: string | null; country: string | null; starts_at: Date }[]>`
      select id, name, city, country::text as country, starts_at from event
      where id = any(${events}::uuid[]) and status = 'published'
    `;
    for (const row of rows)
      found.set(`event:${row.id}`, {
        id: `event:${row.id}`, kind: 'event', ref: row.id, name: row.name, types: [], sectors: [],
        city: row.city, country: row.country, detail: row.starts_at.toISOString().slice(0, 10),
      });
  }

  // A person is a name and a role at one organisation, and nothing more.
  const people = of('person');
  if (people.length) {
    const rows = await tx<{ id: string; name: string; role: string }[]>`
      select pr.id, pr.name, pr.role from person_role pr
      join organisation g on g.id = pr.organisation_id and g.status = 'published'
      where pr.id = any(${people}::uuid[]) and not pr.opted_out
    `;
    for (const row of rows)
      found.set(`person:${row.id}`, {
        id: `person:${row.id}`, kind: 'person', ref: null, name: row.name, types: [], sectors: [],
        city: null, country: null, detail: row.role,
      });
  }

  // Places and sectors have no record of their own: they exist where something points at them.
  const named = ids.filter((id) => id.startsWith('place:') || id.startsWith('sector:'));
  if (named.length) {
    const rows = await tx<{ target: string }[]>`
      select distinct target from graph_edge where target = any(${named}::text[])
    `;
    for (const { target } of rows) {
      const place = target.startsWith('place:');
      const key = target.slice(target.indexOf(':') + 1);
      found.set(target, {
        id: target, kind: place ? 'place' : 'sector', ref: null,
        name: place ? key.slice(key.indexOf('/') + 1) : key, types: [], sectors: [],
        city: place ? key.slice(key.indexOf('/') + 1) : null, country: place ? key.slice(0, key.indexOf('/')) : null,
        detail: null,
      });
    }
  }
  return found;
}

/** Fails with 404 unless every id leads to something published. */
async function mustExist(tx: Tx, ids: string[]): Promise<void> {
  const found = await describe(tx, ids);
  const missing = ids.find((id) => !found.has(id));
  if (missing) throw new GraphError(404, `Nothing published has the id ${missing}`);
}

/** Folds link rows into one edge per kind and pair, with what each stands for. */
async function buildEdges(tx: Tx, rows: EdgeRow[]): Promise<GraphEdge[]> {
  const edges = new Map<string, GraphEdge & { refs: string[]; labels: Set<string> }>();
  for (const row of rows) {
    const id = `${row.kind}|${row.source}|${row.target}`;
    let edge = edges.get(id);
    if (!edge) {
      edge = { id, kind: row.kind, source: row.source, target: row.target, label: null, rounds: [], refs: [], labels: new Set() };
      edges.set(id, edge);
    }
    if (row.ref_id && !edge.refs.includes(row.ref_id)) edge.refs.push(row.ref_id);
    if (row.label) edge.labels.add(row.label);
  }

  // An investment link stands for rounds; each carries the source it was read from.
  const roundIds = [...edges.values()].filter((edge) => edge.kind === 'invested_in').flatMap((edge) => edge.refs);
  const rounds = new Map<string, GraphEdge['rounds'][number] & { leads: string[] }>();
  if (roundIds.length) {
    const found = await tx<(GraphEdge['rounds'][number] & { leads: string[] })[]>`
      select
        r.id, r.stage, r.amount_usd::float8 as amount_usd, r.announced_on::text as announced_on,
        r.announced_precision,
        (select s.source_url from field_source s
          where s.record_type = 'funding_round' and s.record_id = r.id and s.source_url is not null
          order by s.field limit 1) as source_url,
        false as is_lead,
        coalesce((select array_agg('org:' || ri.investor_id) from round_investor ri
          where ri.round_id = r.id and ri.is_lead), '{}') as leads
      from funding_round r where r.id = any(${roundIds}::uuid[])
    `;
    for (const round of found) rounds.set(round.id, round);
  }

  return [...edges.values()]
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map(({ refs, labels, ...edge }) => ({
      ...edge,
      label: labels.size ? [...labels].sort().join(', ') : null,
      rounds:
        edge.kind === 'invested_in'
          ? refs
              .map((ref) => rounds.get(ref))
              .filter((round) => round !== undefined)
              .map(({ leads, ...round }) => ({ ...round, is_lead: leads.includes(edge.source) }))
              .sort((a, b) => (b.announced_on ?? '').localeCompare(a.announced_on ?? ''))
          : [],
    }));
}

/** Describes nodes in the order given, with their degree and how many neighbours are not among `shown`. */
async function buildNodes(sql: Sql, tx: Tx, scope: GraphScope, ids: string[], edges: GraphEdge[]): Promise<GraphNode[]> {
  const [facts, degree] = await Promise.all([describe(tx, ids), degrees(sql, tx, scope, ids)]);
  const drawn = new Map<string, Set<string>>();
  for (const edge of edges) {
    (drawn.get(edge.source) ?? drawn.set(edge.source, new Set()).get(edge.source)!).add(edge.target);
    (drawn.get(edge.target) ?? drawn.set(edge.target, new Set()).get(edge.target)!).add(edge.source);
  }
  return ids
    .filter((id) => facts.has(id))
    .map((id) => {
      const total = degree.get(id) ?? 0;
      return { ...facts.get(id)!, degree: total, hidden: Math.max(0, total - (drawn.get(id)?.size ?? 0)) };
    });
}

const other = (row: EdgeRow, id: string) => (row.source === id ? row.target : row.source);

/**
 * A node and everything within `depth` links of it, nearest first, up to `limit`
 * nodes. When a level does not fit, the walk stops there and says so.
 */
export function neighbourhood(sql: Sql, start: string, depth: number, limit: number, scope: Omit<GraphScope, 'exempt'>) {
  const full: GraphScope = { ...scope, exempt: [start] };
  return withinTimeLimit(sql, async (tx) => {
    await mustExist(tx, [start]);
    const seen = new Set([start]);
    let frontier = [start];
    let truncated = false;
    for (let level = 0; level < depth && frontier.length && !truncated; level++) {
      const rows = await edgesTouching(sql, tx, full, frontier);
      const reached = new Set<string>();
      for (const row of rows) for (const id of [row.source, row.target]) if (!seen.has(id)) reached.add(id);
      let next = [...reached].sort(byKindThenId);
      if (next.length > limit - seen.size) {
        next = next.slice(0, Math.max(0, limit - seen.size));
        truncated = true;
      }
      for (const id of next) seen.add(id);
      frontier = next;
    }
    const ids = [...seen];
    const edges = await buildEdges(tx, await edgesAmong(sql, tx, full, ids));
    return { start, nodes: await buildNodes(sql, tx, full, ids, edges), edges, truncated };
  });
}

/**
 * The neighbours of one node that the caller does not have yet, a page at a
 * time, with every link between them and what the caller already has.
 */
export function expand(
  sql: Sql,
  id: string,
  known: string[],
  offset: number,
  limit: number,
  scope: Omit<GraphScope, 'exempt'>,
) {
  const full: GraphScope = { ...scope, exempt: [id] };
  return withinTimeLimit(sql, async (tx) => {
    await mustExist(tx, [id]);
    const have = new Set([id, ...known]);
    const rows = await edgesTouching(sql, tx, full, [id]);
    const fresh = [...new Set(rows.map((row) => other(row, id)))].filter((n) => !have.has(n));
    // Sorted by name within each kind, so pages come in an order a reader can follow.
    const facts = await describe(tx, fresh);
    const ordered = fresh
      .filter((n) => facts.has(n))
      .sort((a, b) => rank(a) - rank(b) || facts.get(a)!.name.localeCompare(facts.get(b)!.name) || byKindThenId(a, b));
    const page = ordered.slice(offset, offset + limit);
    const all = [...have, ...page];
    // Links among what the caller already has were sent with those nodes.
    const edges = await buildEdges(tx, await edgesAmong(sql, tx, full, all, page));
    // Hidden counts are worked out against everything the caller will then be showing.
    const context = await buildEdges(tx, await edgesAmong(sql, tx, full, all));
    return {
      id,
      nodes: await buildNodes(sql, tx, full, [id, ...page], context),
      edges,
      total: ordered.length,
      remaining: Math.max(0, ordered.length - offset - page.length),
    };
  });
}

/** The shortest chain of links between two nodes, if there is one within `maxLength` links. */
export function shortestPath(sql: Sql, from: string, to: string, maxLength: number, scope: Omit<GraphScope, 'exempt'>) {
  const full: GraphScope = { ...scope, exempt: [from, to] };
  return withinTimeLimit(sql, async (tx) => {
    await mustExist(tx, from === to ? [from] : [from, to]);
    const cameFrom = new Map<string, string | null>([[from, null]]);
    let frontier = [from];
    let capped = false;
    for (let level = 0; level < maxLength && frontier.length && !cameFrom.has(to); level++) {
      const rows = await edgesTouching(sql, tx, full, frontier);
      const next: string[] = [];
      // Walked in a fixed order, so the same question always gets the same chain.
      for (const at of [...frontier].sort(byKindThenId)) {
        const reached = rows.filter((row) => row.source === at || row.target === at).map((row) => other(row, at));
        for (const id of [...new Set(reached)].sort(byKindThenId)) {
          if (cameFrom.has(id)) continue;
          cameFrom.set(id, at);
          next.push(id);
        }
      }
      frontier = next;
      if (cameFrom.size > PATH_SEARCH_CAP) {
        capped = true;
        break;
      }
    }
    if (!cameFrom.has(to)) {
      // Nothing left to visit means there is no chain at any length; otherwise only none this short.
      return { found: false, length: null, nodes: [], edges: [], searched_all: !capped && frontier.length === 0 };
    }
    const chain: string[] = [];
    for (let at: string | null = to; at !== null; at = cameFrom.get(at) ?? null) chain.unshift(at);
    const hops = new Set(chain.slice(1).map((id, i) => [chain[i]!, id].sort().join('|')));
    const rows = (await edgesAmong(sql, tx, full, chain)).filter((row) => hops.has([row.source, row.target].sort().join('|')));
    const edges = await buildEdges(tx, rows);
    return { found: true, length: chain.length - 1, nodes: await buildNodes(sql, tx, full, chain, edges), edges, searched_all: true };
  });
}

/**
 * Who an organisation is tied to through investments: investors that back the
 * same companies it backs, and companies backed by the same investors as it.
 */
export function coInvestment(sql: Sql, id: string, limit: number, scope: Omit<GraphScope, 'exempt' | 'kinds'>) {
  const full: GraphScope = { ...scope, kinds: ['invested_in'], exempt: [id] };
  const uuid = id.slice(4);
  return withinTimeLimit(sql, async (tx) => {
    await mustExist(tx, [id]);
    const pairs = sql`
      select distinct e.source_org as investor, e.target_org as company from graph_edge e
      where true ${edgeConditions(sql, full)}
    `;
    type Row = { other: string; via: string[] };
    const [alongside, peers] = await Promise.all([
      tx<Row[]>`
        with pairs as (${pairs})
        select 'org:' || b.investor as other, array_agg('org:' || a.company order by a.company) as via
        from pairs a join pairs b on b.company = a.company and b.investor <> a.investor
        where a.investor = ${uuid} group by b.investor
        order by count(*) desc, b.investor limit ${limit}
      `,
      tx<Row[]>`
        with pairs as (${pairs})
        select 'org:' || b.company as other, array_agg('org:' || a.investor order by a.investor) as via
        from pairs a join pairs b on b.investor = a.investor and b.company <> a.company
        where a.company = ${uuid} group by b.company
        order by count(*) desc, b.company limit ${limit}
      `,
    ]);
    const ids = [...new Set([id, ...[...alongside, ...peers].flatMap((row) => [row.other, ...row.via])])];
    const facts = await describe(tx, ids);
    const list = (rows: Row[]) =>
      rows
        .filter((row) => facts.has(row.other))
        .map((row) => ({
          organisation: facts.get(row.other)!,
          shared: row.via.filter((via) => facts.has(via)).map((via) => ({ id: via, name: facts.get(via)!.name })),
        }));
    return { organisation: facts.get(id)!, co_investors: list(alongside), shared_investors: list(peers) };
  });
}

/**
 * Every link of the kinds asked for, with the nodes at its ends: the whole
 * network at once. When that is more than `limit` nodes, the best connected are
 * kept and the answer says it is partial.
 */
export function overview(sql: Sql, limit: number, scope: Omit<GraphScope, 'exempt'>) {
  const full: GraphScope = { ...scope, exempt: [] };
  return withinTimeLimit(sql, async (tx) => {
    const rows = await tx<EdgeRow[]>`
      select e.kind, e.source, e.target, e.ref_id, e.label from graph_edge e
      where true ${edgeConditions(sql, full)}
    `;
    const neighbours = new Map<string, Set<string>>();
    const link = (a: string, b: string) => (neighbours.get(a) ?? neighbours.set(a, new Set()).get(a)!).add(b);
    for (const row of rows) {
      link(row.source, row.target);
      link(row.target, row.source);
    }
    const ranked = [...neighbours.keys()].sort(
      (a, b) => neighbours.get(b)!.size - neighbours.get(a)!.size || byKindThenId(a, b),
    );
    const kept = new Set(ranked.slice(0, limit));
    const edges = await buildEdges(tx, rows.filter((row) => kept.has(row.source) && kept.has(row.target)));
    return {
      nodes: await buildNodes(sql, tx, full, [...kept], edges),
      edges,
      truncated: ranked.length > kept.size,
      total_nodes: ranked.length,
    };
  });
}

/** Organisations with the most distinct neighbours, as starting points. */
export function mostConnected(sql: Sql, limit: number, type: OrgType | undefined, scope: Omit<GraphScope, 'exempt'>) {
  const full: GraphScope = { ...scope, exempt: [] };
  return withinTimeLimit(sql, async (tx) => {
    const rows = await tx<{ node: string; degree: number }[]>`
      select pairs.node, count(distinct pairs.other)::int as degree from (
        select e.source as node, e.source_org as org, e.target as other from graph_edge e
        where e.source_org is not null ${edgeConditions(sql, full)}
        union all
        select e.target, e.target_org, e.source from graph_edge e
        where e.target_org is not null ${edgeConditions(sql, full)}
      ) pairs
      ${type ? sql`join organisation t on t.id = pairs.org and ${type}::org_type = any(t.types)` : sql``}
      group by pairs.node order by degree desc, pairs.node limit ${limit}
    `;
    const facts = await describe(tx, rows.map((row) => row.node));
    return {
      organisations: rows
        .filter((row) => facts.has(row.node))
        .map((row) => ({ ...facts.get(row.node)!, degree: row.degree, hidden: row.degree })),
    };
  });
}
