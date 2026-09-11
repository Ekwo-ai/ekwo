import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(here, '..', '..');
const migrationsDir = join(repoRoot, 'supabase', 'migrations');
const seedDir = join(repoRoot, 'supabase', 'seed');
const shimPath = join(here, 'supabase-shim.sql');

export interface Options {
  /** Apply `supabase/seed/*.sql` after the migrations. Default true. */
  seed?: boolean;
}

/** Files applied, in order, by `freshDatabase`. */
export async function migrationFiles(): Promise<string[]> {
  return (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();
}

export async function seedFiles(): Promise<string[]> {
  return (await readdir(seedDir)).filter((f) => f.endsWith('.sql')).sort();
}

/**
 * A brand new in-memory Postgres with the whole schema applied.
 *
 * PGlite is Postgres compiled to WebAssembly, so the migrations run against
 * the real planner and the real constraints — no Docker, no stub.
 */
export async function freshDatabase(options: Options = {}): Promise<PGlite> {
  const db = new PGlite();
  await db.waitReady;

  await db.exec(await readFile(shimPath, 'utf8'));

  for (const file of await migrationFiles()) {
    const sql = await readFile(join(migrationsDir, file), 'utf8');
    try {
      await db.exec(sql);
    } catch (error) {
      throw new Error(`migration ${file} failed: ${(error as Error).message}`);
    }
  }

  if (options.seed !== false) {
    for (const file of await seedFiles()) {
      const sql = await readFile(join(seedDir, file), 'utf8');
      try {
        await db.exec(sql);
      } catch (error) {
        throw new Error(`seed ${file} failed: ${(error as Error).message}`);
      }
    }
  }

  // Everything created after the shim's ALTER DEFAULT PRIVILEGES still needs
  // the grants, because migrations run as the owner in one session.
  await db.exec(`
    grant select, insert, update, delete on all tables in schema public to authenticated;
    grant select on all tables in schema public to anon;
    -- Not to anon: since migration 20260911210131 the anonymous role executes
    -- only the policy helpers, and those grants are the migration's own.
    grant execute on all functions in schema public to authenticated;
  `);

  return db;
}

/** Single scalar from a query. */
export async function one<T = Record<string, unknown>>(
  db: PGlite,
  sql: string,
  params: unknown[] = [],
): Promise<T> {
  const result = await db.query<T>(sql, params);
  const row = result.rows[0];
  if (row === undefined) throw new Error(`no row returned by: ${sql}`);
  return row;
}

export async function rows<T = Record<string, unknown>>(
  db: PGlite,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

/** Run a block as a signed-in Supabase user, then drop back to the owner. */
export async function asUser<T>(
  db: PGlite,
  userId: string,
  fn: () => Promise<T>,
  role = 'authenticated',
): Promise<T> {
  await db.exec(
    `select set_config('request.jwt.claims', '${JSON.stringify({ sub: userId, role })}', false);
     set role ${role};`,
  );
  try {
    return await fn();
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claims', '', false);`);
  }
}

/** Assert that a statement raises, and return the message. */
export async function expectError(db: PGlite, sql: string, params: unknown[] = []): Promise<string> {
  try {
    await db.query(sql, params);
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error(`expected an error from: ${sql}`);
}
