import type { PGlite } from '@electric-sql/pglite';
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CATEGORY_CODES,
  TREATMENT_CODES,
  compilePack,
  declaredSeedSequences,
  listPacks,
  packsDir,
  parseCsv,
  readPack,
  readSchema,
  seedFileName,
  sourcesOf,
  seedFileNames,
  validate,
} from '../packages/cli/src/index.js';
import { freshDatabase, repoRoot, rows } from './helpers/db.js';
import { allPacks, certificationStatuses, defaultChartOf, somePack, sourceKinds } from './helpers/packs.js';

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

const identity = (row: TemplateRow): TemplateRow => row;

/**
 * One hand-written row, with the EN 16931 category its treatment actually
 * asks for.
 *
 * The hand-written seeds gave every self-assessed tax the reverse-charge pair
 * — `AE` and `VATEX-EU-AE` — and gave an import of goods the standard rate,
 * and nothing ever compared those columns to anything. `ekwo pack check` does
 * now, from `TREATMENT_CODES`, and the packs were corrected to match; so this
 * file stops claiming those two columns never moved and says instead exactly
 * how they moved, from the same table the check reads.
 *
 * Everything else still has to be identical, which is the claim that matters.
 * A treatment that leaves the pack a choice — `domestic` is `S` or `Z`, an
 * exemption is `E` under whichever article the country claims — is left as
 * the seed wrote it, because there the seed was already saying something the
 * check has no quarrel with.
 */
function asCorrected(row: TemplateRow): TemplateRow {
  const codes = TREATMENT_CODES[row['treatment'] as string];
  if (codes === undefined || codes.categories.length > 1) return row;
  const category = codes.categories[0] ?? null;
  const reserved = category === null ? null : (CATEGORY_CODES[category]?.exemption ?? undefined);
  return {
    ...row,
    // Padded, because the column is `char(2)` and every EN 16931 category but
    // `AE` is one character — so the database hands back `S `, `K `, `E `.
    // That is a defect and not an expectation; it is written up in
    // `docs/international.md`, and this line is what it looks like from here.
    vat_category: category === null ? null : category.padEnd(2),
    // `undefined` is the article-based case: the pack picks the reason, so
    // whatever the seed wrote is what is expected back.
    exemption_code: reserved === undefined ? row['exemption_code'] : reserved,
  };
}

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

  it('leave every row they already held exactly as it was, but for the categories since corrected', async () => {
    const left = await templateRows(before);
    const right = await templateRows(after);
    for (const table of Object.keys(QUERIES)) {
      const key = KEYS[table]!;
      const held = new Set((left[table] ?? []).map(key));
      const expected = (left[table] ?? []).map(table === 'tax_templates' ? asCorrected : identity);
      expect((right[table] ?? []).filter((row) => held.has(key(row))), table).toEqual(expected);
    }
  });

  it('add the four taxes the tax engine brought, and not a row more', async () => {
    const left = await templateRows(before);
    const right = await templateRows(after);
    // The question is what a change to an existing country added. A country
    // the released seeds never carried is a new pack, and every one of its
    // rows is new: it would drown the answer rather than inform it, so the
    // diff is taken over the countries both sides hold.
    const known = new Set(
      Object.values(left).flatMap((table) => (table ?? []).map((row) => row['country'] as string)),
    );
    const added = (table: string): TemplateRow[] => {
      const key = KEYS[table]!;
      const held = new Set((left[table] ?? []).map(key));
      return (right[table] ?? []).filter(
        (row) => known.has(row['country'] as string) && !held.has(key(row)),
      );
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
    // The query above reads the default chart only, which is the chart the
    // hand-written seeds knew. Every count is the pack's own.
    for (const pack of allPacks) {
      expect(accounts.filter((a) => a['country'] === pack.manifest.country), pack.slug).toHaveLength(
        defaultChartOf(pack).accounts.length,
      );
    }
    expect(right['tax_templates']).toHaveLength(
      allPacks.reduce((n, pack) => n + pack.taxes.length, 0),
    );
    expect(right['tax_posting_templates']).toHaveLength(
      allPacks.reduce(
        (n, pack) =>
          n +
          pack.taxes.reduce(
            (m, tax) => m + tax.postings.invoice.length + tax.postings.credit_note.length,
            0,
          ),
        0,
      ),
    );
    expect(right['journal_templates']).toHaveLength(
      allPacks.reduce((n, pack) => n + pack.manifest.journals.length, 0),
    );
    expect(right['country_defaults']).toHaveLength(allPacks.length);
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

  it('gives back the register, and the text each tax and each box is in', async () => {
    for (const pack of allPacks) {
      const [loaded] = await rows<{ sources: unknown }>(
        db,
        'select sources from country_packs where country = $1',
        [pack.manifest.country],
      );
      expect(loaded, pack.slug).toBeDefined();
      // jsonb comes back parsed on one route and as text on the other.
      const held = (typeof loaded!.sources === 'string'
        ? (JSON.parse(loaded!.sources) as unknown[])
        : (loaded!.sources as unknown[])) as Record<string, string>[];
      expect(held.map((source) => source['key']), pack.slug).toEqual(
        sourcesOf(pack.manifest.certification).map((source) => source.key),
      );
      for (const source of held) {
        expect(source['url'], `${pack.slug} ${String(source['key'])}`).toMatch(/^https:\/\//);
      }

      // The key travels with the rule, so an application showing a rate can
      // say which of those texts it came from without reading the pack.
      const keys = new Set(held.map((source) => source['key']));
      const taxKeys = await rows<{ code: string; source_key: string | null }>(
        db,
        'select code, source_key from tax_templates where country = $1 order by code',
        [pack.manifest.country],
      );
      expect(taxKeys.length, pack.slug).toBe(pack.taxes.length);
      for (const row of taxKeys) {
        expect(row.source_key, `${pack.slug} tax ${row.code}`).not.toBeNull();
        expect(keys.has(row.source_key!), `${pack.slug} tax ${row.code}`).toBe(true);
      }
      const boxKeys = await rows<{ box: string; source_key: string | null }>(
        db,
        'select box, source_key from tax_report_box_templates where country = $1 order by box',
        [pack.manifest.country],
      );
      expect(boxKeys.length, pack.slug).toBe((pack.report?.boxes ?? []).length);
      for (const row of boxKeys) {
        expect(row.source_key, `${pack.slug} box ${row.box}`).not.toBeNull();
        expect(keys.has(row.source_key!), `${pack.slug} box ${row.box}`).toBe(true);
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
    const declared = await declaredSeedSequences(packs);
    expect(slugs, 'this repository ships no pack at all').not.toHaveLength(0);
    expect(slugs).toEqual([...slugs].sort());
    for (const slug of slugs) {
      const pack = await readPack(slug, packs);
      const file = seedFileName(slug, slugs, declared);
      const committed = await readFile(join(seedDir, file), 'utf8');
      expect(committed, `${file} is stale: run \`ekwo pack build --all\``).toBe(compilePack(pack));
    }
  });

  it('are the only country seeds `supabase db push` applies', async () => {
    const config = await readFile(join(repoRoot, 'supabase', 'config.toml'), 'utf8');
    const slugs = await listPacks(packs);
    const declared = await declaredSeedSequences(packs);
    for (const slug of slugs) {
      expect(config).toContain(`./seed/${seedFileName(slug, slugs, declared)}`);
    }
    expect(config).not.toContain('chart_be');
  });

  // The numbers that shipped in v0.2.0 and in the release after it. A pack
  // renamed here is a file an installation already holds, renamed by a
  // release — which the seeds survive, because they upsert, and which nobody
  // reading `supabase/config.toml` a year later would understand.
  it('keep the number they shipped with, whatever is added beside them', async () => {
    const slugs = await listPacks(packs);
    const declared = await declaredSeedSequences(packs);
    // country-literal: these three numbers are history, not a list of packs —
    // they are the file names released installations already hold, and a pack
    // that landed later cannot change them.
    expect(seedFileName('be', slugs, declared)).toBe('10_pack_be.sql');
    expect(seedFileName('fr', slugs, declared)).toBe('11_pack_fr.sql');
    expect(seedFileName('lu', slugs, declared)).toBe('12_pack_lu.sql');
  });

  it('take the number the pack declares, and nothing else', () => {
    // Not the alphabetical rank: `zz` sorts last and carries 10.
    expect(
      seedFileNames(
        ['aa', 'zz'],
        new Map([
          ['aa', 42],
          ['zz', 10],
        ]),
      ),
    ).toEqual(
      new Map([
        ['aa', '42_pack_aa.sql'],
        ['zz', '10_pack_zz.sql'],
      ]),
    );
  });

  it('refuse a pack that declares no number, and two that declare one', () => {
    expect(() => seedFileNames(['aa', 'zz'], new Map([['aa', 10]]))).toThrow(
      /seed_sequence_missing: packs\/zz/,
    );
    expect(() =>
      seedFileNames(
        ['aa', 'zz'],
        new Map([
          ['aa', 12],
          ['zz', 12],
        ]),
      ),
    ).toThrow(/seed_sequence_conflict/);
  });
});

describe('the pack format', () => {
  // The refusals below are about the reader and the schema, not about a
  // country: they break a pack in a temporary directory and read the message
  // back. `somePack` is whichever pack comes first, so a failure is reproducible.
  const sampleDir = join(packs, somePack.slug);
  const manifestPath = join(sampleDir, 'pack.json');

  it('validates the packs of this repository against the published schema', async () => {
    // readPack throws on the first problem; this states what it checked.
    for (const slug of await listPacks(packs)) {
      const pack = await readPack(slug, packs);
      expect(pack.manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
      // Never certified: writing a pack and testing that it holds together is
      // not an accountant reading it against the law. `maintained` is what the
      // maintainers keep current, `community` what was contributed and nobody
      // has read; neither names a person.
      expect(certificationStatuses).toContain(pack.manifest.certification?.status);
      expect(pack.manifest.certification?.status, 'no pack here has been reviewed').not.toBe(
        'reviewed',
      );
      expect(pack.manifest.certification?.by, 'only a review names someone').toBeUndefined();
      expect((pack.manifest.certification?.sources ?? []).length).toBeGreaterThan(0);
      expect(pack.accounts.length).toBeGreaterThan(100);
    }
  });

  it('refuses a manifest with a field nobody defined', async () => {
    const schema = await readSchema(packs);
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>;
    expect(validate(manifest, schema)).toEqual([]);
    expect(validate({ ...manifest, script: 'rm -rf /' }, schema)).toEqual([
      { path: '(root)', message: 'unknown field "script"' },
    ]);
  });

  it('refuses a rate that is not a number and a country that is not two letters', async () => {
    const schema = await readSchema(packs);
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>;
    // Three letters, which is not an ISO 3166-1 alpha-2 code whatever it says.
    expect(validate({ ...manifest, country: 'BEL' }, schema)).toHaveLength(1);

    const taxes = (schema['$defs'] as Record<string, Record<string, unknown>>)['taxes']!;
    const one = JSON.parse(await readFile(join(sampleDir, 'taxes.json'), 'utf8')) as Record<string, unknown>[];
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

  // -------------------------------------------------------------------
  // The golden scenario, and the sources that go with it.
  //
  // A golden proves that a pack is coherent with itself. It cannot prove that
  // a rate is the law or that a box is the right box: a posting written to the
  // wrong grid and a grid that expects the wrong postings agree, and the test
  // passes. So the two travel together — the scenario, and a source on every
  // tax and every box that a human being can go and read.
  // -------------------------------------------------------------------

  it('gives every country pack a golden scenario of at least ten documents', async () => {
    for (const slug of await listPacks(packs)) {
      const pack = await readPack(slug, packs);
      expect(pack.golden, `packs/${slug} has no golden scenario`).not.toBeNull();
      expect(pack.golden!.documents.length, slug).toBeGreaterThanOrEqual(10);
      expect(pack.golden!.payments.length, slug).toBeGreaterThan(0);
      expect(pack.golden!.periods.length, slug).toBeGreaterThan(0);
    }
  });

  it('refuses a pack that carries no golden and gives no reason', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ekwo-golden-'));
    await cp(join(packs, 'schema'), join(dir, 'schema'), { recursive: true });
    await cp(sampleDir, join(dir, somePack.slug), { recursive: true });
    await rm(join(dir, somePack.slug, 'golden'), { recursive: true });

    await expect(readPack(somePack.slug, dir)).rejects.toThrow(/carries no golden\/scenario\.json/);

    // And the way out is a sentence somebody wrote, not a silence.
    const broken = join(dir, somePack.slug, 'pack.json');
    const manifest = JSON.parse(await readFile(broken, 'utf8')) as Record<string, unknown>;
    manifest['golden'] = { exempt: 'A fixture that exists for the length of one test.' };
    await writeFile(broken, JSON.stringify(manifest), 'utf8');
    const exempt = await readPack(somePack.slug, dir);
    expect(exempt.golden).toBeNull();
    expect(exempt.goldenExemption).toMatch(/length of one test/);
  });

  it('refuses a golden that names a tax, an account or a document it does not carry', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ekwo-golden-'));
    await cp(join(packs, 'schema'), join(dir, 'schema'), { recursive: true });
    await cp(sampleDir, join(dir, somePack.slug), { recursive: true });
    const path = join(dir, somePack.slug, 'golden', 'scenario.json');
    const scenario = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;

    const documents = scenario['documents'] as Record<string, unknown>[];
    const lines = documents[0]!['lines'] as Record<string, unknown>[];
    // A tax code shaped like the pack's own and carried by no pack.
    const absentTax = `${somePack.manifest.country}-S-99`;
    lines[0]!['tax'] = absentTax;
    lines[0]!['account'] = '999999';
    (scenario['payments'] as Record<string, unknown>[])[0]!['match'] = 'nothing';
    await writeFile(path, JSON.stringify(scenario), 'utf8');

    const error = await readPack(somePack.slug, dir).catch((e: Error) => e.message);
    expect(error).toMatch(new RegExp(`tax ${absentTax} is not a tax of this pack`));
    expect(error).toMatch(/account 999999 is not in chart default/);
    expect(error).toMatch(/is not a document of this scenario/);
  });

  it('refuses a golden of fewer than ten documents', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ekwo-golden-'));
    await cp(join(packs, 'schema'), join(dir, 'schema'), { recursive: true });
    await cp(sampleDir, join(dir, somePack.slug), { recursive: true });
    const path = join(dir, somePack.slug, 'golden', 'scenario.json');
    const scenario = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
    scenario['documents'] = (scenario['documents'] as unknown[]).slice(0, 4);
    await writeFile(path, JSON.stringify(scenario), 'utf8');

    await expect(readPack(somePack.slug, dir)).rejects.toThrow(/needs at least 10 item\(s\)/);
  });

  it('asks every tax and every declaration box where it comes from', async () => {
    for (const slug of await listPacks(packs)) {
      const pack = await readPack(slug, packs);
      for (const tax of pack.taxes) {
        expect(tax.legal_reference, `${slug} tax ${tax.code}`).toBeTruthy();
      }
      for (const box of pack.report?.boxes ?? []) {
        expect(box.legal_reference, `${slug} box ${box.box} (${box.kind})`).toBeTruthy();
      }
    }
  });

  it('refuses a tax and a box that cite nothing', async () => {
    const schema = await readSchema(packs);
    const defs = schema['$defs'] as Record<string, Record<string, unknown>>;

    const taxes = JSON.parse(await readFile(join(sampleDir, 'taxes.json'), 'utf8')) as Record<string, unknown>[];
    const { legal_reference: _dropped, ...silent } = taxes[0]!;
    expect(validate([silent], defs['taxes']!, schema)).toEqual([
      { path: '[0]', message: 'missing "legal_reference"' },
    ]);

    const report = JSON.parse(await readFile(join(sampleDir, 'tax_report.json'), 'utf8')) as Record<string, unknown>;
    const boxes = report['boxes'] as Record<string, unknown>[];
    const { legal_reference: _also, ...quiet } = boxes[0]!;
    expect(validate({ ...report, boxes: [quiet] }, defs['tax_report']!, schema)).toEqual([
      { path: 'boxes[0]', message: 'missing "legal_reference"' },
    ]);
  });

  // -------------------------------------------------------------------
  // The register of sources.
  //
  // `legal_reference` says which article a rule claims. The register says
  // where that article can be read, once per text rather than once per rule,
  // and every tax and every box names the key of the text it is in. What is
  // tested here is that the two halves cannot drift: a key nothing declares, a
  // key two texts claim, and a register a maintained pack does not carry.
  // -------------------------------------------------------------------

  it('gives every pack a register whose texts somebody can open', async () => {
    for (const pack of allPacks) {
      const register = sourcesOf(pack.manifest.certification);
      expect(register.length, `packs/${pack.slug} declares no source anybody can open`).toBeGreaterThan(0);
      const keys = new Set<string>();
      for (const source of register) {
        expect(keys.has(source.key), `packs/${pack.slug} declares ${source.key} twice`).toBe(false);
        keys.add(source.key);
        expect(source.url, `packs/${pack.slug} ${source.key}`).toMatch(/^https:\/\//);
        expect(source.title.length, `packs/${pack.slug} ${source.key}`).toBeGreaterThan(0);
        expect(source.publisher.length, `packs/${pack.slug} ${source.key}`).toBeGreaterThan(0);
        expect(source.consulted_on, `packs/${pack.slug} ${source.key}`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(sourceKinds, `packs/${pack.slug} ${source.key}`).toContain(source.kind);
      }
      // A portal is the other half of a reading list: where the declaration a
      // pack transcribes is actually filed. Every pack of this repository
      // names one, and the walkthrough asks a new country for it first.
      expect(
        register.some((source) => source.kind === 'portal'),
        `packs/${pack.slug} names no filing portal`,
      ).toBe(true);
    }
  });

  it('resolves every source a rule names, and links the taxes and the boxes', async () => {
    for (const pack of allPacks) {
      const keys = new Set(sourcesOf(pack.manifest.certification).map((source) => source.key));
      // The chart of the pack that carries its own reading joins the same
      // register: a key is unique in a pack, not in a section of one.
      for (const chart of pack.charts) {
        for (const source of sourcesOf(chart.certification)) keys.add(source.key);
      }
      const named: [string, string | null][] = [
        ...pack.charts.map((chart): [string, string | null] => [`chart ${chart.code}`, chart.source]),
        ...pack.taxes.map((tax): [string, string | null] => [`tax ${tax.code}`, tax.source]),
        ...(pack.report?.boxes ?? []).map((box): [string, string | null] => [`box ${box.box}`, box.source]),
        ...pack.statements.flatMap((statement): [string, string | null][] => [
          [`statement ${statement.code}`, statement.source],
          ...statement.lines.map((line): [string, string | null] => [
            `line ${statement.code}.${line.code}`,
            line.source,
          ]),
        ]),
        ...pack.documents.mentions.map((mention): [string, string | null] => [
          `mention ${mention.code}`,
          mention.source,
        ]),
        ...(pack.assets?.categories ?? []).map((category): [string, string | null] => [
          `asset ${category.code}`,
          category.source,
        ]),
      ];
      for (const [where, key] of named) {
        if (key === null) continue;
        expect(keys.has(key), `packs/${pack.slug} ${where} names the source ${key}`).toBe(true);
      }
      // The two the format is strictest about. Every tax and every box of
      // every pack here says which text its article is in, which is what a
      // reviewed pack is refused for leaving out.
      for (const tax of pack.taxes) {
        expect(tax.source, `packs/${pack.slug} tax ${tax.code}`).not.toBeNull();
      }
      for (const box of pack.report?.boxes ?? []) {
        expect(box.source, `packs/${pack.slug} box ${box.box} (${box.kind})`).not.toBeNull();
      }
    }
  });

  it('refuses a source key the register does not carry, and two texts claiming one key', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ekwo-sources-'));
    await cp(join(packs, 'schema'), join(dir, 'schema'), { recursive: true });
    await cp(sampleDir, join(dir, somePack.slug), { recursive: true });
    const path = join(dir, somePack.slug, 'taxes.json');
    const taxes = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>[];
    taxes[0]!['source'] = 'a-text-nobody-declared';
    await writeFile(path, JSON.stringify(taxes), 'utf8');
    await expect(readPack(somePack.slug, dir)).rejects.toThrow(
      /names the source a-text-nobody-declared, which this pack's register does not carry/,
    );

    await cp(sampleDir, join(dir, somePack.slug), { recursive: true, force: true });
    const manifestFile = join(dir, somePack.slug, 'pack.json');
    const manifest = JSON.parse(await readFile(manifestFile, 'utf8')) as Record<string, unknown>;
    const certification = manifest['certification'] as Record<string, unknown>;
    const register = certification['sources'] as Record<string, unknown>[];
    certification['sources'] = [...register, { ...register[0] }];
    await writeFile(manifestFile, JSON.stringify(manifest), 'utf8');
    await expect(readPack(somePack.slug, dir)).rejects.toThrow(
      new RegExp(`two sources claim the key ${String(register[0]!['key'])}`),
    );
  });

  it('reads the bare title the register replaced, and says it is deprecated rather than refusing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ekwo-sources-'));
    await cp(join(packs, 'schema'), join(dir, 'schema'), { recursive: true });
    await cp(sampleDir, join(dir, somePack.slug), { recursive: true });
    const manifestFile = join(dir, somePack.slug, 'pack.json');
    const manifest = JSON.parse(await readFile(manifestFile, 'utf8')) as Record<string, unknown>;
    const certification = manifest['certification'] as Record<string, unknown>;
    const register = certification['sources'] as Record<string, unknown>[];
    certification['sources'] = [...register, 'A text somebody read and nobody linked'];
    await writeFile(manifestFile, JSON.stringify(manifest), 'utf8');

    // It compiles — a pack written before the register still builds — and the
    // reader is told, because a title is not somewhere anyone can go and read.
    const read = await readPack(somePack.slug, dir);
    expect(read.warnings.join('\n')).toMatch(/is a title with nowhere to read it/);
    // The title reaches nothing. What the pack holds is what it held before,
    // the manifest's entries and whichever chart declared a reading of its own.
    const chartsOwn = somePack.charts.flatMap((chart) => sourcesOf(chart.certification));
    expect(read.sources).toHaveLength(register.length + chartsOwn.length);
  });

  it('refuses a maintained pack with no register, and a reviewed pack whose rules name none', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ekwo-sources-'));
    await cp(join(packs, 'schema'), join(dir, 'schema'), { recursive: true });
    await cp(sampleDir, join(dir, somePack.slug), { recursive: true });
    const manifestFile = join(dir, somePack.slug, 'pack.json');
    const manifest = JSON.parse(await readFile(manifestFile, 'utf8')) as Record<string, unknown>;
    const certification = manifest['certification'] as Record<string, unknown>;

    // `community` is the honest answer for a pack nobody has read, and it
    // carries no such obligation. The two statuses above it do.
    const claimed = certificationStatuses.filter((status) => status !== 'community');
    // Every register of the pack, the manifest's and any chart's: the claim
    // the two statuses make is that somebody can open something, and a chart
    // that carries its own reading is part of the same register.
    const emptied = {
      ...manifest,
      charts: (manifest['charts'] as Record<string, unknown>[] | undefined)?.map((chart) => {
        const { certification: _own, ...rest } = chart;
        return rest;
      }),
    };
    for (const status of claimed) {
      await writeFile(
        manifestFile,
        JSON.stringify({ ...emptied, certification: { ...certification, status, sources: [] } }),
        'utf8',
      );
      await expect(readPack(somePack.slug, dir), status).rejects.toThrow(
        new RegExp(`a ${status} pack carries a register of sources`),
      );
    }

    // And a review says which text it read, per tax and per box.
    await cp(sampleDir, join(dir, somePack.slug), { recursive: true, force: true });
    const reviewed = JSON.parse(await readFile(manifestFile, 'utf8')) as Record<string, unknown>;
    reviewed['certification'] = {
      ...(reviewed['certification'] as Record<string, unknown>),
      status: 'reviewed',
      by: 'A. Example, chartered accountant',
      on: '2026-09-15',
    };
    await writeFile(manifestFile, JSON.stringify(reviewed), 'utf8');
    await expect(readPack(somePack.slug, dir)).resolves.toBeDefined();

    const taxFile = join(dir, somePack.slug, 'taxes.json');
    const taxes = JSON.parse(await readFile(taxFile, 'utf8')) as Record<string, unknown>[];
    const code = String(taxes[0]!['code']);
    delete taxes[0]!['source'];
    await writeFile(taxFile, JSON.stringify(taxes), 'utf8');
    await expect(readPack(somePack.slug, dir)).rejects.toThrow(
      new RegExp(`taxes\\.json ${code}: a reviewed pack says which text its legal reference is in`),
    );
  });

  it('accepts the two shapes of a source and nothing between them', async () => {
    const schema = await readSchema(packs);
    const defs = schema['$defs'] as Record<string, Record<string, unknown>>;
    const source = defs['source']!;
    const entry = {
      key: 'a-text',
      title: 'A consolidated statute',
      publisher: 'The official gazette',
      url: 'https://example.invalid/eli/1/2/3',
      consulted_on: '2026-09-15',
      kind: sourceKinds[0],
    };
    expect(validate(entry, source, schema)).toEqual([]);
    expect(validate('A text somebody read', source, schema)).toEqual([]);
    // Half an entry is neither, and a link that is not absolute and https is
    // not a place anybody can be sent.
    expect(validate({ key: 'a-text', title: 'Half of one' }, source, schema)).toHaveLength(1);
    expect(validate({ ...entry, url: 'www.example.invalid' }, source, schema)).toHaveLength(1);
    expect(validate({ ...entry, kind: 'a-kind-nobody-defined' }, source, schema)).toHaveLength(1);
    expect(validate({ ...entry, note: 'a copy of what it says' }, source, schema)).toHaveLength(1);
  });

  it('reserves the group of taxes phase 1 will need, and refuses it until then', async () => {
    const schema = await readSchema(packs);
    const defs = schema['$defs'] as Record<string, Record<string, unknown>>;
    const tax = defs['tax']!;
    const properties = tax['properties'] as Record<string, unknown>;
    expect(properties['group']).toBeDefined();

    const taxes = JSON.parse(await readFile(join(sampleDir, 'taxes.json'), 'utf8')) as Record<string, unknown>[];
    const grouped = [
      {
        ...taxes[0],
        code: `${somePack.manifest.country}-GROUP`,
        group: somePack.taxes.slice(0, 2).map((tax) => tax.code),
      },
    ];
    expect(validate(grouped, defs['taxes']!, schema)).toEqual([]); // the schema accepts it
  });
});
