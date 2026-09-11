import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectError, freshDatabase, one, rows } from './helpers/db.js';
import { newCompany, newContact, newDocument, type Fixture } from './helpers/factory.js';

let db: PGlite;
let fx: Fixture;

/** Books a 1 210,00 invoice and returns its receivable line. */
async function invoiceWithReceivable(
  date: string,
  amount = 1000,
): Promise<{ documentId: string; receivableLineId: string }> {
  const customer = await newContact(db, fx.companyId, { name: `Client ${date}` });
  const documentId = await newDocument(db, fx.companyId, {
    docType: 'sale_invoice',
    number: `FAC-${date}`,
    contactId: customer,
    date,
    lines: [{ unitPrice: amount, taxCode: 'BE-S-21', accountCode: '704000' }],
  });
  await db.query(`select post_document($1)`, [documentId]);
  const line = await one<{ id: string }>(
    db,
    `select l.id from entry_lines l
       join entries e on e.id = l.entry_id
       join accounts a on a.id = l.account_id
      where e.document_id = $1 and a.code = '400000'`,
    [documentId],
  );
  return { documentId, receivableLineId: line.id };
}

/** A bank entry crediting the customer account, returning that credit line. */
async function bankReceipt(date: string, amount: number, contactId?: string): Promise<string> {
  const entry = await one<{ id: string }>(
    db,
    `insert into entries (company_id, journal_id, entry_date, description, state)
     select $1, id, $2::date, 'Encaissement', 'draft' from journals
      where company_id = $1 and code = 'BNK' returning id`,
    [fx.companyId, date],
  );
  await db.query(
    `insert into entry_lines (entry_id, company_id, account_id, sequence, name, debit, credit)
     values ($1, $2, account_id_by_code($2, '550000'), 10, 'Banque', $3, 0)`,
    [entry.id, fx.companyId, amount],
  );
  const credit = await one<{ id: string }>(
    db,
    `insert into entry_lines (entry_id, company_id, account_id, sequence, name, debit, credit, contact_id)
     values ($1, $2, account_id_by_code($2, '400000'), 20, 'Encaissement', 0, $3, $4)
     returning id`,
    [entry.id, fx.companyId, amount, contactId ?? null],
  );
  await db.query(`select post_entry($1)`, [entry.id]);
  return credit.id;
}

beforeAll(async () => {
  db = await freshDatabase();
  fx = await newCompany(db, { country: 'BE' });
});

afterAll(async () => {
  await db.close();
});

describe('reconcile', () => {
  it('matches a partial payment, then the balance, under one letter', async () => {
    const { receivableLineId } = await invoiceWithReceivable('2026-03-02');
    const first = await bankReceipt('2026-03-20', 400);
    const second = await bankReceipt('2026-04-05', 810);

    await db.query(`select reconcile($1, $2, 400)`, [receivableLineId, first]);

    let line = await one<{ matched_amount: string; matching_number: string }>(
      db,
      `select matched_amount, matching_number from entry_lines where id = $1`,
      [receivableLineId],
    );
    expect(line.matched_amount).toBe('400.00');
    expect(line.matching_number).toMatch(/^A\d{4}$/);
    const letter = line.matching_number;

    // No amount given: the smaller of the two open amounts, here 810.
    await db.query(`select reconcile($1, $2, null)`, [receivableLineId, second]);

    line = await one(db, `select matched_amount, matching_number from entry_lines where id = $1`, [
      receivableLineId,
    ]);
    expect(line.matched_amount).toBe('1210.00');
    expect(line.matching_number).toBe(letter);

    const pairs = await rows<{ amount: string }>(
      db,
      `select amount from reconciliations where debit_line_id = $1 order by amount`,
      [receivableLineId],
    );
    expect(pairs.map((p) => p.amount)).toEqual(['400.00', '810.00']);
  });

  it('refuses to match beyond the open amount', async () => {
    const { receivableLineId } = await invoiceWithReceivable('2026-03-03');
    const receipt = await bankReceipt('2026-03-21', 5000);
    const message = await expectError(db, `select reconcile($1, $2, 2000)`, [
      receivableLineId,
      receipt,
    ]);
    expect(message).toMatch(/reconcile_over_debit/);
  });

  it('refuses two lines on the same side', async () => {
    const a = await invoiceWithReceivable('2026-03-04');
    const b = await invoiceWithReceivable('2026-03-05');
    const message = await expectError(db, `select reconcile($1, $2, 100)`, [
      a.receivableLineId,
      b.receivableLineId,
    ]);
    expect(message).toMatch(/reconcile_same_side/);
  });

  it('refuses an account that is not reconcilable', async () => {
    const entry = await one<{ id: string }>(
      db,
      `insert into entries (company_id, journal_id, entry_date, description, state)
       select $1, id, date '2026-03-06', 'OD', 'draft' from journals
        where company_id = $1 and code = 'MISC' returning id`,
      [fx.companyId],
    );
    const debit = await one<{ id: string }>(
      db,
      `insert into entry_lines (entry_id, company_id, account_id, sequence, debit, credit)
       values ($1, $2, account_id_by_code($2, '613000'), 10, 100, 0) returning id`,
      [entry.id, fx.companyId],
    );
    const credit = await one<{ id: string }>(
      db,
      `insert into entry_lines (entry_id, company_id, account_id, sequence, debit, credit)
       values ($1, $2, account_id_by_code($2, '613000'), 20, 0, 100) returning id`,
      [entry.id, fx.companyId],
    );
    const message = await expectError(db, `select reconcile($1, $2, 100)`, [debit.id, credit.id]);
    expect(message).toMatch(/account_not_reconcilable/);
  });

  it('moves the document it settles, without anyone writing amount_paid', async () => {
    const { documentId, receivableLineId } = await invoiceWithReceivable('2026-04-02');

    let doc = await one<{ amount_paid: string; amount_residual: string; payment_state: string }>(
      db,
      `select amount_paid, amount_residual, payment_state from documents where id = $1`,
      [documentId],
    );
    expect(doc.amount_paid).toBe('0.00');
    expect(doc.payment_state).toBe('not_paid');

    const part = await bankReceipt('2026-04-10', 500);
    await db.query(`select reconcile($1, $2, 500)`, [receivableLineId, part]);

    doc = await one(
      db,
      `select amount_paid, amount_residual, payment_state from documents where id = $1`,
      [documentId],
    );
    expect(doc.amount_paid).toBe('500.00');
    expect(doc.amount_residual).toBe('710.00');
    expect(doc.payment_state).toBe('partially_paid');

    const rest = await bankReceipt('2026-04-20', 710);
    await db.query(`select reconcile($1, $2, null)`, [receivableLineId, rest]);

    doc = await one(
      db,
      `select amount_paid, amount_residual, payment_state from documents where id = $1`,
      [documentId],
    );
    expect(doc.amount_paid).toBe('1210.00');
    expect(doc.amount_residual).toBe('0.00');
    expect(doc.payment_state).toBe('paid');
  });

  it('settles a purchase invoice the same way, on the payable side', async () => {
    const supplier = await newContact(db, fx.companyId, {
      name: 'Fournisseur a payer',
      type: 'supplier',
    });
    const documentId = await newDocument(db, fx.companyId, {
      docType: 'purchase_invoice',
      number: 'ACH-SETTLE',
      contactId: supplier,
      date: '2026-04-04',
      lines: [{ unitPrice: 1000, taxCode: 'BE-P-21-S', accountCode: '613000' }],
    });
    await db.query(`select post_document($1)`, [documentId]);

    const payable = await one<{ id: string }>(
      db,
      `select l.id from entry_lines l
         join entries e on e.id = l.entry_id
         join accounts a on a.id = l.account_id
        where e.document_id = $1 and a.code = '440000'`,
      [documentId],
    );

    // A bank payment: debit the supplier, credit the bank.
    const entry = await one<{ id: string }>(
      db,
      `insert into entries (company_id, journal_id, entry_date, description, state)
       select $1, id, date '2026-04-12', 'Paiement fournisseur', 'draft' from journals
        where company_id = $1 and code = 'BNK' returning id`,
      [fx.companyId],
    );
    const debit = await one<{ id: string }>(
      db,
      `insert into entry_lines (entry_id, company_id, account_id, sequence, debit, credit, contact_id)
       values ($1, $2, account_id_by_code($2, '440000'), 10, 1210, 0, $3) returning id`,
      [entry.id, fx.companyId, supplier],
    );
    await db.query(
      `insert into entry_lines (entry_id, company_id, account_id, sequence, debit, credit)
       values ($1, $2, account_id_by_code($2, '550000'), 20, 0, 1210)`,
      [entry.id, fx.companyId],
    );
    await db.query(`select post_entry($1)`, [entry.id]);

    await db.query(`select reconcile($1, $2, null)`, [debit.id, payable.id]);

    const doc = await one<{ amount_paid: string; amount_residual: string; payment_state: string }>(
      db,
      `select amount_paid, amount_residual, payment_state from documents where id = $1`,
      [documentId],
    );
    expect(doc.amount_paid).toBe('1210.00');
    expect(doc.amount_residual).toBe('0.00');
    expect(doc.payment_state).toBe('paid');
  });

  it('puts the document back when the matching is undone', async () => {
    const { documentId, receivableLineId } = await invoiceWithReceivable('2026-04-03');
    const receipt = await bankReceipt('2026-04-11', 1210);
    const pairing = await one<{ id: string }>(db, `select (reconcile($1, $2, null)).id`, [
      receivableLineId,
      receipt,
    ]);
    expect(
      (
        await one<{ payment_state: string }>(
          db,
          `select payment_state from documents where id = $1`,
          [documentId],
        )
      ).payment_state,
    ).toBe('paid');

    await db.query(`select unreconcile($1)`, [pairing.id]);

    const doc = await one<{ amount_paid: string; payment_state: string }>(
      db,
      `select amount_paid, payment_state from documents where id = $1`,
      [documentId],
    );
    expect(doc.amount_paid).toBe('0.00');
    expect(doc.payment_state).toBe('not_paid');
  });

  it('releases the matched amount when a pairing is undone', async () => {
    const { receivableLineId } = await invoiceWithReceivable('2026-03-07');
    const receipt = await bankReceipt('2026-03-22', 1210);
    const pairing = await one<{ id: string }>(db, `select (reconcile($1, $2, null)).id`, [
      receivableLineId,
      receipt,
    ]);
    await db.query(`select unreconcile($1)`, [pairing.id]);

    const line = await one<{ matched_amount: string; matching_number: string | null }>(
      db,
      `select matched_amount, matching_number from entry_lines where id = $1`,
      [receivableLineId],
    );
    expect(line.matched_amount).toBe('0.00');
    expect(line.matching_number).toBeNull();
  });
});
