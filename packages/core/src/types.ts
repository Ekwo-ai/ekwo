/**
 * Types of the Ekwo OS schema.
 *
 * Hand written rather than generated, so they stay readable and so the
 * package has no build-time dependency on a running database. They mirror
 * `supabase/migrations/`; `docs/schema.md` is the prose version.
 */

export type Uuid = string;
/** ISO 8601 calendar date, `YYYY-MM-DD`. */
export type IsoDate = string;
/** ISO 8601 timestamp with time zone. */
export type IsoTimestamp = string;
/** Postgres `numeric`, carried as a string so no cent is lost to a float. */
export type Decimal = string;

/**
 * One vocabulary for the whole installation. `instance_admin` is held by a
 * row in `instance_admins`; the other three are per company and live in
 * `company_members`, which refuses `instance_admin` by check constraint.
 */
export type MemberRole = 'instance_admin' | 'owner' | 'accountant' | 'viewer';

export type CompanyRole = Exclude<MemberRole, 'instance_admin'>;

export type InstanceEdition = 'community' | 'cloud';

/**
 * The installation itself: exactly one row, written by the installer.
 *
 * There is no `tenant_id` in this schema because the instance is the tenant.
 * `contact_email` and `registered_at` are an opt-in: they are empty on a
 * fresh install, nothing writes them unless the operator asks, and nothing
 * checks them.
 */
export interface Instance {
  id: 1;
  instance_id: Uuid;
  organization_name: string;
  country: string;
  edition: InstanceEdition;
  schema_version: string;
  installed_at: IsoTimestamp;
  contact_email: string | null;
  registered_at: IsoTimestamp | null;
}

/**
 * An instance administrator: creates companies and invites members. The
 * table name is the role, so there is no role column. `user_id` is a real
 * foreign key onto the customer's own `auth.users`.
 */
export interface InstanceAdmin {
  user_id: Uuid;
  created_at: IsoTimestamp;
}

/** True when the operator has opted into being registered with Ekwo. */
export function isRegistered(instance: Instance): boolean {
  return instance.registered_at !== null;
}

export const ACCOUNT_TYPES = [
  'asset_receivable',
  'asset_cash',
  'asset_current',
  'asset_prepayments',
  'asset_fixed',
  'asset_non_current',
  'liability_payable',
  'liability_credit_card',
  'liability_current',
  'liability_non_current',
  'equity',
  'equity_retained',
  'income',
  'income_other',
  'expense',
  'expense_direct_cost',
  'expense_depreciation',
  'off_balance',
] as const;

export type AccountType = (typeof ACCOUNT_TYPES)[number];

export type InternalGroup = 'asset' | 'liability' | 'equity' | 'income' | 'expense' | 'off_balance';

/** The balance-sheet group of an account type, as the database derives it. */
export function internalGroup(type: AccountType): InternalGroup {
  if (type === 'off_balance') return 'off_balance';
  const prefix = type.split('_')[0];
  switch (prefix) {
    case 'asset':
      return 'asset';
    case 'liability':
      return 'liability';
    case 'equity':
      return 'equity';
    case 'income':
      return 'income';
    default:
      return 'expense';
  }
}

export type JournalType = 'sales' | 'purchase' | 'bank' | 'cash' | 'general' | 'opening';
export type EntryState = 'draft' | 'posted' | 'cancelled';
export type ContactType = 'customer' | 'supplier' | 'both' | 'employee' | 'other';

export type DocType =
  | 'sale_invoice'
  | 'sale_credit_note'
  | 'sale_quote'
  | 'purchase_invoice'
  | 'purchase_credit_note'
  | 'purchase_order';

export type DocState = 'draft' | 'posted' | 'cancelled';
export type PaymentState = 'not_paid' | 'partially_paid' | 'paid' | 'overpaid' | 'reversed';
export type DocumentLineType = 'product' | 'section' | 'note';
export type TaxAmountType = 'percent' | 'fixed';
export type TaxScope = 'sale' | 'purchase' | 'both';
export type TaxDocumentKind = 'invoice' | 'credit_note';
export type TaxPostingType = 'base' | 'tax';

export type TaxTreatment =
  | 'domestic'
  | 'domestic_reverse_charge'
  | 'intracom_goods'
  | 'intracom_services'
  | 'intracom_acquisition_goods'
  | 'intracom_acquisition_services'
  | 'export'
  | 'import'
  | 'exempt'
  | 'not_subject';

export type PaymentDirection = 'inbound' | 'outbound';
export type BankTransactionState = 'pending' | 'reconciled' | 'ignored';

/** True for the four document types that produce a journal entry. */
export function isAccountable(type: DocType): boolean {
  return type !== 'sale_quote' && type !== 'purchase_order';
}

/** True for sales documents; the rest are purchases. */
export function isSale(type: DocType): boolean {
  return type.startsWith('sale_');
}

export function isCreditNote(type: DocType): boolean {
  return type === 'sale_credit_note' || type === 'purchase_credit_note';
}

export interface Company {
  id: Uuid;
  name: string;
  legal_name: string | null;
  legal_form: string | null;
  country: string;
  fiscal_country: string;
  vat_number: string | null;
  registration_number: string | null;
  address_line1: string | null;
  postal_code: string | null;
  city: string | null;
  email: string | null;
  currency_code: string;
  lock_date: IsoDate | null;
  tax_lock_date: IsoDate | null;
  receivable_account_id: Uuid | null;
  payable_account_id: Uuid | null;
  suspense_account_id: Uuid | null;
  retained_earnings_account_id: Uuid | null;
  sales_journal_id: Uuid | null;
  purchase_journal_id: Uuid | null;
  miscellaneous_journal_id: Uuid | null;
}

export interface CompanyMember {
  company_id: Uuid;
  user_id: Uuid;
  role: CompanyRole;
  created_at: IsoTimestamp;
}

export interface FiscalYear {
  id: Uuid;
  company_id: Uuid;
  name: string;
  start_date: IsoDate;
  end_date: IsoDate;
  is_closed: boolean;
}

export interface Account {
  id: Uuid;
  company_id: Uuid;
  code: string;
  name: string;
  account_type: AccountType;
  internal_group: InternalGroup;
  carries_forward: boolean;
  reconcilable: boolean;
  currency_code: string | null;
  parent_id: Uuid | null;
  deprecated: boolean;
}

export interface Journal {
  id: Uuid;
  company_id: Uuid;
  code: string;
  name: string;
  journal_type: JournalType;
  default_account_id: Uuid | null;
  suspense_account_id: Uuid | null;
  bank_account_id: Uuid | null;
  active: boolean;
}

export interface Contact {
  id: Uuid;
  company_id: Uuid;
  name: string;
  contact_type: ContactType;
  parent_id: Uuid | null;
  vat_number: string | null;
  auxiliary_code: string | null;
  email: string | null;
  country: string | null;
  payment_terms_days: number;
  receivable_account_id: Uuid | null;
  payable_account_id: Uuid | null;
  peppol_scheme: string | null;
  peppol_identifier: string | null;
  active: boolean;
}

export interface Tax {
  id: Uuid;
  company_id: Uuid;
  code: string;
  name: string;
  amount_type: TaxAmountType;
  amount: Decimal;
  applies_to: TaxScope;
  treatment: TaxTreatment;
  country: string | null;
  valid_from: IsoDate;
  valid_to: IsoDate | null;
  legal_reference: string | null;
  vat_category: string | null;
  active: boolean;
}

export interface TaxPosting {
  id: Uuid;
  tax_id: Uuid;
  company_id: Uuid;
  document_kind: TaxDocumentKind;
  posting_type: TaxPostingType;
  factor_percent: Decimal;
  account_id: Uuid | null;
  declaration_box: string | null;
  box_factor_percent: Decimal;
  sequence: number;
}

export interface Entry {
  id: Uuid;
  company_id: Uuid;
  journal_id: Uuid;
  fiscal_year_id: Uuid | null;
  number: string | null;
  entry_date: IsoDate;
  reference: string | null;
  description: string | null;
  state: EntryState;
  document_id: Uuid | null;
  total_debit: Decimal;
  total_credit: Decimal;
  is_balanced: boolean;
  posted_at: IsoTimestamp | null;
}

export interface EntryLine {
  id: Uuid;
  entry_id: Uuid;
  company_id: Uuid;
  account_id: Uuid;
  sequence: number;
  name: string | null;
  debit: Decimal;
  credit: Decimal;
  balance: Decimal;
  contact_id: Uuid | null;
  date_maturity: IsoDate | null;
  tax_id: Uuid | null;
  tax_line: boolean;
  declaration_box: string | null;
  box_amount: Decimal | null;
  matching_number: string | null;
  matched_amount: Decimal;
}

export interface EkwoDocument {
  id: Uuid;
  company_id: Uuid;
  doc_type: DocType;
  state: DocState;
  payment_state: PaymentState;
  number: string | null;
  supplier_reference: string | null;
  contact_id: Uuid;
  journal_id: Uuid | null;
  document_date: IsoDate;
  accounting_date: IsoDate | null;
  due_date: IsoDate | null;
  currency_code: string;
  buyer_reference: string | null;
  order_reference: string | null;
  payment_reference: string | null;
  amount_untaxed: Decimal;
  amount_tax: Decimal;
  amount_total: Decimal;
  amount_paid: Decimal;
  amount_residual: Decimal;
  reversed_document_id: Uuid | null;
  entry_id: Uuid | null;
  sent_at: IsoTimestamp | null;
}

/** What a product is: a service or goods. They are not taxed the same way. */
export type ProductKind = 'service' | 'goods';

/**
 * The unit codes worth offering, out of UN/ECE recommendation 20.
 *
 * The recommendation carries some eighteen hundred, and an invoice for
 * professional services uses five of them. This is the short list a client
 * proposes; `products.unit_code` accepts any well-formed code, because
 * refusing `KWH` or `TNE` in the database because a list here is short would
 * be the list deciding what a business may sell.
 */
export const UNIT_CODES = {
  C62: 'one (a piece)',
  HUR: 'hour',
  DAY: 'day',
  MON: 'month',
  ANN: 'year',
  KGM: 'kilogram',
  GRM: 'gram',
  TNE: 'tonne',
  LTR: 'litre',
  MTR: 'metre',
  MTK: 'square metre',
  MTQ: 'cubic metre',
  KMT: 'kilometre',
  KWH: 'kilowatt hour',
  SET: 'set',
  PR: 'pair',
} as const satisfies Record<string, string>;

export type UnitCode = keyof typeof UNIT_CODES;

/** True for one of the codes above. A code outside it may still be valid. */
export function isUnitCode(value: string): value is UnitCode {
  return Object.prototype.hasOwnProperty.call(UNIT_CODES, value);
}

/**
 * True for anything shaped like a UN/ECE rec. 20 code — the rule the database
 * enforces on `products.unit_code`, repeated here so a client can refuse the
 * value before the round trip rather than after it.
 */
export function isWellFormedUnitCode(value: string): boolean {
  return /^[A-Z0-9]{1,3}$/.test(value);
}

/**
 * A catalogue row. It fills a document line in and never constrains it: the
 * line keeps its own text, price, account and tax once it has them.
 */
export interface Product {
  id: Uuid;
  company_id: Uuid;
  /** EN 16931 BT-155, the seller's item identifier. Unique in the company. */
  code: string;
  /** EN 16931 BT-153. */
  name: string;
  /** EN 16931 BT-154. */
  description: string | null;
  kind: ProductKind;
  /** UN/ECE recommendation 20, BT-130. */
  unit_code: string;
  currency_code: string;
  sale_price: Decimal | null;
  purchase_price: Decimal | null;
  sale_account_id: Uuid | null;
  purchase_account_id: Uuid | null;
  sale_tax_id: Uuid | null;
  purchase_tax_id: Uuid | null;
  active: boolean;
}

export interface DocumentLine {
  id: Uuid;
  document_id: Uuid;
  company_id: Uuid;
  sequence: number;
  line_type: DocumentLineType;
  name: string;
  quantity: Decimal;
  unit_code: string;
  unit_price: Decimal;
  discount_percent: Decimal;
  tax_id: Uuid | null;
  account_id: Uuid | null;
  /** The catalogue row it was filled in from, when there was one. */
  product_id: Uuid | null;
  /** EN 16931 BT-154; `name` is BT-153. */
  description: string | null;
  vat_category: string | null;
  vat_rate: Decimal | null;
  amount_untaxed: Decimal;
}

/** One row of the `document_line_items` view: a line with its EN 16931 item terms. */
export interface DocumentLineItem {
  document_line_id: Uuid;
  document_id: Uuid;
  company_id: Uuid;
  sequence: number;
  line_type: DocumentLineType;
  /** BT-153. */
  item_name: string;
  /** BT-154. */
  item_description: string | null;
  /** BT-155, which is `products.code`. Null on a line with no product. */
  seller_item_identifier: string | null;
  product_id: Uuid | null;
  product_kind: ProductKind | null;
  quantity: Decimal;
  unit_code: string;
  unit_price: Decimal;
  discount_percent: Decimal;
  amount_untaxed: Decimal;
  tax_id: Uuid | null;
  vat_category: string | null;
  vat_rate: Decimal | null;
  account_id: Uuid | null;
}

/** One row of `trial_balance(company_id, from, to)`. */
export interface TrialBalanceRow {
  account_id: Uuid;
  account_code: string;
  account_name: string;
  account_type: AccountType;
  internal_group: InternalGroup;
  opening_balance: Decimal;
  debit: Decimal;
  credit: Decimal;
  closing_balance: Decimal;
}

/** One row of `aged_balance(company_id, at, group)`. */
export interface AgedBalanceRow {
  contact_id: Uuid | null;
  contact_name: string | null;
  account_id: Uuid;
  account_code: string;
  not_due: Decimal | null;
  days_1_30: Decimal | null;
  days_31_60: Decimal | null;
  days_61_90: Decimal | null;
  days_over_90: Decimal | null;
  total: Decimal;
}

/** One row of `vat_return(company_id, from, to)`. */
export interface VatReturnRow {
  box: string;
  kind: 'base' | 'tax' | 'total';
  amount: Decimal;
  /** True for boxes derived from the others, such as Belgian 71 and 72. */
  computed: boolean;
}
