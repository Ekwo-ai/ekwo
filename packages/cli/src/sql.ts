/**
 * The only way this CLI talks to Postgres.
 *
 * Everything above this file is written against `SqlClient`, so the same
 * migration runner, bootstrap and checks can run against a real Supabase
 * project (the `postgres` driver, below) and against PGlite in the tests.
 * No command imports a driver directly.
 */

/** A Postgres connection, reduced to what this CLI needs. */
export interface SqlClient {
  /** Multi-statement SQL with no parameters, sent as one command string. */
  exec(sql: string): Promise<void>;
  /** One parameterised statement (`$1`, `$2`, …), returning its rows. */
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Runs `fn` inside a transaction; a throw rolls the whole thing back. */
  transaction<T>(fn: (tx: SqlClient) => Promise<T>): Promise<T>;
  /** Closes the connection. Calling it twice is harmless. */
  close(): Promise<void>;
}

/** One row, or `undefined` when the query returned none. */
export async function first<T = Record<string, unknown>>(
  db: SqlClient,
  sql: string,
  params: unknown[] = [],
): Promise<T | undefined> {
  const rows = await db.query<T>(sql, params);
  return rows[0];
}

/** One scalar, or `undefined`. */
export async function scalar<T>(
  db: SqlClient,
  sql: string,
  params: unknown[] = [],
): Promise<T | undefined> {
  const row = await first<Record<string, unknown>>(db, sql, params);
  if (row === undefined) return undefined;
  const values = Object.values(row);
  return values[0] as T;
}

/**
 * Connects to Postgres with the `postgres` driver.
 *
 * Imported lazily so that the tests — which plug PGlite into `SqlClient` —
 * never load a network driver, and so `ekwo --help` costs nothing.
 *
 * `prepare: false` because Supabase's transaction-mode pooler (port 6543)
 * rejects prepared statements; the CLI works on either port with it off.
 */
export async function connect(connectionString: string): Promise<SqlClient> {
  const { default: postgres } = await import('postgres');

  const sql = postgres(connectionString, {
    max: 1,
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 30,
    onnotice: () => {},
  });

  type Sql = typeof sql;

  const wrap = (handle: Sql): SqlClient => ({
    async exec(text: string): Promise<void> {
      await handle.unsafe(text).simple();
    },
    async query<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
      const result = await handle.unsafe(text, params as never[]);
      return result as unknown as T[];
    },
    async transaction<T>(fn: (tx: SqlClient) => Promise<T>): Promise<T> {
      return (await handle.begin(async (tx) => fn(wrap(tx as unknown as Sql)))) as T;
    },
    async close(): Promise<void> {
      await sql.end({ timeout: 5 });
    },
  });

  // Fail here rather than in the middle of a migration — and close the pool
  // on the way out, so a bad connection string does not leave the process
  // holding a socket open and waiting for it.
  try {
    await sql`select 1`;
  } catch (error) {
    await sql.end({ timeout: 5 }).catch(() => {});
    throw error;
  }

  // This connection is the installer. The guards inside the schema ask
  // `is_installer()` rather than "is there no session", so the runner has to
  // say so out loud; `asUser()` below withdraws it for the length of the call
  // it makes on somebody's behalf. A caller reaching the database through
  // PostgREST cannot set this, which is the whole point of it being a setting.
  // `set_config(..., false)` is session-wide, and the pool is capped at one.
  //
  // Not swallowed. A connection that cannot say it is installing is one every
  // guard in the schema will refuse later, with a message about a capability
  // the operator does not have and cannot get — so the failure belongs here,
  // where it names itself.
  try {
    await sql`select set_config('ekwo.installing', 'on', false)`;
  } catch (error) {
    await sql.end({ timeout: 5 }).catch(() => {});
    throw error;
  }

  return wrap(sql);
}

/**
 * Runs `fn` with `auth.uid()` answering `userId`.
 *
 * The CLI holds a superuser connection, so row level security is bypassed —
 * but the guards written *inside* the schema's functions (`register_instance`
 * refusing anyone who is not an instance administrator, for one) read
 * `auth.uid()` and would refuse the installer. Setting the request claim the
 * way PostgREST does makes those functions see the administrator the CLI is
 * acting for, so the rule is satisfied rather than circumvented.
 *
 * The connection pool is capped at one, so the setting and the call land on
 * the same backend.
 */
export async function asUser<T>(
  db: SqlClient,
  userId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const claims = JSON.stringify({ sub: userId, role: 'authenticated' });
  await db.query('select set_config($1, $2, false)', ['request.jwt.claims', claims]);
  // Acting for somebody is not installing: the guards must judge this call on
  // what that person may do, not on the connection it happens to travel over.
  await db.query('select set_config($1, $2, false)', ['ekwo.installing', '']);
  try {
    return await fn();
  } finally {
    await db.query('select set_config($1, $2, false)', ['request.jwt.claims', '']);
    await db.query('select set_config($1, $2, false)', ['ekwo.installing', 'on']);
  }
}
