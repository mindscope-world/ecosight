# Backups and restoring

What is backed up, how to check a backup, and how to get everything back. The
restore steps here were run for real on Oct 8, 2026, against a local server; they
have not yet been run against a new hosted project.

## What is backed up

| What | Where it lives | In the backup |
|------|----------------|---------------|
| The hosted database: every record, source, review decision, logo and user on the list | Supabase | A dump, `ecosight-hosted-<time>.dump` |
| Datasets, everything curated from them, the labelled news items, stored news, and the lookup caches | This machine only; kept out of git | An archive, `ecosight-files-<time>.tar.gz` |
| The code | GitHub | Not here: git is its backup |

**Not backed up, on purpose:**

- `.env`. A backup gets copied about and must not carry the keys. Keep the keys in a
  password manager. Without them a restore still works, with new keys.
- Sign-in accounts. Supabase keeps those outside our tables. The list of who is let
  in, and as what, is in the dump; a person on it signs in again by emailed link.
- The settings of the hosted function. They are the same values as in `.env`.

## Taking a backup

```sh
pnpm db:backup            # the hosted database and the files, into data/backups/
pnpm db:backup --local    # the local database instead
pnpm db:backup:verify     # restore the newest dump into a scratch database and check it
```

Each dump comes with a checksum and a `.json` record of how many rows every table
held. The counts are taken twice: through the application's login, which the dump
uses, and as the database's owner. If the two differ, row-level security is hiding
rows from the dump, and the backup is refused rather than kept short.

Settings, in `.env` or the environment:

| Setting | Default | Meaning |
|---------|---------|---------|
| `BACKUP_DIR` | `data/backups` | Where backups are written |
| `BACKUP_KEEP` | 14 | How many of each kind are kept; older ones are removed |
| `BACKUP_COPY_DIR` | not set | A second place every backup is copied to |

**Set `BACKUP_COPY_DIR`.** The dump is already a second copy of the hosted database,
since it sits on this machine. The files archive is not: it sits on the same disk as
the files it protects, so a lost disk loses both. Point `BACKUP_COPY_DIR` at another
disk or at a folder that is synced elsewhere and encrypted. The datasets hold public
business emails and phone numbers that were deliberately not loaded, so choose the
place with that in mind.

## The check

`pnpm db:backup:verify` loads the dump into a database made for the purpose on the
local server and checks, in order:

1. the file against its checksum;
2. that the restore finishes without an error;
3. that every table holds the rows the backup recorded;
4. that the views and triggers came back;
5. that row-level security is on for every table, with its access rules;
6. that the map's own queries answer: offices with places, links, money raised;
7. that the files archive matches its checksum, unpacks, and its curated files read.

A dump that passes gets a `.verified` file beside it. The scratch database is
dropped afterwards; `--keep` leaves it in place as `ecosight_restore_check`.

The check has itself been tested: a dump with bytes changed, one cut short, and one
whose record claimed more rows than it held each failed it.

## Every day

```sh
./infra/backup/install.sh            # install the daily run for this user
./infra/backup/install.sh --remove   # take it out again
systemctl --user status ecosight-backup.service   # how the last run went
systemctl --user start ecosight-backup.service    # run it now
```

A systemd timer runs `scripts/backup-and-verify.sh` at about 03:30 each day: a
backup, then the check. If the machine was off, the run is made up when it is next
on. What each run said is in `data/backups/backup.log`. A failed run raises a desktop
notice and shows as failed in `systemctl --user status`.

With one run a day, at most a day of work is lost; more if the machine stays off.

## Restoring the database

To a new Supabase project, or any PostgreSQL 17 server.

1. **Prepare the server.** Turn on the three extensions the tables lean on, in the
   schema `public`, and make the two logins the access rules name:

   ```sql
   create extension if not exists postgis;
   create extension if not exists vector;
   create extension if not exists pg_trgm;
   create role atlas_app nologin;
   create role ecosight_app login password '<a new password>';
   ```

   A Supabase project already has `anon`, `authenticated` and `service_role`. On a
   plain server, create those three as well, with `nologin`.

2. **Restore.** The dump begins by creating the schema `public`, which every
   database already has, so those lines are left out:

   ```sh
   pg_restore --list <file.dump> | grep -v -e ' SCHEMA - public ' -e ' COMMENT - SCHEMA public ' > contents.list
   pg_restore --no-owner --no-privileges --exit-on-error --use-list=contents.list --dbname="<connection string of the owner>" <file.dump>
   ```

   This needs a connection as the database's owner, which a new Supabase project
   gives with its database password.

3. **Close it again.** Rights are not carried in the dump. Run
   `infra/supabase/harden.sql`, which gives the application its rights and takes
   them from the public web roles. Without it the application cannot read, or the
   public can.

4. **Check.** Compare `select count(*)` for a few tables with the dump's `.json`
   record, and confirm the public REST interface answers "permission denied" for
   `organisation` (see `docs/deploy.md`, section 4).

5. **Point the application at it.** Put the new connection string in `.env` as
   `SUPABASE_DB_URL`, set the function's `DATABASE_URL` secret to the same on port
   6543, and redeploy the API (`docs/deploy.md`, section 2).

## Restoring the files

```sh
tar -xzf ecosight-files-<time>.tar.gz -C <the repository's folder>
```

This puts back `curation/`, `datasets/`, `eval/labelled.jsonl`, `data/raw/` and the
caches. It overwrites files of the same name, so unpack somewhere else first if the
folder is not empty.

## What this does not cover

- **A disaster on this machine and at the host at once.** The dump lives here and
  the database there. Set `BACKUP_COPY_DIR` to have a third place.
- **Changes since the last run.** Up to a day.
- **A hosted restore has not been rehearsed.** The steps above were run against a
  local server. Rehearse them once against a spare Supabase project.
