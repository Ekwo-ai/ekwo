# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
adheres to [Semantic Versioning](https://semver.org/).

Migrations are additive. A published migration is never edited: a database
somewhere has already run it.

## [Unreleased]

## [0.1.0] — 2026-09-11

### Added

- **The instance.** `instance`, a singleton row written by the installer:
  a locally generated `instance_id`, the organisation, its country, the
  edition (`community` or `cloud`), the schema version and the install date.
  `contact_email` and `registered_at` are an opt-in, empty by default, read by
  nothing, and reversible through `unregister_instance()`. There is no
  `tenant_id` anywhere in the schema: the instance is the tenant.
- **An instance-level role.** `member_role` gains `instance_admin`, stored in
  `instance_members`; it creates companies and invites members, and cannot
  read a ledger it was not invited to. `init_instance()`,
  `claim_instance_admin()`, `register_instance()`, `unregister_instance()` and
  `is_instance_admin()` come with it. Users live in the customer's own
  Supabase Auth.
- **Schema.** Thirty further tables across companies and membership, fiscal
  years, chart of accounts, journals, contacts, taxes and tax postings,
  journal entries and lines, documents and document lines, payments,
  reconciliations, bank accounts, statements and transactions, currencies and
  rates, analytic axes and values, and polymorphic attachments. Row level
  security on every one of them, driven by `company_members` and three roles:
  owner, accountant, viewer.
- **`account_type` with eighteen values**, grouped by a prefix that derives
  the balance-sheet group, so the aged balance, reconcilability and the
  statement mapping are computable instead of pattern-matched on codes.
- **`post_document(id)`**: base lines, tax lines built from `tax_postings`,
  and a third-party counterpart that balances by construction. A credit note
  flips the side rather than negating the amount; a self-assessed tax is
  booked on both sides and still fills both declaration boxes.
- **Numbering** per journal and per year, `CODE/YYYY/NNNN`, backed by a
  counter row rather than a lock on the journal.
- **Period locks**: `lock_date` and `tax_lock_date` on the company, closed
  fiscal years, enforced by triggers on entries and lines. Matching stays
  possible after a lock.
- **Bilateral matching**: `reconcile()` and `unreconcile()`, with a shared
  letter (`A0001`) and a residual maintained on each line.
- **Reports**: `trial_balance`, `general_ledger`, `aged_balance`,
  `vat_return`, `fec_lines`. All of them filter posted entries in the `WHERE`
  clause, so a draft line cannot leak into a balance.
- **Country templates**: `account_templates`, `journal_templates`,
  `tax_templates`, `tax_posting_templates` and `country_defaults`, installed
  into a company by `install_country_template(company, country)`.
- **Seeds**: the Belgian PCMN (353 accounts) and the French PCG (392
  accounts), 19 Belgian and 17 French taxes with their ledger accounts and
  declaration boxes, eleven currencies, and a fictional demo company.
- **`@ekwo-ai/core`**: types of the schema, a thin client over the accounting
  functions, and the French FEC generator with its file-level checks.
- **Tests**: 86 of them, running every migration and seed against Postgres in
  WebAssembly, covering posting, credit notes, self-assessment, matching,
  period locks, reports, row level security, the instance singleton and its
  roles, and a golden FEC export.
