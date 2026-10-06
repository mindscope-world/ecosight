import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

// Seeding truncates tables, so it only runs against a local database unless forced.
const dir = fileURLToPath(new URL('./seed/', import.meta.url));
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1'].includes(host) && process.env.ATLAS_ALLOW_SEED !== '1')
  throw new Error(`Refusing to seed non-local database at ${host}`);

const sql = postgres(url, { onnotice: () => {} });
try {
  for (const name of (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()) {
    await sql.unsafe(await readFile(dir + name, 'utf8'));
    console.log(`seeded ${name}`);
  }
} finally {
  await sql.end();
}
