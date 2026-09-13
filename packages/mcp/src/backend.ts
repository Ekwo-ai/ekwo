/**
 * The one interface every tool is written against.
 *
 * There are two ways to reach an Ekwo database and neither of them is a
 * privileged one. The recommended route is PostgREST with the signed-in
 * user's own token, which is how the schema is meant to be read and written:
 * row level security decides, exactly as it would for that person in a
 * browser. The second is a direct Postgres connection, for a self-hosted
 * installation and for the tests — and even there the claims and the role are
 * set on every call, so the same policies apply.
 *
 * Tools therefore never see a client, a token or a connection string. They
 * see `select`, `insert`, `update`, `remove` and `rpc`, and what comes back
 * is whatever the policies let through.
 */

export type Value = string | number | boolean | null;

export type Filter =
  | { column: string; op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte'; value: Value }
  | { column: string; op: 'in'; value: Value[] }
  | { column: string; op: 'ilike'; value: string }
  | { column: string; op: 'is'; value: null };

export interface Order {
  column: string;
  ascending?: boolean;
}

export interface SelectQuery {
  table: string;
  /**
   * The Postgres schema the table lives in. Undefined is `public`, which is
   * the socle; a module names its own — `assets`, `budgets` — and PostgREST
   * serves it only once the project lists it under its exposed schemas.
   */
  schema?: string;
  /**
   * Columns to read. A `numeric` column is asked for as `amount::text`, so it
   * arrives as the decimal string Postgres holds rather than as a float that
   * JSON happened to survive. Both backends understand that spelling.
   */
  columns: string[];
  where?: Filter[];
  order?: Order[];
  limit?: number;
}

export type Row = Record<string, unknown>;

export interface Backend {
  /** Which route this is, for `status` and for the error messages. */
  readonly mode: 'postgrest' | 'sql';
  /** Who we are acting as, when that is known. */
  readonly actingAs: string | undefined;
  /**
   * Calls a function of the schema. Always an array of rows, whatever the
   * function returns: PostgREST hands back an object for a function returning
   * one composite row and an array for a set, and a tool should not have to
   * care which route it came over.
   */
  rpc<T = Row>(fn: string, args?: Record<string, unknown>, schema?: string): Promise<T[]>;
  /** The same, for a function that returns nothing. */
  rpcVoid(fn: string, args?: Record<string, unknown>, schema?: string): Promise<void>;
  select<T = Row>(query: SelectQuery): Promise<T[]>;
  insert<T = Row>(table: string, rows: Row[], returning?: string[], schema?: string): Promise<T[]>;
  update<T = Row>(
    table: string,
    patch: Row,
    where: Filter[],
    returning?: string[],
    schema?: string,
  ): Promise<T[]>;
  remove(table: string, where: Filter[], schema?: string): Promise<void>;
  close(): Promise<void>;
}

/**
 * An error that carries what the database said.
 *
 * The accounting rules live in the schema and they raise with a prefixed code
 * — `period_locked:`, `entry_unbalanced:`, `document_total_mismatch:`. Those
 * messages are the most useful thing we can hand a model, so they travel up
 * unchanged; `hint` adds the sentence a human would add, never a replacement.
 */
export class EkwoMcpError extends Error {
  override name = 'EkwoMcpError';
  readonly code: string | undefined;
  readonly hint: string | undefined;

  constructor(message: string, options: { code?: string | undefined; hint?: string } = {}) {
    super(message);
    this.code = options.code;
    this.hint = options.hint;
  }
}

/** The identifier of a raise like `period_locked: 2026-03-31 is …`, or undefined. */
export function socleCode(message: string): string | undefined {
  const match = /^([a-z][a-z0-9_]{3,}):/.exec(message.trim());
  return match?.[1];
}

/**
 * What each socle refusal means, in one sentence.
 *
 * Only the codes a client of this server can actually provoke are listed. An
 * unknown code is not a failure of this table: the raw message is already the
 * answer, and the sentence is the part that was optional.
 */
const HINTS: Record<string, string> = {
  period_locked: 'The company has an accounting lock date on or after this date. Ask the owner to move lock_date, or book on a later date.',
  tax_period_locked: 'The company has a VAT lock date covering this date. Anything carrying a declaration box is frozen there.',
  fiscal_year_closed: 'The financial year covering this date is closed. Reopen it, or book in an open year.',
  entry_unbalanced: 'The debit and the credit of the entry differ. Nothing was posted.',
  entry_empty: 'The entry has no lines.',
  document_empty: 'The document has no billable line, so there is nothing to book.',
  document_already_posted: 'This document has already been booked. Read it back rather than posting it twice.',
  document_already_booked: 'This document already points at an entry. Read it back rather than posting it twice.',
  document_cancelled: 'A cancelled document cannot be booked.',
  document_not_accountable: 'Quotes and purchase orders are not booked. Turn it into an invoice first.',
  document_total_mismatch: 'The header total disagrees with what the lines book. The lines are right by construction, so the header is what needs fixing.',
  tax_not_in_force: 'That tax is not applicable on the accounting date. Pick the tax in force for that period.',
  unsupported_tax_amount_type: 'Only percentage taxes can be posted; a fixed-amount tax has no basis to spread.',
  no_counterpart_account: 'No receivable or payable account is set, either on the contact or as a company default.',
  no_journal: 'No journal was given and the company has no default for this kind of document.',
  no_bank_account: 'The payment names no bank account and its journal has no default account. create_bank_account adds one and wires it to the journal.',
  missing_account: 'The line names no account, and the company and its country model have no default for this kind of document. Give account_code on the line, or set the company default.',
  payment_already_booked: 'This payment already has an entry.',
  payment_cancelled: 'A cancelled payment cannot be booked.',
  reconcile_same_side: 'Matching pairs a debit with a credit; both lines are on the same side.',
  reconcile_account_mismatch: 'The two lines are on different accounts.',
  reconcile_over_debit: 'The amount is larger than what is still open on the debit line.',
  reconcile_over_credit: 'The amount is larger than what is still open on the credit line.',
  reconcile_nothing_left: 'Both lines are already fully matched.',
  account_not_reconcilable: 'That account is not reconcilable, so nothing on it can be matched.',
  unknown_document: 'No document with that id is visible to you.',
  unknown_entry_line: 'No ledger line with that id is visible to you.',
  unknown_reconciliation: 'No matching with that id is visible to you.',
  unknown_payment: 'No payment with that id is visible to you.',
};

/**
 * Check constraints that a client can legitimately provoke, in the words a
 * model can act on.
 *
 * Postgres names the constraint and nothing else — "violates check constraint
 * document_lines_product_has_account" says which rule broke and not what to
 * do. These few are the ones reachable through a tool, so they get the same
 * shape as a socle raise: an identifier, then a sentence.
 */
const CONSTRAINTS: Record<string, string> = {
  document_lines_product_has_account:
    'missing_account: a line has no account, and neither the product, the company nor the country model supplies a default for this kind of document',
};

/** The socle error, with the sentence that explains it when we have one. */
export function explain(message: string): EkwoMcpError {
  for (const [constraint, rewritten] of Object.entries(CONSTRAINTS)) {
    if (message.includes(constraint)) {
      const code = socleCode(rewritten);
      const hint = code === undefined ? undefined : HINTS[code];
      return new EkwoMcpError(rewritten, {
        ...(code !== undefined ? { code } : {}),
        ...(hint !== undefined ? { hint } : {}),
      });
    }
  }
  const code = socleCode(message);
  const hint = code === undefined ? undefined : HINTS[code];
  return new EkwoMcpError(message, { ...(code !== undefined ? { code } : {}), ...(hint !== undefined ? { hint } : {}) });
}

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

/**
 * Refuses anything that is not a plain lowercase identifier.
 *
 * Table and column names in this package are written in this package — none
 * of them comes from a tool argument. This function is the proof of that
 * rather than a defence against it, and it costs nothing to keep true.
 */
/**
 * `assets.assets`, or `assets` when there is no schema to name.
 *
 * Both halves go through `identifier()`, so a module code that came from the
 * registry rather than from this package still cannot be anything but a plain
 * lowercase name.
 */
export function qualified(schema: string | undefined, name: string): string {
  return schema === undefined ? identifier(name) : `${identifier(schema)}.${identifier(name)}`;
}

export function identifier(name: string): string {
  if (!IDENTIFIER.test(name)) {
    throw new EkwoMcpError(`bad_identifier: ${name} is not a plain column or table name`);
  }
  return name;
}

/** `amount::text` reads back as `amount`; every other column is itself. */
export function columnName(column: string): string {
  const cast = column.indexOf('::');
  return identifier(cast === -1 ? column : column.slice(0, cast));
}
