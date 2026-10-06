import { buildApp } from './app.js';
import { connect } from './db.js';

const sql = connect();
const app = await buildApp({ sql, logger: true });
app.addHook('onClose', async () => {
  await sql.end();
});

const port = Number(process.env.API_PORT ?? 4000);
await app.listen({ port, host: '0.0.0.0' });
