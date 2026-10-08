import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

// Takes a backup: a dump of the database, and an archive of the files that are
// kept out of git and so exist nowhere else. Each backup is written whole or not
// at all, comes with a checksum and a record of how many rows each table held,
// and old ones are cleared away. `restore-check.ts` proves a dump can be restored.
//
//   pnpm db:backup           the hosted database (SUPABASE_DB_URL), and the files
//   pnpm db:backup --local   the local database (DATABASE_URL) instead
//
// BACKUP_DIR says where backups go (default data/backups) and BACKUP_KEEP how
// many of each kind are kept (default 14). BACKUP_COPY_DIR, when set, is a second
// place each backup is copied to: another disk, or a folder that is synced
// elsewhere. The files archive protects little while it sits on the same disk
// as the files, so set it.

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const local = process.argv.includes('--local');
const source = local ? process.env.DATABASE_URL : process.env.SUPABASE_DB_URL;
if (!source) throw new Error(`${local ? 'DATABASE_URL' : 'SUPABASE_DB_URL'} is not set`);
const dir = resolve(ROOT, process.env.BACKUP_DIR ?? 'data/backups');
const keep = Number(process.env.BACKUP_KEEP ?? 14);
if (!Number.isInteger(keep) || keep < 1) throw new Error('BACKUP_KEEP must be a whole number of at least 1');

// What is kept out of git: the datasets, everything curated from them, the labelled
// news items, the stored news documents and the lookups that took hours to build.
// Never `.env`: a backup that is copied about must not carry the keys.
const FILES = ['curation', 'datasets', 'eval/labelled.jsonl', 'data/raw', 'data/geocode-cache.json', 'data/fx-cache.json', 'data/profile-search-cache.json'];

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const name = local ? 'local' : 'hosted';

function run(command: string, args: string[], env: Record<string, string> = {}): string {
  const result = spawnSync(command, args, { encoding: 'utf8', env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw new Error(`${command} could not be run: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr.trim().split('\n').slice(-3).join(' ')}`);
  return result.stdout;
}

async function sha256(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

/** Rows in every table of ours, counted through the connection given. */
async function rowCounts(url: string): Promise<Record<string, number>> {
  const sql = postgres(url, { onnotice: () => {}, max: 1 });
  try {
    const tables = await sql<{ tablename: string }[]>`
      select c.relname as tablename from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
        and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
      order by 1`;
    const counts: Record<string, number> = {};
    for (const { tablename } of tables)
      counts[tablename] = Number((await sql.unsafe(`select count(*) as rows from public."${tablename}"`))[0]!.rows);
    return counts;
  } finally {
    await sql.end();
  }
}

/**
 * The same counts as the database's owner sees them, through Supabase's
 * management API. The dump is taken with the application's login, which
 * row-level security could hide rows from; this is how that would be noticed.
 */
async function ownerCounts(tables: string[]): Promise<Record<string, number> | null> {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const project = /^https?:\/\/([^.]+)\./.exec(process.env.SUPABASE_URL ?? '')?.[1];
  if (local || !token || !project || tables.length === 0) return null;
  const query = tables.map((table) => `select '${table}' as name, count(*)::int as rows from public."${table}"`).join(' union all ');
  const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!response.ok) throw new Error(`Counting rows as the owner failed (${response.status}): ${(await response.text()).slice(0, 200)}`);
  return Object.fromEntries(((await response.json()) as { name: string; rows: number }[]).map((row) => [row.name, row.rows]));
}

/** Removes all but the newest few backups of one kind. Only files this script names are touched. */
async function prune(pattern: RegExp): Promise<string[]> {
  const mine = (await readdir(dir)).filter((file) => pattern.test(file)).sort();
  const old = mine.slice(0, Math.max(0, mine.length - keep));
  for (const file of old) for (const extra of ['', '.sha256', '.json', '.verified']) await rm(resolve(dir, file + extra), { force: true });
  return old;
}

await mkdir(dir, { recursive: true });

// The database. Counted before and after the dump: if the two differ, rows were
// being written while it ran, and the manifest says so.
const before = await rowCounts(source);
const dump = resolve(dir, `ecosight-${name}-${stamp}.dump`);
run('pg_dump', [source, '--schema=public', '--format=custom', '--no-owner', '--enable-row-security', `--file=${dump}.tmp`]);
// Written under another name and renamed, so a dump that was cut short is never taken for a whole one.
await rename(`${dump}.tmp`, dump);
const after = await rowCounts(source);
const asOwner = await ownerCounts(Object.keys(after));
const hidden = asOwner ? Object.keys(asOwner).filter((table) => asOwner[table] !== after[table]) : [];
if (hidden.length) {
  await rm(dump, { force: true });
  throw new Error(`The application's login cannot see every row of: ${hidden.join(', ')}. The dump would be missing them, so none was kept.`);
}
const moved = Object.keys(after).filter((table) => before[table] !== after[table]);
const manifest = {
  taken_at: new Date().toISOString(),
  source: `${name}: ${new URL(source).host}${new URL(source).pathname}`,
  pg_dump: run('pg_dump', ['--version']).trim(),
  server: (await (async () => {
    const sql = postgres(source, { onnotice: () => {}, max: 1 });
    try {
      return (await sql`show server_version`)[0]!.server_version as string;
    } finally {
      await sql.end();
    }
  })()),
  bytes: (await stat(dump)).size,
  sha256: await sha256(dump),
  rows: after,
  rows_checked_as_owner: asOwner !== null,
  changed_during_dump: moved,
};
await writeFile(`${dump}.sha256`, `${manifest.sha256}  ${dump.split('/').pop()}\n`);
await writeFile(`${dump}.json`, JSON.stringify(manifest, null, 1) + '\n');
const total = Object.values(after).reduce((sum, rows) => sum + rows, 0);
console.log(`database: ${dump}`);
console.log(`          ${(manifest.bytes / 1024 / 1024).toFixed(1)} MB, ${Object.keys(after).length} tables, ${total} rows${asOwner ? ', counts confirmed as the owner' : ''}`);
if (moved.length) console.log(`          rows changed while it ran in: ${moved.join(', ')}`);

// The files. Only for the hosted backup's run: they are the same files either way.
if (!local) {
  const present = FILES.filter((path) => existsSync(resolve(ROOT, path)));
  const archive = resolve(dir, `ecosight-files-${stamp}.tar.gz`);
  run('tar', ['-czf', `${archive}.tmp`, '-C', ROOT, ...present]);
  await rename(`${archive}.tmp`, archive);
  await writeFile(`${archive}.sha256`, `${await sha256(archive)}  ${archive.split('/').pop()}\n`);
  console.log(`files:    ${archive}`);
  console.log(`          ${((await stat(archive)).size / 1024 / 1024).toFixed(1)} MB: ${present.join(', ')}`);
  const missing = FILES.filter((path) => !present.includes(path));
  if (missing.length) console.log(`          not there to back up: ${missing.join(', ')}`);
}

// A second copy somewhere else, when a place for one is given. A copy that cannot be made is an error:
// a run that seemed to succeed while the only other copy went unwritten would be worse than a failure.
const elsewhere = process.env.BACKUP_COPY_DIR;
if (elsewhere) {
  await mkdir(elsewhere, { recursive: true });
  const made = (await readdir(dir)).filter((file) => file.includes(stamp));
  for (const file of made) await copyFile(resolve(dir, file), resolve(elsewhere, file));
  console.log(`copied:   ${made.length} files to ${elsewhere}`);
} else if (!local) console.log('no second copy: BACKUP_COPY_DIR is not set, so the files archive is on the same disk as the files');

const removed = [...(await prune(new RegExp(`^ecosight-${name}-\\d{8}T\\d{6}Z\\.dump$`))), ...(local ? [] : await prune(/^ecosight-files-\d{8}T\d{6}Z\.tar\.gz$/))];
if (removed.length) console.log(`removed ${removed.length} older backup(s), keeping the newest ${keep} of each kind`);
