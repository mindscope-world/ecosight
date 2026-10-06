import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

// Forward-only SQL migrations, applied in filename order, one transaction each.
const dir = fileURLToPath(new URL('./migrations/', import.meta.url));
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');

const sql = postgres(url, { onnotice: () => {} });
try {
  await sql`create table if not exists schema_migration (
    name text primary key,
    applied_at timestamptz not null default now()
  )`;
  const applied = new Set(
    (await sql<{ name: string }[]>`select name from schema_migration`).map((r) => r.name),
  );
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  for (const name of files) {
    if (applied.has(name)) continue;
    const body = await readFile(dir + name, 'utf8');
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`insert into schema_migration (name) values (${name})`;
    });
    console.log(`applied ${name}`);
  }
} finally {
  await sql.end();
}
