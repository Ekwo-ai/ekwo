/**
 * A quarter of bookkeeping, through the tools an assistant actually calls.
 *
 * Create a customer, invoice them 1 000 € at 21 %, post it, take the payment
 * in two instalments, match both, then read the balance, the VAT return and
 * the FEC back. Every assertion is on what the database says afterwards, not
 * on what a handler returned to itself.
 */

import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readTools, writeTools, type Backend } from '../../packages/mcp/src/index.js';
import { freshDatabase } from '../helpers/db.js';
import { newCompany, type Fixture } from '../helpers/factory.js';
import { addBankAccount, backendFor, ledgerOfEntry, list, record } from './helpers.js';

let db: PGlite;
let fx: Fixture;
let backend: Backend;
let customerId: string;
let documentId: string;
let entryId: string;

beforeAll(async () => {
  db = await freshDatabase();
  fx = await newCompany(db, { country: 'BE', name: 'MCP Test SRL' });
  await addBankAccount(db, fx.companyId);
  backend = backendFor(db, fx.ownerId);
});

afterAll(async () => {
  await db.close();
});

describe('the books, through the tools', () => {
  it('creates a customer and finds them again', async () => {
    const created = record(
      await writeTools.createContact(backend, {
        company_id: fx.companyId,
        name: 'Cliente Dumont',
        contact_type: 'customer',
        country: 'BE',
        vat_number: 'BE0999999999',
        payment_terms_days: 30,
      }),
    );
    const contact = record(created['contact']);
    customerId = String(contact['id']);
    expect(contact['name']).toBe('Cliente Dumont');
    expect(contact['payment_terms_days']).toBe(30);

    const found = record(
      await readTools.searchContacts(backend, { company_id: fx.companyId, query: 'dumont' }),
    );
    expect(list(found['contacts']).map((row) => row['id'])).toEqual([customerId]);
  });

  it('creates a draft invoice whose totals come from the database', async () => {
    const created = record(
      await writeTools.createDocument(backend, {
        company_id: fx.companyId,
        doc_type: 'sale_invoice',
        contact_id: customerId,
        document_date: '2026-06-15',
        number: 'FAC-2026-0001',
        lines: [
          {
            name: 'Conseil, juin 2026',
            unit_price: '1000.00',
            account_code: '704000',
            tax_code: 'BE-S-21',
          },
        ],
      }),
    );
    const document = record(created['document']);
    documentId = String(document['id']);

    expect(document['state']).toBe('draft');
    expect(document['amount_untaxed']).toBe('1000.00');
    expect(document['amount_tax']).toBe('210.00');
    expect(document['amount_total']).toBe('1210.00');
    // Amounts are decimal strings on the way out, never floats.
    expect(typeof document['amount_total']).toBe('string');

    const lines = list(created['lines']);
    expect(lines).toHaveLength(1);
    expect(record(lines[0]?.['account'])['code']).toBe('704000');
    expect(record(lines[0]?.['tax'])['code']).toBe('BE-S-21');
  });

  it('refuses a line whose account does not exist, before writing anything', async () => {
    await expect(
      writeTools.createDocument(backend, {
        company_id: fx.companyId,
        doc_type: 'sale_invoice',
        contact_id: customerId,
        document_date: '2026-06-15',
        lines: [{ name: 'Erreur', unit_price: '10.00', account_code: '999999' }],
      }),
    ).rejects.toThrow(/unknown_account_code/);

    const count = await db.query<{ n: number }>(
      `select count(*)::int as n from documents where company_id = $1`,
      [fx.companyId],
    );
    expect(count.rows[0]?.n).toBe(1);
  });

  it('posts it to 704 / 451 / 400, balanced', async () => {
    const posted = record(await writeTools.postDocument(backend, { document_id: documentId }));
    const entry = record(posted['entry']);
    entryId = String(entry['id']);

    expect(entry['state']).toBe('posted');
    expect(entry['number']).toMatch(/^SAL\/2026\/\d{4}$/);
    expect(entry['total_debit']).toBe('1210.00');
    expect(entry['total_credit']).toBe('1210.00');

    expect(await ledgerOfEntry(db, entryId)).toEqual([
      { code: '704000', debit: '0.00', credit: '1000.00' },
      { code: '451000', debit: '0.00', credit: '210.00' },
      { code: '400000', debit: '1210.00', credit: '0.00' },
    ]);
  });

  it('refuses to post the same document twice', async () => {
    await expect(writeTools.postDocument(backend, { document_id: documentId })).rejects.toThrow(
      /document_already_posted|document_already_booked/,
    );
  });

  it('refuses to edit the lines of a posted document', async () => {
    await expect(
      writeTools.updateDocumentLines(backend, {
        document_id: documentId,
        lines: [{ name: 'Autre', unit_price: '1.00', account_code: '704000' }],
      }),
    ).rejects.toThrow(/document_not_draft/);
  });

  it('records a partial payment, books it and matches it', async () => {
    const paid = record(
      await writeTools.recordPayment(backend, {
        company_id: fx.companyId,
        direction: 'inbound',
        amount: '500.00',
        payment_date: '2026-07-10',
        contact_id: customerId,
        journal_code: 'BNK',
        reference: 'VIR-0001',
      }),
    );

    const entry = record(paid['entry']);
    expect(await ledgerOfEntry(db, String(entry['id']))).toEqual([
      { code: '550000', debit: '500.00', credit: '0.00' },
      { code: '400000', debit: '0.00', credit: '500.00' },
    ]);
    expect(list(paid['matched'])).toHaveLength(1);
    expect(record(paid['payment'])['state']).toBe('posted');

    const open = record(
      await readTools.agedBalance(backend, { company_id: fx.companyId, at: '2026-07-31' }),
    );
    expect(list(open['rows'])[0]?.['total']).toBe('710.00');
  });

  it('records the balance and closes the invoice', async () => {
    const paid = record(
      await writeTools.recordPayment(backend, {
        company_id: fx.companyId,
        direction: 'inbound',
        amount: '710.00',
        payment_date: '2026-07-20',
        contact_id: customerId,
        journal_code: 'BNK',
      }),
    );
    expect(list(paid['matched'])).toHaveLength(1);

    const open = record(
      await readTools.agedBalance(backend, { company_id: fx.companyId, at: '2026-08-31' }),
    );
    expect(list(open['rows'])).toEqual([]);

    const document = record(await readTools.getDocument(backend, { document_id: documentId }));
    expect(record(document['document'])['amount_residual']).toBe('0.00');
  });

  it('undoes a matching and puts the residual back', async () => {
    const reconciliations = await db.query<{ id: string; amount: string }>(
      `select r.id, r.amount::text as amount
         from reconciliations r
        where r.company_id = $1
        order by r.created_at desc limit 1`,
      [fx.companyId],
    );
    const last = reconciliations.rows[0];
    expect(last).toBeDefined();

    await writeTools.unreconcile(backend, { reconciliation_id: last?.id as string });

    // The aged balance nets the unmatched payment against the invoice, so read
    // the residual of the invoice line itself: 710 is open again.
    const residual = await db.query<{ open: string }>(
      `select (abs(l.balance) - l.matched_amount)::text as open
         from entry_lines l
        where l.entry_id = $1 and l.account_id = account_id_by_code($2, '400000')`,
      [entryId, fx.companyId],
    );
    expect(residual.rows[0]?.open).toBe('710.00');

    // Put it back, so the report assertions below read a settled invoice.
    const payment = await db.query<{ line_id: string }>(
      `select l.id as line_id
         from entry_lines l
         join entries e on e.id = l.entry_id
        where l.company_id = $1 and l.account_id = account_id_by_code($1, '400000')
          and l.credit = 710 and e.state = 'posted'
        limit 1`,
      [fx.companyId],
    );
    const invoiceLine = await db.query<{ line_id: string }>(
      `select l.id as line_id from entry_lines l
        where l.entry_id = $1 and l.account_id = account_id_by_code($2, '400000')`,
      [entryId, fx.companyId],
    );
    await writeTools.reconcile(backend, {
      line_a: invoiceLine.rows[0]?.line_id as string,
      line_b: payment.rows[0]?.line_id as string,
    });

    const after = record(
      await readTools.agedBalance(backend, { company_id: fx.companyId, at: '2026-08-31' }),
    );
    expect(list(after['rows'])).toEqual([]);
  });

  it('reads the trial balance back, and it balances', async () => {
    const balance = record(
      await readTools.trialBalance(backend, {
        company_id: fx.companyId,
        from: '2026-01-01',
        to: '2026-12-31',
      }),
    );
    const totals = record(balance['totals']);
    expect(totals['debit']).toBe(totals['credit']);

    const accounts = list(balance['accounts']);
    const closing = (code: string): unknown =>
      accounts.find((row) => row['account_code'] === code)?.['closing_balance'];
    expect(closing('550000')).toBe('1210.00');
    expect(closing('704000')).toBe('-1000.00');
    expect(closing('400000')).toBe('0.00');
  });

  it('reads the VAT return, with 21 % of the sale in box 54', async () => {
    const vat = record(
      await readTools.vatReturn(backend, {
        company_id: fx.companyId,
        from: '2026-04-01',
        to: '2026-06-30',
      }),
    );
    const boxes = list(vat['boxes']);
    const amount = (box: string): unknown => boxes.find((row) => row['box'] === box)?.['amount'];
    expect(amount('03')).toBe('1000.00');
    expect(amount('54')).toBe('210.00');
    // Belgium's frame VI: what is due, derived from the other boxes.
    expect(amount('71')).toBe('210.00');
  });

  it('generates a FEC that passes its own checks', async () => {
    const fec = record(
      await readTools.generateFec(backend, {
        company_id: fx.companyId,
        from: '2026-01-01',
        to: '2026-12-31',
      }),
    );
    expect(fec['violations']).toEqual([]);
    expect(fec['lines']).toBe(7);

    const file = String(fec['file']);
    expect(file.split('\n')[0]).toContain('JournalCode');
    expect(file).toContain('SAL');
    expect(file).toContain('1210,00');
    // No nine-digit SIREN on a Belgian company, so no filename is invented.
    expect(fec['filename']).toBeNull();
  });

  it('says how it is connected and what it can see', async () => {
    const state = record(await readTools.status(backend));
    expect(state['schema_version']).toBe('0.1.0');
    expect(record(state['connection'])['mode']).toBe('sql');
    expect(record(state['connection'])['acting_as']).toBe(fx.ownerId);
    expect(list(state['companies']).map((row) => row['id'])).toEqual([fx.companyId]);
  });
});
