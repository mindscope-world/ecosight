import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import Fastify from 'fastify';
import type { Sql } from './db.js';
import { eventRoutes } from './routes/events.js';
import { layerRoutes } from './routes/layers.js';
import { orgRoutes } from './routes/orgs.js';
import { roundRoutes } from './routes/rounds.js';
import { searchRoutes } from './routes/search.js';
import { statsRoutes } from './routes/stats.js';

export interface AppOptions {
  sql: Sql;
  logger?: boolean;
  /** Requests allowed per client per minute; false turns limiting off (tests, build jobs). */
  rateLimit?: number | false;
  /** Sites allowed to call the API from a browser. Any site when not given, for local work. */
  corsOrigins?: string[];
  /** Set when a proxy sits in front, so the client's address is read from its headers. */
  trustProxy?: boolean;
}

/** Search costs more than a lookup, so each client gets a quarter of the general allowance. */
export const SEARCH_SHARE = 4;

export async function buildApp({ sql, logger = false, rateLimit: limit = false, corsOrigins, trustProxy = false }: AppOptions) {
  const app = Fastify({ logger, trustProxy }).withTypeProvider<TypeBoxTypeProvider>();

  await app.register(cors, { origin: corsOrigins?.length ? corsOrigins : true });
  if (limit !== false) {
    await app.register(rateLimit, { max: limit, timeWindow: '1 minute' });
    app.decorate('searchLimit', Math.max(1, Math.floor(limit / SEARCH_SHARE)));
  }
  // Route schemas are the single source for the OpenAPI document.
  await app.register(swagger, {
    openapi: { info: { title: 'ecoSight API', version: '0.1.0' } },
  });

  // Not limited: uptime checks and the host's own health probes call this constantly.
  app.get('/health', { schema: { hide: true }, config: { rateLimit: false } }, async () => {
    await sql`select 1`;
    return { ok: true };
  });
  app.get('/openapi.json', { schema: { hide: true } }, async () => app.swagger());

  await app.register(layerRoutes, { sql });
  await app.register(orgRoutes, { sql });
  await app.register(eventRoutes, { sql });
  await app.register(roundRoutes, { sql });
  await app.register(searchRoutes, { sql });
  await app.register(statsRoutes, { sql });

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;

declare module 'fastify' {
  interface FastifyInstance {
    /** Per-minute allowance for search, present only when limiting is on. */
    searchLimit?: number;
  }
}
