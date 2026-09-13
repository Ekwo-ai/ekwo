/**
 * PGlite behind the CLI's `SqlClient`.
 *
 * The CLI talks to Postgres through one small interface so that the migration
 * runner, the installation sequence and the checks can be exercised here
 * against real Postgres — compiled to WebAssembly, no Docker, no project —
 * instead of being mocked. The only piece these tests do not run is the
 * network driver itself, which is thirty lines and has nothing to decide.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import type { SqlClient } from '../../packages/cli/src/sql.js';
import { repoRoot } from '../helpers/db.js';

export const migrationsPath = join(repoRoot, 'supabase', 'migrations');
export const seedPath = join(repoRoot, 'supabase', 'seed');

type Queryable = {
  query: <T>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
  exec: (sql: string) => Promise<unknown>;
};

function adapt(handle: Queryable, root: PGlite): SqlClient {
  return {
    async exec(sql: string): Promise<void> {
      await handle.exec(sql);
    },
    async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
      const result = await handle.query<T>(sql, params);
      return result.rows;
    },
    async transaction<T>(fn: (tx: SqlClient) => Promise<T>): Promise<T> {
      const outcome = await root.transaction(async (tx) => fn(adapt(tx as Queryable, root)));
      return outcome as T;
    },
    async close(): Promise<void> {
      await root.close();
    },
  };
}

/**
 * A Postgres with Supabase's `auth` schema and nothing else.
 *
 * The CLI's own runner is what applies the migrations in these tests, which
 * is the point: the thing under test is the installer, not the schema.
 */
export async function emptyDatabase(): Promise<{ db: SqlClient; pg: PGlite }> {
  const pg = new PGlite();
  await pg.waitReady;
  const shim = await readFile(join(repoRoot, 'tests', 'helpers', 'supabase-shim.sql'), 'utf8');
  await pg.exec(shim);
  // What `connect()` does on a real connection: this one is the installer.
  await pg.exec(`select set_config('ekwo.installing', 'on', false);`);
  return { db: adapt(pg as unknown as Queryable, pg), pg };
}

/** An account in the shimmed `auth.users`, standing in for one GoTrue created. */
export async function makeAuthUser(db: SqlClient, email = 'admin@example.test'): Promise<string> {
  const rows = await db.query<{ id: string }>(
    'insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id',
    [email],
  );
  const row = rows[0];
  if (row === undefined) throw new Error('could not create the test user');
  return row.id;
}

/** A `fetch` that answers from a table of routes, and records what it was sent. */
export function fakeFetch(
  routes: (url: string, init?: RequestInit) => { status: number; body: unknown } | undefined,
): {
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response>;
  calls: { url: string; body: unknown }[];
} {
  const calls: { url: string; body: unknown }[] = [];
  const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
    const raw = typeof init?.body === 'string' ? init.body : undefined;
    calls.push({ url, body: raw === undefined ? undefined : JSON.parse(raw) });
    const answer = routes(url, init);
    if (answer === undefined) throw new Error(`fetch failed: nothing serves ${url}`);
    return new Response(JSON.stringify(answer.body), {
      status: answer.status,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  return { fetchImpl, calls };
}
