import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../src/app.js';
import { connect, type Sql } from '../src/db.js';

// Runs against the seeded test database, which has a reviewer and a viewer on
// the list of users, and three items waiting: two draft organisations and a
// relationship naming an organisation that is not on record.
let sql: Sql;
let app: App;

const TOKENS: Record<string, string> = {
  'reviewer-token': 'reviewer@example.org',
  'viewer-token': 'Viewer@Example.org', // an address is the same however it is capitalised
  'stranger-token': 'stranger@example.org',
};
const verify = async (token: string) => (TOKENS[token] ? { email: TOKENS[token]! } : null);
const as = (token: string) => ({ authorization: `Bearer ${token}` });
const reviewer = as('reviewer-token');

beforeAll(async () => {
  sql = connect();
  app = await buildApp({ sql, accessKey: 'the-key', verify });
});
afterAll(async () => {
  await app.close();
  await sql.end();
});

const post = (url: string, headers: Record<string, string>, payload: object = {}) =>
  app.inject({ method: 'POST', url, headers, payload });
const queue = async (status = 'pending') =>
  (await app.inject({ url: `/review/items?status=${status}`, headers: reviewer })).json();

describe('signing in', () => {
  it('lets in an address on the list, in place of the access key', async () => {
    expect((await app.inject('/stats')).statusCode).toBe(401);
    expect((await app.inject({ url: '/stats', headers: as('viewer-token') })).statusCode).toBe(200);
    expect((await app.inject({ url: '/me', headers: as('viewer-token') })).json()).toEqual({ email: 'viewer@example.org', role: 'viewer' });
    expect((await app.inject({ url: '/me', headers: reviewer })).json().role).toBe('reviewer');
  });

  it('turns away a good sign-in that is not on the list, and a bad one', async () => {
    const stranger = await app.inject({ url: '/stats', headers: as('stranger-token') });
    expect(stranger.statusCode).toBe(403);
    expect(stranger.json()).toEqual({ error: 'This address has not been given access' });
    expect((await app.inject({ url: '/stats', headers: as('made-up') })).statusCode).toBe(401);
  });

  it('still opens with the access key, as nobody in particular', async () => {
    const res = await app.inject({ url: '/me', headers: { 'x-access-key': 'the-key' } });
    expect(res.json()).toEqual({ email: null, role: null });
    // The key with a stale or unlisted sign-in beside it still reads.
    expect((await app.inject({ url: '/stats', headers: { 'x-access-key': 'the-key', ...as('made-up') } })).statusCode).toBe(200);
    const both = { 'x-access-key': 'the-key', ...as('stranger-token') };
    expect((await app.inject({ url: '/stats', headers: both })).statusCode).toBe(200);
    // It is told which address signed in, and that it has no role, so the page can say whom to ask about.
    expect((await app.inject({ url: '/me', headers: both })).json()).toEqual({ email: 'stranger@example.org', role: null });
    expect((await app.inject({ url: '/review/items', headers: both })).statusCode).toBe(401);
  });

  it('treats every request as the named user when set up for local work', async () => {
    const local = await buildApp({ sql, devUser: 'reviewer@example.org' });
    try {
      expect((await local.inject('/me')).json()).toEqual({ email: 'reviewer@example.org', role: 'reviewer' });
      expect((await local.inject('/review/items')).statusCode).toBe(200);
    } finally {
      await local.close();
    }
  });
});

describe('the review queue', () => {
  it('is for reviewers only', async () => {
    expect((await app.inject({ url: '/review/items', headers: { 'x-access-key': 'the-key' } })).statusCode).toBe(401);
    expect((await app.inject({ url: '/review/items', headers: as('viewer-token') })).statusCode).toBe(403);
    const [item] = (await queue()).items;
    expect((await post(`/review/items/${item.id}/approve`, as('viewer-token'))).statusCode).toBe(403);
    expect((await post(`/review/items/${item.id}/reject`, { 'x-access-key': 'the-key' })).statusCode).toBe(401);
  });

  it('lists what is waiting, with why, and who a proposed relationship names', async () => {
    const body = await queue();
    expect(body.pending).toBe(3);
    expect(body.items.map((item: any) => item.kind)).toEqual(['organisation', 'organisation', 'relationship']);
    expect(body.items[0]).toMatchObject({
      status: 'pending', reason: 'Dataset marks this row partially_verified', source: 'sample',
      organisation: { name: 'Sample Draft 01', status: 'draft', types: ['startup'], sources: 1 },
      proposal: null,
    });
    expect(body.items[2].proposal).toMatchObject({
      kind: 'part_of', from: 'Sample Startup 02', to: 'Sample Holdings',
      from_match: { name: 'Sample Startup 02' }, to_match: null, source_url: 'https://example.org/seed',
    });
  });

  it('publishes an approved organisation, records who decided, and can undo it', async () => {
    const [item] = (await queue()).items;
    const org = item.organisation.id;
    expect((await app.inject({ url: `/orgs/${org}`, headers: reviewer })).statusCode).toBe(404);

    const approved = await post(`/review/items/${item.id}/approve`, reviewer);
    expect(approved.statusCode).toBe(200);
    expect(approved.json()).toMatchObject({ status: 'approved', reviewed_by: 'reviewer@example.org', organisation: { status: 'published' } });
    try {
      expect((await app.inject({ url: `/orgs/${org}`, headers: reviewer })).json().last_verified_at).toBeTruthy();
      expect((await queue()).pending).toBe(2);
      expect((await queue('settled')).items[0]).toMatchObject({ id: item.id, status: 'approved' });
      // Settled once: a second decision is refused.
      expect((await post(`/review/items/${item.id}/reject`, reviewer)).statusCode).toBe(409);
    } finally {
      const reopened = await post(`/review/items/${item.id}/reopen`, reviewer);
      expect(reopened.json()).toMatchObject({ status: 'pending', reviewed_by: null, organisation: { status: 'draft' } });
    }
    expect((await app.inject({ url: `/orgs/${org}`, headers: reviewer })).statusCode).toBe(404);
    const log = await sql`
      select field, previous_value, new_value, u.email from audit_log a join app_user u on u.id = a.actor
      where a.record_type = 'organisation' and a.record_id = ${org} order by a.id`;
    expect(log.map((row) => [row.previous_value, row.new_value, row.email])).toEqual([
      ['draft', 'published', 'reviewer@example.org'],
      ['published', 'draft', 'reviewer@example.org'],
    ]);
    await sql`delete from audit_log where record_id in (${org}, ${item.id})`;
    await sql`update field_source set verified_at = null where record_id = ${org}`;
  });

  it('keeps a rejected item out, with the reviewer’s note, until it is reopened', async () => {
    const item = (await queue()).items[1];
    const rejected = await post(`/review/items/${item.id}/reject`, reviewer, { note: 'Could not confirm it trades' });
    expect(rejected.json()).toMatchObject({ status: 'rejected', note: 'Could not confirm it trades', organisation: { status: 'draft' } });
    try {
      expect((await queue()).pending).toBe(2);
    } finally {
      await post(`/review/items/${item.id}/reopen`, reviewer);
    }
    expect((await queue()).items[1]).toMatchObject({ id: item.id, status: 'pending', note: null });
    await sql`delete from audit_log where record_id = ${item.id}`;
  });

  it('sets an incomplete record aside in an archive of its own, until it is reopened', async () => {
    const item = (await queue()).items[0];
    const archived = await post(`/review/items/${item.id}/archive`, reviewer, { note: 'No address or website yet' });
    expect(archived.statusCode).toBe(200);
    expect(archived.json()).toMatchObject({
      status: 'archived', note: 'No address or website yet', reviewed_by: 'reviewer@example.org', organisation: { status: 'draft' },
    });
    try {
      // Out of the waiting list, not among the decisions, and still not published.
      expect(await queue()).toMatchObject({ pending: 2, archived: 1, settled: 0 });
      expect((await queue('archived')).items.map((entry: any) => entry.id)).toEqual([item.id]);
      expect((await queue('settled')).items).toEqual([]);
      expect((await app.inject({ url: `/orgs/${item.organisation.id}`, headers: reviewer })).statusCode).toBe(404);
      expect((await post(`/review/items/${item.id}/approve`, reviewer)).statusCode).toBe(409);
      expect((await post(`/review/items/${item.id}/archive`, as('viewer-token'))).statusCode).toBe(403);
    } finally {
      expect((await post(`/review/items/${item.id}/reopen`, reviewer)).json()).toMatchObject({ status: 'pending', note: null });
    }
    expect(await queue()).toMatchObject({ pending: 3, archived: 0 });
    const log = await sql`select previous_value, new_value from audit_log where record_id = ${item.id} order by id`;
    expect(log.map((row) => [row.previous_value, row.new_value])).toEqual([['pending', 'archived'], ['archived', 'pending']]);
    await sql`delete from audit_log where record_id = ${item.id}`;
  });

  it('publishes a proposed relationship only once both organisations are known', async () => {
    const item = (await queue()).items[2];
    const blocked = await post(`/review/items/${item.id}/approve`, reviewer);
    expect(blocked.statusCode).toBe(422);
    expect(blocked.json().error).toBe('Choose the record for Sample Holdings, or reject the item');

    const [fund] = await sql`select id from organisation where slug = 'sample-fund-03'`;
    const [draft] = await sql`select id from organisation where slug = 'sample-draft-01'`;
    const [startup] = await sql`select id from organisation where slug = 'sample-startup-02'`;
    // A draft cannot stand in for the missing organisation, nor can the same one on both sides.
    expect((await post(`/review/items/${item.id}/approve`, reviewer, { to_id: draft!.id })).statusCode).toBe(422);
    expect((await post(`/review/items/${item.id}/approve`, reviewer, { to_id: startup!.id })).statusCode).toBe(422);

    const approved = await post(`/review/items/${item.id}/approve`, reviewer, { to_id: fund!.id });
    expect(approved.statusCode).toBe(200);
    try {
      expect(approved.json()).toMatchObject({ status: 'approved', kind: 'relationship' });
      const graph = (await app.inject({ url: `/graph/neighbourhood?id=${fund!.id}`, headers: reviewer })).json();
      expect(graph.edges).toHaveLength(1);
      expect(graph.edges[0]).toMatchObject({
        kind: 'part_of', source: `org:${startup!.id}`,
        evidence: [{ source_url: 'https://example.org/seed', quote: 'Sample Startup 02 is part of Sample Holdings.' }],
      });
    } finally {
      // Put the sample back as it was: the link gone and the item waiting again.
      const [row] = await sql`select record_id from review_item where id = ${item.id}`;
      await sql`delete from field_source where record_id = ${row!.record_id}`;
      await sql`delete from audit_log where record_id = ${row!.record_id}`;
      await sql`delete from organisation_link where id = ${row!.record_id}`;
      await sql`
        update review_item set record_id = null, status = 'pending', reviewed_by = null, reviewed_at = null,
          payload = payload - 'from_id' - 'to_id' where id = ${item.id}`;
    }
    expect((await queue()).pending).toBe(3);
  });
});

describe('saved views', () => {
  const view = { name: 'Fintech in Nairobi', page: 'map', state: 'v=1&fs=fintech' };

  it('belong to the signed-in user, and to nobody else', async () => {
    expect((await app.inject({ url: '/me/saved', headers: { 'x-access-key': 'the-key' } })).statusCode).toBe(401);
    const saved = await post('/me/saved', reviewer, view);
    expect(saved.statusCode).toBe(200);
    const { id } = saved.json();
    try {
      expect((await app.inject({ url: '/me/saved', headers: reviewer })).json().views).toEqual([
        { id, ...view, created_at: expect.any(String) },
      ]);
      // The viewer sees none of it, and cannot remove it.
      expect((await app.inject({ url: '/me/saved', headers: as('viewer-token') })).json().views).toEqual([]);
      const theft = await app.inject({ method: 'DELETE', url: `/me/saved/${id}`, headers: as('viewer-token') });
      expect(theft.json()).toEqual({ removed: false });
      expect((await post('/me/saved', reviewer, { ...view, name: '   ' })).statusCode).toBe(422);
      expect((await post('/me/saved', reviewer, { ...view, page: 'review' })).statusCode).toBe(400);
    } finally {
      const gone = await app.inject({ method: 'DELETE', url: `/me/saved/${id}`, headers: reviewer });
      expect(gone.json()).toEqual({ removed: true });
    }
    expect((await app.inject({ url: '/me/saved', headers: reviewer })).json().views).toEqual([]);
  });
});

describe('GET /notifications', () => {
  it('lists what was published since a time, newest first, and never drafts', async () => {
    const all = (await app.inject({ url: '/notifications?since=2000-01-01T00:00:00Z', headers: as('viewer-token') })).json();
    const [counts] = await sql`
      select (select count(*) from organisation where status = 'published')::int
           + (select count(*) from funding_round where status = 'published')::int as total`;
    expect(all.total).toBe(counts!.total);
    expect(all.items).toHaveLength(20);
    expect(all.items.some((item: any) => item.label.startsWith('Sample Draft'))).toBe(false);
    const times = all.items.map((item: any) => item.at);
    expect(times).toEqual([...times].sort().reverse());

    const none = (await app.inject({ url: '/notifications?since=2999-01-01T00:00:00Z', headers: as('viewer-token') })).json();
    expect(none).toEqual({ total: 0, items: [], waiting_review: null });
  });

  it('tells reviewers how much is waiting, and nobody else', async () => {
    expect((await app.inject({ url: '/notifications', headers: reviewer })).json().waiting_review).toBe(3);
    expect((await app.inject({ url: '/notifications', headers: as('viewer-token') })).json().waiting_review).toBeNull();
    expect((await app.inject({ url: '/notifications', headers: { 'x-access-key': 'the-key' } })).json().waiting_review).toBeNull();
  });
});

describe('taking a relationship down for everyone', () => {
  const orgId = async (slug: string) => (await sql`select id from organisation where slug = ${slug}`)[0]!.id as string;

  it('leaves it out of the graph and the cards until it is put back', async () => {
    const fund = await orgId('sample-fund-01');
    const startup = await orgId('sample-startup-05');
    const edge = { kind: 'invested_in', source: fund, target: startup };
    const key = { 'x-access-key': 'the-key' };
    const portfolio = async () => (await app.inject({ url: `/orgs/${fund}`, headers: key })).json().connections.portfolio.length;
    const investors = async () => (await app.inject({ url: `/orgs/${startup}`, headers: key })).json().connections.investors.length;
    const drawn = async () => (await app.inject({ url: `/graph/neighbourhood?id=org:${fund}`, headers: key })).json().edges.length;
    expect([await portfolio(), await investors(), await drawn()]).toEqual([6, 1, 6]);

    try {
      // Not for a viewer, not without a reason, and not for a relationship nobody has on record.
      expect((await post('/review/withdrawn', as('viewer-token'), { ...edge, reason: 'x' })).statusCode).toBe(403);
      expect((await post('/review/withdrawn', reviewer, { ...edge, reason: '' })).statusCode).toBe(400);
      expect((await post('/review/withdrawn', reviewer, { ...edge, source: startup, target: fund, reason: 'x' })).statusCode).toBe(404);

      const taken = await post('/review/withdrawn', reviewer, { ...edge, reason: 'The source was about another company.' });
      expect(taken.statusCode).toBe(200);
      expect(taken.json().withdrawn).toEqual([
        expect.objectContaining({ kind: 'invested_in', reason: 'The source was about another company.', withdrawn_by: 'reviewer@example.org', source: { id: fund, name: 'Sample Fund 01' } }),
      ]);
      expect([await portfolio(), await investors(), await drawn()]).toEqual([5, 0, 5]);
      // The tables count it the same way.
      const rows = (await app.inject({ url: '/orgs', headers: key })).json().organisations;
      expect(rows.find((row: any) => row.id === fund).portfolio).toBe(5);
      expect(rows.find((row: any) => row.id === startup)).toMatchObject({ investors: 0, rounds: 1 });
      expect((await post('/review/withdrawn', reviewer, { ...edge, reason: 'again' })).statusCode).toBe(409);
      // The round it was read from is still on record.
      expect((await app.inject({ url: `/orgs/${startup}`, headers: key })).json().rounds).toHaveLength(1);

      const back = await post('/review/withdrawn/restore', reviewer, edge);
      expect(back.json().withdrawn).toEqual([]);
      expect([await portfolio(), await investors(), await drawn()]).toEqual([6, 1, 6]);
      expect((await post('/review/withdrawn/restore', reviewer, edge)).statusCode).toBe(404);
      const [log] = await sql`select count(*)::int as entries from audit_log where record_type = 'relationship' and record_id = ${fund}`;
      expect(log!.entries).toBe(2);
    } finally {
      await sql`delete from withdrawn_edge where source_org = ${fund}`;
      await sql`delete from audit_log where record_type = 'relationship' and record_id = ${fund}`;
    }
  });
});

describe('a funding round read from the news', () => {
  const news = (changes: object = {}) => ({
    import: 'news', news: true, extractor: 'rules', publisher: 'test-feed',
    url: 'https://news.test/sample-startup-07-raises', title: 'Sample Startup 07 raises $2.5 million seed round',
    published: '2026-10-06',
    company: { value: 'Sample Startup 07', quote: 'Sample Startup 07' },
    amount: { value: 2500000, quote: '$2.5 million' }, currency: { value: 'USD', quote: '$2.5 million' },
    stage: { value: 'pre-series a', quote: 'pre-Series A' },
    investors: [{ value: 'Sample Fund 02', quote: 'Sample Fund 02' }, { value: 'Unknown Capital', quote: 'Unknown Capital' }],
    ...changes,
  });
  const add = async (payload: object) =>
    (await sql`
      insert into review_item (record_type, payload, method, status, reason)
      values ('funding_round', ${sql.json(payload as never)}, 'ai', 'pending', 'Read from a news report') returning id`)[0]!.id as string;
  const clear = async () => {
    await sql`delete from field_source where source_url like 'https://news.test/%'`;
    await sql`delete from funding_round where id in (select record_id from review_item where payload->>'import' = 'news' and payload->>'url' like 'https://news.test/%')`;
    await sql`delete from review_item where payload->>'import' = 'news' and payload->>'url' like 'https://news.test/%'`;
  };

  it('waits with the record each name finds, and becomes a round only when approved', async () => {
    try {
      const id = await add(news());
      const item = (await queue()).items.find((entry: any) => entry.id === id);
      expect(item.kind).toBe('round');
      expect(item.round).toMatchObject({
        company: 'Sample Startup 07', amount: 2500000, currency: 'USD', stage: 'pre-series-a', announced_on: '2026-10-06',
        source_url: 'https://news.test/sample-startup-07-raises', duplicate: false,
      });
      expect(item.round.company_match.name).toBe('Sample Startup 07');
      expect(item.round.investors.map((investor: any) => [investor.name, investor.match?.name ?? null])).toEqual([
        ['Sample Fund 02', 'Sample Fund 02'], ['Unknown Capital', null],
      ]);
      const company = item.round.company_match.id;
      const key = { 'x-access-key': 'the-key' };
      const before = (await app.inject({ url: `/orgs/${company}`, headers: key })).json();
      expect(before.rounds).toHaveLength(0);

      expect((await post(`/review/items/${id}/approve`, as('viewer-token'))).statusCode).toBe(403);
      const approved = await post(`/review/items/${id}/approve`, reviewer);
      expect(approved.statusCode).toBe(200);
      expect(approved.json().status).toBe('approved');
      const after = (await app.inject({ url: `/orgs/${company}`, headers: key })).json();
      expect(after.rounds).toEqual([expect.objectContaining({ stage: 'pre-series-a', amount_usd: 2500000, announced_on: '2026-10-06', announced_precision: 'day' })]);
      // The investor on record is linked; the one nobody has on record is kept by name, not created.
      expect(after.connections.investors.map((investor: any) => investor.name)).toEqual(['Sample Fund 02']);
      const [source] = await sql`
        select s.method::text as method, s.quote from field_source s
        where s.record_type = 'funding_round' and s.source_url = 'https://news.test/sample-startup-07-raises'`;
      expect(source).toMatchObject({ method: 'ai', quote: 'Sample Startup 07 … $2.5 million … pre-Series A' });
      const [kept] = await sql`select payload->'investors_not_linked' as names from review_item where id = ${id}`;
      expect(kept!.names).toEqual(['Unknown Capital']);
      expect((await post(`/review/items/${id}/approve`, reviewer)).statusCode).toBe(409);

      // The same report read again would repeat the round now on record, and says so.
      const again = await add(news());
      expect((await queue()).items.find((entry: any) => entry.id === again).round.duplicate).toBe(true);
    } finally {
      await clear();
    }
  });

  it('cannot be approved until the company is a record on file', async () => {
    try {
      const id = await add(news({ company: { value: 'Nobody Knows Ltd', quote: 'Nobody Knows Ltd' } }));
      expect((await queue()).items.find((entry: any) => entry.id === id).round.company_match).toBeNull();
      const refused = await post(`/review/items/${id}/approve`, reviewer);
      expect(refused.statusCode).toBe(422);
      expect(refused.json().error).toContain('Choose the record for Nobody Knows Ltd');
      // The reviewer says which record it means, and it goes ahead.
      const [fund] = await sql`select id from organisation where slug = 'sample-startup-08'`;
      expect((await post(`/review/items/${id}/approve`, reviewer, { from_id: fund!.id })).statusCode).toBe(200);
      const [round] = await sql`select count(*)::int as rounds from funding_round where organisation_id = ${fund!.id} and stage = 'pre-series-a'`;
      expect(round!.rounds).toBe(1);
    } finally {
      await clear();
    }
  });
});

