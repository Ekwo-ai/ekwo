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
| `20260912094412_opening_and_closing` | `opening_balance()`, `close_fiscal_year()`, `reopen_fiscal_year()`; the `closing_style` enum and five `country_defaults` columns that carry the year-end accounts, none with a default; `entries.kind` (`normal`/`opening`/`closing`); `is_closed` and `kind` writable only through those functions |

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
