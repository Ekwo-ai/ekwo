/**
 * The reference data of an installation, rendered so two of them can be
 * compared character for character.
 *
 * The claim the end-to-end test makes is that `ekwo init` and `supabase db
 * push` + `psql -f` leave the same installation behind. "The same" has to mean
 * something a machine can check, and a row count does not: a chart with the
 * right number of wrong accounts passes it. So every row of every table the
 * seeds write is rendered as JSON, the rows are sorted by their own text, and
 * the two strings are compared.
 *
 * Three kinds of column are left out, and each for a reason that would
 * otherwise make the comparison meaningless rather than strict:
 *
 *   - `id`, when it is a surrogate key with `gen_random_uuid()` behind it. Two
 *     installations cannot agree on a random number and are not meant to.
 *   - the clock: `created_at`, `updated_at`, and `installed_at`, which is when
 *     this installation loaded a pack rather than anything about the pack. It
 *     is the only column the two paths were ever found to disagree on, and
 *     they disagree by the milliseconds between the two runs.
 *
 * A uuid column that is *not* one of those is a foreign key to another
 * template, and comparing it would compare two random numbers and call them
 * equal. Rather than guess, `canonicalDump` refuses a column it has no natural
 * key for: the list below is the exhaustive set, and a migration that adds a
 * reference between two template tables fails this test until it is named
 * here. That is the intended behaviour.
 */

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { repoRoot } from '../helpers/db.js';

const seedDir = join(repoRoot, 'supabase', 'seed');
const configPath = join(repoRoot, 'supabase', 'config.toml');

/** Columns whose value is the clock or a random number, everywhere. */
const VOLATILE = ['id', 'created_at', 'updated_at', 'installed_at', 'upgraded_at'];

/**
 * `table.column` → the SQL that renders it as the key a human would use.
 *
 * `$.` stands for the row of the table being dumped, which is aliased `src`
 * so that a sub-select may bind an alias of its own.
 */
const NATURAL_KEYS: Record<string, string> = {
  'tax_posting_templates.tax_template_id':
    "(select tt.country || '/' || tt.code from tax_templates tt where tt.id = $.tax_template_id)",
};

/** The seed files the installer applies, in order, demo data left out. */
export async function installerSeedFiles(): Promise<string[]> {
  return (await readdir(seedDir))
    .filter((f) => f.endsWith('.sql') && f !== '90_demo_company.sql')
    .sort();
}

/**
 * The seed files `supabase db reset` applies, read from `config.toml`.
 *
 * This is the list an operator following the README copies into `psql -f`, and
 * the one the Supabase CLI itself uses. If it ever stops matching the
 * installer's own list, the two install paths diverge silently — which is what
 * the test that reads this is for.
 */
export async function configuredSeedFiles(): Promise<string[]> {
  const toml = await readFile(configPath, 'utf8');
  const block = /sql_paths\s*=\s*\[([^\]]*)\]/.exec(toml);
  if (block?.[1] === undefined) throw new Error('config.toml declares no [db.seed].sql_paths');
  return [...block[1].matchAll(/"([^"]+)"/g)].map((m) => (m[1] as string).replace(/^.*\//, ''));
}

/**
 * Every table the seeds write into, read from the seeds themselves.
 *
 * Not a list written down here: a list written down here is one a new pack
 * section would quietly fall out of. The module seeds under `seed/modules/`
 * are not included — they write into a module's own schema, and neither
 * install path applies them (`ekwo migrate` does, on request).
 */
export async function seededTables(): Promise<string[]> {
  const tables = new Set<string>();
  for (const file of await installerSeedFiles()) {
    const sql = await readFile(join(seedDir, file), 'utf8');
    for (const match of sql.matchAll(/insert\s+into\s+([a-z_][a-z0-9_]*)/gi)) {
      tables.add((match[1] as string).toLowerCase());
    }
  }
  return [...tables].sort();
}

interface Column {
  column_name: string;
  data_type: string;
}

/** The rendered reference data of one installation. */
export async function canonicalDump(pg: PGlite, tables: string[]): Promise<string> {
  const out: string[] = [];
  for (const table of tables) {
    const columns = (
      await pg.query<Column>(
        `select column_name, data_type from information_schema.columns
          where table_schema = 'public' and table_name = $1
          order by ordinal_position`,
        [table],
      )
    ).rows;
    if (columns.length === 0) throw new Error(`no such table to dump: ${table}`);

    const dropped = [...VOLATILE];
    const added: string[] = [];
    for (const column of columns) {
      if (VOLATILE.includes(column.column_name)) continue;
      if (column.data_type !== 'uuid') continue;
      const natural = NATURAL_KEYS[`${table}.${column.column_name}`];
      if (natural === undefined) {
        throw new Error(
          `${table}.${column.column_name} is a uuid with no natural key: two installations ` +
            'cannot agree on a random number. Name it in NATURAL_KEYS.',
        );
      }
      dropped.push(column.column_name);
      added.push(`'${column.column_name}', ${natural.replaceAll('$.', 'src.')}`);
    }

    const value =
      `(to_jsonb(src) - '{${dropped.join(',')}}'::text[])` +
      (added.length === 0 ? '' : ` || jsonb_build_object(${added.join(', ')})`);
    const dump = (
      await pg.query<{ dump: string | null }>(
        `select coalesce(string_agg(line, E'\\n' order by line), '') as dump
           from (select (${value})::text as line from ${table} src) s`,
      )
    ).rows[0];
    out.push(`-- ${table}\n${dump?.dump ?? ''}`);
  }
  return out.join('\n');
}

/** How many rows each dumped table holds, for a report a human can read. */
export async function rowCounts(pg: PGlite, tables: string[]): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of tables) {
    const row = (await pg.query<{ n: number }>(`select count(*)::int as n from ${table}`)).rows[0];
    counts[table] = row?.n ?? 0;
  }
  return counts;
}
