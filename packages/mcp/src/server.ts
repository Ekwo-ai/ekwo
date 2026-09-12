/**
 * The server itself: the tools, the resources and the two prompts.
 *
 * The descriptions here are written for a model rather than for a reference
 * manual — when to reach for the tool, what comes back, and what it will not
 * do. That last part is the one that earns its place: a model told that
 * `post_document` cannot be undone asks before calling it, and a model told
 * that a missing tax is not zero per cent stops inventing one.
 */

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { EkwoMcpError, type Backend, type Row } from './backend.js';
import * as columns from './columns.js';
import * as read from './tools/read.js';
import * as write from './tools/write.js';

export const SERVER_NAME = '@ekwo-ai/mcp';
export const SERVER_VERSION = '0.1.0';

/** Everything a tool returns: JSON, pretty-printed, as one text block. */
function ok(payload: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
}

/**
 * A failure, with the database's own words first.
 *
 * `period_locked: 2026-03-31 is on or before the accounting lock date` is
 * more useful to a model than anything this package could paraphrase, so it
 * leads; the sentence underneath says what to do about it.
 */
function fail(error: unknown): CallToolResult {
  const message = error instanceof Error ? error.message : String(error);
  const hint = error instanceof EkwoMcpError ? error.hint : undefined;
  return {
    isError: true,
    content: [{ type: 'text', text: hint === undefined ? message : `${message}\n\n${hint}` }],
  };
}

async function guard(run: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return ok(await run());
  } catch (error) {
    return fail(error);
  }
}

export function buildServer(backend: Backend): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions:
        'Ekwo OS keeps double-entry books in the user\'s own Postgres. You act as that user: everything you can see and change is what row level security lets them see and change. Amounts are decimal strings ("1210.00"), dates are ISO (2026-06-15), identifiers are uuids. Invoices are created as drafts and become ledger entries only when post_document is called; a posted entry is never deleted or edited, it is corrected with a credit note. When the database refuses — period_locked, entry_unbalanced, document_total_mismatch — report the refusal rather than working around it.',
    },
  );

  // -------------------------------------------------------------------- read

  server.registerTool(
    'list_companies',
    {
      title: 'List companies',
      description:
        'The companies of this installation that you are a member of, with your role on each. Start here: every other tool needs a company_id. Returns id, name, country, currency and your role. It does not list companies you were never invited to — those are invisible, not hidden.',
      inputSchema: read.ListCompaniesInput.shape,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => guard(() => read.listCompanies(backend)),
  );

  server.registerTool(
    'get_company',
    {
      title: 'Company settings',
      description:
        'Everything needed before booking in a company: its financial years and whether they are closed, its lock dates, its journals, and the accounts that play the receivable, payable, suspense and retained-earnings roles. Read this before creating a document if you do not already know the journals and the lock dates.',
      inputSchema: read.GetCompanyInput.shape,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => guard(() => read.getCompany(backend, args)),
  );

  server.registerTool(
    'list_accounts',
    {
      title: 'Chart of accounts',
      description:
        'The chart of accounts of a company, filtered by code prefix, by account type, or by a search on the name. Use it to find the income or expense account a document line should carry. Deprecated accounts are left out unless you ask for them.',
      inputSchema: read.ListAccountsInput.shape,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => guard(() => read.listAccounts(backend, args)),
  );

  server.registerTool(
    'search_contacts',
    {
      title: 'Find a contact',
      description:
        'Customers, suppliers and other third parties of a company, by name, by type or by VAT number. Use it before creating a document: a document is booked against a contact, and creating a second contact for a customer who already exists splits their account.',
      inputSchema: read.SearchContactsInput.shape,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => guard(() => read.searchContacts(backend, args)),
  );

  server.registerTool(
    'list_documents',
    {
      title: 'List documents',
      description:
        'Invoices, credit notes and quotes of a company, filtered by type, state, settlement state, contact or date range. `state` is the document (draft, posted, cancelled) and `payment_state` is the settlement (not_paid, partially_paid, paid) — two different questions. Returns headers and totals, not lines; use get_document for those.',
      inputSchema: read.ListDocumentsInput.shape,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => guard(() => read.listDocuments(backend, args)),
  );

  server.registerTool(
    'get_document',
    {
      title: 'Read a document',
      description:
        'One document with its lines, the account and tax of each line, and — when it has been posted — the ledger entry it produced with every ledger line. Use it to check what a document will book, or what it did book.',
      inputSchema: read.GetDocumentInput.shape,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => guard(() => read.getDocument(backend, args)),
  );

  server.registerTool(
    'list_bank_transactions',
    {
      title: 'Bank transactions',
      description:
        'Statement lines of a company, pending by default — the ones still waiting to be dealt with. `amount` is signed: positive is money in. A statement line is not a ledger entry; recording a payment is what books it.',
      inputSchema: read.ListBankTransactionsInput.shape,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => guard(() => read.listBankTransactions(backend, args)),
  );

  server.registerTool(
    'trial_balance',
    {
      title: 'Trial balance',
      description:
        'Opening balance, movements of the period and closing balance for every account, from posted entries only. The debit and credit totals are equal on a healthy ledger; if they are not, say so rather than explaining it away.',
      inputSchema: read.TrialBalanceInput.shape,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => guard(() => read.trialBalance(backend, args)),
  );

  server.registerTool(
    'general_ledger',
    {
      title: 'General ledger',
      description:
        'Every posted line of an account over a period, with the balance carried forward from before it and a running balance. Give account_code for one account; leave it out for all of them, which on a real company is a lot of lines.',
      inputSchema: read.GeneralLedgerInput.shape,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => guard(() => read.generalLedger(backend, args)),
  );

  server.registerTool(
    'aged_balance',
    {
      title: 'Aged balance',
      description:
        'What customers still owe (or what is still owed to suppliers), bucketed by how overdue it is. It reads unmatched ledger lines, not invoices, so it ties back to the balance sheet: an invoice counts as settled only once its payment has been matched.',
      inputSchema: read.AgedBalanceInput.shape,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => guard(() => read.agedBalance(backend, args)),
  );

  server.registerTool(
    'vat_return',
    {
      title: 'VAT return',
      description:
        'The boxes of the VAT return for a period, with their names: the base and tax boxes are summed from what the postings wrote on the ledger lines, the totals are derived from them by the declaration form of the country pack. No country rule lives in this tool, nor in the function behind it. Name a report_code only where a country files several declarations. It prepares figures; it files nothing.',
      inputSchema: read.VatReturnInput.shape,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => guard(() => read.vatReturn(backend, args)),
  );

  server.registerTool(
    'generate_fec',
    {
      title: 'Generate the French FEC',
      description:
        'The Fichier des Écritures Comptables for a period: the eighteen columns of the arrêté du 29 juillet 2013, as text, with the checks a tax inspector applies first (mandatory fields, one side per line, entries balancing) and the filename the format wants. The file comes back in the answer; writing it to disk is the caller\'s business.',
      inputSchema: read.GenerateFecInput.shape,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => guard(() => read.generateFec(backend, args)),
  );

  server.registerTool(
    'status',
    {
      title: 'Installation status',
      description:
        'The schema version, the instance this is, how this server is connected and as whom, and the companies you can see. Use it first when something does not add up — an empty company list usually means the user was never invited rather than that the books are empty.',
      inputSchema: read.StatusInput.shape,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => guard(() => read.status(backend)),
  );

  // ------------------------------------------------------------------- write

  server.registerTool(
    'search_products',
    {
      title: 'Find a product',
      description:
        'The catalogue of a company: what it sells and buys, with the code, the unit, the price, the account each books to and the tax each carries. Search it before writing a line by hand — a product fills in the text, the price, the account and the tax, and keeps two invoices for the same thing consistent. Retired products are left out unless you ask for them.',
      inputSchema: read.SearchProductsInput.shape,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => guard(() => read.searchProducts(backend, args)),
  );

  server.registerTool(
    'create_product',
    {
      title: 'Add a product',
      description:
        'Adds an item to the catalogue: a code unique in the company, a name, a unit, a price, and optionally the account and the tax a sale or a purchase of it carries. It changes nothing already booked — a product is what a new line is filled in from, never a rule applied to the past. Search first: a second code for the same thing is how a price list stops being one.',
      inputSchema: write.CreateProductInput.shape,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (args) => guard(() => write.createProduct(backend, args)),
  );

  server.registerTool(
    'update_product',
    {
      title: 'Change a product',
      description:
        "Changes a catalogue row — its name, price, unit, account, tax — or retires it with active: false. Documents already written keep the text, the price and the account they were invoiced with; an invoice is a statement about the day it was raised, and this tool cannot rewrite one. Retiring is the way to withdraw something: deleting is refused while any line still points at it.",
      inputSchema: write.UpdateProductInput.shape,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (args) => guard(() => write.updateProduct(backend, args)),
  );

  server.registerTool(
    'create_contact',
    {
      title: 'Create a contact',
      description:
        'Adds a customer, supplier or other third party to a company. Search first: a duplicate contact splits a customer account in two and the aged balance stops making sense. payment_terms_days drives the due date a posted invoice gets when none is given.',
      inputSchema: write.CreateContactInput.shape,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (args) => guard(() => write.createContact(backend, args)),
  );

  server.registerTool(
    'create_document',
    {
      title: 'Create a draft invoice',
      description:
        'Creates a draft invoice, credit note or quote with its lines, and returns it with the totals the database computed — never with totals you supplied. A line may name a product_code, which fills in its text, price, unit, account and tax; anything the line carries wins over that. With no product and no account_code, the account falls back to the company default and then to its country model. A tax is different: a line with none is booked as a base with no VAT box, which is not the same as 0 %. Nothing is in the ledger yet; post_document is what books it.',
      inputSchema: write.CreateDocumentInput.shape,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (args) => guard(() => write.createDocument(backend, args)),
  );

  server.registerTool(
    'update_document_lines',
    {
      title: 'Replace the lines of a draft',
      description:
        'Replaces every line of a draft document with the set you give, and returns the document with its recomputed totals. Lines take product_code the same way create_document does. Drafts only: a posted document is corrected with a credit note, never edited.',
      inputSchema: write.UpdateDocumentLinesInput.shape,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (args) => guard(() => write.updateDocumentLines(backend, args)),
  );

  server.registerTool(
    'post_document',
    {
      title: 'Post a document to the ledger',
      description:
        'Books a draft document: base lines, VAT lines from the tax configuration, and the customer or supplier counterpart, numbered and posted. This cannot be undone — there is no unpost, and a posted entry is never deleted; a mistake is corrected with a credit note. Ask the user before calling it. It refuses a locked period, a tax that is not in force, and a header total that disagrees with the lines.',
      inputSchema: write.PostDocumentInput.shape,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async (args) => guard(() => write.postDocument(backend, args)),
  );

  server.registerTool(
    'record_payment',
    {
      title: 'Record a payment',
      description:
        'Records money in or out, books it (bank against the customer or supplier account) and, unless you say otherwise, matches it against that contact\'s oldest open invoices up to the amount paid. Matching is what makes an invoice count as paid. The entry it produces cannot be unposted, though the matching can be undone with unreconcile.',
      inputSchema: write.RecordPaymentInput.shape,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async (args) => guard(() => write.recordPayment(backend, args)),
  );

  server.registerTool(
    'reconcile',
    {
      title: 'Match two ledger lines',
      description:
        'Matches a debit line against a credit line on the same reconcilable account, for an amount, defaulting to the smaller of the two open amounts. Use it to settle an invoice against a payment by hand. Matching changes no account and stays possible after a period is locked.',
      inputSchema: write.ReconcileInput.shape,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (args) => guard(() => write.reconcile(backend, args)),
  );

  server.registerTool(
    'unreconcile',
    {
      title: 'Undo a matching',
      description:
        'Removes one matching, putting the residual back on both lines. The entries themselves are untouched. This is the only write in this server that undoes something.',
      inputSchema: write.UnreconcileInput.shape,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (args) => guard(() => write.unreconcile(backend, args)),
  );

  server.registerTool(
    'create_bank_account',
    {
      title: 'Add a bank account',
      description:
        "Registers a bank account of the company from its IBAN, and wires it to the bank journal and to the ledger account behind it — both of which the country template has already chosen, so neither has to be given. Running it twice with the same IBAN returns the one that exists rather than creating a second. Do this once per account: until a company has one, an invoice carries no IBAN and record_payment can only book on the journal's default account.",
      inputSchema: write.CreateBankAccountInput.shape,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (args) => guard(() => write.createBankAccount(backend, args)),
  );

  server.registerTool(
    'list_bank_accounts',
    {
      title: 'Bank accounts',
      description:
        'The bank accounts of a company, with their IBAN, the journal they book through and the ledger account behind each. Read it before recording a payment on a particular account, and to find out whether the company has one at all.',
      inputSchema: read.ListBankAccountsInput.shape,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => guard(() => read.listBankAccounts(backend, args)),
  );

  server.registerTool(
    'create_bank_transaction',
    {
      title: 'Add a bank transaction',
      description:
        'Records one statement line by hand, for an installation without a bank feed. `amount` is signed: positive is money in. It books nothing — the line waits as pending until a payment is recorded.',
      inputSchema: write.CreateBankTransactionInput.shape,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (args) => guard(() => write.createBankTransaction(backend, args)),
  );

  server.registerTool(
    'lock_period',
    {
      title: 'Lock a period',
      description:
        'Moves the accounting lock date, the VAT lock date, or both. After this, nothing can be booked, changed or deleted on or before that date — including corrections you may want later. Only an owner of the company may do it. Always ask the user first, and never lock a period you have just posted into without being told to.',
      inputSchema: write.LockPeriodInput.shape,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (args) => guard(() => write.lockPeriod(backend, args)),
  );

  server.registerTool(
    'opening_balance',
    {
      title: 'Import an opening balance',
      description:
        'Turns the trial balance of whatever kept the books before into the opening entry of a fiscal year, on the opening journal, dated on its first day. Lines are {account_code, debit, credit}; total debit must equal total credit. Balance-sheet accounts only, unless allow_result_accounts is set, which is for taking books over in the middle of a year. A year holds one opening: a second call is refused rather than added to.',
      inputSchema: write.OpeningBalanceInput.shape,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async (args) => guard(() => write.openingBalance(backend, args)),
  );

  server.registerTool(
    'close_fiscal_year',
    {
      title: 'Close a fiscal year',
      description:
        'Closes a year: the result of the year leaves the income statement the way the country model says — straight to retained earnings, into a current-year result account, or through the appropriation accounts — every income and expense account goes back to zero, and the year stops accepting entries. Refused while the year holds a draft entry, while an earlier year with entries is open, or when a later year is already closed. It never writes what a general meeting decides to do with the result. Always ask the user before calling it.',
      inputSchema: write.CloseFiscalYearInput.shape,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async (args) => guard(() => write.closeFiscalYear(backend, args)),
  );

  server.registerTool(
    'reopen_fiscal_year',
    {
      title: 'Re-open a closed fiscal year',
      description:
        'Undoes a close that was run too early: the entries it wrote are reversed, never deleted, and the year accepts entries again. Refused once a later year is closed or holds entries of its own, because re-opening changes a result those years stand on. Always ask the user before calling it.',
      inputSchema: write.ReopenFiscalYearInput.shape,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async (args) => guard(() => write.reopenFiscalYear(backend, args)),
  );

  // --------------------------------------------------------------- resources

  server.registerResource(
    'chart-of-accounts',
    new ResourceTemplate('ekwo://companies/{companyId}/chart', { list: undefined }),
    {
      title: 'Chart of accounts',
      description: 'The whole chart of accounts of a company, as JSON, for when a search is not enough.',
      mimeType: 'application/json',
    },
    async (uri, variables) => {
      const companyId = String(variables['companyId']);
      const accounts = await backend.select<Row>({
        table: 'accounts',
        columns: columns.ACCOUNT,
        where: [{ column: 'company_id', op: 'eq', value: companyId }],
        order: [{ column: 'code' }],
      });
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify({ company_id: companyId, accounts }, null, 2),
          },
        ],
      };
    },
  );

  server.registerResource(
    'taxes',
    new ResourceTemplate('ekwo://companies/{companyId}/taxes', { list: undefined }),
    {
      title: 'Taxes',
      description:
        'The taxes of a company with their rates, validity periods and treatment, and the ledger account and declaration box each posting feeds.',
      mimeType: 'application/json',
    },
    async (uri, variables) => {
      const companyId = String(variables['companyId']);
      const taxes = await backend.select<Row>({
        table: 'taxes',
        columns: columns.TAX,
        where: [{ column: 'company_id', op: 'eq', value: companyId }],
        order: [{ column: 'code' }],
      });
      const postings = await backend.select<Row>({
        table: 'tax_postings',
        columns: [
          'id',
          'tax_id',
          'document_kind',
          'posting_type',
          'factor_percent::text',
          'account_id',
          'declaration_box',
          'box_factor_percent::text',
          'sequence',
        ],
        where: [{ column: 'company_id', op: 'eq', value: companyId }],
        order: [{ column: 'sequence' }],
      });
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(
              {
                company_id: companyId,
                taxes: taxes.map((tax) => ({
                  ...tax,
                  postings: postings.filter((posting) => posting['tax_id'] === tax['id']),
                })),
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // ----------------------------------------------------------------- prompts

  server.registerPrompt(
    'close_month',
    {
      title: 'Close a month',
      description: 'The checklist for closing a month: drafts, unmatched bank lines, the balance, the VAT.',
      argsSchema: {
        company_id: z.string().describe('The company to close.'),
        from: z.string().describe('First day of the month, as YYYY-MM-DD.'),
        to: z.string().describe('Last day of the month, as YYYY-MM-DD.'),
      },
    },
    ({ company_id, from, to }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: [
              `Close the month from ${from} to ${to} for company ${company_id}. Work through this in order and report what you find; change nothing without asking.`,
              '',
              `1. Documents still in draft: list_documents with state "draft" over the period. Each one is either waiting to be posted or waiting to be deleted — say which, do not decide.`,
              `2. Bank lines still pending: list_bank_transactions. For each, say what it looks like (a customer payment, a supplier payment, something else) and whether a matching invoice exists.`,
              `3. The trial balance over the period: trial_balance. Check that the debit and credit totals agree, and point out any suspense account that carries a balance.`,
              `4. The VAT: vat_return over the period. Report the boxes and the balance due or refundable.`,
              `5. What is still open: aged_balance at ${to}, receivable and payable.`,
              '',
              'Finish with a short list of what has to happen before this month can be locked, and ask before locking anything.',
            ].join('\n'),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    'prepare_vat_return',
    {
      title: 'Prepare a VAT return',
      description: 'Pull the boxes for a period and check them against the ledger before anything is filed.',
      argsSchema: {
        company_id: z.string().describe('The company to prepare the return for.'),
        from: z.string().describe('First day of the period, as YYYY-MM-DD.'),
        to: z.string().describe('Last day of the period, as YYYY-MM-DD.'),
      },
    },
    ({ company_id, from, to }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: [
              `Prepare the VAT return of company ${company_id} for ${from} to ${to}.`,
              '',
              '1. vat_return for the period. Report every box with its amount, and say which ones are computed from the others.',
              '2. Check that nothing is missing: list_documents with state "draft" over the period. A draft invoice is in no box, and that is usually the error.',
              '3. Tie the VAT accounts back to the ledger: general_ledger on the VAT payable and VAT recoverable accounts for the period, and compare with the boxes.',
              '4. Say what is due or refundable, and what would have to be corrected before filing.',
              '',
              'This prepares figures. It files nothing, and it changes nothing in the books.',
            ].join('\n'),
          },
        },
      ],
    }),
  );

  return server;
}
