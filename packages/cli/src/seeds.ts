/**
 * Reference data.
 *
 * `supabase/seed/*.sql` fills the template tables — currencies, the Belgian
 * and French charts of accounts, their VAT codes — from which
 * `install_country_template()` gives each company its own copy. Every file is
 * written with `on conflict do nothing`, so applying them twice changes
 * nothing, and they are deliberately *not* recorded in the migration history:
 * they are data a new release may legitimately re-apply.
 *
 * `90_demo_company.sql` is not reference data and never runs here. It is
 * sample data, it invents a company and a fictional administrator, and it
 * only ever runs through `ekwo demo`.
 */

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { DEMO_SEED } from './bundle.js';
import type { SqlClient } from './sql.js';

export interface Seed {
  file: string;
  path: string;
}

/** The reference seeds, in order, with the demo file left out. */
export async function listSeeds(dir: string): Promise<Seed[]> {
  const files = (await readdir(dir))
    .filter((f) => f.endsWith('.sql') && f !== DEMO_SEED)
    .sort();
  return files.map((file) => ({ file, path: join(dir, file) }));
}

export async function applySeed(db: SqlClient, seed: Seed): Promise<void> {
  const sql = await readFile(seed.path, 'utf8');
  try {
    await db.exec(sql);
  } catch (error) {
    throw new Error(`seed_failed: ${seed.file} — ${(error as Error).message}`);
  }
}

/** Applies every reference seed, reporting each as it lands. */
export async function applySeeds(
  db: SqlClient,
  dir: string,
  onApplied?: (seed: Seed) => void,
): Promise<Seed[]> {
  const seeds = await listSeeds(dir);
  for (const seed of seeds) {
    await applySeed(db, seed);
    onApplied?.(seed);
  }
  return seeds;
}

/** The demo company, on explicit request only. */
export async function applyDemoSeed(db: SqlClient, dir: string): Promise<void> {
  await applySeed(db, { file: DEMO_SEED, path: join(dir, DEMO_SEED) });
}
