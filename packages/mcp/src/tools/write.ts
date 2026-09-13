/**
 * The writing half.
 *
 * One rule holds everywhere here: the ledger is written by the schema, never
 * by this package. `post_document`, `post_payment`, `post_entry`, `reconcile`
 * and `unreconcile` carry the accounting rules — balance, numbering, period
 * locks, the counterpart that is the difference of everything else — and this
 * server calls them. Nothing in this file inserts an `entries` or an
 * `entry_lines` row. Direct inserts are for the objects a person types:
 * contacts, draft documents and their lines, payments, bank transactions.
 *
 * The second rule is that a refusal from the database is the answer. A
 * `period_locked:` raise is not an error to be worked around by moving a
 * date; it is the company telling the assistant that the month is closed.
 */

import { z } from 'zod';
import { EkwoMcpError, type Backend, type Filter, type Row } from '../backend.js';
import * as columns from '../columns.js';
import { amountIn, moneyFields } from '../format.js';
import { companyId, getDocument, isoDate, uuid } from './read.js';

/** The row, or a refusal naming what row level security did not return. */
function only<T>(rows: T[], what: string): T {
  const row = rows[0];
  if (row === undefined) {
    throw new EkwoMcpError(
      `not_found: ${what}. Either it does not exist, or your role on that company does not allow this.`,
    );
  }
  return row;
}

/** Resolves codes to ids in one query, and says which code was unknown. */
/**
 * The currency an amount is in when the caller names none: the company's own.
 *
 * Never a literal. A company that keeps its books in Canadian dollars would
 * get a euro invoice out of a euro written here, and a wrong answer is worse
 * than a refusal. `companies.currency_code` is never null, so there is always
 * one to find.
 */
async function companyCurrency(backend: Backend, company: string): Promise<string> {
  const rows = await backend.select<{ currency_code: string }>({
    table: 'companies',
    columns: ['currency_code'],
    where: [{ column: 'id', op: 'eq', value: company }],
  });
  const currency = rows[0]?.currency_code;
  if (currency === undefined) {
    throw new EkwoMcpError(
      `not_found: company ${company}. Either it does not exist or you are not a member of it.`,
    );
  }
  return currency;
}

async function idsByCode(
  backend: Backend,
  table: 'accounts' | 'taxes' | 'journals',
  company: string,
  codes: string[],
): Promise<Map<string, string>> {
  const singular = { accounts: 'account', taxes: 'tax', journals: 'journal' }[table];
  const wanted = [...new Set(codes)];
  if (wanted.length === 0) return new Map();
  const rows = await backend.select<{ id: string; code: string }>({
    table,
    columns: ['id', 'code'],
    where: [
      { column: 'company_id', op: 'eq', value: company },
      { column: 'code', op: 'in', value: wanted },
    ],
  });
  const found = new Map(rows.map((row) => [row.code, row.id]));
  for (const code of wanted) {
    if (!found.has(code)) {
      throw new EkwoMcpError(
        `unknown_${singular}_code: no ${singular} "${code}" in this company. list_accounts, get_company and the ekwo://companies/{id}/taxes resource say what exists.`,
      );
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

export const CreateContactInput = z.object({
  company_id: companyId,
  name: z.string().min(1),
  contact_type: z.enum(['customer', 'supplier', 'both', 'employee', 'other']),
  vat_number: z.string().min(1).optional(),
  email: z.string().min(1).optional(),
  country: z.string().length(2).optional().describe('ISO country code, e.g. BE.'),
  payment_terms_days: z.number().int().min(0).max(365).optional(),
  auxiliary_code: z.string().min(1).optional().describe('Sub-ledger code; the French FEC reports it.'),
  address_line1: z.string().min(1).optional(),
  postal_code: z.string().min(1).optional(),
  city: z.string().min(1).optional(),
});

export async function createContact(
  backend: Backend,
  args: z.infer<typeof CreateContactInput>,
): Promise<unknown> {
  const { company_id, ...rest } = args;
  const row: Row = { company_id, ...rest };
  const created = only(
    await backend.insert<Row>('contacts', [row], columns.CONTACT),
    'the contact could not be created',
  );
  return { contact: created };
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

const UNIT_CODE = z
  .string()
  .min(1)
  .max(3)
  .describe('UN/ECE recommendation 20: C62 a piece, HUR an hour, DAY a day, MON a month, KGM, LTR, MTR, KWH. Defaults to C62.');

export const CreateProductInput = z.object({
  company_id: companyId,
  code: z.string().min(1).describe("Your own reference for the item. Unique in the company, and what EN 16931 calls the seller's item identifier (BT-155)."),
  name: z.string().min(1).describe('What appears on the invoice line (BT-153).'),
  description: z.string().min(1).optional().describe('The longer text under the name (BT-154).'),
  kind: z.enum(['service', 'goods']).optional().describe('Defaults to service. Goods and services are not taxed alike and do not feed the same declaration boxes.'),
  unit_code: UNIT_CODE.optional(),
  currency_code: z.string().length(3).optional(),
  sale_price: z.union([z.string(), z.number()]).optional().describe('Net unit price on a sale. A line may still carry another.'),
  purchase_price: z.union([z.string(), z.number()]).optional(),
  sale_account_id: uuid.optional(),
  sale_account_code: z.string().min(1).optional().describe('Income account a sale of this books to.'),
  purchase_account_id: uuid.optional(),
  purchase_account_code: z.string().min(1).optional().describe('Expense account a purchase of this books to.'),
  sale_tax_id: uuid.optional(),
  sale_tax_code: z.string().min(1).optional().describe('Tax applied when it is sold, by code.'),
  purchase_tax_id: uuid.optional(),
  purchase_tax_code: z.string().min(1).optional(),
});

/** Turns the four `*_code` arguments into ids, in one query per table. */
async function productReferences(
  backend: Backend,
  company: string,
  args: {
    sale_account_code?: string | undefined;
    purchase_account_code?: string | undefined;
    sale_tax_code?: string | undefined;
    purchase_tax_code?: string | undefined;
  },
): Promise<{ accounts: Map<string, string>; taxes: Map<string, string> }> {
  const [accounts, taxes] = await Promise.all([
    idsByCode(
      backend,
      'accounts',
      company,
      [args.sale_account_code, args.purchase_account_code].filter((c): c is string => typeof c === 'string'),
    ),
    idsByCode(
      backend,
      'taxes',
      company,
      [args.sale_tax_code, args.purchase_tax_code].filter((c): c is string => typeof c === 'string'),
    ),
  ]);
  return { accounts, taxes };
}

export async function createProduct(
  backend: Backend,
  args: z.infer<typeof CreateProductInput>,
): Promise<unknown> {
  const { accounts, taxes } = await productReferences(backend, args.company_id, args);
  const currency = args.currency_code ?? (await companyCurrency(backend, args.company_id));

  const created = only(
    await backend.insert<Row>(
      'products',
      [
        {
          company_id: args.company_id,
          code: args.code.trim(),
          name: args.name,
          description: args.description ?? null,
          kind: args.kind ?? 'service',
          unit_code: (args.unit_code ?? 'C62').toUpperCase(),
          currency_code: currency,
          sale_price: args.sale_price === undefined ? null : amountIn(args.sale_price),
          purchase_price: args.purchase_price === undefined ? null : amountIn(args.purchase_price),
          sale_account_id:
            args.sale_account_id ?? (args.sale_account_code === undefined ? null : accounts.get(args.sale_account_code)),
          purchase_account_id:
            args.purchase_account_id ??
            (args.purchase_account_code === undefined ? null : accounts.get(args.purchase_account_code)),
          sale_tax_id: args.sale_tax_id ?? (args.sale_tax_code === undefined ? null : taxes.get(args.sale_tax_code)),
          purchase_tax_id:
            args.purchase_tax_id ?? (args.purchase_tax_code === undefined ? null : taxes.get(args.purchase_tax_code)),
        },
      ],
      columns.PRODUCT,
    ),
    'the product could not be created',
  );
  return {
    product: created,
    note: 'A product fills a line in and never constrains it: create_document takes product_code, and anything the line carries wins over it.',
  };
}

export const UpdateProductInput = z.object({
  product_id: uuid.optional(),
  company_id: companyId.optional().describe('Needed with product_code, to say which company the code belongs to.'),
  product_code: z.string().min(1).optional().describe('Instead of product_id, with company_id.'),
  code: z.string().min(1).optional().describe('A new reference for it.'),
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  kind: z.enum(['service', 'goods']).optional(),
  unit_code: UNIT_CODE.optional(),
  sale_price: z.union([z.string(), z.number()]).nullable().optional(),
  purchase_price: z.union([z.string(), z.number()]).nullable().optional(),
  sale_account_code: z.string().min(1).optional(),
  purchase_account_code: z.string().min(1).optional(),
  sale_tax_code: z.string().min(1).optional(),
  purchase_tax_code: z.string().min(1).optional(),
  active: z.boolean().optional().describe('False retires it: searches stop offering it and the lines that already carry it are untouched.'),
});

/**
 * Changes a product. What it does not do is reach into the documents that
 * already reference it: a line keeps the text, the price and the account it
 * was invoiced with, because an invoice is a statement about a day and a
 * catalogue edited afterwards must not be able to rewrite it.
 */
export async function updateProduct(
  backend: Backend,
  args: z.infer<typeof UpdateProductInput>,
): Promise<unknown> {
  const where: Filter[] =
    args.product_id !== undefined
      ? [{ column: 'id', op: 'eq', value: args.product_id }]
      : [
          { column: 'company_id', op: 'eq', value: args.company_id ?? '' },
          { column: 'code', op: 'eq', value: args.product_code ?? '' },
        ];
  if (args.product_id === undefined && (args.company_id === undefined || args.product_code === undefined)) {
    throw new EkwoMcpError(
      'missing_product: give product_id, or company_id together with product_code.',
    );
  }

  const existing = only(
    await backend.select<Row>({ table: 'products', columns: columns.PRODUCT, where }),
    args.product_id === undefined ? `product "${String(args.product_code)}"` : `product ${args.product_id}`,
  );
  const company = existing['company_id'] as string;
  const { accounts, taxes } = await productReferences(backend, company, args);

  const patch: Row = {};
  if (args.code !== undefined) patch['code'] = args.code.trim();
  if (args.name !== undefined) patch['name'] = args.name;
  if (args.description !== undefined) patch['description'] = args.description;
  if (args.kind !== undefined) patch['kind'] = args.kind;
  if (args.unit_code !== undefined) patch['unit_code'] = args.unit_code.toUpperCase();
  if (args.sale_price !== undefined) {
    patch['sale_price'] = args.sale_price === null ? null : amountIn(args.sale_price);
  }
  if (args.purchase_price !== undefined) {
    patch['purchase_price'] = args.purchase_price === null ? null : amountIn(args.purchase_price);
  }
  if (args.sale_account_code !== undefined) patch['sale_account_id'] = accounts.get(args.sale_account_code);
  if (args.purchase_account_code !== undefined) {
    patch['purchase_account_id'] = accounts.get(args.purchase_account_code);
  }
  if (args.sale_tax_code !== undefined) patch['sale_tax_id'] = taxes.get(args.sale_tax_code);
  if (args.purchase_tax_code !== undefined) patch['purchase_tax_id'] = taxes.get(args.purchase_tax_code);
  if (args.active !== undefined) patch['active'] = args.active;

  if (Object.keys(patch).length === 0) {
    throw new EkwoMcpError('nothing_to_update: give at least one field to change.');
  }

  const updated = only(
    await backend.update<Row>(
      'products',
      patch,
      [{ column: 'id', op: 'eq', value: existing['id'] as string }],
      columns.PRODUCT,
    ),
    'the product could not be updated, and your role on that company may be the reason',
  );
  return {
    product: updated,
    note: 'Documents already booked are untouched: a line keeps the text, the price and the account it was invoiced with.',
  };
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

const LineInput = z.object({
  name: z.string().min(1).optional().describe('What is billed, as it appears on the invoice. Required unless a product supplies it.'),
  description: z.string().min(1).optional().describe('EN 16931 BT-154, under the name. A product supplies it when the line does not.'),
  quantity: z.union([z.string(), z.number()]).optional().describe('Defaults to 1.'),
  unit_code: z.string().min(1).max(3).optional().describe('Unit of measure, UN/ECE rec. 20: C62 a piece, HUR an hour, DAY a day, KGM, LTR, MTR. From the product, then C62.'),
  unit_price: z.union([z.string(), z.number()]).optional().describe("Price of one unit, excluding tax, as a decimal string. Left out, the product's price; without either, the line is refused."),
  discount_percent: z.union([z.string(), z.number()]).optional().describe('A percentage off this line, 0 to 99.'),
  product_id: uuid.optional(),
  product_code: z.string().min(1).optional().describe('A catalogue row, by code. It fills in the text, the price, the unit, the account and the tax; anything given on the line wins.'),
  account_id: uuid.optional(),
  account_code: z.string().min(1).optional().describe('The income or expense account, by code. Left out: the product, then the company default, then the one its country model names. A company with none of them refuses the line.'),
  tax_id: uuid.optional(),
  tax_code: z.string().min(1).optional().describe('The tax, by code, e.g. BE-S-21. Left out, the tax of the product. With no product either, the line books a base with no VAT box, which is not the same as 0 %.'),
});

const DOC_TYPES = [
  'sale_invoice',
  'sale_credit_note',
  'sale_quote',
  'purchase_invoice',
  'purchase_credit_note',
  'purchase_order',
] as const;

export const CreateDocumentInput = z.object({
  company_id: companyId,
  doc_type: z.enum(DOC_TYPES),
  contact_id: uuid,
  document_date: isoDate,
  due_date: isoDate.optional(),
  accounting_date: isoDate.optional().describe('The date the entry is booked on, when it differs from the document date.'),
  number: z.string().min(1).optional().describe('Your own number. Left out, posting takes the entry number.'),
  supplier_reference: z.string().min(1).optional().describe("The supplier's own invoice number, on a purchase."),
  currency_code: z.string().length(3).optional(),
  journal_id: uuid.optional(),
  payment_reference: z.string().min(1).optional(),
  lines: z.array(LineInput).min(1),
});

export async function createDocument(
  backend: Backend,
  args: z.infer<typeof CreateDocumentInput>,
): Promise<unknown> {
  const resolved = await resolveLineInputs(backend, args.company_id, args.doc_type, args.lines);
  const currency = args.currency_code ?? (await companyCurrency(backend, args.company_id));

  const document = only(
    await backend.insert<Row>(
      'documents',
      [
        {
          company_id: args.company_id,
          doc_type: args.doc_type,
          contact_id: args.contact_id,
          document_date: args.document_date,
          due_date: args.due_date ?? null,
          accounting_date: args.accounting_date ?? null,
          number: args.number ?? null,
          supplier_reference: args.supplier_reference ?? null,
          currency_code: currency,
          journal_id: args.journal_id ?? null,
          payment_reference: args.payment_reference ?? null,
        },
      ],
      ['id'],
    ),
    'the document could not be created',
  );

  await insertLines(backend, args.company_id, document['id'] as string, resolved);
  return getDocument(backend, { document_id: document['id'] as string });
}

type LineArgs = z.infer<typeof LineInput>;

type DocType = (typeof DOC_TYPES)[number];

/** A line, with every code turned into an id and every gap the product fills. */
interface ResolvedLine {
  product_id: string | null;
  name: string;
  description: string | null;
  unit_code: string;
  unit_price: string;
  quantity: string;
  discount_percent: string;
  account_id: string | null;
  tax_id: string | null;
}

function isSale(docType: DocType): boolean {
  return docType.startsWith('sale_');
}

/**
 * Turns the lines a model wrote into the rows the schema takes.
 *
 * Two things happen here and nowhere else. Codes become ids — one query per
 * table, so twenty lines are three round trips and not sixty. And a product
 * fills in what the line left out: the text, the description, the unit, the
 * price and the tax. Those are *pre-fills*, in the sense an accounting
 * package has always meant: the line is what is invoiced, and everything the
 * caller gave wins over everything the catalogue says.
 *
 * The account is deliberately not resolved here. The database does it, in
 * `resolve_line_account`, because a product line with no account is refused
 * by a check constraint — so a null can only mean "resolve it", and every
 * client has to get the same answer. A null tax is the opposite: it means no
 * tax at all, which is why it is filled from the product only when the line
 * named none.
 */
async function resolveLineInputs(
  backend: Backend,
  company: string,
  docType: DocType,
  lines: LineArgs[],
): Promise<ResolvedLine[]> {
  const [accounts, taxes, products] = await Promise.all([
    idsByCode(
      backend,
      'accounts',
      company,
      lines.map((line) => line.account_code).filter((code): code is string => typeof code === 'string'),
    ),
    idsByCode(
      backend,
      'taxes',
      company,
      lines.map((line) => line.tax_code).filter((code): code is string => typeof code === 'string'),
    ),
    productsFor(backend, company, lines),
  ]);

  const sale = isSale(docType);

  return lines.map((line, index) => {
    const productId =
      line.product_id ?? (line.product_code === undefined ? null : (products.byCode.get(line.product_code)?.['id'] as string));
    const product =
      productId === null || productId === undefined ? undefined : products.byId.get(productId);

    if (productId !== null && productId !== undefined && product === undefined) {
      throw new EkwoMcpError(
        `unknown_product: no product ${productId} in this company. search_products says what exists; a product of another company is invisible here, not merely refused.`,
      );
    }

    const name = line.name ?? (product?.['name'] as string | undefined);
    if (name === undefined) {
      throw new EkwoMcpError(
        `missing_line_name: line ${index + 1} has no name and no product to take one from. A line has to say what is being billed.`,
      );
    }

    const catalogPrice = product?.[sale ? 'sale_price' : 'purchase_price'];
    const unitPrice = line.unit_price ?? (typeof catalogPrice === 'string' ? catalogPrice : undefined);
    if (unitPrice === undefined) {
      throw new EkwoMcpError(
        `missing_unit_price: line ${index + 1} ("${name}") has no price, and ${
          product === undefined
            ? 'no product to take one from'
            : `product ${String(product['code'])} has no ${sale ? 'sale' : 'purchase'} price`
        }.`,
      );
    }

    const productTax = product?.[sale ? 'sale_tax_id' : 'purchase_tax_id'];

    return {
      product_id: productId ?? null,
      name,
      description:
        line.description ?? ((product?.['description'] as string | null | undefined) ?? null),
      unit_code: line.unit_code ?? ((product?.['unit_code'] as string | undefined) ?? 'C62'),
      unit_price: amountIn(unitPrice),
      quantity: amountIn(line.quantity ?? 1),
      discount_percent: amountIn(line.discount_percent ?? 0),
      account_id:
        line.account_id ?? (line.account_code === undefined ? null : (accounts.get(line.account_code) ?? null)),
      tax_id:
        line.tax_id ??
        (line.tax_code === undefined
          ? (typeof productTax === 'string' ? productTax : null)
          : (taxes.get(line.tax_code) ?? null)),
    };
  });
}

/** The products named by a set of lines, by id and by code, in one query each. */
async function productsFor(
  backend: Backend,
  company: string,
  lines: LineArgs[],
): Promise<{ byId: Map<string, Row>; byCode: Map<string, Row> }> {
  const ids = [...new Set(lines.map((line) => line.product_id).filter((id): id is string => typeof id === 'string'))];
  const codes = [
    ...new Set(lines.map((line) => line.product_code).filter((code): code is string => typeof code === 'string')),
  ];
  if (ids.length === 0 && codes.length === 0) return { byId: new Map(), byCode: new Map() };

  const where: Filter[] = [{ column: 'company_id', op: 'eq', value: company }];
  const rows =
    ids.length > 0 && codes.length > 0
      ? [
          ...(await backend.select<Row>({
            table: 'products',
            columns: columns.PRODUCT,
            where: [...where, { column: 'id', op: 'in', value: ids }],
          })),
          ...(await backend.select<Row>({
            table: 'products',
            columns: columns.PRODUCT,
            where: [...where, { column: 'code', op: 'in', value: codes }],
          })),
        ]
      : await backend.select<Row>({
          table: 'products',
          columns: columns.PRODUCT,
          where: [
            ...where,
            ids.length > 0
              ? { column: 'id', op: 'in', value: ids }
              : { column: 'code', op: 'in', value: codes },
          ],
        });

  const byId = new Map(rows.map((row) => [row['id'] as string, row]));
  const byCode = new Map(rows.map((row) => [row['code'] as string, row]));
  for (const code of codes) {
    if (!byCode.has(code)) {
      throw new EkwoMcpError(
        `unknown_product_code: no product "${code}" in this company. search_products says what exists, and create_product adds one.`,
      );
    }
  }
  return { byId, byCode };
}

async function insertLines(
  backend: Backend,
  company: string,
  documentId: string,
  lines: ResolvedLine[],
): Promise<void> {
  const rows: Row[] = lines.map((line, index) => ({
    document_id: documentId,
    company_id: company,
    sequence: (index + 1) * 10,
    line_type: 'product',
    ...line,
  }));
  await backend.insert('document_lines', rows, ['id']);
}

export const UpdateDocumentLinesInput = z.object({
  document_id: uuid,
  lines: z.array(LineInput).min(1).describe('The complete new set of lines; what is there now is replaced.'),
});

export async function updateDocumentLines(
  backend: Backend,
  args: z.infer<typeof UpdateDocumentLinesInput>,
): Promise<unknown> {
  const document = only(
    await backend.select<Row>({
      table: 'documents',
      columns: ['id', 'company_id', 'state', 'doc_type'],
      where: [{ column: 'id', op: 'eq', value: args.document_id }],
    }),
    `document ${args.document_id}`,
  );
  if (document['state'] !== 'draft') {
    throw new EkwoMcpError(
      `document_not_draft: document ${args.document_id} is ${String(document['state'])}. A posted document is not edited; correct it with a credit note.`,
    );
  }

  const company = document['company_id'] as string;
  const resolved = await resolveLineInputs(
    backend,
    company,
    document['doc_type'] as DocType,
    args.lines,
  );

  await backend.remove('document_lines', [{ column: 'document_id', op: 'eq', value: args.document_id }]);
  await insertLines(backend, company, args.document_id, resolved);
  return getDocument(backend, { document_id: args.document_id });
}

export const PostDocumentInput = z.object({ document_id: uuid });

export async function postDocument(
  backend: Backend,
  args: z.infer<typeof PostDocumentInput>,
): Promise<unknown> {
  const entries = await backend.rpc<Row>('post_document', { p_document_id: args.document_id });
  const entry = only(
    moneyFields(entries, ['total_debit', 'total_credit']),
    `document ${args.document_id} produced no entry`,
  );
  const lines = await backend.select<Row>({
    table: 'entry_lines',
    columns: columns.ENTRY_LINE,
    where: [{ column: 'entry_id', op: 'eq', value: entry['id'] as string }],
    order: [{ column: 'sequence' }],
  });
  const accounts = await backend.select<{ id: string; code: string; name: string }>({
    table: 'accounts',
    columns: ['id', 'code', 'name'],
    where: [
      {
        column: 'id',
        op: 'in',
        value: lines.map((line) => line['account_id']).filter((id): id is string => typeof id === 'string'),
      },
    ],
  });
  const byId = new Map(accounts.map((account) => [account.id, account]));

  return {
    entry,
    entry_lines: lines.map((line) => ({ ...line, account: byId.get(line['account_id'] as string) ?? null })),
    note: 'The document is posted and carries the entry number. Nothing here can be unposted; a mistake is corrected with a credit note.',
  };
}

// ---------------------------------------------------------------------------
// Payments and matching
// ---------------------------------------------------------------------------

export const RecordPaymentInput = z.object({
  company_id: companyId,
  direction: z.enum(['inbound', 'outbound']).describe('inbound: a customer paid you. outbound: you paid a supplier.'),
  amount: z.union([z.string(), z.number()]).describe('A positive decimal string; the direction carries the sign.'),
  payment_date: isoDate,
  contact_id: uuid.optional().describe('Who paid or was paid. Needed for the payment to be matched against their invoices.'),
  journal_id: uuid.optional(),
  journal_code: z.string().min(1).optional().describe('The bank or cash journal, by code, e.g. BNK. Not needed when bank_account_id is given: the account knows its journal.'),
  bank_account_id: uuid
    .optional()
    .describe('Which bank account the money moved on. list_bank_accounts says what exists. Given alone, it also names the journal; left out, the default account of the journal is used.'),
  reference: z.string().min(1).optional(),
  memo: z.string().min(1).optional(),
  currency_code: z.string().length(3).optional().describe('Left out: the currency the company keeps its books in.'),
  exchange_rate: z.union([z.string(), z.number()]).optional().describe('Units of the payment currency for one unit of the company currency, as a rate table states it. Only needed when the payment is in another currency; the realised difference against the invoice is booked at matching.'),
  match_open_items: z.boolean().optional().describe('Default true: match the payment against the oldest open invoices of that contact, up to the amount paid.'),
});

export async function recordPayment(
  backend: Backend,
  args: z.infer<typeof RecordPaymentInput>,
): Promise<unknown> {
  let journalId = args.journal_id;
  if (journalId === undefined && args.journal_code !== undefined) {
    journalId = (await idsByCode(backend, 'journals', args.company_id, [args.journal_code])).get(
      args.journal_code,
    ) as string;
  }
  if (journalId === undefined && args.bank_account_id !== undefined) {
    // A bank account knows the journal it moves through; asking the caller
    // to repeat it was the first thing the real test tripped over.
    const account = await backend.select<{ journal_id: string | null }>({
      table: 'bank_accounts',
      columns: ['journal_id'],
      where: [
        { column: 'id', op: 'eq', value: args.bank_account_id },
        { column: 'company_id', op: 'eq', value: args.company_id },
      ],
    });
    journalId = account[0]?.journal_id ?? undefined;
  }
  if (journalId === undefined) {
    throw new EkwoMcpError(
      'missing_journal: a payment needs the bank or cash book it goes through — give bank_account_id (list_bank_accounts), or journal_id / journal_code (get_company lists the journals).',
    );
  }

  const payment = only(
    await backend.insert<Row>(
      'payments',
      [
        {
          company_id: args.company_id,
          direction: args.direction,
          payment_date: args.payment_date,
          amount: amountIn(args.amount),
          // Never a literal, for the reason `create_document` gives: a company
          // that keeps its books in another currency would get a euro payment
          // out of a euro written here.
          currency_code:
            args.currency_code ?? (await companyCurrency(backend, args.company_id)),
          exchange_rate: args.exchange_rate === undefined ? 1 : String(args.exchange_rate),
          contact_id: args.contact_id ?? null,
          journal_id: journalId,
          bank_account_id: args.bank_account_id ?? null,
          reference: args.reference ?? null,
          memo: args.memo ?? null,
        },
      ],
      ['id'],
    ),
    'the payment could not be created',
  );

  const entry = only(
    moneyFields(await backend.rpc<Row>('post_payment', { p_payment_id: payment['id'] as string }), [
      'total_debit',
      'total_credit',
    ]),
    'the payment produced no entry',
  );

  const lines = await backend.select<Row>({
    table: 'entry_lines',
    columns: columns.ENTRY_LINE,
    where: [{ column: 'entry_id', op: 'eq', value: entry['id'] as string }],
    order: [{ column: 'sequence' }],
  });

  const matched =
    args.match_open_items === false || args.contact_id === undefined
      ? []
      : await matchOpenItems(backend, args.company_id, args.contact_id, lines);

  const settled = await backend.select<Row>({
    table: 'payments',
    columns: columns.PAYMENT,
    where: [{ column: 'id', op: 'eq', value: payment['id'] as string }],
  });

  return {
    payment: settled[0] ?? null,
    entry,
    entry_lines: lines,
    matched,
    note:
      args.contact_id === undefined
        ? 'No contact was given, so the payment landed on the company default third-party account and nothing was matched.'
        : 'Matching is what makes a document paid: documents.amount_paid is derived from it.',
  };
}

/**
 * Matches the payment against the open items of a contact, oldest first.
 *
 * Only lines on the same third-party account, on the other side, still
 * carrying a residual. Each pairing is a call to `reconcile`, which is what
 * draws the letter and keeps the residual honest; this function decides
 * nothing about amounts beyond "the smaller of what is left on either side".
 */
async function matchOpenItems(
  backend: Backend,
  company: string,
  contact: string,
  paymentLines: Row[],
): Promise<unknown[]> {
  const accounts = await backend.select<{ id: string; reconcilable: boolean }>({
    table: 'accounts',
    columns: ['id', 'reconcilable'],
    where: [
      {
        column: 'id',
        op: 'in',
        value: paymentLines
          .map((line) => line['account_id'])
          .filter((id): id is string => typeof id === 'string'),
      },
    ],
  });
  const reconcilable = new Set(accounts.filter((account) => account.reconcilable).map((a) => a.id));
  const paymentLine = paymentLines.find(
    (line) => typeof line['account_id'] === 'string' && reconcilable.has(line['account_id']),
  );
  if (paymentLine === undefined) return [];

  const accountId = paymentLine['account_id'] as string;
  const paymentIsDebit = Number(paymentLine['debit'] ?? 0) > 0;

  const candidates = await backend.select<Row>({
    table: 'entry_lines',
    columns: [...columns.ENTRY_LINE, 'company_id'],
    where: [
      { column: 'company_id', op: 'eq', value: company },
      { column: 'contact_id', op: 'eq', value: contact },
      { column: 'account_id', op: 'eq', value: accountId },
    ] satisfies Filter[],
    limit: 500,
  });

  const entryIds = [...new Set(candidates.map((line) => line['entry_id'] as string))];
  const entries = await backend.select<{ id: string; state: string; entry_date: string }>({
    table: 'entries',
    columns: ['id', 'state', 'entry_date::text'],
    where: [{ column: 'id', op: 'in', value: entryIds }],
  });
  const posted = new Map(entries.filter((entry) => entry.state === 'posted').map((e) => [e.id, e]));

  // Which scale the allocation is worked out on. `reconcile` matches two
  // lines in the same foreign currency in *that* currency, because that is
  // where they are equal, and reads `p_amount` the same way. So when the
  // payment is foreign the amounts below are its currency's, and a candidate
  // in another currency is left alone rather than matched at the wrong scale.
  const home = await companyCurrency(backend, company);
  const currency = paymentLine['currency_code'] as string | null;
  const foreign =
    currency !== null && currency !== home && paymentLine['amount_currency'] !== null;

  /** What is still open on a line, on the scale the matching uses. */
  const openOf = (line: Row): number => {
    const ledger = Math.abs(Number(line['balance'] ?? 0));
    const left = ledger - Number(line['matched_amount'] ?? 0);
    if (!foreign) return left;
    const inCurrency = Math.abs(Number(line['amount_currency'] ?? 0));
    return ledger === 0 ? 0 : Math.round((inCurrency * left * 100) / ledger) / 100;
  };

  const open = candidates
    .filter((line) => line['id'] !== paymentLine['id'])
    .filter((line) => posted.has(line['entry_id'] as string))
    .filter((line) => (Number(line['debit'] ?? 0) > 0) !== paymentIsDebit)
    .filter((line) => !foreign || line['currency_code'] === currency)
    .map((line) => ({
      line,
      residual: openOf(line),
      due: String(line['date_maturity'] ?? posted.get(line['entry_id'] as string)?.entry_date ?? ''),
    }))
    .filter((item) => item.residual > 0.005)
    .sort((a, b) => a.due.localeCompare(b.due));

  let remaining = openOf(paymentLine);
  const done: unknown[] = [];

  for (const item of open) {
    if (remaining <= 0.005) break;
    const amount = Math.min(remaining, item.residual).toFixed(2);
    const reconciliation = moneyFields(
      await backend.rpc<Row>('reconcile', {
        p_line_a: paymentLine['id'],
        p_line_b: item.line['id'],
        p_amount: amount,
      }),
      ['amount'],
    );
    done.push(reconciliation[0] ?? null);
    remaining -= Number(amount);
  }

  return done;
}

export const ReconcileInput = z.object({
  line_a: uuid.describe('A ledger line to match. Either side; the schema works out which is the debit.'),
  line_b: uuid.describe('The line it settles. Both must be on the same reconcilable account.'),
  amount: z.union([z.string(), z.number()]).optional().describe('Left out: the smaller of the two open amounts.'),
});

export async function reconcile(
  backend: Backend,
  args: z.infer<typeof ReconcileInput>,
): Promise<unknown> {
  const rows = moneyFields(
    await backend.rpc<Row>('reconcile', {
      p_line_a: args.line_a,
      p_line_b: args.line_b,
      p_amount: args.amount === undefined ? null : amountIn(args.amount),
    }),
    ['amount'],
  );
  return { reconciliation: rows[0] ?? null };
}

export const UnreconcileInput = z.object({
  reconciliation_id: uuid.describe('The matching to undo, as returned by reconcile or read from the ledger line.'),
});

export async function unreconcile(
  backend: Backend,
  args: z.infer<typeof UnreconcileInput>,
): Promise<unknown> {
  await backend.rpcVoid('unreconcile', { p_reconciliation_id: args.reconciliation_id });
  return {
    unreconciled: args.reconciliation_id,
    note: 'The matching is undone. The entries themselves are untouched: matching changes no account.',
  };
}

// ---------------------------------------------------------------------------
// Bank
// ---------------------------------------------------------------------------

export const CreateBankAccountInput = z.object({
  company_id: companyId,
  iban: z.string().min(5).describe('The IBAN. Spaces are removed and the value is upper-cased; it is the natural key of a bank account in a company.'),
  label: z.string().min(1).optional().describe('What it is called in the books. Defaults to the bank name, then to the IBAN.'),
  bic: z.string().min(1).optional(),
  bank_name: z.string().min(1).optional(),
  currency_code: z.string().length(3).optional().describe("Defaults to the company's own currency."),
  journal_id: uuid.optional(),
  journal_code: z.string().min(1).optional().describe('The financial journal it books through. Left out, the bank journal of the company.'),
  account_id: uuid.optional(),
  account_code: z.string().min(1).optional().describe("The ledger account behind it. Left out, the journal's default account — 550000 in Belgium, 512000 in France."),
});

/**
 * A bank account, wired to a journal and to a ledger account.
 *
 * Both of those have an answer already: `install_country_template` points the
 * bank journal at the country's bank account, so neither has to be asked for.
 * What nobody can derive is the IBAN, which is why this tool exists at all —
 * an installation with no bank account has no IBAN to put on an invoice and
 * nothing to reconcile a statement against.
 */
export async function createBankAccount(
  backend: Backend,
  args: z.infer<typeof CreateBankAccountInput>,
): Promise<unknown> {
  const iban = args.iban.replace(/\s+/g, '').toUpperCase();

  let journalId = args.journal_id;
  if (journalId === undefined && args.journal_code !== undefined) {
    journalId = (await idsByCode(backend, 'journals', args.company_id, [args.journal_code])).get(
      args.journal_code,
    ) as string;
  }

  const journals = await backend.select<Row>({
    table: 'journals',
    columns: ['id', 'code', 'name', 'journal_type', 'default_account_id', 'bank_account_id'],
    where: [
      { column: 'company_id', op: 'eq', value: args.company_id },
      ...(journalId === undefined
        ? ([{ column: 'journal_type', op: 'eq', value: 'bank' }] satisfies Filter[])
        : ([{ column: 'id', op: 'eq', value: journalId }] satisfies Filter[])),
    ],
    order: [{ column: 'code' }],
  });
  const journal = journals[0];
  if (journal === undefined) {
    throw new EkwoMcpError(
      journalId === undefined
        ? 'no_bank_journal: this company has no journal of type bank. get_company lists the journals; install_country_template creates them.'
        : `not_found: journal ${String(journalId)}. Either it does not exist, or your role on that company does not allow this.`,
    );
  }

  let accountId = args.account_id;
  if (accountId === undefined && args.account_code !== undefined) {
    accountId = (await idsByCode(backend, 'accounts', args.company_id, [args.account_code])).get(
      args.account_code,
    ) as string;
  }
  accountId = accountId ?? (journal['default_account_id'] as string | null) ?? undefined;
  if (accountId === undefined) {
    throw new EkwoMcpError(
      `no_bank_ledger_account: journal ${String(journal['code'])} has no default account, so this bank account would book nowhere. Give account_code, or set the journal's default account.`,
    );
  }

  const existing = await backend.select<Row>({
    table: 'bank_accounts',
    columns: columns.BANK_ACCOUNT,
    where: [
      { column: 'company_id', op: 'eq', value: args.company_id },
      { column: 'iban', op: 'eq', value: iban },
    ],
  });
  if (existing[0] !== undefined) {
    return {
      bank_account: existing[0],
      created: false,
      note: 'A bank account with this IBAN was already there; nothing was created.',
    };
  }

  const currency = args.currency_code ?? (await companyCurrency(backend, args.company_id));

  const created = only(
    await backend.insert<Row>(
      'bank_accounts',
      [
        {
          company_id: args.company_id,
          name: args.label ?? args.bank_name ?? iban,
          iban,
          bic: args.bic ?? null,
          bank_name: args.bank_name ?? null,
          currency_code: currency,
          account_id: accountId,
          journal_id: journal['id'],
        },
      ],
      columns.BANK_ACCOUNT,
    ),
    'the bank account could not be created',
  );

  // The journal points back, so `post_payment` finds the money side from
  // either direction. A journal that already names one keeps it.
  if (journal['bank_account_id'] === null) {
    await backend.update(
      'journals',
      { bank_account_id: created['id'] },
      [{ column: 'id', op: 'eq', value: journal['id'] as string }],
      ['id'],
    );
  }

  return {
    bank_account: created,
    created: true,
    journal: { id: journal['id'], code: journal['code'], name: journal['name'] },
    note: 'Payments through this journal now book against this account. record_payment takes its id as bank_account_id.',
  };
}

export const CreateBankTransactionInput = z.object({
  company_id: companyId,
  bank_account_id: uuid,
  transaction_date: isoDate,
  amount: z.union([z.string(), z.number()]).describe('Signed: positive is money in, negative is money out.'),
  description: z.string().min(1).optional(),
  counterpart_name: z.string().min(1).optional(),
  counterpart_iban: z.string().min(1).optional(),
  reference: z.string().min(1).optional(),
  structured_reference: z.string().min(1).optional().describe('A structured communication, e.g. +++000/0000/00000+++ or RF…'),
  statement_id: uuid.optional(),
  contact_id: uuid.optional(),
  value_date: isoDate.optional(),
});

export async function createBankTransaction(
  backend: Backend,
  args: z.infer<typeof CreateBankTransactionInput>,
): Promise<unknown> {
  const created = only(
    await backend.insert<Row>(
      'bank_transactions',
      [
        {
          company_id: args.company_id,
          bank_account_id: args.bank_account_id,
          statement_id: args.statement_id ?? null,
          transaction_date: args.transaction_date,
          value_date: args.value_date ?? null,
          amount: amountIn(args.amount),
          description: args.description ?? null,
          counterpart_name: args.counterpart_name ?? null,
          counterpart_iban: args.counterpart_iban ?? null,
          reference: args.reference ?? null,
          structured_reference: args.structured_reference ?? null,
          contact_id: args.contact_id ?? null,
        },
      ],
      columns.BANK_TRANSACTION,
    ),
    'the bank transaction could not be created',
  );
  return {
    transaction: created,
    note: 'A statement line is not an entry. It waits as `pending` until a payment is recorded against it.',
  };
}

// ---------------------------------------------------------------------------
// Locks
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// The company itself
// ---------------------------------------------------------------------------

export const CreateCompanyInput = z.object({
  name: z.string().min(1),
  country: z
    .string()
    .length(2)
    .describe('Which country pack: its chart of accounts, its taxes and its declaration form. list_companies shows what the installation already uses.'),
  currency_code: z.string().length(3).optional().describe("Left out, the country pack's."),
  language: z
    .string()
    .length(2)
    .optional()
    .describe("Language the books are kept in — it decides the labels of the chart. Left out, the country pack's."),
  chart_code: z.string().optional().describe('Which chart, where the country offers several.'),
  fiscal_year: z.number().int().min(1900).max(2200).optional().describe('Calendar year the first financial year opens in. Default this year.'),
  fiscal_year_start: isoDate
    .optional()
    .describe('First day of it. Left out, the month the country pack opens a year on — and a pack that names none is a refusal, not a January.'),
});

export async function createCompany(
  backend: Backend,
  args: z.infer<typeof CreateCompanyInput>,
): Promise<unknown> {
  const company = only(
    await backend.rpc<Row>('create_company', {
      p_name: args.name,
      p_country: args.country.toUpperCase(),
      p_currency_code: args.currency_code?.toUpperCase() ?? null,
      p_language: args.language?.toLowerCase() ?? null,
      p_chart_code: args.chart_code ?? null,
      p_fiscal_year: args.fiscal_year ?? null,
      p_fiscal_year_start: args.fiscal_year_start ?? null,
    }),
    'the company could not be created. Creating one is an instance-level act: it needs an instance administrator',
  );

  const years = await backend.select<Row>({
    table: 'fiscal_years',
    columns: columns.FISCAL_YEAR,
    where: [{ column: 'company_id', op: 'eq', value: company['id'] as string }],
    order: [{ column: 'start_date' }],
  });

  return {
    company,
    fiscal_years: years,
    note: 'The chart of accounts, the journals and the taxes of the country pack have been copied into it, and you are its first member.',
  };
}

export const UpdateCompanyProfileInput = z.object({
  company_id: companyId,
  name: z.string().min(1).optional(),
  trade_name: z.string().nullable().optional().describe('The name it trades under, if not the statutory one.'),
  legal_name: z.string().nullable().optional(),
  legal_form: z.string().nullable().optional(),
  vat_number: z.string().nullable().optional(),
  registration_number: z
    .string()
    .nullable()
    .optional()
    .describe('The number of the commercial register of its country. There is no second column for it.'),
  address_line1: z.string().nullable().optional(),
  address_line2: z.string().nullable().optional(),
  postal_code: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  website: z.string().nullable().optional(),
  logo_url: z
    .string()
    .nullable()
    .optional()
    .describe('Where the logo is. A URL or a storage path: the core keeps no file.'),
  share_capital: z
    .string()
    .nullable()
    .optional()
    .describe('A decimal string. Several legal forms must state it on every document.'),
  share_capital_currency: z
    .string()
    .length(3)
    .nullable()
    .optional()
    .describe("Left out, the company's own currency."),
  activity_code: z.string().nullable().optional().describe('NACE, APE, SIC — the code itself.'),
  activity_scheme: z.string().nullable().optional().describe('Which register the code belongs to.'),
  default_bank_account_id: uuid
    .nullable()
    .optional()
    .describe('Fills the payee IBAN of a sales document that names none. list_bank_accounts says what exists.'),
  document_template: z.string().nullable().optional().describe('A code the renderer interprets.'),
});

export async function updateCompanyProfile(
  backend: Backend,
  args: z.infer<typeof UpdateCompanyProfileInput>,
): Promise<unknown> {
  const { company_id, ...rest } = args;
  const patch: Row = {};
  for (const [key, value] of Object.entries(rest)) {
    if (value !== undefined) patch[key] = value;
  }
  if (Object.keys(patch).length === 0) {
    throw new EkwoMcpError('nothing_to_change: name at least one field of the profile to change.');
  }

  const updated = only(
    await backend.update<Row>(
      'companies',
      patch,
      [{ column: 'id', op: 'eq', value: company_id }],
      columns.COMPANY,
    ),
    'the company could not be changed. Changing the company itself needs company.write, which the owner preset holds',
  );
  return { company: updated };
}

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

export const SetPreferencesInput = z.object({
  preferred_company_id: uuid.nullable().optional().describe('The company to open on.'),
  language: z
    .string()
    .nullable()
    .optional()
    .describe('Two letters, optionally a region. Labels are read in it first.'),
  timezone: z.string().nullable().optional().describe('An IANA name.'),
  date_display_format: z.string().nullable().optional().describe('How this person likes a date written.'),
  number_display_format: z
    .string()
    .nullable()
    .optional()
    .describe('How this person likes a number written. Not the pattern a document number is built from, which belongs to the country.'),
  theme: z.string().nullable().optional(),
});

export async function setPreferences(
  backend: Backend,
  args: z.infer<typeof SetPreferencesInput>,
): Promise<unknown> {
  // Only what the caller actually named crosses: an absent key leaves the
  // preference alone and an explicit null clears it, which is a distinction
  // the schema makes and this tool must not flatten.
  const patch: Row = {};
  for (const [key, value] of Object.entries(args)) {
    if (value !== undefined) patch[key] = value;
  }
  const saved = only(
    await backend.rpc<Row>('set_preferences', { p_patch: patch }),
    'the preferences could not be saved',
  );
  return { preferences: saved };
}

export const InviteMemberInput = z.object({
  company_id: companyId,
  email: z.string().min(3).describe('The address the invitation is for. Matched when it is accepted.'),
  role: z
    .enum(['owner', 'accountant', 'viewer'])
    .optional()
    .describe('The preset. Default viewer, which reads and changes nothing.'),
  capabilities: z
    .array(z.string())
    .optional()
    .describe('Capability codes granted on top of the preset, e.g. members.manage. get_company lists what this installation knows.'),
  valid_for_days: z.number().int().min(1).max(365).optional().describe('Default 14.'),
});

export async function inviteMember(
  backend: Backend,
  args: z.infer<typeof InviteMemberInput>,
): Promise<unknown> {
  const answer = only(
    await backend.rpc<Row>('invite_member', {
      p_company_id: args.company_id,
      p_email: args.email,
      p_role: args.role ?? 'viewer',
      p_capabilities: args.capabilities ?? [],
      p_valid_for: `${args.valid_for_days ?? 14} days`,
    }),
    'the invitation could not be issued',
  );
  return {
    invitation: answer,
    note: 'The token is in this answer and nowhere else — only its hash is stored. Give it to the person you invited; they accept it signed in with the address above.',
  };
}

export const CreateApiKeyInput = z.object({
  company_id: companyId,
  name: z.string().min(1).describe('What this key is for, in the words an operator will read a year from now.'),
  capabilities: z
    .array(z.string())
    .min(1)
    .describe('Exactly what the machine may do, e.g. ["bank.write"]. You cannot put a capability on a key that you do not hold yourself.'),
  expires_at: z
    .string()
    .nullable()
    .optional()
    .describe('When it stops working, as a timestamp. Left out, it does not expire on its own.'),
});

export async function createApiKey(
  backend: Backend,
  args: z.infer<typeof CreateApiKeyInput>,
): Promise<unknown> {
  const created = only(
    await backend.rpc<Row>('create_api_key', {
      p_company_id: args.company_id,
      p_name: args.name,
      p_capabilities: args.capabilities,
      p_expires_at: args.expires_at ?? null,
    }),
    'the key could not be issued',
  );
  return {
    api_key: created,
    note: 'The secret is in this answer and nowhere else — only its hash is stored. Show it to the user once, and tell them it cannot be read back.',
  };
}

export const RevokeApiKeyInput = z.object({
  api_key_id: uuid,
});

export async function revokeApiKey(
  backend: Backend,
  args: z.infer<typeof RevokeApiKeyInput>,
): Promise<unknown> {
  const revoked = only(
    await backend.rpc<Row>('revoke_api_key', { p_api_key_id: args.api_key_id }),
    'the key could not be withdrawn',
  );
  return { api_key: revoked };
}

export const RevokeInvitationInput = z.object({
  invitation_id: uuid,
});

export async function revokeInvitation(
  backend: Backend,
  args: z.infer<typeof RevokeInvitationInput>,
): Promise<unknown> {
  const answer = only(
    await backend.rpc<Row>('revoke_invitation', { p_invitation_id: args.invitation_id }),
    'the invitation could not be withdrawn',
  );
  return { invitation: answer };
}

export const LockPeriodInput = z.object({
  company_id: companyId,
  lock_date: isoDate.nullable().optional().describe('Nothing may be booked on or before this date. null lifts the lock.'),
  tax_lock_date: isoDate.nullable().optional().describe('Additionally freezes anything carrying a VAT box. null lifts it.'),
});

export async function lockPeriod(
  backend: Backend,
  args: z.infer<typeof LockPeriodInput>,
): Promise<unknown> {
  const patch: Row = {};
  if (args.lock_date !== undefined) patch['lock_date'] = args.lock_date;
  if (args.tax_lock_date !== undefined) patch['tax_lock_date'] = args.tax_lock_date;
  if (Object.keys(patch).length === 0) {
    throw new EkwoMcpError('nothing_to_lock: give lock_date, tax_lock_date, or both.');
  }

  const rows = await backend.update<Row>(
    'companies',
    patch,
    [{ column: 'id', op: 'eq', value: args.company_id }],
    ['id', 'name', 'lock_date::text', 'tax_lock_date::text'],
  );
  const company = rows[0];
  if (company === undefined) {
    throw new EkwoMcpError(
      'not_owner: only an owner of the company may move its lock dates, and nothing was changed.',
    );
  }
  return {
    company,
    note: 'Locking is enforced by triggers on the ledger, not by this server. Everything on or before the date now refuses to move.',
  };
}

// ---------------------------------------------------------------------------
// Opening a set of books, and closing a year
//
// All three go straight to the schema function. The rules about which account
// the result travels through, which entries are written and when a year may
// be closed live in `close_fiscal_year`, next to the ones about balance and
// locks, and this server does not repeat a word of them.
// ---------------------------------------------------------------------------

export const OpeningBalanceInput = z.object({
  company_id: companyId,
  fiscal_year_id: uuid.describe('The year the balance opens. The entry is dated on its first day.'),
  lines: z
    .array(
      z.object({
        account_code: z.string().min(1).describe('Code in this company\'s chart. list_accounts says what exists; the codes are the pack\'s, not ours.'),
        debit: z.union([z.string(), z.number()]).optional().describe('A positive decimal string. A line carries a debit or a credit, never both.'),
        credit: z.union([z.string(), z.number()]).optional(),
        contact_id: uuid.optional().describe('The customer or supplier behind a receivable or payable line, so the aged balance knows whose it is.'),
        label: z.string().min(1).optional(),
      }),
    )
    .min(1)
    .describe('The trial balance of the previous system, one entry per row. Total debit must equal total credit.'),
  allow_result_accounts: z
    .boolean()
    .optional()
    .describe('Default false: an opening balance is made of the balance sheet. Pass true only when taking books over in the middle of a year that has already run.'),
});

export async function openingBalance(
  backend: Backend,
  args: z.infer<typeof OpeningBalanceInput>,
): Promise<unknown> {
  const lines = args.lines.map((line) => ({
    account_code: line.account_code,
    debit: amountIn(line.debit ?? 0),
    credit: amountIn(line.credit ?? 0),
    ...(line.contact_id === undefined ? {} : { contact_id: line.contact_id }),
    ...(line.label === undefined ? {} : { label: line.label }),
  }));

  const answer = await backend.rpc<string>('opening_balance', {
    p_company_id: args.company_id,
    p_fiscal_year_id: args.fiscal_year_id,
    p_lines: lines,
    p_allow_result_accounts: args.allow_result_accounts ?? false,
  });
  const entryId = only(answer, 'the opening balance produced no entry');

  const entries = await backend.select<Row>({
    table: 'entries',
    columns: ['id', 'number', 'entry_date::text', 'description', 'state', 'kind', 'total_debit::text', 'total_credit::text'],
    where: [{ column: 'id', op: 'eq', value: entryId }],
  });
  return {
    entry: only(entries, `entry ${entryId}`),
    note: 'The opening entry is posted. A year holds one; a second call is refused rather than adding to it.',
  };
}

export const CloseFiscalYearInput = z.object({
  fiscal_year_id: uuid.describe('The year to close. Every entry in it must be posted.'),
});

export async function closeFiscalYear(
  backend: Backend,
  args: z.infer<typeof CloseFiscalYearInput>,
): Promise<unknown> {
  const answer = await backend.rpc<Row>('close_fiscal_year', {
    p_fiscal_year_id: args.fiscal_year_id,
  });
  return {
    close: only(answer, `fiscal year ${args.fiscal_year_id}`),
    note: 'The income statement is back at zero and the year refuses new entries. What a general meeting decides to do with the result — a dividend, a reserve — is a later entry, and the close never writes it.',
  };
}

export const ReopenFiscalYearInput = z.object({
  fiscal_year_id: uuid.describe('The closed year to open again.'),
});

export async function reopenFiscalYear(
  backend: Backend,
  args: z.infer<typeof ReopenFiscalYearInput>,
): Promise<unknown> {
  const answer = await backend.rpc<Row>('reopen_fiscal_year', {
    p_fiscal_year_id: args.fiscal_year_id,
  });
  return {
    reopen: only(answer, `fiscal year ${args.fiscal_year_id}`),
    note: 'The entries the close wrote are reversed, not deleted, and the year accepts entries again. Refused once a later year is closed or holds entries of its own.',
  };
}
