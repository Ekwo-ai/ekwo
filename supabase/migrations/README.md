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

## Rules for a new migration

1. **Never edit a file that is already on `main`.** It has run on databases
   we do not control. Add a new file; if a previous one was wrong, the new
   one corrects it. The CI's *hygiene* job refuses a pull request that
   modifies or deletes a published migration.
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
6. **Regenerate the docs**: `npm run docs:schema` rewrites `docs/schema.md`
   from the migrations. Commit it with the migration.

Write the migration, then the test that proves it in `tests/`, then the
doc. A migration without a test is a migration nobody has run.
