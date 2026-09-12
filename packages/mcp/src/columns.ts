/**
 * What each tool reads back, written once.
 *
 * Two rules run through every list. A `numeric` column is asked for as
 * `amount::text`, so the exact decimal arrives rather than a float; a `date`
 * or a timestamp likewise, so `2026-06-15` is a string on both routes instead
 * of whatever a driver decided a date object should be. Everything else —
 * uuid, text, boolean, integer — crosses unchanged.
 */

export const COMPANY = [
  'id',
  'name',
  'legal_name',
  'country',
  'fiscal_country',
  'vat_number',
  'registration_number',
  'city',
  'email',
  'currency_code',
  'lock_date::text',
  'tax_lock_date::text',
  'receivable_account_id',
  'payable_account_id',
  'suspense_account_id',
  'retained_earnings_account_id',
  'sales_journal_id',
  'purchase_journal_id',
  'miscellaneous_journal_id',
];

export const FISCAL_YEAR = ['id', 'name', 'start_date::text', 'end_date::text', 'is_closed'];

export const ACCOUNT = [
  'id',
  'code',
  'name',
  'account_type',
  'internal_group',
  'reconcilable',
  'currency_code',
  'deprecated',
];

export const JOURNAL = ['id', 'code', 'name', 'journal_type', 'active'];

export const CONTACT = [
  'id',
  'name',
  'contact_type',
  'vat_number',
  'auxiliary_code',
  'email',
  'country',
  'payment_terms_days',
  'receivable_account_id',
  'payable_account_id',
  'active',
];

export const TAX = [
  'id',
  'code',
  'name',
  'amount::text',
  'amount_type',
  'applies_to',
  'treatment',
  'vat_category',
  'valid_from::text',
  'valid_to::text',
  'legal_reference',
  // The generalised engine. `tax_kind` and `jurisdiction` say what a tax is
  // where the code alone would have to be guessed at; `recoverable` and
  // `price_include` change what a client should show; `cash_basis` is here so
  // a reader is not surprised by it when P0-6 starts writing it.
  'tax_kind',
  'recoverable',
  'jurisdiction',
  'price_include',
  'cash_basis',
  'active',
];

export const DOCUMENT = [
  'id',
  'company_id',
  'doc_type',
  'state',
  'payment_state',
  'number',
  'supplier_reference',
  'contact_id',
  'journal_id',
  'document_date::text',
  'accounting_date::text',
  'due_date::text',
  'currency_code',
  'amount_untaxed::text',
  'amount_tax::text',
  'amount_total::text',
  'amount_paid::text',
  'amount_residual::text',
  'entry_id',
  'sent_at::text',
];

export const PRODUCT = [
  'id',
  'company_id',
  'code',
  'name',
  'description',
  'kind',
  'unit_code',
  'currency_code',
  'sale_price::text',
  'purchase_price::text',
  'sale_account_id',
  'purchase_account_id',
  'sale_tax_id',
  'purchase_tax_id',
  'active',
];

export const DOCUMENT_LINE = [
  'id',
  'document_id',
  'sequence',
  'line_type',
  'name',
  'description',
  'product_id',
  'quantity::text',
  'unit_code',
  'unit_price::text',
  'discount_percent::text',
  'tax_id',
  'account_id',
  'vat_category',
  'vat_rate::text',
  'amount_untaxed::text',
];

export const ENTRY = [
  'id',
  'company_id',
  'journal_id',
  'number',
  'entry_date::text',
  'reference',
  'description',
  'state',
  'kind',
  'document_id',
  'total_debit::text',
  'total_credit::text',
  'is_balanced',
  'posted_at::text',
];

export const ENTRY_LINE = [
  'id',
  'entry_id',
  'account_id',
  'sequence',
  'name',
  'debit::text',
  'credit::text',
  'balance::text',
  'contact_id',
  'date_maturity::text',
  'tax_id',
  'tax_line',
  'declaration_box',
  'box_amount::text',
  'matching_number',
  'matched_amount::text',
];

export const BANK_ACCOUNT = [
  'id',
  'name',
  'iban',
  'bic',
  'bank_name',
  'currency_code',
  'account_id',
  'journal_id',
  'active',
];

export const BANK_TRANSACTION = [
  'id',
  'company_id',
  'bank_account_id',
  'statement_id',
  'transaction_date::text',
  'value_date::text',
  'amount::text',
  'currency_code',
  'description',
  'counterpart_name',
  'counterpart_iban',
  'reference',
  'structured_reference',
  'contact_id',
  'entry_id',
  'state',
];

export const PAYMENT = [
  'id',
  'company_id',
  'direction',
  'payment_date::text',
  'amount::text',
  'currency_code',
  'contact_id',
  'journal_id',
  'bank_account_id',
  'entry_id',
  'reference',
  'memo',
  'state',
];

export const INSTANCE = [
  'instance_id',
  'organization_name',
  'country',
  'edition',
  'schema_version',
  'installed_at::text',
  'registered_at::text',
];

export const RECONCILIATION = [
  'id',
  'debit_line_id',
  'credit_line_id',
  'amount::text',
  'matching_number',
  'matched_at::text',
];
