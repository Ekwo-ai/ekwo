/**
 * A company installed at 1.0.0, in a database that then receives this release.
 *
 * The first upgrade is the one nobody can rehearse twice: a company installed
 * before the pack format existed has been booking on those accounts ever
 * since. So nothing here constructs a difference — it replays the four
 * hand-written seeds kept in `tests/fixtures/seeds-before-packs/` since the
 * pack format replaced them, installs a company from them, and loads the packs
 * of this release on top. What comes back is the database an upgrade actually
 * meets.
 *
 * It lives here rather than inside one test file because two of them need it:
 * `tests/pack_upgrade.test.ts` asks what an upgrade would do, and
 * `tests/e2e/lifecycle.test.ts` carries the upgraded company through a whole
 * financial year. A second copy would be a second definition of "the previous
 * version", and the two would drift.
 */

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { freshDatabase, repoRoot } from './db.js';

const seedDir = join(repoRoot, 'supabase', 'seed');
const beforeDir = join(repoRoot, 'tests', 'fixtures', 'seeds-before-packs');

export interface InstalledAtOneZeroZero {
  db: PGlite;
  companyId: string;
  ownerId: string;
}

/** The frozen 1.0.0 seed files of one country, or an empty list. */
export async function frozenSeedsFor(country: string): Promise<string[]> {
  const suffix = `_${country.toLowerCase()}.sql`;
  return (await readdir(beforeDir)).filter((f) => f.endsWith(suffix)).sort();
}

/** Every country the frozen 1.0.0 seeds carry a chart and taxes for. */
export async function countriesFrozenAtOneZeroZero(): Promise<string[]> {
  const files = await readdir(beforeDir);
  const countries = new Set<string>();
  for (const file of files) {
    const match = /_([a-z]{2})\.sql$/.exec(file);
    if (match?.[1] !== undefined) countries.add(match[1].toUpperCase());
  }
  return [...countries].sort();
}

/**
 * Builds it.
 *
 * The two schema changes are the ones `packs.test.ts` makes for the same
 * reason: those seeds were written when a country had one chart of accounts,
 * so they name a key the schema has widened since and point at no chart. The
 * shape is given back to them for the length of the replay and then taken
 * away again, so the files themselves run untouched.
 *
 * `modules` is left to the caller because the two callers differ: an upgrade
 * is asked of an ordinary installation, and the end-to-end test mirrors
 * `ekwo init`, which installs no module.
 */
export async function companyInstalledAtOneZeroZero(
  options: { country?: string; modules?: boolean; name?: string } = {},
): Promise<InstalledAtOneZeroZero> {
  const country = (options.country ?? 'BE').toUpperCase();
  const frozen = await frozenSeedsFor(country);
  if (frozen.length === 0) {
    throw new Error(`no_frozen_seeds: ${country} did not exist at 1.0.0`);
  }

  const pg = await freshDatabase({
    seed: false,
    ...(options.modules === undefined ? {} : { modules: options.modules }),
  });

  await pg.exec(`
    alter table account_templates drop constraint account_templates_chart_fk;
    create unique index account_templates_old_key_idx on account_templates (country, code);
  `);
  await pg.exec(await readFile(join(seedDir, '00_currencies.sql'), 'utf8'));
  for (const file of frozen) {
    await pg.exec(await readFile(join(beforeDir, file), 'utf8'));
  }

  // What migration `20260912095825` did when it introduced charts: one chart
  // per country, from the accounts already loaded. In 1.0.0 that is the whole
  // truth — a country had exactly one.
  await pg.exec(`
    insert into chart_templates (country, code, name, is_default)
    select distinct t.country, t.chart_code, t.chart_code, true
      from account_templates t
    on conflict (country, code) do nothing;
  `);

  const ownerId = crypto.randomUUID();
  await pg.query(`insert into auth.users (id, email) values ($1, $2)`, [
    ownerId,
    `${ownerId}@example.test`,
  ]);
  const company = await pg.query<{ id: string }>(
    `insert into companies (name, country, fiscal_country, currency_code, language)
     select $1, $2, $2, d.currency_code, coalesce(d.language_default, 'fr')
       from country_defaults d where d.country = $2
     returning id`,
    [options.name ?? 'Installed at 1.0.0', country],
  );
  const companyId = company.rows[0]?.id as string;
  await pg.query(`insert into company_members (company_id, user_id, role) values ($1, $2, 'owner')`, [
    companyId,
    ownerId,
  ]);
  await pg.query(`select install_country_template($1, $2)`, [companyId, country]);

  // The schema goes back to what it is, and this release's packs land on top.
  await pg.exec(`
    drop index account_templates_old_key_idx;
    alter table account_templates
      add constraint account_templates_chart_fk
      foreign key (country, chart_code) references chart_templates (country, code);
  `);
  for (const file of (await readdir(seedDir)).filter((f) => f.endsWith('.sql')).sort()) {
    await pg.exec(await readFile(join(seedDir, file), 'utf8'));
  }

  return { db: pg, companyId, ownerId };
}
