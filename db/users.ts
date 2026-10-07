import postgres from 'postgres';

// Who may sign in, and as what. Signing in only proves an email address; an
// address is let in when it is on this list.
//
//   pnpm users list
//   pnpm users add someone@example.org reviewer     (viewer, reviewer or admin)
//   pnpm users remove someone@example.org
//
// It works on DATABASE_URL. For the hosted database: DATABASE_URL="$SUPABASE_DB_URL" pnpm users ...
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');
const [command, address, role = 'viewer'] = process.argv.slice(2);
const email = address?.trim().toLowerCase();
const sql = postgres(url, { onnotice: () => {} });
try {
  if (command === 'add' && email && /^[^@\s]+@[^@\s]+$/.test(email) && ['viewer', 'reviewer', 'admin'].includes(role)) {
    await sql`
      insert into app_user (email, role) values (${email}, ${role})
      on conflict (email) do update set role = excluded.role`;
    console.log(`${email} is on the list as ${role}`);
  } else if (command === 'remove' && email) {
    const gone = await sql`delete from app_user where email = ${email} returning email`;
    console.log(gone.length ? `${email} removed` : `${email} was not on the list`);
  } else if (command === 'list') {
    const users = await sql`select email, role from app_user order by role, email`;
    for (const user of users) console.log(`${user.role.padEnd(9)} ${user.email}`);
    if (!users.length) console.log('Nobody is on the list.');
  } else {
    console.error('Usage: users list | users add <email> [viewer|reviewer|admin] | users remove <email>');
    process.exitCode = 1;
  }
} finally {
  await sql.end();
}
