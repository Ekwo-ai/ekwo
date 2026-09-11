# Schema

The reference half of this document is generated from the migrations, so it
cannot drift from what the database actually holds. Regenerate it with
`node scripts/generate-schema-doc.mjs`.

## Shape

One installation belongs to one customer. That is why there is no `tenant_id`
anywhere: the instance is the tenant, and `instance` records it in a single
row written by the installer.

```
instance                                 one row: who installed it, where, which edition
instance_admins                          instance administrators
companies ─┬─ company_members            who may read or write, in three roles
           ├─ fiscal_years               periods, open or closed
           ├─ accounts                   chart of accounts, eighteen types
           ├─ journals ── journal_sequences
           ├─ contacts                   customers, suppliers, employees
           ├─ taxes ── tax_postings      ledger account and VAT box, per tax
           ├─ entries ── entry_lines     the ledger; the lines carry the truth
           ├─ documents ── document_lines invoices, credit notes, quotes
           ├─ payments                   money in and out
           ├─ reconciliations            bilateral matching, by amount
           ├─ bank_accounts ── bank_statements ── bank_transactions
           ├─ analytic_axes ── analytic_values ── entry_line_analytics
           └─ attachments                files, polymorphic
```

Reference data sits outside any company: `currencies`, `currency_rates`, and
the four template tables plus `country_defaults` that
`install_country_template()` copies into a new company.

## Six rules the schema enforces

1. **Amounts are positive.** `entry_lines` refuses a negative debit or credit
   and refuses a line carrying both. A reversal flips the side.
2. **A posted entry balances.** A check constraint on `entries`, with
   `total_debit` and `total_credit` maintained from the lines by trigger.
3. **Totals are derived.** `document_lines.amount_untaxed` is generated;
   document and entry totals are maintained by trigger; `documents.amount_paid`
   is recomputed from the matching on the third-party lines. Nothing is keyed
   in.
4. **A locked period refuses writes.** Triggers on `entries` and
   `entry_lines` consult `companies.lock_date`, `companies.tax_lock_date` and
   `fiscal_years.is_closed`. Matching stays allowed.
5. **A third-party account is reconcilable.** A check constraint refuses an
   `asset_receivable` or `liability_payable` account that is not.
6. **Every table has row level security.** At instance level, a row in
   `instance_admins` creates companies and invites members. Per company, `company_members` gives `viewer` read, `accountant`
   write, and `owner` administration of the company and its members. An
   instance administrator can see the list of companies and invite people
   into them; they cannot read a ledger they were not invited to.
7. **The instance row is a singleton.** A primary key of `1` and a check
   constraint make a second row impossible, not merely unusual.

## Registration is opt-in

`instance.contact_email` and `instance.registered_at` are empty on a fresh
install. Nothing writes them unless the operator calls `register_instance()`,
nothing in this repository reads them, and `unregister_instance()` puts them
back. Community works unregistered, forever. `instance.edition` records
whether Ekwo operates the installation; it gates nothing here.

## Account types

Eighteen values, grouped by the prefix before the first underscore, which is
what `internal_group` derives:

| Group | Types |
|---|---|
| `asset` | `asset_receivable`, `asset_cash`, `asset_current`, `asset_prepayments`, `asset_fixed`, `asset_non_current` |
| `liability` | `liability_payable`, `liability_credit_card`, `liability_current`, `liability_non_current` |
| `equity` | `equity`, `equity_retained` |
| `income` | `income`, `income_other` |
| `expense` | `expense`, `expense_direct_cost`, `expense_depreciation` |
| `off_balance` | `off_balance` |

`carries_forward` is generated too: true for everything except the income and
expense types.

## How a tax lands

A tax says how much. Its postings say where.

For each tax and each document kind (`invoice` or `credit_note`), `tax_postings`
holds at most one `base` posting and any number of `tax` postings. Each one
carries a `factor_percent`, a ledger account (for tax postings) and a
`declaration_box` with its own `box_factor_percent`.

`post_document()` applies them:

- the base amount goes to the account of the document line, and picks up the
  box of the base posting;
- for each tax posting, `round(tax x |factor| / 100, 2)` goes to that
  posting's account — on the same side as the base when `factor_percent` is
  positive, on the opposite side when it is negative;
- the declaration box receives `round(tax x box_factor / 100, 2)`,
  independently of which side the ledger amount landed on.

A Belgian intra-community purchase of goods at 21 % is therefore four rows:

| kind | type | factor | account | box | box factor |
|---|---|---|---|---|---|
| invoice | base | 100 | — | 86 | 100 |
| invoice | tax | 100 | 411000 recoverable | 59 | 100 |
| invoice | tax | −100 | 451000 payable | 55 | 100 |

which books `604 debit 1000 / 411 debit 210 / 451 credit 210 / 440 credit 1000`,
fills boxes 86, 59 and 55, and leaves the supplier owed 1 000. The ledger and
the return say the same thing, because they are the same rows.

## Posting a document

`post_document(document_id)` in order:

1. refuses a document that is already posted, cancelled, empty, or a quote;
2. refuses a tax that is not in force on the accounting date, or a
   fixed-amount tax;
3. checks the period is open;
4. writes one base line per `(account, tax)` pair;
5. writes the tax lines, grouping the basis per tax and rounding once;
6. writes the third-party counterpart as the difference of everything above,
   with `date_maturity` from the due date or the contact's payment terms;
7. raises if that counterpart disagrees with the document total by more than
   half a cent — the ledger is right by construction, so the header is what is
   wrong;
8. numbers and posts the entry, and points the document at it.


## Tables

| Table | Purpose |
|---|---|
| [`account_templates`](#account_templates) | Reference charts of accounts, one set per country. |
| [`accounts`](#accounts) | Chart of accounts, one per company. |
| [`analytic_axes`](#analytic_axes) | Analytic dimensions: cost centre, project, activity. |
| [`analytic_values`](#analytic_values) | Values of an axis, optionally hierarchical. |
| [`attachments`](#attachments) | Files attached to any record. `entity_type` is constrained rather than free text. |
| [`bank_accounts`](#bank_accounts) | Bank and card accounts, each mapped to a ledger account and a journal. |
| [`bank_statements`](#bank_statements) | Imported statements. `is_consistent` compares the declared closing balance with the sum of the lines. |
| [`bank_transactions`](#bank_transactions) | Statement lines. `amount` is signed; `raw` keeps whatever the source sent. |
| [`companies`](#companies) | Legal entities kept in this instance. One instance may hold several. |
| [`company_members`](#company_members) | Who may read or write a company. `owner` administers, `accountant` books, `viewer` reads. |
| [`contacts`](#contacts) | Third parties. `contact_type` is explicit rather than two hidden counters. |
| [`country_defaults`](#country_defaults) | Which template account plays which role, per country. |
| [`currencies`](#currencies) | ISO 4217 currencies known to this instance. |
| [`currency_rates`](#currency_rates) | Dated exchange rates. A document stores the rate it used; this table is the history. |
| [`document_lines`](#document_lines) | Document lines in a table, not JSON: EN 16931 needs a VAT category per line and the FEC needs the detail. |
| [`documents`](#documents) | Sales and purchase invoices, credit notes, quotes and orders. `state` is the document, `payment_state` the settlement. |
| [`entries`](#entries) | Journal entries. A document and its entry are two layers joined by a foreign key. |
| [`entry_line_analytics`](#entry_line_analytics) | Analytic split of a ledger line. One row per value, share in percent. |
| [`entry_lines`](#entry_lines) | Ledger lines. Amounts are always positive; a reversal flips the side, it never negates. |
| [`fiscal_years`](#fiscal_years) | Accounting periods. An exercise is an object, not two integers on the company. |
| [`instance`](#instance) | The installation itself. Exactly one row. Registration with Ekwo is optional and empty by default. |
| [`instance_admins`](#instance_admins) | Instance administrators: they create companies and invite members. One row per user, keyed on auth.users of the customer's own Supabase project. |
| [`journal_sequences`](#journal_sequences) | Counter behind next_entry_number(). One row per journal and year. |
| [`journal_templates`](#journal_templates) |  |
| [`journals`](#journals) | Books of entry. The code is the first segment of every entry number. |
| [`matching_sequences`](#matching_sequences) |  |
| [`payments`](#payments) | Money in and out. Amounts are positive; `direction` carries the sign. |
| [`products`](#products) | What a document line is filled in from: code, name, unit, price, account and tax. Not stock: no quantity on hand and no valuation. |
| [`reconciliations`](#reconciliations) | One row per pairing of a debit with a credit. Full matching is the sum of partials. |
| [`tax_posting_templates`](#tax_posting_templates) |  |
| [`tax_postings`](#tax_postings) | Where a tax lands: ledger account and VAT-return box, per tax and per document kind. |
| [`tax_templates`](#tax_templates) | Reference taxes per country, with their period of validity. |
| [`taxes`](#taxes) | VAT and similar taxes, with temporal validity and a legal reference. |

### `account_templates`

Reference charts of accounts, one set per country.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | not null |
| `country` | `character(2)` | not null |
| `code` | `text` | not null |
| `name` | `text` | not null |
| `account_type` | `account_type` | not null |
| `reconcilable` | `boolean` | not null |
| `parent_code` | `text` |  |
| `sequence` | `integer` | not null |

Constraints:

- `CHECK ((country ~ '^[A-Z]{2}$'::text))`
- `CHECK (((account_type <> ALL (ARRAY['asset_receivable'::account_type, 'liability_payable'::account_type])) OR reconcilable))`
- `PRIMARY KEY (id)`
- `UNIQUE (country, code)`

### `accounts`

Chart of accounts, one per company.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | not null |
| `company_id` | `uuid` | not null |
| `code` | `text` | not null |
| `name` | `text` | not null |
| `account_type` | `account_type` | not null |
| `internal_group` | `text` | generated — asset \| liability \| equity \| income \| expense \| off_balance, derived from account_type. |
| `carries_forward` | `boolean` | generated |
| `reconcilable` | `boolean` | not null — Whether entry lines on this account may be matched against each other. |
| `currency_code` | `character(3)` |  |
| `parent_id` | `uuid` |  |
| `deprecated` | `boolean` | not null |
| `notes` | `text` |  |
| `created_at` | `timestamp with time zone` | not null |
| `updated_at` | `timestamp with time zone` | not null |

Constraints:

- `CHECK (((account_type <> ALL (ARRAY['asset_receivable'::account_type, 'liability_payable'::account_type])) OR reconcilable))`
- `PRIMARY KEY (id)`
- `UNIQUE (company_id, code)`

### `analytic_axes`

Analytic dimensions: cost centre, project, activity.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | not null |
| `company_id` | `uuid` | not null |
| `code` | `text` | not null |
| `name` | `text` | not null |
| `active` | `boolean` | not null |
| `created_at` | `timestamp with time zone` | not null |
| `updated_at` | `timestamp with time zone` | not null |

Constraints:

- `PRIMARY KEY (id)`
- `UNIQUE (company_id, code)`

### `analytic_values`

Values of an axis, optionally hierarchical.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | not null |
| `company_id` | `uuid` | not null |
| `axis_id` | `uuid` | not null |
| `code` | `text` | not null |
| `name` | `text` | not null |
| `parent_id` | `uuid` |  |
| `active` | `boolean` | not null |
| `created_at` | `timestamp with time zone` | not null |
| `updated_at` | `timestamp with time zone` | not null |

Constraints:

- `PRIMARY KEY (id)`
- `UNIQUE (axis_id, code)`

### `attachments`

Files attached to any record. `entity_type` is constrained rather than free text.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | not null |
| `company_id` | `uuid` | not null |
| `entity_type` | `text` | not null |
| `entity_id` | `uuid` | not null |
| `file_name` | `text` | not null |
| `mime_type` | `text` |  |
| `byte_size` | `bigint` |  |
| `storage_path` | `text` | not null |
| `checksum` | `text` |  |
| `uploaded_by` | `uuid` |  |
| `created_at` | `timestamp with time zone` | not null |

Constraints:

- `CHECK ((entity_type = ANY (ARRAY['company'::text, 'contact'::text, 'document'::text, 'entry'::text, 'payment'::text, 'bank_statement'::text, 'bank_transaction'::text, 'fiscal_year'::text])))`
- `CHECK (((byte_size IS NULL) OR (byte_size >= 0)))`
- `PRIMARY KEY (id)`

### `bank_accounts`

Bank and card accounts, each mapped to a ledger account and a journal.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | not null |
| `company_id` | `uuid` | not null |
| `name` | `text` | not null |
| `iban` | `text` |  |
| `bic` | `text` |  |
| `bank_name` | `text` |  |
| `currency_code` | `character(3)` | not null |
| `account_id` | `uuid` |  |
| `journal_id` | `uuid` |  |
| `active` | `boolean` | not null |
| `created_at` | `timestamp with time zone` | not null |
| `updated_at` | `timestamp with time zone` | not null |

Constraints:

- `PRIMARY KEY (id)`

### `bank_statements`

Imported statements. `is_consistent` compares the declared closing balance with the sum of the lines.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | not null |
| `company_id` | `uuid` | not null |
| `bank_account_id` | `uuid` | not null |
| `name` | `text` |  |
| `statement_date` | `date` | not null |
| `balance_start` | `numeric(16,2)` | not null |
| `balance_end_declared` | `numeric(16,2)` | not null |
| `balance_end_computed` | `numeric(16,2)` | not null |
| `is_consistent` | `boolean` | generated |
| `state` | `bank_statement_state` | not null |
| `source` | `text` |  |
| `created_at` | `timestamp with time zone` | not null |
| `updated_at` | `timestamp with time zone` | not null |

Constraints:

- `PRIMARY KEY (id)`

### `bank_transactions`

Statement lines. `amount` is signed; `raw` keeps whatever the source sent.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | not null |
| `company_id` | `uuid` | not null |
| `statement_id` | `uuid` |  |
| `bank_account_id` | `uuid` | not null |
| `sequence` | `integer` | not null |
| `transaction_date` | `date` | not null |
| `value_date` | `date` |  |
| `amount` | `numeric(16,2)` | not null |
| `currency_code` | `character(3)` | not null |
| `description` | `text` |  |
| `counterpart_name` | `text` |  |
| `counterpart_iban` | `text` |  |
| `reference` | `text` |  |
| `structured_reference` | `text` |  |
| `contact_id` | `uuid` |  |
| `entry_id` | `uuid` |  |
| `state` | `bank_transaction_state` | not null |
| `raw` | `jsonb` |  |
| `created_at` | `timestamp with time zone` | not null |
| `updated_at` | `timestamp with time zone` | not null |

Constraints:

- `PRIMARY KEY (id)`

### `companies`

Legal entities kept in this instance. One instance may hold several.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | not null |
| `name` | `text` | not null |
| `legal_name` | `text` |  |
| `legal_form` | `text` |  |
| `country` | `character(2)` | not null |
| `fiscal_country` | `character(2)` | not null — Country whose VAT rules apply; differs from `country` for a foreign VAT registration. |
| `vat_number` | `text` |  |
| `registration_number` | `text` |  |
| `address_line1` | `text` |  |
| `address_line2` | `text` |  |
| `postal_code` | `text` |  |
| `city` | `text` |  |
| `email` | `text` |  |
| `phone` | `text` |  |
| `website` | `text` |  |
| `currency_code` | `character(3)` | not null |
| `lock_date` | `date` | Accounting lock: nothing may be booked on or before this date. |
| `tax_lock_date` | `date` |  |
| `receivable_account_id` | `uuid` |  |
| `payable_account_id` | `uuid` |  |
| `suspense_account_id` | `uuid` |  |
| `rounding_account_id` | `uuid` |  |
| `retained_earnings_account_id` | `uuid` |  |
| `sales_journal_id` | `uuid` |  |
| `purchase_journal_id` | `uuid` |  |
| `miscellaneous_journal_id` | `uuid` |  |
| `created_at` | `timestamp with time zone` | not null |
| `updated_at` | `timestamp with time zone` | not null |
| `default_sales_account_id` | `uuid` | Income account a sales line falls back to when it names none. Wired from country_defaults.sales_account_code at install. |
| `default_purchase_account_id` | `uuid` | Expense account a purchase line falls back to when it names none. Wired from country_defaults.purchase_account_code at install. |

Constraints:

- `CHECK ((country ~ '^[A-Z]{2}$'::text))`
- `CHECK ((currency_code ~ '^[A-Z]{3}$'::text))`
- `CHECK ((fiscal_country ~ '^[A-Z]{2}$'::text))`
- `PRIMARY KEY (id)`

### `company_members`

Who may read or write a company. `owner` administers, `accountant` books, `viewer` reads.

| Column | Type | Notes |
|---|---|---|
| `company_id` | `uuid` | not null |
| `user_id` | `uuid` | not null |
| `role` | `member_role` | not null |
| `created_at` | `timestamp with time zone` | not null |
| `updated_at` | `timestamp with time zone` | not null |

Constraints:

- `CHECK ((role <> 'instance_admin'::member_role))`
- `PRIMARY KEY (company_id, user_id)`

### `contacts`

Third parties. `contact_type` is explicit rather than two hidden counters.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | not null |
| `company_id` | `uuid` | not null |
| `name` | `text` | not null |
| `contact_type` | `contact_type` | not null |
| `is_company` | `boolean` | not null |
| `parent_id` | `uuid` | Billing parent; commercial_entity() walks to the root. |
| `vat_number` | `text` |  |
| `registration_number` | `text` |  |
| `auxiliary_code` | `text` | Sub-ledger code, exported as CompAuxNum in the FEC. |
| `email` | `text` |  |
| `phone` | `text` |  |
| `address_line1` | `text` |  |
| `address_line2` | `text` |  |
| `postal_code` | `text` |  |
| `city` | `text` |  |
| `country` | `character(2)` |  |
| `language` | `character(2)` |  |
| `currency_code` | `character(3)` |  |
| `payment_terms_days` | `smallint` | not null |
| `receivable_account_id` | `uuid` |  |
| `payable_account_id` | `uuid` |  |
| `iban` | `text` |  |
| `bic` | `text` |  |
| `peppol_scheme` | `text` |  |
| `peppol_identifier` | `text` |  |
| `active` | `boolean` | not null |
| `notes` | `text` |  |
| `created_at` | `timestamp with time zone` | not null |
| `updated_at` | `timestamp with time zone` | not null |

Constraints:

- `CHECK (((country IS NULL) OR (country ~ '^[A-Z]{2}$'::text)))`
- `CHECK (((parent_id IS NULL) OR (parent_id <> id)))`
- `CHECK ((payment_terms_days >= 0))`
- `PRIMARY KEY (id)`

### `country_defaults`

Which template account plays which role, per country.

| Column | Type | Notes |
|---|---|---|
| `country` | `character(2)` | not null |
| `name` | `text` | not null |
| `currency_code` | `character(3)` | not null |
| `receivable_code` | `text` | not null |
| `payable_code` | `text` | not null |
| `suspense_code` | `text` |  |
| `rounding_code` | `text` |  |
| `retained_earnings_code` | `text` |  |
| `sales_account_code` | `text` |  |
| `purchase_account_code` | `text` |  |
| `bank_account_code` | `text` |  |
| `sales_journal_code` | `text` | not null |
| `purchase_journal_code` | `text` | not null |
| `misc_journal_code` | `text` | not null |
| `cash_account_code` | `text` | Ledger account behind the cash journal of this country. 570000 in the PCMN, 530000 in the PCG. |

Constraints:

- `PRIMARY KEY (country)`

### `currencies`

ISO 4217 currencies known to this instance.

| Column | Type | Notes |
|---|---|---|
| `code` | `character(3)` | not null |
| `name` | `text` | not null |
| `symbol` | `text` |  |
| `decimal_places` | `smallint` | not null |
| `active` | `boolean` | not null |

Constraints:

- `CHECK ((code ~ '^[A-Z]{3}$'::text))`
- `CHECK (((decimal_places >= 0) AND (decimal_places <= 6)))`
- `PRIMARY KEY (code)`

### `currency_rates`

Dated exchange rates. A document stores the rate it used; this table is the history.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | not null |
| `currency_code` | `character(3)` | not null |
| `rate_date` | `date` | not null |
| `rate` | `numeric(18,8)` | not null |
| `source` | `text` |  |
| `created_at` | `timestamp with time zone` | not null |

Constraints:

- `CHECK ((rate > (0)::numeric))`
- `PRIMARY KEY (id)`
- `UNIQUE (currency_code, rate_date)`

### `document_lines`

Document lines in a table, not JSON: EN 16931 needs a VAT category per line and the FEC needs the detail.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | not null |
| `document_id` | `uuid` | not null |
| `company_id` | `uuid` | not null |
| `sequence` | `integer` | not null |
| `line_type` | `document_line_type` | not null |
| `name` | `text` | not null |
| `quantity` | `numeric(16,4)` | not null |
| `unit_code` | `text` | not null |
| `unit_price` | `numeric(16,6)` | not null |
| `discount_percent` | `numeric(7,4)` | not null |
| `tax_id` | `uuid` |  |
| `account_id` | `uuid` |  |
| `vat_category` | `character(2)` |  |
| `vat_rate` | `numeric(7,4)` |  |
| `amount_untaxed` | `numeric(16,2)` | generated — quantity x unit_price less the discount, rounded to two decimals once. |
| `created_at` | `timestamp with time zone` | not null |
| `updated_at` | `timestamp with time zone` | not null |
| `product_id` | `uuid` | The catalogue row this line was filled in from, when there was one. Nullable for ever: free text is how most invoices are written. |
| `description` | `text` | Item description, EN 16931 BT-154. `name` is BT-153. |

Constraints:

- `CHECK (((discount_percent >= (0)::numeric) AND (discount_percent < (100)::numeric)))`
- `CHECK (((line_type <> 'product'::document_line_type) OR (account_id IS NOT NULL)))`
- `PRIMARY KEY (id)`

### `documents`

Sales and purchase invoices, credit notes, quotes and orders. `state` is the document, `payment_state` the settlement.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | not null |
| `company_id` | `uuid` | not null |
| `doc_type` | `doc_type` | not null |
| `state` | `doc_state` | not null |
| `payment_state` | `payment_state` | not null |
| `number` | `text` |  |
| `supplier_reference` | `text` | The supplier's own invoice number on a purchase. |
| `contact_id` | `uuid` | not null |
| `journal_id` | `uuid` |  |
| `document_date` | `date` | not null |
| `accounting_date` | `date` | Date the entry is booked on; defaults to document_date. |
| `due_date` | `date` |  |
| `currency_code` | `character(3)` | not null |
| `exchange_rate` | `numeric(18,8)` | not null |
| `buyer_reference` | `text` |  |
| `project_reference` | `text` |  |
| `contract_reference` | `text` |  |
| `order_reference` | `text` |  |
| `delivery_date` | `date` |  |
| `delivery_address_line1` | `text` |  |
| `delivery_postal_code` | `text` |  |
| `delivery_city` | `text` |  |
| `delivery_country` | `character(2)` |  |
| `payment_terms` | `text` |  |
| `payment_means_code` | `text` |  |
| `payment_reference` | `text` |  |
| `payee_iban` | `text` |  |
| `note` | `text` |  |
| `currency_code_tax` | `character(3)` |  |
| `amount_untaxed` | `numeric(16,2)` | not null |
| `amount_tax` | `numeric(16,2)` | not null |
| `amount_total` | `numeric(16,2)` | not null |
| `amount_paid` | `numeric(16,2)` | not null — Derived from reconciliations on the third-party lines of the document's entry. A value written by hand is replaced at the next matching. |
| `amount_residual` | `numeric(16,2)` | generated |
| `reversed_document_id` | `uuid` |  |
| `entry_id` | `uuid` |  |
| `sent_at` | `timestamp with time zone` |  |
| `peppol_status` | `text` |  |
| `peppol_message_id` | `text` |  |
| `created_at` | `timestamp with time zone` | not null |
| `updated_at` | `timestamp with time zone` | not null |

Constraints:

- `CHECK (((state <> 'posted'::doc_state) OR (number IS NOT NULL)))`
- `CHECK ((exchange_rate > (0)::numeric))`
- `PRIMARY KEY (id)`

### `entries`

Journal entries. A document and its entry are two layers joined by a foreign key.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | not null |
| `company_id` | `uuid` | not null |
| `journal_id` | `uuid` | not null |
| `fiscal_year_id` | `uuid` |  |
| `number` | `text` | CODE/YYYY/NNNN, assigned at posting. |
| `entry_date` | `date` | not null |
| `reference` | `text` |  |
| `description` | `text` |  |
| `state` | `entry_state` | not null |
| `document_id` | `uuid` |  |
| `reversed_entry_id` | `uuid` |  |
| `currency_code` | `character(3)` |  |
| `total_debit` | `numeric(16,2)` | not null — Derived from entry_lines by trigger; the lines are authoritative. |
| `total_credit` | `numeric(16,2)` | not null |
| `is_balanced` | `boolean` | generated |
| `posted_at` | `timestamp with time zone` |  |
| `created_at` | `timestamp with time zone` | not null |
| `updated_at` | `timestamp with time zone` | not null |

Constraints:

- `CHECK (((state <> 'posted'::entry_state) OR (number IS NOT NULL)))`
- `CHECK (((state <> 'posted'::entry_state) OR (total_debit = total_credit)))`
- `PRIMARY KEY (id)`

### `entry_line_analytics`

Analytic split of a ledger line. One row per value, share in percent.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | not null |
| `company_id` | `uuid` | not null |
| `entry_line_id` | `uuid` | not null |
| `analytic_value_id` | `uuid` | not null |
| `percentage` | `numeric(7,3)` | not null |
| `amount` | `numeric(16,2)` |  |
| `created_at` | `timestamp with time zone` | not null |

Constraints:

- `CHECK (((percentage > (0)::numeric) AND (percentage <= (100)::numeric)))`
- `PRIMARY KEY (id)`
- `UNIQUE (entry_line_id, analytic_value_id)`

### `entry_lines`

Ledger lines. Amounts are always positive; a reversal flips the side, it never negates.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | not null |
| `entry_id` | `uuid` | not null |
| `company_id` | `uuid` | not null |
| `account_id` | `uuid` | not null |
| `sequence` | `integer` | not null |
| `name` | `text` |  |
| `debit` | `numeric(16,2)` | not null |
| `credit` | `numeric(16,2)` | not null |
| `balance` | `numeric(16,2)` | generated |
| `currency_code` | `character(3)` |  |
| `amount_currency` | `numeric(16,2)` |  |
| `contact_id` | `uuid` |  |
| `date_maturity` | `date` |  |
| `tax_id` | `uuid` |  |
| `tax_line` | `boolean` | not null |
| `declaration_box` | `text` | VAT-return box this line feeds, copied from the tax posting that produced it. |
| `box_amount` | `numeric(16,2)` | Amount to report in that box, in the sign the form expects. |
| `matching_number` | `text` | Reconciliation letter shared by matched lines. Exported as EcritureLet in the FEC. |
| `matched_amount` | `numeric(16,2)` | not null |
| `created_at` | `timestamp with time zone` | not null |
| `updated_at` | `timestamp with time zone` | not null |

Constraints:

- `CHECK (((debit >= (0)::numeric) AND (credit >= (0)::numeric)))`
- `CHECK (((matched_amount >= (0)::numeric) AND (matched_amount <= abs((debit - credit)))))`
- `CHECK (((debit = (0)::numeric) OR (credit = (0)::numeric)))`
- `PRIMARY KEY (id)`

### `fiscal_years`

Accounting periods. An exercise is an object, not two integers on the company.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | not null |
| `company_id` | `uuid` | not null |
| `name` | `text` | not null |
| `start_date` | `date` | not null |
| `end_date` | `date` | not null |
| `is_closed` | `boolean` | not null |
| `closed_at` | `timestamp with time zone` |  |
| `created_at` | `timestamp with time zone` | not null |
| `updated_at` | `timestamp with time zone` | not null |

Constraints:

- `CHECK ((end_date > start_date))`
- `PRIMARY KEY (id)`
- `UNIQUE (company_id, start_date)`

### `instance`

The installation itself. Exactly one row. Registration with Ekwo is optional and empty by default.

| Column | Type | Notes |
|---|---|---|
| `id` | `smallint` | not null |
| `instance_id` | `uuid` | not null — Stable identifier of this installation, generated locally. Never a licence key. |
| `organization_name` | `text` | not null |
| `country` | `character(2)` | not null |
| `edition` | `instance_edition` | not null — community when you run it yourself, cloud when Ekwo operates it. Gates nothing in this repository. |
| `schema_version` | `text` | not null — Version of the schema at install, updated by migrations. |
| `installed_at` | `timestamp with time zone` | not null |
| `contact_email` | `text` | Opt-in only: an address to reach the operator. Empty unless they asked to register. |
| `registered_at` | `timestamp with time zone` | Opt-in only: when the operator registered with Ekwo. Empty means not registered, which is a supported state. |
| `updated_at` | `timestamp with time zone` | not null |

Constraints:

- `CHECK ((country ~ '^[A-Z]{2}$'::text))`
- `CHECK (((registered_at IS NULL) OR (contact_email IS NOT NULL)))`
- `CHECK ((id = 1))`
- `PRIMARY KEY (id)`
- `UNIQUE (instance_id)`

### `instance_admins`

Instance administrators: they create companies and invite members. One row per user, keyed on auth.users of the customer's own Supabase project.

| Column | Type | Notes |
|---|---|---|
| `user_id` | `uuid` | not null — An auth.users.id in the customer's Supabase Auth. Ekwo holds no account and no directory. |
| `created_at` | `timestamp with time zone` | not null |
| `updated_at` | `timestamp with time zone` | not null |

Constraints:

- `PRIMARY KEY (user_id)`

### `journal_sequences`

Counter behind next_entry_number(). One row per journal and year.

| Column | Type | Notes |
|---|---|---|
| `journal_id` | `uuid` | not null |
| `year` | `smallint` | not null |
| `last_number` | `integer` | not null |

Constraints:

- `CHECK ((last_number >= 0))`
- `PRIMARY KEY (journal_id, year)`

### `journal_templates`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | not null |
| `country` | `character(2)` | not null |
| `code` | `text` | not null |
| `name` | `text` | not null |
| `journal_type` | `journal_type` | not null |
| `sequence` | `integer` | not null |

Constraints:

- `PRIMARY KEY (id)`
- `UNIQUE (country, code)`

### `journals`

Books of entry. The code is the first segment of every entry number.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | not null |
| `company_id` | `uuid` | not null |
| `code` | `text` | not null |
| `name` | `text` | not null |
| `journal_type` | `journal_type` | not null |
| `default_account_id` | `uuid` |  |
| `suspense_account_id` | `uuid` | Where a bank line lands before it is allocated. |
| `bank_account_id` | `uuid` |  |
| `currency_code` | `character(3)` |  |
| `active` | `boolean` | not null |
| `created_at` | `timestamp with time zone` | not null |
| `updated_at` | `timestamp with time zone` | not null |

Constraints:

- `CHECK ((code ~ '^[A-Z0-9]{2,8}$'::text))`
- `PRIMARY KEY (id)`
- `UNIQUE (company_id, code)`

### `matching_sequences`

| Column | Type | Notes |
|---|---|---|
| `company_id` | `uuid` | not null |
| `last_number` | `integer` | not null |

Constraints:

- `PRIMARY KEY (company_id)`

### `payments`

Money in and out. Amounts are positive; `direction` carries the sign.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | not null |
| `company_id` | `uuid` | not null |
| `direction` | `payment_direction` | not null |
| `payment_date` | `date` | not null |
| `amount` | `numeric(16,2)` | not null |
| `currency_code` | `character(3)` | not null |
| `contact_id` | `uuid` |  |
| `journal_id` | `uuid` | not null |
| `bank_account_id` | `uuid` |  |
| `entry_id` | `uuid` |  |
| `reference` | `text` |  |
| `memo` | `text` |  |
| `state` | `payment_state_t` | not null |
| `created_at` | `timestamp with time zone` | not null |
| `updated_at` | `timestamp with time zone` | not null |

Constraints:

- `CHECK ((amount > (0)::numeric))`
- `PRIMARY KEY (id)`

### `products`

What a document line is filled in from: code, name, unit, price, account and tax. Not stock: no quantity on hand and no valuation.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | not null |
| `company_id` | `uuid` | not null |
| `code` | `text` | not null — The seller's own item identifier, EN 16931 BT-155. Unique in the company. |
| `name` | `text` | not null — Item name, EN 16931 BT-153, copied onto the line it fills in. |
| `description` | `text` | Item description, EN 16931 BT-154. |
| `kind` | `product_kind` | not null |
| `unit_code` | `text` | not null — Unit of measure, UN/ECE recommendation 20 (BT-130). C62 is "one". |
| `currency_code` | `character(3)` | not null |
| `sale_price` | `numeric(16,6)` | Suggested net unit price on a sale. A line may carry another. |
| `purchase_price` | `numeric(16,6)` |  |
| `sale_account_id` | `uuid` |  |
| `purchase_account_id` | `uuid` |  |
| `sale_tax_id` | `uuid` |  |
| `purchase_tax_id` | `uuid` |  |
| `active` | `boolean` | not null |
| `created_at` | `timestamp with time zone` | not null |
| `updated_at` | `timestamp with time zone` | not null |

Constraints:

- `CHECK ((length(btrim(code)) > 0))`
- `CHECK (((purchase_price IS NULL) OR (purchase_price >= (0)::numeric)))`
- `CHECK (((sale_price IS NULL) OR (sale_price >= (0)::numeric)))`
- `CHECK ((unit_code ~ '^[A-Z0-9]{1,3}$'::text))`
- `PRIMARY KEY (id)`
- `UNIQUE (company_id, code)`

### `reconciliations`

One row per pairing of a debit with a credit. Full matching is the sum of partials.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | not null |
| `company_id` | `uuid` | not null |
| `debit_line_id` | `uuid` | not null |
| `credit_line_id` | `uuid` | not null |
| `amount` | `numeric(16,2)` | not null |
| `matching_number` | `text` | not null |
| `matched_at` | `date` | not null |
| `created_at` | `timestamp with time zone` | not null |

Constraints:

- `CHECK ((amount > (0)::numeric))`
- `CHECK ((debit_line_id <> credit_line_id))`
- `PRIMARY KEY (id)`
- `UNIQUE (debit_line_id, credit_line_id)`

### `tax_posting_templates`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | not null |
| `tax_template_id` | `uuid` | not null |
| `document_kind` | `tax_document_kind` | not null |
| `posting_type` | `tax_posting_type` | not null |
| `factor_percent` | `numeric(7,3)` | not null |
| `account_code` | `text` |  |
| `declaration_box` | `text` |  |
| `box_factor_percent` | `numeric(7,3)` | not null |
| `sequence` | `integer` | not null |

Constraints:

- `CHECK (((posting_type <> 'base'::tax_posting_type) OR (account_code IS NULL)))`
- `CHECK (((posting_type <> 'tax'::tax_posting_type) OR (account_code IS NOT NULL)))`
- `PRIMARY KEY (id)`

### `tax_postings`

Where a tax lands: ledger account and VAT-return box, per tax and per document kind.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | not null |
| `tax_id` | `uuid` | not null |
| `company_id` | `uuid` | not null |
| `document_kind` | `tax_document_kind` | not null |
| `posting_type` | `tax_posting_type` | not null |
| `factor_percent` | `numeric(7,3)` | not null — Accounting share. Positive keeps the base side, negative flips it (self-assessment). |
| `account_id` | `uuid` |  |
| `declaration_box` | `text` |  |
| `box_factor_percent` | `numeric(7,3)` | not null — Declaration share. Separate from factor_percent so a box always gets the sign the form expects. |
| `sequence` | `integer` | not null |
| `created_at` | `timestamp with time zone` | not null |
| `updated_at` | `timestamp with time zone` | not null |

Constraints:

- `CHECK (((posting_type <> 'base'::tax_posting_type) OR (account_id IS NULL)))`
- `CHECK (((posting_type <> 'tax'::tax_posting_type) OR (account_id IS NOT NULL)))`
- `PRIMARY KEY (id)`

### `tax_templates`

Reference taxes per country, with their period of validity.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | not null |
| `country` | `character(2)` | not null |
| `code` | `text` | not null |
| `name` | `text` | not null |
| `description` | `text` |  |
| `amount_type` | `tax_amount_type` | not null |
| `amount` | `numeric(12,4)` | not null |
| `applies_to` | `tax_scope` | not null |
| `treatment` | `tax_treatment` | not null |
| `valid_from` | `date` | not null |
| `valid_to` | `date` |  |
| `legal_reference` | `text` |  |
| `vat_category` | `character(2)` |  |
| `exemption_code` | `text` |  |
| `sequence` | `integer` | not null |

Constraints:

- `PRIMARY KEY (id)`
- `UNIQUE (country, code)`

### `taxes`

VAT and similar taxes, with temporal validity and a legal reference.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | not null |
| `company_id` | `uuid` | not null |
| `code` | `text` | not null |
| `name` | `text` | not null |
| `description` | `text` |  |
| `amount_type` | `tax_amount_type` | not null |
| `amount` | `numeric(12,4)` | not null — Percentage (21.0000) or fixed amount, per amount_type. |
| `applies_to` | `tax_scope` | not null |
| `treatment` | `tax_treatment` | not null |
| `country` | `character(2)` |  |
| `valid_from` | `date` | not null |
| `valid_to` | `date` |  |
| `legal_reference` | `text` |  |
| `vat_category` | `character(2)` | EN 16931 BT-118 / BT-151 category code. |
| `exemption_code` | `text` |  |
| `price_include` | `boolean` | not null |
| `sequence` | `integer` | not null |
| `active` | `boolean` | not null |
| `created_at` | `timestamp with time zone` | not null |
| `updated_at` | `timestamp with time zone` | not null |

Constraints:

- `CHECK (((country IS NULL) OR (country ~ '^[A-Z]{2}$'::text)))`
- `CHECK (((valid_to IS NULL) OR (valid_to >= valid_from)))`
- `PRIMARY KEY (id)`
- `UNIQUE (company_id, code)`

## Functions

| Function | Purpose |
|---|---|
| `account_id_by_code(p_company_id uuid, p_code text)` | Account of a company by its code, or NULL. |
| `aged_balance(p_company_id uuid, p_at date, p_group text)` | Open receivables (or payables) by age, from unmatched ledger lines. p_group is 'receivable' or 'payable'. |
| `assert_period_open(p_company_id uuid, p_date date, p_is_tax boolean)` | Raises when a date is protected by a lock date or a closed fiscal year. |
| `claim_instance_admin(p_user_id uuid)` | Makes a user an instance administrator. The first claim is open; afterwards only an administrator may appoint one. |
| `commercial_entity(p_contact_id uuid)` | Root of the contact parent chain; the entity a document is booked against. |
| `company_role(p_company_id uuid)` | Role of the current user on a company, or NULL when they are not a member. |
| `documents_refresh_amount_paid(p_document_id uuid)` | Recomputes what a document has been settled by, from the matched amounts on its third-party lines. |
| `ekwo_schema_version()` | Schema version of the installed release. Bumped by a migration, never by hand. |
| `fec_lines(p_company_id uuid, p_from date, p_to date)` | The eighteen columns of the French FEC for a period, in chronological order. |
| `fiscal_year_at(p_company_id uuid, p_date date)` | Fiscal year covering a date, or NULL. |
| `general_ledger(p_company_id uuid, p_from date, p_to date, p_account_ids uuid[])` | Posted lines of a period per account, with the balance carried forward from before the period. |
| `init_instance(p_organization_name text, p_country character, p_edition instance_edition)` | Records the installation. Called once, by the installer. Leaves the registration fields empty. |
| `install_country_template(p_company_id uuid, p_country character)` | Copies a country chart of accounts, journals and taxes into a company, wires the default roles — third parties, sales and purchase imputation, financial journals. |
| `is_any_company_member()` | Whether the current user belongs to at least one company of this installation. |
| `is_instance_admin()` | Whether the current user administers this installation. |
| `next_entry_number(p_journal_id uuid, p_date date)` | Next number for a journal and year, as CODE/YYYY/NNNN. Atomic: the counter row is locked, not the journal. Definer, because the counter is infrastructure and nobody writes it by hand. |
| `next_matching_number(p_company_id uuid)` | Next reconciliation letter for a company, as A0001. Definer, for the same reason as next_entry_number. |
| `post_document(p_document_id uuid)` | Books a document: base lines, tax lines from tax_postings, and a counterpart that balances by construction. |
| `post_entry(p_entry_id uuid)` | Validates, numbers and posts an entry. Raises rather than warning: a swallowed error is a missing entry. |
| `post_payment(p_payment_id uuid)` | Books a payment: the bank side from the payment's bank account or its journal, the third-party side by role. Matches nothing. |
| `reconcile(p_line_a uuid, p_line_b uuid, p_amount numeric)` | Matches a debit line against a credit line for an amount, defaulting to the smaller open amount. |
| `register_instance(p_contact_email text)` | Opt-in: records an address and a date so Ekwo can reach the operator. Never required, and reversible with unregister_instance(). |
| `resolve_counterpart_account(p_company_id uuid, p_contact_id uuid, p_is_sale boolean)` | Third-party account by role: contact override first, company default second. Never by code prefix. |
| `resolve_line_account(p_company_id uuid, p_doc_type doc_type, p_account_id uuid)` | Account of a document line: the line, then the company default, then the country model. Never a code prefix. |
| `resolve_line_account(p_company_id uuid, p_doc_type doc_type, p_product_id uuid, p_account_id uuid)` | Account of a document line: the line, the product, the company default, the country model. Never a code prefix. |
| `set_updated_at()` | Generic BEFORE UPDATE trigger keeping updated_at honest. |
| `tax_rate_at(p_tax_id uuid, p_date date)` | Percentage in force at a date, NULL when the tax does not apply then. |
| `trial_balance(p_company_id uuid, p_from date, p_to date)` | Opening balance, movements of the period and closing balance per account, posted entries only. |
| `unregister_instance()` | Undoes register_instance(). Opting in is reversible, or it is not a choice. |
| `vat_return(p_company_id uuid, p_from date, p_to date)` | VAT return boxes for a period, summed from the declaration boxes written on the ledger lines. |

---

*This file is generated by `scripts/generate-schema-doc.mjs`. Edit the
migrations and `docs/schema.intro.md`, then regenerate.*
