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
} from '@ekwo-ai/fec';
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

  const packs = await backend.select<Row>({
    table: 'company_packs',
    columns: ['country', 'version', 'chart_code', 'installed_at'],
    where: [{ column: 'company_id', op: 'eq', value: args.company_id }],
    order: [{ column: 'country' }],
  });

  // Who is on the books, and what the person asking may actually do. A role
  // is a preset here and nothing more: the capabilities are the answer, and
  // a tool that reported the role alone would be reporting the label rather
  // than the permission.
  const members = await backend.select<Row>({
    table: 'company_members',
    columns: ['user_id', 'role', 'capabilities_granted', 'capabilities_revoked', 'created_at::text'],
    where: [{ column: 'company_id', op: 'eq', value: args.company_id }],
  });
  // A function returning `setof text` comes back as a list of strings over
  // PostgREST and as a list of one-column rows over Postgres. Both are read
  // here, so the answer is the same list on either route.
  const mine = await backend.rpc<unknown>('member_capabilities', {
    p_company_id: args.company_id,
  });
  const capabilities = mine
    .map((row) =>
      typeof row === 'string'
        ? row
        : ((row as Record<string, unknown>)['member_capabilities'] as string | undefined),
    )
    .filter((code): code is string => typeof code === 'string');

  return {
    company,
    country_packs: packs,
    members,
    your_capabilities: capabilities,
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

  // What the law of the document's country asks of it. The mentions come from
  // the view, which already decided which of them apply from the treatments of
  // the taxes on the lines; the rules come from the country model, reached
  // through the company's fiscal country — the country whose VAT applies, not
  // the address. Both are null-tolerant: a country that has said nothing
  // returns nothing, and the caller is never handed another country's answer.
  const [mentions, headers] = await Promise.all([
    backend.select<Row>({
      table: 'document_legal_mentions',
      columns: columns.DOCUMENT_LEGAL_MENTION,
      where: [{ column: 'document_id', op: 'eq', value: args.document_id }],
      order: [{ column: 'sequence' }],
    }),
    backend.select<Row>({
      table: 'document_header',
      columns: columns.DOCUMENT_HEADER,
      where: [{ column: 'document_id', op: 'eq', value: args.document_id }],
    }),
  ]);
  const header = headers[0] ?? null;

  // The country rules used to be fetched here, company then country_defaults,
  // which is what `document_header` now does in one read. They keep their own
  // key in the answer because that is what a caller asks for by name — but
  // they are a slice of the header and not a second query.
  const countryRules =
    header === null
      ? null
      : Object.fromEntries(
          columns.COUNTRY_DOCUMENT_RULES.map((column) => {
            const name = column.split('::')[0] as string;
            return [name, header[name] ?? null];
          }),
        );

  return {
    document: { ...document, contact_name: contact[document['contact_id'] as string] ?? null },
    lines: lines.map((line) => ({
      ...line,
      account: accountById.get(line['account_id'] as string) ?? null,
      tax: taxById.get(line['tax_id'] as string) ?? null,
    })),
    header,
    legal_mentions: mentions,
    country_rules: countryRules,
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

// ---------------------------------------------------------------------------
// Members and invitations
// ---------------------------------------------------------------------------

export const ListApiKeysInput = z.object({
  company_id: companyId,
  include_withdrawn: z.boolean().optional().describe('Also the ones withdrawn or expired. Default false.'),
});

export async function listApiKeys(
  backend: Backend,
  args: z.infer<typeof ListApiKeysInput>,
): Promise<unknown> {
  const keys = await backend.select<Row>({
    table: 'api_keys',
    columns: columns.API_KEY,
    where: [{ column: 'company_id', op: 'eq', value: args.company_id }],
    order: [{ column: 'created_at', ascending: false }],
  });

  const now = Date.now();
  const described = keys.map((key) => ({ ...key, state: apiKeyState(key, now) }));
  return {
    api_keys:
      args.include_withdrawn === true
        ? described
        : described.filter((key) => key.state === 'live'),
    note: 'The secret of a key exists only in the answer that created it. A key that is lost is withdrawn and issued again.',
  };
}

function apiKeyState(key: Row, now: number): string {
  if (key['revoked_at'] !== null && key['revoked_at'] !== undefined) return 'withdrawn';
  const expires = key['expires_at'];
  if (typeof expires === 'string' && Date.parse(expires) <= now) return 'expired';
  return 'live';
}

export const GetPreferencesInput = z.object({
  company_id: uuid
    .optional()
    .describe('Resolve the language chain against this company. Left out, only what the user themselves chose is returned.'),
});

export async function getPreferences(
  backend: Backend,
  args: z.infer<typeof GetPreferencesInput>,
): Promise<unknown> {
  const [stored] = await backend.select<Row>({
    table: 'user_preferences',
    columns: columns.USER_PREFERENCES,
    limit: 1,
  });

  const chain = await backend.rpc<unknown>('preferred_languages', {
    p_company_id: args.company_id ?? null,
  });
  const languages = (chain[0] ?? []) as string[] | Record<string, unknown>;

  return {
    preferences: stored ?? null,
    languages: Array.isArray(languages) ? languages : (languages['preferred_languages'] ?? []),
    note: 'Every preference may be null, and null is an answer: take the company\u2019s, then the country pack\u2019s. A label is picked with label_for(name, name_i18n, languages), in that order.',
  };
}

export const ListInvitationsInput = z.object({
  company_id: companyId,
  include_settled: z
    .boolean()
    .optional()
    .describe('Also the ones already accepted or withdrawn. Default false.'),
});

export async function listInvitations(
  backend: Backend,
  args: z.infer<typeof ListInvitationsInput>,
): Promise<unknown> {
  const invitations = await backend.select<Row>({
    table: 'company_invitations',
    columns: columns.INVITATION,
    where: [{ column: 'company_id', op: 'eq', value: args.company_id }],
    order: [{ column: 'created_at', ascending: false }],
  });

  const now = Date.now();
  const described = invitations.map((invitation) => ({
    ...invitation,
    state: invitationState(invitation, now),
  }));

  return {
    invitations:
      args.include_settled === true
        ? described
        : described.filter((invitation) => invitation.state === 'pending'),
    note: 'The token is shown once, when the invitation is issued, and is never readable afterwards. A lost one is replaced by inviting the same address again.',
  };
}

/** Pending, expired, accepted or withdrawn — four states off three columns. */
function invitationState(invitation: Row, now: number): string {
  if (invitation['accepted_at'] !== null && invitation['accepted_at'] !== undefined) return 'accepted';
  if (invitation['revoked_at'] !== null && invitation['revoked_at'] !== undefined) return 'withdrawn';
  const expires = Date.parse(String(invitation['expires_at']));
  return Number.isNaN(expires) || expires > now ? 'pending' : 'expired';
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
  report_code: z
    .string()
    .optional()
    .describe(
      'Which declaration form, when the country files more than one (BE-VAT-PERIODIC, FR-CA3). Leave it out and the periodic return of the company country is used.',
    ),
});

export async function vatReturn(
  backend: Backend,
  args: z.infer<typeof VatReturnInput>,
): Promise<unknown> {
  const rows = await backend.rpc<Record<string, unknown>>('vat_return', {
    p_company_id: args.company_id,
    p_from: args.from,
    p_to: args.to,
    p_report_code: args.report_code ?? null,
  });
  const form = rows.find((row) => row['report_code'] !== null)?.['report_code'] ?? null;
  return {
    period: { from: args.from, to: args.to },
    report_code: form,
    boxes: moneyFields(rows, ['amount']),
    note:
      'A box flagged computed is a total the form derives from the others, following the plus and minus lists of the country pack; hidden means the form does not print it. Everything else is summed from what the tax postings wrote on the ledger lines.',
  };
}

export const ListStatementsInput = z.object({
  company_id: companyId,
  at: isoDate
    .optional()
    .describe('The day to read the schemes in force at. Defaults to today.'),
});

export async function listStatements(
  backend: Backend,
  args: z.infer<typeof ListStatementsInput>,
): Promise<unknown> {
  const rows = await backend.rpc<Record<string, unknown>>('available_statements', {
    p_company_id: args.company_id,
    p_at: args.at ?? null,
  });
  return {
    statements: rows,
    note:
      rows.length === 0
        ? 'No statement applies to this company. Its country pack declares none and the generic framework has not been seeded.'
        : 'is_default marks the schemes the chart of accounts of this company reports on. The ones with no country are the generic framework by account type, which fits any chart.',
  };
}

export const FinancialStatementInput = z.object({
  company_id: companyId,
  statement_code: z
    .string()
    .min(1)
    .describe('Which scheme, from list_statements (BE-BNB-ABBR-BS, FR-2050, IFRS-SME-BS).'),
  from: isoDate,
  to: isoDate,
});

export async function financialStatement(
  backend: Backend,
  args: z.infer<typeof FinancialStatementInput>,
): Promise<unknown> {
  const [lines, unmapped] = await Promise.all([
    backend.rpc<Record<string, unknown>>('financial_statement', {
      p_company_id: args.company_id,
      p_statement_code: args.statement_code,
      p_from: args.from,
      p_to: args.to,
    }),
    backend.rpc<Record<string, unknown>>('unmapped_accounts', {
      p_company_id: args.company_id,
      p_statement_code: args.statement_code,
      p_from: args.from,
      p_to: args.to,
    }),
  ]);

  return {
    period: { from: args.from, to: args.to },
    statement_code: args.statement_code,
    lines: moneyFields(lines, ['amount']),
    unmapped_accounts: moneyFields(unmapped, ['balance']),
    note:
      'Every line of the scheme is returned, nil included, in the order it is printed; a line flagged is_total is derived from the others. ' +
      (unmapped.length === 0
        ? 'No account of this company falls outside the scheme, so it ties out.'
        : 'unmapped_accounts lists accounts this scheme catches on no line — say so rather than presenting a statement that does not tie out.'),
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

// ---------------------------------------------------------------------------
// The audit trail
// ---------------------------------------------------------------------------

export const ReadAuditLogInput = z.object({
  company_id: companyId,
  table: z
    .string()
    .optional()
    .describe(
      'One table of the schema: accounts, journals, taxes, tax_postings, contacts, products, bank_accounts, companies, fiscal_years, company_members, company_packs, api_keys, documents, payments, entries, reconciliations.',
    ),
  record_key: z
    .string()
    .optional()
    .describe('The natural key of one row — an account code, a tax code, an invoice number.'),
  actor_id: uuid.optional().describe('Only what this user changed. Their auth.users id.'),
  action: z
    .string()
    .optional()
    .describe(
      'One act: document_posted, document_cancelled, entry_posted, entry_reversed, payment_posted, payment_reconciled, payment_unreconciled, fiscal_year_closed, fiscal_year_reopened, pack_upgraded.',
    ),
  operation: z.enum(['insert', 'update', 'delete']).optional(),
  from: isoDate.optional().describe('Earliest date, inclusive.'),
  to: isoDate.optional().describe('Latest date, inclusive — the whole of that day.'),
  limit: z.number().int().min(1).max(200).optional(),
});

export async function readAuditLog(
  backend: Backend,
  args: z.infer<typeof ReadAuditLogInput>,
): Promise<unknown> {
  const where: Filter[] = [{ column: 'company_id', op: 'eq', value: args.company_id }];
  if (args.table !== undefined) where.push({ column: 'table_name', op: 'eq', value: args.table });
  if (args.record_key !== undefined) where.push({ column: 'record_key', op: 'eq', value: args.record_key });
  if (args.actor_id !== undefined) where.push({ column: 'actor_id', op: 'eq', value: args.actor_id });
  if (args.action !== undefined) where.push({ column: 'action', op: 'eq', value: args.action });
  if (args.operation !== undefined) where.push({ column: 'operation', op: 'eq', value: args.operation });
  if (args.from !== undefined) where.push({ column: 'occurred_at', op: 'gte', value: args.from });
  // A date names a day, not the instant it begins: `to: 2026-06-15` has to
  // include everything that happened that afternoon.
  if (args.to !== undefined) {
    where.push({ column: 'occurred_at', op: 'lt', value: nextDay(args.to) });
  }

  const entries = await backend.select<Row>({
    table: 'audit_log',
    columns: columns.AUDIT_LOG,
    where,
    order: [{ column: 'occurred_at', ascending: false }, { column: 'id', ascending: false }],
    limit: args.limit ?? 50,
  });

  return {
    changes: entries,
    count: entries.length,
    note: 'Append-only. Nothing writes this trail but the database itself, and nothing removes a row from it.',
  };
}

/** The day after an ISO date, so a range on a timestamp can end on a day. */
function nextDay(date: string): string {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + 1);
  return day.toISOString().slice(0, 10);
}
