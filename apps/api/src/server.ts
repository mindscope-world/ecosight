import { buildApp } from './app.js';
import { connect } from './db.js';

const sql = connect();
const app = await buildApp({
  sql,
  logger: true,
  rateLimit: Number(process.env.RATE_LIMIT_PER_MINUTE ?? 120),
  corsOrigins: process.env.CORS_ORIGINS?.split(',').map((origin) => origin.trim()).filter(Boolean),
  trustProxy: process.env.TRUST_PROXY === '1',
});
app.addHook('onClose', async () => {
  await sql.end();
});

// Hosts hand the port over as PORT; API_PORT is the local setting.
const port = Number(process.env.PORT ?? process.env.API_PORT ?? 4000);
await app.listen({ port, host: '0.0.0.0' });
