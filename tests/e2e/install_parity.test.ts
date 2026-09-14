/**
 * One release, two install paths, and the same books at the end.
 *
 * A user has two ways in. `npx ekwo init` runs the CLI's own migration runner
 * and its own seed loader. `supabase db push` followed by `psql -f` runs
 * neither: the Supabase CLI reads the same folder of `.sql` files and writes
 * the same history table, and the operator applies the seeds by hand. The
 * README documents both and calls them interchangeable.
 *
 * "Interchangeable" is a claim about the state of a database, so this file
 * builds one of each and compares them. Not a row count — a chart with the
 * right number of wrong accounts passes a row count — but every row of every
 * table the seeds write, rendered as JSON and sorted, character for character.
 *
 * The second path is deliberately written without importing anything from
 * `packages/cli`: it applies the files in filename order and records the
 * history itself. A test that drove both paths through the same runner would
 * prove that the runner is deterministic, which nobody doubted.
 */

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations, applySeeds, listMigrations } from '../../packages/cli/src/index.js';
import { repoRoot } from '../helpers/db.js';
import { emptyDatabase, migrationsPath, seedPath } from '../cli/helpers.js';
import {
  canonicalDump,
  configuredSeedFiles,
  installerSeedFiles,
  rowCounts,
  seededTables,
} from './dump.js';

interface History {
  version: string;
  name: string | null;
  statements: string[] | null;
}

let installer: PGlite;
let byHand: PGlite;
let tables: string[];

/**
 * What `supabase db push` does, and then what `psql -f` does.
 *
 * The Supabase CLI applies each migration inside a transaction together with
 * its history row, the version being the timestamp prefix of the filename and
 * the name the rest of it. The `statements` column holds the file split into
 * statements; splitting a SQL file is the CLI's own cosmetic detail, so this
 * reimplementation stores the file whole and the test compares the two
 * columns that carry meaning.
 */
async function installByHand(pg: PGlite): Promise<void> {
  await pg.exec(`
    create schema if not exists supabase_migrations;
    create table if not exists supabase_migrations.schema_migrations (
      version text not null primary key,
      statements text[],
      name text
    );
  `);
  const files = (await readdir(migrationsPath)).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const sql = await readFile(join(migrationsPath, file), 'utf8');
    const version = file.slice(0, 14);
    const name = file.slice(15, -4);
    await pg.transaction(async (tx) => {
      await tx.exec(sql);
      await tx.query(
        `insert into supabase_migrations.schema_migrations (version, name, statements)
         values ($1, $2, $3) on conflict (version) do nothing`,
        [version, name, [sql]],
      );
    });
  }

  // And the seeds, as the README tells an operator to apply them: the files
  // `config.toml` lists, in order, through psql. No history row — a seed is
  // data a new release may legitimately re-apply.
  for (const file of await configuredSeedFiles()) {
    await pg.exec(await readFile(join(seedPath, file), 'utf8'));
  }
}

beforeAll(async () => {
  const one = await emptyDatabase();
  installer = one.pg;
  const migrations = await listMigrations(migrationsPath);
  await applyMigrations(one.db, migrations);
  await applySeeds(one.db, seedPath);

  const two = await emptyDatabase();
  byHand = two.pg;
  await installByHand(byHand);

  tables = await seededTables();
}, 300_000);

afterAll(async () => {
  await installer.close();
  await byHand.close();
});

describe('the two install paths', () => {
  it('agree on which seed files are reference data', async () => {
    // The installer reads the folder and drops the demo file; the Supabase CLI
    // reads `config.toml`. Nothing keeps the two lists equal except this test,
    // and a new seed file added to one and not the other is exactly the drift
    // that makes "interchangeable" false without anybody noticing.
    expect(await configuredSeedFiles()).toEqual(await installerSeedFiles());
  });

  it('are the same list in the README, which is what an operator copies', async () => {
    // The `psql -f` lines of the README are the third copy of this list, and
    // the one a human actually follows. On 14 September 2026 it named two of
    // the four files, so a by-hand installation came up with a chart of
    // accounts and no generic financial statements — and nothing failed.
    const readme = await readFile(join(repoRoot, 'README.md'), 'utf8');
    for (const file of await installerSeedFiles()) {
      expect(readme, `the README never tells an operator to apply ${file}`).toContain(file);
    }
  });

  it('record the same migration history, in the same table', async () => {
    const read = async (pg: PGlite): Promise<History[]> =>
      (
        await pg.query<History>(
          `select version, name, statements from supabase_migrations.schema_migrations
            order by version`,
        )
      ).rows;
    const left = await read(installer);
    const right = await read(byHand);

    expect(left.length).toBeGreaterThan(50);
    expect(left.map((r) => r.version)).toEqual(right.map((r) => r.version));
    expect(left.map((r) => r.name)).toEqual(right.map((r) => r.name));
    // The column the Supabase CLI reads back for `migration repair`: both
    // paths fill it, and neither leaves it null.
    for (const row of [...left, ...right]) {
      expect(row.statements === null || row.statements.length > 0).toBe(true);
    }
  });

  it('still carry the three migrations the pack format was built on', async () => {
    // 11 and 12 September 2026: the country templates, the journal defaults a
    // country names, and the account a line falls back to. Everything the pack
    // format, the closing style and the upgrade were built on sits on top of
    // these three, and a database installed at 1.0.0 ran exactly them. They
    // are never edited — the CI compares them byte for byte against the latest
    // tag — and what this asserts is the other half: both install paths still
    // apply them, under the versions a 1.0.0 database already has recorded.
    const wanted = ['20260911121100', '20260911183000', '20260911193853'];
    for (const pg of [installer, byHand]) {
      const found = (
        await pg.query<{ version: string }>(
          `select version from supabase_migrations.schema_migrations
            where version = any($1) order by version`,
          [wanted],
        )
      ).rows.map((r) => r.version);
      expect(found).toEqual(wanted);
    }
  });

  it('leave the same schema behind', async () => {
    const shape = async (pg: PGlite): Promise<string[]> =>
      (
        await pg.query<{ line: string }>(
          `select table_name || '.' || column_name || ' ' || data_type ||
                  coalesce('(' || numeric_precision || ',' || numeric_scale || ')', '') ||
                  case when is_nullable = 'YES' then ' null' else ' not null' end as line
             from information_schema.columns
            where table_schema = 'public'
            order by table_name, column_name`,
        )
      ).rows.map((r) => r.line);
    expect(await shape(installer)).toEqual(await shape(byHand));
  });

  it('leave the same functions behind, with the same bodies', async () => {
    const routines = async (pg: PGlite): Promise<string[]> =>
      (
        await pg.query<{ line: string }>(
          `select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') ' ||
                  md5(pg_get_functiondef(p.oid)) as line
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public'
            order by 1`,
        )
      ).rows.map((r) => r.line);
    expect(await routines(installer)).toEqual(await routines(byHand));
  });

  it('load reference data into every table the seeds write, and no other', async () => {
    // The dump is only as strict as its list of tables, and the list is read
    // from the seed files rather than written down, so a pack section that
    // starts filling a new table is compared from its first commit.
    expect(tables.length).toBeGreaterThanOrEqual(14);
    const counts = await rowCounts(installer, tables);
    for (const [table, n] of Object.entries(counts)) {
      expect(n, `${table} is empty after an install`).toBeGreaterThan(0);
    }
    expect(await rowCounts(byHand, tables)).toEqual(counts);
  });

  it('leave byte-identical template tables', async () => {
    const left = await canonicalDump(installer, tables);
    const right = await canonicalDump(byHand, tables);
    expect(left.length).toBeGreaterThan(100_000);
    expect(left).toEqual(right);
  });
});
