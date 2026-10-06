import cors from '@fastify/cors';
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

export async function buildApp({ sql, logger = false }: { sql: Sql; logger?: boolean }) {
  const app = Fastify({ logger }).withTypeProvider<TypeBoxTypeProvider>();

  await app.register(cors, { origin: true });
  // Route schemas are the single source for the OpenAPI document.
  await app.register(swagger, {
    openapi: { info: { title: 'Capital Atlas API', version: '0.1.0' } },
  });

  app.get('/health', { schema: { hide: true } }, async () => {
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
