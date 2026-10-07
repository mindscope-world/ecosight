import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../src/app.js';
import { connect, type Sql } from '../src/db.js';

// Runs against the seeded test database. In the sample, the first fund led a
// round in six startups; the accelerator ran a programme for startups 01 and 02
// and organised one meetup; startup 01 has one named founder.
let sql: Sql;
let app: App;
const ids: Record<string, string> = {};
const org = (slug: string) => `org:${ids[slug]}`;

beforeAll(async () => {
  sql = connect();
  app = await buildApp({ sql });
  for (const row of await sql`select slug, id from organisation`) ids[row.slug] = row.id;
});
afterAll(async () => {
  await app.close();
  await sql.end();
});

const names = (nodes: { name: string }[]) => nodes.map((node) => node.name).sort();

describe('GET /graph/neighbourhood', () => {
  it('returns an investor with the companies it backed', async () => {
    const res = await app.inject(`/graph/neighbourhood?id=${ids['sample-fund-01']}`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.start).toBe(org('sample-fund-01'));
    expect(body.nodes).toHaveLength(7);
    expect(body.nodes[0]).toMatchObject({ id: org('sample-fund-01'), kind: 'organisation', degree: 6, hidden: 0 });
    expect(body.edges).toHaveLength(6);
    expect(body.edges.every((edge: any) => edge.kind === 'invested_in' && edge.source === org('sample-fund-01'))).toBe(true);
    expect(body.truncated).toBe(false);
  });

  it('says what an investment link stands for', async () => {
    const body = (await app.inject(`/graph/neighbourhood?id=${ids['sample-startup-05']}`)).json();
    expect(body.edges).toHaveLength(1);
    const [round] = body.edges[0].rounds;
    expect(round).toMatchObject({ amount_usd: 500000, is_lead: true, announced_precision: 'day' });
    expect(round.announced_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('goes further with depth, and no node appears twice', async () => {
    const body = (await app.inject(`/graph/neighbourhood?id=${ids['sample-startup-05']}&depth=2`)).json();
    // The startup, its investor, and the investor's five other companies.
    expect(body.nodes).toHaveLength(7);
    expect(new Set(body.nodes.map((node: any) => node.id)).size).toBe(7);
    expect(body.edges).toHaveLength(6);
  });

  it('follows programmes and organised events by default, and people only when asked', async () => {
    const usual = (await app.inject(`/graph/neighbourhood?id=${ids['sample-accelerator-01']}`)).json();
    expect(names(usual.nodes)).toEqual(['Sample Accelerator 01', 'Sample Meetup 01', 'Sample Startup 01', 'Sample Startup 02']);
    expect(usual.edges.find((edge: any) => edge.kind === 'accelerated_at').label).toBe('Sample Cohort 2026');
    expect(usual.nodes.find((node: any) => node.kind === 'event').detail).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const people = (await app.inject(`/graph/neighbourhood?id=${ids['sample-startup-01']}&kinds=has_role`)).json();
    expect(people.nodes).toHaveLength(2);
    const person = people.nodes.find((node: any) => node.kind === 'person');
    // A person is a name and a role, and nothing else.
    expect(person).toMatchObject({ name: 'Sample Founder', detail: 'Co-founder', ref: null, city: null, country: null });
  });

  it('caps the nodes returned and says how many neighbours are not shown', async () => {
    const body = (await app.inject(`/graph/neighbourhood?id=${ids['sample-fund-01']}&limit=4`)).json();
    expect(body.nodes).toHaveLength(4);
    expect(body.truncated).toBe(true);
    expect(body.nodes[0]).toMatchObject({ degree: 6, hidden: 3 });
  });

  it('starts from a sector or a place', async () => {
    const [top] = await sql<{ sector: string; n: number }[]>`
      select s as sector, count(*)::int as n from organisation, unnest(sectors) s
      where status = 'published' group by s order by n desc, s limit 1`;
    const { sector, n } = top!;
    const body = (await app.inject(`/graph/neighbourhood?id=sector:${sector}&kinds=in_sector&limit=300`)).json();
    expect(body.nodes[0]).toMatchObject({ kind: 'sector', name: sector, degree: n });
    expect(body.nodes).toHaveLength(n + 1);

    const place = (await app.inject('/graph/neighbourhood?id=place:KE/Nairobi&kinds=located_in&limit=5')).json();
    expect(place.nodes[0]).toMatchObject({ kind: 'place', name: 'Nairobi', country: 'KE' });
    expect(place.truncated).toBe(true);
  });

  it('applies the map filters to organisations, but always keeps the one asked about', async () => {
    const all = (await app.inject(`/graph/neighbourhood?id=${ids['sample-fund-01']}`)).json();
    const sectors = new Set<string>(all.nodes.slice(1).flatMap((node: any) => node.sectors));
    const [sector] = [...sectors].sort();
    const expected = all.nodes.slice(1).filter((node: any) => node.sectors.includes(sector)).length;
    const body = (await app.inject(`/graph/neighbourhood?id=${ids['sample-fund-01']}&fs=${sector}`)).json();
    expect(body.nodes).toHaveLength(expected + 1);
    expect(body.nodes[0].degree).toBe(expected);

    // A year with no rounds removes every investment link.
    const none = (await app.inject(`/graph/neighbourhood?id=${ids['sample-fund-01']}&fd=1990-1991`)).json();
    expect(none.nodes).toHaveLength(1);
    expect(none.nodes[0]).toMatchObject({ degree: 0, hidden: 0 });
  });

  it('leaves out drafts', async () => {
    await sql`update organisation set status = 'draft' where id = ${ids['sample-startup-05']!}`;
    try {
      const body = (await app.inject(`/graph/neighbourhood?id=${ids['sample-fund-01']}`)).json();
      expect(body.nodes).toHaveLength(6);
      expect((await app.inject(`/graph/neighbourhood?id=${ids['sample-startup-05']}`)).statusCode).toBe(404);
    } finally {
      await sql`update organisation set status = 'published' where id = ${ids['sample-startup-05']!}`;
    }
  });

  it('leaves out people who opted out', async () => {
    await sql`update person_role set opted_out = true where name = 'Sample Founder'`;
    try {
      const body = (await app.inject(`/graph/neighbourhood?id=${ids['sample-startup-01']}&kinds=has_role`)).json();
      expect(body.nodes).toHaveLength(1);
    } finally {
      await sql`update person_role set opted_out = false where name = 'Sample Founder'`;
    }
  });

  it('rejects ids and kinds it does not know', async () => {
    expect((await app.inject('/graph/neighbourhood?id=nonsense')).statusCode).toBe(400);
    expect((await app.inject(`/graph/neighbourhood?id=${ids['sample-fund-01']}&kinds=friends`)).statusCode).toBe(400);
    expect((await app.inject(`/graph/neighbourhood?id=${ids['sample-fund-01']}&depth=9`)).statusCode).toBe(400);
    expect((await app.inject('/graph/neighbourhood?id=00000000-0000-4000-8000-000000000000')).statusCode).toBe(404);
    expect((await app.inject('/graph/neighbourhood?id=sector:no-such-sector')).statusCode).toBe(404);
  });
});

describe('POST /graph/expand', () => {
  const expand = (payload: object, query = '') => app.inject({ method: 'POST', url: `/graph/expand${query}`, payload });

  it('brings in the neighbours the caller does not have', async () => {
    const res = await expand({ id: org('sample-fund-01'), known: [org('sample-startup-05'), org('sample-startup-10')] });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(4);
    expect(body.remaining).toBe(0);
    // The expanded node, then the four new ones by name.
    expect(body.nodes.map((node: any) => node.name)).toEqual([
      'Sample Fund 01', 'Sample Startup 15', 'Sample Startup 20', 'Sample Startup 25', 'Sample Startup 30',
    ]);
    expect(body.nodes[0].hidden).toBe(0);
    expect(body.edges).toHaveLength(4);
  });

  it('pages through them', async () => {
    const first = (await expand({ id: org('sample-fund-01'), limit: 4 })).json();
    expect(first.nodes).toHaveLength(5);
    expect(first).toMatchObject({ total: 6, remaining: 2 });
    expect(first.nodes[0].hidden).toBe(2);
    const second = (await expand({ id: org('sample-fund-01'), limit: 4, offset: 4 })).json();
    expect(second.nodes.slice(1).map((node: any) => node.name)).toEqual(['Sample Startup 25', 'Sample Startup 30']);
    expect(second.remaining).toBe(0);
  });

  it('returns links from new nodes to ones already on screen', async () => {
    // Startup 01 is on screen; expanding startup 02 brings in the accelerator, which also links to 01.
    const body = (await expand({ id: org('sample-startup-02'), known: [org('sample-startup-01')] })).json();
    expect(body.nodes.map((node: any) => node.name)).toEqual(['Sample Startup 02', 'Sample Accelerator 01']);
    expect(body.edges.map((edge: any) => edge.source).sort()).toEqual([org('sample-startup-01'), org('sample-startup-02')].sort());
    // The accelerator's meetup is still not shown.
    expect(body.nodes[1]).toMatchObject({ degree: 3, hidden: 1 });
  });

  it('takes the same kinds and filters as the other routes', async () => {
    const body = (await expand({ id: org('sample-startup-01') }, '?kinds=has_role')).json();
    expect(body.nodes.map((node: any) => node.kind)).toEqual(['organisation', 'person']);
  });
});

describe('GET /graph/path', () => {
  it('finds the chain between two companies with the same investor', async () => {
    const res = await app.inject(`/graph/path?from=${ids['sample-startup-05']}&to=${ids['sample-startup-30']}`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ found: true, length: 2 });
    expect(body.nodes.map((node: any) => node.name)).toEqual(['Sample Startup 05', 'Sample Fund 01', 'Sample Startup 30']);
    expect(body.edges).toHaveLength(2);
  });

  it('says so when there is no connection on record', async () => {
    const body = (await app.inject(`/graph/path?from=${ids['sample-startup-01']}&to=${ids['sample-startup-05']}`)).json();
    expect(body).toEqual({ found: false, length: null, nodes: [], edges: [], searched_all: true });
  });

  it('can go through a sector or a place only when asked to', async () => {
    const url = `/graph/path?from=${ids['sample-startup-01']}&to=${ids['sample-startup-05']}&kinds=located_in`;
    const body = (await app.inject(url)).json();
    expect(body).toMatchObject({ found: true, length: 2 });
    expect(body.nodes[1].kind).toBe('place');
  });

  it('stops at the longest chain asked for', async () => {
    const url = `/graph/path?from=${ids['sample-startup-05']}&to=${ids['sample-startup-30']}&max=1`;
    expect((await app.inject(url)).json()).toMatchObject({ found: false, searched_all: false });
  });

  it('answers for a node and itself, and 404 for an unknown end', async () => {
    const same = (await app.inject(`/graph/path?from=${ids['sample-fund-01']}&to=${ids['sample-fund-01']}`)).json();
    expect(same).toMatchObject({ found: true, length: 0 });
    const missing = `/graph/path?from=${ids['sample-fund-01']}&to=00000000-0000-4000-8000-000000000000`;
    expect((await app.inject(missing)).statusCode).toBe(404);
  });
});

describe('GET /graph/co-investment', () => {
  it('lists companies that share an investor, with the investor', async () => {
    const res = await app.inject(`/graph/co-investment?id=${ids['sample-startup-05']}`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.organisation.name).toBe('Sample Startup 05');
    expect(body.co_investors).toEqual([]);
    expect(body.shared_investors).toHaveLength(5);
    expect(body.shared_investors[0].shared).toEqual([{ id: org('sample-fund-01'), name: 'Sample Fund 01' }]);
  });

  it('lists investors that back the same companies', async () => {
    // A second fund joins the first in two of its rounds.
    const rounds = await sql`
      select r.id from funding_round r join organisation g on g.id = r.organisation_id
      where g.slug in ('sample-startup-05', 'sample-startup-10')`;
    const second = ids['sample-fund-02']!;
    for (const round of rounds) await sql`insert into round_investor (round_id, investor_id) values (${round.id}, ${second})`;
    try {
      const body = (await app.inject(`/graph/co-investment?id=${ids['sample-fund-01']}`)).json();
      expect(body.co_investors).toHaveLength(1);
      expect(body.co_investors[0].organisation.name).toBe('Sample Fund 02');
      expect(names(body.co_investors[0].shared)).toEqual(['Sample Startup 05', 'Sample Startup 10']);
      expect(body.shared_investors).toEqual([]);

      // Co-investors are also one step apart on a path through the company.
      const path = (await app.inject(`/graph/path?from=${ids['sample-fund-01']}&to=${second}`)).json();
      expect(path.length).toBe(2);
    } finally {
      await sql`delete from round_investor where investor_id = ${second}`;
    }
  });

  it('answers with empty lists for an organisation with no investments', async () => {
    const body = (await app.inject(`/graph/co-investment?id=${ids['sample-startup-01']}`)).json();
    expect(body).toMatchObject({ co_investors: [], shared_investors: [] });
  });
});

describe('GET /graph/top', () => {
  it('ranks organisations by how many others they are linked to', async () => {
    const res = await app.inject('/graph/top?limit=3');
    expect(res.statusCode).toBe(200);
    const { organisations } = res.json();
    expect(organisations.map((o: any) => [o.name, o.degree])).toEqual([
      ['Sample Fund 01', 6],
      ['Sample Accelerator 01', 3],
      [expect.any(String), 1],
    ]);
  });

  it('narrows by kind of organisation and by kind of link', async () => {
    const funds = (await app.inject('/graph/top?type=fund')).json();
    expect(names(funds.organisations)).toEqual(['Sample Fund 01']);
    const programmes = (await app.inject('/graph/top?kinds=accelerated_at')).json();
    expect(programmes.organisations[0]).toMatchObject({ name: 'Sample Accelerator 01', degree: 2 });
    expect(programmes.organisations).toHaveLength(3);
  });
});

describe('graph routes and the access key', () => {
  it('are closed without the key, including the one that takes a body', async () => {
    const closed = await buildApp({ sql, accessKey: 'test-key' });
    try {
      const url = `/graph/neighbourhood?id=${ids['sample-fund-01']}`;
      expect((await closed.inject(url)).statusCode).toBe(401);
      expect((await closed.inject({ method: 'POST', url: '/graph/expand', payload: { id: org('sample-fund-01') } })).statusCode).toBe(401);
      expect((await closed.inject({ url, headers: { 'x-access-key': 'test-key' } })).statusCode).toBe(200);
    } finally {
      await closed.close();
    }
  });
});
