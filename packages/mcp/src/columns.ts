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
  'trade_name',
  'legal_name',
  'legal_form',
  'country',
  'fiscal_country',
  'vat_number',
  'registration_number',
  'address_line1',
  'address_line2',
  'postal_code',
  'city',
  'country',
  'region',
  'email',
  'phone',
  'website',
  'logo_url',
  'share_capital::text',
  'share_capital_currency',
  'activity_code',
  'activity_scheme',
  'document_template',
  'default_bank_account_id',
  'language',
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
  'pinned',
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
  // a reader is not surprised by it once cash-basis VAT starts writing it.
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

/**
 * The mentions the law of a country puts on one document, from the view that
 * decides which of them apply. `text_i18n` crosses as it is: a renderer picks
 * the language, and the server has no business choosing one.
 */
export const DOCUMENT_LEGAL_MENTION = [
  'code',
  'applies_when',
  'text',
  'text_i18n',
  'sequence',
  'legal_reference',
];

/**
 * What the country of a document requires of it, beside the mentions: the
 * payment term the law sets, how the number is built, when the tax falls due
 * and how the document is exchanged. Read from `country_defaults`, which
 * holds null wherever the pack has said nothing — and null is the answer, not
 * an invitation to substitute another country's.
 */
export const COUNTRY_DOCUMENT_RULES = [
  'country',
  'numbering_gapless',
  'number_format',
  'legal_payment_days',
  'late_payment_reference',
  'tax_point_rule',
  'einvoice_profile',
  'einvoice_mandatory_from::text',
  'party_scheme',
  'vat_scheme',
];

/**
 * The header of a document, from the view that assembles it: the seller, the
 * buyer, the amounts, where it is paid and what the country of the document
 * requires. `document_line_items` is the lines and `document_legal_mentions`
 * the sentences — three reads, and no client holding a copy of the
 * letterhead.
 */
export const DOCUMENT_HEADER = [
  'document_id',
  'company_id',
  'doc_type',
  'state',
  'payment_state',
  'number',
  'supplier_reference',
  'document_date::text',
  'accounting_date::text',
  'due_date::text',
  'delivery_date::text',
  'currency_code',
  'amount_untaxed::text',
  'amount_tax::text',
  'amount_total::text',
  'amount_paid::text',
  'amount_residual::text',
  'payment_terms',
  'payment_means_code',
  'payment_reference',
  'buyer_reference',
  'order_reference',
  'contract_reference',
  'project_reference',
  'note',
  'payee_iban',
  'payee_bic',
  'seller_name',
  'seller_legal_name',
  'seller_legal_form',
  'seller_vat_number',
  'seller_registration_number',
  'seller_address_line1',
  'seller_address_line2',
  'seller_postal_code',
  'seller_city',
  'seller_country',
  'seller_email',
  'seller_phone',
  'seller_website',
  'seller_logo_url',
  'seller_share_capital::text',
  'seller_share_capital_currency',
  'seller_activity_code',
  'seller_activity_scheme',
  'document_template',
  'buyer_id',
  'buyer_name',
  'buyer_vat_number',
  'buyer_registration_number',
  'buyer_address_line1',
  'buyer_address_line2',
  'buyer_postal_code',
  'buyer_city',
  'buyer_country',
  'buyer_email',
  'country',
  'number_format',
  'numbering_gapless',
  'legal_payment_days',
  'late_payment_reference',
  'tax_point_rule',
  'einvoice_profile',
  'einvoice_mandatory_from::text',
  'party_scheme',
  'vat_scheme',
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
  // The currency of the line and its amount in it, written whenever that
  // currency is not the company's. A client matching two foreign lines needs
  // both: that is the scale the matching is worked out on.
  'currency_code',
  'amount_currency::text',
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

/**
 * An invitation, without its secret. `token_hash` is deliberately absent: it
 * is of no use to a client, and a list of hashes is a thing to leak rather
 * than a thing to show.
 */
/** What one person chose for themselves. Null everywhere is the fresh state. */
export const USER_PREFERENCES = [
  'user_id',
  'preferred_company_id',
  'language',
  'timezone',
  'date_display_format',
  'number_display_format',
  'theme',
  'updated_at::text',
];

export const INVITATION = [
  'id',
  'company_id',
  'email',
  'role',
  'capabilities_granted',
  'invited_by',
  'created_at::text',
  'expires_at::text',
  'accepted_at::text',
  'accepted_by',
  'revoked_at::text',
];

/** A machine key, without its hash. The secret is returned once, elsewhere. */
export const API_KEY = [
  'id',
  'company_id',
  'name',
  'prefix',
  'capabilities',
  'created_by',
  'created_at::text',
  'expires_at::text',
  'last_used_at::text',
  'revoked_at::text',
];

/** A public link onto a document, without its secret. There is only a hash. */
export const DOCUMENT_SHARE = [
  'id',
  'company_id',
  'document_id',
  'subject_kind',
  'created_by',
  'created_at::text',
  'expires_at::text',
  'revoked_at::text',
  'view_count',
  'last_viewed_at::text',
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
  // What the matching revealed, when it revealed something: the entry that
  // booked the realised exchange difference, and the one that moved the share
  // of a cash-basis tax the settlement made due. A client that shows a
  // matching shows what it caused.
  'fx_entry_id',
  'tax_transfer_entry_id',
];

export const AUDIT_LOG = [
  'id',
  'occurred_at::text',
  'actor_id',
  'api_key_id',
  'company_id',
  'table_name',
  'record_id',
  'record_key',
  'operation',
  'action',
  'old_values',
  'new_values',
];

/**
 * `country_packs` — which pack this installation holds, and where its rules
 * come from. `sources` is the register the pack declares: a reader that wants
 * to check a rate rather than trust it starts there.
 */
export const COUNTRY_PACK = [
  'country',
  'name',
  'version',
  'released_at::text',
  'schema_min',
  'certification_status',
  'certified_by',
  'certified_at::text',
  'checksum',
  'sources',
  'installed_at::text',
];
