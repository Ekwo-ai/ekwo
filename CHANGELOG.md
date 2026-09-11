# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
adheres to [Semantic Versioning](https://semver.org/).

Migrations are additive. A published migration is never edited: a database
somewhere has already run it.

## [Unreleased]

### Fixed

- **Nobody but the database owner could post an entry.** `next_entry_number()`
  and `next_matching_number()` write `journal_sequences` and
  `matching_sequences`, which carry a select policy and no other, and both ran
  as the caller — so posting a document or drawing a matching letter failed
  for every signed-in user with "new row violates row-level security policy".
  It went unnoticed because the tests and the installer both run as the owner.
  Migration `20260911173100` makes the two functions `security definer` and
  has each check that the caller may write the company it is counting for.
- Re-applying the tax seeds — a second `ekwo init` or `supabase db push` on
  the same project — failed on `tax_posting_templates`, which had no natural
  key to conflict on. Migration `20260911160000` adds it and the seeds use it;
  a test now applies every reference seed twice. Found on the first real
  installation.

### Added

- **`npx @ekwo-ai/mcp`** — `packages/mcp`, the Model Context Protocol server.
  Twenty-two tools over stdio: read the companies, the chart of accounts, the
  contacts, the documents and the bank lines; create a contact, a draft
  invoice and its lines; post it; record a payment and match it against the
  open invoices; pull the trial balance, the general ledger, the aged balance,
  the VAT return and the French FEC; lock a period. Plus the chart of accounts
  and the taxes as MCP resources, and two prompts — `close_month` and
  `prepare_vat_return`.

  It acts **as the user**: `SUPABASE_URL` and `SUPABASE_ANON_KEY` with an
  address and a password (or an access token), and row level security decides
  everything else. A `service_role` key is refused at startup. The
  self-hosted route, `EKWO_DB_URL`, requires `EKWO_ACT_AS_USER_ID` and sets
  the JWT claims and the `authenticated` role on every query, so the policies
  bind there too. Every ledger write goes through the schema's own functions;
  nothing in the server writes an `entries` row, and no tool unposts an entry.
- **`post_payment(payment_id)`** — migration `20260911173000`. Money in or out
  becomes a balanced entry: the bank side from the payment's bank account or
  its journal, the third-party side resolved by role the way `post_document`
  resolves it. It matches nothing, deliberately: which invoices a payment
  settles is `reconcile`'s decision. Without it, every client would have had
  to assemble the two ledger lines itself.
- **`npx ekwo init`** — `packages/cli`, published as `ekwo`. One command turns
  a Supabase project the customer already owns into a set of books: it applies
  the migrations, seeds the currencies, the chart of accounts and the VAT
  codes, creates the first administrator in the customer's own Supabase Auth,
  then runs the six steps of the installation sequence — `init_instance()`,
  `claim_instance_admin()`, the company, `company_members` as owner,
  `install_country_template()` and the first financial year. Every step checks
  before it acts, so running it twice creates nothing twice. Node 20 is the
  only requirement: no Supabase CLI, no Docker.
- **`ekwo migrate`, `ekwo status`, `ekwo doctor`, `ekwo demo`.** `migrate`
  shows the gap before closing it and re-applies the idempotent reference
  seeds; `status` reports the schema version installed against available, the
  pending migrations, the instance, its administrators and its companies;
  `doctor` checks what the schema cannot enforce on its own — row level
  security on every table, a policy on every protected table, no pending
  migration, no membership pointing at a deleted user, statements that tie to
  their lines, posted entries that balance; `demo` loads the sample company on
  explicit request.
- **`ekwo register` / `ekwo unregister`.** The registration question is asked
  once, at the end of `init`, and the default answer is no. Saying yes writes
  the address on the instance row through `register_instance()` and POSTs six
  fields — instance id, organisation, country, edition, schema version,
  contact address — to `EKWO_REGISTRY_URL`. A failed POST is a soft message:
  the local record stands and `ekwo register` retries.
- **A migration history compatible with the Supabase CLI.** The runner writes
  `supabase_migrations.schema_migrations` with the same columns and the same
  `version` the Supabase CLI uses, so `supabase db push` and `ekwo migrate`
  are interchangeable in both directions. Each file is applied in one
  transaction with its history row, so a migration that fails halfway leaves
  nothing behind and the next run resumes at it.
- **The schema travels with the package.** `supabase/migrations` and
  `supabase/seed` are copied into `dist/assets` at build time, and a test pins
  that copy to the repository byte for byte. `ee/` is never included.
- **`.env.example`**, documenting `EKWO_DB_URL`, `SUPABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY` and `EKWO_REGISTRY_URL`. The CLI never writes a
  secret to disk; `ekwo.json`, the one file it writes, holds the project URL,
  the country and the schema version.
- **Seventy more tests**, 161 in all, covering the migration runner
  (idempotence, Supabase-compatible history, resuming after a failure halfway),
  the full non-interactive installation against a shimmed Supabase Auth, the
  status and doctor checks, and registration with the endpoint mocked and with
  it unreachable.

## [0.1.0] — 2026-09-11

### Added

- **The instance.** `instance`, a singleton row written by the installer:
  a locally generated `instance_id`, the organisation, its country, the
  edition (`community` or `cloud`), the schema version and the install date.
  `contact_email` and `registered_at` are an opt-in, empty by default, read by
  nothing, and reversible through `unregister_instance()`. There is no
  `tenant_id` anywhere in the schema: the instance is the tenant.
- **An instance-level role.** `instance_admins`, keyed on the customer's own
  `auth.users`, says who may create companies and invite members; an
  administrator still cannot read a ledger they were not invited to.
  `init_instance()`, `claim_instance_admin()`, `register_instance()`,
  `unregister_instance()`, `is_instance_admin()` and `is_any_company_member()`
  come with it. Reading the `instance` row is for a member of at least one
  company or an administrator, and writing it is for an administrator.
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
  letter (`A0001`) and a residual maintained on each line. Matching a
  third-party line moves `documents.amount_paid`, and `amount_residual` and
  `payment_state` follow: what a document has been settled by is derived, not
  keyed in.
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
- **Tests**: 166 of them, running every migration and seed against Postgres in
  WebAssembly, covering posting, credit notes, self-assessment, matching,
  period locks, reports, row level security, the instance singleton and its
  roles, and a golden FEC export.
