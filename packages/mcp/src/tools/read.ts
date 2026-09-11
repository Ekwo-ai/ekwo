/**
 * The reading half.
 *
 * Every one of these is a query the signed-in user could have run themselves;
 * nothing here widens what they may see. The reports come from the schema's
 * own functions — `trial_balance`, `general_ledger`, `aged_balance`,
 * `vat_return`, `fec_lines` — rather than from sums computed here, because a
 * second implementation of a balance is a second answer to the same question.
 */

import {
  checkFec,
  fecFileName,
  fromQueryRow,
  generateFec as renderFec,
  type FecQueryRow,
} from '@ekwo-ai/core';
import { z } from 'zod';
import { EkwoMcpError, type Backend, type Filter, type Row } from '../backend.js';
import * as columns from '../columns.js';
import { money, moneyFields } from '../format.js';

export const uuid = z.string().uuid();
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'a calendar date, as YYYY-MM-DD');

export const companyId = uuid.describe('The company to work in. Ask list_companies if unsure.');

/** The row, or a refusal that says what was not visible rather than crashing. */
function only<T>(rows: T[], what: string): T {
  const row = rows[0];
  if (row === undefined) {
    throw new EkwoMcpError(
      `not_found: ${what}. Either it does not exist or you are not a member of the company that holds it.`,
    );
  }
  return row;
}

/** `{ id: name }` for a set of rows, to put names next to foreign keys. */
async function namesOf(
  backend: Backend,
  table: string,
  ids: (string | null | undefined)[],
): Promise<Record<string, string>> {
  const wanted = [...new Set(ids.filter((id): id is string => typeof id === 'string'))];
  if (wanted.length === 0) return {};
  const rows = await backend.select<{ id: string; name: string }>({
    table,
    columns: ['id', 'name'],
    where: [{ column: 'id', op: 'in', value: wanted }],
  });
  return Object.fromEntries(rows.map((row) => [row.id, row.name]));
}

// ---------------------------------------------------------------------------
// Companies and their settings
// ---------------------------------------------------------------------------

export const ListCompaniesInput = z.object({});

export async function listCompanies(backend: Backend): Promise<unknown> {
  const companies = await backend.select<Row>({
    table: 'companies',
    columns: ['id', 'name', 'country', 'fiscal_country', 'vat_number', 'currency_code'],
    order: [{ column: 'name' }],
  });
  const roles = await backend.select<{ company_id: string; role: string }>({
    table: 'company_members',
    columns: ['company_id', 'role'],
  });
  const mine = new Map(roles.map((row) => [row.company_id, row.role]));
  return {
    companies: companies.map((company) => ({
      ...company,
      your_role: mine.get(company['id'] as string) ?? null,
    })),
  };
}

export const GetCompanyInput = z.object({ company_id: companyId });

export async function getCompany(
  backend: Backend,
  args: z.infer<typeof GetCompanyInput>,
): Promise<unknown> {
  const company = only(
    await backend.select<Row>({
      table: 'companies',
      columns: columns.COMPANY,
      where: [{ column: 'id', op: 'eq', value: args.company_id }],
    }),
    `company ${args.company_id}`,
  );

  const [years, journals, accounts] = await Promise.all([
    backend.select<Row>({
      table: 'fiscal_years',
      columns: columns.FISCAL_YEAR,
      where: [{ column: 'company_id', op: 'eq', value: args.company_id }],
      order: [{ column: 'start_date' }],
    }),
    backend.select<Row>({
      table: 'journals',
      columns: columns.JOURNAL,
      where: [{ column: 'company_id', op: 'eq', value: args.company_id }],
      order: [{ column: 'code' }],
    }),
    backend.select<{ id: string; code: string; name: string }>({
      table: 'accounts',
      columns: ['id', 'code', 'name'],
      where: [
        {
          column: 'id',
          op: 'in',
          value: [
            company['receivable_account_id'],
            company['payable_account_id'],
            company['suspense_account_id'],
            company['retained_earnings_account_id'],
          ].filter((id): id is string => typeof id === 'string'),
        },
      ],
    }),
  ]);

  const byId = new Map(accounts.map((account) => [account.id, account]));
  const named = (key: string): unknown => {
    const id = company[key];
    return typeof id === 'string' ? (byId.get(id) ?? { id }) : null;
  };

  return {
    company,
    locks: {
      lock_date: company['lock_date'],
      tax_lock_date: company['tax_lock_date'],
      note: 'Nothing may be booked on or before lock_date; tax_lock_date additionally freezes anything carrying a VAT box.',
    },
    default_accounts: {
      receivable: named('receivable_account_id'),
      payable: named('payable_account_id'),
      suspense: named('suspense_account_id'),
      retained_earnings: named('retained_earnings_account_id'),
    },
    fiscal_years: years,
    journals,
  };
}

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------

export const ListAccountsInput = z.object({
  company_id: companyId,
  code_prefix: z.string().min(1).optional().describe('Only accounts whose code starts with this, e.g. "70".'),
  account_type: z.string().min(1).optional().describe('One of the eighteen account types, e.g. asset_receivable.'),
  search: z.string().min(1).optional().describe('Case-insensitive match on the account name.'),
  include_deprecated: z.boolean().optional(),
  limit: z.number().int().min(1).max(2000).optional(),
});

export async function listAccounts(
  backend: Backend,
  args: z.infer<typeof ListAccountsInput>,
): Promise<unknown> {
  const where: Filter[] = [{ column: 'company_id', op: 'eq', value: args.company_id }];
  if (args.code_prefix !== undefined) where.push({ column: 'code', op: 'ilike', value: `${args.code_prefix}%` });
  if (args.account_type !== undefined) where.push({ column: 'account_type', op: 'eq', value: args.account_type });
  if (args.search !== undefined) where.push({ column: 'name', op: 'ilike', value: `%${args.search}%` });
  if (args.include_deprecated !== true) where.push({ column: 'deprecated', op: 'eq', value: false });

  const accounts = await backend.select<Row>({
    table: 'accounts',
    columns: columns.ACCOUNT,
    where,
    order: [{ column: 'code' }],
    limit: args.limit ?? 200,
  });
  return { accounts, count: accounts.length };
}

export const SearchContactsInput = z.object({
  company_id: companyId,
  query: z.string().min(1).optional().describe('Case-insensitive match on the contact name.'),
  contact_type: z.enum(['customer', 'supplier', 'both', 'employee', 'other']).optional(),
  vat_number: z.string().min(1).optional().describe('Exact match, e.g. BE0123456749.'),
  limit: z.number().int().min(1).max(200).optional(),
});

export async function searchContacts(
  backend: Backend,
  args: z.infer<typeof SearchContactsInput>,
): Promise<unknown> {
  const where: Filter[] = [{ column: 'company_id', op: 'eq', value: args.company_id }];
  if (args.query !== undefined) where.push({ column: 'name', op: 'ilike', value: `%${args.query}%` });
  if (args.contact_type !== undefined) where.push({ column: 'contact_type', op: 'eq', value: args.contact_type });
  if (args.vat_number !== undefined) where.push({ column: 'vat_number', op: 'eq', value: args.vat_number });

  const contacts = await backend.select<Row>({
    table: 'contacts',
    columns: columns.CONTACT,
    where,
    order: [{ column: 'name' }],
    limit: args.limit ?? 50,
  });
  return { contacts, count: contacts.length };
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

const DOC_TYPES = [
  'sale_invoice',
  'sale_credit_note',
  'sale_quote',
  'purchase_invoice',
  'purchase_credit_note',
  'purchase_order',
] as const;

export const ListDocumentsInput = z.object({
  company_id: companyId,
  doc_type: z.enum(DOC_TYPES).optional(),
  state: z.enum(['draft', 'posted', 'cancelled']).optional(),
  payment_state: z.enum(['not_paid', 'partially_paid', 'paid', 'overpaid', 'reversed']).optional(),
  contact_id: uuid.optional(),
  from: isoDate.optional().describe('Earliest document date.'),
  to: isoDate.optional().describe('Latest document date.'),
  limit: z.number().int().min(1).max(200).optional(),
});

export async function listDocuments(
  backend: Backend,
  args: z.infer<typeof ListDocumentsInput>,
): Promise<unknown> {
  const where: Filter[] = [{ column: 'company_id', op: 'eq', value: args.company_id }];
  if (args.doc_type !== undefined) where.push({ column: 'doc_type', op: 'eq', value: args.doc_type });
  if (args.state !== undefined) where.push({ column: 'state', op: 'eq', value: args.state });
  if (args.payment_state !== undefined) where.push({ column: 'payment_state', op: 'eq', value: args.payment_state });
  if (args.contact_id !== undefined) where.push({ column: 'contact_id', op: 'eq', value: args.contact_id });
  if (args.from !== undefined) where.push({ column: 'document_date', op: 'gte', value: args.from });
  if (args.to !== undefined) where.push({ column: 'document_date', op: 'lte', value: args.to });

  const documents = await backend.select<Row>({
    table: 'documents',
    columns: columns.DOCUMENT,
    where,
    order: [{ column: 'document_date', ascending: false }],
    limit: args.limit ?? 50,
  });
  const names = await namesOf(backend, 'contacts', documents.map((doc) => doc['contact_id'] as string));

  return {
    documents: documents.map((doc) => ({
      ...doc,
      contact_name: names[doc['contact_id'] as string] ?? null,
    })),
    count: documents.length,
  };
}

export const GetDocumentInput = z.object({ document_id: uuid });

export async function getDocument(
  backend: Backend,
  args: z.infer<typeof GetDocumentInput>,
): Promise<unknown> {
  const document = only(
    await backend.select<Row>({
      table: 'documents',
      columns: columns.DOCUMENT,
      where: [{ column: 'id', op: 'eq', value: args.document_id }],
    }),
    `document ${args.document_id}`,
  );

  const lines = await backend.select<Row>({
    table: 'document_lines',
    columns: columns.DOCUMENT_LINE,
    where: [{ column: 'document_id', op: 'eq', value: args.document_id }],
    order: [{ column: 'sequence' }],
  });

  const [contact, accounts, taxes] = await Promise.all([
    namesOf(backend, 'contacts', [document['contact_id'] as string]),
    backend.select<{ id: string; code: string; name: string }>({
      table: 'accounts',
      columns: ['id', 'code', 'name'],
      where: [
        {
          column: 'id',
          op: 'in',
          value: lines.map((line) => line['account_id']).filter((id): id is string => typeof id === 'string'),
        },
      ],
    }),
    backend.select<{ id: string; code: string; amount: string }>({
      table: 'taxes',
      columns: ['id', 'code', 'amount::text'],
      where: [
        {
          column: 'id',
          op: 'in',
          value: lines.map((line) => line['tax_id']).filter((id): id is string => typeof id === 'string'),
        },
      ],
    }),
  ]);
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const taxById = new Map(taxes.map((tax) => [tax.id, tax]));

  const entryId = document['entry_id'];
  let entry: Row | null = null;
  let entryLines: Row[] = [];
  if (typeof entryId === 'string') {
    entry = (
      await backend.select<Row>({
        table: 'entries',
        columns: columns.ENTRY,
        where: [{ column: 'id', op: 'eq', value: entryId }],
      })
    )[0] as Row;
    entryLines = await backend.select<Row>({
      table: 'entry_lines',
      columns: columns.ENTRY_LINE,
      where: [{ column: 'entry_id', op: 'eq', value: entryId }],
      order: [{ column: 'sequence' }],
    });
  }

  const ledgerAccounts = await namesOf(
    backend,
    'accounts',
    entryLines.map((line) => line['account_id'] as string),
  );

  return {
    document: { ...document, contact_name: contact[document['contact_id'] as string] ?? null },
    lines: lines.map((line) => ({
      ...line,
      account: accountById.get(line['account_id'] as string) ?? null,
      tax: taxById.get(line['tax_id'] as string) ?? null,
    })),
    entry,
    entry_lines: entryLines.map((line) => ({
      ...line,
      account_name: ledgerAccounts[line['account_id'] as string] ?? null,
    })),
  };
}

// ---------------------------------------------------------------------------
// Bank
// ---------------------------------------------------------------------------

export const ListBankTransactionsInput = z.object({
  company_id: companyId,
  bank_account_id: uuid.optional(),
  state: z.enum(['pending', 'reconciled', 'ignored', 'all']).optional().describe('Defaults to pending: what still has to be dealt with.'),
  from: isoDate.optional(),
  to: isoDate.optional(),
  limit: z.number().int().min(1).max(200).optional(),
});

export async function listBankTransactions(
  backend: Backend,
  args: z.infer<typeof ListBankTransactionsInput>,
): Promise<unknown> {
  const where: Filter[] = [{ column: 'company_id', op: 'eq', value: args.company_id }];
  const state = args.state ?? 'pending';
  if (state !== 'all') where.push({ column: 'state', op: 'eq', value: state });
  if (args.bank_account_id !== undefined) where.push({ column: 'bank_account_id', op: 'eq', value: args.bank_account_id });
  if (args.from !== undefined) where.push({ column: 'transaction_date', op: 'gte', value: args.from });
  if (args.to !== undefined) where.push({ column: 'transaction_date', op: 'lte', value: args.to });

  const [transactions, bankAccounts] = await Promise.all([
    backend.select<Row>({
      table: 'bank_transactions',
      columns: columns.BANK_TRANSACTION,
      where,
      order: [{ column: 'transaction_date', ascending: false }],
      limit: args.limit ?? 50,
    }),
    backend.select<Row>({
      table: 'bank_accounts',
      columns: columns.BANK_ACCOUNT,
      where: [{ column: 'company_id', op: 'eq', value: args.company_id }],
      order: [{ column: 'name' }],
    }),
  ]);

  return { transactions, count: transactions.length, bank_accounts: bankAccounts };
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

export const SearchProductsInput = z.object({
  company_id: companyId,
  query: z.string().min(1).optional().describe('Matches the code, the name or the description.'),
  kind: z.enum(['service', 'goods']).optional(),
  include_inactive: z.boolean().optional().describe('Default false: a retired product is hidden.'),
  limit: z.number().int().min(1).max(200).optional(),
});

export async function searchProducts(
  backend: Backend,
  args: z.infer<typeof SearchProductsInput>,
): Promise<unknown> {
  const where: Filter[] = [{ column: 'company_id', op: 'eq', value: args.company_id }];
  if (args.kind !== undefined) where.push({ column: 'kind', op: 'eq', value: args.kind });
  if (args.include_inactive !== true) where.push({ column: 'active', op: 'eq', value: true });

  const products = await backend.select<Row>({
    table: 'products',
    columns: columns.PRODUCT,
    where,
    order: [{ column: 'code' }],
    limit: args.limit ?? 100,
  });

  // The filter on the text is applied here rather than in three `ilike`
  // clauses, because neither backend offers an OR and a second round trip per
  // column would be the alternative.
  const needle = args.query?.toLowerCase();
  const matching =
    needle === undefined
      ? products
      : products.filter((product) =>
          [product['code'], product['name'], product['description']]
            .filter((value): value is string => typeof value === 'string')
            .some((value) => value.toLowerCase().includes(needle)),
        );

  return { products: matching };
}

export const ListBankAccountsInput = z.object({
  company_id: companyId,
  include_inactive: z.boolean().optional().describe('Default false.'),
});

export async function listBankAccounts(
  backend: Backend,
  args: z.infer<typeof ListBankAccountsInput>,
): Promise<unknown> {
  const accounts = await backend.select<Row>({
    table: 'bank_accounts',
    columns: columns.BANK_ACCOUNT,
    where: [
      { column: 'company_id', op: 'eq', value: args.company_id },
      ...(args.include_inactive === true
        ? []
        : ([{ column: 'active', op: 'eq', value: true }] satisfies Filter[])),
    ],
    order: [{ column: 'name' }],
  });
  return {
    bank_accounts: accounts,
    note:
      accounts.length === 0
        ? 'This company has no bank account. create_bank_account adds one; until then a payment books on the default account of its journal.'
        : undefined,
  };
}

export const TrialBalanceInput = z.object({
  company_id: companyId,
  from: isoDate,
  to: isoDate,
});

export async function trialBalance(
  backend: Backend,
  args: z.infer<typeof TrialBalanceInput>,
): Promise<unknown> {
  const rows = await backend.rpc<Record<string, unknown>>('trial_balance', {
    p_company_id: args.company_id,
    p_from: args.from,
    p_to: args.to,
  });
  const accounts = moneyFields(rows, ['opening_balance', 'debit', 'credit', 'closing_balance']);
  const total = (key: string): string =>
    accounts.reduce((sum, row) => sum + Number(row[key] ?? 0), 0).toFixed(2);

  return {
    period: { from: args.from, to: args.to },
    accounts,
    totals: { debit: total('debit'), credit: total('credit') },
  };
}

export const GeneralLedgerInput = z.object({
  company_id: companyId,
  from: isoDate,
  to: isoDate,
  account_code: z.string().min(1).optional().describe('The account to detail, by its code, e.g. "400000".'),
  account_ids: z.array(uuid).optional().describe('The accounts to detail, by id. Leave both out for every account.'),
});

export async function generalLedger(
  backend: Backend,
  args: z.infer<typeof GeneralLedgerInput>,
): Promise<unknown> {
  let ids = args.account_ids ?? null;
  if (args.account_code !== undefined) {
    const accounts = await backend.select<{ id: string }>({
      table: 'accounts',
      columns: ['id'],
      where: [
        { column: 'company_id', op: 'eq', value: args.company_id },
        { column: 'code', op: 'eq', value: args.account_code },
      ],
    });
    ids = [...(ids ?? []), ...accounts.map((account) => account.id)];
    if (ids.length === 0) {
      throw new EkwoMcpError(`not_found: no account ${args.account_code} in this company.`);
    }
  }

  const rows = await backend.rpc<Record<string, unknown>>('general_ledger', {
    p_company_id: args.company_id,
    p_from: args.from,
    p_to: args.to,
    p_account_ids: ids,
  });

  return {
    period: { from: args.from, to: args.to },
    lines: moneyFields(rows, ['debit', 'credit', 'running_balance']),
    count: rows.length,
  };
}

export const AgedBalanceInput = z.object({
  company_id: companyId,
  at: isoDate.optional().describe('The day to age at. Defaults to today.'),
  group: z.enum(['receivable', 'payable']).optional(),
});

export async function agedBalance(
  backend: Backend,
  args: z.infer<typeof AgedBalanceInput>,
): Promise<unknown> {
  const rows = await backend.rpc<Record<string, unknown>>('aged_balance', {
    p_company_id: args.company_id,
    p_at: args.at ?? new Date().toISOString().slice(0, 10),
    p_group: args.group ?? 'receivable',
  });
  return {
    at: args.at ?? new Date().toISOString().slice(0, 10),
    group: args.group ?? 'receivable',
    rows: moneyFields(rows, ['not_due', 'days_1_30', 'days_31_60', 'days_61_90', 'days_over_90', 'total']),
  };
}

export const VatReturnInput = z.object({
  company_id: companyId,
  from: isoDate,
  to: isoDate,
});

export async function vatReturn(
  backend: Backend,
  args: z.infer<typeof VatReturnInput>,
): Promise<unknown> {
  const rows = await backend.rpc<Record<string, unknown>>('vat_return', {
    p_company_id: args.company_id,
    p_from: args.from,
    p_to: args.to,
  });
  return {
    period: { from: args.from, to: args.to },
    boxes: moneyFields(rows, ['amount']),
    note: 'Boxes are summed from what the tax postings wrote on the ledger lines. A box flagged computed is derived from the others.',
  };
}

export const GenerateFecInput = z.object({
  company_id: companyId,
  from: isoDate,
  to: isoDate,
});

export async function generateFec(
  backend: Backend,
  args: z.infer<typeof GenerateFecInput>,
): Promise<unknown> {
  const rows = await backend.rpc<FecQueryRow>('fec_lines', {
    p_company_id: args.company_id,
    p_from: args.from,
    p_to: args.to,
  });
  const lines = rows.map(fromQueryRow);
  const violations = checkFec(lines);
  const file = renderFec(lines);

  const company = only(
    await backend.select<Row>({
      table: 'companies',
      columns: ['id', 'name', 'registration_number', 'fiscal_country'],
      where: [{ column: 'id', op: 'eq', value: args.company_id }],
    }),
    `company ${args.company_id}`,
  );

  const siren = String(company['registration_number'] ?? '').replace(/\D/g, '');
  let filename: string | null = null;
  let filename_note: string | null = null;
  if (siren.length === 9) {
    filename = fecFileName(siren, args.to);
  } else {
    filename_note =
      'No filename: the FEC name is built from a nine-digit SIREN, and this company has no such registration number.';
  }

  return {
    period: { from: args.from, to: args.to },
    lines: lines.length,
    violations,
    filename,
    filename_note,
    file,
  };
}

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------

export const StatusInput = z.object({});

export async function status(backend: Backend): Promise<unknown> {
  const version = await backend.rpc<string>('ekwo_schema_version');
  const instance = await backend.select<Row>({ table: 'instance', columns: columns.INSTANCE });
  const companies = await backend.select<Row>({
    table: 'companies',
    columns: ['id', 'name', 'country', 'currency_code'],
    order: [{ column: 'name' }],
  });

  return {
    schema_version: version[0] ?? null,
    connection: { mode: backend.mode, acting_as: backend.actingAs ?? null },
    instance: instance[0] ?? null,
    companies,
    note:
      backend.mode === 'postgrest'
        ? 'Reading and writing as the signed-in user, over PostgREST. Row level security decides what is visible.'
        : 'Reading and writing over a direct Postgres connection, with the claims and the role of the user this server acts for.',
  };
}

/** Re-exported so the write tools can format the same way. */
export { money };
