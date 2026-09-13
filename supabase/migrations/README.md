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

## Rules for a new migration

1. **Never edit a file that is already on `main`.** It has run on databases
   we do not control. Add a new file; if a previous one was wrong, the new
   one corrects it. The CI's *hygiene* job refuses a pull request that
   modifies or deletes a published migration.

   This was broken **once**, on 12 September 2026, knowingly and with the
   only reason that can justify it: no installation anywhere had run these
   files. Five country literals — the Belgian frame VI in `…121000`, and four
   backfills naming two countries in `…183000`, `…074712` and `…080311` —
   were removed from their own files rather than only overridden later,
   because "a country is data" is now a test over every file of this
   directory, and a literal in a published migration is a literal in the
   repository. It does not become a habit: the next one gets a new file.
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
   PUBLIC, and never from `anon`, which holds explicit grants on the eight
   policy helpers. `alter default privileges … revoke execute on functions
   from public` does *not* close a function created later: PostgreSQL merges
   the stored default with the built-in one, so the new function comes out
   with `=X` and Supabase publishes it as an anonymous RPC endpoint.
   `20260911210131` believed otherwise and `20260912074712` found out.
7. **Regenerate the docs**: `npm run docs:schema` rewrites `docs/schema.md`
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
