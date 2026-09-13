import type { PGlite } from '@electric-sql/pglite';
import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readPack } from '../packages/cli/src/index.js';
import { asUser, freshDatabase, one, repoRoot, rows, seedFiles } from './helpers/db.js';
import { newUser } from './helpers/factory.js';

// A label a user reads is data, in every language the pack publishes.
//
// The schema was already bilingual in shape — `name` plus `name_i18n` — and
// monolingual in fact: the four language files were empty, so a Belgian
// company keeping its books in Dutch was handed a chart of accounts, a set of
// journals and a declaration form in French. These tests hold three things:
// that a declared language covers everything, that the resolution picks the
// right one, and that the seeds can be applied twice.

const packs = join(repoRoot, 'packs');

let db: PGlite;

beforeAll(async () => {
  db = await freshDatabase();
}, 120_000);

afterAll(async () => {
  await db.close();
});

describe('what a pack promises when it declares a language', () => {
  it('covers every label of every section, in every language it declares', async () => {
    for (const slug of ['be', 'fr']) {
      const pack = await readPack(slug, packs);
      const declared = pack.manifest.languages ?? [];
      expect(declared.length, slug).toBeGreaterThan(0);

      const sections: [string, string[]][] = [
        ['charts', pack.charts.map((c) => c.code)],
        ['accounts', [...new Set(pack.charts.flatMap((c) => c.accounts.map((a) => a.code)))]],
        ['journals', pack.manifest.journals.map((j) => j.code)],
        ['taxes', pack.taxes.map((t) => t.code)],
        ['tax_report_boxes', (pack.report?.boxes ?? []).map((b) => `${b.box}|${b.kind}`)],
        [
          'statement_lines',
          pack.statements.flatMap((st) => st.lines.map((l) => `${st.code}:${l.code}`)),
        ],
        ['legal_mentions', pack.documents.mentions.map((m) => m.code)],
        ['asset_categories', (pack.assets?.categories ?? []).map((c) => c.code)],
      ];

      for (const language of declared) {
        expect(pack.labels.pack_name[language], `${slug} ${language}`).toBeTruthy();
        for (const [name, keys] of sections) {
          const held = pack.labels[name as keyof typeof pack.labels] as Record<
            string,
            Record<string, string>
          >;
          const missing = keys.filter((key) => held[key]?.[language] === undefined);
          expect(missing, `${slug} ${language} ${name}`).toEqual([]);
        }
      }
    }
  });

  it('never lists the language the pack is written in', async () => {
    for (const slug of ['be', 'fr']) {
      const pack = await readPack(slug, packs);
      expect(pack.manifest.languages, slug).not.toContain(pack.manifest.defaults.language);
    }
  });

  /** A copy of `packs/`, with one language file of Belgium patched. */
  async function beWith(
    language: string,
    patch: (file: Record<string, unknown>) => Record<string, unknown> | undefined,
  ): Promise<void> {
    const dir = await mkdtemp(join(tmpdir(), 'ekwo-lang-'));
    await cp(join(packs, 'schema'), join(dir, 'schema'), { recursive: true });
    await cp(join(packs, 'be'), join(dir, 'be'), { recursive: true });
    const path = join(dir, 'be', 'i18n', `${language}.json`);
    const file = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
    const next = patch(file);
    if (next !== undefined) await writeFile(path, JSON.stringify(next), 'utf8');
    await readPack('be', dir);
  }

  it('fails on a truncated language file, and names what is missing', async () => {
    const error = await beWith('nl', (file) => {
      const accounts = { ...(file['accounts'] as Record<string, string>) };
      delete accounts['400000'];
      delete accounts['440000'];
      return { ...file, accounts };
    }).catch((e: unknown) => e as Error);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/i18n\/nl\.json accounts/);
    expect((error as Error).message).toMatch(/2 of 354 missing: 400000, 440000/);
  });

  it('fails when a whole section of a declared language is gone', async () => {
    const error = await beWith('de', (file) => ({ ...file, journals: {} })).catch(
      (e: unknown) => e as Error,
    );
    expect((error as Error).message).toMatch(/i18n\/de\.json journals: 6 of 6 missing/);
  });

  it('fails when the pack name of a declared language is gone', async () => {
    const error = await beWith('en', (file) => {
      const { pack_name: _dropped, ...rest } = file;
      return rest;
    }).catch((e: unknown) => e as Error);
    expect((error as Error).message).toMatch(/i18n\/en\.json: pack_name is missing/);
  });

  it('refuses a label under a code the pack does not carry', async () => {
    const error = await beWith('nl', (file) => ({
      ...file,
      accounts: { ...(file['accounts'] as Record<string, string>), '999999': 'Iets' },
    })).catch((e: unknown) => e as Error);
    expect((error as Error).message).toMatch(/999999 is not an account of this pack/);
  });

  it('refuses a language declared in the manifest with no file behind it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ekwo-lang-'));
    await cp(join(packs, 'schema'), join(dir, 'schema'), { recursive: true });
    await cp(join(packs, 'be'), join(dir, 'be'), { recursive: true });
    const path = join(dir, 'be', 'pack.json');
    const manifest = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
    manifest['languages'] = ['nl', 'de', 'en', 'it'];
    await writeFile(path, JSON.stringify(manifest), 'utf8');

    const error = await readPack('be', dir).catch((e: unknown) => e as Error);
    expect((error as Error).message).toMatch(/it is declared and packs\/be\/i18n\/it\.json does not exist/);
  });
});

describe('what the seeds carry', () => {
  it('gives every template of Belgium its three languages', async () => {
    const [accounts, journals, taxes] = await Promise.all([
      one<{ n: number }>(
        db,
        `select count(*)::int as n from account_templates
          where country = 'BE'
            and not (name_i18n ?& array['nl', 'de', 'en'])`,
      ),
      one<{ n: number }>(
        db,
        `select count(*)::int as n from journal_templates
          where country = 'BE' and not (name_i18n ?& array['nl', 'de', 'en'])`,
      ),
      one<{ n: number }>(
        db,
        `select count(*)::int as n from tax_templates
          where country = 'BE' and not (name_i18n ?& array['nl', 'de', 'en'])`,
      ),
    ]);
    expect({ accounts: accounts.n, journals: journals.n, taxes: taxes.n }).toEqual({
      accounts: 0,
      journals: 0,
      taxes: 0,
    });
  });

  it('gives every template of France its English label', async () => {
    const row = await one<{ n: number }>(
      db,
      `select count(*)::int as n from account_templates
        where country = 'FR' and not (name_i18n ? 'en')`,
    );
    expect(row.n).toBe(0);
  });

  it('names the country itself in every language the pack publishes', async () => {
    const defaults = await rows<{ country: string; name: string; name_i18n: Record<string, string> }>(
      db,
      `select country, name, name_i18n from country_defaults order by country`,
    );
    expect(defaults).toEqual([
      { country: 'BE', name: 'Belgium', name_i18n: { de: 'Belgien', en: 'Belgium', nl: 'België' } },
      { country: 'FR', name: 'France', name_i18n: { en: 'France' } },
    ]);
  });

  it('carries the legal mentions and the asset categories in those languages', async () => {
    const mention = await one<{ text_i18n: Record<string, string> }>(
      db,
      `select text_i18n from legal_mention_templates
        where country = 'BE' and code = 'reverse_charge'`,
    );
    expect(Object.keys(mention.text_i18n).sort()).toEqual(['de', 'en', 'nl']);

    const category = await one<{ name_i18n: Record<string, string> }>(
      db,
      `select name_i18n from assets.category_templates
        where country = 'BE' and code = 'machinery'`,
    );
    expect(category.name_i18n['nl']).toBe('Installaties, machines en uitrusting');
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
    await db.exec('begin');
    const user = await newUser(db, 'reader@example.test');
    const company = await one<{ id: string }>(
      db,
      `insert into companies (name, country, fiscal_country, currency_code, language)
       values ('Leesbaar BV', 'BE', 'BE', 'EUR', 'nl') returning id`,
    );

    // Nothing chosen: the company's language, then the pack's.
    const fromCompany = await asUser(db, user, () =>
      one<{ languages: string[] }>(db, `select preferred_languages($1) as languages`, [company.id]),
    );
    expect(fromCompany.languages).toEqual(['nl', 'fr']);

    // The reader prefers German, and comes first.
    await asUser(db, user, () => db.query(`select set_preferences('{"language": "de"}'::jsonb)`));
    const fromUser = await asUser(db, user, () =>
      one<{ languages: string[] }>(db, `select preferred_languages($1) as languages`, [company.id]),
    );
    expect(fromUser.languages).toEqual(['de', 'nl', 'fr']);

    // And that chain, read against a template, answers in German.
    const label = await one<{ label: string }>(
      db,
      `select label_for(t.name, t.name_i18n, array['de', 'nl', 'fr']) as label
         from account_templates t
        where t.country = 'BE' and t.chart_code = 'default' and t.code = '400000'`,
    );
    expect(label.label).toBe('Kunden');
    await db.exec('rollback');
  });
});
