import { cp, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { compilePack, packsDir, readPack } from '../../packages/cli/src/index.js';

/**
 * A country pack that exists only for the length of a test.
 *
 * Rounding cannot be tested honestly against the packs this repository ships,
 * because both of them are in euros and both round half up — so every figure
 * in every other test file is right whether the engine reads
 * `currencies.decimal_places` or assumes two. What is needed is a country
 * whose currency is not written with cents, and inventing one is not something
 * a published pack may do: `packs/` is the law of real places.
 *
 * So the fixture is built at test time. It is the Belgian pack — a real chart,
 * real taxes with real postings, a real declaration form — moved to a country
 * code that exists nowhere, given a currency of its own and, if the test asks,
 * a different rounding method. Every identifier that carried the Belgian
 * prefix is renamed with it, because a statement template is keyed by its code
 * alone and the fixture must not overwrite the pack it was copied from.
 *
 * What it proves is therefore the whole chain and not a toy: the same
 * postings, the same declaration boxes and the same closing style that
 * `posting.test.ts` exercises in euros, exercised in a currency that has no
 * decimal at all.
 */
export interface FixturePack {
  /** Two letters ISO 3166 never assigns, so nothing real is shadowed. */
  country: string;
  /** Three letters ISO 4217 never assigns. */
  currency: string;
  currencyName: string;
  /** 0 for a yen-like currency, 3 for a dinar-like one. */
  decimals: number;
  /** Defaults to the method the copied pack declares. */
  roundingMethod?: 'half_up' | 'half_even' | 'down' | 'up';
}

/** Reads the Belgian pack, renames it, and applies the seed it compiles to. */
export async function installFixturePack(db: PGlite, fixture: FixturePack): Promise<void> {
  const slug = fixture.country.toLowerCase();
  const dir = await mkdtemp(join(tmpdir(), 'ekwo-rounding-'));
  await cp(join(packsDir(), 'schema'), join(dir, 'schema'), { recursive: true });
  await cp(join(packsDir(), 'be'), join(dir, slug), { recursive: true });

  // Every code in the pack is prefixed by the country it belongs to, and a
  // statement template is keyed by its code and by nothing else.
  for (const entry of await readdir(join(dir, slug), { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const path = join(entry.parentPath, entry.name);
    const text = await readFile(path, 'utf8');
    await writeFile(path, text.replaceAll('"BE-', `"${fixture.country}-`), 'utf8');
  }

  const manifestPath = join(dir, slug, 'pack.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>;
  manifest['country'] = fixture.country;
  manifest['name'] = `${fixture.currency} test country`;
  const defaults = manifest['defaults'] as Record<string, unknown>;
  defaults['currency'] = fixture.currency;
  if (fixture.roundingMethod !== undefined) defaults['rounding_method'] = fixture.roundingMethod;
  await writeFile(manifestPath, JSON.stringify(manifest), 'utf8');

  // The currency has to exist before the country model can name it.
  await db.query(
    `insert into currencies (code, name, decimal_places) values ($1, $2, $3)
     on conflict (code) do update set decimal_places = excluded.decimal_places`,
    [fixture.currency, fixture.currencyName, fixture.decimals],
  );

  await db.exec(compilePack(await readPack(slug, dir)));
}
