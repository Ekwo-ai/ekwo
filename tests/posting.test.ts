import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectError, freshDatabase, one, rows } from './helpers/db.js';
import {
  expectedNumber,
  ledgerOf,
  newCompany,
  newContact,
  newDocument,
  numberShape,
  type Fixture,
} from './helpers/factory.js';

let db: PGlite;
let fx: Fixture;

beforeAll(async () => {
  db = await freshDatabase();
  fx = await newCompany(db, { country: 'BE' });
});

afterAll(async () => {
  await db.close();
});

describe('post_document — Belgian sales', () => {
  it('books a 21 % invoice as three balanced lines: 400 / 704 / 451', async () => {
    const customer = await newContact(db, fx.companyId, { name: 'Client BE' });
    const doc = await newDocument(db, fx.companyId, {
      docType: 'sale_invoice',
      number: 'FAC-001',
      contactId: customer,
      date: '2026-06-15',
      lines: [{ unitPrice: 1000, taxCode: 'BE-S-21', accountCode: '704000' }],
    });

    await db.query(`select post_document($1)`, [doc]);

    const lines = await ledgerOf(db, doc);
    expect(lines).toEqual([
      { code: '704000', debit: '0.00', credit: '1000.00', box: '03', box_amount: '1000.00', tax_line: false },
      { code: '451000', debit: '0.00', credit: '210.00', box: '54', box_amount: '210.00', tax_line: true },
      { code: '400000', debit: '1210.00', credit: '0.00', box: null, box_amount: null, tax_line: false },
    ]);

    const entry = await one<{ total_debit: string; total_credit: string; state: string; number: string }>(
      db,
      `select total_debit, total_credit, state, number from entries where document_id = $1`,
      [doc],
    );
    expect(entry.total_debit).toBe('1210.00');
    expect(entry.total_credit).toBe('1210.00');
    expect(entry.state).toBe('posted');
    expect(entry.number).toMatch(await numberShape(db, fx.companyId, 'SAL', '2026-06-15'));

    const document = await one<{ state: string; amount_total: string; payment_state: string }>(
      db,
      `select state, amount_total, payment_state from documents where id = $1`,
      [doc],
    );
    expect(document.state).toBe('posted');
    expect(document.amount_total).toBe('1210.00');
    expect(document.payment_state).toBe('not_paid');
  });

  it('reverses the sides on a credit note instead of negating the amounts', async () => {
    const customer = await newContact(db, fx.companyId, { name: 'Client avoir' });
    const doc = await newDocument(db, fx.companyId, {
      docType: 'sale_credit_note',
      number: 'NCC-001',
      contactId: customer,
      date: '2026-06-20',
      lines: [{ unitPrice: 500, taxCode: 'BE-S-21', accountCode: '704000' }],
    });

    await db.query(`select post_document($1)`, [doc]);

    expect(await ledgerOf(db, doc)).toEqual([
      { code: '704000', debit: '500.00', credit: '0.00', box: '49', box_amount: '500.00', tax_line: false },
      { code: '451000', debit: '105.00', credit: '0.00', box: '64', box_amount: '105.00', tax_line: true },
      { code: '400000', debit: '0.00', credit: '605.00', box: null, box_amount: null, tax_line: false },
    ]);

    const negatives = await one<{ count: number }>(
      db,
      `select count(*)::int as count from entry_lines where debit < 0 or credit < 0`,
    );
    expect(Number(negatives.count)).toBe(0);
  });

  it('rounds VAT once per tax group, not per line', async () => {
    const customer = await newContact(db, fx.companyId, { name: 'Client arrondi' });
    // Three lines of 0.33 each: 0.33 x 21 % rounds to 0.07 per line (0.21 in
    // total) but the group basis of 0.99 gives 0.21 too. Use 3 x 1.11 where
    // per-line rounding gives 0.70 and the group rule gives 0.70; the real
    // difference shows on 3 x 0.15 -> 0.0315 each.
    const doc = await newDocument(db, fx.companyId, {
      docType: 'sale_invoice',
      number: 'FAC-ROUND',
      contactId: customer,
      date: '2026-06-21',
      lines: [
        { unitPrice: 0.15, taxCode: 'BE-S-21', accountCode: '704000' },
        { unitPrice: 0.15, taxCode: 'BE-S-21', accountCode: '704000' },
        { unitPrice: 0.15, taxCode: 'BE-S-21', accountCode: '704000' },
      ],
    });
    await db.query(`select post_document($1)`, [doc]);

    const doc2 = await one<{ amount_untaxed: string; amount_tax: string; amount_total: string }>(
      db,
      `select amount_untaxed, amount_tax, amount_total from documents where id = $1`,
      [doc],
    );
    // 0.45 x 21 % = 0.0945 -> 0.09, where three per-line roundings give 0.03 x 3 = 0.09
    // only by luck; the group rule is the one EN 16931 requires.
    expect(doc2.amount_untaxed).toBe('0.45');
    expect(doc2.amount_tax).toBe('0.09');
    expect(doc2.amount_total).toBe('0.54');
  });

  it('applies the discount once, as a percentage of the line', async () => {
    const customer = await newContact(db, fx.companyId, { name: 'Client remise' });
    const doc = await newDocument(db, fx.companyId, {
      docType: 'sale_invoice',
      number: 'FAC-DISC',
      contactId: customer,
      date: '2026-06-22',
      lines: [{ quantity: 4, unitPrice: 250, discountPercent: 10, taxCode: 'BE-S-21', accountCode: '704000' }],
    });
    await db.query(`select post_document($1)`, [doc]);

    const totals = await one<{ amount_untaxed: string; amount_tax: string }>(
      db,
      `select amount_untaxed, amount_tax from documents where id = $1`,
      [doc],
    );
    expect(totals.amount_untaxed).toBe('900.00');
    expect(totals.amount_tax).toBe('189.00');
  });
});

describe('post_document — Belgian purchases', () => {
  it('books a domestic 21 % purchase to 613 / 411 / 440 with boxes 82 and 59', async () => {
    const supplier = await newContact(db, fx.companyId, { name: 'Fournisseur BE', type: 'supplier' });
    const doc = await newDocument(db, fx.companyId, {
      docType: 'purchase_invoice',
      number: 'ACH-001',
      contactId: supplier,
      date: '2026-06-18',
      lines: [{ unitPrice: 2000, taxCode: 'BE-P-21-S', accountCode: '613000' }],
    });
    await db.query(`select post_document($1)`, [doc]);

    expect(await ledgerOf(db, doc)).toEqual([
      { code: '613000', debit: '2000.00', credit: '0.00', box: '82', box_amount: '2000.00', tax_line: false },
      { code: '411000', debit: '420.00', credit: '0.00', box: '59', box_amount: '420.00', tax_line: true },
      { code: '440000', debit: '0.00', credit: '2420.00', box: null, box_amount: null, tax_line: false },
    ]);
  });

  it('self-assesses an intra-community acquisition of goods: boxes 86, 55 and 59', async () => {
    const supplier = await newContact(db, fx.companyId, {
      name: 'Leverancier NL',
      type: 'supplier',
      country: 'NL',
      vat: 'NL001234567B01',
    });
    const doc = await newDocument(db, fx.companyId, {
      docType: 'purchase_invoice',
      number: 'ACH-IC',
      contactId: supplier,
      date: '2026-06-25',
      lines: [{ unitPrice: 1000, taxCode: 'BE-P-ICG-21', accountCode: '604000' }],
    });
    await db.query(`select post_document($1)`, [doc]);

    expect(await ledgerOf(db, doc)).toEqual([
      { code: '604000', debit: '1000.00', credit: '0.00', box: '86', box_amount: '1000.00', tax_line: false },
      { code: '411000', debit: '210.00', credit: '0.00', box: '59', box_amount: '210.00', tax_line: true },
      { code: '451000', debit: '0.00', credit: '210.00', box: '55', box_amount: '210.00', tax_line: true },
      { code: '440000', debit: '0.00', credit: '1000.00', box: null, box_amount: null, tax_line: false },
    ]);

    // The supplier is owed the net amount: the VAT never leaves the company.
    const doc2 = await one<{ amount_tax: string; amount_total: string }>(
      db,
      `select amount_tax, amount_total from documents where id = $1`,
      [doc],
    );
    expect(doc2.amount_tax).toBe('0.00');
    expect(doc2.amount_total).toBe('1000.00');
  });

  it('sends an intra-community service to box 88 rather than 86', async () => {
    const supplier = await newContact(db, fx.companyId, {
      name: 'Dienst NL',
      type: 'supplier',
      country: 'NL',
      vat: 'NL009876543B01',
    });
    const doc = await newDocument(db, fx.companyId, {
      docType: 'purchase_invoice',
      number: 'ACH-ICS',
      contactId: supplier,
      date: '2026-06-26',
      lines: [{ unitPrice: 500, taxCode: 'BE-P-ICS-21', accountCode: '612400' }],
    });
    await db.query(`select post_document($1)`, [doc]);

    const boxes = (await ledgerOf(db, doc)).map((l) => l.box);
    expect(boxes).toEqual(['88', '59', '55', null]);
  });

  it('sends capital goods to box 83', async () => {
    const supplier = await newContact(db, fx.companyId, { name: 'Materiel', type: 'supplier' });
    const doc = await newDocument(db, fx.companyId, {
      docType: 'purchase_invoice',
      number: 'ACH-INV',
      contactId: supplier,
      date: '2026-06-27',
      lines: [{ unitPrice: 3000, taxCode: 'BE-P-21-I', accountCode: '241000' }],
    });
    await db.query(`select post_document($1)`, [doc]);
    expect((await ledgerOf(db, doc))[0]?.box).toBe('83');
  });
});

describe('post_document — refusals', () => {
  it('refuses a document with no line', async () => {
    const customer = await newContact(db, fx.companyId, { name: 'Vide' });
    const doc = await newDocument(db, fx.companyId, {
      docType: 'sale_invoice',
      number: 'FAC-EMPTY',
      contactId: customer,
      lines: [],
    });
    expect(await expectError(db, `select post_document($1)`, [doc])).toMatch(/document_empty/);
  });

  it('refuses to book a quote', async () => {
    const customer = await newContact(db, fx.companyId, { name: 'Devis' });
    const doc = await newDocument(db, fx.companyId, {
      docType: 'sale_quote',
      number: 'DEV-001',
      contactId: customer,
      lines: [{ unitPrice: 100, taxCode: 'BE-S-21', accountCode: '704000' }],
    });
    expect(await expectError(db, `select post_document($1)`, [doc])).toMatch(
      /document_not_accountable/,
    );
  });

  it('refuses to post the same document twice', async () => {
    const customer = await newContact(db, fx.companyId, { name: 'Doublon' });
    const doc = await newDocument(db, fx.companyId, {
      docType: 'sale_invoice',
      number: 'FAC-TWICE',
      contactId: customer,
      lines: [{ unitPrice: 100, taxCode: 'BE-S-21', accountCode: '704000' }],
    });
    await db.query(`select post_document($1)`, [doc]);
    expect(await expectError(db, `select post_document($1)`, [doc])).toMatch(
      /document_already_posted/,
    );
  });

  it('refuses a tax that is not in force on the accounting date', async () => {
    await db.query(
      `update taxes set valid_from = date '2027-01-01'
        where company_id = $1 and code = 'BE-S-12'`,
      [fx.companyId],
    );
    const customer = await newContact(db, fx.companyId, { name: 'Taux futur' });
    const doc = await newDocument(db, fx.companyId, {
      docType: 'sale_invoice',
      number: 'FAC-FUTURE',
      contactId: customer,
      date: '2026-06-01',
      lines: [{ unitPrice: 100, taxCode: 'BE-S-12', accountCode: '704000' }],
    });
    expect(await expectError(db, `select post_document($1)`, [doc])).toMatch(/tax_not_in_force/);
  });

  it('refuses a third-party account that cannot be matched', async () => {
    const message = await expectError(
      db,
      `insert into accounts (company_id, code, name, account_type, reconcilable)
       values ($1, '400999', 'Clients non lettrables', 'asset_receivable', false)`,
      [fx.companyId],
    );
    expect(message).toMatch(/accounts_third_party_reconcilable/);
  });

  it('numbers entries per journal and per year, on the pattern the pack declares', async () => {
    const shape = await numberShape(db, fx.companyId, 'SAL', '2026-06-15');
    const sales = await rows<{ number: string }>(
      db,
      `select e.number from entries e join journals j on j.id = e.journal_id
        where e.company_id = $1 and j.code = 'SAL' and e.number is not null
        order by e.number`,
      [fx.companyId],
    );
    expect(sales.length).toBeGreaterThan(1);
    for (const entry of sales) expect(entry.number).toMatch(shape);
    // The first one is the pattern with the counter at one — built from the
    // pack here, not typed out, so a pack that renumbers renumbers this too.
    expect(sales[0]?.number).toBe(await expectedNumber(db, fx.companyId, 'SAL', '2026-06-15', 1));
    expect(new Set(sales.map((n) => n.number)).size).toBe(sales.length);
  });
});
