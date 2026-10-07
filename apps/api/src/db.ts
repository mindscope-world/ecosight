import postgres from 'postgres';

export type Sql = postgres.Sql;

export function connect(
  url = process.env.DATABASE_URL,
  options: { max?: number; idle_timeout?: number; prepare?: boolean } = {},
): Sql {
  if (!url) throw new Error('DATABASE_URL is not set');
  return postgres(url, { onnotice: () => {}, ...options });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Runs queries as one fund. Inside the callback the connection is the atlas_app
 * role with app.fund_id set, so row-level security limits fund_private_* tables to
 * that fund. Both settings end with the transaction and cannot leak to the pool.
 */
export function withFund<T>(sql: Sql, fundId: string, run: (tx: postgres.TransactionSql) => Promise<T>) {
  if (!UUID.test(fundId)) throw new Error('fundId must be a UUID');
  return sql.begin(async (tx) => {
    await tx`select set_config('app.fund_id', ${fundId}, true)`;
    await tx`set local role atlas_app`;
    return run(tx);
  });
}
