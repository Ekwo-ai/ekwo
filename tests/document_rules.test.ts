import type { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compilePack, listPacks, readPack, readSchema, validate } from '../packages/cli/src/index.js';
import { asUser, expectError, freshDatabase, one, repoRoot, rows, seedFiles } from './helpers/db.js';
import { newCompany, newContact, newDocument } from './helpers/factory.js';

// What a country requires on a document is data. Twelve columns of
// `country_defaults`, one table of sentences, and two views that read them —
// and nothing executable, which is the point of the sub-task.

const packs = join(repoRoot, 'packs');
const seedDir = join(repoRoot, 'supabase', 'seed');

let db: PGlite;

beforeAll(async () => {
  db = await freshDatabase();
}, 120_000);

afterAll(async () => {
  await db.close();
});

/** The row of the country model of a company, whatever country it keeps. */
async function rulesOf(country: string): Promise<Record<string, unknown>> {
  return one(
    db,
    `select numbering_gapless, number_format, legal_payment_days, late_payment_reference,
            tax_point_rule, einvoice_profile, einvoice_mandatory_from::text as einvoice_mandatory_from,
            party_scheme, vat_scheme, bank_statement_formats, payment_formats, fiscal_year_default
       from country_defaults where country = $1`,
    [country],
  );
}

describe('the document columns of the country model', () => {
  const ADDED = [
    'numbering_gapless',
    'number_format',
    'legal_payment_days',
    'late_payment_reference',
    'tax_point_rule',
    'einvoice_profile',
    'einvoice_mandatory_from',
    'party_scheme',
    'vat_scheme',
    'bank_statement_formats',
    'payment_formats',
    'fiscal_year_default',
  ];

  it('are all nullable and none of them carries a default', async () => {
    // The rule the year-end close set when it landed the closing style, applied to the
    // twelve columns of this one: a default legal payment term, a default
    // e-invoicing profile or a default tax point would each be one country's
    // law given to every country that has not spoken. A silent pack gets
    // null, and a reader that needs the value says which one is missing.
    const columns = await rows<{ column_name: string; is_nullable: string; column_default: string | null }>(
      db,
      `select column_name, is_nullable, column_default
         from information_schema.columns
        where table_schema = 'public' and table_name = 'country_defaults'
          and column_name = any($1)
        order by column_name`,
      [ADDED],
    );
    expect(columns.map((c) => c.column_name).sort()).toEqual([...ADDED].sort());
    for (const column of columns) {
      expect(column.is_nullable, column.column_name).toBe('YES');
      expect(column.column_default, column.column_name).toBeNull();
    }
  });

  it('refuse a tax point, a scheme and a fiscal year that are not of their vocabulary', async () => {
    const country = (await one<{ country: string }>(db, 'select country from country_defaults limit 1')).country;
    for (const [column, value] of [
      ['tax_point_rule', 'whenever'],
      ['party_scheme', '208'],
      ['vat_scheme', 'VAT'],
      ['fiscal_year_default', 'march'],
    ] as const) {
      const message = await expectError(
        db,
        `update country_defaults set ${column} = '${value}' where country = '${country}'`,
      );
      expect(message, `${column} = ${value}`).toMatch(/violates check constraint/);
    }
    // And a negative payment term, which is a typo rather than a country.
    expect(
      await expectError(db, `update country_defaults set legal_payment_days = -1 where country = '${country}'`),
    ).toMatch(/violates check constraint/);
  });
});

describe('what each pack declares, compiled and read back', () => {
  it('holds for every pack of this checkout exactly what its manifest says', async () => {
    for (const slug of await listPacks(packs)) {
      const pack = await readPack(slug, packs);
      const stored = await rulesOf(pack.manifest.country);
      const declared = pack.documents;

      expect(stored['numbering_gapless'], slug).toBe(declared.numbering_gapless);
      expect(stored['number_format'], slug).toBe(declared.number_format);
      expect(stored['legal_payment_days'], slug).toBe(declared.legal_payment_days);
      expect(stored['late_payment_reference'], slug).toBe(declared.late_payment_reference);
      expect(stored['tax_point_rule'], slug).toBe(declared.tax_point_rule);
      expect(stored['einvoice_profile'], slug).toBe(declared.einvoice_profile);
      expect(stored['einvoice_mandatory_from'], slug).toBe(declared.einvoice_mandatory_from);
      expect(stored['party_scheme'], slug).toBe(declared.party_scheme);
      expect(stored['vat_scheme'], slug).toBe(declared.vat_scheme);
      expect(stored['bank_statement_formats'] ?? [], slug).toEqual(declared.bank_statement_formats);
      expect(stored['payment_formats'] ?? [], slug).toEqual(declared.payment_formats);
      expect(stored['fiscal_year_default'], slug).toBe(declared.fiscal_year_default);
    }
  });

  it('holds every mention of every pack, with its condition and its source', async () => {
    for (const slug of await listPacks(packs)) {
      const pack = await readPack(slug, packs);
      const stored = await rows<{
        code: string;
        applies_when: string;
        text: string;
        sequence: number;
        legal_reference: string | null;
      }>(
        db,
        `select code, applies_when, text, sequence, legal_reference
           from legal_mention_templates where country = $1 order by sequence, code`,
        [pack.manifest.country],
      );
      const declared = [...pack.documents.mentions].sort((a, b) => a.sequence - b.sequence);
      expect(stored.map((m) => m.code), slug).toEqual(declared.map((m) => m.code));
      for (const [index, mention] of declared.entries()) {
        expect(stored[index], `${slug} ${mention.code}`).toMatchObject({
          applies_when: mention.applies_when,
          text: mention.text,
          sequence: mention.sequence,
          legal_reference: mention.legal_reference,
        });
      }
      // A mention nobody can source is a mention nobody can review, and the
      // packs of this repository cite an article for every one of them.
      expect(stored.every((m) => m.legal_reference !== null), slug).toBe(true);
    }
  });

  it('keeps a translation of a mention beside it, not in a second table', async () => {
    // A mention carries its own `text_i18n`, the way a chart carries
    // `name_i18n`: the i18n/ folder translates things that are keyed by code
    // across several files, and a sentence is not one of them.
    const translated = await rows<{ code: string; languages: string[] }>(
      db,
      `select code, array(select jsonb_object_keys(text_i18n) order by 1) as languages
         from legal_mention_templates
        where text_i18n <> '{}'::jsonb
        order by country, code`,
    );
    expect(translated.length).toBeGreaterThan(0);
    for (const row of translated) expect(row.languages.length, row.code).toBeGreaterThan(0);
  });
});

describe('the mentions that apply to one document', () => {
  /** The codes the view returns for a document, in the order it prints them. */
  async function mentionsOf(documentId: string): Promise<string[]> {
    const found = await rows<{ code: string }>(
      db,
      'select code from document_legal_mentions where document_id = $1 order by sequence',
      [documentId],
    );
    return found.map((m) => m.code);
  }

  it('prints the reverse charge on a sale the customer accounts for', async () => {
    const { companyId } = await newCompany(db, { name: 'Cocontractant SRL' });
    const contactId = await newContact(db, companyId);
    const documentId = await newDocument(db, companyId, {
      docType: 'sale_invoice',
      contactId,
      lines: [{ unitPrice: 1000, taxCode: 'BE-S-CC', accountCode: '700000' }],
    });
    expect(await mentionsOf(documentId)).toEqual(['reverse_charge', 'late_payment']);
  });

  it('prints the intra-Union exemption on a supply of goods, and not the one for services', async () => {
    const { companyId } = await newCompany(db, { name: 'Intracom SRL' });
    const contactId = await newContact(db, companyId, { country: 'NL' });
    const documentId = await newDocument(db, companyId, {
      docType: 'sale_invoice',
      contactId,
      lines: [{ unitPrice: 2500, taxCode: 'BE-S-ICG', accountCode: '700000' }],
    });
    expect(await mentionsOf(documentId)).toEqual(['intracom_goods', 'late_payment']);
  });

  it('prints only what a plain domestic sale owes: the late payment terms', async () => {
    const { companyId } = await newCompany(db, { name: 'Domestique SRL' });
    const contactId = await newContact(db, companyId);
    const documentId = await newDocument(db, companyId, {
      docType: 'sale_invoice',
      contactId,
      lines: [{ unitPrice: 100, taxCode: 'BE-S-21', accountCode: '700000' }],
    });
    expect(await mentionsOf(documentId)).toEqual(['late_payment']);
  });

  it('prints nothing about late payment on an invoice somebody else wrote', async () => {
    // Interest and recovery costs are what a seller claims. On a purchase
    // invoice the mention would be a sentence about our own supplier's rights,
    // printed by us, which is why the condition is about the direction.
    const { companyId } = await newCompany(db, { name: 'Achats SRL' });
    const contactId = await newContact(db, companyId, { type: 'supplier' });
    const documentId = await newDocument(db, companyId, {
      docType: 'purchase_invoice',
      contactId,
      lines: [{ unitPrice: 400, taxCode: 'BE-P-21-G', accountCode: '600000' }],
    });
    expect(await mentionsOf(documentId)).toEqual([]);
  });

  it('never prints the franchise mention, because no column records the regime', async () => {
    // The sentence is in the table — a renderer that knows the seller is under
    // the franchise fetches it by code — and the view does not claim to know.
    // The day a regime becomes a column, this view gains one branch and this
    // test changes with it.
    const everywhere = await rows<{ n: number }>(
      db,
      `select count(*)::int as n from document_legal_mentions where applies_when = 'small_business'`,
    );
    expect(everywhere[0]?.n).toBe(0);
    const stored = await one<{ n: number }>(
      db,
      `select count(*)::int as n from legal_mention_templates where applies_when = 'small_business'`,
    );
    expect(stored.n).toBeGreaterThan(0);
  });

  it('takes the mention in force on the day of the document, not the one in force today', async () => {
    const { companyId } = await newCompany(db, { name: 'Validité SRL' });
    const country = (await one<{ c: string }>(db, 'select fiscal_country as c from companies where id = $1', [companyId])).c;
    await db.query(
      `insert into legal_mention_templates (country, code, applies_when, text, sequence, valid_from)
       values ($1, 'test_future', 'always', 'Pas encore.', 900, date '2030-01-01')`,
      [country],
    );
    const contactId = await newContact(db, companyId);
    const documentId = await newDocument(db, companyId, {
      docType: 'sale_invoice',
      date: '2026-06-15',
      contactId,
      lines: [{ unitPrice: 100, taxCode: 'BE-S-21', accountCode: '700000' }],
    });
    expect(await mentionsOf(documentId)).not.toContain('test_future');

    const later = await newDocument(db, companyId, {
      docType: 'sale_invoice',
      date: '2030-06-15',
      contactId,
      lines: [{ unitPrice: 100, taxCode: 'BE-S-21', accountCode: '700000' }],
    });
    expect(await mentionsOf(later)).toContain('test_future');
    await db.query(`delete from legal_mention_templates where code = 'test_future'`);
  });

  it('carries on the line what decides a mention: the treatment and the exemption reason', async () => {
    const { companyId } = await newCompany(db, { name: 'Lignes SRL' });
    const contactId = await newContact(db, companyId);
    const documentId = await newDocument(db, companyId, {
      docType: 'sale_invoice',
      contactId,
      lines: [{ unitPrice: 1000, taxCode: 'BE-S-ICG', accountCode: '700000' }],
    });
    const line = await one<{ tax_treatment: string; tax_cash_basis: boolean }>(
      db,
      'select tax_treatment, tax_cash_basis from document_line_items where document_id = $1',
      [documentId],
    );
    expect(line.tax_treatment).toBe('intracom_goods');
    expect(line.tax_cash_basis).toBe(false);
  });
});

describe('the mentions under row level security', () => {
  it('let a signed-in user read them, and nobody write them', async () => {
    const { ownerId } = await newCompany(db, { name: 'Lecture SRL' });

    await asUser(db, ownerId, async () => {
      const seen = await one<{ n: number }>(db, 'select count(*)::int as n from legal_mention_templates');
      expect(seen.n).toBeGreaterThan(5);

      // An insert is the statement that raises: with no policy for it, there
      // is nothing to check the new row against. An update and a delete find
      // no row they are allowed to touch and quietly change nothing, which is
      // the same refusal without the message — so the assertion is on what is
      // still there afterwards.
      const message = await expectError(
        db,
        `insert into legal_mention_templates (country, code, applies_when, text)
         values ('ZZ', 'mine', 'always', 'À moi')`,
      );
      expect(message).toMatch(/row-level security|permission denied/);

      await db.query(`update legal_mention_templates set text = 'À moi'`);
      await db.query('delete from legal_mention_templates');
      const after = await one<{ n: number; rewritten: number }>(
        db,
        `select count(*)::int as n,
                count(*) filter (where text = 'À moi')::int as rewritten
           from legal_mention_templates`,
      );
      expect(after.n).toBe(seen.n);
      expect(after.rewritten).toBe(0);
    });
  });

  it('reads as an empty set for a caller with no session at all', async () => {
    // The policy is `auth.uid() is not null`, like every other reference
    // table: a signed-in user of any company reads the law of every country,
    // and a caller with no session reads nothing.
    await db.exec(`select set_config('request.jwt.claims', '', false); set role anon;`);
    try {
      expect(await rows(db, 'select code from legal_mention_templates')).toEqual([]);
    } finally {
      await db.exec('reset role;');
    }
  });
});

describe('a seed applied again', () => {
  it('changes not one document rule and not one mention', async () => {
    const before = await rows(
      db,
      `select country, code, applies_when, text, sequence, legal_reference
         from legal_mention_templates order by country, sequence, code`,
    );
    const rulesBefore = await rows(
      db,
      `select country, numbering_gapless, number_format, legal_payment_days, tax_point_rule,
              einvoice_profile, party_scheme, vat_scheme, bank_statement_formats, payment_formats
         from country_defaults order by country`,
    );

    for (const file of await seedFiles()) {
      await db.exec(await readFile(join(seedDir, file), 'utf8'));
    }

    expect(
      await rows(
        db,
        `select country, code, applies_when, text, sequence, legal_reference
           from legal_mention_templates order by country, sequence, code`,
      ),
    ).toEqual(before);
    expect(
      await rows(
        db,
        `select country, numbering_gapless, number_format, legal_payment_days, tax_point_rule,
                einvoice_profile, party_scheme, vat_scheme, bank_statement_formats, payment_formats
           from country_defaults order by country`,
      ),
    ).toEqual(rulesBefore);
  });
});

describe('what `ekwo pack check` refuses', () => {
  it('refuses a condition, a tax point, a bank format and a scheme outside the vocabulary', async () => {
    const schema = await readSchema(packs);
    const defs = (schema['$defs'] ?? {}) as Record<string, Record<string, unknown>>;

    const documents = defs['documents'] ?? {};
    expect(validate({ tax_point: 'invoice_date' }, documents, schema)).toEqual([]);
    expect(validate({ tax_point: 'whenever' }, documents, schema)).toHaveLength(1);
    expect(
      validate(
        { mentions: [{ code: 'x', applies_when: 'always', text: 'A' }] },
        documents,
        schema,
      ),
    ).toEqual([]);
    expect(
      validate(
        { mentions: [{ code: 'x', applies_when: 'treatment=domestic_reverse_charge', text: 'A' }] },
        documents,
        schema,
      ),
    ).toHaveLength(1);

    const bank = defs['bank'] ?? {};
    expect(validate({ statement_formats: ['coda', 'camt.053'] }, bank, schema)).toEqual([]);
    expect(validate({ statement_formats: ['coda-ish'] }, bank, schema)).toHaveLength(1);
    expect(validate({ payment_formats: ['pain.001'] }, bank, schema)).toEqual([]);
    expect(validate({ payment_formats: ['pain.999'] }, bank, schema)).toHaveLength(1);

    const einvoicing = defs['einvoicing'] ?? {};
    expect(validate({ party_scheme: '0208', vat_scheme: '9925' }, einvoicing, schema)).toEqual([]);
    // ISO 6523 is four digits, and a scheme written as a country prefix plus a
    // word is the shape the pack used to carry and nobody could look up.
    expect(validate({ vat_scheme: 'XX:VAT' }, einvoicing, schema)).toHaveLength(1);
    expect(validate({ mandatory_from: '2026-13-45x' }, einvoicing, schema)).toHaveLength(1);
  });

  it('refuses a number format nobody can read, and a duplicate mention', async () => {
    const slug = (await listPacks(packs))[0] as string;
    const manifest = JSON.parse(await readFile(join(packs, slug, 'pack.json'), 'utf8')) as Record<string, unknown>;
    const documents = manifest['documents'] as Record<string, unknown>;

    // The checks live in readPack, which throws on the whole pack, so they are
    // exercised through a written copy rather than a unit call — the same way
    // the statement and box checks are.
    const { mkdtemp, writeFile, cp } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const scratch = await mkdtemp(join(tmpdir(), 'ekwo-pack-'));
    await cp(join(packs, 'schema'), join(scratch, 'schema'), { recursive: true });
    await cp(join(packs, slug), join(scratch, slug), { recursive: true });

    const write = async (change: Record<string, unknown>): Promise<void> => {
      await writeFile(
        join(scratch, slug, 'pack.json'),
        JSON.stringify({ ...manifest, documents: { ...documents, ...change } }, null, 2),
        'utf8',
      );
    };

    await write({ number_format: '{CODE}/{ANNEE}/{NNNN}' });
    await expect(readPack(slug, scratch)).rejects.toThrow(/is not a token/);

    await write({ number_format: '{CODE}/{YYYY}' });
    await expect(readPack(slug, scratch)).rejects.toThrow(/carries no counter/);

    const mentions = documents['mentions'] as Record<string, unknown>[];
    await write({ mentions: [...mentions, mentions[0] as Record<string, unknown>] });
    await expect(readPack(slug, scratch)).rejects.toThrow(/duplicate mention code/);

    await write({
      mentions: [{ code: 'orphan', applies_when: 'always', text: 'Sans source.' }],
    });
    await expect(readPack(slug, scratch)).rejects.toThrow(/names no legal_reference/);
  });

  it('refuses a day an obligation starts when nothing says what becomes obligatory', async () => {
    const slug = (await listPacks(packs))[0] as string;
    const manifest = JSON.parse(await readFile(join(packs, slug, 'pack.json'), 'utf8')) as Record<string, unknown>;
    const { mkdtemp, writeFile, cp } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const scratch = await mkdtemp(join(tmpdir(), 'ekwo-pack-'));
    await cp(join(packs, 'schema'), join(scratch, 'schema'), { recursive: true });
    await cp(join(packs, slug), join(scratch, slug), { recursive: true });
    await writeFile(
      join(scratch, slug, 'pack.json'),
      JSON.stringify({ ...manifest, einvoicing: { mandatory_from: '2026-01-01' } }, null, 2),
      'utf8',
    );
    await expect(readPack(slug, scratch)).rejects.toThrow(/no profile says what becomes obligatory/);
  });

  it('no longer lists documents, e-invoicing and bank as sections it skipped', async () => {
    for (const slug of await listPacks(packs)) {
      const pack = await readPack(slug, packs);
      expect(pack.deferred.join(' '), slug).not.toMatch(/documents|einvoicing|bank/);
      expect(compilePack(pack), slug).toContain('update country_defaults set');
    }
  });
});

describe('no country lives in what this change added', () => {
  it('leaves no country code in the migration, the view or the table', async () => {
    // The repo-wide guards in `tax_report.test.ts` cover every migration and
    // every function. A view is neither, and it is exactly the kind of object
    // where a `fiscal_country = 'BE'` would look natural, so it gets its own.
    const definitions = await rows<{ viewname: string; definition: string }>(
      db,
      `select viewname, definition from pg_views
        where schemaname = 'public' and viewname in ('document_legal_mentions', 'document_line_items')`,
    );
    expect(definitions).toHaveLength(2);
    for (const view of definitions) {
      expect(view.definition, view.viewname).not.toMatch(/'(BE|FR|UK|US|CA|GB|IE|NL|DE|LU)'/);
    }

    const constraints = await rows<{ definition: string }>(
      db,
      `select pg_get_constraintdef(c.oid) as definition
         from pg_constraint c join pg_class t on t.oid = c.conrelid
        where t.relname in ('legal_mention_templates', 'country_defaults')`,
    );
    for (const constraint of constraints) {
      expect(constraint.definition).not.toMatch(/'(BE|FR|UK|US|CA|GB|IE|NL|DE|LU)'/);
    }
  });

  it('left the document rules of a country to one reader, and no other', async () => {
    // These columns shipped with nothing executable: no function read any of
    // them, and this test asserted an empty list. The numbering engine that
    // entry said would come has since been written — "a numbering engine that consumes a
    // format is its own piece of work" — so one function reads them now, and
    // the rule becomes: exactly one, named here. `numbering_rules()` answers
    // both questions the number asks, `next_entry_number()` and `post_entry()`
    // call it, and nothing else goes near `country_defaults` for a document
    // rule.
    //
    // The query asks about functions that touch `country_defaults` at all,
    // because `number_format` is also the name of a user preference — how one
    // person likes a number written — and a homonym in another table is not
    // this rule being broken.
    const added = await rows<{ proname: string }>(
      db,
      `select p.proname
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.prosrc ilike '%country_defaults%'
          and (p.prosrc ilike '%legal_mention%' or p.prosrc ilike '%einvoice_profile%'
               or p.prosrc ilike '%tax_point_rule%' or p.prosrc ilike '%number_format%')
        order by 1`,
    );
    expect(added.map((f) => f.proname)).toEqual(['numbering_rules']);
  });
});
