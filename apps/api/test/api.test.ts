import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../src/app.js';
import { buildLayers } from '../src/build-layers.js';
import { connect, withFund, type Sql } from '../src/db.js';
import { parseQuery } from '../src/routes/search.js';

// Runs against the seeded test database (pnpm db:up && pnpm db:test).
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
    expect(body.features).toHaveLength(58);
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

describe('events', () => {
  it('lists upcoming published events and serves their detail', async () => {
    const layer = (await app.inject('/layers/events.geojson')).json();
    expect(layer.features).toHaveLength(6);
    const id = layer.features[0].properties.event_id;
    const res = await app.inject(`/events/${id}`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id, name: 'Sample Meetup 01', city: 'Nairobi', organiser: { name: 'Sample Accelerator 01' } });
  });

  it('hides events that are over or not published', async () => {
    const [event] = await sql`select id from event where name = 'Sample Meetup 02'`;
    await sql`update event set status = 'draft' where id = ${event!.id}`;
    try {
      expect((await app.inject('/layers/events.geojson')).json().features).toHaveLength(5);
      expect((await app.inject(`/events/${event!.id}`)).statusCode).toBe(404);
    } finally {
      await sql`update event set status = 'published' where id = ${event!.id}`;
    }
  });
});

describe('GET /rounds/:id', () => {
  it('returns the round with its company and lead investor', async () => {
    const [round] = await sql`
      select r.id from funding_round r join organisation g on g.id = r.organisation_id
      where g.slug = 'sample-startup-10'`;
    const res = await app.inject(`/rounds/${round!.id}`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      organisation: { name: 'Sample Startup 10' },
      amount_usd: 1000000,
      currency: 'USD',
      announced_precision: 'day',
      investors: [{ name: 'Sample Fund 01', is_lead: true }],
    });
  });

  it('gives each organisation its neighbours in the graph', async () => {
    const id = async (slug: string) => (await sql`select id from organisation where slug = ${slug}`)[0]!.id;
    const startup = (await app.inject(`/orgs/${await id('sample-startup-10')}`)).json();
    expect(startup).toMatchObject({ raised_usd: 1_000_000, is_active: false });
    expect(startup.connections.investors).toEqual([expect.objectContaining({ name: 'Sample Fund 01' })]);

    const fund = (await app.inject(`/orgs/${await id('sample-fund-01')}`)).json();
    expect(fund.connections.portfolio).toHaveLength(6);

    const accelerator = (await app.inject(`/orgs/${await id('sample-accelerator-01')}`)).json();
    expect(accelerator.connections.programs.map((p: any) => p.organisation.name)).toEqual([
      'Sample Startup 01', 'Sample Startup 02',
    ]);
    expect(accelerator.connections.events).toEqual([expect.objectContaining({ name: 'Sample Meetup 01' })]);

    const first = (await app.inject(`/orgs/${await id('sample-startup-01')}`)).json();
    expect(first.connections.people).toEqual([{ name: 'Sample Founder', role: 'Co-founder' }]);
    expect(first.connections.programs[0].organisation.name).toBe('Sample Accelerator 01');
    expect(first.founded_year).toBeGreaterThan(2009);
  });

  it('is linked from the organisation card', async () => {
    const [org] = await sql`select id from organisation where slug = 'sample-startup-10'`;
    const body = (await app.inject(`/orgs/${org!.id}`)).json();
    expect(body.rounds).toHaveLength(1);
    expect((await app.inject(`/rounds/${body.rounds[0].id}`)).statusCode).toBe(200);
  });
});

describe('GET /search', () => {
  const names = async (q: string) =>
    (await app.inject(`/search?q=${encodeURIComponent(q)}`))
      .json()
      .organisations.map((r: any) => r.name);

  it('finds an organisation by exact name, with a place to fly to', async () => {
    const body = (await app.inject('/search?q=Sample%20Fund%2003')).json();
    expect(body.organisations[0]).toMatchObject({ name: 'Sample Fund 03', city: 'Nairobi' });
    expect(body.organisations[0].lon).toBeCloseTo(36.8, 0);
  });

  it('tolerates typos and partial words', async () => {
    expect((await names('Sampel Acelerator'))[0]).toMatch(/^Sample Accelerator/);
    expect(await names('accel')).toContain('Sample Accelerator 01');
  });

  it('matches sectors and respects the limit', async () => {
    const res = (await app.inject('/search?q=agritech&limit=3')).json();
    expect(res.organisations).toHaveLength(3);
    expect(res.sectors).toEqual([{ sector: 'agritech', organisations: 10 }]);
  });

  it('reads type, sector and city words in a query', async () => {
    expect(parseQuery('Fintech investors in Nairobi', ['fintech'], ['Nairobi'])).toEqual({
      type: 'fund', sector: 'fintech', city: 'Nairobi', text: '',
    });
    expect(parseQuery('sample pay', ['fintech'], ['Nairobi'])).toMatchObject({ type: null, text: 'sample pay' });

    const body = (await app.inject('/search?q=fintech%20investors%20in%20nairobi&limit=20')).json();
    expect(body.understood).toEqual({ type: 'fund', sector: 'fintech', city: 'Nairobi' });
    expect(body.organisations.length).toBeGreaterThan(0);
    expect(body.organisations.every((r: any) => r.types.includes('fund') && r.sector === 'fintech')).toBe(true);
    expect(body.locations[0]).toMatchObject({ city: 'Nairobi', country: 'KE', organisations: 48 });
  });

  it('finds events by name', async () => {
    const body = (await app.inject('/search?q=meetup')).json();
    expect(body.events).toHaveLength(5);
    expect(body.events[0].name).toBe('Sample Meetup 01');
  });

  it('leaves out drafts and rejects one-letter queries', async () => {
    const [org] = await sql`select id from organisation where slug = 'sample-ngo-01'`;
    await sql`update organisation set status = 'draft' where id = ${org!.id}`;
    try {
      expect(await names('Sample NGO 01')).not.toContain('Sample NGO 01');
    } finally {
      await sql`update organisation set status = 'published' where id = ${org!.id}`;
    }
    expect((await app.inject('/search?q=a')).statusCode).toBe(400);
  });
});

describe('city-precision offices', () => {
  it('stores angel networks at the city centroid with no address', async () => {
    const [org] = await sql`select id from organisation where slug = 'sample-angel-network-01'`;
    const [office] = (await app.inject(`/orgs/${org!.id}`)).json().offices;
    expect(office).toMatchObject({ precision: 'city', address: null });
    expect(office.lon).toBeCloseTo(36.8219, 4);
    expect(office.lat).toBeCloseTo(-1.2921, 4);
  });

  it('refuses a city-precision office in a city with no centroid', async () => {
    const [org] = await sql`select id from organisation where slug = 'sample-angel-network-01'`;
    await expect(sql`
      insert into office (organisation_id, city, country, geom)
      values (${org!.id}, 'Mombasa', 'KE', st_setsrid(st_makepoint(39.66, -4.04), 4326)::geography)
    `).rejects.toThrow(/No centroid/);
  });
});

describe('private fund rows', () => {
  it('lets a fund read and write only its own rows', async () => {
    const funds = await sql`select id from organisation where 'fund' = any(types) order by slug limit 2`;
    const [startup] = await sql`select id from organisation where slug = 'sample-startup-01'`;
    const [a, b] = [funds[0]!.id as string, funds[1]!.id as string];
    try {
      await withFund(sql, a, (tx) => tx`
        insert into fund_private_pipeline (fund_id, organisation_id) values (${a}, ${startup!.id})`);

      expect(await withFund(sql, a, (tx) => tx`select 1 from fund_private_pipeline`)).toHaveLength(1);
      expect(await withFund(sql, b, (tx) => tx`select 1 from fund_private_pipeline`)).toHaveLength(0);
      // Writing a row for another fund is refused, not silently re-labelled.
      await expect(
        withFund(sql, b, (tx) => tx`
          insert into fund_private_pipeline (fund_id, organisation_id) values (${a}, ${startup!.id})`),
      ).rejects.toThrow(/row-level security/);
      // The fund setting must not outlive its transaction on a pooled connection.
      await sql.begin(async (tx) => {
        await tx`set local role atlas_app`;
        expect(await tx`select 1 from fund_private_pipeline`).toHaveLength(0);
      });
    } finally {
      await sql`delete from fund_private_pipeline where fund_id = ${a}`;
    }
  });
});

describe('GET /stats', () => {
  it('totals published records for the dashboard', async () => {
    const body = (await app.inject('/stats')).json();
    expect(body).toMatchObject({
      organisations: 48,
      offices: 58,
      upcoming_events: 6,
      rounds: 6,
      raised_usd: 10_500_000,
      countries: 1,
      activity: { startups_added: { current: 30, previous: 0 }, events_next_30_days: 4 },
    });
    expect(body.cities).toEqual([
      expect.objectContaining({ city: 'Nairobi', country: 'KE', organisations: 48, score: 100 }),
    ]);
    expect(body.funding_by_month).toHaveLength(12);
    expect(body.recent).toHaveLength(8);
    expect(body.last_updated).toBeTruthy();
    expect(body.by_type[0]).toEqual({ type: 'startup', count: 30 });
    expect(body.top_sectors.length).toBeLessThanOrEqual(8);
    expect(body.recent_rounds[0]).toMatchObject({ name: 'Sample Startup 30', amount_usd: 3_000_000 });
  });
});

describe('rate limits', () => {
  it('turn a client away past its allowance, search sooner, and never the health check', async () => {
    const limited = await buildApp({ sql, rateLimit: 8 });
    try {
      const codes = async (path: string, times: number) => {
        const seen: number[] = [];
        for (let i = 0; i < times; i++) seen.push((await limited.inject(path)).statusCode);
        return seen;
      };
      // Search has a quarter of the allowance: 2 of 8.
      expect(await codes('/search?q=sample', 3)).toEqual([200, 200, 429]);
      expect(await codes('/stats', 9)).toEqual([...Array(8).fill(200), 429]);
      expect(await codes('/health', 12)).toEqual(Array(12).fill(200));
    } finally {
      await limited.close();
    }
  });
});

describe('static layer build', () => {
  it('writes the same data the API serves', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'layers-'));
    const sizes = await buildLayers(sql, dir);
    expect((await readdir(dir)).sort()).toEqual(['events.geojson', 'manifest.json', 'offices.geojson', 'stats.json']);
    expect(Object.keys(sizes)).toHaveLength(4);

    const offices = JSON.parse(await readFile(join(dir, 'offices.geojson'), 'utf8'));
    expect(offices).toEqual((await app.inject('/layers/offices.geojson')).json());
    expect(JSON.parse(await readFile(join(dir, 'stats.json'), 'utf8')).organisations).toBe(48);
    expect(JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')).built_at).toMatch(/^20\d\d-/);
  });
});

describe('GET /openapi.json', () => {
  it('documents the public routes', async () => {
    const doc = (await app.inject('/openapi.json')).json();
    expect(Object.keys(doc.paths).sort()).toEqual([
      '/events/{id}',
      '/layers/events.geojson',
      '/layers/offices.geojson',
      '/orgs/{id}',
      '/rounds/{id}',
      '/search',
      '/stats',
    ]);
  });
});
