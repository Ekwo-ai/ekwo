import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(here, '..', '..');
const migrationsDir = join(repoRoot, 'supabase', 'migrations');
const seedDir = join(repoRoot, 'supabase', 'seed');
const modulesDir = join(repoRoot, 'modules');
/**
 * The Supabase shim, applied before the migrations. Exported because
 * `tests/grants.test.ts` builds a database by hand, starting from roles that
 * hold nothing at all, to prove the migrations are the only thing that grants.
 */
export const shimPath = join(here, 'supabase-shim.sql');

export interface Options {
  /** Apply `supabase/seed/*.sql` after the migrations. Default true. */
  seed?: boolean;
  /**
   * Apply `modules/<code>/supabase/migrations/*.sql` after the socle's, and
   * the country seeds those modules compiled. Default true — a module is a
   * schema whose tables are empty until a company enables it, so a database
   * that carries them is the ordinary one.
   */
  modules?: boolean;
}

/** Files applied, in order, by `freshDatabase`. */
export async function migrationFiles(): Promise<string[]> {
  return (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();
}

export async function seedFiles(): Promise<string[]> {
  return (await readdir(seedDir)).filter((f) => f.endsWith('.sql')).sort();
}

export interface ModuleFile {
  /** `assets` */
  code: string;
  /** `20260913080114_assets.sql` */
  file: string;
  path: string;
  /** `20260913080114` */
  version: string;
}

/** The module codes this checkout carries, in the order they are applied. */
export async function moduleCodes(): Promise<string[]> {
  const entries = await readdir(modulesDir, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isDirectory() && entry.name !== 'schema')
    .map((entry) => entry.name)
    .sort();
}

/**
 * Every module migration of this checkout, ordered by version.
 *
 * The order is global rather than per module, because they share one history
 * table with the socle and a module may one day depend on another. A duplicate
 * version anywhere is what `modules.test.ts` refuses.
 */
export async function moduleMigrationFiles(): Promise<ModuleFile[]> {
  const out: ModuleFile[] = [];
  for (const code of await moduleCodes()) {
    const dir = join(modulesDir, code, 'supabase', 'migrations');
    const exists = await stat(dir).catch(() => undefined);
    if (exists === undefined) continue;
    for (const file of (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()) {
      out.push({ code, file, path: join(dir, file), version: file.slice(0, 14) });
    }
  }
  return out.sort((a, b) => a.version.localeCompare(b.version));
}

/** The pack seeds a module compiled: `supabase/seed/modules/<code>/*.sql`. */
export async function moduleSeedFiles(): Promise<ModuleFile[]> {
  const out: ModuleFile[] = [];
  for (const code of await moduleCodes()) {
    const dir = join(seedDir, 'modules', code);
    const exists = await stat(dir).catch(() => undefined);
    if (exists === undefined) continue;
    for (const file of (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()) {
      out.push({ code, file, path: join(dir, file), version: file.slice(0, 14) });
    }
  }
  return out;
}

/**
 * A brand new in-memory Postgres with the whole schema applied.
 *
 * PGlite is Postgres compiled to WebAssembly, so the migrations run against
 * the real planner and the real constraints — no Docker, no stub.
 *
 * Nothing here grants `anon` or `authenticated` anything. It used to: the
 * shim carried the default privileges of a Supabase project and this function
 * ended with a `grant … on all tables in schema public`, so a test that read a
 * table as a signed-in user proved nothing about whether the schema had ever
 * granted the read. Since `20260914151207` the migrations declare their own
 * privileges by name, and the only thing between a role and a table in these
 * tests is a `grant` somebody wrote.
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

  // The modules come after the socle and before the seeds: a module migration
  // may reference `public.companies` or `public.accounts`, and a module's
  // country seed writes its own reference tables, which have to exist first.
  if (options.modules !== false) {
    for (const migration of await moduleMigrationFiles()) {
      const sql = await readFile(migration.path, 'utf8');
      try {
        await db.exec(sql);
      } catch (error) {
        throw new Error(
          `module migration ${migration.code}/${migration.file} failed: ${(error as Error).message}`,
        );
      }
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

    if (options.modules !== false) {
      for (const seed of await moduleSeedFiles()) {
        const sql = await readFile(seed.path, 'utf8');
        try {
          await db.exec(sql);
        } catch (error) {
          throw new Error(`module seed ${seed.code}/${seed.file} failed: ${(error as Error).message}`);
        }
      }
    }
  }

  // This connection is the installer, and says so. `is_installer()` is what
  // the guards read instead of "auth.uid() is null", so a test that arranges
  // a fixture as the owner keeps working and a test that puts a session or a
  // machine key on the connection stops being the installer for its duration.
  await db.exec(`select set_config('ekwo.installing', 'on', false);`);

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
     select set_config('ekwo.installing', '', false);
     set role ${role};`,
  );
  try {
    return await fn();
  } finally {
    await db.exec(
      `reset role;
       select set_config('request.jwt.claims', '', false);
       select set_config('ekwo.installing', 'on', false);`,
    );
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
