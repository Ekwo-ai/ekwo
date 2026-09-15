/**
 * The packs of this repository, read once, for every test that is about the core.
 *
 * A test that names `be` and `fr` by hand does not test the core: it tests two
 * countries somebody remembered to list. The next pack is then a diff across a
 * dozen test files, and — worse — it proves nothing, because nothing checks it.
 * So a test about the core starts here: it walks every pack `listPacks()`
 * finds, and takes its expectation from the pack's own data — a role from the
 * manifest, an account from the chart, a box from the declaration form.
 *
 * Three shapes cover what the tests need:
 *
 * - `allPacks` and `packSlugs`, to loop over everything;
 * - `packWhere`, to pick the pack that carries the property under test — the
 *   one with two charts, the one that taxes on payment, the one that caps a
 *   declining rate — so the test says what it needs instead of which country
 *   happened to have it;
 * - `somePack`, for a test that needs a pack and does not care which: a schema
 *   refusal, a temporary copy to break on purpose.
 *
 * What a pack cannot derive — a fact key of a national taxonomy, an arithmetic
 * a law writes — lives beside the pack in `packs/<cc>/golden/expectations.json`
 * and is read by `expectationsOf`. That file is outside the pack checksum, like
 * the other files under `golden/`: it is evidence about the pack, not part of it.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { listPacks, packsDir, readPack, readSchema, type Pack } from '../../packages/cli/src/index.js';

/** Directory the packs are read from. The one `ekwo pack` itself uses. */
export const packsRoot = packsDir();

/** Every pack of this repository, by directory name, alphabetically. */
export const packSlugs: string[] = await listPacks(packsRoot);

/** The published pack schema, for the enumerations a test must not restate. */
const schema = await readSchema(packsRoot);

/** Every pack, read and validated, in the same order. */
export const allPacks: Pack[] = await Promise.all(packSlugs.map((slug) => readPack(slug, packsRoot)));

/** The ISO country code of every pack, which is what the database stores. */
export const packCountries: string[] = allPacks.map((pack) => pack.manifest.country);

/**
 * The certification statuses the published schema defines.
 *
 * A test that listed them by hand would pass a pack claiming a status the
 * schema never had, and fail the day the schema gained one. It is the schema
 * that says what a pack may claim, so it is the schema that is read.
 */
export const certificationStatuses: string[] = (() => {
  const defs = (schema['$defs'] ?? {}) as Record<string, Record<string, unknown>>;
  const properties = (defs['certification']?.['properties'] ?? {}) as Record<
    string,
    Record<string, unknown>
  >;
  const values = properties['status']?.['enum'];
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error('packs/schema/pack.1.json defines no certification status');
  }
  return values as string[];
})();

/**
 * The kinds of text a source register may hold, from the published schema.
 *
 * Read there for the same reason as the statuses above: the vocabulary is
 * closed so that a register reads the same across countries, and a test that
 * restated it would stop noticing the day a kind was added.
 */
export const sourceKinds: string[] = (() => {
  const defs = (schema['$defs'] ?? {}) as Record<string, Record<string, unknown>>;
  const properties = (defs['source_entry']?.['properties'] ?? {}) as Record<
    string,
    Record<string, unknown>
  >;
  const values = properties['kind']?.['enum'];
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error('packs/schema/pack.1.json defines no kind of source');
  }
  return values as string[];
})();

/**
 * The cadences a declaration form may be filed on, from the published schema.
 *
 * Same reason as the statuses above: a test that listed `month`, `quarter` and
 * `year` by hand would stop noticing the day the schema gained a fourth, and
 * would accept a pack claiming one the schema never had.
 */
export const declarationPeriods: string[] = (() => {
  const defs = (schema['$defs'] ?? {}) as Record<string, Record<string, unknown>>;
  const properties = (defs['defaults']?.['properties'] ?? {}) as Record<
    string,
    Record<string, unknown>
  >;
  const values = properties['vat_period']?.['enum'];
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error('packs/schema/pack.1.json defines no declaration period');
  }
  return values as string[];
})();

/**
 * A pack, any pack.
 *
 * For a test whose subject is the reader and not the country: a manifest field
 * the schema refuses, a golden that is emptied on purpose, a copy of a pack
 * broken in a temporary directory. The first slug alphabetically, so two runs
 * of the suite break the same pack and a failure is reproducible.
 */
export const somePack: Pack = allPacks[0]!;

/**
 * The packs that carry a property, named by what the property is.
 *
 * Throws when no pack has it, rather than passing over an empty loop: a test
 * that silently checked nothing is the failure this file exists to prevent.
 */
export function packsWhere(what: string, holds: (pack: Pack) => boolean): Pack[] {
  const found = allPacks.filter(holds);
  if (found.length === 0) {
    throw new Error(
      `no pack ${what} — this test needs one, and ${packSlugs.join(', ')} were read. ` +
        'Either the property moved, or the pack that carried it changed.',
    );
  }
  return found;
}

/** The first pack that carries a property. Throws, by name, when none does. */
export function packWhere(what: string, holds: (pack: Pack) => boolean): Pack {
  return packsWhere(what, holds)[0]!;
}

/** The pack of a country code, for a row the database already gave back. */
export function packOfCountry(country: string): Pack {
  const pack = allPacks.find((p) => p.manifest.country === country);
  if (pack === undefined) throw new Error(`${country} is not a pack of this repository`);
  return pack;
}

/**
 * What a pack claims that no other pack can claim.
 *
 * `packs/<cc>/golden/expectations.json`, beside the golden scenario: the facts
 * of a national taxonomy, the arithmetic a declaration form owes to its law.
 * Every block is optional and a pack that carries no file at all is read as an
 * empty one — a contributor adds the claims they can state, and nothing under
 * `tests/` changes either way.
 */
export interface PackExpectations {
  /**
   * The key that names a fact, by statement and by line. A national taxonomy
   * is the one thing the pack's own statements cannot check themselves against:
   * `statements.json` is where the key is written, so a test comparing the two
   * would compare a file to itself.
   */
  statement_facts?: Record<string, Record<string, string>>;
  /** Boxes of the periodic return whose value is an arithmetic of other boxes. */
  report_arithmetic?: { box: string; kind: string; plus: string[]; minus: string[] }[];
}

const EXPECTATIONS = new Map<string, PackExpectations>();

/** The claims file of a pack, or an empty one where the pack states none. */
export function expectationsOf(pack: Pack): PackExpectations {
  const held = EXPECTATIONS.get(pack.slug);
  if (held !== undefined) return held;
  const path = join(packsRoot, pack.slug, 'golden', 'expectations.json');
  const read = existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as PackExpectations) : {};
  EXPECTATIONS.set(pack.slug, read);
  return read;
}

/** A role of the manifest — `receivable`, `fx_gain` — as an account code. */
export function roleOf(pack: Pack, role: string): string {
  const code = pack.manifest.defaults.roles[role];
  if (typeof code !== 'string' || code === '') {
    throw new Error(`packs/${pack.slug} names no account for the role ${role}`);
  }
  return code;
}

/** The default chart of a pack: the one a company installs when it says nothing. */
export function defaultChartOf(pack: Pack): Pack['charts'][number] {
  return pack.charts.find((chart) => chart.is_default) ?? pack.charts[0]!;
}
