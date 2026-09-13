import type { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  compilePack,
  listPacks,
  packsDir,
  parseCsv,
  readPack,
  readSchema,
  seedFileName,
  validate,
} from '../packages/cli/src/index.js';
import { freshDatabase, repoRoot, rows } from './helpers/db.js';

// The country packs replaced four hand-written seeds. The point of this file
// is that the replacement changed nothing: the same template rows, from a
// source an accountant can read, compiled by a command the CI re-runs.

const packs = join(repoRoot, 'packs');
const seedDir = join(repoRoot, 'supabase', 'seed');
const beforeDir = join(repoRoot, 'tests', 'fixtures', 'seeds-before-packs');

interface TemplateRow {
  [column: string]: unknown;
}

/** The template tables, keyed and ordered so two databases compare row by row. */
const QUERIES: Record<string, string> = {
  // The default chart only: the hand-written seeds knew one chart per country,
  // so the comparison is against the chart that was already there.
  account_templates: `select country, code, name, account_type::text, reconcilable, parent_code, sequence
                        from account_templates where chart_code = 'default'
                        order by country, code`,
  journal_templates: `select country, code, name, journal_type::text, sequence
                        from journal_templates order by country, code`,
  tax_templates: `select country, code, name, description, amount_type::text, amount::text,
                         applies_to::text, treatment::text, valid_from::text, valid_to::text,
                         legal_reference, vat_category, exemption_code, sequence
                    from tax_templates order by country, code`,
  tax_posting_templates: `select t.country, t.code as tax_code, p.document_kind::text, p.posting_type::text,
                                 p.factor_percent::text, p.account_code, p.declaration_box,
                                 p.box_factor_percent::text, p.sequence
                            from tax_posting_templates p
                            join tax_templates t on t.id = p.tax_template_id
                           order by t.country, t.code, p.document_kind, p.sequence, p.posting_type`,
  // Named column by column rather than `select *`: the comparison is
  // "nothing that existed changed", and a column added after the packs
  // (language_default) has no value in the *before* database by construction.
  country_defaults: `select country, name, currency_code, receivable_code, payable_code,
                            suspense_code, rounding_code, retained_earnings_code,
                            sales_account_code, purchase_account_code, bank_account_code,
                            cash_account_code, sales_journal_code, purchase_journal_code,
                            misc_journal_code
                       from country_defaults order by country`,
};

/**
 * The natural key of a row, per table.
 *
 * The generalised tax engine added taxes to both packs, so the two databases
 * no longer hold the
 * same *number* of rows and `toEqual` on the whole table would only prove
 * that. The claim this file makes is narrower and is the one that matters:
 * **nothing that existed changed**. So `after` is narrowed to the keys
 * `before` held, and the rows that are new are named in a test of their own —
 * a row that appeared without anybody saying so still fails.
 */
const KEYS: Record<string, (row: TemplateRow) => string> = {
  account_templates: (r) => `${r['country']}/${r['code']}`,
  journal_templates: (r) => `${r['country']}/${r['code']}`,
  tax_templates: (r) => `${r['country']}/${r['code']}`,
  tax_posting_templates: (r) => `${r['country']}/${r['tax_code']}`,
  country_defaults: (r) => String(r['country']),
};

async function templateRows(db: PGlite): Promise<Record<string, TemplateRow[]>> {
  const out: Record<string, TemplateRow[]> = {};
  for (const [table, sql] of Object.entries(QUERIES)) {
    out[table] = await rows<TemplateRow>(db, sql);
  }
  return out;
}

/** A database with the migrations and the four seeds as they were written by hand. */
async function databaseBeforePacks(): Promise<PGlite> {
  const db = await freshDatabase({ seed: false });
  // Those seeds were written when a country had one chart of accounts: their
  // `on conflict (country, code)` names a key the schema has widened since,
  // and they point at no chart because there was no chart table. This database
  // is given that shape back — its old key, and no chart to refer to — so the
  // files themselves are replayed untouched, which is the whole point of them.
  await db.exec(`
    alter table account_templates drop constraint account_templates_chart_fk;
    create unique index on account_templates (country, code);
  `);
  await db.exec(await readFile(join(seedDir, '00_currencies.sql'), 'utf8'));
  for (const file of (await readdir(beforeDir)).filter((f) => f.endsWith('.sql')).sort()) {
    await db.exec(await readFile(join(beforeDir, file), 'utf8'));
  }
  return db;
}

describe('the compiled packs against the seeds they replace', () => {
  let before: PGlite;
  let after: PGlite;

  beforeAll(async () => {
    before = await databaseBeforePacks();
    after = await freshDatabase(); // applies supabase/seed, which is now the packs
  }, 120_000);

  afterAll(async () => {
    await before.close();
    await after.close();
  });

  it('leave every row they already held exactly as it was', async () => {
    const left = await templateRows(before);
    const right = await templateRows(after);
    for (const table of Object.keys(QUERIES)) {
      const key = KEYS[table]!;
      const held = new Set((left[table] ?? []).map(key));
      expect((right[table] ?? []).filter((row) => held.has(key(row))), table).toEqual(left[table]);
    }
  });

  it('add the four taxes the tax engine brought, and not a row more', async () => {
    const left = await templateRows(before);
    const right = await templateRows(after);
    const added = (table: string): TemplateRow[] => {
      const key = KEYS[table]!;
      const held = new Set((left[table] ?? []).map(key));
      return (right[table] ?? []).filter((row) => !held.has(key(row)));
    };

    expect(added('journal_templates')).toEqual([]);
    expect(added('country_defaults')).toEqual([]);
    // The two accounts a French cash-basis tax waits on, under the 4458 head
    // the PCG calls "à régulariser ou en attente".
    expect(added('account_templates').map((r) => `${r['country']}/${r['code']}`)).toEqual([
      'FR/445860',
      'FR/445870',
    ]);
    // Belgian cars and receptions, French fuel: the partially and the wholly
    // non-deductible VAT the engine could not express before. Then the six
    // French services taxes that fall due when they are paid.
    expect(added('tax_templates').map((r) => `${r['country']}/${r['code']}`)).toEqual([
      'BE/BE-P-21-50-I',
      'BE/BE-P-21-50-S',
      'BE/BE-P-21-ND',
      'FR/FR-P-055-ENC',
      'FR/FR-P-10-ENC',
      'FR/FR-P-20-CARB',
      'FR/FR-P-20-ENC',
      'FR/FR-S-055-ENC',
      'FR/FR-S-10-ENC',
      'FR/FR-S-20-ENC',
    ]);
  });

  it('load the counts the packs claim', async () => {
    const right = await templateRows(after);
    const accounts = right['account_templates'] ?? [];
    expect(accounts.filter((a) => a['country'] === 'BE')).toHaveLength(353);
    expect(accounts.filter((a) => a['country'] === 'FR')).toHaveLength(394);
    expect(right['tax_templates']).toHaveLength(46);
    expect(right['tax_posting_templates']).toHaveLength(166);
    expect(right['journal_templates']).toHaveLength(12);
    expect(right['country_defaults']).toHaveLength(2);
  });
});

describe('pack, seed, database, pack again', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await freshDatabase();
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it('gives back the accounts every chart of the pack holds', async () => {
    for (const slug of await listPacks(packs)) {
      const pack = await readPack(slug, packs);
      for (const chart of pack.charts) {
        const loaded = await rows<{ code: string; name: string; account_type: string; reconcilable: boolean; parent_code: string | null; sequence: number }>(
          db,
          `select code, name, account_type::text, reconcilable, parent_code, sequence
             from account_templates where country = $1 and chart_code = $2 order by code`,
          [pack.manifest.country, chart.code],
        );
        const expected = [...chart.accounts].sort((a, b) => (a.code < b.code ? -1 : 1));
        expect(loaded.length, `${slug}/${chart.code}`).toBe(expected.length);
        loaded.forEach((row, index) => {
          const account = expected[index]!;
          expect({ ...row, sequence: Number(row.sequence) }, `${slug}/${chart.code} ${account.code}`).toEqual({
            code: account.code,
            name: account.name,
            account_type: account.type,
            reconcilable: account.reconcilable,
            parent_code: account.parent,
            sequence: account.sequence,
          });
        });
      }
    }
  });

  it('gives back the taxes and their postings', async () => {
    for (const slug of await listPacks(packs)) {
      const pack = await readPack(slug, packs);
      for (const tax of pack.taxes) {
        const [loaded] = await rows<{ id: string; name: string; amount: string; applies_to: string; treatment: string; valid_from: string; vat_category: string | null }>(
          db,
          `select id, name, amount::text, applies_to::text, treatment::text, valid_from::text, vat_category
             from tax_templates where country = $1 and code = $2`,
          [pack.manifest.country, tax.code],
        );
        expect(loaded, `${slug} ${tax.code}`).toBeDefined();
        expect(Number(loaded!.amount)).toBe(tax.rate);
        expect(loaded!.name).toBe(tax.name);
        expect(loaded!.applies_to).toBe(tax.scope);
        expect(loaded!.treatment).toBe(tax.treatment);
        expect(loaded!.valid_from).toBe(tax.valid_from);
        expect((loaded!.vat_category ?? '').trim() || null).toBe(tax.vat_category);

        for (const kind of ['invoice', 'credit_note'] as const) {
          const postings = await rows<{ posting_type: string; factor_percent: string; account_code: string | null; declaration_box: string | null; box_factor_percent: string; report_code: string | null; sequence: number }>(
            db,
            `select posting_type::text, factor_percent::text, account_code, declaration_box,
                    box_factor_percent::text, report_code, sequence
               from tax_posting_templates
              where tax_template_id = $1 and document_kind = $2
              order by sequence, posting_type`,
            [loaded!.id, kind],
          );
          const expected = [...tax.postings[kind]].sort((a, b) => a.sequence - b.sequence);
          expect(postings.length, `${slug} ${tax.code} ${kind}`).toBe(expected.length);
          postings.forEach((row, index) => {
            const posting = expected[index]!;
            expect(
              {
                type: row.posting_type,
                factor: Number(row.factor_percent),
                account: row.account_code,
                box: row.declaration_box,
                box_factor: Number(row.box_factor_percent),
                report: row.report_code,
                sequence: Number(row.sequence),
              },
              `${slug} ${tax.code} ${kind} ${index}`,
            ).toEqual(posting);
          });
        }
      }
    }
  });

  it('wires the roles the manifest names', async () => {
    for (const slug of await listPacks(packs)) {
      const pack = await readPack(slug, packs);
      const [defaults] = await rows<Record<string, string | null>>(
        db,
        'select * from country_defaults where country = $1',
        [pack.manifest.country],
      );
      expect(defaults, slug).toBeDefined();
      expect(defaults!['receivable_code']).toBe(pack.manifest.defaults.roles['receivable']);
      expect(defaults!['payable_code']).toBe(pack.manifest.defaults.roles['payable']);
      expect(defaults!['cash_account_code']).toBe(pack.manifest.defaults.roles['cash']);
      expect(defaults!['currency_code']).toBe(pack.manifest.defaults.currency);
    }
  });
});

describe('the committed seeds', () => {
  it('are the exact output of their pack — what `ekwo pack check` runs in CI', async () => {
    const slugs = await listPacks(packs);
    expect(slugs).toContain('be');
    expect(slugs).toContain('fr');
    for (const slug of slugs) {
      const pack = await readPack(slug, packs);
      const file = seedFileName(slug, slugs);
      const committed = await readFile(join(seedDir, file), 'utf8');
      expect(committed, `${file} is stale: run \`ekwo pack build --all\``).toBe(compilePack(pack));
    }
  });

  it('are the only country seeds `supabase db push` applies', async () => {
    const config = await readFile(join(repoRoot, 'supabase', 'config.toml'), 'utf8');
    const slugs = await listPacks(packs);
    for (const slug of slugs) {
      expect(config).toContain(`./seed/${seedFileName(slug, slugs)}`);
    }
    expect(config).not.toContain('chart_be');
  });
});

describe('the pack format', () => {
  it('validates the packs of this repository against the published schema', async () => {
    // readPack throws on the first problem; this states what it checked.
    for (const slug of await listPacks(packs)) {
      const pack = await readPack(slug, packs);
      expect(pack.manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
      // Maintained, not certified: writing a pack and testing that it holds
      // together is not an accountant reading it against the law.
      expect(pack.manifest.certification?.status).toBe('maintained');
      expect(pack.manifest.certification?.by, 'only a review names someone').toBeUndefined();
      expect((pack.manifest.certification?.sources ?? []).length).toBeGreaterThan(0);
      expect(pack.accounts.length).toBeGreaterThan(300);
    }
  });

  it('refuses a manifest with a field nobody defined', async () => {
    const schema = await readSchema(packs);
    const manifest = JSON.parse(await readFile(join(packs, 'be', 'pack.json'), 'utf8')) as Record<string, unknown>;
    expect(validate(manifest, schema)).toEqual([]);
    expect(validate({ ...manifest, script: 'rm -rf /' }, schema)).toEqual([
      { path: '(root)', message: 'unknown field "script"' },
    ]);
  });

  it('refuses a rate that is not a number and a country that is not two letters', async () => {
    const schema = await readSchema(packs);
    const manifest = JSON.parse(await readFile(join(packs, 'be', 'pack.json'), 'utf8')) as Record<string, unknown>;
    expect(validate({ ...manifest, country: 'BEL' }, schema)).toHaveLength(1);

    const taxes = (schema['$defs'] as Record<string, Record<string, unknown>>)['taxes']!;
    const one = JSON.parse(await readFile(join(packs, 'be', 'taxes.json'), 'utf8')) as Record<string, unknown>[];
    expect(validate(one, taxes, schema)).toEqual([]);
    expect(validate([{ ...one[0], rate: '21' }], taxes, schema)).toHaveLength(1);
  });

  it('reads the CSV subset, quotes and all, and refuses what is outside it', () => {
    const parsed = parseCsv(
      'code,parent,type,reconcilable,name,sequence\n' +
        '211,21,asset_fixed,false,"Concessions, brevets",500\n' +
        '400000,400,asset_receivable,true,"Clients dits ""douteux""",10\n',
      'test.csv',
    );
    expect(parsed).toHaveLength(2);
    expect(parsed[0]!['name']).toBe('Concessions, brevets');
    expect(parsed[1]!['name']).toBe('Clients dits "douteux"');
    expect(() => parseCsv('a,b\n1\n', 'test.csv')).toThrow(/1 field/);
    expect(() => parseCsv('a,b\n1,"unclosed\n', 'test.csv')).toThrow(/never closes/);
  });

  it('has no field through which a pack could execute anything', async () => {
    const text = await readFile(join(packs, 'schema', 'pack.1.json'), 'utf8');
    const schema = JSON.parse(text) as Record<string, unknown>;
    const names = new Set<string>();
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (typeof node !== 'object' || node === null) return;
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        if (key === 'properties') {
          for (const name of Object.keys(value as Record<string, unknown>)) names.add(name);
        }
        walk(value);
      }
    };
    walk(schema);
    for (const forbidden of ['script', 'python', 'code_hook', 'eval', 'command', 'sql']) {
      expect(names.has(forbidden), forbidden).toBe(false);
    }
  });

  it('reserves the group of taxes phase 1 will need, and refuses it until then', async () => {
    const schema = await readSchema(packs);
    const defs = schema['$defs'] as Record<string, Record<string, unknown>>;
    const tax = defs['tax']!;
    const properties = tax['properties'] as Record<string, unknown>;
    expect(properties['group']).toBeDefined();

    const taxes = JSON.parse(await readFile(join(packs, 'be', 'taxes.json'), 'utf8')) as Record<string, unknown>[];
    const grouped = [{ ...taxes[0], code: 'BE-GROUP', group: ['BE-S-21', 'BE-S-06'] }];
    expect(validate(grouped, defs['taxes']!, schema)).toEqual([]); // the schema accepts it
  });
});
