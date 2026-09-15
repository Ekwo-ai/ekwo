# `supabase/migrations/` — the schema

One file per change, applied in filename order, additive only.

## Naming

`YYYYMMDDHHMMSS_short_subject.sql`. The timestamp orders the files; the
subject says what the migration is about, in snake_case, without a verb.

Take the timestamp from the clock, seconds included, and never a round
hour. Two people writing migrations in the same tree on the same afternoon
both reached for `…170000` once; Supabase keys its history on that prefix,
and a duplicate silently drops one file from `supabase migration list`.
Always number after the newest file on `main`, and check `git log` first.

## The order that exists today

| File | Content |
|---|---|
| `…120000_core_companies` | `companies`, `company_members`, `fiscal_years`, the RLS helper functions |
| `…120100_accounts_journals` | `currencies`, `currency_rates`, `account_type` (18 values), `accounts`, `journals`, `journal_sequences` |
| `…120200_contacts` | `contacts`, `commercial_entity()` |
| `…120300_taxes` | `taxes`, `tax_postings` |
| `…120400_entries` | `entries`, `entry_lines`, numbering, period locks, `post_entry()` |
| `…120500_documents` | `documents`, `document_lines`, totals |
| `…120600_payments_reconciliation` | `payments`, `reconciliations`, `reconcile()`, `unreconcile()` |
| `…120700_bank` | `bank_accounts`, `bank_statements`, `bank_transactions` |
| `…120800_analytics_attachments` | analytic axes and values, `attachments` |
| `…120900_post_document` | `post_document()` |
| `…121000_reporting` | `trial_balance()`, `general_ledger()`, `aged_balance()`, `vat_return()` |
| `…121100_country_templates` | the template tables and `install_country_template()` |
| `…121200_fec` | `fec_lines()` |
| `…130000_instance`, `…130100_instance_members`, `…140000_instance_admins` | the `instance` row and the instance administrators |
| `…160000_tax_posting_templates_unique` | the natural key of `tax_posting_templates`, so the tax seeds can be re-applied |
| `…170000_document_amount_paid` | `documents.amount_paid` derived from the matching, inside the reconciliation trigger, never written by hand |
| `…173000_post_payment` | `post_payment()`: money in or out becomes an entry, so no client writes ledger lines |
| `…173100_sequence_counters_under_rls` | `next_entry_number()` and `next_matching_number()` become definer, so a signed-in user can post |
| `…183000_country_journal_defaults` | the bank and cash journals get their account from the country model, so a first payment has somewhere to book |
| `…193853_line_account_defaults` | the account a document line falls back to: the line, the company default, the country model — and the two `country_defaults` columns that had no reader |
| `…195054_products` | `products`, `document_lines.product_id` and `.description`, the product step of `resolve_line_account`, and the `document_line_items` view (BT-153, BT-154, BT-155) |
| `…210131_anon_surface` | `anon` may execute only the eight policy helpers; `instance_admins` visible to members, administrators and oneself |
| `20260912074712_country_packs` | `country_packs` and `company_packs`, `name_i18n` and `statement_hint` on the chart, `companies.language`, `country_defaults.language_default`, and `install_country_template(company, country, language)` |
| `20260912080311_report_code_and_region` | `report_code` on `tax_posting_templates` and `tax_postings`, backfilled; `region` on `companies` and `contacts`. Both are for the Canadian pack, added now so that table migrates once |
| `20260912081014_pack_certification_maintained` | `pack_certification` gains `maintained`; `ekwo` is deprecated and nothing writes it |
| `20260912081015_pack_certification_backfill` | the packs that held `ekwo` become `maintained`, `certified_by` emptied. Its own file: a new enum value cannot be used in the transaction that added it |
| `20260912090407_tax_report_boxes` | `tax_report_templates` and `tax_report_box_templates`, filled by the packs; `vat_return(company, from, to, report_code)` reads their plus/minus formulas, and the last test on a fiscal country leaves the core |
| `20260912091917_tax_on_base_value` | `tax_posting_type` gains `tax_on_base`. Its own file, for the same reason as the pair above |
| `20260912091918_tax_engine_columns` | the generalised tax engine: `tax_kind`, `recoverable`, `jurisdiction`, `price_include`, `cash_basis` on the taxes and their templates; `rounding_method` and `cash_rounding_unit` on the country model; one constraint per table saying which posting type carries an account; `post_document` books the non-deductible share on the accounts of the lines |
| `20260912094412_opening_and_closing` | `opening_balance()`, `close_fiscal_year()`, `reopen_fiscal_year()`; the `closing_style` enum and five `country_defaults` columns that carry the year-end accounts, none with a default; `entries.kind` (`normal`/`opening`/`closing`); `is_closed` and `kind` writable only through those functions |
| `20260912095825_charts_of_accounts` | `chart_templates`; `chart_code` on `account_templates` — the key becomes `(country, chart_code, code)` — and on `company_packs`; `install_country_template(company, country, language, chart_code)` takes the pack's default chart when none is named. Journals, taxes and the declaration form stay common to the charts of a country |
| `20260912100412_financial_statements` | `statement_templates`, `statement_line_templates` and `statement_line_rules`, filled by the packs; `evaluate_totals()`, the one place a plus/minus formula is worked out; `financial_statement(company, code, from, to)`, `statement_account_matches()`, `unmapped_accounts()` and `available_statements()` |
| `20260912104719_one_formula_evaluator` | `vat_return()` rewritten onto `evaluate_totals()`, so a declaration form and a financial statement derive their totals in one function. Its own file because `vat_return` was published before |
| `20260912105720_entry_kind_appropriation` | `entry_kind` gains `appropriation`. Its own file: a new enum value cannot be used in the transaction that added it |
| `20260912105721_appropriation_entry_kind` | `close_fiscal_year()` marks the entry that moves the result `appropriation` and keeps `closing` for the one that empties the income statement; `reopen_fiscal_year()` undoes both; `statement_account_matches()` leaves `closing` out of an income statement and of an allocation section |
| `20260912111751_document_rules` | twelve `country_defaults` columns for what a country requires on a document — gapless numbering and the number pattern, the legal payment term and its interest reference, the tax point, the e-invoicing profile and the day it becomes obligatory, the ISO 6523 party and VAT schemes, the bank statement and payment formats, the usual opening of the financial year, none of them with a default; `legal_mention_templates` and its closed `applies_when` vocabulary; the `document_legal_mentions` view; `document_line_items` gains the treatment and the exemption reason of its tax. No function |
| `20260913074512_modules` | the module mechanism: `modules` and `company_modules`, `enable_module()` / `disable_module()` / `module_enabled()`, `entries.module_code` and `entries.module_ref` with the unique index that makes a module idempotent, and `post_module_entry()` — the one way a module reaches the ledger |
| `20260913075903_asset_disposal_roles` | four nullable `country_defaults` columns, none with a default, for the two ways a country derecognises a fixed asset. Read by the `assets` module |
| `20260912112132_cash_basis_vat_and_fx` | VAT on a cash basis and the realised exchange difference: `fx_gain_code` and `fx_loss_code` on the country model, `payments.exchange_rate`, `fx_entry_id` and `tax_transfer_entry_id` on `reconciliations`; `post_document` and `post_payment` book the company currency and write `amount_currency`; `settle_cash_basis_tax()`, called by `reconcile()` and `unreconcile()`, moves the share of a waiting tax that settlement has made due |
| `20260913083216_capabilities` | `capabilities` and `role_capabilities`, `company_members.capabilities_granted` / `capabilities_revoked`, `has_capability()` and `member_capabilities()`. Every policy that tested a role now tests a capability; the role becomes a preset. Three triggers guard the acts a policy cannot express — posting an entry, booking a document, closing a year — and the two counters ask for a capability instead of a role that `NULL in (…)` had quietly made optional |
| `20260913083901_company_invitations` | `company_invitations`, `invite_member()`, `accept_invitation()` and `revoke_invitation()`. The token is returned once and kept as a sha256 — `sha256()` is core Postgres, `pgcrypto` is not — the address is matched against `auth.email()` on acceptance, and an invitation is single use and expires |
| `20260913084402_user_preferences` | `label_for(name, name_i18n, languages)` — the one spelling of how a translated label is picked — `user_preferences` with no default anywhere, `preferred_languages(company)` (the user, then the company, then the pack) and `set_preferences(patch)`; `install_country_template()` republished on `label_for` |
| `20260913084847_company_profile` | eight columns on `companies` — trade name, logo, stated capital and its currency, activity code and scheme, default bank account, document template — a capital with no currency taking the company's own, the payee IBAN of a sales document falling back to that account, and the `document_header` view a renderer reads once. No `registry_reference`: `registration_number` already is it |
| `20260913085436_numbering_reads_the_pack` | `numbering_rules()`, `format_number()` and `next_entry_number()` on `country_defaults.number_format` — the numbering engine P0-7 deferred. No fallback literal: a silent pack gets `no_number_format`. The counter follows the pattern (a year in it restarts it, none keeps one series under period 0) and `post_entry()` reads `numbering_gapless`, refusing a number chosen by hand where the law forbids a hole |
| `20260913085932_api_keys` | `api_keys` — one company, an explicit list of capabilities, a sha256 at rest — with `create_api_key()` (never wider than the person issuing it), `use_api_key()` which puts the key in `ekwo.api_key` for one transaction, `touch_api_key()`, `current_api_key()` and `revoke_api_key()`; `has_capability()` answers for a key where there is no member answer |
| `20260913090216_fiscal_year_bounds` | `fiscal_year_bounds(country, year, start)` — the first day from `country_defaults.fiscal_year_default`, the last a day before the same day a year later, and a refusal where the pack is silent — and `create_company()`, which an instance administrator calls to get a company, its owner, its chart and its first year in one act |
| `20260913092527_entries_import` | `entries.import`, a capability in no preset, lets an explicit number through where the country forbids a hole — for taking over books that already have numbers. `number_counter()` reads a counter back out of a number and `catch_up_journal_sequence()` advances the journal counter to it, so the next automatic number continues the series. A duplicate stays refused by `entries_company_number_idx` |
| `20260913101536_null_safe_guards` | `is_installer()` — the installation itself, named rather than inferred from a missing session — and the two helpers a guard can be written on, `is_company_owner()` and `can_write_company()`, answering `false` where they answered NULL. `enable_module()` and `disable_module()` ask for `company.write` instead of a role a stranger's NULL had made optional |
| `20260913102115_installer_is_named` | the eleven guards written as `auth.uid() is not null and not has_capability(…)` — three triggers, two counters, the key functions, the invitations, `create_company()` — ask `is_installer()` instead, which a machine key can never be. `post_entry()` drops its own `auth.uid()` test and asks for `entries.import` alone |
| `20260913102758_no_currency_default` | the eight `default 'EUR'` / `default 'fr'` columns lose their default — `companies`, `country_defaults`, `documents`, `payments`, `products`, `bank_accounts`, `bank_transactions`. A row takes the currency of its company, a statement line that of its bank account, and a company the currency and language of its country's pack; a pack that says nothing leaves the column null and NOT NULL refuses the row |
| `20260913103355_cash_basis_needs_a_box` | `post_document()` raises `no_cash_basis_box` before it writes the entry, where the pack names no declaration box on a tax that falls due on collection. Without it the amount sat on the transition account for ever: `settle_cash_basis_tax()` only moves a line carrying a box amount, so nothing settled and nothing raised |
| `20260913104014_aged_balance_named_group` | `aged_balance()` raises `invalid_group` for anything that is not `receivable` or `payable`. It used to test `= 'payable'` and report everything else as receivable — a full, plausible, wrong report |
| `20260913104232_foreign_key_indexes` | 71 indexes: every foreign key of the socle that had none, and with it the `company_id` of the five tables that had none. Postgres indexes only the referenced side, so a parent delete and every natural join were reading the whole child table. `tests/schema.test.ts` asks the catalogue the same question, so the list is never maintained by hand. The `assets` and `budgets` modules carry the same migration for their own 14 |
| `20260913105120_declared_no_reader` | comments only. Five columns a pack fills and nothing reads yet — `rounding_method`, `cash_rounding_unit`, `bank_statement_formats`, `payment_formats`, `currencies.decimal_places` — say so in their own comment, and `docs/schema.md` is generated from those. `reconciliations.fx_entry_id` says the opposite, because it is read |
| `20260913114535_fec_opening_balances` | `fec_lines()` prepends the *à-nouveaux* of a financial year — computed from `trial_balance()` and never posted, one line per account that carries forward, plus one for the result of a year nobody has closed on the balance-sheet account the close would have used — and leaves the entries of a close out of the movements of the year they close. `country_defaults.opening_entry_label` carries the wording, from the pack |
| `20260914103412_audit_log` | `audit_log`, append-only by trigger for everyone including the table owner; `audit_record()`, the generic `audit_changes()` configured by one jsonb argument, `audit_state_change()` and `audit_entry_posting()`; triggers on the sixteen tables that decide how an entry is booked and on the five acts that change a state; `purge_audit_log(date)`, `service_role` only and with no default retention. The installer's own bulk copy is not audited row by row |
| `20260914111907_pack_upgrade` | `pack_change_rule`, `pack_upgrade_diff(company, country)` — the difference between a company and the pack the installation holds, by natural key, each row carrying its rule — and `pack_upgrade(company, country, apply)`, which applies an addition and a closed validity, lists the rest, never removes a row the company holds, records what it did in `audit_log`, and moves `company_packs.version` only when nothing is left waiting |
| `20260914120500_rounding_reads_the_currency` | the `money_rounding` pair — the decimals of a currency and the method of a country — with `round_amount(amount, rounding)` (the arithmetic, and the only place a method is named), `rounding_of(company, currency)` (the lookup, and the only reader of `currencies.decimal_places` and `country_defaults.rounding_method`), `currency_unit()` and `amount_text_format()`. Nothing else changes yet |
| `20260914121200_amounts_round_at_the_currency` | the fifty-one `round(x, 2)` of the socle rewritten onto `round_amount`: `post_document`, `post_payment`, `reconcile`, `settle_cash_basis_tax`, `opening_balance`, `post_module_entry`, `close_fiscal_year`, `aged_balance`, `statement_account_matches`, `financial_statement`, `vat_return`, `fec_lines`, `documents_refresh_totals`, `documents_refresh_amount_paid`, `evaluate_totals` (which takes the rounding as an argument, because it is immutable) and `document_tax_summary`. `document_lines.amount_untaxed` stops being a generated column and becomes one a trigger writes, because a generated column may not ask what currency the document is in. The tolerances `0.005` and `0.001` become fractions of `currency_unit()` |
| `20260914151207_schema_grants_its_own_rights` | Every table, view and function names the roles that may reach it, by hand and by name. `authenticated` gets exactly the verbs the policies of a table are prepared to judge — the four on the twenty-six a policy `for all` governs, SELECT alone on the twenty-four a pack or a definer function writes, SELECT alone on `audit_log`; `anon` gets nothing on any table, view or sequence and keeps the ten policy helpers; `service_role` gets what a person gets. The project's default privileges on `public` are taken back and stopped, Ekwo's own EXECUTE default with them, and the twenty-nine trigger bodies stop being callable |
| `20260914152840_pack_upgrade_records_its_own_line` | `pack_upgrade()` becomes `security definer`. It is the one function that writes its own audit line rather than leaving it to a trigger, and `audit_record()` has been closed to `authenticated` since `20260914103412` — so through PostgREST the upgrade committed and the trail did not. The capability test it already carried is unchanged |
| `20260914134325_schema_version_0_2_0` | `ekwo_schema_version()` returns `0.2.0`. The number lives in one function, a migration is the only thing that moves it, and `ekwo migrate` writes the answer back onto `instance.schema_version`. This is the first tagged release of the repository |
| `20260915170500_schema_version_0_3_0` | `ekwo_schema_version()` returns `0.3.0`. The release the packages read: `document_shares` and the three functions around it, `ec_sales_list()`, `country_packs.sources` with `source_key` on the taxes and the boxes, `accounts.pinned` with `accounts_in_use()`, `companies.vat_period`, and the `foreign_services_received` treatment. They declare `0.3.0` as their floor and refuse a `0.2.0` database by name |

## Rules for a new migration

1. **Never edit a file that is already on `main`.** It has run on databases
   we do not control. Add a new file; if a previous one was wrong, the new
   one corrects it. The CI's *hygiene* job refuses a pull request that
   modifies or deletes a published migration.

   **What actually happened between 11 and 13 September 2026.** Eight files
   of this directory carry two or three commits each:
   `…121000_reporting`, `…183000_country_journal_defaults`,
   `…074712_country_packs`, `…080311_report_code_and_region`,
   `…090407_tax_report_boxes`, `…094412_opening_and_closing`,
   `…100412_financial_statements` and `…084402_user_preferences`. Some of it
   was the deliberate removal of five country literals on 12 September —
   the Belgian frame VI in `…121000` and four backfills naming two countries
   — recorded here at the time. The rest was not deliberate: it was work
   continuing on a file that had already been pushed.

   None of it reached an installation. Every one of those pushes went
   straight to `main`, no tag existed, `ekwo` had not been released, and no
   database outside this repository had run any of these files — which is
   the one circumstance in which editing a published migration costs
   nothing. The reason it went unnoticed is that the CI job below was gated
   on `pull_request` and nothing ever opened one.

   **The rule is absolute from `v0.2.0` on.** The job now also runs on every
   push to `main`, comparing against the previous commit and against the
   latest tag, so a modified or deleted `.sql` under this directory or under
   `modules/*/supabase/migrations/` fails the build whatever route it took.
   History is not rewritten: the eight files stay as they are, and what they
   contain today is what a fresh installation gets. From here a mistake in a
   published migration is corrected by a new migration, always.
2. **Every new table gets row level security in the same file** — `enable
   row level security` and at least one policy. A test fails otherwise.
3. **Every table that belongs to a company carries `company_id`**, and its
   policies go through `is_company_member()` / `can_write_company()`. No
   `tenant_id`, anywhere: one installation is one customer.
4. **Constraints over conventions.** If a rule can be a `check`, a foreign
   key or a trigger that raises, it is not a comment. Errors raise with a
   prefixed code (`period_locked:`, `entry_unbalanced:`…) so a client can match
   on them.
5. **No extension that PGlite lacks.** `gen_random_uuid()` is core Postgres;
   `pgcrypto` and `btree_gist` are not available in the test runner, so the
   schema does without them.
6. **A migration that adds a function ends with**
   `revoke execute on all functions in schema public from public;` — from
   PUBLIC, and never from `anon`, which holds explicit grants on the ten
   policy helpers. `alter default privileges … revoke execute on functions
   from public` does *not* close a function created later: PostgreSQL merges
   the stored default with the built-in one, so the new function comes out
   with `=X` and Supabase publishes it as an anonymous RPC endpoint.
   `20260911210131` believed otherwise and `20260912074712` found out.
7. **A migration that creates an object grants it**, in the same file, beside
   that revoke. By name — `grant select, insert, update, delete on table
   entries to authenticated, service_role;` — and never `on all tables`, and
   never by `alter default privileges`, which is the mechanism
   `20260914151207` removed and therefore cannot be the way back in.

   The grant says what the policies say. `authenticated` gets exactly the
   verbs a policy of that table is prepared to judge; a table whose only
   policy is a SELECT gets SELECT. `anon` gets nothing on a table, a view or
   a sequence, ever. `service_role` gets what a person gets: it bypasses row
   level security, so its grants are its only limit. A function returning
   `trigger` is granted to nobody — PostgreSQL checks EXECUTE when a trigger
   is created, never when it fires.

   Then `npm run inventory`, and commit
   `packages/cli/assets/expected-objects.json` with the migration. The CI
   regenerates it and refuses a diff; `tests/grants.test.ts` compares the
   catalogue to it and checks the doctrine separately; `ekwo doctor` asks a
   live database the same question.
8. **Regenerate the docs**: `npm run docs:schema` rewrites `docs/schema.md`
   from the migrations. Commit it with the migration.

Write the migration, then the test that proves it in `tests/`, then the
doc. A migration without a test is a migration nobody has run.

## A module's migrations are not in this folder

They live in `modules/<code>/supabase/migrations/` and follow every rule above,
with two of their own. They are recorded in **the same history** —
`supabase_migrations.schema_migrations`, the plain timestamp as `version`, the
module in the `name` (`assets/assets`) — and **their timestamps sort after every
migration of this folder**, so one history stays in order. A test refuses a
module migration that is older than the newest socle one, and another refuses
two migrations anywhere that share a version.

`ekwo migrate` applies this folder, then the modules, then the seeds.
`supabase db push` applies this folder only, and knows nothing of a module's
files — so `ekwo migrate --no-modules` is what to run before it. See
[`docs/modules.md`](../../docs/modules.md).
