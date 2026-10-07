import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Applies the migrations to a Supabase project through its management API, for
// when there is an access token but no database password to connect with. It
// keeps the same record of what has been applied as the local runner.
const token = process.env.SUPABASE_ACCESS_TOKEN;
const project = /^https?:\/\/([^.]+)\./.exec(process.env.SUPABASE_URL ?? '')?.[1];
if (!token || !project) throw new Error('Set SUPABASE_URL and SUPABASE_ACCESS_TOKEN');

export async function runSql<T = Record<string, unknown>>(query: string): Promise<T[]> {
  const res = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`SQL failed (${res.status}): ${body.slice(0, 500)}`);
  return body ? (JSON.parse(body) as T[]) : [];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // A file given on the command line is run as it is; otherwise the migrations are applied.
  const extra = process.argv[2];
  if (extra) {
    await runSql(await readFile(extra, 'utf8'));
    console.log(`ran ${extra}`);
  } else {
    const dir = fileURLToPath(new URL('./migrations/', import.meta.url));
    await runSql(`create table if not exists schema_migration (
      name text primary key, applied_at timestamptz not null default now())`);
    const applied = new Set((await runSql<{ name: string }>('select name from schema_migration')).map((r) => r.name));
    for (const name of (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()) {
      if (applied.has(name)) continue;
      const body = await readFile(dir + name, 'utf8');
      // One request is one transaction, so a migration is applied whole or not at all.
      await runSql(`begin;\n${body}\ninsert into schema_migration (name) values ('${name.replace(/'/g, "''")}');\ncommit;`);
      console.log(`applied ${name}`);
    }
  }
}
