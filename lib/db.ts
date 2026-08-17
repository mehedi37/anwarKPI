import { Pool, type QueryResultRow } from 'pg';

let _pool: Pool | null = null;

function pool(): Pool {
  if (_pool) return _pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set.');
  _pool = new Pool({ connectionString });
  return _pool;
}

/** better-sqlite3 used `?` placeholders throughout the app; pg needs `$1, $2, ...`. */
function positional(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

export async function all<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res = await pool().query<T>(positional(sql), params);
  return res.rows;
}

export async function one<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<T | undefined> {
  return (await all<T>(sql, params))[0];
}

export async function run(sql: string, params: unknown[] = []): Promise<{ rowCount: number }> {
  const res = await pool().query(positional(sql), params);
  return { rowCount: res.rowCount ?? 0 };
}

/** INSERT ... RETURNING id — the Postgres equivalent of better-sqlite3's `lastInsertRowid`. */
export async function insertReturningId(sql: string, params: unknown[] = []): Promise<number> {
  const row = await one<{ id: number }>(`${sql} RETURNING id`, params);
  if (row === undefined) throw new Error('Insert did not return an id.');
  return row.id;
}

export type Tx = {
  all: typeof all;
  one: typeof one;
  run: typeof run;
  insertReturningId: typeof insertReturningId;
};

/**
 * Runs several statements on a single checked-out connection inside
 * BEGIN/COMMIT. Needed anywhere the old code relied on better-sqlite3's
 * synchronous `conn.transaction(fn)` — seeding and score writes.
 */
export async function transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await pool().connect();
  const tx: Tx = {
    all: async (sql, params = []) => (await client.query(positional(sql), params)).rows,
    one: async (sql, params = []) => (await client.query(positional(sql), params)).rows[0],
    run: async (sql, params = []) => ({
      rowCount: (await client.query(positional(sql), params)).rowCount ?? 0,
    }),
    insertReturningId: async (sql, params = []) => {
      const res = await client.query(`${positional(sql)} RETURNING id`, params);
      return res.rows[0].id;
    },
  };
  try {
    await client.query('BEGIN');
    const result = await fn(tx);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export function now(): string {
  return new Date().toISOString();
}

export async function isSeeded(): Promise<boolean> {
  const row = await one<{ n: number }>(`SELECT COUNT(*) AS n FROM employee`);
  return (row?.n ?? 0) > 0;
}

const TABLES = [
  'review_event', 'ai_suggestion', 'score', 'evidence', 'actual_entry',
  'milestone', 'rubric_level', 'kpi_assignment', 'sample_evidence',
  'period', 'employee', 'department',
] as const;

/** Wipe every row and reset identity sequences, ready for a fresh seed(). */
export async function resetAll(): Promise<void> {
  await run(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`);
}
