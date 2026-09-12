import type { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshDatabase, one, repoRoot, seedFiles } from './helpers/db.js';

// The reference seeds are applied by `ekwo init` and by `supabase db push`,
// and either can run again on a database that already has them — a second
// install, a re-link, a curious operator. Every reference seed must therefore
// leave the template tables exactly as it found them the second time round.
// This was not true on the first real installation (11 September 2026): the
// tax postings had no conflict target, and the second run failed half-way.

const TEMPLATE_TABLES = [
  'currencies',
  'account_templates',
  'journal_templates',
  'tax_templates',
  'tax_posting_templates',
  'tax_report_templates',
  'tax_report_box_templates',
  'country_defaults',
];

let db: PGlite;

beforeAll(async () => {
  db = await freshDatabase();
});

afterAll(async () => {
  await db.close();
});

async function counts(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const table of TEMPLATE_TABLES) {
    const row = await one<{ n: number }>(db, `select count(*)::int as n from ${table}`);
    out[table] = row.n;
  }
  return out;
}

describe('reference seeds', () => {
  it('leave every template table unchanged when applied a second time', async () => {
    const before = await counts();
    expect(before.tax_posting_templates).toBeGreaterThan(100);

    for (const file of await seedFiles()) {
      if (file.startsWith('90_')) continue; // the demo company is not a reference seed
      const sql = await readFile(join(repoRoot, 'supabase', 'seed', file), 'utf8');
      await db.exec(sql);
    }

    expect(await counts()).toEqual(before);
  });

  it('give every tax posting template a natural key', async () => {
    const row = await one<{ n: number }>(
      db,
      `select count(*)::int as n
         from pg_indexes
        where tablename = 'tax_posting_templates'
          and indexname = 'tax_posting_templates_natural_key_idx'`,
    );
    expect(row.n).toBe(1);
  });
});
