import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

// Proves a backup can be restored: the dump is loaded into a database made for
// the purpose on the local server, and what comes out is checked against what
// went in. A backup that has never been restored is a hope, not a backup.
//
//   pnpm db:backup:verify                 the newest hosted dump in BACKUP_DIR
//   pnpm db:backup:verify <file.dump>     a dump by name
//   pnpm db:backup:verify --keep          leave the restored database in place to look at
//
// It checks, in order: the file against its checksum; that the restore finishes
// without an error; that every table holds the rows the backup recorded; and
// that the things a plain copy of the rows would miss came back too: the views,
// the triggers, the access rules, and the map's own query. The archive of files
// taken with the dump is then unpacked and read. A backup that passes is marked
// with a `.verified` file beside it, saying when.

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SCRATCH = 'ecosight_restore_check';
// Logins the hosted database's access rules name. They must exist for the rules to be restored; none can log in.
const ROLES = ['anon', 'authenticated', 'service_role', 'atlas_app', 'ecosight_app'];

const local = process.env.DATABASE_URL;
if (!local) throw new Error('DATABASE_URL is not set');
const server = new URL(local);
// The check makes and drops a database. It does that on a local server only, never on the hosted one.
if (!['localhost', '127.0.0.1', '::1'].includes(server.hostname))
  throw new Error(`The restore check runs against a local server only, not ${server.hostname}`);

const dir = resolve(ROOT, process.env.BACKUP_DIR ?? 'data/backups');
const keep = process.argv.includes('--keep');
const named = process.argv.slice(2).find((arg) => !arg.startsWith('--'));
const newest = async () => {
  const dumps = (await readdir(dir)).filter((file) => /^ecosight-hosted-\d{8}T\d{6}Z\.dump$/.test(file)).sort();
  if (!dumps.length) throw new Error(`No hosted dump in ${dir}. Run pnpm db:backup first.`);
  return resolve(dir, dumps.at(-1)!);
};
const dump = named ? resolve(process.cwd(), named) : await newest();
const manifest = JSON.parse(await readFile(`${dump}.json`, 'utf8')) as { taken_at: string; sha256: string; rows: Record<string, number>; server: string };

const problems: string[] = [];
const check = (ok: boolean, passed: string, failed: string) => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${ok ? passed : failed}`);
  if (!ok) problems.push(failed);
};

console.log(`Restoring ${dump.split('/').pop()}, taken ${manifest.taken_at}`);
const digest = createHash('sha256').update(await readFile(dump)).digest('hex');
check(digest === manifest.sha256, 'the file matches its checksum', 'the file does not match its checksum: it has changed since it was written');

const at = (database: string) => Object.assign(new URL(local), { pathname: `/${database}` }).href;
const admin = postgres(at('postgres'), { onnotice: () => {}, max: 1 });
try {
  await admin.unsafe(`drop database if exists ${SCRATCH} with (force)`);
  await admin.unsafe(`create database ${SCRATCH}`);
  for (const role of ROLES) {
    const [there] = await admin`select 1 from pg_roles where rolname = ${role}`;
    if (!there) await admin.unsafe(`create role ${role} nologin`);
  }
} finally {
  await admin.end();
}

const sql = postgres(at(SCRATCH), { onnotice: () => {}, max: 1 });
try {
  // The dump holds what is ours. The extensions it leans on come with the server, as they do on the host.
  for (const extension of ['postgis', 'vector', 'pg_trgm']) await sql.unsafe(`create extension if not exists ${extension}`);

  // The dump begins by creating the schema `public`, which every database already has, and a restore
  // told to stop at the first error would stop there. So it is given the dump's own list of contents
  // with those lines left out. docs/backup.md gives the same steps for a restore in earnest.
  const listing = spawnSync('pg_restore', ['--list', dump], { encoding: 'utf8' });
  const contents = listing.stdout.split('\n').filter((line) => !/ SCHEMA - public | COMMENT - SCHEMA public /.test(line));
  const work = await mkdtemp(resolve(tmpdir(), 'ecosight-restore-'));
  await writeFile(resolve(work, 'contents.list'), contents.join('\n'));
  const restore = spawnSync(
    'pg_restore',
    ['--no-owner', '--no-privileges', '--exit-on-error', `--use-list=${resolve(work, 'contents.list')}`, `--dbname=${at(SCRATCH)}`, dump],
    { encoding: 'utf8' },
  );
  await rm(work, { recursive: true, force: true });
  check(restore.status === 0, 'the restore finished without an error', `the restore failed: ${(restore.stderr || restore.error?.message || '').trim().split('\n').slice(-2).join(' ')}`);

  if (restore.status === 0) {
    const wrong: string[] = [];
    for (const [table, rows] of Object.entries(manifest.rows)) {
      let found: number | string;
      try {
        found = Number((await sql.unsafe(`select count(*) as rows from public."${table}"`))[0]!.rows);
      } catch {
        found = 'missing';
      }
      if (found !== rows) wrong.push(`${table}: ${found} of ${rows}`);
    }
    const total = Object.values(manifest.rows).reduce((sum, rows) => sum + rows, 0);
    check(wrong.length === 0, `all ${Object.keys(manifest.rows).length} tables hold the rows the backup recorded (${total} in all)`, `row counts differ: ${wrong.join('; ')}`);

    const [shape] = await sql<{ views: number; triggers: number; policies: number; guarded: number; tables: number }[]>`
      select
        (select count(*)::int from pg_views where schemaname = 'public') as views,
        (select count(*)::int from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and not t.tgisinternal) as triggers,
        (select count(*)::int from pg_policies where schemaname = 'public') as policies,
        (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity) as guarded,
        ${Object.keys(manifest.rows).length}::int as tables`;
    check(shape!.views >= 5 && shape!.triggers > 0, `${shape!.views} views and ${shape!.triggers} triggers came back`, `views or triggers are missing: ${shape!.views} views, ${shape!.triggers} triggers`);
    // Every table of ours is closed by row-level security on the host; one that came back open would be readable by anyone with the publishable key.
    check(shape!.guarded === shape!.tables && shape!.policies > 0, `row-level security is on for all ${shape!.guarded} tables, with ${shape!.policies} access rules`, `access rules did not come back whole: ${shape!.guarded} of ${shape!.tables} tables guarded, ${shape!.policies} rules`);

    // What the map itself asks for: the office layer with its places, and the graph of links.
    const [map] = await sql<{ offices: number; placed: number; links: number; funded: number }[]>`
      select
        (select count(*)::int from public_office) as offices,
        (select count(*)::int from public_office where st_x(geom::geometry) between -180 and 180 and st_y(geom::geometry) between -90 and 90) as placed,
        (select count(*)::int from graph_edge) as links,
        (select count(*)::int from organisation_funding where raised_usd > 0) as funded`;
    check(map!.offices > 0 && map!.offices === map!.placed && map!.links > 0, `the map's queries answer: ${map!.offices} offices with places, ${map!.links} links, ${map!.funded} organisations with money raised`, `the map's queries do not answer as they should: ${JSON.stringify(map)}`);
    const [version] = await sql`show server_version`;
    console.log(`       restored into PostgreSQL ${version!.server_version}; the dump came from ${manifest.server}`);
  }
} finally {
  await sql.end();
  if (!keep) {
    const tidy = postgres(at('postgres'), { onnotice: () => {}, max: 1 });
    try {
      await tidy.unsafe(`drop database if exists ${SCRATCH} with (force)`);
    } finally {
      await tidy.end();
    }
  } else console.log(`       left in place as the database ${SCRATCH} on the local server`);
}

// The files taken in the same run: the datasets and what was curated from them, which are in no database.
const archive = dump.replace(/ecosight-hosted-(\d{8}T\d{6}Z)\.dump$/, 'ecosight-files-$1.tar.gz');
if (archive !== dump && (await readFile(`${archive}.sha256`, 'utf8').catch(() => null)) !== null) {
  const recorded = (await readFile(`${archive}.sha256`, 'utf8')).split(' ')[0];
  check(createHash('sha256').update(await readFile(archive)).digest('hex') === recorded, 'the archive of files matches its checksum', 'the archive of files does not match its checksum');
  const out = await mkdtemp(resolve(tmpdir(), 'ecosight-files-'));
  try {
    const unpack = spawnSync('tar', ['-xzf', archive, '-C', out], { encoding: 'utf8' });
    const unpacked = (await readdir(out, { recursive: true, withFileTypes: true })).filter((entry) => entry.isFile());
    // Unpacking is not enough: each curated file must still be something a program can read.
    const unreadable: string[] = [];
    for (const entry of unpacked) {
      const path = resolve(entry.parentPath, entry.name);
      if (/\/curation\/[^/]+\.json$/.test(path))
        try {
          JSON.parse(await readFile(path, 'utf8'));
        } catch {
          unreadable.push(entry.name);
        }
    }
    const curated = unpacked.filter((entry) => /\/curation$/.test(entry.parentPath)).length;
    const datasets = unpacked.filter((entry) => /\/datasets\//.test(entry.parentPath + '/')).length;
    check(
      unpack.status === 0 && curated > 0 && datasets > 0 && unreadable.length === 0,
      `the files unpack and read: ${unpacked.length} in all, ${curated} curated, ${datasets} dataset files`,
      `the files did not come back whole: ${unpack.stderr.trim() || `${curated} curated, ${datasets} dataset files, unreadable: ${unreadable.join(', ') || 'none'}`}`,
    );
  } finally {
    await rm(out, { recursive: true, force: true });
  }
} else console.log('       no archive of files was taken with this dump');

if (problems.length) {
  await rm(`${dump}.verified`, { force: true });
  console.error(`\nThe backup did NOT pass: ${problems.length} check(s) failed.`);
  process.exit(1);
}
await writeFile(`${dump}.verified`, `Restored and checked ${new Date().toISOString()}\n`);
console.log('\nThe backup restores, and what comes back matches what was taken.');
