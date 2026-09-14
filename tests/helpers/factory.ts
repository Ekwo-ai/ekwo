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

/** Creates a row in the customer's auth.users and returns its id. */
export async function newUser(db: PGlite, email?: string): Promise<string> {
  const id = crypto.randomUUID();
  await db.query(`insert into auth.users (id, email) values ($1, $2)`, [
    id,
    email ?? `${id}@example.test`,
  ]);
  return id;
}

/** Makes a user an instance administrator, creating the auth user first. */
export async function newInstanceAdmin(db: PGlite): Promise<string> {
  const id = await newUser(db);
  await db.query(`insert into instance_admins (user_id) values ($1)`, [id]);
  return id;
}

export interface Fixture {
  companyId: string;
  ownerId: string;
}

/**
 * A fresh company with a country's template and an open financial year.
 *
 * Belgium and calendar 2026 are what a test gets when it says nothing, because
 * that is what most of them want. Neither is baked in: the country is any the
 * seeds carry, the chart is any the pack offers, and the year is any pair of
 * dates — the golden runner installs a company per pack from what the pack's
 * own scenario declares, and cannot be the one place a country is assumed.
 */
export async function newCompany(
  db: PGlite,
  options: {
    country?: string;
    name?: string;
    ownerId?: string;
    /** Chart code of the pack. Its default chart when left out. */
    chart?: string | null;
    /** Language the books are installed in. The pack's own when left out. */
    language?: string | null;
    fiscalYear?: { name: string; start: string; end: string };
  } = {},
): Promise<Fixture> {
  const country = options.country ?? 'BE';
  const ownerId = options.ownerId ?? crypto.randomUUID();
  const company = await one<{ id: string }>(
    db,
    // No literal: since 20260913102758 the two columns carry no default, and
    // the answer for a company is the pack of its country — which is what a
    // real one gets from `create_company()`.
    `insert into companies (name, country, fiscal_country, currency_code, language)
     select $1, $2, $2, d.currency_code, d.language_default
       from country_defaults d where d.country = $2
     returning id`,
    [options.name ?? 'Test Company', country],
  );
  await db.query(`insert into company_members (company_id, user_id, role) values ($1, $2, 'owner')`, [
    company.id,
    ownerId,
  ]);
  await db.query(`select install_country_template($1, $2, $3, $4)`, [
    company.id,
    country,
    options.language ?? null,
    options.chart ?? null,
  ]);
  const year = options.fiscalYear ?? {
    name: 'Exercice 2026',
    start: '2026-01-01',
    end: '2026-12-31',
  };
  await db.query(
    `insert into fiscal_years (company_id, name, start_date, end_date)
     values ($1, $2, $3::date, $4::date)`,
    [company.id, year.name, year.start, year.end],
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

/**
 * What a number of this company looks like, as a pattern, read from the
 * country pack rather than written down here.
 *
 * A test that asserts `SAL/2026/0001` asserts Belgium's answer, which is the
 * thing the schema stopped doing when numbering started reading
 * `country_defaults.number_format`. These two helpers build the expectation
 * from the pattern the pack declares, so a pack that changes its numbering
 * changes what the tests expect with it.
 */
export async function numberFormatOf(db: PGlite, companyId: string): Promise<string> {
  const row = await one<{ number_format: string | null }>(
    db,
    `select number_format from numbering_rules($1)`,
    [companyId],
  );
  if (row.number_format === null) throw new Error('this company has no number format to test against');
  return row.number_format;
}

const NUMBER_TOKENS = /(\{CODE\}|\{YYYY\}|\{YY\}|\{MM\}|\{N+\})/;

function renderNumberPart(
  part: string,
  journalCode: string,
  date: Date,
  counter: string,
): string {
  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  if (part === '{CODE}') return journalCode;
  if (part === '{YYYY}') return year;
  if (part === '{YY}') return year.slice(-2);
  if (part === '{MM}') return month;
  if (/^\{N+\}$/.test(part)) return counter.padStart(part.length - 2, '0');
  return part;
}

/** The exact number the nth document of a journal gets, on this pack. */
export async function expectedNumber(
  db: PGlite,
  companyId: string,
  journalCode: string,
  isoDate: string,
  counter: number,
): Promise<string> {
  const format = await numberFormatOf(db, companyId);
  const date = new Date(`${isoDate}T00:00:00Z`);
  return format
    .split(NUMBER_TOKENS)
    .map((part) => renderNumberPart(part, journalCode, date, String(counter)))
    .join('');
}

/** The shape every number of a journal has, on this pack. */
export async function numberShape(
  db: PGlite,
  companyId: string,
  journalCode: string,
  isoDate: string,
): Promise<RegExp> {
  const format = await numberFormatOf(db, companyId);
  const date = new Date(`${isoDate}T00:00:00Z`);
  const body = format
    .split(NUMBER_TOKENS)
    .map((part) =>
      /^\{N+\}$/.test(part)
        ? `\\d{${part.length - 2},}`
        : renderNumberPart(part, journalCode, date, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    )
    .join('');
  return new RegExp(`^${body}$`);
}
