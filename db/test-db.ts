import { spawnSync } from 'node:child_process';
import postgres from 'postgres';

// Builds the database the automated tests run against: created if missing,
// migrated, and filled with the synthetic sample. The working database, which
// holds real records, is never touched.
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL is not set');
const target = new URL(url);
const name = target.pathname.slice(1);
if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`Unusable test database name: ${name}`);
if (url === process.env.DATABASE_URL)
  throw new Error('TEST_DATABASE_URL must not be the working database');

const admin = new URL(url);
admin.pathname = '/postgres';
const sql = postgres(admin.href, { onnotice: () => {} });
try {
  const [found] = await sql`select 1 from pg_database where datname = ${name}`;
  if (!found) {
    await sql.unsafe(`create database ${name}`);
    console.log(`created database ${name}`);
  }
} finally {
  await sql.end();
}

for (const script of ['migrate.ts', 'seed.ts']) {
  const run = spawnSync('tsx', [script], {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: url },
  });
  if (run.status !== 0) process.exit(run.status ?? 1);
}
