import type { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compilePack, packsDir, readPack } from '../packages/cli/src/index.js';
import { asUser, expectError, freshDatabase, one, repoRoot, rows } from './helpers/db.js';
import { accountId, ledgerOf, newCompany, newContact, newDocument, taxId, type Fixture } from './helpers/factory.js';

// The generalised tax engine. Two things are proved here:
//
//   * the columns exist, carry today's behaviour as their default, and reach a
//     company through `install_country_template`;
//   * `tax_on_base` posts non-deductible VAT on the account of the line rather
//     than on a VAT account, balanced to the cent, with the declaration boxes
//     the Belgian and the French returns ask for.
//
// Everything about a tax that existed before is unchanged, and `posting.test.ts`
// is the file that proves that: it was not touched.

let db: PGlite;
let be: Fixture;
let fr: Fixture;

beforeAll(async () => {
  db = await freshDatabase();
  be = await newCompany(db, { country: 'BE', name: 'Voitures SRL' });
  fr = await newCompany(db, { country: 'FR', name: 'Carburant SAS' });
}, 120_000);

afterAll(async () => {
  await db.close();
});

describe('the columns of the generalised engine', () => {
  it('gives tax_posting_type its third value', async () => {
    const values = await rows<{ enumlabel: string }>(
      db,
      `select e.enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid
        where t.typname = 'tax_posting_type' order by e.enumsortorder`,
    );
    expect(values.map((v) => v.enumlabel)).toEqual(['base', 'tax', 'tax_on_base']);
  });

  it('names the five kinds of tax and the four rounding methods', async () => {
    const enumeration = async (name: string): Promise<string[]> =>
      (
        await rows<{ enumlabel: string }>(
          db,
          `select e.enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid
            where t.typname = $1 order by e.enumsortorder`,
          [name],
        )
      ).map((v) => v.enumlabel);

    expect(await enumeration('tax_kind')).toEqual(['vat', 'gst', 'sales_tax', 'withholding', 'other']);
    expect(await enumeration('rounding_method')).toEqual(['half_up', 'half_even', 'down', 'up']);
  });

  it('defaults every existing tax to a fully recoverable VAT on a price without it', async () => {
    // Cash-basis VAT gave the French services taxes a cash basis, and they are the only
    // ones: everything else falls due when it is invoiced, and a tax that
    // waits names the account it waits on.
    const odd = await rows(
      db,
      `select code from taxes
        where tax_kind <> 'vat' or price_include or jurisdiction is not null
           or (cash_basis and cash_basis_transition_account_id is null)
           or (not cash_basis and cash_basis_transition_account_id is not null)`,
    );
    expect(odd).toEqual([]);

    // Only the three Belgian and one French tax this release adds are not
    // fully recoverable, and the flag says so in one word.
    const notRecoverable = await rows<{ country: string; code: string }>(
      db,
      `select country, code from tax_templates where not recoverable order by country, code`,
    );
    expect(notRecoverable).toEqual([{ country: 'BE', code: 'BE-P-21-ND' }]);
  });

  it('carries the rounding rule of a country, which is half away from zero in both', async () => {
    const defaults = await rows<{ country: string; rounding_method: string; cash_rounding_unit: string }>(
      db,
      `select country, rounding_method::text, cash_rounding_unit::text
         from country_defaults order by country`,
    );
    expect(defaults).toEqual([
      { country: 'BE', rounding_method: 'half_up', cash_rounding_unit: '0.0000' },
      { country: 'FR', rounding_method: 'half_up', cash_rounding_unit: '0.0000' },
    ]);
  });

  it('copies the new columns from the template into the company', async () => {
    const tax = await one<{ tax_kind: string; recoverable: boolean; price_include: boolean; cash_basis: boolean }>(
      db,
      `select tax_kind::text, recoverable, price_include, cash_basis
         from taxes where company_id = $1 and code = 'BE-P-21-ND'`,
      [be.companyId],
    );
    expect(tax).toEqual({ tax_kind: 'vat', recoverable: false, price_include: false, cash_basis: false });
  });
});

describe('which posting type carries an account', () => {
  it('refuses an account on a tax_on_base posting, and demands one on a tax posting', async () => {
    const tax = await taxId(db, be.companyId, 'BE-P-21-S');
    const account = await accountId(db, be.companyId, '411000');

    const withAccount = await expectError(
      db,
      `insert into tax_postings (tax_id, company_id, document_kind, posting_type, account_id)
       values ($1, $2, 'invoice', 'tax_on_base', $3)`,
      [tax, be.companyId, account],
    );
    expect(withAccount).toMatch(/tax_postings_account_by_type/);

    const withoutAccount = await expectError(
      db,
      `insert into tax_postings (tax_id, company_id, document_kind, posting_type, sequence)
       values ($1, $2, 'invoice', 'tax', 990)`,
      [tax, be.companyId],
    );
    expect(withoutAccount).toMatch(/tax_postings_account_by_type/);
  });

  it('holds the same rule on the templates', async () => {
    const template = await one<{ id: string }>(
      db,
      `select id from tax_templates where country = 'BE' and code = 'BE-P-21-S'`,
    );
    const message = await expectError(
      db,
      `insert into tax_posting_templates (tax_template_id, document_kind, posting_type, account_code, sequence)
       values ($1, 'invoice', 'tax_on_base', '411000', 991)`,
      [template.id],
    );
    expect(message).toMatch(/tax_posting_templates_account_by_type/);
  });
});

describe('post_document — a Belgian company car', () => {
  it('books half the VAT on the deductible account and half on the car, grid 83 carrying both', async () => {
    const supplier = await newContact(db, be.companyId, { name: 'Concession', type: 'supplier' });
    const doc = await newDocument(db, be.companyId, {
      docType: 'purchase_invoice',
      number: 'ACH-CAR',
      contactId: supplier,
      date: '2026-06-15',
      lines: [{ unitPrice: 1000, taxCode: 'BE-P-21-50-I', accountCode: '242000' }],
    });
    await db.query(`select post_document($1)`, [doc]);

    expect(await ledgerOf(db, doc)).toEqual([
      { code: '242000', debit: '1000.00', credit: '0.00', box: '83', box_amount: '1000.00', tax_line: false },
      { code: '411000', debit: '105.00', credit: '0.00', box: '59', box_amount: '105.00', tax_line: true },
      // The non-deductible half is part of what the car cost, so it lands on
      // the car, not on a VAT account — and it is not a tax line.
      { code: '242000', debit: '105.00', credit: '0.00', box: '83', box_amount: '105.00', tax_line: false },
      { code: '440000', debit: '0.00', credit: '1210.00', box: null, box_amount: null, tax_line: false },
    ]);

    // The supplier is owed the whole invoice: 1 000 + 210, not 1 000 + 105.
    const document = await one<{ amount_untaxed: string; amount_tax: string; amount_total: string }>(
      db,
      `select amount_untaxed, amount_tax, amount_total from documents where id = $1`,
      [doc],
    );
    expect(document).toEqual({ amount_untaxed: '1000.00', amount_tax: '210.00', amount_total: '1210.00' });

    const entry = await one<{ total_debit: string; total_credit: string; is_balanced: boolean }>(
      db,
      `select total_debit, total_credit, is_balanced from entries where document_id = $1`,
      [doc],
    );
    expect(entry).toEqual({ total_debit: '1210.00', total_credit: '1210.00', is_balanced: true });
  });

  it('reports grid 83 as the base plus the non-deductible VAT, and grid 59 as the deductible half', async () => {
    const boxes = await rows<{ box: string; kind: string; amount: string }>(
      db,
      `select box, kind, amount::text from vat_return($1, date '2026-06-01', date '2026-06-30')
        where box in ('59', '83') order by box`,
      [be.companyId],
    );
    // One row per box, not two: the non-deductible VAT is on the base side of
    // the declaration, which is what « TVA déductible non comprise » means.
    expect(boxes).toEqual([
      { box: '59', kind: 'tax', amount: '105.00' },
      { box: '83', kind: 'base', amount: '1105.00' },
    ]);
  });

  it('reverses the sides on a credit note and keeps the same split', async () => {
    const supplier = await newContact(db, be.companyId, { name: 'Concession avoir', type: 'supplier' });
    const doc = await newDocument(db, be.companyId, {
      docType: 'purchase_credit_note',
      number: 'NCA-CAR',
      contactId: supplier,
      date: '2026-07-10',
      lines: [{ unitPrice: 1000, taxCode: 'BE-P-21-50-I', accountCode: '242000' }],
    });
    await db.query(`select post_document($1)`, [doc]);

    expect(await ledgerOf(db, doc)).toEqual([
      { code: '242000', debit: '0.00', credit: '1000.00', box: '85', box_amount: '1000.00', tax_line: false },
      { code: '411000', debit: '0.00', credit: '105.00', box: '63', box_amount: '105.00', tax_line: true },
      { code: '242000', debit: '0.00', credit: '105.00', box: '85', box_amount: '105.00', tax_line: false },
      { code: '440000', debit: '1210.00', credit: '0.00', box: null, box_amount: null, tax_line: false },
    ]);

    const negatives = await one<{ count: number }>(
      db,
      `select count(*)::int as count from entry_lines where debit < 0 or credit < 0`,
    );
    expect(Number(negatives.count)).toBe(0);
  });

  it('splits the non-deductible VAT across the accounts of the lines it taxes', async () => {
    const supplier = await newContact(db, be.companyId, { name: 'Garage mixte', type: 'supplier' });
    const doc = await newDocument(db, be.companyId, {
      docType: 'purchase_invoice',
      number: 'ACH-MIX',
      contactId: supplier,
      date: '2026-06-16',
      lines: [
        { name: 'Carburant', unitPrice: 300, taxCode: 'BE-P-21-50-S', accountCode: '615100' },
        { name: 'Entretien', unitPrice: 700, taxCode: 'BE-P-21-50-S', accountCode: '611000' },
      ],
    });
    await db.query(`select post_document($1)`, [doc]);

    expect(await ledgerOf(db, doc)).toEqual([
      { code: '615100', debit: '300.00', credit: '0.00', box: '82', box_amount: '300.00', tax_line: false },
      { code: '611000', debit: '700.00', credit: '0.00', box: '82', box_amount: '700.00', tax_line: false },
      { code: '411000', debit: '105.00', credit: '0.00', box: '59', box_amount: '105.00', tax_line: true },
      // 105 shared in proportion to the bases: 31.50 and 73.50.
      { code: '615100', debit: '31.50', credit: '0.00', box: '82', box_amount: '31.50', tax_line: false },
      { code: '611000', debit: '73.50', credit: '0.00', box: '82', box_amount: '73.50', tax_line: false },
      { code: '440000', debit: '0.00', credit: '1210.00', box: null, box_amount: null, tax_line: false },
    ]);
  });

  it('gives the last share the rounding difference, so the entry still balances', async () => {
    const supplier = await newContact(db, be.companyId, { name: 'Trois tiers', type: 'supplier' });
    const doc = await newDocument(db, be.companyId, {
      docType: 'purchase_invoice',
      number: 'ACH-TIERS',
      contactId: supplier,
      date: '2026-06-17',
      lines: [
        { name: 'A', unitPrice: 10, taxCode: 'BE-P-21-50-S', accountCode: '615100' },
        { name: 'B', unitPrice: 10, taxCode: 'BE-P-21-50-S', accountCode: '611000' },
        { name: 'C', unitPrice: 10, taxCode: 'BE-P-21-50-S', accountCode: '612000' },
      ],
    });
    await db.query(`select post_document($1)`, [doc]);

    // 30.00 at 21 % is 6.30; half is 3.15, and a third of 3.15 is 1.05 exactly,
    // so the shares are equal. What matters is that they sum to the half that
    // was rounded once, which the balance proves.
    const nonDeductible = (await ledgerOf(db, doc)).filter(
      (l) => !l.tax_line && Number(l.debit) > 0 && Number(l.debit) < 10,
    );
    expect(nonDeductible.map((l) => l.debit)).toEqual(['1.05', '1.05', '1.05']);

    const entry = await one<{ total_debit: string; total_credit: string; is_balanced: boolean }>(
      db,
      `select total_debit, total_credit, is_balanced from entries where document_id = $1`,
      [doc],
    );
    expect(entry).toEqual({ total_debit: '36.30', total_credit: '36.30', is_balanced: true });
  });

  it('shares an odd cent between the two halves instead of booking it twice', async () => {
    // 3.00 at 21 % is 0.63, and half of it is 0.315. Rounding each half on its
    // own books 0.32 twice against a document that totals 3.63, and
    // `post_document` would refuse it with document_total_mismatch. The halves
    // are shared out of the tax of the group, so they come to 0.32 and 0.31.
    const supplier = await newContact(db, be.companyId, { name: 'Petit plein', type: 'supplier' });
    const doc = await newDocument(db, be.companyId, {
      docType: 'purchase_invoice',
      number: 'ACH-CENT',
      contactId: supplier,
      date: '2026-06-19',
      lines: [{ unitPrice: 3, taxCode: 'BE-P-21-50-S', accountCode: '615100' }],
    });
    await db.query(`select post_document($1)`, [doc]);

    expect(await ledgerOf(db, doc)).toEqual([
      { code: '615100', debit: '3.00', credit: '0.00', box: '82', box_amount: '3.00', tax_line: false },
      { code: '411000', debit: '0.32', credit: '0.00', box: '59', box_amount: '0.32', tax_line: true },
      // The box keeps its own rounding — 0.32 where the ledger books 0.31 —
      // because `box_factor_percent` has always been independent from
      // `factor_percent`: a declaration figure is not a ledger figure, and
      // only the ledger has to balance. On a whole return the cent is lost in
      // the sum; the alternative is to make a grid drive a posting.
      { code: '615100', debit: '0.31', credit: '0.00', box: '82', box_amount: '0.32', tax_line: false },
      { code: '440000', debit: '0.00', credit: '3.63', box: null, box_amount: null, tax_line: false },
    ]);
  });
});

describe('post_document — a fully non-deductible tax', () => {
  it('books the whole tax on the expense account, which is tax_on_base at 100 %', async () => {
    const supplier = await newContact(db, be.companyId, { name: 'Traiteur', type: 'supplier' });
    const doc = await newDocument(db, be.companyId, {
      docType: 'purchase_invoice',
      number: 'ACH-RECEP',
      contactId: supplier,
      date: '2026-08-05',
      lines: [{ unitPrice: 500, taxCode: 'BE-P-21-ND', accountCode: '613000' }],
    });
    await db.query(`select post_document($1)`, [doc]);

    expect(await ledgerOf(db, doc)).toEqual([
      { code: '613000', debit: '500.00', credit: '0.00', box: '82', box_amount: '500.00', tax_line: false },
      { code: '613000', debit: '105.00', credit: '0.00', box: '82', box_amount: '105.00', tax_line: false },
      { code: '440000', debit: '0.00', credit: '605.00', box: null, box_amount: null, tax_line: false },
    ]);

    // Nothing lands on a VAT account, and the whole 605 is owed.
    const vat = await rows(
      db,
      `select 1 from entry_lines l join entries e on e.id = l.entry_id
         join accounts a on a.id = l.account_id
        where e.document_id = $1 and a.code = '411000'`,
      [doc],
    );
    expect(vat).toEqual([]);
    const document = await one<{ amount_total: string }>(
      db,
      `select amount_total from documents where id = $1`,
      [doc],
    );
    expect(document.amount_total).toBe('605.00');
  });
});

describe('post_document — French fuel at 80 %', () => {
  it('deducts 80 % on line 20 of the CA3 and books 20 % on the expense', async () => {
    const supplier = await newContact(db, fr.companyId, {
      name: 'Station',
      type: 'supplier',
      country: 'FR',
    });
    const doc = await newDocument(db, fr.companyId, {
      docType: 'purchase_invoice',
      number: 'ACH-GO',
      contactId: supplier,
      date: '2026-06-15',
      lines: [{ unitPrice: 1000, taxCode: 'FR-P-20-CARB', accountCode: '606100' }],
    });
    await db.query(`select post_document($1)`, [doc]);

    expect(await ledgerOf(db, doc)).toEqual([
      // The CA3 has no grid for the base of a purchase, so the base line
      // carries no box — exactly like every other French purchase tax.
      { code: '606100', debit: '1000.00', credit: '0.00', box: null, box_amount: null, tax_line: false },
      { code: '445660', debit: '160.00', credit: '0.00', box: '20', box_amount: '160.00', tax_line: true },
      { code: '606100', debit: '40.00', credit: '0.00', box: null, box_amount: null, tax_line: false },
      { code: '401000', debit: '0.00', credit: '1200.00', box: null, box_amount: null, tax_line: false },
    ]);
  });
});

describe('row level security', () => {
  it('lets a member post a document that carries a tax_on_base tax', async () => {
    const supplier = await newContact(db, be.companyId, { name: 'RLS garage', type: 'supplier' });
    const doc = await newDocument(db, be.companyId, {
      docType: 'purchase_invoice',
      number: 'ACH-RLS',
      contactId: supplier,
      date: '2026-06-23',
      lines: [{ unitPrice: 400, taxCode: 'BE-P-21-50-S', accountCode: '615100' }],
    });
    await db.query(`insert into auth.users (id, email) values ($1, $2)`, [
      be.ownerId,
      `${be.ownerId}@example.test`,
    ]);

    await asUser(db, be.ownerId, async () => {
      await db.query(`select post_document($1)`, [doc]);
    });

    const entry = await one<{ total_debit: string; is_balanced: boolean }>(
      db,
      `select total_debit, is_balanced from entries where document_id = $1`,
      [doc],
    );
    expect(entry).toEqual({ total_debit: '484.00', is_balanced: true });
  });

  it('refuses to write a tax posting for a company the user is not in', async () => {
    const stranger = await one<{ id: string }>(db, `insert into auth.users (id, email)
      values (gen_random_uuid(), 'stranger-tax@example.test') returning id`);
    const tax = await taxId(db, be.companyId, 'BE-P-21-50-S');

    const message = await asUser(db, stranger.id, async () =>
      expectError(
        db,
        `insert into tax_postings (tax_id, company_id, document_kind, posting_type, sequence)
         values ($1, $2, 'invoice', 'tax_on_base', 995)`,
        [tax, be.companyId],
      ),
    );
    expect(message).toMatch(/row-level security|violates/i);
  });
});

describe('no country decided anywhere but in a pack', () => {
  // "Il n'y a pas de raison de mettre la Belgique par défaut. Le système doit
  // rester ouvert et international." The repo-wide guard in
  // `tax_report.test.ts` catches a country *literal*; these catch the subtler
  // thing, a country's *answer* used as a fallback — a rounding rule or a
  // cash unit that the code supplies when a pack stays silent.

  const COUNTRY_LITERAL = /'(BE|FR|UK|US|CA|GB|IE|NL|DE|LU)'/;

  const MIGRATIONS = [
    '20260912091917_tax_on_base_value.sql',
    '20260912091918_tax_engine_columns.sql',
  ];

  it('leaves no country code and no country test in the migrations of this change', async () => {
    for (const name of MIGRATIONS) {
      const sql = await readFile(join(repoRoot, 'supabase', 'migrations', name), 'utf8');
      const statements = sql
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('--'))
        .join('\n');
      expect(COUNTRY_LITERAL.exec(statements)?.[0] ?? null, name).toBeNull();
      // Every country reference in `install_country_template` is the argument
      // it was called with. A comparison against anything else would be a
      // country deciding something inside the core.
      const comparisons = statements.match(/country\s*(?:=|in)\s*[^p\s]/g) ?? [];
      expect(comparisons, `${name} compares country to something that is not p_country`).toEqual([]);
    }
  });

  it('compiles the rounding rule a pack declares, whatever it is', async () => {
    const pack = await readPack('be', packsDir());
    const swiss = {
      ...pack,
      manifest: {
        ...pack.manifest,
        defaults: {
          ...pack.manifest.defaults,
          rounding_method: 'half_even',
          cash_rounding_unit: 0.05,
        },
      },
    };
    const sql = compilePack(swiss);
    expect(sql).toContain("'half_even', 0.05,");
  });

  it('lets the column decide when a pack declares nothing, instead of picking a country', async () => {
    const pack = await readPack('be', packsDir());
    const defaults = { ...pack.manifest.defaults };
    delete (defaults as Record<string, unknown>)['rounding_method'];
    delete (defaults as Record<string, unknown>)['cash_rounding_unit'];

    const sql = compilePack({ ...pack, manifest: { ...pack.manifest, defaults } });
    // `default, default`, never `'half_up', 0` written by the compiler: the
    // mechanism lives in the migration and in one place only.
    expect(sql).toContain('default, default,');
    expect(sql).not.toContain("'half_up'");
  });

  it('reads the rounding rule of a company from its country model and nowhere else', async () => {
    // Nothing in the core may answer "how does this company round" without
    // going through `country_defaults`. Since the rounding reads the currency,
    // exactly one function names a method — the arithmetic that switches on
    // it — and exactly one reads the column. A third name in either list is a
    // second answer to a question that has one.
    const naming = await rows<{ proname: string }>(
      db,
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prosrc ~ 'half_up|half_even' order by 1`,
    );
    expect(naming.map((r) => r.proname)).toEqual(['round_amount']);

    const reading = await rows<{ proname: string }>(
      db,
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public', 'assets', 'budgets')
          and p.prosrc ~ 'decimal_places|\\.rounding_method' order by 1`,
    );
    expect(reading.map((r) => r.proname)).toEqual(['rounding_of']);
  });
});
