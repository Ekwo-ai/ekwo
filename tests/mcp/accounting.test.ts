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
import { newCompany, numberShape, type Fixture } from '../helpers/factory.js';
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
    expect(entry['number']).toMatch(await numberShape(db, fx.companyId, 'SAL', '2026-06-15'));
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

  it('says what the law of the country puts on the invoice, and on what terms', async () => {
    const document = record(await readTools.getDocument(backend, { document_id: documentId }));

    // A domestic sale at the standard rate owes one sentence — the late
    // payment terms — and the reverse charge and the intra-Union exemptions
    // stay off it, because the view reads the treatment of the tax on each
    // line rather than a flag somebody remembered to set.
    const mentions = list(document['legal_mentions']);
    expect(mentions.map((mention) => mention['code'])).toEqual(['late_payment']);
    expect(String(mentions[0]?.['text'])).toMatch(/40/);
    expect(mentions[0]?.['legal_reference']).not.toBeNull();

    // The payment and e-invoicing rules come from the country model, and the
    // assertion is against that row rather than against a value typed here:
    // the pack is the source, and a test that restates it is a second one.
    const rules = record(document['country_rules']);
    const stored = await db.query<{
      legal_payment_days: number;
      einvoice_profile: string | null;
      party_scheme: string | null;
      tax_point_rule: string | null;
    }>(
      `select d.legal_payment_days, d.einvoice_profile, d.party_scheme, d.tax_point_rule
         from country_defaults d
         join companies c on c.fiscal_country = d.country
        where c.id = $1`,
      [fx.companyId],
    );
    expect(rules['legal_payment_days']).toBe(stored.rows[0]?.legal_payment_days);
    expect(rules['einvoice_profile']).toBe(stored.rows[0]?.einvoice_profile);
    expect(rules['party_scheme']).toBe(stored.rows[0]?.party_scheme);
    expect(rules['tax_point_rule']).toBe(stored.rows[0]?.tax_point_rule);
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
    const again = record(
      await writeTools.reconcile(backend, {
        line_a: invoiceLine.rows[0]?.line_id as string,
        line_b: payment.rows[0]?.line_id as string,
      }),
    );
    // What a matching caused is part of what it returns, so a client can show
    // it. Nothing here falls due on collection and nothing is in a foreign
    // currency, so both are empty — and the fields are there to be read.
    const row = record(again['reconciliation']);
    expect(row).toHaveProperty('fx_entry_id', null);
    expect(row).toHaveProperty('tax_transfer_entry_id', null);

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

    // The form says which one it is and what each box is called, so an
    // assistant can read the return out without knowing the country.
    expect(vat['report_code']).toBe('BE-VAT-PERIODIC');
    expect(boxes.find((row) => row['box'] === '54')?.['name']).toBe(
      'TVA due sur les opérations des grilles 01, 02 et 03',
    );
    expect(boxes.find((row) => row['box'] === 'XX')?.['hidden']).toBe(true);
  });

  it('lists the schemes this company can be presented on', async () => {
    const listed = record(await readTools.listStatements(backend, { company_id: fx.companyId }));
    const statements = list(listed['statements']);
    expect(statements.filter((s) => s['is_default'] === true).map((s) => s['code']).sort()).toEqual([
      'BE-BNB-ABBR-AF',
      'BE-BNB-ABBR-BS',
      'BE-BNB-ABBR-IS',
    ]);
    // The generic framework is offered beside them, for any chart.
    expect(statements.map((s) => s['code'])).toContain('IFRS-SME-BS');
  });

  it('reads a balance sheet that ties out, and says so', async () => {
    const answer = record(
      await readTools.financialStatement(backend, {
        company_id: fx.companyId,
        statement_code: 'BE-BNB-ABBR-BS',
        from: '2026-01-01',
        to: '2026-12-31',
      }),
    );
    const lines = list(answer['lines']);
    const amount = (code: string): unknown =>
      lines.find((row) => row['line_code'] === code)?.['amount'];

    const income = record(
      await readTools.financialStatement(backend, {
        company_id: fx.companyId,
        statement_code: 'BE-BNB-ABBR-IS',
        from: '2026-01-01',
        to: '2026-12-31',
      }),
    );
    const profit = list(income['lines']).find((row) => row['line_code'] === '9905')?.['amount'];

    expect(Number(amount('20/58'))).toBeCloseTo(
      Number(amount('10/49')) + Number(profit),
      2,
    );
    expect(answer['unmapped_accounts']).toEqual([]);
    expect(String(answer['note'])).toMatch(/ties out/);
  });

  it('takes the form by name where a country files more than one', async () => {
    const named = record(
      await readTools.vatReturn(backend, {
        company_id: fx.companyId,
        from: '2026-04-01',
        to: '2026-06-30',
        report_code: 'BE-VAT-PERIODIC',
      }),
    );
    const implied = record(
      await readTools.vatReturn(backend, {
        company_id: fx.companyId,
        from: '2026-04-01',
        to: '2026-06-30',
      }),
    );
    expect(named['boxes']).toEqual(implied['boxes']);
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
    // The version the database it is pointed at defines, not one written here:
    // what this asserts is that `status` reports it, and a release bumps it.
    const defined = await db.query<{ version: string }>(`select ekwo_schema_version() as version`);
    expect(state['schema_version']).toBe(defined.rows[0]?.version);
    expect(record(state['connection'])['mode']).toBe('sql');
    expect(record(state['connection'])['acting_as']).toBe(fx.ownerId);
    expect(list(state['companies']).map((row) => row['id'])).toEqual([fx.companyId]);
  });
});

/**
 * A document line may leave its account out.
 *
 * The resolution is the trigger's — the line, then the product, then the
 * company, then the country model — and this proves the tool lets it happen
 * rather than refusing first, which is what it used to do.
 */
describe('a line with no account', () => {
  it('is booked on the company default and reported as such', async () => {
    const draft = record(
      await writeTools.createDocument(backend, {
        company_id: fx.companyId,
        doc_type: 'sale_invoice',
        contact_id: customerId,
        document_date: '2026-09-10',
        lines: [
          { name: 'Sans compte', unit_price: '500.00', tax_code: 'BE-S-21' },
          { name: 'Avec compte', unit_price: '100.00', account_code: '700300', tax_code: 'BE-S-21' },
        ],
      }),
    );
    const lines = list(draft['lines']);
    const codes = lines.map((line) => record(line['account'] ?? {})['code']);
    expect(codes).toEqual(['700000', '700300']);
  });

  it('refuses, naming the tool argument, when there is no default anywhere', async () => {
    // A company whose model has nothing to offer for a purchase.
    await db.query(
      'update companies set default_purchase_account_id = null where id = $1',
      [fx.companyId],
    );
    await db.query(`update country_defaults set purchase_account_code = null where country = 'BE'`);
    try {
      await expect(
        writeTools.createDocument(backend, {
          company_id: fx.companyId,
          doc_type: 'purchase_invoice',
          contact_id: customerId,
          document_date: '2026-09-10',
          lines: [{ name: 'Rien nulle part', unit_price: '50.00' }],
        }),
      ).rejects.toThrow(/missing_account/);
    } finally {
      await db.query(
        `update country_defaults set purchase_account_code = '610000' where country = 'BE'`,
      );
      await db.query(
        `update companies set default_purchase_account_id = account_id_by_code($1, '610000') where id = $1`,
        [fx.companyId],
      );
    }
  });
});

describe('the currency a tool writes when the caller names none', () => {
  it('is the company own, never a euro written into the code', async () => {
    // A company that does not keep its books in euro is the whole test: a
    // literal fallback would give it a euro invoice and nothing would say so.
    const other = await newCompany(db, { country: 'BE', name: 'Loonie SRL' });
    await db.query(`update companies set currency_code = 'CAD' where id = $1`, [other.companyId]);
    const theirs = backendFor(db, other.ownerId);

    const contact = record(
      await writeTools.createContact(theirs, {
        company_id: other.companyId,
        name: 'Cliente au Québec',
        contact_type: 'customer',
      }),
    );

    const document = record(
      await writeTools.createDocument(theirs, {
        company_id: other.companyId,
        doc_type: 'sale_invoice',
        contact_id: String(record(contact['contact'])['id']),
        document_date: '2026-06-15',
        lines: [{ name: 'Conseil', unit_price: '100.00', account_code: '704000' }],
      }),
    );
    expect(record(document['document'])['currency_code']).toBe('CAD');

    const product = record(
      await writeTools.createProduct(theirs, {
        company_id: other.companyId,
        code: 'CONSEIL',
        name: 'Conseil',
        sale_price: '100.00',
      }),
    );
    expect(record(product['product'])['currency_code']).toBe('CAD');

    // And a company nobody is a member of answers with a refusal, not a euro.
    await expect(
      writeTools.createProduct(backend, {
        company_id: '00000000-0000-0000-0000-000000000009',
        code: 'NOPE',
        name: 'Nope',
      }),
    ).rejects.toThrow(/not_found: company/);
  });
});

describe('an invoice in another currency, settled through the server', () => {
  it('books the difference the rate made and clears the customer', async () => {
    const contact = record(
      record(
        await writeTools.createContact(backend, {
          company_id: fx.companyId,
          name: 'Client Dollar',
          contact_type: 'customer',
          country: 'US',
        }),
      )['contact'],
    );
    const created = record(
      await writeTools.createDocument(backend, {
        company_id: fx.companyId,
        doc_type: 'sale_invoice',
        contact_id: String(contact['id']),
        document_date: '2026-09-01',
        number: 'FAC-2026-USD',
        lines: [{ name: 'Conseil', unit_price: '1000.00', account_code: '704000', tax_code: 'BE-S-EXP' }],
      }),
    );
    const documentUsd = String(record(created['document'])['id']);
    await db.query(`update documents set currency_code = 'USD', exchange_rate = 1.1 where id = $1`, [
      documentUsd,
    ]);
    await writeTools.postDocument(backend, { document_id: documentUsd });

    const paid = record(
      await writeTools.recordPayment(backend, {
        company_id: fx.companyId,
        direction: 'inbound',
        amount: '1000.00',
        currency_code: 'USD',
        exchange_rate: '1.05',
        payment_date: '2026-10-01',
        contact_id: String(contact['id']),
        journal_code: 'BNK',
      }),
    );
    const matched = list(paid['matched']);
    expect(matched).toHaveLength(1);
    // The matching is worked out on 1 000,00 USD; 909,09 € was booked and
    // 952,38 € came in, so 43,29 € is a realised gain.
    expect(record(matched[0])['amount']).toBe('909.09');
    expect(record(matched[0])['fx_entry_id']).not.toBeNull();

    const gain = await db.query<{ balance: string }>(
      `select coalesce(sum(l.credit - l.debit), 0)::text as balance
         from entry_lines l
        where l.company_id = $1 and l.account_id = account_id_by_code($1, '754000')`,
      [fx.companyId],
    );
    expect(gain.rows[0]?.balance).toBe('43.29');

    const document = record(await readTools.getDocument(backend, { document_id: documentUsd }));
    expect(record(document['document'])['amount_residual']).toBe('0.00');
  });
});
