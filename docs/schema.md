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
| [`api_keys`](#api_keys) | Machine access to one company. Hashed at rest, scoped to an explicit list of capabilities, and never wider than the person who issued it. |
| [`attachments`](#attachments) | Files attached to any record. `entity_type` is constrained rather than free text. |
| [`audit_log`](#audit_log) | Append-only record of every change to the configuration and reference data of a company, and of the acts that change the state of a document, a payment, a financial year or a pack. Written by trigger, never by a client; no update and no delete, for anyone. |
| [`bank_accounts`](#bank_accounts) | Bank and card accounts, each mapped to a ledger account and a journal. |
| [`bank_statements`](#bank_statements) | Imported statements. `is_consistent` compares the declared closing balance with the sum of the lines. |
| [`bank_transactions`](#bank_transactions) | Statement lines. `amount` is signed; `raw` keeps whatever the source sent. |
| [`capabilities`](#capabilities) | Everything a member may be allowed to do, one row per code. Seeded by this migration for the core; a module adds its own with `area` set to the module code. |
| [`chart_templates`](#chart_templates) | Charts of accounts a country offers, from the `charts` list of packs/<cc>/pack.json. One of them is the default `ekwo init` installs when nobody names one. |
| [`companies`](#companies) | Legal entities kept in this instance. One instance may hold several. |
| [`company_invitations`](#company_invitations) | Pending and past invitations into a company. The token is handed over once and kept only as a sha256 hash. |
| [`company_members`](#company_members) | Who may read or write a company. `owner` administers, `accountant` books, `viewer` reads. |
| [`company_modules`](#company_modules) | Modules enabled on a company, and the settings that company keeps for each. Written by enable_module() and disable_module() and by nothing else: there is no write policy. |
| [`company_packs`](#company_packs) | Which version of which country pack a company copied. A company may hold two: a foreign VAT registration is one. |
| [`contacts`](#contacts) | Third parties. `contact_type` is explicit rather than two hidden counters. |
| [`country_defaults`](#country_defaults) | Which template account plays which role, per country. |
| [`country_packs`](#country_packs) | Country packs loaded in this installation, with their version and certification. |
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
| [`legal_mention_templates`](#legal_mention_templates) | The sentences a country requires on an invoice, and the closed condition that says when each applies. Reference data filled by a pack, never copied into a company. |
| [`matching_sequences`](#matching_sequences) |  |
| [`modules`](#modules) | One row per module this installation carries, written by the module's own first migration. The registry is a table, not code. |
| [`payments`](#payments) | Money in and out. Amounts are positive; `direction` carries the sign. |
| [`products`](#products) | What a document line is filled in from: code, name, unit, price, account and tax. Not stock: no quantity on hand and no valuation. |
| [`reconciliations`](#reconciliations) | One row per pairing of a debit with a credit. Full matching is the sum of partials. |
| [`role_capabilities`](#role_capabilities) | What each preset holds. A role is never tested by a policy; it is resolved here into capabilities. |
| [`statement_line_rules`](#statement_line_rules) | How an account of a company reaches a line. Presentation maps by range of the legal chart; choosing an account to post to by prefix stays forbidden, and is a different question. |
| [`statement_line_templates`](#statement_line_templates) | The lines of a statement, in the order it prints them, and the plus/minus lists a total is computed from. |
| [`statement_templates`](#statement_templates) | Financial statements per framework, from packs/<cc>/statements.json and packs/generic/. Reference data: never copied into a company. |
| [`tax_posting_templates`](#tax_posting_templates) |  |
| [`tax_postings`](#tax_postings) | Where a tax lands: ledger account and VAT-return box, per tax and per document kind. |
| [`tax_report_box_templates`](#tax_report_box_templates) | The boxes of a declaration form, and the plus/minus lists a total is computed from. Read by vat_return(). |
| [`tax_report_templates`](#tax_report_templates) | Declaration forms per country, from packs/<cc>/tax_report.json. Reference data: a form is not customisable, so it is never copied into a company. |
| [`tax_templates`](#tax_templates) | Reference taxes per country, with their period of validity. |
| [`taxes`](#taxes) | VAT and similar taxes, with temporal validity and a legal reference. |
| [`user_preferences`](#user_preferences) | What one person prefers, across every company they are a member of. Every column is nullable and none has a default: null means "take the company's answer, then the pack's". |

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
| `name_i18n` | `jsonb` | not null — Label by language, from packs/<cc>/i18n/. The pack's own language stays in `name`. |
| `statement_hint` | `text` | Free note: the statement line this account is meant for. Read by nothing — the rules of a statement decide — and kept so a chart can carry the intent. |
| `chart_code` | `text` | not null — Which chart of the country this account belongs to. Part of the natural key: two charts of one country may carry the same code with different meanings. |

Constraints:

- `CHECK ((country ~ '^[A-Z]{2}$'::text))`
- `CHECK (((account_type <> ALL (ARRAY['asset_receivable'::account_type, 'liability_payable'::account_type])) OR reconcilable))`
- `PRIMARY KEY (id)`

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
| `name_i18n` | `jsonb` | not null — Label by language, copied from the template at install. `name` holds the language the company chose. |
| `statement_hint` | `text` | Free note: the statement line this account is meant for. Read by nothing — the rules of a statement decide — and kept so a chart can carry the intent. |

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

### `api_keys`

Machine access to one company. Hashed at rest, scoped to an explicit list of capabilities, and never wider than the person who issued it.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | not null |
| `company_id` | `uuid` | not null |
| `name` | `text` | not null |
| `prefix` | `text` | not null — The readable head of the secret. It identifies a key without being one. |
| `key_hash` | `text` | not null |
| `capabilities` | `text[]` | not null — Exactly what this key may do. Not a role: a machine has a job, not a job title. |
| `created_by` | `uuid` | auth.users.id of whoever issued it. No foreign key, for the same reason company_members has none. |
| `created_at` | `timestamp with time zone` | not null |
| `expires_at` | `timestamp with time zone` |  |
| `last_used_at` | `timestamp with time zone` |  |
| `revoked_at` | `timestamp with time zone` |  |

Constraints:

- `CHECK (((expires_at IS NULL) OR (expires_at > created_at)))`
- `CHECK ((cardinality(capabilities) > 0))`
- `PRIMARY KEY (id)`
- `UNIQUE (key_hash)`

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

### `audit_log`

Append-only record of every change to the configuration and reference data of a company, and of the acts that change the state of a document, a payment, a financial year or a pack. Written by trigger, never by a client; no update and no delete, for anyone.

| Column | Type | Notes |
|---|---|---|
| `id` | `bigint` | not null |
| `occurred_at` | `timestamp with time zone` | not null |
| `actor_id` | `uuid` | auth.uid() at the time of the change. Null when the change came from a machine key or from a direct connection. |
| `api_key_id` | `uuid` | The machine key presented in the transaction, when one was. |
| `company_id` | `uuid` | The company the change belongs to, and what row level security reads. No foreign key: the trail outlives the row it describes. |
| `table_name` | `text` | not null |
| `record_id` | `uuid` |  |
| `record_key` | `text` | not null — The natural key of the row — an account code, a country, a user id — so a deleted row is still identifiable. |
| `operation` | `audit_operation` | not null |
| `action` | `text` | The business act this change is, when it is one. Null for an ordinary edit. |
| `old_values` | `jsonb` | The row before, as jsonb. Null on an insert. Secrets are replaced by null, never stored twice. |
| `new_values` | `jsonb` | The row after, as jsonb. Null on a delete. |

Constraints:

- `CHECK (((length(table_name) > 0) AND (length(record_key) > 0)))`
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

### `capabilities`

Everything a member may be allowed to do, one row per code. Seeded by this migration for the core; a module adds its own with `area` set to the module code.

| Column | Type | Notes |
|---|---|---|
| `code` | `text` | not null |
| `area` | `text` | not null — What the code belongs to — a table family of the core, or the code of a module. |
| `description` | `text` | not null |

Constraints:

- `CHECK ((code ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'::text))`
- `PRIMARY KEY (code)`

### `chart_templates`

Charts of accounts a country offers, from the `charts` list of packs/<cc>/pack.json. One of them is the default `ekwo init` installs when nobody names one.

| Column | Type | Notes |
|---|---|---|
| `country` | `character(2)` | not null |
| `code` | `text` | not null — Immutable once published. `default` on the chart a country shipped before this table existed. |
| `name` | `text` | not null |
| `name_i18n` | `jsonb` | not null |
| `is_default` | `boolean` | not null |
| `audience` | `text` | Who keeps books on this chart — companies, nonprofits, a profession. Free text from the pack: the core does nothing with it, an installer shows it. |
| `statements` | `text[]` | not null — Codes of the financial statements this chart reports on. Empty means the generic framework by account type is all there is. |
| `certification_status` | `pack_certification` | How much this chart in particular has been read, when it differs from the pack as a whole. Null means the pack's own status stands. |
| `legal_reference` | `text` |  |

Constraints:

- `CHECK ((country ~ '^[A-Z]{2}$'::text))`
- `PRIMARY KEY (country, code)`

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
| `language` | `character(2)` | not null — Language this company keeps its books in. Chosen at install; decides which label of name_i18n lands in accounts.name. |
| `region` | `text` | Province or state, ISO 3166-2 without the country prefix: QC, BC, CA. Null in a country that taxes uniformly. |
| `trade_name` | `text` | The name the company trades under, when it is not the statutory one. A renderer shows this and keeps legal_name for the footer. |
| `logo_url` | `text` | Where the logo is, as a URL or a storage path. The core stores no file: an accounting schema that held binaries would be backing up images with the ledger. |
| `share_capital` | `numeric(16,2)` | Capital to be stated on documents where the law requires it. Null where it does not, which is not zero. |
| `share_capital_currency` | `character(3)` | Currency the capital is expressed in. Filled with the company's own currency when it is left empty, and never with a currency written into the schema. |
| `activity_code` | `text` | The company's activity in the register of its country — NACE, APE, SIC. Text, because the registers are not numbers and not the same length. |
| `activity_scheme` | `text` | Which register activity_code belongs to. A code without its scheme cannot be looked up. |
| `default_bank_account_id` | `uuid` | The account a customer is asked to pay into. It fills documents.payee_iban (BT-84) when a sales document names none. |
| `document_template` | `text` | A code the renderer interprets. The core never reads it: what a document looks like is not an accounting question. |

Constraints:

- `CHECK ((country ~ '^[A-Z]{2}$'::text))`
- `CHECK ((currency_code ~ '^[A-Z]{3}$'::text))`
- `CHECK ((fiscal_country ~ '^[A-Z]{2}$'::text))`
- `CHECK (((share_capital IS NULL) OR (share_capital_currency IS NOT NULL)))`
- `CHECK (((share_capital IS NULL) OR (share_capital >= (0)::numeric)))`
- `PRIMARY KEY (id)`

### `company_invitations`

Pending and past invitations into a company. The token is handed over once and kept only as a sha256 hash.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | not null |
| `company_id` | `uuid` | not null |
| `email` | `text` | not null — The address the invitation is for, lower-cased. accept_invitation() refuses anyone signed in with another. |
| `role` | `member_role` | not null |
| `capabilities_granted` | `text[]` | not null — Capabilities the new member holds on top of their preset, written onto company_members when the invitation is accepted. |
| `token_hash` | `text` | not null |
| `invited_by` | `uuid` | auth.users.id of whoever issued it. No foreign key, for the same reason company_members has none. |
| `created_at` | `timestamp with time zone` | not null |
| `expires_at` | `timestamp with time zone` | not null |
| `accepted_at` | `timestamp with time zone` |  |
| `accepted_by` | `uuid` |  |
| `revoked_at` | `timestamp with time zone` |  |

Constraints:

- `CHECK (((accepted_at IS NULL) = (accepted_by IS NULL)))`
- `CHECK ((email = lower(email)))`
- `CHECK ((email ~~ '%_@_%'::text))`
- `CHECK ((expires_at > created_at))`
- `PRIMARY KEY (id)`
- `UNIQUE (token_hash)`

### `company_members`

Who may read or write a company. `owner` administers, `accountant` books, `viewer` reads.

| Column | Type | Notes |
|---|---|---|
| `company_id` | `uuid` | not null |
| `user_id` | `uuid` | not null |
| `role` | `member_role` | not null |
| `created_at` | `timestamp with time zone` | not null |
| `updated_at` | `timestamp with time zone` | not null |
| `capabilities_granted` | `text[]` | not null — Capabilities this member holds beyond their preset. |
| `capabilities_revoked` | `text[]` | not null — Capabilities this member does not hold whatever their preset says. A revoke wins over a grant and over a role. |

Constraints:

- `CHECK ((role <> 'instance_admin'::member_role))`
- `PRIMARY KEY (company_id, user_id)`

### `company_modules`

Modules enabled on a company, and the settings that company keeps for each. Written by enable_module() and disable_module() and by nothing else: there is no write policy.

| Column | Type | Notes |
|---|---|---|
| `company_id` | `uuid` | not null |
| `module_code` | `text` | not null |
| `enabled_at` | `timestamp with time zone` | not null |
| `enabled_by` | `uuid` |  |
| `settings` | `jsonb` | not null — Per-company settings of the module, in its own vocabulary. The socle never reads inside this object. |

Constraints:

- `PRIMARY KEY (company_id, module_code)`

### `company_packs`

Which version of which country pack a company copied. A company may hold two: a foreign VAT registration is one.

| Column | Type | Notes |
|---|---|---|
| `company_id` | `uuid` | not null |
| `country` | `character(2)` | not null |
| `version` | `text` | not null |
| `installed_at` | `timestamp with time zone` | not null |
| `upgraded_at` | `timestamp with time zone` | Last time `install_country_template` or `ekwo pack upgrade` moved this company to another version. |
| `chart_code` | `text` | not null — Chart of the pack this company copied. `ekwo status` prints it, and `ekwo pack upgrade` compares against the same chart. |

Constraints:

- `CHECK ((country ~ '^[A-Z]{2}$'::text))`
- `CHECK ((version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'::text))`
- `PRIMARY KEY (company_id, country)`

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
| `region` | `text` | Province or state of the party, ISO 3166-2 without the country prefix. Canadian tax follows the buyer's province, not the seller's. |

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
| `cash_account_code` | `text` | Ledger account behind the cash journal of this country, from the pack of that country. |
| `language_default` | `character(2)` | Language `ekwo init` offers for a company of this country, before the company row exists — like currency_code, and for the same reason. |
| `rounding_method` | `rounding_method` | not null — How a country rounds an amount, from the pack. Read by rounding_of() and applied by round_amount(), which is the only function of the schema that names a method. A pack that says nothing about rounding gets this column's own default, not a country's. |
| `cash_rounding_unit` | `numeric(8,4)` | not null — The smallest coin a cash total is rounded to when it is not the cent — 0.05 in Switzerland, 0.05 in the Netherlands for cash. **Declared, no reader yet**: no cash-payment path exists in the socle, so nothing rounds a total to it. Zero means the cent, which is what both packs declare. |
| `closing_style` | `closing_style` | Which of the three mechanisms close_fiscal_year() follows for a company of this country. Null until the pack says; there is no default, because a default would be one country's answer given to every other. |
| `current_year_result_profit_code` | `text` | Account the result of the year lands on when the year is profitable. Belgium 693, France 120. Null where the result goes straight to retained earnings. |
| `current_year_result_loss_code` | `text` | Same, for a loss. Belgium 793, France 129. Both countries keep a profit and a loss apart, so this is a pair and not one account. |
| `retained_earnings_loss_code` | `text` | Retained earnings account for an accumulated loss, where the chart keeps one apart from the profit account. Belgium 141, France 119. Null falls back to retained_earnings_code. |
| `opening_journal_code` | `text` | Code of the journal the opening and the year-end entries are booked on, from the pack. Null until the pack names one, and then nothing opens or closes: there is no code written into the schema to fall back on. |
| `numbering_gapless` | `boolean` | True where the law forbids a hole in the sequence of invoice numbers. Null until the pack says so. |
| `number_format` | `text` | Pattern of a document number: {CODE}, {YYYY} or {YY}, {MM}, {NNNN} zero-padded to as many N as are written, with literal text between them. Read by nothing yet; next_entry_number() produces CODE/YYYY/NNNN. |
| `legal_payment_days` | `integer` | Payment term the law sets in the absence of an agreement, in days. Not a company's own terms, which are documents.payment_terms. |
| `late_payment_reference` | `text` | Where the interest rate and the recovery indemnity for a late payment come from, in one sentence a renderer can print or an accountant can follow. |
| `tax_point_rule` | `text` | When the tax becomes chargeable under this country's general rule. A tax that departs from it says so itself, with cash_basis. |
| `einvoice_profile` | `text` | The structured invoice this country expects: peppol-bis-3, factur-x-en16931, xrechnung, a PINT profile. Null where electronic invoicing is not a thing. |
| `einvoice_mandatory_from` | `date` | The day the obligation starts. Where reception and emission start on different days, this is reception, which is what binds every company at once. |
| `party_scheme` | `text` | ISO 6523 ICD of the identifier a party is addressed by on the network, four digits. The pack carries the value; the core never guesses one. |
| `vat_scheme` | `text` | ISO 6523 ICD of the VAT identifier, four digits. Distinct from party_scheme: a company is addressed by its registration number and taxed on its VAT number, and they are not the same identifier. |
| `bank_statement_formats` | `text[]` | Statement formats a bank of this country sends — coda, camt.053, cfonb120 — from the pack. **Declared, no reader yet**: the socle has no statement importer; this is what one will dispatch on. A client that offers an import today reads it to know what to offer. |
| `payment_formats` | `text[]` | Payment file formats a bank of this country accepts — pain.001, cfonb160 — from the pack. **Declared, no reader yet**: the socle writes no payment file. Same shape as bank_statement_formats, and it will be read by the same phase. |
| `fiscal_year_default` | `text` | Month the financial year usually opens on: calendar, april, july, october. A default offered, never imposed — fiscal_years holds what a company actually keeps. |
| `fx_gain_code` | `text` | Account a realised exchange gain is booked on, from the pack. Null until the pack names one, and then a matching that realises a gain is refused rather than booked somewhere plausible. |
| `fx_loss_code` | `text` | The same for a realised loss. A pair, because every chart in scope keeps the gain and the loss apart. |
| `asset_disposal_gain_code` | `text` | Net-result disposal: the account a gain on the disposal of a fixed asset lands on (Belgium 763). Null under the gross style, and null until a pack names one. |
| `asset_disposal_loss_code` | `text` | Net-result disposal: the account a loss lands on (Belgium 663). Left empty where the chart keeps one account for both signs, and then the gain account answers for both. |
| `asset_disposal_proceeds_code` | `text` | Gross disposal: the income account the proceeds of a sale are booked on in full (France 775). Null under the net-result style. |
| `asset_disposal_value_code` | `text` | Gross disposal: the charge account the net book value of the asset sold is booked on in full (France 675). Null under the net-result style. |
| `name_i18n` | `jsonb` | not null — The country's own name by language, from packs/<cc>/i18n/. `name` holds it in English, which is what a country pack manifest is written in. |
| `languages` | `text[]` | not null — Languages this country pack publishes every label in, the language of the pack itself first. An installer offers them; nothing in the schema restricts a company to them. |
| `opening_entry_label` | `text` | Wording the computed opening lines of an export carry, from the pack, in the language the administration of this country reads. Null falls back to a neutral English label: the format fixes no wording, so there is no wrong answer to guess at. |

Constraints:

- `CHECK ((cash_rounding_unit >= (0)::numeric))`
- `CHECK (((fiscal_year_default IS NULL) OR (fiscal_year_default = ANY (ARRAY['calendar'::text, 'april'::text, 'july'::text, 'october'::text]))))`
- `CHECK (((legal_payment_days IS NULL) OR (legal_payment_days >= 0)))`
- `CHECK (((party_scheme IS NULL) OR (party_scheme ~ '^[0-9]{4}$'::text)))`
- `CHECK (((tax_point_rule IS NULL) OR (tax_point_rule = ANY (ARRAY['invoice_date'::text, 'delivery_date'::text, 'payment_date'::text]))))`
- `CHECK (((vat_scheme IS NULL) OR (vat_scheme ~ '^[0-9]{4}$'::text)))`
- `PRIMARY KEY (country)`

### `country_packs`

Country packs loaded in this installation, with their version and certification.

| Column | Type | Notes |
|---|---|---|
| `country` | `character(2)` | not null |
| `name` | `text` | not null |
| `version` | `text` | not null |
| `released_at` | `date` |  |
| `schema_min` | `text` |  |
| `certification_status` | `pack_certification` | not null — How much a pack has been read, printed by `ekwo init`: community (contributed, unread), maintained (by Ekwo, not yet reviewed), reviewed (by the professional named in certified_by). |
| `certified_by` | `text` | The professional who reviewed the pack. Only on a reviewed pack: maintaining is not reviewing. |
| `certified_at` | `date` |  |
| `checksum` | `text` | sha256 of the pack files, so a changed pack is visible without a diff. |
| `installed_at` | `timestamp with time zone` | not null |

Constraints:

- `CHECK ((country ~ '^[A-Z]{2}$'::text))`
- `CHECK ((version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'::text))`
- `PRIMARY KEY (country)`

### `currencies`

ISO 4217 currencies known to this instance.

| Column | Type | Notes |
|---|---|---|
| `code` | `character(3)` | not null |
| `name` | `text` | not null |
| `symbol` | `text` |  |
| `decimal_places` | `smallint` | not null — Decimals this currency is written with: 2 for the euro, 0 for the yen, 3 for the dinar. Read by rounding_of(), which is what every amount in the schema is rounded at. The columns that hold an amount are still numeric(16, 2), so a currency with more than two decimals is rounded right and stored short until they are widened. |
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
| `amount_untaxed` | `numeric(16,2)` | quantity x unit_price less the discount, rounded once at the decimals of the document's currency. Written by a trigger on every insert and update, so it is derived and never keyed in. |
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
| `exchange_rate` | `numeric(18,8)` | not null — Units of the document currency for one unit of the company currency, as currency_rates states it. The ledger amount is the document amount divided by it. 1 when the document is in the company currency. |
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
| `kind` | `entry_kind` | not null — normal, opening or closing. Written by opening_balance(), close_fiscal_year() and reopen_fiscal_year(), and by nothing else. |
| `module_code` | `text` | Which module wrote this entry, or null for an entry of the socle. Set by post_module_entry(). |
| `module_ref` | `text` | What the entry is for, in the module's own words — `depreciation:2026-03` , `disposal:<uuid>`. Unique per company and module, which is what makes a module's posting idempotent. |

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
| `amount_currency` | `numeric(16,2)` | The amount of this line in its own currency, written whenever that currency is not the company's. Positive like debit and credit; the side carries the sign. |
| `contact_id` | `uuid` |  |
| `date_maturity` | `date` |  |
| `tax_id` | `uuid` |  |
| `tax_line` | `boolean` | not null |
| `declaration_box` | `text` | VAT-return box this line feeds, copied from the tax posting that produced it. |
| `box_amount` | `numeric(16,2)` | Amount to report in that box, in the sign the form expects. A line of a cash-basis tax carries the amount with no box: it is computed when the document is posted and waits for the matching that names the box it is finally reported in. |
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
| `year` | `smallint` | not null — The period the counter belongs to: the year where the pattern carries one, and 0 where it does not and the series runs on. |
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
| `name_i18n` | `jsonb` | not null — Label by language, from packs/<cc>/i18n/. The language the pack itself is written in stays in `name`. |

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
| `name_i18n` | `jsonb` | not null — Label by language, copied from the template at install. `name` holds the language the company chose, and a company may rename a journal without losing the other languages. |

Constraints:

- `CHECK ((code ~ '^[A-Z0-9]{2,8}$'::text))`
- `PRIMARY KEY (id)`
- `UNIQUE (company_id, code)`

### `legal_mention_templates`

The sentences a country requires on an invoice, and the closed condition that says when each applies. Reference data filled by a pack, never copied into a company.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | not null |
| `country` | `character(2)` | not null |
| `code` | `text` | not null |
| `applies_when` | `text` | not null — One of nine conditions. A closed vocabulary and not an expression: a pack that could write a condition would be a pack that executes. |
| `text` | `text` | not null — The mention in the pack's own language. Other languages are in text_i18n, by language code. |
| `text_i18n` | `jsonb` | not null |
| `sequence` | `integer` | not null — Order the mentions are printed in. |
| `valid_from` | `date` | not null |
| `valid_to` | `date` |  |
| `legal_reference` | `text` | The article that requires this sentence. A mention without a source cannot be reviewed. |

Constraints:

- `CHECK ((applies_when = ANY (ARRAY['always'::text, 'reverse_charge'::text, 'intra_eu_goods'::text, 'intra_eu_services'::text, 'export'::text, 'exempt'::text, 'small_business'::text, 'late_payment'::text, 'cash_basis'::text])))`
- `CHECK ((country ~ '^[A-Z]{2}$'::text))`
- `CHECK (((valid_to IS NULL) OR (valid_to >= valid_from)))`
- `PRIMARY KEY (id)`
- `UNIQUE (country, code)`

### `matching_sequences`

| Column | Type | Notes |
|---|---|---|
| `company_id` | `uuid` | not null |
| `last_number` | `integer` | not null |

Constraints:

- `PRIMARY KEY (company_id)`

### `modules`

One row per module this installation carries, written by the module's own first migration. The registry is a table, not code.

| Column | Type | Notes |
|---|---|---|
| `code` | `text` | not null |
| `name` | `text` | not null |
| `description` | `text` |  |
| `schema_name` | `text` | not null — The Postgres schema the module lives in. PostgREST only exposes it once it is listed in the API settings, which no migration can do — `ekwo module enable` prints the line to add. |
| `version` | `text` | not null |
| `status` | `module_status` | not null |
| `requires_socle_min` | `text` | Oldest socle migration version this module needs. Read by `ekwo module enable` against the migration history. |
| `created_at` | `timestamp with time zone` | not null |
| `updated_at` | `timestamp with time zone` | not null |

Constraints:

- `CHECK ((code ~ '^[a-z][a-z0-9_]{1,30}$'::text))`
- `CHECK ((schema_name ~ '^[a-z][a-z0-9_]{1,30}$'::text))`
- `CHECK ((schema_name <> 'public'::text))`
- `PRIMARY KEY (code)`
- `UNIQUE (schema_name)`

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
| `exchange_rate` | `numeric(18,8)` | not null — Units of the payment currency for one unit of the company currency, as currency_rates states it. The ledger amount is the payment amount divided by it. 1 when the payment is in the company currency. |

Constraints:

- `CHECK ((amount > (0)::numeric))`
- `CHECK ((exchange_rate > (0)::numeric))`
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
| `fx_entry_id` | `uuid` | The entry that booked the realised exchange difference this matching revealed, or null. Written by reconcile() and read by unreconcile(), which reverses it. |
| `tax_transfer_entry_id` | `uuid` | Entry that moved the cash-basis tax this matching made due, when there was one. |

Constraints:

- `CHECK ((amount > (0)::numeric))`
- `CHECK ((debit_line_id <> credit_line_id))`
- `PRIMARY KEY (id)`
- `UNIQUE (debit_line_id, credit_line_id)`

### `role_capabilities`

What each preset holds. A role is never tested by a policy; it is resolved here into capabilities.

| Column | Type | Notes |
|---|---|---|
| `role` | `member_role` | not null |
| `capability` | `text` | not null |

Constraints:

- `PRIMARY KEY (role, capability)`

### `statement_line_rules`

How an account of a company reaches a line. Presentation maps by range of the legal chart; choosing an account to post to by prefix stays forbidden, and is a different question.

| Column | Type | Notes |
|---|---|---|
| `statement_code` | `text` | not null |
| `line_code` | `text` | not null |
| `sequence` | `integer` | not null — Order inside the line, and part of the key. Between two rules that both catch an account, the narrower one wins first, then this. |
| `rule_kind` | `text` | not null — account_code names one code; code_range and code_prefix compare the head of the code, so `40`..`41` takes 400000 and 411000 and stops at 42; account_type is what the generic framework is made of. |
| `code_from` | `text` |  |
| `code_to` | `text` |  |
| `account_type` | `account_type` |  |
| `balance_side` | `text` | not null — Which side of the account this line takes. `any` takes it whatever it holds; `debit` and `credit` split one account between two lines — a suspense account is a receivable when it is in debit and a payable when it is in credit. |

Constraints:

- `CHECK (
CASE rule_kind
    WHEN 'account_type'::text THEN ((account_type IS NOT NULL) AND (code_from IS NULL) AND (code_to IS NULL))
    WHEN 'code_range'::text THEN ((code_from IS NOT NULL) AND (code_to IS NOT NULL) AND (account_type IS NULL))
    ELSE ((code_from IS NOT NULL) AND (code_to IS NULL) AND (account_type IS NULL))
END)`
- `CHECK ((rule_kind = ANY (ARRAY['account_code'::text, 'code_range'::text, 'code_prefix'::text, 'account_type'::text])))`
- `CHECK ((balance_side = ANY (ARRAY['debit'::text, 'credit'::text, 'any'::text])))`
- `PRIMARY KEY (statement_code, line_code, sequence)`

### `statement_line_templates`

The lines of a statement, in the order it prints them, and the plus/minus lists a total is computed from.

| Column | Type | Notes |
|---|---|---|
| `statement_code` | `text` | not null |
| `code` | `text` | not null |
| `parent_code` | `text` | The line this one details, for a renderer that indents. Structure only: a parent that is a total says so with its plus list. |
| `name` | `text` | not null |
| `name_i18n` | `jsonb` | not null |
| `sequence` | `integer` | not null |
| `sign` | `smallint` | not null — Multiplies the debit-minus-credit balance so the line reads the way the scheme prints it: 1 on an asset or an expense, -1 on a liability, equity or income line. |
| `is_total` | `boolean` | not null |
| `plus_lines` | `text[]` | not null — Lines added into this total, by their code. Evaluated in `sequence` order, so a total may only name one computed before it. |
| `minus_lines` | `text[]` | not null |
| `xbrl_element` | `text` | What an XBRL filing writes for this line. The NBB CBSO taxonomy is dimensional, so the value is a fact key — a metric and its dimension members, `met:am1\|bas:m2` — and not an element name. Null where nothing is verified. |
| `legal_reference` | `text` |  |

Constraints:

- `CHECK ((is_total OR ((plus_lines = '{}'::text[]) AND (minus_lines = '{}'::text[]))))`
- `CHECK ((sign = ANY (ARRAY[1, '-1'::integer])))`
- `PRIMARY KEY (statement_code, code)`

### `statement_templates`

Financial statements per framework, from packs/<cc>/statements.json and packs/generic/. Reference data: never copied into a company.

| Column | Type | Notes |
|---|---|---|
| `code` | `text` | not null — Immutable once published. A new version of a scheme is a new code with its own validity, the way a new VAT rate is a new tax code. |
| `country` | `character(2)` | Null on the generic framework, which reports by account type and fits any chart of any country. |
| `chart_code` | `text` | Null means every chart of the country. Filled when a statement only makes sense on one — a nonprofit scheme on a nonprofit chart. |
| `name` | `text` | not null |
| `name_i18n` | `jsonb` | not null |
| `kind` | `text` | not null — balance_sheet reads balances cumulative to the end of the period; income_statement and allocation read the movements of the period; cash_flow is declared and not yet produced. |
| `framework` | `text` |  |
| `valid_from` | `date` | not null |
| `valid_to` | `date` |  |
| `legal_reference` | `text` |  |

Constraints:

- `CHECK (((chart_code IS NULL) OR (country IS NOT NULL)))`
- `CHECK (((country IS NULL) OR (country ~ '^[A-Z]{2}$'::text)))`
- `CHECK ((kind = ANY (ARRAY['balance_sheet'::text, 'income_statement'::text, 'cash_flow'::text, 'allocation'::text])))`
- `CHECK (((valid_to IS NULL) OR (valid_to >= valid_from)))`
- `PRIMARY KEY (code)`

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
| `report_code` | `text` | Declaration form the box belongs to (BE-VAT-PERIODIC, FR-CA3, CA-GST34…). Null means the periodic return of the country. |

Constraints:

- `CHECK (
CASE posting_type
    WHEN 'tax'::tax_posting_type THEN (account_code IS NOT NULL)
    ELSE (account_code IS NULL)
END)`
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
| `report_code` | `text` | Declaration form the box belongs to. Copied from the template, and read by vat_return(company, from, to, report_code) to pick out the boxes of one form where a country files more than one. |

Constraints:

- `CHECK (
CASE posting_type
    WHEN 'tax'::tax_posting_type THEN (account_id IS NOT NULL)
    ELSE (account_id IS NULL)
END)`
- `PRIMARY KEY (id)`

### `tax_report_box_templates`

The boxes of a declaration form, and the plus/minus lists a total is computed from. Read by vat_return().

| Column | Type | Notes |
|---|---|---|
| `country` | `character(2)` | not null |
| `report_code` | `text` | not null |
| `box` | `text` | not null |
| `kind` | `text` | not null — base, tax or total. Not an enum: vat_return() has always answered in text, and a form that invents a fourth kind is a core change either way. |
| `name` | `text` | not null |
| `name_i18n` | `jsonb` | not null |
| `sequence` | `integer` | not null |
| `plus_boxes` | `text[]` | not null — Boxes added into this total. A bare code names the box whatever its kind, "08:tax" names one kind — the French CA3 carries both on one line. |
| `minus_boxes` | `text[]` | not null |
| `floor_zero` | `boolean` | not null — A negative total is reported as zero, the other side of the pair carrying it: Belgian 71/72, French 25/28. |
| `hidden` | `boolean` | not null — An intermediate total the form does not print. vat_return() returns it with this flag rather than dropping it, so a caller can check a total it cannot see. |
| `xml_element` | `text` |  |
| `legal_reference` | `text` |  |
| `valid_from` | `date` | Null means the validity of the form itself. Filled only when a box appears or disappears inside one version of a form. |
| `valid_to` | `date` |  |

Constraints:

- `CHECK (((kind = 'total'::text) OR ((plus_boxes = '{}'::text[]) AND (minus_boxes = '{}'::text[]))))`
- `CHECK ((kind = ANY (ARRAY['base'::text, 'tax'::text, 'total'::text])))`
- `CHECK (((valid_to IS NULL) OR (valid_to >= valid_from)))`
- `PRIMARY KEY (country, report_code, box, kind)`

### `tax_report_templates`

Declaration forms per country, from packs/<cc>/tax_report.json. Reference data: a form is not customisable, so it is never copied into a company.

| Column | Type | Notes |
|---|---|---|
| `country` | `character(2)` | not null |
| `code` | `text` | not null — BE-VAT-PERIODIC, FR-CA3. Immutable once published; a new version of a form is a new code with its own validity. |
| `name` | `text` | not null |
| `name_i18n` | `jsonb` | not null — Label by language. The pack format has no key for it yet, so it stays empty until i18n/ carries one. |
| `period` | `text` | not null |
| `valid_from` | `date` | not null |
| `valid_to` | `date` |  |
| `legal_reference` | `text` |  |
| `is_periodic_return` | `boolean` | not null — True for the return a company files every month or quarter. vat_return() falls back to the one of the company's fiscal country. |

Constraints:

- `CHECK ((country ~ '^[A-Z]{2}$'::text))`
- `CHECK ((period = ANY (ARRAY['month'::text, 'quarter'::text, 'month_or_quarter'::text, 'year'::text])))`
- `CHECK (((valid_to IS NULL) OR (valid_to >= valid_from)))`
- `PRIMARY KEY (country, code)`

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
| `tax_kind` | `tax_kind` | not null — vat, gst, sales_tax, withholding, other. A label for the reports, never an input to the calculation. |
| `recoverable` | `boolean` | not null — False when the buyer never gets the tax back: American sales tax, Canadian PST. Where it lands is said by a tax_on_base posting. |
| `jurisdiction` | `text` | ISO 3166-2 with the country prefix — CA-QC, US-CA — for a tax levied by a state. Null in Europe. |
| `price_include` | `boolean` | not null — The unit price already holds the tax (UK and Australian retail). `taxes` carried this from the start and the template did not. |
| `cash_basis` | `boolean` | not null — The tax falls due when the invoice is paid rather than when it is issued, which is how France taxes services. post_document() books it on the transition account below and on no declaration box; reconcile() moves the settled share to the account and the box it is declared on. |
| `cash_basis_transition_account_code` | `text` | Account the tax waits on between the invoice and its payment, by code in the chart of this country. Only read when cash_basis is true. |
| `name_i18n` | `jsonb` | not null — Label by language, from packs/<cc>/i18n/. A translation of the same tax, never a different rate or a different rule. |

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
| `tax_kind` | `tax_kind` | not null — vat, gst, sales_tax, withholding, other. A label for the reports, never an input to the calculation. |
| `recoverable` | `boolean` | not null — False when the buyer never gets the tax back. The ledger consequence is a tax_on_base posting, not this column. |
| `jurisdiction` | `text` | ISO 3166-2 with the country prefix, for a tax levied by a state. Null in Europe. |
| `cash_basis` | `boolean` | not null — The tax falls due when the invoice is paid rather than when it is issued. The share that has been settled is what reaches the declaration. |
| `cash_basis_transition_account_id` | `uuid` | Account the tax waits on between the invoice and its payment. Only read when cash_basis is true. |
| `name_i18n` | `jsonb` | not null — Label by language, copied from the template at install. `name` holds the language the company chose. |

Constraints:

- `CHECK (((country IS NULL) OR (country ~ '^[A-Z]{2}$'::text)))`
- `CHECK (((valid_to IS NULL) OR (valid_to >= valid_from)))`
- `PRIMARY KEY (id)`
- `UNIQUE (company_id, code)`

### `user_preferences`

What one person prefers, across every company they are a member of. Every column is nullable and none has a default: null means "take the company's answer, then the pack's".

| Column | Type | Notes |
|---|---|---|
| `user_id` | `uuid` | not null |
| `preferred_company_id` | `uuid` | The company an interface opens on. Cleared rather than kept when that company is deleted. |
| `language` | `text` | Language this person reads labels in. First in the list preferred_languages() builds. |
| `timezone` | `text` |  |
| `date_display_format` | `text` |  |
| `number_display_format` | `text` |  |
| `theme` | `text` | A client's business. The core stores it and interprets nothing. |
| `created_at` | `timestamp with time zone` | not null |
| `updated_at` | `timestamp with time zone` | not null |

Constraints:

- `CHECK (((language IS NULL) OR (language ~ '^[a-z]{2}(-[A-Za-z0-9]{2,8})?$'::text)))`
- `PRIMARY KEY (user_id)`

## Functions

| Function | Purpose |
|---|---|
| `accept_invitation(p_token text)` | Turns an invitation into a membership for the signed-in user, whose address has to be the one invited. Single use, and refused once expired. |
| `account_id_by_code(p_company_id uuid, p_code text)` | Account of a company by its code, or NULL. |
| `aged_balance(p_company_id uuid, p_at date, p_group text)` | Ageing of what is still open, read from the ledger and from the matching, written at the decimals of the company's currency. Two groups, receivable and payable; anything else is refused by name. |
| `amount_text_format(p_rounding money_rounding)` | The to_char mask an amount of this currency is written with. Two decimals for the euro, none for the yen, three for the dinar. |
| `assert_period_open(p_company_id uuid, p_date date, p_is_tax boolean)` | Raises when a date is protected by a lock date or a closed fiscal year. |
| `audit_changes()` | The generic audit trigger. One jsonb argument names the company column, the natural key, the columns to redact and the acts an insert or a delete stands for. |
| `audit_entry_posting()` | Records that an entry was posted, cancelled, or posted as the reversal of another. The lines themselves are not audited: a posted entry is immutable and is corrected by a reversal. |
| `audit_log_is_append_only()` | Refuses every update and every delete on audit_log, table owner included. purge_audit_log() sets ekwo.audit_purge for its own transaction, which is the one exception. |
| `audit_record(p_company_id uuid, p_table text, p_record_id uuid, p_record_key text, p_operation audit_operation, p_action text, p_old jsonb, p_new jsonb)` | Writes one row of the audit trail. Called by the triggers of this schema and by the functions that perform an act; never by a client. |
| `audit_state_change()` | Records the act a state column stands for — a document posted, a payment booked, a year closed — with the fields that identify the row and never the whole of it. |
| `available_statements(p_company_id uuid, p_at date)` | Statements a company may ask for: those of its country and chart, plus the generic framework. `is_default` marks the ones its chart declares. |
| `can_write_company(p_company_id uuid)` | Whether the current caller may write the books of a company. One capability, not a role, and false rather than NULL for a stranger. |
| `catch_up_journal_sequence(p_journal_id uuid, p_date date, p_number text)` | Advances a journal counter to an imported number, so the next automatic one continues the series rather than colliding with it. Does nothing for a number that does not follow the country's pattern. |
| `claim_instance_admin(p_user_id uuid)` | Makes a user an instance administrator. The first claim is open; afterwards only an administrator may appoint one. |
| `close_fiscal_year(p_fiscal_year_id uuid)` | Closes a fiscal year: the result leaves the income statement the way the country model says, and every income and expense account goes back to zero. The entry that moves the result is `appropriation`, the one that empties the income statement is `closing`. The balance sheet needs no entry — the reports read the ledger from the beginning. The allocation decided by a meeting is never part of it. |
| `commercial_entity(p_contact_id uuid)` | Root of the contact parent chain; the entity a document is booked against. |
| `companies_default_capital_currency()` | A capital stated with no currency is stated in the company's own. The alternative was a literal in the schema, which is one country's answer given to every country. |
| `company_role(p_company_id uuid)` | Role of the current user on a company, or NULL when they are not a member. |
| `create_api_key(p_company_id uuid, p_name text, p_capabilities jsonb, p_expires_at timestamp with time zone)` | Issues a machine key on one company and returns the secret once. Only the hash is stored, and no capability can be put on a key that the person issuing it does not hold. |
| `create_company(p_name text, p_country character, p_currency_code character, p_language character, p_chart_code text, p_fiscal_year integer, p_fiscal_year_start date, p_owner_user_id uuid)` | Creates a company, makes the caller its first member, copies the country pack into it and opens its first financial year on the month that pack declares. An instance-level act, like the policy on companies. |
| `currency_of_bank_account()` | Fills a statement line's currency_code from its bank account, and from the company as a last resort. |
| `currency_of_company()` | Fills currency_code from the company when the caller named none. The one place the question is answered for a table that belongs to a company. |
| `currency_unit(p_rounding money_rounding)` | The smallest amount a currency has: a cent in the euro, a yen in the yen. A tolerance is written as a fraction of this rather than as a fraction of a cent. |
| `current_api_key()` | The key presented in this transaction, or nothing. What a client reads back to know what it may do. |
| `disable_module(p_company_id uuid, p_code text)` | Disables a module on a company, unless the module says it still holds data — `<schema>.can_disable(company)` returning a sentence refuses, returning null allows. Nothing the module wrote is deleted. Needs company.write. |
| `document_lines_amount_untaxed()` | Derives a line's amount from its quantity, price and discount, rounded once at the decimals of the document's currency. What the generated column used to do, minus the assumption that every currency has cents. |
| `documents_default_payee_iban()` | A sales document with no payee IBAN takes the company's default bank account. A purchase document never does: the payee there is somebody else. |
| `documents_refresh_amount_paid(p_document_id uuid)` | Recomputes what a document has been settled by, from the matched amounts on its third-party lines. |
| `ekwo_schema_version()` | Schema version of the installed release. Bumped by a migration, never by hand. |
| `enable_module(p_company_id uuid, p_code text, p_settings jsonb)` | Enables a module on a company, and updates its settings when it is already enabled. Needs company.write, checked here because the table has no write policy. |
| `entries_guard_kind()` | Keeps entries.kind on `normal` outside the three functions that open and close a year. A label any client may set is a label a statement cannot be built on. |
| `entries_guard_module()` | Keeps the module tag of an entry honest: a module the company holds, never posted on insert, never moved afterwards. |
| `evaluate_totals(p_values jsonb, p_formulas jsonb, p_rounding money_rounding, p_keep_zero boolean)` | Works out the totals of a declaration form or a statement from the figures below them, rounding each at the decimals of the currency it is stated in. |
| `fec_lines(p_company_id uuid, p_from date, p_to date)` | The eighteen columns of the French FEC for a period: the opening balances of the financial year first, computed and never posted, then its movements in chronological order. The entries the close wrote are left out — the file carries the income statement in its ordinary lines, and the result reaches the balance sheet in the opening lines of the year that follows. |
| `financial_statement(p_company_id uuid, p_statement_code text, p_from date, p_to date)` | One financial statement of a company for a period: each line summed from the accounts its rules catch, then the totals evaluated in the order the scheme declares them. No country rule lives in this function. |
| `fiscal_year_at(p_company_id uuid, p_date date)` | Fiscal year covering a date, or NULL. |
| `fiscal_year_bounds(p_country character, p_year integer, p_start date, OUT start_date date, OUT end_date date)` | The first and last day of a financial year opening in a given calendar year, on the month the country pack declares — or on a day the caller names. Raises rather than assuming January. |
| `fiscal_years_guard_closed()` | Refuses a hand-written change to is_closed. A column any client may flip is not a lock. |
| `format_number(p_format text, p_code text, p_date date, p_number integer)` | One document number, rendered from the pattern the country pack declares. Raises rather than guessing at a token it does not know. |
| `general_ledger(p_company_id uuid, p_from date, p_to date, p_account_ids uuid[])` | Posted lines of a period per account, with the balance carried forward from before the period. |
| `has_capability(p_company_id uuid, p_capability text)` | Whether the current caller may do one named thing in one company — a signed-in member by their preset and their adjustments, or a machine key by its own list. Revoked beats granted, and a non-member holding no key holds nothing. |
| `has_opening_entry(p_fiscal_year_id uuid)` | Whether a fiscal year already carries an opening entry that still stands — an imported balance or the re-opening of the year before. |
| `init_instance(p_organization_name text, p_country character, p_edition instance_edition)` | Records the installation. Called once, by the installer. Leaves the registration fields empty. |
| `install_country_template(p_company_id uuid, p_country character, p_language character, p_chart_code text)` | Copies one chart of a country pack into a company in one language, with the country's journals and taxes, wires the default roles, and records the pack version and the chart in company_packs. |
| `invite_member(p_company_id uuid, p_email text, p_role member_role, p_capabilities jsonb, p_valid_for interval)` | Invites an address into a company and returns the token once. Only the hash is stored; re-inviting the same address revokes the pending invitation. |
| `is_any_company_member()` | Whether the current user belongs to at least one company of this installation. |
| `is_company_owner(p_company_id uuid)` | Whether the current user is on the owner preset of a company. False, never NULL, for somebody who is not a member — a guard written as `if not is_company_owner(…)` has to fire for a stranger. |
| `is_installer()` | Whether the caller is the installation itself — the migration runner, the seeds, the CLI — rather than a person or a machine key. Set by the runner on its own connection; a session or a key can never be it. |
| `is_instance_admin()` | Whether the current user administers this installation. |
| `label_for(p_name text, p_i18n jsonb, p_languages text[])` | The label in the first language of the list that has one, and the row's own name when none of them does. The only place a translated label is chosen. |
| `locale_of_country_pack()` | Fills a company's currency and language from the pack of its fiscal country when the caller named neither. A pack that says nothing leaves them null, and NOT NULL refuses the row. |
| `member_capabilities(p_company_id uuid, p_user_id uuid)` | The capabilities one member effectively holds on one company, preset and adjustments resolved. Reading another member's needs members.manage. |
| `module_enabled(p_company_id uuid, p_code text)` | The helper a module's row level security policies call: this module is enabled on this company and the caller is a member of it. One call, and the answer to a stranger is no. |
| `module_entry_id(p_company_id uuid, p_module_code text, p_ref text)` | The entry a module already posted under a reference, or null. What a module reads before deciding it has work to do. |
| `module_is_enabled(p_company_id uuid, p_code text)` | Whether a module is enabled on a company, regardless of who is asking. Definer so a policy on company_modules cannot recurse into it. |
| `module_settings(p_company_id uuid, p_code text)` | The settings a company keeps for one of its modules, or null when the module is not enabled. The socle never looks inside the object. |
| `next_entry_number(p_journal_id uuid, p_date date)` | Next number for a journal, on the pattern the country pack declares. Atomic: the counter row is locked, not the journal. Definer, because the counter is infrastructure and nobody writes it by hand. |
| `next_matching_number(p_company_id uuid)` | Next reconciliation letter for a company, as A0001. Definer, for the same reason as next_entry_number. |
| `number_counter(p_format text, p_number text)` | The counter inside a number, read back through the pattern it was written with, or null when the number does not follow that pattern. What lets an import advance the sequence it interrupted. |
| `numbering_rules(p_company_id uuid, OUT number_format text, OUT numbering_gapless boolean)` | What the country of a company says about its document numbers: the pattern, and whether the law forbids a hole. The only function that reads either column. |
| `opening_balance(p_company_id uuid, p_fiscal_year_id uuid, p_lines jsonb, p_allow_result_accounts boolean)` | Posts a trial balance from a previous system as the opening entry of a fiscal year. Balance-sheet accounts only, unless the caller allows the others. |
| `opening_journal_id(p_company_id uuid)` | The journal the opening and year-end entries go on, named by the pack of this company's country. Null when the pack names none, and the callers refuse rather than guessing at a code. |
| `pack_upgrade(p_company_id uuid, p_country character, p_apply boolean)` | Moves a company to the country pack version this installation holds: additions copied in, closed validities applied, everything else listed and left alone unless the caller asks for it. Records what it did in the audit trail. The recorded version moves only when nothing is left waiting. |
| `pack_upgrade_diff(p_company_id uuid, p_country character)` | What separates a company from the country pack this installation now holds, by natural key, each difference carrying the rule that decides what an upgrade does with it. |
| `post_document(p_document_id uuid)` | Books a document: base lines, tax lines from tax_postings — the non-deductible share on the accounts of the lines, a cash-basis tax on its transition account and on no box — a counterpart that balances by construction, and the company currency in the ledger at the rate the document carries. |
| `post_entry(p_entry_id uuid)` | Validates, numbers and posts an entry. Raises rather than warning: a swallowed error is a missing entry. Where the country forbids a hole in the sequence it refuses a number chosen by hand, unless the caller holds entries.import — and then the counter catches up to it. |
| `post_module_entry(p_company_id uuid, p_module_code text, p_ref text, p_date date, p_description text, p_lines jsonb, p_journal_id uuid)` | The only way a module reaches the ledger: it hands over lines as data and this builds the draft and calls post_entry(). The tag (module_code, ref) is unique per company, so posting the same thing twice is refused by the database. |
| `post_payment(p_payment_id uuid)` | Books a payment: the bank side from the payment's bank account or its journal, the third-party side by role, both in the company currency at the payment's rate. Matches nothing. |
| `preferred_languages(p_company_id uuid)` | The languages to try, in order: the user's own, then the company's, then the one the country pack declares. Feed it to label_for(). |
| `purge_audit_log(p_before date)` | Drops audit rows older than a date the caller names, and records that it did. service_role only: retention is the operator's decision and no signed-in user may make it. |
| `reconcile(p_line_a uuid, p_line_b uuid, p_amount numeric)` | Matches a debit line against a credit line, in the currency the two share when it is not the company's, and books what the matching reveals: the realised exchange difference, and the share of a cash-basis tax that has become due. |
| `register_instance(p_contact_email text)` | Opt-in: records an address and a date so Ekwo can reach the operator. Never required, and reversible with unregister_instance(). |
| `reopen_fiscal_year(p_fiscal_year_id uuid)` | Undoes a close: reverses the appropriation and closing entries it wrote and clears is_closed. Refused once a later year is closed or holds entries of its own. |
| `resolve_counterpart_account(p_company_id uuid, p_contact_id uuid, p_is_sale boolean)` | Third-party account by role: contact override first, company default second. Never by code prefix. |
| `resolve_line_account(p_company_id uuid, p_doc_type doc_type, p_product_id uuid, p_account_id uuid)` | Account of a document line: the line, the product, the company default, the country model. Never a code prefix. |
| `resolve_line_account(p_company_id uuid, p_doc_type doc_type, p_account_id uuid)` | Account of a document line: the line, then the company default, then the country model. Never a code prefix. |
| `revoke_api_key(p_api_key_id uuid)` | Withdraws a key. There is no un-withdraw: a secret that has been out of the building is issued again, not brought back. |
| `revoke_invitation(p_invitation_id uuid)` | Withdraws an invitation that has not been accepted. An accepted one is a member, and members are removed from company_members. |
| `round_amount(p_amount numeric, p_rounding money_rounding)` | Rounds an amount at the decimals of its currency, by the method of its country. The only function of the schema that names a rounding method; every other one asks rounding_of() and passes the answer here. |
| `rounding_of(p_company_id uuid, p_currency_code text)` | How this company writes an amount in this currency, or in its own when none is named. The only place currencies.decimal_places and country_defaults.rounding_method are read. |
| `set_preferences(p_patch jsonb)` | Writes the signed-in user's preferences. A key that is present is written, null included; a key that is absent is left alone; a key nobody declared is refused. |
| `set_updated_at()` | Generic BEFORE UPDATE trigger keeping updated_at honest. |
| `settle_cash_basis_tax(p_document_id uuid, p_date date)` | Moves the share of a cash-basis tax that settlement has made due, from the transition account to the account and the box it is declared on. Derived from the ledger, so it is the same call whether a matching was made or undone. |
| `statement_account_matches(p_company_id uuid, p_statement_code text, p_from date, p_to date)` | Every account of a company with a balance in the period, and the statement line it falls on — null when no rule catches it. An income statement and an allocation section leave the closing entry out; a balance sheet keeps it. The single decision financial_statement() and unmapped_accounts() both read. |
| `tax_rate_at(p_tax_id uuid, p_date date)` | Percentage in force at a date, NULL when the tax does not apply then. |
| `touch_api_key(p_api_key_id uuid)` | Records that a key was used just now. A key that has never been used, and one that has not been used for a year, are both things an operator should be able to see. |
| `trial_balance(p_company_id uuid, p_from date, p_to date)` | Opening balance, movements of the period and closing balance per account, posted entries only. |
| `unmapped_accounts(p_company_id uuid, p_statement_code text, p_from date, p_to date)` | Accounts this statement is answerable for that carry a balance and that no rule of it catches. Empty is what makes the statement tie out; a row is an account somebody opened outside the pack. |
| `unreconcile(p_reconciliation_id uuid)` | Undoes a matching, and with it what the matching had booked: the exchange difference it realised and the share of a cash-basis tax it had made due. |
| `unregister_instance()` | Undoes register_instance(). Opting in is reversible, or it is not a choice. |
| `use_api_key(p_secret text)` | Presents a machine key for the current transaction: has_capability() answers for it until the transaction ends. Refuses a key that is unknown, withdrawn or expired. |
| `vat_return(p_company_id uuid, p_from date, p_to date, p_report_code text)` | Declaration boxes for a period: summed from the ledger, then the totals of the country's form worked out by evaluate_totals(), the same evaluator financial_statement() uses. No country rule lives in this function. |

---

# Modules

One Postgres schema each, beside the socle. A module depends on `public` by foreign key
and reaches the ledger only through `post_module_entry()`. It is enabled per company, and
PostgREST serves its schema only once the project exposes it.

## `assets` — Fixed assets

Fixed assets, their depreciation schedule and their disposal. Durations, declining coefficients and the prorata convention are country pack data.

### Tables

| Table | Purpose |
|---|---|
| [`assets`](#assets-assets) | One fixed asset: what it cost, how it is depreciated, and the three accounts that carry it. The schedule is assets.depreciation_lines. |
| [`category_templates`](#assets-category_templates) | The usual duration and method of a kind of asset in one country, with the source it comes from. A suggestion an asset may depart from, which is why it is never copied into a company. |
| [`country_rules`](#assets-country_rules) | How one country depreciates and derecognises. Filled by `ekwo pack build` from packs/<cc>/assets.json, read where it stands, never copied into a company. |
| [`depreciation_lines`](#assets-depreciation_lines) | One planned period of depreciation. `entry_id` is the entry that booked it, and is what makes running the depreciation of a period twice a no-op. |
| [`disposals`](#assets-disposals) | What leaving the books cost or earned: one row per asset, written by assets.dispose_asset(). There is no undo, for the reason there is no unpost. |

#### `assets`

One fixed asset: what it cost, how it is depreciated, and the three accounts that carry it. The schedule is assets.depreciation_lines.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | not null |
| `company_id` | `uuid` | not null |
| `code` | `text` | not null |
| `name` | `text` | not null |
| `description` | `text` |  |
| `category_code` | `text` |  |
| `document_line_id` | `uuid` |  |
| `contact_id` | `uuid` |  |
| `product_id` | `uuid` |  |
| `acquisition_date` | `date` | not null |
| `in_service_date` | `date` |  |
| `cost` | `numeric(16,2)` | not null |
| `residual_value` | `numeric(16,2)` | not null |
| `method` | `assets.depreciation_method` | not null |
| `duration_months` | `integer` | not null |
| `coefficient` | `numeric(7,3)` | Multiplier of the straight-line rate under a declining balance. France 1,25 / 1,75 / 2,25 by duration; Belgium doubles the rate. Required by a check constraint for that method, because a declining balance with no coefficient is a straight line nobody asked for. |
| `prorata` | `assets.prorata_rule` | How much of the first period this asset takes. Null reads the country rule for its method, and an asset in a country whose pack says nothing is refused by name rather than given another country's convention. |
| `asset_account_id` | `uuid` | not null |
| `depreciation_account_id` | `uuid` | not null |
| `expense_account_id` | `uuid` | not null |
| `state` | `assets.asset_state` | not null |
| `notes` | `text` |  |
| `created_at` | `timestamp with time zone` | not null |
| `updated_at` | `timestamp with time zone` | not null |

Constraints:

- `CHECK ((cost > (0)::numeric))`
- `CHECK (((method <> 'declining_balance'::assets.depreciation_method) OR (coefficient IS NOT NULL)))`
- `CHECK ((duration_months > 0))`
- `CHECK (((in_service_date IS NULL) OR (in_service_date >= acquisition_date)))`
- `CHECK (((residual_value >= (0)::numeric) AND (residual_value < cost)))`
- `PRIMARY KEY (id)`
- `UNIQUE (company_id, code)`

#### `category_templates`

The usual duration and method of a kind of asset in one country, with the source it comes from. A suggestion an asset may depart from, which is why it is never copied into a company.

| Column | Type | Notes |
|---|---|---|
| `country` | `character(2)` | not null |
| `code` | `text` | not null |
| `name` | `text` | not null |
| `name_i18n` | `jsonb` | not null |
| `method` | `assets.depreciation_method` | not null |
| `duration_months` | `integer` | not null |
| `coefficient` | `numeric(7,3)` |  |
| `prorata` | `assets.prorata_rule` | Overrides the country rule for this category. Null is the ordinary case: the rule of the country, for the method this category uses. |
| `account_type` | `account_type` | Which of the eighteen account types the asset account of this category is, so a client can propose the accounts of a chart it has never seen. Advisory: nothing resolves an account from it. |
| `sequence` | `integer` | not null |
| `legal_reference` | `text` |  |

Constraints:

- `CHECK (((method <> 'declining_balance'::assets.depreciation_method) OR (coefficient IS NOT NULL)))`
- `CHECK ((duration_months > 0))`
- `PRIMARY KEY (country, code)`

#### `country_rules`

How one country depreciates and derecognises. Filled by `ekwo pack build` from packs/<cc>/assets.json, read where it stands, never copied into a company.

| Column | Type | Notes |
|---|---|---|
| `country` | `character(2)` | not null |
| `prorata_straight_line` | `assets.prorata_rule` | not null |
| `prorata_declining` | `assets.prorata_rule` | not null |
| `day_count` | `assets.day_count` | not null |
| `declining_cap_percent` | `numeric(7,3)` | Largest annuity a declining balance may take in one period, as a percentage of the acquisition value. Null where the country caps nothing. |
| `declining_switch_to_linear` | `boolean` | not null — Whether the declining balance switches to the straight line over the remaining periods once that gives the larger annuity. True everywhere the declining balance is a tax incentive rather than a valuation method. |
| `disposal_style` | `assets.disposal_style` |  |
| `legal_reference` | `text` |  |

Constraints:

- `CHECK (((declining_cap_percent IS NULL) OR ((declining_cap_percent > (0)::numeric) AND (declining_cap_percent <= (100)::numeric))))`
- `CHECK ((country ~ '^[A-Z]{2}$'::text))`
- `PRIMARY KEY (country)`

#### `depreciation_lines`

One planned period of depreciation. `entry_id` is the entry that booked it, and is what makes running the depreciation of a period twice a no-op.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | not null |
| `asset_id` | `uuid` | not null |
| `company_id` | `uuid` | not null |
| `sequence` | `integer` | not null |
| `period_start` | `date` | not null |
| `period_end` | `date` | not null |
| `amount` | `numeric(16,2)` | not null |
| `accumulated` | `numeric(16,2)` | not null |
| `net_book_value` | `numeric(16,2)` | not null |
| `entry_id` | `uuid` |  |
| `posted_at` | `timestamp with time zone` |  |
| `created_at` | `timestamp with time zone` | not null |

Constraints:

- `CHECK ((amount >= (0)::numeric))`
- `CHECK ((period_end >= period_start))`
- `CHECK (((posted_at IS NULL) OR (entry_id IS NOT NULL)))`
- `PRIMARY KEY (id)`
- `UNIQUE (asset_id, period_end)`
- `UNIQUE (asset_id, sequence)`

#### `disposals`

What leaving the books cost or earned: one row per asset, written by assets.dispose_asset(). There is no undo, for the reason there is no unpost.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | not null |
| `asset_id` | `uuid` | not null |
| `company_id` | `uuid` | not null |
| `disposal_date` | `date` | not null |
| `proceeds` | `numeric(16,2)` | not null |
| `counterpart_account_id` | `uuid` |  |
| `contact_id` | `uuid` |  |
| `cost` | `numeric(16,2)` | not null |
| `accumulated` | `numeric(16,2)` | not null |
| `net_book_value` | `numeric(16,2)` | not null |
| `result` | `numeric(16,2)` | not null |
| `entry_id` | `uuid` |  |
| `created_at` | `timestamp with time zone` | not null |

Constraints:

- `CHECK ((proceeds >= (0)::numeric))`
- `PRIMARY KEY (id)`
- `UNIQUE (asset_id)`

### Functions

| Function | Purpose |
|---|---|
| `can_disable(p_company_id uuid)` | Why this company cannot disable the assets module, or null when it can. The convention disable_module() reads. |
| `create_asset(p_company_id uuid, p_code text, p_name text, p_acquisition_date date, p_cost numeric, p_asset_account text, p_depreciation_account text, p_expense_account text, p_category_code text, p_duration_months integer, p_method assets.depreciation_method, p_coefficient numeric, p_residual_value numeric, p_in_service_date date, p_document_line_id uuid, p_contact_id uuid, p_description text)` | Creates an asset and its schedule in one call. A category of the country pack fills in the method, the duration and the coefficient; anything the caller passes wins over it. |
| `days360(p_from date, p_to date)` | Days between two dates on a year of 360 days and months of 30, the day capped at the 30th. Half-open: days360(1 January, 1 January of the next year) is 360. |
| `dispose_asset(p_asset_id uuid, p_date date, p_proceeds numeric, p_counterpart_account text, p_contact_id uuid)` | Takes an asset off the books on a date: clears its cost and its accumulated depreciation, books the proceeds, and presents the result the way the country's pack says — one gain or loss line, or the value and the proceeds in full. |
| `generate_schedule(p_asset_id uuid)` | Writes the depreciation schedule of an asset, period by period, rounded at the decimals of the company's currency with the last line taking the remainder. Refuses to rewrite a schedule whose lines are already booked. |
| `movements(p_company_id uuid, p_from date, p_to date)` | What came in, what was written off and what went out between two dates, per asset — the movement table an annual account asks for beside the register. |
| `prorata_fraction(p_rule assets.prorata_rule, p_day_count assets.day_count, p_start date, p_period_start date, p_period_end date)` | The share of a period that runs from the day an asset entered service. A prorata in days counts the day of entry into service itself, which is the convention that makes a full year come to exactly one. |
| `register(p_company_id uuid, p_at date)` | The table of fixed assets at a date: what each one cost, what has been written off it, and what is left. Reads what has been booked, so it ties to the ledger. |
| `rules(p_company_id uuid)` | The depreciation rules of this company's country, or an empty row when its pack says nothing. The callers name what is missing rather than borrowing another country's answer. |
| `run_depreciation(p_company_id uuid, p_period_end date)` | Books every planned period that ends on or before a date, one entry per period, through post_module_entry(). Idempotent: a period already booked is skipped, and the unique tag on the entry refuses a second one anyway. A closed financial year refuses the posting, because post_entry() asserts the period is open. |

## `budgets` — Budgets

A budget per financial year, its lines per account and period, and the variance against what the ledger actually holds. No country data, and nothing written to the ledger.

### Tables

| Table | Purpose |
|---|---|
| [`budgets`](#budgets-budgets) | One budget of one company, usually for one financial year. A company may hold several — a plan and a revision are two budgets and not two columns. |
| [`lines`](#budgets-lines) | What one account is expected to carry over one period, in the sign a business says it: an income and a cost are both positive. |

#### `budgets`

One budget of one company, usually for one financial year. A company may hold several — a plan and a revision are two budgets and not two columns.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | not null |
| `company_id` | `uuid` | not null |
| `fiscal_year_id` | `uuid` | The year this budget is for, where it is for one. Null on a rolling budget, whose lines carry their own periods anyway. |
| `code` | `text` | not null |
| `name` | `text` | not null |
| `state` | `budgets.budget_state` | not null |
| `notes` | `text` |  |
| `created_at` | `timestamp with time zone` | not null |
| `updated_at` | `timestamp with time zone` | not null |

Constraints:

- `PRIMARY KEY (id)`
- `UNIQUE (company_id, code)`

#### `lines`

What one account is expected to carry over one period, in the sign a business says it: an income and a cost are both positive.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | not null |
| `budget_id` | `uuid` | not null |
| `company_id` | `uuid` | not null |
| `account_id` | `uuid` | not null |
| `period_start` | `date` | not null |
| `period_end` | `date` | not null |
| `amount` | `numeric(16,2)` | not null |
| `note` | `text` |  |
| `created_at` | `timestamp with time zone` | not null |
| `updated_at` | `timestamp with time zone` | not null |

Constraints:

- `CHECK ((period_end >= period_start))`
- `PRIMARY KEY (id)`
- `UNIQUE (budget_id, account_id, period_start, period_end)`

### Functions

| Function | Purpose |
|---|---|
| `variance(p_company_id uuid, p_budget_id uuid, p_from date, p_to date)` | Budget against ledger, per account, over a period, at the decimals of the company's currency. Both figures are in the sign a business states them in — an income account's credit balance is flipped — and the variance is the actual less the plan. Reads posted entries of kind `normal` only: a closing or appropriation entry is not what a period earned. |

---

*This file is generated by `scripts/generate-schema-doc.mjs`. Edit the
migrations and `docs/schema.intro.md`, then regenerate.*
