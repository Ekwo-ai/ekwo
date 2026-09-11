/**
 * PGlite behind the MCP server's `SqlClient`.
 *
 * The tools are exercised against the real schema — the migrations, the
 * seeds, the triggers and the policies — in Postgres compiled to WebAssembly.
 * Nothing is mocked: `sqlBackend` sets `request.jwt.claims` and switches to
 * the `authenticated` role on every call, so a viewer is refused here for the
 * same reason they would be refused over the API.
 *
 * What these tests cannot run is the PostgREST route itself, which needs a
 * Supabase project. That route is a translation of the same five operations,
 * and `packages/mcp/README.md` carries the manual sequence for it.
 */

import type { PGlite } from '@electric-sql/pglite';
import { sqlBackend, type Backend, type SqlClient } from '../../packages/mcp/src/index.js';

type Queryable = {
  query: <T>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
  exec: (sql: string) => Promise<unknown>;
};

export function adapt(handle: Queryable, root: PGlite): SqlClient {
  return {
    async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
      const result = await handle.query<T>(sql, params);
      return result.rows;
    },
    async exec(sql: string): Promise<void> {
      await handle.exec(sql);
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

/** The server's backend, acting as one user of the installation. */
export function backendFor(db: PGlite, userId: string): Backend {
  return sqlBackend(adapt(db as unknown as Queryable, db), { userId });
}

/** A bank account and its journal, the way an operator sets one up once. */
export async function addBankAccount(
  db: PGlite,
  companyId: string,
  options: { accountCode?: string; journalCode?: string } = {},
): Promise<string> {
  const result = await db.query<{ id: string }>(
    `insert into bank_accounts (company_id, name, iban, account_id, journal_id)
     values ($1, 'Banque', 'BE00000000000000',
             account_id_by_code($1, $2),
             (select id from journals where company_id = $1 and code = $3))
     returning id`,
    [companyId, options.accountCode ?? '550000', options.journalCode ?? 'BNK'],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error('could not create the bank account');
  return row.id;
}

/** The ledger lines of an entry, as code / debit / credit, in order. */
export async function ledgerOfEntry(
  db: PGlite,
  entryId: string,
): Promise<{ code: string; debit: string; credit: string }[]> {
  const result = await db.query<{ code: string; debit: string; credit: string }>(
    `select a.code, l.debit::text as debit, l.credit::text as credit
       from entry_lines l join accounts a on a.id = l.account_id
      where l.entry_id = $1
      order by l.sequence`,
    [entryId],
  );
  return result.rows;
}

/** Narrows `unknown` to a record so a test can read a field without casting. */
export function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`expected an object, got ${typeof value}`);
  }
  return value as Record<string, unknown>;
}

export function list(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error('expected an array');
  return value as Record<string, unknown>[];
}
