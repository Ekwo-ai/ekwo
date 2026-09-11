import type { PGlite } from '@electric-sql/pglite';
import { one, rows } from './db.js';

export const DEMO_VAT = 'BE0123456749';

/** The owner of the demo company, as seeded. */
export const DEMO_OWNER = '00000000-0000-0000-0000-000000000001';

export async function demoCompanyId(db: PGlite): Promise<string> {
  const row = await one<{ id: string }>(db, `select id from companies where vat_number = $1`, [
    DEMO_VAT,
  ]);
  return row.id;
}

export interface Fixture {
  companyId: string;
  ownerId: string;
}

/** A fresh company with the Belgian template and an open 2026 financial year. */
export async function newCompany(
  db: PGlite,
  options: { country?: 'BE' | 'FR'; name?: string; ownerId?: string } = {},
): Promise<Fixture> {
  const country = options.country ?? 'BE';
  const ownerId = options.ownerId ?? crypto.randomUUID();
  const company = await one<{ id: string }>(
    db,
    `insert into companies (name, country, fiscal_country, currency_code)
     values ($1, $2, $2, 'EUR') returning id`,
    [options.name ?? 'Test Company', country],
  );
  await db.query(`insert into company_members (company_id, user_id, role) values ($1, $2, 'owner')`, [
    company.id,
    ownerId,
  ]);
  await db.query(`select install_country_template($1, $2)`, [company.id, country]);
  await db.query(
    `insert into fiscal_years (company_id, name, start_date, end_date)
     values ($1, 'Exercice 2026', date '2026-01-01', date '2026-12-31')`,
    [company.id],
  );
  return { companyId: company.id, ownerId };
}

export async function accountId(db: PGlite, companyId: string, code: string): Promise<string> {
  const row = await one<{ id: string }>(db, `select account_id_by_code($1, $2) as id`, [
    companyId,
    code,
  ]);
  return row.id;
}

export async function taxId(db: PGlite, companyId: string, code: string): Promise<string> {
  const row = await one<{ id: string }>(
    db,
    `select id from taxes where company_id = $1 and code = $2`,
    [companyId, code],
  );
  return row.id;
}

export async function newContact(
  db: PGlite,
  companyId: string,
  options: {
    name?: string;
    type?: 'customer' | 'supplier';
    country?: string;
    vat?: string | null;
    auxiliaryCode?: string | null;
    paymentTermsDays?: number;
  } = {},
): Promise<string> {
  const isCustomer = (options.type ?? 'customer') === 'customer';
  const row = await one<{ id: string }>(
    db,
    `insert into contacts (company_id, name, contact_type, country, vat_number,
                           auxiliary_code, payment_terms_days)
     values ($1, $2, $3, $4, $5, $6, $7) returning id`,
    [
      companyId,
      options.name ?? (isCustomer ? 'Test Customer' : 'Test Supplier'),
      options.type ?? 'customer',
      options.country ?? 'BE',
      options.vat ?? null,
      options.auxiliaryCode ?? null,
      options.paymentTermsDays ?? 30,
    ],
  );
  return row.id;
}

export interface LineInput {
  name?: string;
  quantity?: number;
  unitPrice: number;
  discountPercent?: number;
  taxCode?: string | null;
  accountCode: string;
}

/** A draft document with its lines. Call `post_document` to book it. */
export async function newDocument(
  db: PGlite,
  companyId: string,
  input: {
    docType:
      | 'sale_invoice'
      | 'sale_credit_note'
      | 'purchase_invoice'
      | 'purchase_credit_note'
      | 'sale_quote';
    number?: string;
    contactId: string;
    date?: string;
    dueDate?: string | null;
    lines: LineInput[];
  },
): Promise<string> {
  const doc = await one<{ id: string }>(
    db,
    `insert into documents (company_id, doc_type, number, contact_id, document_date, due_date)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [
      companyId,
      input.docType,
      input.number ?? null,
      input.contactId,
      input.date ?? '2026-06-15',
      input.dueDate ?? null,
    ],
  );

  let sequence = 0;
  for (const line of input.lines) {
    sequence += 10;
    await db.query(
      `insert into document_lines (document_id, company_id, sequence, name, quantity,
                                   unit_price, discount_percent, tax_id, account_id)
       values ($1, $2, $3, $4, $5, $6, $7,
               case when $8::text is null then null
                    else (select id from taxes where company_id = $2 and code = $8) end,
               account_id_by_code($2, $9))`,
      [
        doc.id,
        companyId,
        sequence,
        line.name ?? 'Line',
        line.quantity ?? 1,
        line.unitPrice,
        line.discountPercent ?? 0,
        line.taxCode ?? null,
        line.accountCode,
      ],
    );
  }
  return doc.id;
}

export interface LedgerLine {
  code: string;
  debit: string;
  credit: string;
  box: string | null;
  box_amount: string | null;
  tax_line: boolean;
}

/** The ledger lines of the entry a document produced, in sequence order. */
export async function ledgerOf(db: PGlite, documentId: string): Promise<LedgerLine[]> {
  return rows<LedgerLine>(
    db,
    `select a.code, l.debit, l.credit, l.declaration_box as box, l.box_amount, l.tax_line
       from entry_lines l
       join accounts a on a.id = l.account_id
       join entries e on e.id = l.entry_id
      where e.document_id = $1
      order by l.sequence`,
    [documentId],
  );
}
