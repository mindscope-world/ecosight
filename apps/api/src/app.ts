import { timingSafeEqual } from 'node:crypto';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import Fastify from 'fastify';
import type { Sql } from './db.js';
import { eventRoutes } from './routes/events.js';
import { graphRoutes } from './routes/graph.js';
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
  /**
   * When set, every request must carry this key in an `x-access-key` header. The
   * data may not be published, so a deployed API is never open to the public.
   */
  accessKey?: string;
}

/** Search and graph queries cost more than a lookup, so each client gets a quarter of the general allowance for each. */
export const SEARCH_SHARE = 4;

export async function buildApp({ sql, logger = false, rateLimit: limit = false, corsOrigins, trustProxy = false, accessKey }: AppOptions) {
  const app = Fastify({ logger, trustProxy }).withTypeProvider<TypeBoxTypeProvider>();

  await app.register(cors, { origin: corsOrigins?.length ? corsOrigins : true });
  if (limit !== false) {
    await app.register(rateLimit, { max: limit, timeWindow: '1 minute' });
    app.decorate('searchLimit', Math.max(1, Math.floor(limit / SEARCH_SHARE)));
  }
  if (accessKey) {
    const expected = Buffer.from(accessKey);
    app.addHook('onRequest', async (request, reply) => {
      // The health check stays open for uptime probes, and browsers send OPTIONS without headers.
      if (request.method === 'OPTIONS' || request.url.split('?')[0] === '/health') return;
      const given = Buffer.from(String(request.headers['x-access-key'] ?? ''));
      // Compared in constant time, so the key cannot be guessed a character at a time.
      if (given.length !== expected.length || !timingSafeEqual(given, expected))
        return reply.code(401).send({ error: 'An access key is required' });
    });
    // Routes mark their answers as publicly cacheable, which is right for an open
    // API and wrong for a closed one: a browser or a proxy would hand a stored
    // answer to the next visitor without asking for the key.
    app.addHook('onSend', async (_request, reply) => {
      reply.header('cache-control', 'private, no-store');
    });
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
  await app.register(graphRoutes, { sql });

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;

declare module 'fastify' {
  interface FastifyInstance {
    /** Per-minute allowance for search, and for graph queries, present only when limiting is on. */
    searchLimit?: number;
  }
}
