# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
adheres to [Semantic Versioning](https://semver.org/).

Migrations are additive. A published migration is never edited: a database
somewhere has already run it.

## [Unreleased]

### Security

- **A test now fails if any function of `public` is executable by PUBLIC.**
  The finding below was a README rule and a revoke in one migration; it is a
  test in `tests/hardening.test.ts`, which reads `proacl` — a null one counts,
  being the built-in default — so the next migration that forgets the revoke
  fails in CI rather than on a live project.
- **A function created after `20260911210131` was open again.** That migration
  changed the default privileges so that "a function added tomorrow starts
  closed", and PostgreSQL does not work that way: `alter default privileges …
  revoke execute on functions from public` does not delete the built-in world
  default, it is merged with it, so the next function created came out with
  `=X` — EXECUTE for PUBLIC, which on Supabase is an anonymous RPC endpoint.
  `install_country_template` was that function, for the length of one commit.
  Migration `20260912074712` repeats the revoke from PUBLIC (never from
  `anon`, which holds explicit grants on the eight policy helpers), and
  `supabase/migrations/README.md` makes it a rule for every migration that
  adds a function. `tests/hardening.test.ts` pins the list of functions
  `anon` may execute and is what caught it.
- The anonymous role could execute every function of the schema (Postgres
  grants EXECUTE to PUBLIC; Supabase exposes `public` functions as RPC). It
  now executes only the eight helpers the policies evaluate, and the default
  privileges keep it that way for functions added later. Migration
  `20260911210131`.
- `instance_admins` was readable by any signed-in user, member or not; a
  Supabase project accepts self sign-up by default. Administrators are now
  visible to members of a company, to administrators, and to oneself.
- README: a Security section that says to turn off public sign-ups on the
  project, and why an installation should keep two administrators.

### Fixed

- **A `jsonb` argument crossed the direct-Postgres route as a Postgres array.**
  PostgREST posts the arguments of a function as JSON, so a `jsonb` parameter
  receives a real array there; a driver handed a JavaScript array builds an
  array *literal* instead, and `node-postgres` turns an array of objects into
  `{"[object Object]"}`. The SQL backend now stringifies an object or array
  argument and casts the placeholder to `jsonb`, so the two routes agree
  rather than agreeing by accident on one driver. Found while adding
  `opening_balance`, which is the first function to take one.

- `record_payment` (MCP) asked for a journal even when `bank_account_id` was
  given, although the account carries its journal. It now takes the journal
  from the account. Found on the first run against a real Supabase project.

- **`--db-region` built a pooler hostname and called it the answer.** The
  region does not determine the generation prefix: a project created in
  `eu-west-3` answers on `aws-1-eu-west-3.pooler.supabase.com` and returns
  "Tenant or user not found" on `aws-0-`, which reads like a wrong password
  rather than a wrong host. `--project-ref` with `--db-password` and
  `--db-region` now tries both generations on the session port, keeps the one
  that answers and prints it. Without `--db-region` nothing is derived at all:
  the CLI asks for the connection string the dashboard prints under Connect →
  Session pooler, because the direct host `db.<ref>.supabase.co` is IPv6-only
  on any recent project and deriving it silently produces a hang.
- **Three columns of `country_defaults` had no reader.**
  `sales_account_code`, `purchase_account_code` and `currency_code` were
  declared from the first release and consumed by nothing — the state the
  naming policy forbids. They are consumed now rather than deleted: migration
  `20260911193853` adds `companies.default_sales_account_id` and
  `default_purchase_account_id`, `install_country_template` wires them from
  the country model, and a document line that names no account is resolved by
  trigger — the line, then the company default, then the country model.
  `ekwo init` offers `country_defaults.currency_code` as the currency of the
  company, which has to happen before the insert: `companies.currency_code` is
  `not null default 'EUR'` and is never empty afterwards.

- **A freshly installed company refused its first payment.**
  `country_defaults.bank_account_code` was declared from the first release and
  read by nothing, so `install_country_template` left
  `journals.default_account_id` null on every journal and `post_payment()`
  found no bank side — the demo seed wired it by hand, which was the symptom.
  Migration `20260911183000` adds `cash_account_code` to the country model and
  points the bank and cash journals at their account (`550000` / `570000` in
  the PCMN, `512000` / `530000` in the PCG). A company that already chose a
  default account keeps it.
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

- **No currency and no language written into the code either.** The MCP tools
  that create a product, a document or a bank account fell back to `'EUR'`
  when the caller named no currency; they read the company's own now, and
  refuse with `not_found` on a company they cannot see. `bootstrap()` took
  `'EUR'` and `'fr'` the same way and now takes the pack's, or says which flag
  to pass. A currency and a language are what a country decides, so a literal
  one is a country in the code wearing another hat — a guard test refuses both
  in `packages/*/src`.

- **No default country, anywhere.** `ekwo init` used to label the country
  question with `PCMN` and `PCG` written in the CLI and to preselect Belgium.
  The list and the labels now come from `country_packs`, sorted by name, so
  installing a pack is what adds a choice; there is no preselected value,
  because the one question whose wrong answer is a chart of accounts has no
  right default. Non-interactively, `--country` is required and the refusal
  names the packs installed. The currency and the language come from the pack
  and are asked for when it carries none, instead of falling back to `EUR`
  and `fr` written in code.

- **Five country literals removed from published migrations.** The Belgian
  frame VI inside `vat_return()` in `20260911121000`, and the backfills that
  named `'BE'` and `'FR'` in `20260911183000` (cash account), `20260912074712`
  (default language) and `20260912080311` (report code). The first three
  values are pack data and the compiled seeds upsert them; the fourth needed
  no backfill at all, since a null `report_code` on a posting means "the
  periodic return of the country" and `vat_return()` reads it that way. Those
  files were edited rather than overridden, once, because no installation
  anywhere had run them — the rule and its exception are written down in
  `supabase/migrations/README.md`. Three tests now keep it that way: no
  function in `public`, no file under `supabase/migrations/`, and no source
  file of the CLI, the MCP server or the core may hold a country code.

- **Declaration boxes are data, and `vat_return()` holds no country (P0-3).**
  Migration `20260912090407` adds `tax_report_templates` — one declaration form
  of one country — and `tax_report_box_templates` — one box, with `plus_boxes`,
  `minus_boxes` and `floor_zero` where it is a total. `ekwo pack build`
  compiles `packs/<cc>/tax_report.json` and the `tax_report_boxes` labels of
  `i18n/` into them, so the Belgian 71/72 and the French CA3 totals (01, 16,
  23, 25, 28) are pack data. `vat_return(company, from, to, report_code)`
  evaluates the totals in the `sequence` the form declares and returns, beside
  the four columns it always did, the `name` of each box, its `sequence`,
  `hidden` and `report_code`; the three-argument call is unchanged. The last
  `fiscal_country = 'BE'` leaves the core, and a test keeps it out: no function
  in `public` may hold a country code in its source. `ekwo pack check` refuses
  a formula that names a box the form does not carry, a bare reference that
  could mean two boxes, a total that names itself or a total computed after it,
  a formula on a box that is summed from the ledger, a box declared twice, and
  a tax that posts to a box the form does not declare.

- **Opening balances and a year-end close that is a parameter, not a branch**
  (migration `20260912094412`). `opening_balance(company, year, lines)` takes
  the trial balance of whatever kept the books before and posts it as the
  opening entry of a year, on the opening journal, dated on its first day;
  balance-sheet accounts only, unless the caller says it is taking books over
  mid-year. `close_fiscal_year(year)` moves the result out of the income
  statement the way `country_defaults.closing_style` says — straight to
  retained earnings, into a current-year result account on the balance sheet,
  or through an appropriation account of the income statement — zeroes every
  income and expense account, and closes the year. `reopen_fiscal_year(year)`
  reverses what it wrote, never deletes it, and is refused once a later year
  is closed or booked into. Belgium's 693/793 to 140/141 and France's 120/129
  are values in `packs/be` and `packs/fr`, and a test asserts that no function
  of this change holds a country code or an account code. The close writes no
  *à-nouveaux*: every report here reads the ledger from the beginning, so an
  opening entry on top of it would count each balance twice —
  `docs/decisions.md` carries the reasoning and what reversing it would cost.
  `fiscal_years.is_closed` is no longer an ordinary column: a trigger refuses
  the transition to anyone but those two functions, and `entries.kind`
  (`normal | opening | closing`) says what an entry is for so a statement of a
  closed year can leave the year-end entries out without a heuristic — written
  by those three functions, refused to everyone else by a trigger, and carried
  by a reversal from what it undoes. **None of the five new
  `country_defaults` columns carries a default**: a default closing style is
  one country's mechanism handed to every country that has not spoken, so a
  pack that says nothing is refused by name — `no_closing_defaults`,
  `no_opening_journal` — and `ekwo pack check` catches the same gaps before a
  seed is written. Three MCP tools —
  `opening_balance`, `close_fiscal_year`, `reopen_fiscal_year` — and
  `ekwo status` now says how many financial years are open.

- `DISCLAIMER.md`: software, not advice; the books are yours; what a pack
  and a review are and are not; estimates are estimates.

- `MANIFESTO.md`: why Ekwo exists — financial autonomy for every business,
  accounting as a commons, a network rather than a vendor — and a "Ways to
  help" section in `CONTRIBUTING.md` for accountants, translators and
  people who run it.

- **Ekwo maintains a pack; only an accountant reviews one.** The certification
  scale had a value `ekwo` that read as "certified by Ekwo", which is a claim
  nobody here can make: writing a pack and proving it internally coherent is
  not a professional reading it against the law. `pack_certification` gains
  `maintained` (migration `20260912081014`), Belgium and France become
  `maintained` rather than `ekwo`, and migration `20260912081015` moves any row
  that held the old value and empties `certified_by`, which said "Ekwo AI".
  `ekwo` stays in the enum — a published column never loses a value — and is
  deprecated: nothing writes it and the pack schema refuses it. `ekwo init`,
  `ekwo status` and the header of every generated seed print the same
  sentence, from one place in the CLI: "maintained by Ekwo — not yet reviewed
  by an accountant", "reviewed by X on Y", "community pack — not reviewed".

- **Two columns Canada will need, added before Canada.** Migration
  `20260912080311`: `report_code` on `tax_posting_templates` and
  `tax_postings`, backfilled to `BE-VAT-PERIODIC` and `FR-CA3` and written by
  the compiler from `tax_report.json` (a posting may override it with
  `"report"`); and `region` on `companies` and `contacts`, ISO 3166-2 without
  the country prefix. A box number is unique only inside one form, and a
  Canadian company files two returns at once; Canadian tax follows the
  buyer's province, not the seller's. Adding either with the pack would mean
  migrating tables that by then hold years of postings. Nothing reads `region`
  yet — the rules that turn it into a suggested tax are phase 1 — which is
  said out loud in the migration rather than left to be discovered.

- **An installation knows which country pack it holds, and each company
  knows which one it copied.** Migration `20260912074712` adds `country_packs`
  — version, release date, sha256 of the pack files, certification status and
  who signed it — written by the generated seed; and `company_packs`, written
  by `install_country_template`, backfilled at `1.0.0` for companies that
  already exist. `ekwo status` prints both and warns when a company is behind
  the pack the instance holds; `ekwo init` prints the certification status
  before anything is booked, in as many words when a pack is a community one.

  **The generated seeds upsert**, on the template tables and on nothing that
  belongs to a company. Until now they said `on conflict do nothing`, so an
  instance installed last month received no pack correction at all — not even
  for a company created afterwards, since a company copies the templates at
  install time. Applying a seed twice still changes nothing; applying a
  corrected pack now corrects the template and leaves every company alone,
  which is a test.

  Labels can be translated: `account_templates.name_i18n` and `accounts.name_i18n`
  (jsonb, from `packs/<cc>/i18n/`), `companies.language`,
  `country_defaults.language_default`, and
  `install_country_template(company, country, language)` — a third argument,
  defaulting to the company's own language — which copies
  `coalesce(name_i18n->>language, name)` into `accounts.name` and keeps the
  whole object beside it. `ekwo init --language nl` chooses it. The
  two-argument form is dropped rather than overloaded: an overload with a
  default argument makes `install_country_template(company, 'BE')` ambiguous,
  and Postgres refuses the call that works today.

  `accounts.statement_hint` and `account_templates.statement_hint` are added
  in the same migration; `financial_statement()` reads them in P0-4.

- **Country packs, and the compiler that turns one into a seed.** A country
  now lives in `packs/<cc>/`: `pack.json` (manifest, defaults, roles,
  journals), `accounts.csv` (the chart, in the CSV subset every accounting
  tool exchanges), `taxes.json` (taxes and their postings), plus
  `tax_report.json`, `statements.json` and `i18n/`, which this release
  validates and does not yet compile. `packs/schema/pack.1.json` is the
  published JSON Schema (draft 2020-12) for all of them, and it has no field
  through which a pack could execute anything — a test asserts that.

  `ekwo pack build <cc>|--all` compiles a pack into
  `supabase/seed/<n>_pack_<cc>.sql`, which is committed; `ekwo pack check
  --all` recompiles in memory and refuses a stale seed, and the CI's *hygiene*
  job runs it. The SQL is a build artefact like `docs/schema.md`, and
  `supabase db push` and `psql -f` still install a country without this CLI
  ever running. The CLI gained no dependency: the schema validator is a
  hundred and eighty lines of the subset the pack schema uses.

  Belgium and France were extracted from the four seeds that held them, with
  no change of content: `10_pack_be.sql` and `11_pack_fr.sql` replace
  `10_chart_be.sql`, `11_chart_fr.sql`, `20_taxes_be.sql` and
  `21_taxes_fr.sql`, which move to `tests/fixtures/seeds-before-packs/` where
  a test loads the old four into one database and the new two into another and
  compares every row of `account_templates` (353 + 392), `journal_templates`
  (12), `tax_templates` (36), `tax_posting_templates` (128) and
  `country_defaults` (2).

- `docs/international.md`: the plan for making the core usable in any
  country — the country pack as data, four phases, the order of countries.

- **`products`, in the core rather than in a module beside it.** Migration
  `20260911195054`: a code unique in the company (EN 16931 BT-155), a name
  (BT-153), a description (BT-154), `service` or `goods`, a unit from UN/ECE
  recommendation 20, a sale and a purchase price, the account and the tax each
  side books to, and `active`. Row level security by company, in the same
  migration. `document_lines` gains `product_id` — nullable for ever, because
  free text is how most invoices are written — and `description`; the unit
  stays on the `unit_code` that shipped in the first release.

  A product **pre-fills a line and never constrains it**: the line keeps its
  own text, price, unit, account and tax, so a catalogue edited next month
  cannot change what an invoice said last month. The account resolution gains
  its product step — the line, the product, the company default, the country
  model — and the `document_line_items` view puts BT-153, BT-154 and BT-155
  side by side for a Factur-X or Peppol document.

  The MCP server gains `search_products`, `create_product` and
  `update_product`, and a line of `create_document` or `update_document_lines`
  takes `product_id` or `product_code`. `@ekwo-ai/core` carries `Product`,
  `ProductKind` and the short list of unit codes. The demo company carries
  four products and three invoices written from them.
- **A bank account at install time, and a tool to add one later.**
  `ekwo init` asks for the IBAN of the main account — optional, with `--iban`,
  `--bic` and `--bank-name` for the non-interactive form — and creates the
  `bank_accounts` row wired to the bank journal and to the ledger account the
  country model put behind it. Running `init` again with the same IBAN finds
  it rather than creating a second. The MCP server gains `create_bank_account`
  and `list_bank_accounts`, `record_payment` documents its `bank_account_id`,
  and the `no_bank_account` refusal now names the tool that fixes it.
  `ekwo doctor` warns — never fails — about a company with no bank account.
- **The write path has a test under row level security.** Every test in this
  repository ran as the table owner, which is exempt, so the two bugs above
  were invisible: an accountant now posts a document and matches a payment
  under `set role authenticated`, and both counters are exercised.
- **`npx @ekwo-ai/mcp`** — `packages/mcp`, the Model Context Protocol server.
  Tools over stdio: read the companies, the chart of accounts, the
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
- **A test suite for the installer**, covering the migration runner
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
