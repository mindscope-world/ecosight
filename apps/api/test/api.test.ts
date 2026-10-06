import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../src/app.js';
import { connect, type Sql } from '../src/db.js';

// Runs against the seeded local database (pnpm db:up && db:migrate && db:seed).
let sql: Sql;
let app: App;

beforeAll(async () => {
  sql = connect();
  app = await buildApp({ sql });
});
afterAll(async () => {
  await app.close();
  await sql.end();
});

describe('GET /layers/offices.geojson', () => {
  it('returns every current office of published organisations', async () => {
    const res = await app.inject('/layers/offices.geojson');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.type).toBe('FeatureCollection');
    expect(body.features).toHaveLength(56);
    expect(body.features[0].geometry.type).toBe('Point');
  });

  it('filters by organisation type', async () => {
    const body = (await app.inject('/layers/offices.geojson?type=fund')).json();
    expect(body.features).toHaveLength(8);
    expect(body.features.every((f: any) => f.properties.primary_type === 'fund')).toBe(true);
  });

  it('rejects an unknown type', async () => {
    expect((await app.inject('/layers/offices.geojson?type=bank')).statusCode).toBe(400);
  });

  it('leaves out draft organisations', async () => {
    const [org] = await sql`select id from organisation where slug = 'sample-fund-01'`;
    await sql`update organisation set status = 'draft' where id = ${org!.id}`;
    try {
      const body = (await app.inject('/layers/offices.geojson?type=fund')).json();
      expect(body.features).toHaveLength(7);
      expect((await app.inject(`/orgs/${org!.id}`)).statusCode).toBe(404);
    } finally {
      await sql`update organisation set status = 'published' where id = ${org!.id}`;
    }
  });
});

describe('GET /orgs/:id', () => {
  it('returns offices, sources and the last verified date', async () => {
    const [org] = await sql`select id from organisation where slug = 'sample-startup-03'`;
    const res = await app.inject(`/orgs/${org!.id}`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.name).toBe('Sample Startup 03');
    expect(body.types).toEqual(['startup']);
    expect(body.offices).toHaveLength(2);
    expect(body.offices[0].is_hq).toBe(true);
    expect(body.sources[0].source_url).toBe('https://example.org/seed');
    expect(body.last_verified_at).toBeTruthy();
  });

  it('returns 404 for an unknown id and 400 for a malformed one', async () => {
    const missing = await app.inject('/orgs/00000000-0000-4000-8000-000000000000');
    expect(missing.statusCode).toBe(404);
    expect((await app.inject('/orgs/not-a-uuid')).statusCode).toBe(400);
  });
});

describe('GET /openapi.json', () => {
  it('documents the public routes', async () => {
    const doc = (await app.inject('/openapi.json')).json();
    expect(Object.keys(doc.paths).sort()).toEqual(['/layers/offices.geojson', '/orgs/{id}']);
  });
});
