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
