import postgres from 'postgres';

export type Sql = postgres.Sql;

export function connect(url = process.env.DATABASE_URL): Sql {
  if (!url) throw new Error('DATABASE_URL is not set');
  return postgres(url, { onnotice: () => {} });
}
