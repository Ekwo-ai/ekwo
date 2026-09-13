import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compilePack, packsDir, readPack } from '../packages/cli/src/index.js';
import { asUser, expectError, freshDatabase, one, rows } from './helpers/db.js';
import {
  accountId,
  newCompany,
  newContact,
  newDocument,
  type Fixture,
} from './helpers/factory.js';

// Two things that only become true when a document is settled: a tax
// that falls due on collection, and an exchange difference that is realised.
// Every figure below is checked to the cent, because the point of the whole
// sub-task is that a French service business files a return that ties out.

let db: PGlite;
let fr: Fixture;

interface Line {
  code: string;
  debit: string;
  credit: string;
  box: string | null;
  box_amount: string | null;
  tax_line: boolean;
  entry_date: string;
}

/** Every ledger line of every entry of a document, the transfers included. */
async function ledger(documentId: string): Promise<Line[]> {
  return rows<Line>(
    db,
    `select a.code, l.debit, l.credit, l.declaration_box as box, l.box_amount, l.tax_line,
            e.entry_date::text as entry_date
       from entry_lines l
       join accounts a on a.id = l.account_id
       join entries e on e.id = l.entry_id
      where e.document_id = $1
      order by e.entry_date, e.number, l.sequence`,
    [documentId],
  );
}

/** The lines of the document's own entry, which is the one it points at. */
async function ownEntry(documentId: string): Promise<Line[]> {
  return rows<Line>(
    db,
    `select a.code, l.debit, l.credit, l.declaration_box as box, l.box_amount, l.tax_line,
            e.entry_date::text as entry_date
       from entry_lines l
       join accounts a on a.id = l.account_id
       join entries e on e.id = l.entry_id
       join documents d on d.entry_id = e.id
      where d.id = $1
      order by l.sequence`,
    [documentId],
  );
}

/** The third-party line of a document's own entry. */
async function thirdPartyLine(documentId: string): Promise<string> {
  const row = await one<{ id: string }>(
    db,
    `select l.id
       from entry_lines l
       join accounts a on a.id = l.account_id
       join documents d on d.entry_id = l.entry_id
      where d.id = $1 and a.reconcilable
        and a.account_type in ('asset_receivable', 'liability_payable')`,
    [documentId],
  );
  return row.id;
}

/**
 * A payment booked by `post_payment`, and the third-party line it produced.
 * That line is what a matching is made against.
 */
async function payment(options: {
  contactId: string;
  date: string;
  amount: number;
  direction?: 'inbound' | 'outbound';
  currency?: string;
  rate?: number;
}): Promise<string> {
  const pay = await one<{ id: string }>(
    db,
    `insert into payments (company_id, direction, payment_date, amount, currency_code,
                           exchange_rate, contact_id, journal_id)
     values ($1, $2, $3::date, $4, $5, $6, $7,
             (select id from journals where company_id = $1 and code = 'BNK'))
     returning id`,
    [
      fr.companyId,
      options.direction ?? 'inbound',
      options.date,
      options.amount,
      options.currency ?? 'EUR',
      options.rate ?? 1,
      options.contactId,
    ],
  );
  const entry = await one<{ id: string }>(db, `select post_payment($1) as e, id from payments where id = $1`, [pay.id]);
  void entry;
  const line = await one<{ id: string }>(
    db,
    `select l.id
       from entry_lines l
       join accounts a on a.id = l.account_id
       join payments p on p.entry_id = l.entry_id
      where p.id = $1 and a.reconcilable
        and a.account_type in ('asset_receivable', 'liability_payable')`,
    [pay.id],
  );
  return line.id;
}

async function vatBox(box: string, from: string, to: string): Promise<Record<string, string>> {
  const found = await rows<{ box: string; kind: string; amount: string }>(
    db,
    `select box, kind, amount::text from vat_return($1, $2::date, $3::date) where box = $4`,
    [fr.companyId, from, to, box],
  );
  return Object.fromEntries(found.map((r) => [r.kind, r.amount]));
}

beforeAll(async () => {
  db = await freshDatabase();
  fr = await newCompany(db, { country: 'FR', name: 'Prestataire SAS' });
}, 120_000);

afterAll(async () => {
  await db.close();
});

// ---------------------------------------------------------------------------
// A tax that falls due when the money arrives
// ---------------------------------------------------------------------------

describe('a service invoiced in France', () => {
  let documentId: string;
  let customer: string;

  beforeAll(async () => {
    customer = await newContact(db, fr.companyId, { name: 'Client Encaissement', country: 'FR' });
    documentId = await newDocument(db, fr.companyId, {
      docType: 'sale_invoice',
      number: 'FAC-ENC-1',
      contactId: customer,
      date: '2026-03-10',
      lines: [{ unitPrice: 1000, taxCode: 'FR-S-20-ENC', accountCode: '706000' }],
    });
    await db.query(`select post_document($1)`, [documentId]);
  });

  it('books the tax on the account it waits on, and names no box', async () => {
    expect(await ownEntry(documentId)).toEqual([
      // The base is earned, and it is not declared yet either: a cash-basis
      // return reports the base collected, so the two travel together.
      { code: '706000', debit: '0.00', credit: '1000.00', box: null, box_amount: '1000.00',
        tax_line: false, entry_date: '2026-03-10' },
      { code: '445870', debit: '0.00', credit: '200.00', box: null, box_amount: '200.00',
        tax_line: true, entry_date: '2026-03-10' },
      { code: '411000', debit: '1200.00', credit: '0.00', box: null, box_amount: null,
        tax_line: false, entry_date: '2026-03-10' },
    ]);
  });

  it('puts nothing on the declaration of the month it was invoiced in', async () => {
    expect(await vatBox('08', '2026-03-01', '2026-03-31')).toEqual({});
  });

  it('moves the settled share, and only that share, on a part payment', async () => {
    const line = await payment({ contactId: customer, date: '2026-04-20', amount: 480 });
    await db.query(`select reconcile($1, $2, null)`, [await thirdPartyLine(documentId), line]);

    const transfer = (await ledger(documentId)).filter((l) => l.entry_date === '2026-04-20');
    expect(transfer).toEqual([
      // 40 % of 1 000,00 on the base of box 08, with no ledger movement: the
      // revenue was earned in March and does not move.
      { code: '706000', debit: '0.00', credit: '0.00', box: '08', box_amount: '400.00',
        tax_line: false, entry_date: '2026-04-20' },
      // 40 % of 200,00 leaves the waiting account for the one it is due on.
      { code: '445710', debit: '0.00', credit: '80.00', box: '08', box_amount: '80.00',
        tax_line: true, entry_date: '2026-04-20' },
      { code: '445870', debit: '80.00', credit: '0.00', box: null, box_amount: null,
        tax_line: true, entry_date: '2026-04-20' },
    ]);
  });

  it('shows the box in the month of the payment, and not before', async () => {
    expect(await vatBox('08', '2026-03-01', '2026-03-31')).toEqual({});
    expect(await vatBox('08', '2026-04-01', '2026-04-30')).toEqual({ base: '400.00', tax: '80.00' });
  });

  it('carries the remainder on the last payment', async () => {
    const line = await payment({ contactId: customer, date: '2026-05-15', amount: 720 });
    await db.query(`select reconcile($1, $2, null)`, [await thirdPartyLine(documentId), line]);

    expect(await vatBox('08', '2026-05-01', '2026-05-31')).toEqual({ base: '600.00', tax: '120.00' });
    expect(await vatBox('08', '2026-01-01', '2026-12-31')).toEqual({ base: '1000.00', tax: '200.00' });

    const waiting = await one<{ balance: string }>(
      db,
      `select coalesce(sum(l.debit - l.credit), 0)::text as balance
         from entry_lines l where l.account_id = $1`,
      [await accountId(db, fr.companyId, '445870')],
    );
    expect(waiting.balance).toBe('0.00');
    const state = await one<{ payment_state: string }>(
      db, `select payment_state::text from documents where id = $1`, [documentId]);
    expect(state.payment_state).toBe('paid');
  });
});

describe('a tax of 200,00 settled in three equal parts', () => {
  it('adds up to the cent, because the share is cumulative and never a third of a third', async () => {
    const customer = await newContact(db, fr.companyId, { name: 'Client Tiers', country: 'FR' });
    const documentId = await newDocument(db, fr.companyId, {
      docType: 'sale_invoice',
      number: 'FAC-ENC-3',
      contactId: customer,
      date: '2026-06-01',
      lines: [{ unitPrice: 1000, taxCode: 'FR-S-20-ENC', accountCode: '706000' }],
    });
    await db.query(`select post_document($1)`, [documentId]);

    const moved: string[] = [];
    for (const [index, date] of ['2026-06-10', '2026-06-20', '2026-06-30'].entries()) {
      const line = await payment({ contactId: customer, date, amount: 400 });
      await db.query(`select reconcile($1, $2, null)`, [await thirdPartyLine(documentId), line]);
      const row = await one<{ amount: string }>(
        db,
        `select coalesce(sum(l.box_amount), 0)::text as amount
           from entry_lines l join entries e on e.id = l.entry_id
          where e.document_id = $1 and e.entry_date = $2::date and l.tax_line`,
        [documentId, date],
      );
      expect(row.amount, `payment ${index + 1}`).toBe(['66.67', '66.66', '66.67'][index]);
      moved.push(row.amount);
    }
    expect(moved.reduce((sum, a) => sum + Number(a), 0)).toBeCloseTo(200, 2);
  });
});

describe('a customer who pays more than the invoice', () => {
  it('makes the whole tax due and no more', async () => {
    const customer = await newContact(db, fr.companyId, { name: 'Client Généreux', country: 'FR' });
    const documentId = await newDocument(db, fr.companyId, {
      docType: 'sale_invoice',
      number: 'FAC-ENC-2',
      contactId: customer,
      date: '2026-05-02',
      lines: [{ unitPrice: 200, taxCode: 'FR-S-20-ENC', accountCode: '706000' }],
    });
    await db.query(`select post_document($1)`, [documentId]);

    // 300,00 against an invoice of 240,00: the matching takes what the
    // receivable is worth and the rest stays open on the payment.
    const line = await payment({ contactId: customer, date: '2026-05-20', amount: 300 });
    await db.query(`select reconcile($1, $2, null)`, [await thirdPartyLine(documentId), line]);

    expect(await vatBox('08', '2026-05-20', '2026-05-20')).toEqual({ base: '200.00', tax: '40.00' });
    const open = await one<{ open: string }>(
      db,
      `select (abs(l.debit - l.credit) - l.matched_amount)::text as open
         from entry_lines l where l.id = $1`,
      [line],
    );
    expect(open.open).toBe('60.00');
  });
});

describe('a service bought in France', () => {
  it('waits for the payment before the tax is deductible', async () => {
    const supplier = await newContact(db, fr.companyId, {
      name: 'Sous-traitant', type: 'supplier', country: 'FR',
    });
    const documentId = await newDocument(db, fr.companyId, {
      docType: 'purchase_invoice',
      number: 'ACH-ENC-1',
      contactId: supplier,
      date: '2026-07-05',
      lines: [{ unitPrice: 500, taxCode: 'FR-P-20-ENC', accountCode: '611000' }],
    });
    await db.query(`select post_document($1)`, [documentId]);

    expect(await ownEntry(documentId)).toEqual([
      { code: '611000', debit: '500.00', credit: '0.00', box: null, box_amount: null,
        tax_line: false, entry_date: '2026-07-05' },
      { code: '445860', debit: '100.00', credit: '0.00', box: null, box_amount: '100.00',
        tax_line: true, entry_date: '2026-07-05' },
      { code: '401000', debit: '0.00', credit: '600.00', box: null, box_amount: null,
        tax_line: false, entry_date: '2026-07-05' },
    ]);
    expect(await vatBox('20', '2026-07-01', '2026-07-31')).toEqual({});

    const line = await payment({
      contactId: supplier, date: '2026-08-12', amount: 600, direction: 'outbound',
    });
    await db.query(`select reconcile($1, $2, null)`, [await thirdPartyLine(documentId), line]);

    const transfer = (await ledger(documentId)).filter((l) => l.entry_date === '2026-08-12');
    expect(transfer).toEqual([
      { code: '445660', debit: '100.00', credit: '0.00', box: '20', box_amount: '100.00',
        tax_line: true, entry_date: '2026-08-12' },
      { code: '445860', debit: '0.00', credit: '100.00', box: null, box_amount: null,
        tax_line: true, entry_date: '2026-08-12' },
    ]);
    expect(await vatBox('20', '2026-08-01', '2026-08-31')).toEqual({ tax: '100.00' });
  });
});

describe('a credit note that settles an invoice', () => {
  it('makes both fall due at once, and the two boxes net out', async () => {
    const customer = await newContact(db, fr.companyId, { name: 'Client Avoir', country: 'FR' });
    const invoice = await newDocument(db, fr.companyId, {
      docType: 'sale_invoice',
      number: 'FAC-ENC-4',
      contactId: customer,
      date: '2026-09-01',
      lines: [{ unitPrice: 300, taxCode: 'FR-S-20-ENC', accountCode: '706000' }],
    });
    await db.query(`select post_document($1)`, [invoice]);
    const note = await newDocument(db, fr.companyId, {
      docType: 'sale_credit_note',
      number: 'AV-ENC-1',
      contactId: customer,
      date: '2026-09-02',
      lines: [{ unitPrice: 300, taxCode: 'FR-S-20-ENC', accountCode: '706000' }],
    });
    await db.query(`select post_document($1)`, [note]);

    await db.query(`select reconcile($1, $2, null)`, [
      await thirdPartyLine(invoice),
      await thirdPartyLine(note),
    ]);

    // The invoice reports its base and its tax, the credit note the same
    // figures with the sign the form expects, and September comes to nil.
    expect(await vatBox('08', '2026-09-01', '2026-09-30')).toEqual({});
    for (const code of ['445870', '445710']) {
      const row = await one<{ balance: string }>(
        db,
        `select coalesce(sum(l.debit - l.credit), 0)::text as balance
           from entry_lines l join entries e on e.id = l.entry_id
          where e.document_id in ($1, $2) and l.account_id = $3`,
        [invoice, note, await accountId(db, fr.companyId, code)],
      );
      expect(row.balance, code).toBe('0.00');
    }
  });
});

describe('undoing a matching', () => {
  it('takes the tax back out of the declaration', async () => {
    const customer = await newContact(db, fr.companyId, { name: 'Client Dénoué', country: 'FR' });
    const documentId = await newDocument(db, fr.companyId, {
      docType: 'sale_invoice',
      number: 'FAC-ENC-5',
      contactId: customer,
      date: '2026-10-01',
      lines: [{ unitPrice: 100, taxCode: 'FR-S-20-ENC', accountCode: '706000' }],
    });
    await db.query(`select post_document($1)`, [documentId]);
    const line = await payment({ contactId: customer, date: '2026-10-15', amount: 120 });
    const match = await one<{ id: string; tax_transfer_entry_id: string | null }>(
      db, `select * from reconcile($1, $2, null)`, [await thirdPartyLine(documentId), line]);

    expect(match.tax_transfer_entry_id).not.toBeNull();
    expect(await vatBox('08', '2026-10-01', '2026-10-31')).toEqual({ base: '100.00', tax: '20.00' });

    await db.query(`select unreconcile($1)`, [match.id]);

    expect(await vatBox('08', '2026-10-01', '2026-10-31')).toEqual({});
    const waiting = await one<{ balance: string }>(
      db,
      `select coalesce(sum(l.debit - l.credit), 0)::text as balance
         from entry_lines l join entries e on e.id = l.entry_id
        where e.document_id = $1 and l.account_id = $2`,
      [documentId, await accountId(db, fr.companyId, '445870')],
    );
    expect(waiting.balance).toBe('-20.00');
  });
});

describe('a tax that falls due when it is invoiced', () => {
  it('is booked and declared exactly as it was before this change', async () => {
    const customer = await newContact(db, fr.companyId, { name: 'Client Débits', country: 'FR' });
    const documentId = await newDocument(db, fr.companyId, {
      docType: 'sale_invoice',
      number: 'FAC-DEB-1',
      contactId: customer,
      date: '2026-11-03',
      lines: [{ unitPrice: 1000, taxCode: 'FR-S-20', accountCode: '706000' }],
    });
    await db.query(`select post_document($1)`, [documentId]);

    expect(await ownEntry(documentId)).toEqual([
      { code: '706000', debit: '0.00', credit: '1000.00', box: '08', box_amount: '1000.00',
        tax_line: false, entry_date: '2026-11-03' },
      { code: '445710', debit: '0.00', credit: '200.00', box: '08', box_amount: '200.00',
        tax_line: true, entry_date: '2026-11-03' },
      { code: '411000', debit: '1200.00', credit: '0.00', box: null, box_amount: null,
        tax_line: false, entry_date: '2026-11-03' },
    ]);
    expect(await vatBox('08', '2026-11-01', '2026-11-30')).toEqual({ base: '1000.00', tax: '200.00' });

    // And a payment books nothing at all: there is nothing waiting.
    const line = await payment({ contactId: customer, date: '2026-11-20', amount: 1200 });
    const match = await one<{ tax_transfer_entry_id: string | null }>(
      db, `select * from reconcile($1, $2, null)`, [await thirdPartyLine(documentId), line]);
    expect(match.tax_transfer_entry_id).toBeNull();
    expect((await ledger(documentId)).map((l) => l.entry_date)).toEqual([
      '2026-11-03', '2026-11-03', '2026-11-03',
    ]);
  });
});

describe('a tax that waits and has nowhere to wait', () => {
  it('is refused at posting, by name', async () => {
    const customer = await newContact(db, fr.companyId, { name: 'Client Sans Compte', country: 'FR' });
    await db.query(
      `update taxes set cash_basis_transition_account_id = null
        where company_id = $1 and code = 'FR-S-10-ENC'`,
      [fr.companyId],
    );
    const documentId = await newDocument(db, fr.companyId, {
      docType: 'sale_invoice',
      number: 'FAC-ENC-KO',
      contactId: customer,
      date: '2026-12-01',
      lines: [{ unitPrice: 100, taxCode: 'FR-S-10-ENC', accountCode: '706000' }],
    });
    const message = await expectError(db, `select post_document($1)`, [documentId]);
    expect(message).toMatch(/no_cash_basis_account/);

    await db.query(
      `update taxes set cash_basis_transition_account_id = account_id_by_code($1, '445870')
        where company_id = $1 and code = 'FR-S-10-ENC'`,
      [fr.companyId],
    );
  });

  // The audit of 13 September 2026. `settle_cash_basis_tax()` only ever moves
  // a line carrying a box amount, and `post_document` writes one only when the
  // posting names a box — so a cash-basis tax with no box booked its amount
  // onto the transition account and it stayed there for ever: settled by
  // nothing, declared by nothing, and with nothing raised anywhere.
  it('is refused at posting when its posting names no box, instead of waiting for ever', async () => {
    const customer = await newContact(db, fr.companyId, { name: 'Client Sans Case', country: 'FR' });
    await db.query(
      `update tax_postings set declaration_box = null
        where tax_id = (select id from taxes where company_id = $1 and code = 'FR-S-10-ENC')
          and posting_type = 'tax' and document_kind = 'invoice'`,
      [fr.companyId],
    );
    const documentId = await newDocument(db, fr.companyId, {
      docType: 'sale_invoice',
      number: 'FAC-ENC-SANS-CASE',
      contactId: customer,
      date: '2026-12-02',
      lines: [{ unitPrice: 100, taxCode: 'FR-S-10-ENC', accountCode: '706000' }],
    });
    const message = await expectError(db, `select post_document($1)`, [documentId]);
    expect(message).toMatch(/no_cash_basis_box/);

    // Nothing was written: the refusal is before the entry, not after it.
    expect(await ledger(documentId)).toEqual([]);

    await db.query(
      `update tax_postings set declaration_box = (
         select declaration_box from tax_posting_templates tpt
          join tax_templates tt on tt.id = tpt.tax_template_id
         where tt.code = 'FR-S-10-ENC' and tpt.posting_type = 'tax'
           and tpt.document_kind = 'invoice' limit 1)
        where tax_id = (select id from taxes where company_id = $1 and code = 'FR-S-10-ENC')
          and posting_type = 'tax' and document_kind = 'invoice'`,
      [fr.companyId],
    );
  });
});


// ---------------------------------------------------------------------------
// The difference a rate makes, realised when the money arrives
// ---------------------------------------------------------------------------

/** A document in a foreign currency, at the rate it was billed at. */
async function foreignInvoice(options: {
  number: string;
  contactId: string;
  date: string;
  amount: number;
  rate: number;
  docType?: 'sale_invoice' | 'purchase_invoice';
  accountCode?: string;
}): Promise<string> {
  const documentId = await newDocument(db, fr.companyId, {
    docType: options.docType ?? 'sale_invoice',
    number: options.number,
    contactId: options.contactId,
    date: options.date,
    lines: [
      {
        unitPrice: options.amount,
        taxCode: options.docType === 'purchase_invoice' ? 'FR-P-00' : 'FR-S-EXP',
        accountCode: options.accountCode ?? '706000',
      },
    ],
  });
  await db.query(
    `update documents set currency_code = 'USD', exchange_rate = $2 where id = $1`,
    [documentId, options.rate],
  );
  await db.query(`select post_document($1)`, [documentId]);
  return documentId;
}

async function balanceOf(code: string): Promise<string> {
  const row = await one<{ balance: string }>(
    db,
    `select coalesce(sum(l.debit - l.credit), 0)::text as balance
       from entry_lines l join entries e on e.id = l.entry_id
      where l.company_id = $1 and l.account_id = account_id_by_code($1, $2) and e.state = 'posted'`,
    [fr.companyId, code],
  );
  return row.balance;
}

describe('a document in a currency that is not the company’s', () => {
  it('books the company’s currency in the ledger and the document’s beside it', async () => {
    const customer = await newContact(db, fr.companyId, { name: 'Export Gain', country: 'US' });
    const documentId = await foreignInvoice({
      number: 'FAC-USD-1', contactId: customer, date: '2026-02-02', amount: 1000, rate: 1.1,
    });

    const lines = await rows<{ code: string; debit: string; credit: string; currency: string; amount_currency: string }>(
      db,
      `select a.code, l.debit, l.credit, l.currency_code as currency, l.amount_currency
         from entry_lines l join accounts a on a.id = l.account_id
         join documents d on d.entry_id = l.entry_id
        where d.id = $1 order by l.sequence`,
      [documentId],
    );
    expect(lines).toEqual([
      { code: '706000', debit: '0.00', credit: '909.09', currency: 'USD', amount_currency: '1000.00' },
      { code: '411000', debit: '909.09', credit: '0.00', currency: 'USD', amount_currency: '1000.00' },
    ]);
  });
});

describe('a receivable collected at a better rate', () => {
  it('books the gain and clears the account to nil', async () => {
    const customer = await newContact(db, fr.companyId, { name: 'Client Gain', country: 'US' });
    const documentId = await foreignInvoice({
      number: 'FAC-USD-2', contactId: customer, date: '2026-02-10', amount: 1000, rate: 1.1,
    });
    const before = await balanceOf('766000');

    const line = await payment({
      contactId: customer, date: '2026-03-05', amount: 1000, currency: 'USD', rate: 1.05,
    });
    const match = await one<{ id: string; amount: string; fx_entry_id: string | null }>(
      db, `select * from reconcile($1, $2, null)`, [await thirdPartyLine(documentId), line]);

    // 1 000,00 USD booked at 909,09 € and collected at 952,38 €.
    expect(match.amount).toBe('909.09');
    expect(match.fx_entry_id).not.toBeNull();
    expect(Number(await balanceOf('766000')) - Number(before)).toBeCloseTo(-43.29, 2);

    const open = await rows<{ open: string }>(
      db,
      `select (abs(l.debit - l.credit) - l.matched_amount)::text as open
         from entry_lines l where l.id in ($1, $2)`,
      [await thirdPartyLine(documentId), line],
    );
    expect(open.map((o) => o.open)).toEqual(['0.00', '0.00']);
  });
});

describe('a receivable collected at a worse rate', () => {
  it('books the loss on the account the pack names', async () => {
    const customer = await newContact(db, fr.companyId, { name: 'Client Perte', country: 'US' });
    const documentId = await foreignInvoice({
      number: 'FAC-USD-3', contactId: customer, date: '2026-02-11', amount: 1000, rate: 1.1,
    });
    const before = await balanceOf('666000');

    const line = await payment({
      contactId: customer, date: '2026-03-06', amount: 1000, currency: 'USD', rate: 1.2,
    });
    await db.query(`select reconcile($1, $2, null)`, [await thirdPartyLine(documentId), line]);

    // 909,09 € expected, 833,33 € received.
    expect(Number(await balanceOf('666000')) - Number(before)).toBeCloseTo(75.76, 2);
    const open = await one<{ open: string }>(
      db,
      `select (abs(l.debit - l.credit) - l.matched_amount)::text as open
         from entry_lines l where l.id = $1`,
      [await thirdPartyLine(documentId)],
    );
    expect(open.open).toBe('0.00');
  });
});

describe('a payment at the rate the invoice was billed at', () => {
  it('books nothing, because nothing was realised', async () => {
    const customer = await newContact(db, fr.companyId, { name: 'Client Stable', country: 'US' });
    const documentId = await foreignInvoice({
      number: 'FAC-USD-4', contactId: customer, date: '2026-02-12', amount: 1000, rate: 1.1,
    });
    const gain = await balanceOf('766000');
    const loss = await balanceOf('666000');

    const line = await payment({
      contactId: customer, date: '2026-03-07', amount: 1000, currency: 'USD', rate: 1.1,
    });
    const match = await one<{ fx_entry_id: string | null }>(
      db, `select * from reconcile($1, $2, null)`, [await thirdPartyLine(documentId), line]);

    expect(match.fx_entry_id).toBeNull();
    expect(await balanceOf('766000')).toBe(gain);
    expect(await balanceOf('666000')).toBe(loss);
  });
});

describe('a country model that names no exchange account', () => {
  it('refuses only when a difference actually arises', async () => {
    const customer = await newContact(db, fr.companyId, { name: 'Client Sans Change', country: 'US' });
    const quiet = await foreignInvoice({
      number: 'FAC-USD-5', contactId: customer, date: '2026-02-13', amount: 1000, rate: 1.1,
    });
    const noisy = await foreignInvoice({
      number: 'FAC-USD-6', contactId: customer, date: '2026-02-14', amount: 1000, rate: 1.1,
    });

    const saved = await one<{ gain: string | null; loss: string | null }>(
      db,
      `select fx_gain_code as gain, fx_loss_code as loss from country_defaults
        where country = (select country from companies where id = $1)`,
      [fr.companyId],
    );
    await db.query(
      `update country_defaults set fx_gain_code = null, fx_loss_code = null
        where country = (select country from companies where id = $1)`,
      [fr.companyId],
    );

    // Same rate: nothing is realised, so nothing is missing.
    const same = await payment({
      contactId: customer, date: '2026-03-08', amount: 1000, currency: 'USD', rate: 1.1,
    });
    await db.query(`select reconcile($1, $2, null)`, [await thirdPartyLine(quiet), same]);

    const other = await payment({
      contactId: customer, date: '2026-03-09', amount: 1000, currency: 'USD', rate: 1.05,
    });
    const message = await expectError(db, `select reconcile($1, $2, null)`, [
      await thirdPartyLine(noisy), other,
    ]);
    expect(message).toMatch(/no_fx_accounts/);

    await db.query(
      `update country_defaults set fx_gain_code = $1, fx_loss_code = $2
        where country = (select country from companies where id = $3)`,
      [saved.gain, saved.loss, fr.companyId],
    );
  });
});

describe('undoing a matching that realised a difference', () => {
  it('takes the difference off the ledger and re-opens the receivable', async () => {
    const customer = await newContact(db, fr.companyId, { name: 'Client Annulé', country: 'US' });
    const documentId = await foreignInvoice({
      number: 'FAC-USD-7', contactId: customer, date: '2026-02-15', amount: 1000, rate: 1.1,
    });
    const before = await balanceOf('766000');

    const line = await payment({
      contactId: customer, date: '2026-03-10', amount: 1000, currency: 'USD', rate: 1.05,
    });
    const match = await one<{ id: string }>(
      db, `select * from reconcile($1, $2, null)`, [await thirdPartyLine(documentId), line]);

    await db.query(`select unreconcile($1)`, [match.id]);

    expect(await balanceOf('766000')).toBe(before);
    const open = await one<{ open: string }>(
      db,
      `select (abs(l.debit - l.credit) - l.matched_amount)::text as open
         from entry_lines l where l.id = $1`,
      [await thirdPartyLine(documentId)],
    );
    expect(open.open).toBe('909.09');
  });
});

// ---------------------------------------------------------------------------
// What the packs gained, and what `ekwo pack check` now refuses
// ---------------------------------------------------------------------------

describe('the packs', () => {
  it('name the accounts an exchange difference lands on, in every country they carry', async () => {
    const defaults = await rows<{ country: string; fx_gain_code: string; fx_loss_code: string }>(
      db,
      `select country, fx_gain_code, fx_loss_code from country_defaults order by country`,
    );
    expect(defaults).toEqual([
      { country: 'BE', fx_gain_code: '754000', fx_loss_code: '654000' },
      { country: 'FR', fx_gain_code: '766000', fx_loss_code: '666000' },
    ]);
  });

  it('put the French services on collection and leave the goods on the debits', async () => {
    const cash = await rows<{ country: string; code: string; account: string }>(
      db,
      `select country, code, cash_basis_transition_account_code as account
         from tax_templates where cash_basis order by country, code`,
    );
    expect(cash).toEqual([
      { country: 'FR', code: 'FR-P-055-ENC', account: '445860' },
      { country: 'FR', code: 'FR-P-10-ENC', account: '445860' },
      { country: 'FR', code: 'FR-P-20-ENC', account: '445860' },
      { country: 'FR', code: 'FR-S-055-ENC', account: '445870' },
      { country: 'FR', code: 'FR-S-10-ENC', account: '445870' },
      { country: 'FR', code: 'FR-S-20-ENC', account: '445870' },
    ]);
  });

  it('make the column the document rules expose on a document line say something true', async () => {
    // `document_line_items.tax_cash_basis` reads `taxes.cash_basis`, which
    // until this change nothing ever set. It answers now.
    const seen = await rows<{ tax_cash_basis: boolean }>(
      db,
      `select distinct i.tax_cash_basis
         from document_line_items i
         join documents d on d.id = i.document_id
        where d.company_id = $1 and i.tax_cash_basis
        limit 1`,
      [fr.companyId],
    );
    expect(seen).toEqual([{ tax_cash_basis: true }]);
  });

  it('cite the article that makes a service fall due on collection', async () => {
    const row = await one<{ legal_reference: string }>(
      db,
      `select legal_reference from tax_templates where country = 'FR' and code = 'FR-S-20-ENC'`,
    );
    expect(row.legal_reference).toMatch(/269-2-c/);
  });
});

describe('what `ekwo pack check` refuses about a tax that waits', () => {
  /** `packs/fr` in a temporary directory, with `taxes.json` edited. */
  async function packWith(edit: (taxes: Record<string, unknown>[]) => void): Promise<void> {
    const dir = await mkdtemp(join(tmpdir(), 'ekwo-cash-'));
    await cp(join(packsDir(), 'schema'), join(dir, 'schema'), { recursive: true });
    await cp(join(packsDir(), 'fr'), join(dir, 'fr'), { recursive: true });
    const taxes = JSON.parse(await readFile(join(packsDir(), 'fr', 'taxes.json'), 'utf8')) as Record<
      string,
      unknown
    >[];
    edit(taxes);
    await writeFile(join(dir, 'fr', 'taxes.json'), JSON.stringify(taxes), 'utf8');
    await readPack('fr', dir);
  }

  it('accepts the packs of this repository as they are', async () => {
    // `readPack` runs the rules and throws on the first issue, so reading
    // both packs is the assertion. What is read back is what cash-basis VAT added.
    for (const slug of ['be', 'fr']) {
      const pack = await readPack(slug, packsDir());
      expect(pack.manifest.defaults.roles['fx_gain'], slug).toMatch(/^\d+$/);
      expect(pack.manifest.defaults.roles['fx_loss'], slug).toMatch(/^\d+$/);
    }
    const fr = await readPack('fr', packsDir());
    expect(fr.taxes.filter((t) => t.cash_basis)).toHaveLength(6);
  });

  it('refuses one that names no account to wait on', async () => {
    await expect(
      packWith((taxes) => {
        for (const tax of taxes) {
          if (tax['code'] === 'FR-S-20-ENC') tax['cash_basis_transition_account'] = null;
        }
      }),
    ).rejects.toThrow(/has to name the account it waits on/);
  });

  it('refuses one whose tax is split over two postings', async () => {
    await expect(
      packWith((taxes) => {
        for (const tax of taxes) {
          if (tax['code'] !== 'FR-S-20-ENC') continue;
          const postings = (tax['postings'] as Record<string, unknown[]>)['invoice']!;
          postings.push({ ...(postings[1] as Record<string, unknown>), sequence: 30 });
        }
      }),
    ).rejects.toThrow(/takes one tax posting/);
  });

  it('refuses one that also carries a share nobody gets back', async () => {
    await expect(
      packWith((taxes) => {
        for (const tax of taxes) {
          if (tax['code'] !== 'FR-S-20-ENC') continue;
          const postings = (tax['postings'] as Record<string, unknown[]>)['invoice']!;
          postings.push({ type: 'tax_on_base', factor: 20, sequence: 40 });
        }
      }),
    ).rejects.toThrow(/a cost is not deferred to a payment/);
  });

  // The audit of 13 September 2026. A tax that waits also needs a box to fall
  // due *into*: `settle_cash_basis_tax()` only ever moves a line carrying a
  // box amount, so without one the amount sits on the transition account for
  // ever, settled by nothing and declared by nothing.
  it('refuses one whose posting names no box to fall due into', async () => {
    await expect(
      packWith((taxes) => {
        for (const tax of taxes) {
          if (tax['code'] !== 'FR-S-20-ENC') continue;
          const postings = (tax['postings'] as Record<string, Record<string, unknown>[]>)['invoice']!;
          for (const posting of postings) {
            if (posting['type'] === 'tax') delete posting['box'];
          }
        }
      }),
    ).rejects.toThrow(/name the box it falls due into/);
  });
});

describe('the migration of this change', () => {
  it('compiles the exchange accounts a pack names, and nothing when it names none', async () => {
    // The country model's own statement, not the whole seed: an account code
    // appears in the chart too, so "does 666000 occur" is not the question.
    const countryDefaults = (sql: string): string => {
      const at = sql.indexOf('insert into country_defaults');
      return sql.slice(at, sql.indexOf('on conflict (country)', at));
    };

    const pack = await readPack('fr', packsDir());
    expect(countryDefaults(compilePack(pack))).toContain("'766000', '666000'");

    const roles = { ...pack.manifest.defaults.roles };
    delete (roles as Record<string, unknown>)['fx_gain'];
    delete (roles as Record<string, unknown>)['fx_loss'];
    const sql = compilePack({
      ...pack,
      manifest: { ...pack.manifest, defaults: { ...pack.manifest.defaults, roles } },
    });
    expect(countryDefaults(sql)).not.toContain("'766000'");
    expect(countryDefaults(sql)).not.toContain("'666000'");
  });

  it('is closed to the anonymous role', async () => {
    const anon = await rows<{ proname: string }>(
      db,
      `select p.proname from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('settle_cash_basis_tax', 'reconcile', 'unreconcile', 'post_document', 'post_payment')
          and has_function_privilege('anon', p.oid, 'execute')`,
    );
    expect(anon).toEqual([]);
  });

  it('lets a signed-in member settle a document as themselves', async () => {
    const customer = await newContact(db, fr.companyId, { name: 'Client RLS', country: 'FR' });
    const documentId = await newDocument(db, fr.companyId, {
      docType: 'sale_invoice',
      number: 'FAC-ENC-RLS',
      contactId: customer,
      date: '2026-04-02',
      lines: [{ unitPrice: 250, taxCode: 'FR-S-20-ENC', accountCode: '706000' }],
    });
    await db.query(`select post_document($1)`, [documentId]);
    const line = await payment({ contactId: customer, date: '2026-04-03', amount: 300 });

    await asUser(db, fr.ownerId, async () => {
      const match = await one<{ tax_transfer_entry_id: string | null }>(
        db, `select * from reconcile($1, $2, null)`, [await thirdPartyLine(documentId), line]);
      expect(match.tax_transfer_entry_id).not.toBeNull();
    });
    expect(await vatBox('08', '2026-04-03', '2026-04-03')).toEqual({ base: '250.00', tax: '50.00' });
  });
});
