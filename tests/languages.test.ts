import type { PGlite } from '@electric-sql/pglite';
import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readPack } from '../packages/cli/src/index.js';
import { asUser, freshDatabase, one, repoRoot, rows, seedFiles } from './helpers/db.js';
import { newUser } from './helpers/factory.js';
import { allPacks, packWhere, packsRoot, somePack } from './helpers/packs.js';

// A label a user reads is data, in every language the pack publishes.
//
// The schema was already bilingual in shape — `name` plus `name_i18n` — and
// monolingual in fact: the four language files were empty, so a company keeping
// its books in a second national language was handed a chart of accounts, a set
// of journals and a declaration form in the first. These tests hold three
// things: that a declared language covers everything, that the resolution picks
// the right one, and that the seeds can be applied twice.
//
// Every claim here is made of every pack `listPacks()` finds and read from the
// pack's own manifest, so a new country is covered the day it lands.

const packs = packsRoot;

let db: PGlite;

beforeAll(async () => {
  db = await freshDatabase();
}, 120_000);

afterAll(async () => {
  await db.close();
});

/** The languages of a pack, and the keys each section of it must translate. */
function sectionsOf(pack: (typeof allPacks)[number]): [string, string[]][] {
  return [
    ['charts', pack.charts.map((c) => c.code)],
    ['accounts', [...new Set(pack.charts.flatMap((c) => c.accounts.map((a) => a.code)))]],
    ['journals', pack.manifest.journals.map((j) => j.code)],
    ['taxes', pack.taxes.map((t) => t.code)],
    ['tax_report_boxes', (pack.report?.boxes ?? []).map((b) => `${b.box}|${b.kind}`)],
    ['statement_lines', pack.statements.flatMap((st) => st.lines.map((l) => `${st.code}:${l.code}`))],
    ['legal_mentions', pack.documents.mentions.map((m) => m.code)],
    ['asset_categories', (pack.assets?.categories ?? []).map((c) => c.code)],
  ];
}

describe('what a pack promises when it declares a language', () => {
  it('covers every label of every section, in every language it declares', async () => {
    // A pack that declares no other language has promised nothing and owes
    // nothing: its own labels are already in the one language it has, which is
    // the ordinary case for a pack written in English. What is asserted is the
    // promise, and that at least one pack in the repository makes one.
    expect(
      allPacks.some((pack) => (pack.manifest.languages ?? []).length > 0),
      'no pack of this repository declares a second language',
    ).toBe(true);

    for (const pack of allPacks) {
      const declared = pack.manifest.languages ?? [];

      for (const language of declared) {
        expect(pack.labels.pack_name[language], `${pack.slug} ${language}`).toBeTruthy();
        for (const [name, keys] of sectionsOf(pack)) {
          const held = pack.labels[name as keyof typeof pack.labels] as Record<
            string,
            Record<string, string>
          >;
          const missing = keys.filter((key) => held[key]?.[language] === undefined);
          expect(missing, `${pack.slug} ${language} ${name}`).toEqual([]);
        }
      }
    }
  });

  it('never lists the language the pack is written in', async () => {
    for (const pack of allPacks) {
      expect(pack.manifest.languages ?? [], pack.slug).not.toContain(pack.manifest.defaults.language);
    }
  });

  // The refusals below are about the reader, not about a country: they break a
  // pack on purpose and read the message back. `somePack` is whichever pack
  // comes first, so the failure is reproducible and no country is named.
  const broken = somePack;
  const brokenLanguages = broken.manifest.languages ?? [];

  /** A copy of `packs/`, with one language file of `somePack` patched. */
  async function packWithout(
    language: string,
    patch: (file: Record<string, unknown>) => Record<string, unknown> | undefined,
  ): Promise<void> {
    const dir = await mkdtemp(join(tmpdir(), 'ekwo-lang-'));
    await cp(join(packs, 'schema'), join(dir, 'schema'), { recursive: true });
    await cp(join(packs, broken.slug), join(dir, broken.slug), { recursive: true });
    const path = join(dir, broken.slug, 'i18n', `${language}.json`);
    const file = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
    const next = patch(file);
    if (next !== undefined) await writeFile(path, JSON.stringify(next), 'utf8');
    await readPack(broken.slug, dir);
  }

  it('fails on a truncated language file, and names what is missing', async () => {
    const language = brokenLanguages[0]!;
    const codes = [...new Set(broken.charts.flatMap((c) => c.accounts.map((a) => a.code)))];
    const [first, second] = [codes[0]!, codes[1]!];

    const error = await packWithout(language, (file) => {
      const accounts = { ...(file['accounts'] as Record<string, string>) };
      delete accounts[first];
      delete accounts[second];
      return { ...file, accounts };
    }).catch((e: unknown) => e as Error);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(new RegExp(`i18n/${language}\\.json accounts`));
    expect((error as Error).message).toMatch(
      new RegExp(`2 of ${codes.length} missing: ${first}, ${second}`),
    );
  });

  it('fails when a whole section of a declared language is gone', async () => {
    const language = brokenLanguages[brokenLanguages.length - 1]!;
    const journals = broken.manifest.journals.length;
    const error = await packWithout(language, (file) => ({ ...file, journals: {} })).catch(
      (e: unknown) => e as Error,
    );
    expect((error as Error).message).toMatch(
      new RegExp(`i18n/${language}\\.json journals: ${journals} of ${journals} missing`),
    );
  });

  it('fails when the pack name of a declared language is gone', async () => {
    const language = brokenLanguages[0]!;
    const error = await packWithout(language, (file) => {
      const { pack_name: _dropped, ...rest } = file;
      return rest;
    }).catch((e: unknown) => e as Error);
    expect((error as Error).message).toMatch(new RegExp(`i18n/${language}\\.json: pack_name is missing`));
  });

  it('refuses a label under a code the pack does not carry', async () => {
    const language = brokenLanguages[0]!;
    const error = await packWithout(language, (file) => ({
      ...file,
      accounts: { ...(file['accounts'] as Record<string, string>), '999999': 'Iets' },
    })).catch((e: unknown) => e as Error);
    expect((error as Error).message).toMatch(/999999 is not an account of this pack/);
  });

  it('refuses a language declared in the manifest with no file behind it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ekwo-lang-'));
    await cp(join(packs, 'schema'), join(dir, 'schema'), { recursive: true });
    await cp(join(packs, broken.slug), join(dir, broken.slug), { recursive: true });
    const path = join(dir, broken.slug, 'pack.json');
    const manifest = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
    // `it` is Italian, which no pack of this repository publishes: a language
    // declared with nothing behind it is the case under test.
    manifest['languages'] = [...brokenLanguages, 'it'];
    await writeFile(path, JSON.stringify(manifest), 'utf8');

    const error = await readPack(broken.slug, dir).catch((e: unknown) => e as Error);
    expect((error as Error).message).toMatch(
      new RegExp(`it is declared and packs/${broken.slug}/i18n/it\\.json does not exist`),
    );
  });
});

describe('what the seeds carry', () => {
  /** The languages of a pack as a JSON array, so no code is spliced into SQL. */
  const declaredOf = (pack: (typeof allPacks)[number]): string =>
    JSON.stringify(pack.manifest.languages ?? []);

  it('gives every template of every pack the languages its manifest declares', async () => {
    for (const pack of allPacks) {
      const languages = declaredOf(pack);
      const untranslated = `not (name_i18n ?& (select array_agg(x)
             from jsonb_array_elements_text($2::jsonb) as t(x)))`;
      const [accounts, journals, taxes] = await Promise.all([
        one<{ n: number }>(
          db,
          `select count(*)::int as n from account_templates
            where country = $1 and ${untranslated}`,
          [pack.manifest.country, languages],
        ),
        one<{ n: number }>(
          db,
          `select count(*)::int as n from journal_templates
            where country = $1 and ${untranslated}`,
          [pack.manifest.country, languages],
        ),
        one<{ n: number }>(
          db,
          `select count(*)::int as n from tax_templates
            where country = $1 and ${untranslated}`,
          [pack.manifest.country, languages],
        ),
      ]);
      expect(
        { accounts: accounts.n, journals: journals.n, taxes: taxes.n },
        pack.slug,
      ).toEqual({ accounts: 0, journals: 0, taxes: 0 });
    }
  });

  it('and carries no language the manifest does not declare', async () => {
    // The other half of the claim above: a label under a language nobody
    // declared is a label nobody maintains, and `ekwo init` would offer it.
    for (const pack of allPacks) {
      const declared = [...(pack.manifest.languages ?? [])].sort();
      for (const table of ['account_templates', 'journal_templates', 'tax_templates']) {
        const row = await one<{ keys: string[] | null }>(
          db,
          `select array_agg(distinct k order by k) as keys
             from ${table} t, jsonb_object_keys(t.name_i18n) k
            where t.country = $1`,
          [pack.manifest.country],
        );
        expect(row.keys ?? [], `${pack.slug} ${table}`).toEqual(declared);
      }
    }
  });

  it('names the country itself in every language the pack publishes', async () => {
    const defaults = await rows<{ country: string; name: string; name_i18n: Record<string, string> }>(
      db,
      `select country, name, name_i18n from country_defaults order by country`,
    );
    expect(defaults.map((d) => d.country)).toEqual(
      allPacks.map((p) => p.manifest.country).sort(),
    );
    for (const pack of allPacks) {
      const row = defaults.find((d) => d.country === pack.manifest.country)!;
      expect(row.name, pack.slug).toBe(pack.manifest.name);
      expect(row.name_i18n, pack.slug).toEqual(pack.labels.pack_name);
      expect(Object.keys(row.name_i18n).sort(), pack.slug).toEqual(
        [...(pack.manifest.languages ?? [])].sort(),
      );
    }
  });

  it('carries the legal mentions and the asset categories in those languages', async () => {
    for (const pack of allPacks) {
      const declared = [...(pack.manifest.languages ?? [])].sort();
      for (const mention of pack.documents.mentions) {
        const row = await one<{ text_i18n: Record<string, string> }>(
          db,
          `select text_i18n from legal_mention_templates where country = $1 and code = $2`,
          [pack.manifest.country, mention.code],
        );
        expect(Object.keys(row.text_i18n).sort(), `${pack.slug} ${mention.code}`).toEqual(declared);
      }
      for (const category of pack.assets?.categories ?? []) {
        const row = await one<{ name_i18n: Record<string, string> }>(
          db,
          `select name_i18n from assets.category_templates where country = $1 and code = $2`,
          [pack.manifest.country, category.code],
        );
        // A pack with no translation file carries no labels for the category,
        // and the column holds an empty object rather than nothing.
        expect(row.name_i18n, `${pack.slug} ${category.code}`).toEqual(
          pack.labels.asset_categories[category.code] ?? {},
        );
      }
    }
  });

  it('is replayed without changing a row', async () => {
    const before = await one<{ digest: string }>(
      db,
      `select md5(string_agg(country || code || name || name_i18n::text, '|' order by country, code))
              as digest
         from account_templates`,
    );
    for (const file of await seedFiles()) {
      await db.exec(await readFile(join(repoRoot, 'supabase', 'seed', file), 'utf8'));
    }
    const after = await one<{ digest: string }>(
      db,
      `select md5(string_agg(country || code || name || name_i18n::text, '|' order by country, code))
              as digest
         from account_templates`,
    );
    expect(after.digest).toBe(before.digest);
  });
});

describe('how one label is picked', () => {
  it('takes the first language of the list that has one', async () => {
    const row = await one<{ nl: string; de: string; fallback: string }>(
      db,
      `select label_for('Clients', '{"nl": "Handelsdebiteuren", "de": "Kunden"}'::jsonb, array['nl']) as nl,
              label_for('Clients', '{"nl": "Handelsdebiteuren", "de": "Kunden"}'::jsonb, array['de', 'nl']) as de,
              label_for('Clients', '{"nl": "Handelsdebiteuren"}'::jsonb, array['it']) as fallback`,
    );
    expect(row).toEqual({ nl: 'Handelsdebiteuren', de: 'Kunden', fallback: 'Clients' });
  });

  it('follows the user, then the company, then the country pack', async () => {
    // Two declared languages: one the company keeps its books in, one the
    // reader prefers. The pack that publishes the most is the one that can
    // tell the three levels of the chain apart.
    const pack = packWhere(
      'publishes two languages besides its own',
      (p) => (p.manifest.languages ?? []).length >= 2,
    );
    const [bookkeeping, preferred] = pack.manifest.languages as [string, string];
    const own = pack.manifest.defaults.language as string;
    const account = [...new Set(pack.charts.flatMap((c) => c.accounts.map((a) => a.code)))][0]!;
    const chart = (pack.charts.find((c) => c.is_default) ?? pack.charts[0]!).code;

    await db.exec('begin');
    const user = await newUser(db, 'reader@example.test');
    const company = await one<{ id: string }>(
      db,
      `insert into companies (name, country, fiscal_country, currency_code, language)
       values ('Leesbaar BV', $1, $1, $2, $3) returning id`,
      [pack.manifest.country, pack.manifest.defaults.currency, bookkeeping],
    );

    // Nothing chosen: the company's language, then the pack's.
    const fromCompany = await asUser(db, user, () =>
      one<{ languages: string[] }>(db, `select preferred_languages($1) as languages`, [company.id]),
    );
    expect(fromCompany.languages).toEqual([bookkeeping, own]);

    // The reader prefers the second one, and it comes first.
    await asUser(db, user, () =>
      db.query(`select set_preferences(jsonb_build_object('language', $1::text))`, [preferred]),
    );
    const fromUser = await asUser(db, user, () =>
      one<{ languages: string[] }>(db, `select preferred_languages($1) as languages`, [company.id]),
    );
    expect(fromUser.languages).toEqual([preferred, bookkeeping, own]);

    // And that chain, read against a template, answers in the reader's language.
    const label = await one<{ label: string }>(
      db,
      `select label_for(t.name, t.name_i18n, array[$1, $2, $3]::text[]) as label
         from account_templates t
        where t.country = $4 and t.chart_code = $5 and t.code = $6`,
      [preferred, bookkeeping, own, pack.manifest.country, chart, account],
    );
    expect(label.label).toBe(pack.labels.accounts[account]?.[preferred]);
    await db.exec('rollback');
  });
});
