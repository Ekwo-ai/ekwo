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
// Documents
// ---------------------------------------------------------------------------

const LineInput = z.object({
  name: z.string().min(1).describe('What is billed, as it appears on the invoice.'),
  quantity: z.union([z.string(), z.number()]).optional().describe('Defaults to 1.'),
  unit_price: z.union([z.string(), z.number()]).describe('Price of one unit, excluding tax, as a decimal string.'),
  discount_percent: z.union([z.string(), z.number()]).optional().describe('A percentage off this line, 0 to 99.'),
  account_id: uuid.optional(),
  account_code: z.string().min(1).optional().describe('The income or expense account, by code. Left out, the company falls back to its default sales or purchase account, and then to the one its country model names; a company with neither refuses the line.'),
  tax_id: uuid.optional(),
  tax_code: z.string().min(1).optional().describe('The tax, by code, e.g. S21 or P21G. Leaving both out books no tax at all, which is not the same as 0 %.'),
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
  const accountCodes = args.lines
    .map((line) => line.account_code)
    .filter((code): code is string => typeof code === 'string');
  const taxCodes = args.lines
    .map((line) => line.tax_code)
    .filter((code): code is string => typeof code === 'string');

  const [accounts, taxes] = await Promise.all([
    idsByCode(backend, 'accounts', args.company_id, accountCodes),
    idsByCode(backend, 'taxes', args.company_id, taxCodes),
  ]);

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
          currency_code: args.currency_code ?? 'EUR',
          journal_id: args.journal_id ?? null,
          payment_reference: args.payment_reference ?? null,
        },
      ],
      ['id'],
    ),
    'the document could not be created',
  );

  await insertLines(backend, args.company_id, document['id'] as string, args.lines, accounts, taxes);
  return getDocument(backend, { document_id: document['id'] as string });
}

type LineArgs = z.infer<typeof LineInput>;

async function insertLines(
  backend: Backend,
  company: string,
  documentId: string,
  lines: LineArgs[],
  accounts: Map<string, string>,
  taxes: Map<string, string>,
): Promise<void> {
  const rows: Row[] = lines.map((line, index) => {
    // A line with no account is not an error here. `resolve_line_account`
    // decides — the line, then the product, then the company, then the
    // country — and the check constraint refuses when every one of them is
    // empty. Resolving it a second time in this package would be a second
    // answer to the same question.
    const accountId =
      line.account_id ?? (line.account_code === undefined ? null : accounts.get(line.account_code) ?? null);
    const taxId = line.tax_id ?? (line.tax_code === undefined ? null : (taxes.get(line.tax_code) ?? null));
    return {
      document_id: documentId,
      company_id: company,
      sequence: (index + 1) * 10,
      line_type: 'product',
      name: line.name,
      quantity: amountIn(line.quantity ?? 1),
      unit_price: amountIn(line.unit_price),
      discount_percent: amountIn(line.discount_percent ?? 0),
      account_id: accountId,
      tax_id: taxId,
    };
  });
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
      columns: ['id', 'company_id', 'state'],
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
  const [accounts, taxes] = await Promise.all([
    idsByCode(
      backend,
      'accounts',
      company,
      args.lines.map((line) => line.account_code).filter((code): code is string => typeof code === 'string'),
    ),
    idsByCode(
      backend,
      'taxes',
      company,
      args.lines.map((line) => line.tax_code).filter((code): code is string => typeof code === 'string'),
    ),
  ]);

  await backend.remove('document_lines', [{ column: 'document_id', op: 'eq', value: args.document_id }]);
  await insertLines(backend, company, args.document_id, args.lines, accounts, taxes);
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
  journal_code: z.string().min(1).optional().describe('The bank or cash journal, by code, e.g. BNK. One of journal_id or journal_code is required.'),
  bank_account_id: uuid
    .optional()
    .describe('Which bank account the money moved on. list_bank_accounts says what exists; left out, the default account of the journal is used.'),
  reference: z.string().min(1).optional(),
  memo: z.string().min(1).optional(),
  match_open_items: z.boolean().optional().describe('Default true: match the payment against the oldest open invoices of that contact, up to the amount paid.'),
});

export async function recordPayment(
  backend: Backend,
  args: z.infer<typeof RecordPaymentInput>,
): Promise<unknown> {
  let journalId = args.journal_id;
  if (journalId === undefined) {
    if (args.journal_code === undefined) {
      throw new EkwoMcpError(
        'missing_journal: a payment needs journal_id or journal_code — the bank or cash book it goes through. get_company lists the journals.',
      );
    }
    journalId = (await idsByCode(backend, 'journals', args.company_id, [args.journal_code])).get(
      args.journal_code,
    ) as string;
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

  const open = candidates
    .filter((line) => line['id'] !== paymentLine['id'])
    .filter((line) => posted.has(line['entry_id'] as string))
    .filter((line) => (Number(line['debit'] ?? 0) > 0) !== paymentIsDebit)
    .map((line) => ({
      line,
      residual:
        Math.abs(Number(line['balance'] ?? 0)) - Number(line['matched_amount'] ?? 0),
      due: String(line['date_maturity'] ?? posted.get(line['entry_id'] as string)?.entry_date ?? ''),
    }))
    .filter((item) => item.residual > 0.005)
    .sort((a, b) => a.due.localeCompare(b.due));

  let remaining =
    Math.abs(Number(paymentLine['balance'] ?? 0)) - Number(paymentLine['matched_amount'] ?? 0);
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

  const currency =
    args.currency_code ??
    (
      await backend.select<{ currency_code: string }>({
        table: 'companies',
        columns: ['currency_code'],
        where: [{ column: 'id', op: 'eq', value: args.company_id }],
      })
    )[0]?.currency_code ??
    'EUR';

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
