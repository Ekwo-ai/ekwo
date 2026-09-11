/**
 * The migration runner.
 *
 * It applies `supabase/migrations/*.sql` in filename order and records what
 * it did in `supabase_migrations.schema_migrations`, **in the format the
 * Supabase CLI uses** — same schema, same table, same three columns, version
 * being the timestamp prefix of the filename. That is the whole point: an
 * installation set up with `ekwo init` can later be pushed to with
 * `supabase db push`, and one set up with `supabase db push` can be brought
 * forward with `ekwo migrate`. The two are interchangeable because they read
 * and write the same history.
 *
 * Each file is applied inside one transaction together with its history row,
 * so a migration that fails halfway leaves neither half-applied schema nor a
 * history row that lies. Re-running resumes at the file that failed.
 */

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { SqlClient } from './sql.js';

export interface Migration {
  /** `20260911120000` — the timestamp prefix, and the primary key of the history. */
  version: string;
  /** `core_companies` — what the Supabase CLI stores as `name`. */
  name: string;
  /** `20260911120000_core_companies.sql` */
  file: string;
  /** Absolute path on disk. */
  path: string;
}

const FILE_PATTERN = /^(\d{14})_(.+)\.sql$/;

/** Parses a migration filename, or returns `undefined` if it is not one. */
export function parseMigrationFile(file: string): Omit<Migration, 'path'> | undefined {
  const match = FILE_PATTERN.exec(file);
  if (match === null) return undefined;
  const [, version, name] = match;
  if (version === undefined || name === undefined) return undefined;
  return { version, name, file };
}

/** Every migration in `dir`, in the order they must be applied. */
export async function listMigrations(dir: string): Promise<Migration[]> {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const migrations: Migration[] = [];
  for (const file of files) {
    const parsed = parseMigrationFile(file);
    if (parsed === undefined) {
      throw new Error(`migration_name_invalid: ${file} — expected YYYYMMDDHHMMSS_subject.sql`);
    }
    migrations.push({ ...parsed, path: join(dir, file) });
  }
  return migrations;
}

/**
 * The history table, created exactly as the Supabase CLI creates it.
 *
 * The columns are added one by one with `if not exists`, so this is safe on a
 * project the Supabase CLI has already touched, whichever version of it.
 */
export async function ensureHistory(db: SqlClient): Promise<void> {
  await db.exec(`
    create schema if not exists supabase_migrations;
    create table if not exists supabase_migrations.schema_migrations (
      version text not null primary key
    );
    alter table supabase_migrations.schema_migrations
      add column if not exists statements text[];
    alter table supabase_migrations.schema_migrations
      add column if not exists name text;
  `);
}

/** Versions already recorded, oldest first. */
export async function appliedVersions(db: SqlClient): Promise<string[]> {
  const rows = await db.query<{ version: string }>(
    'select version from supabase_migrations.schema_migrations order by version',
  );
  return rows.map((r) => r.version);
}

export interface Gap {
  applied: string[];
  pending: Migration[];
  /** Versions in the database that this release does not ship — a newer installation. */
  unknown: string[];
}

/** What separates the database from the migrations this CLI carries. */
export async function migrationGap(db: SqlClient, all: Migration[]): Promise<Gap> {
  await ensureHistory(db);
  const applied = await appliedVersions(db);
  const appliedSet = new Set(applied);
  const shipped = new Set(all.map((m) => m.version));
  return {
    applied,
    pending: all.filter((m) => !appliedSet.has(m.version)),
    unknown: applied.filter((v) => !shipped.has(v)),
  };
}

/**
 * Applies one migration and records it, atomically.
 *
 * The file is sent as a single command string, so Postgres runs it as one
 * unit inside the transaction we opened. No file in this repository opens a
 * transaction of its own, and none may: the runner owns that.
 */
export async function applyMigration(db: SqlClient, migration: Migration): Promise<void> {
  const sql = await readFile(migration.path, 'utf8');
  const statements = splitStatements(sql);

  await db.transaction(async (tx) => {
    await tx.exec(sql);
    await tx.query(
      `insert into supabase_migrations.schema_migrations (version, name, statements)
       values ($1, $2, $3)
       on conflict (version) do nothing`,
      [migration.version, migration.name, statements],
    );
  });
}

export interface ApplyResult {
  applied: Migration[];
  alreadyApplied: number;
}

/** Applies every pending migration, in order, reporting each one as it lands. */
export async function applyMigrations(
  db: SqlClient,
  all: Migration[],
  onApplied?: (migration: Migration) => void,
): Promise<ApplyResult> {
  const gap = await migrationGap(db, all);
  for (const migration of gap.pending) {
    await applyMigration(db, migration);
    onApplied?.(migration);
  }
  return { applied: gap.pending, alreadyApplied: gap.applied.length };
}

/**
 * Splits a SQL file into statements, for the `statements` column only.
 *
 * Execution never goes through this: the file is handed to Postgres whole.
 * The column is what `supabase migration repair` and `supabase db diff` read
 * back, so it should hold statements rather than one blob — but a mistake
 * here can only make that column less pretty, never break an installation.
 *
 * Handles line and block comments, single- and double-quoted literals,
 * `E''` backslash escapes and dollar quoting with tags, which is what the
 * function bodies in this schema are made of.
 */
export function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let index = 0;

  const push = (): void => {
    const trimmed = current.trim();
    if (trimmed.length > 0) statements.push(trimmed);
    current = '';
  };

  while (index < sql.length) {
    const char = sql[index] as string;
    const next = sql[index + 1];

    // Line comment.
    if (char === '-' && next === '-') {
      const end = sql.indexOf('\n', index);
      const stop = end === -1 ? sql.length : end;
      current += sql.slice(index, stop);
      index = stop;
      continue;
    }

    // Block comment, which nests in Postgres.
    if (char === '/' && next === '*') {
      let depth = 0;
      const start = index;
      while (index < sql.length) {
        if (sql[index] === '/' && sql[index + 1] === '*') {
          depth += 1;
          index += 2;
        } else if (sql[index] === '*' && sql[index + 1] === '/') {
          depth -= 1;
          index += 2;
          if (depth === 0) break;
        } else {
          index += 1;
        }
      }
      current += sql.slice(start, index);
      continue;
    }

    // Dollar-quoted string: $$ … $$ or $tag$ … $tag$.
    if (char === '$') {
      const tag = DOLLAR_TAG.exec(sql.slice(index));
      if (tag !== null) {
        const marker = tag[0];
        const end = sql.indexOf(marker, index + marker.length);
        const stop = end === -1 ? sql.length : end + marker.length;
        current += sql.slice(index, stop);
        index = stop;
        continue;
      }
    }

    // Single-quoted literal. Backslash escapes only after E''.
    if (char === "'") {
      const escaped = /[eE]$/.test(current);
      const start = index;
      index += 1;
      while (index < sql.length) {
        if (escaped && sql[index] === BACKSLASH) {
          index += 2;
          continue;
        }
        if (sql[index] === "'") {
          if (sql[index + 1] === "'") {
            index += 2;
            continue;
          }
          index += 1;
          break;
        }
        index += 1;
      }
      current += sql.slice(start, index);
      continue;
    }

    // Quoted identifier.
    if (char === '"') {
      const start = index;
      index += 1;
      while (index < sql.length) {
        if (sql[index] === '"') {
          if (sql[index + 1] === '"') {
            index += 2;
            continue;
          }
          index += 1;
          break;
        }
        index += 1;
      }
      current += sql.slice(start, index);
      continue;
    }

    if (char === ';') {
      current += char;
      push();
      index += 1;
      continue;
    }

    current += char;
    index += 1;
  }

  push();
  return statements;
}

const DOLLAR_TAG = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/;
const BACKSLASH = String.fromCharCode(92);
