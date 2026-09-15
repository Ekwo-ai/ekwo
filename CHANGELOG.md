# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
adheres to [Semantic Versioning](https://semver.org/).

Migrations are additive. A published migration is never edited: a database
somewhere has already run it.

## [Unreleased]

## [0.3.0] — 2026-09-15

### Added

- **The sources of a pack become a register somebody can open.**
  `legal_reference` said which article a rule claimed and never where to read
  it, and `certification.sources` was a list of bare titles: a reviewer holding
  *Arrêté royal n° 20, tableau A* had a citation and a search engine. It is now
  a register — a key, a title, the official publisher, an absolute `https` URL
  and the day somebody opened it, out of a closed vocabulary of six kinds
  (`law`, `regulation`, `form`, `standard`, `portal`, `guidance`) — and every
  tax, box, chart, statement, statement line, legal mention and fixed-asset
  rule names a key beside the article it already carried. The article stays on
  the rule and the link stays in the register, so a publisher that reorganises
  its site is one line of a pack to change. No pack copies a word of the law:
  a quotation ages without anybody noticing.
  The four packs carry 53 texts between them, every URL opened on 15 September
  2026, and 462 rules point at one — including all 110 taxes and all 243 boxes.
  `ekwo pack check` refuses a duplicate key, a key the register does not
  carry, an entry that is not shaped like one, a non-`community` pack whose
  register is empty, and — on a `reviewed` pack — a tax or a box that names no
  source, which is the substance of a review; a `maintained` pack is warned
  instead. The bare string is still read so that a pack written before this
  compiles, and is warned about as deprecated.
  `ekwo pack check --links` opens every URL and names the ones that went
  quiet. It is opt-in, the CI never runs it, and it never changes the exit
  code: Légifrance refuses a request with no browser behind it, and a gate on
  that would fail a contributor's pull request for something nobody in it did.
  The register compiles into `country_packs.sources`, the key travels with the
  rule in `tax_templates.source_key` and `tax_report_box_templates.source_key`,
  and the MCP tool `describe_pack` returns all of it, so an application can
  answer "where do these rules come from" without reading a pack. The
  walkthrough in `docs/packs.md` now starts at step 0: open the consolidated
  text, the decree, the form with its notice and the filing portal, and write
  them down before a line of JSON.
  No figure moved. The three golden expectation files of every pack are
  byte-for-byte what they were.

- **A treatment for a service bought from a supplier who is not established
  here, and a check that a tax's three code lists agree.**
  `tax_treatment` gains `foreign_services_received`: the general
  business-to-business rule of articles 44 and 196 of Directive 2006/112/EC,
  which the vocabulary had no word for — `intracom_acquisition_services`
  covers a supplier in another Member State and `import` is goods declared to
  customs, so the Estonian pack had been declaring such a tax as an import and
  saying so in its own legal reference. The name is about establishment rather
  than about the border, which is why it is not `import_services`. It resolves
  to the reverse-charge mention on an invoice, and `EE-P-VS-24` now carries
  it.
  `ekwo pack check` gains the correspondence between `treatment`, the EN 16931
  category (BT-118, BT-151) and the VATEX reason (BT-121), transcribed from
  UNCL5305, from the Commission's *Technical guidance for tax codes in
  EN 16931* version 1 and from the pairings the VATEX list publishes on its
  own codes. Neither of those two columns is read by the ledger or by the
  declaration, so nothing had ever compared them to anything: a pack could
  declare an export at the standard rate and the whole suite passed. Twenty
  taxes across the four packs were corrected — the intra-Community supplies
  and acquisitions carried the reverse-charge pair where the supplier's
  invoice carries `K` and `VATEX-EU-IC`, and the imports of goods claimed a
  standard rate no supplier had levied. `docs/packs.md` carries the table and
  the two decisions behind it.

- **A document can be sent to the person it is addressed to, behind a link they
  open without an account.**
  `document_shares` holds a link onto one sales document; `share_document()`
  creates one and returns its token once; `revoke_share()` stops it, for good;
  and `shared_document(token)` — the one function `anon` may execute that is not
  a policy helper — returns that document as jsonb: the header, the lines, the
  VAT breakdown, the totals, the legal mentions in the document's own language,
  the seller's identity and payment details, and what is still owed today with
  the date of the last payment, so a link a customer keeps stays worth opening
  after they have paid.
  The token is the whole secret: 32 bytes as 43 base64url characters, stored
  only as a sha256, returned by the call that creates it and by nothing else.
  It is drawn from two `gen_random_uuid()` rather than `gen_random_bytes(32)`,
  because `pgcrypto` is not available under PGlite and an invariant that cannot
  be tested is an invariant nobody is keeping.
  `anon` holds no privilege on `document_shares` or on any view: the invariant
  of `20260911210131` is kept, not bent. An unknown token, a withdrawn link, an
  expired link and a document that may no longer be shared all answer with the
  same null, so the function is an oracle for nothing. Sales documents only —
  a purchase invoice is a third party's own document — never a draft, never a
  cancelled one.
  A new capability, `documents.share`, on the owner and accountant presets;
  `instance.public_base_url`, nullable and with no default, which the returned
  `url` is built on; `share_document`, `revoke_share` and `list_shares` as MCP
  tools, and `shared_document` deliberately not one; and the count of live
  links per company in `ekwo status`. [`docs/sharing.md`](docs/sharing.md) is
  the reference and `docs/decisions.md` carries the reasoning.

- **The recapitulative statement of intra-Community supplies, as one function
  of the core and four format bricks.**
  Every Member State asks a seller the same question — to whom, in another
  Member State, did you supply goods and services without charging VAT, and for
  how much — and then wants the answer in a file of its own shape. Nothing here
  could answer it: the boxes of the return hold the totals and not the
  customers, and a listing per customer cannot be read back out of them.
  **`ec_sales_list(company, from, to)`** returns one line per customer VAT
  number and per nature of supply, summed from the posted ledger in the
  company's currency with credit notes deducted. The nature comes from the
  treatment of the tax with its `intracom_` prefix removed, so the day that
  vocabulary gains the triangular operation all four forms print, the function
  returns it without a line changing. A supply that cannot be declared — a
  customer with no VAT number, a number that is not in another Member State —
  comes back with the reason in `issue` rather than being dropped, because a
  file that balances against nothing is worse than a file with a hole in it.
  It is exposed as an MCP tool beside `vat_return`, and the prompt that prepares
  a return now asks for it.
  **It refuses no period**, where `vat_return()` refuses one the company does
  not file on. `companies.vat_period` records how often the *return* is filed,
  and the statement has its own cadence in three of the four countries read
  while writing this — that gap, and four more, are written down in
  `docs/international.md` rather than patched.
  **The files are four MIT bricks**, each written only from a specification
  that could be read and each citing it: `@ekwo-ai/intra-consignment` for the
  Belgian listing of Intervat, `@ekwo-ai/des` for the French déclaration
  européenne de services, `@ekwo-ai/ecdf` for the Luxembourg interface file and
  its four statement forms, `@ekwo-ai/vd` for the Estonian form VD. They agree
  on almost nothing — one line per nature against one line per customer, a
  country field apart from the number against the two joined, cents against
  whole euros — which is what organising by format and never by country is for.
  The French état récapitulatif TVA on goods is **not** among them: its XML is
  the INSTAT envelope, whose habilitation number and statistical fields a set of
  books does not hold, and `packages/formats/des/README.md` says so with the
  documents a successor would start from.
  Each pack's golden scenario gained the supply of services it was missing, and
  the Belgian one a credit note on an intra-Community supply — the document that
  proves the listing and the return do not read alike, since Belgium reports
  that credit note positively in a box of its own and the statement deducts it
  from the customer.

- **A company opens on the part of its chart it actually works with.**
  A country pack is a transcription of the regulation — 120 accounts in
  Estonia, 353 in Belgium, 394 in France, 1 026 in Luxembourg — and a company
  uses a fraction of it: two production installations measured on a full year
  of books used 60 accounts out of roughly 300 and 126 out of roughly 300.
  Nothing about the packs changes; a second question is added beside the chart.
  **`accounts_in_use(company, from, to)`** (migration `20260914143915`) returns
  the accounts a company is working with: those carrying a line of a posted
  entry — in the period when one is given, ever when none is — those its
  configuration points at by foreign key (the role defaults, a contact
  override, a journal, a tax posting, the transition account of a cash-basis
  tax, a bank account, a product), those a module it has enabled holds, and
  those somebody pinned; minus the deprecated ones. A configuration reference
  is not dated; only the movement is.
  **`accounts.pinned`** is the column an operator edits to add an account the
  rules cannot know about, or to keep one that has stopped being referenced.
  `install_country_template()` now pins what it wires — eleven accounts on
  Belgium, Estonia and Luxembourg, fifteen on France: the roles of the country
  model, the accounts of its financial journals and the accounts its taxes
  post to. A country model names about a dozen accounts whatever the size of
  its chart. Pinning is display and never a restriction: any account of the
  chart that is not deprecated may still be booked on.
  **The socle still ignores its modules.** It does not name `assets` or
  `budgets`: it asks each module the company has enabled for
  `<schema>.accounts_in_use(uuid)`, the convention `disable_module()` already
  reads for `can_disable`. A module that references no account writes no such
  function.
  **`list_accounts` starts from that set**, says which scope it answered with,
  and takes `include_all` for the whole chart, `include_deprecated` for the
  whole chart with the retired accounts, and `in_use_from` / `in_use_to` to
  narrow the movements to a period. **`pin_accounts`** pins or unpins by code.
  The `ekwo://companies/{id}/chart` resource is unchanged and still carries
  everything.

- **How often a company files its VAT return is data, and the return reads it.**
  `vat_return()` takes two dates, which is right, but nothing held how often
  the company files at all, so a quarterly filer could be handed a July return
  and nothing said so. Three columns, each where the answer belongs:
  **`tax_report_templates.periods`** is what the form accepts — a list, because
  one set of boxes may be filed on more than one cadence;
  **`companies.vat_period`** is what this company files, nullable and with no
  default; **`country_defaults.vat_period_default`** is what the pack proposes.
  The vocabulary is an enum, `month | quarter | year`, and
  `month_or_quarter` — never a cadence anybody files on — is read as the two it
  names, so a pack written before the list keeps working.
  **`vat_return()` refuses a period the company does not file on**, by name,
  and only when the refusal is certain: the form offers the recorded cadence,
  the dates are themselves a whole cadence of that form, and the two differ. A
  fortnight, a half-year and the annual form a quarterly filer also files go
  through, because the function is a control query as often as a filing.
  **`ekwo init` asks** when the country's form offers several and the pack
  proposes none, `--vat-period` answers outside a terminal, and a company that
  has not decided is recorded as not having decided. **`ekwo status` prints
  it.** **Estonia is the only pack here that proposes a cadence** — the
  taxable period is the calendar month for everybody, käibemaksuseadus § 27
  lõige 1. Belgium, France and Luxembourg all make it follow turnover, so each
  cites the article that says so on its form and leaves the proposal empty.
  Migration `20260914163943`; packs `be` 1.6.0, `fr` 1.7.0, `lu` 1.1.0,
  `ee` 1.1.0 — one bump each, covering this and the `seed_sequence` field the
  Estonian pack added to the three manifests without bumping them.

- **Luxembourg, as `packs/lu/`.** The third country pack, and the first
  contributed from published sources rather than from books somebody keeps.
  It carries the **plan comptable normalisé** of the *règlement grand-ducal du
  12 septembre 2019* whole — **1 026 accounts, 747 of them postable**, the
  depth the regulation prescribes, because Luxembourg publishes no abridged
  chart: what it abridges for a small company is the presentation.
  **35 taxes**: the four rates of article 39 — 17 %, 14 %, 8 %, 3 % — with the
  **temporary 2023 rates beside them**, 16 %, 13 % and 7 %, each with its own
  validity, so a document dated in 2023 books at the rate of its own year and
  lands in the boxes the form keeps for it. Intra-Union supplies and
  acquisitions of goods and of services, export, exemption under article 44 and
  the domestic reverse charge on both sides.
  **The eCDF periodic VAT return**, `LU-VAT-PERIODIC`, with the **156 numbered
  fields** of its four sections and the totals its own validation rules state.
  The monthly form and the quarterly form carry the same numbering, so one
  definition covers both.
  **The two abridged schemes of annual accounts**, `LU-ECDF-BS-ABR` and
  `LU-ECDF-PL-ABR`, whose **line codes are the eCDF field identifiers** — `203`,
  `651` — so a future filing brick maps a line to a field without a table in
  between. All 747 postable accounts reach exactly one line, by the State's own
  *tableau de passage*, transcribed account by account.
  **French, German and English**, all three complete, and the German and the
  English are the versions the State itself publishes on the eCDF forms rather
  than a translation made here.
  A golden year of ten documents and three payments, `certification.status`
  **`community`**, and a pack README that ends on the ten points a Luxembourg
  reviewer should look at first. Out of scope in v1 and said so: the XML of an
  eCDF deposit, the FAIA audit file, the annual VAT return, the franchise and
  group regimes, and corporate income tax.
- **Estonia, as `packs/ee/`, a pack written from the outside in.**
  **`packs/ee/`** carries an original chart of 120 accounts, 29 taxes, form KMD
  and the two statements of the annual report, and it compiles to
  `supabase/seed/11_pack_ee.sql`. Nothing in the core changed for it: no
  migration, no function, no column, and `tests/golden.test.ts` replayed its
  fourteen documents without knowing that Estonia exists.
  **The rate history is in the pack, because a code is a rate at a date.** The
  standard rate is there three times — 20 % to the end of 2023, 22 % to 30 June
  2025, 24 % since — so a document dated in 2024 books at the rate of 2024 and
  a credit note correcting it lands in the box today's form keeps for it. The
  24 % carries no end date: the reversion to 22 % in 2029 was enacted and then
  repealed with the Act that carried it.
  **The chart is written, not copied.** Estonia prescribes none, so this one
  follows the convention Estonian practice shares — four digits, four classes,
  equity inside class 2 — and is blocked so that each range of codes maps onto
  one line of the statutory balance sheet or income statement.
  **Form KMD nests, and the pack says how it handled that.** A tax reports its
  base to one box; the form asks for the same amount in a box, in the memo box
  inside it, and sometimes in a third. The pack posts to the innermost box and
  rebuilds every printed parent as a total, which takes six boxes the form does
  not print, all marked `hidden`. `packs/ee/README.md` lists them.
  **Status `community`**, and it stays there until an Estonian accountant has
  read it and put their name in the manifest. Every rate, box and mention cites
  its article; six things the core could not express are recorded in
  [`docs/international.md`](docs/international.md) with a proposed fix, and none
  of them was patched into the core for one country.
- **A pack declares the number its compiled seed carries, and a published
  number never changes.**
  It was the pack's rank in the alphabetical list of slugs, so inserting a
  country in the middle of the alphabet renamed the seed of every country after
  it — a release renaming a file that installations already hold. **`seed_sequence`
  is now a required field of the manifest**: Belgium 10, France 11, Luxembourg
  12, Estonia 13, and nothing sorts anything. `ekwo pack check` refuses a pack
  that declares no number and `ekwo pack build` refuses two packs claiming one.
  The three published seeds keep their names; each gains one changed line, the
  checksum of a manifest that now carries the field.

- **`ekwo doctor` compares the database to an inventory of what the release
  defines.**
  The check knew how to say that a table had no policy; it could not say that a
  table was gone. **`packages/cli/assets/expected-objects.json`** is now the
  list of everything a release defines — tables and their columns, views,
  functions with their signature, policies, triggers and types, per schema —
  and it is **generated from the migrations** by
  `scripts/generate-expected-objects.mjs`, exactly as `docs/schema.md` is, never
  kept by hand. It ships inside the package, so `npx ekwo doctor` carries it,
  and two CI jobs hold it there: one regenerates it and fails on a difference,
  one diffs the shipped copy against the repository's.
  **Missing, extra and a policy are three different answers.** Missing means the
  installation is behind or damaged, and fails. Extra means the operator added
  their own object, and is reported as information. A policy missing *or* added
  on a table of this schema fails either way round, because row level security
  is the security model. A column whose type has moved is reported as changed.
  `ekwo doctor` still exits `1` on a problem and `0` on everything else, so it
  stays usable as a deployment gate.
  **A module is required of a database that carries it**, and a module whose
  migrations never ran is named and skipped. **A database older than the CLI is
  compared anyway**, and the report says which version each side is at.
  `--json` carries the whole comparison, section by section. `npm run inventory`
  regenerates the file in a checkout.

- **A golden year of books per country pack, and a legal source on every tax
  and every box.**
  A pack could describe a country but could not be wrong in a way anyone would
  notice: a tax that posts to the wrong grid and a grid that expects the wrong
  postings agree with each other, the seed compiles and the return is wrong.
  **`packs/<cc>/golden/`** is the second opinion — `scenario.json`, ten
  documents at least of one financial year with the payments that settle some
  of them, and beside it three generated files holding what the engine makes of
  them to the cent: `vat_return.json` period by period, `statements.json` line
  by line, `trial_balance.json` account by account.
  **One runner, and no country inside it.** `tests/golden.test.ts` reads
  `packs/`, installs a company on each pack from what that pack's own scenario
  declares, replays it through `post_document`, `post_payment` and `reconcile`,
  and compares. What it demands of a scenario it demands of the pack: a tax due
  on collection is required of a scenario whose pack has one, and of no other.
  `UPDATE_GOLDEN=1 npm test -- tests/golden.test.ts` rewrites the three
  expectation files and never the scenario.
  **A pack without a golden is refused** — by `readPack`, so by `ekwo pack
  check` and by the CI. A pack that cannot have one says why in its manifest,
  under `"golden": { "exempt": "…" }`, and the commands print the sentence.
  `packs/generic` is the only exemption here: a framework has no chart, no
  journal, no tax and no currency, so no company can be installed on it.
  **`legal_reference` is now required on every tax and on every box of a
  declaration**, and the thirty-one Belgian grids and twenty-two French lines
  carry theirs. A golden proves internal coherence and never legal truth, which
  is exactly why the source and `certification.status` have to carry the rest.
  **`.github/CODEOWNERS`** names an owner per pack.
  The first run found two things in the French pack, reported rather than
  patched away: line 01 of the CA3 can come out negative when a quarter's
  credit notes exceed its sales, and line 08 does not tie to itself on an
  intra-Union acquisition, whose base goes to line 03 and whose tax goes to
  line 08. Both are in [`docs/decisions.md`](docs/decisions.md).
  Belgium moves to 1.5.1, France to 1.6.1 and the generic framework to 1.1.1:
  a legal source is a patch.

- **An end-to-end test: the same release installed two ways, and a whole
  financial year played out.**
  `npx ekwo init` and `supabase db push` + `psql -f` have always been
  documented as interchangeable, and nothing checked it. `tests/e2e/` now
  installs the release both ways into two databases and compares the migration
  history, every column of every table, the body of every function and every
  row of every table the seeds write, rendered and sorted. The second path
  imports nothing from the CLI, so what is compared is two installers rather
  than one installer twice.
  **It found one difference, in the documentation rather than the code.** The
  by-hand instructions in the README named two seed files of the four
  `config.toml` lists, so an installation made that way came up with a chart of
  accounts and no generic financial statements, and nothing failed until
  somebody asked for a balance sheet. The README is corrected and a test reads
  it: every seed file the installer applies must be named there. On every byte
  of reference data, the two paths agree.
  **Then the year.** A company installed from the frozen 1.0.0 seeds is brought
  to this release, its pack upgraded through `ekwo pack upgrade`, and carried
  through the opening balance, a sale, a purchase, the VAT return, both
  financial statements, the close, the re-opening and the close again — once
  per country the frozen seeds carry, naming none of them: the accounts, the
  journals, the tax, the declaration form and the schemes all come out of the
  pack. Every figure is compared to one the test works out itself from
  `sum(debit) - sum(credit)` and the pack's own rows, including the rule engine
  that puts an account on a line and the evaluator the forms and the statements
  share. Closing is what makes a balance sheet balance, and both sides of that
  are asserted: out by exactly the result before, nil after.
  **`npm run e2e:supabase`** does the same against a real Supabase project,
  through the published binary, a GoTrue sign-in and PostgREST — the four
  things PGlite is not. It installs at the previous tag, migrates, upgrades the
  pack, signs in, books, files and closes, and prints a pass/fail table. It is
  run by hand before a release is tagged, never by the CI, and it refuses a
  database that already holds an `instance` row.

- **The country pack is documented end to end, and an installation says what it
  leaves for its operator to do.**
  [`docs/packs.md`](docs/packs.md) now describes the format file by file, the
  compiler and the three kinds of seed it writes, the checksum that makes a seed
  stale when any file of its pack moves, **every rule `ekwo pack check`
  applies** grouped by what it guards — manifest, chart, roles, closing style,
  taxes, declaration form, statements and their fact keys, legal mentions,
  languages, golden scenario, module sections — and what it deliberately does
  not refuse. The certification policy says who may set `community`,
  `maintained` and `reviewed`, what a reviewer puts their name to, and what
  `.github/CODEOWNERS` is and is not. "Adding a country in a day" is a ten-step
  walkthrough a contributor can follow from `cp -r packs/be packs/xx` to the
  pull request.
  [`CONTRIBUTING.md`](CONTRIBUTING.md) states the seven invariants of a country
  pack: data never code, no country literal in the core, an account resolved by
  its role, a legal reference on every tax and every box, a golden scenario or a
  written reason there is none, a review that is a named professional, and
  nothing ever deleted from a pack.
  [`supabase/seed/README.md`](supabase/seed/README.md) says what each seed file
  holds, which five are generated and must not be edited, the order they are
  applied in and who applies each, with the counts corrected against the packs
  as they stand.
  [`docs/international.md`](docs/international.md) records phase 0 as delivered,
  item by item, without moving the roadmap.
  **And `ekwo init` prints, at the end of a successful installation, the four
  things it cannot do for you**: turn off self sign-up on your Supabase project,
  keep two administrators, keep the `service_role` key off machines that do not
  need it, and read [`DISCLAIMER.md`](DISCLAIMER.md) before filing anything.
  Three of the four are settings of a project rather than rows in a database, so
  no connection string reaches them and `ekwo doctor` does not pretend to check
  them. The installation guide carries the same four in the same words, and a
  test reads both.
  The installation guide also gains what a script hits before it hits anything
  else: **`ekwo init` refuses to pick a country, a chart of accounts or a
  language for you** outside a terminal, and names the flag; the four reference
  seeds are named, in the order they are applied; and the catalogue check of
  `ekwo doctor` says what it does **not** cover — constraints, indexes and
  function bodies. **Where table access comes from is written down**: it was a
  known gap when this guide was written, and the entry above closed it in the
  same release, so the section says what the schema grants and keeps the
  history that explains the symptom — an installation nobody has migrated,
  whose `public` schema was recreated without the project's default
  privileges, is one the doctor calls healthy and PostgREST answers
  `permission denied for table companies` on.
  Two examples in that guide were broken and are corrected: the non-interactive
  `ekwo init` one-liner and the scratch-project procedure both omitted
  `--chart` and `--language`, which the Belgian pack has made mandatory since it
  gained a second chart of accounts.

### Changed

- **A test may book in a country. It may not expect one.**
  Eleven test files named `BE`, `FR` and `LU` by hand: six loops over a literal
  pair of pack slugs, and tables keyed by country for the statements, the
  declaration forms, the charts, the exchange accounts, the closing parameters
  and the fixed-asset rules. Adding Luxembourg meant editing most of them, and
  until they were edited the pack was checked by nothing.
  Every one of those now walks `listPacks()` through the new
  `tests/helpers/packs.ts` and takes its expectation from the pack itself — a
  role of the manifest, an account of a chart, a box of the form. A test that
  needs the pack with a particular property asks for that property
  (`packWhere('taxes on collection', …)`) instead of naming the country that
  has it. The set of certification statuses comes from the published schema
  rather than a literal pair.
  A claim only one pack can make — a fact key of a national filing taxonomy —
  moves to **`packs/<cc>/golden/expectations.json`**, beside the golden and
  outside the pack checksum, read by one generic runner. Adding a country now
  touches the pack folder and its `golden/`, and nothing under `tests/`.
  `scripts/check-no-country-literals-in-tests.mjs` runs in the CI and keeps it
  that way; `docs/packs.md` describes the two places a pack is written.

- **A base is written once, and printed as often as the form likes.**
  A tax carries one `base` posting per kind of document, so a taxable amount
  has one definition and reaches one box — and a national form that prints that
  base a second time gets a computed `total`, not a second posting. The rule
  was enforced by `ekwo pack check` and written down nowhere. `docs/packs.md`
  now carries it where the postings are defined and again in the walkthrough,
  with the Luxembourg return as the worked example: box `472` adds the rate
  bases of section II instead of being posted to, and the Estonian `6.1` / `6`
  / `1` nesting is the same shape three deep. Documentation only: no pack and
  no function changed.

- **The code and the type of an account stop moving once it is in use.**
  Every reference to an account inside a company is a foreign key on
  `accounts(id)`, so renumbering one appeared to break nothing. The rules do
  not follow the key: a financial statement maps an account to a line by its
  code, and the eighteen account types are what put an account on one side of
  the balance sheet or in the income statement. Moving `700000` to `701000`
  moved a year of bookkeeping to another line of a statement somebody had
  already filed, and the `accounts_write` policy had nothing to say about it.
  A trigger (migration `20260914144731`) now refuses a change of `code`
  (`account_code_frozen`) or of `account_type` (`account_type_frozen`) on an
  account that carries a ledger line, is named by a tax posting, or plays one
  of the company's roles. The label, the translations, the notes, the parent,
  `reconcilable`, `deprecated` and `pinned` stay free, and deprecating remains
  the way to retire an account that was wrong.
  One consequence is deliberate: `pack_upgrade(…, apply => true)` now fails by
  name rather than moving a used account between statements. That difference
  was already a `review`, which is the rule that exists for a person to look.

- **`tax_report_templates.period` is now `periods`, a list, with no default.**
  The column defaulted to `month_or_quarter`, so a pack that had never
  considered its own cadence filed on Belgium's and France's, silently, in a
  column a reader would take for data. There is no default now, and
  `ekwo pack check` refuses a form that names none. `tax_report.json` accepts
  either the list or the single word it used to take.

- **The real-project end-to-end run times every step.** `npm run e2e:supabase`
  printed a pass/fail table; it now prints how long each step took and the
  total beside it. Over a pooler and a hosted PostgREST what matters about a
  release is not the total but which step holds it — a migration set that
  doubled, a first query waiting on a cold project, a close that got slower as
  the ledger grew — and a number that moved between two releases is a question
  worth asking before the tag, not after.

### Fixed

- **`ekwo pack check` refuses a sign on a statement line computed from other
  lines.** `sign: -1` is how a scheme prints a credit balance as a positive
  figure, and `financial_statement()` applies it when it sums the line from the
  ledger. A total is worked out from lines that already read that way, and the
  evaluator then multiplied the total by the total's own sign as well — so a
  scheme that flipped a credit line and flipped the subtotal above it got the
  figure back the way it started, silently. It cost the Luxembourg pack a wrong
  set of golden figures, caught by somebody reading them. The two are refused
  together, the explicit `1` included; `minus` is how a total subtracts. The
  evaluator is unchanged and no pack combined the two, so no golden figure
  moved.

- **`ekwo pack upgrade` left a company on the old version when the release
  changed nothing the difference compares.**
  The command asked for the difference first and returned early when it was
  empty, saying the company was already at the version this installation holds.
  Those are two different claims: a patch release — a legal source added to a
  tax, a box renamed — moves the pack version and touches no natural key, so
  the difference is empty and `company_packs` went on recording the old
  version for ever, with `ekwo pack status` calling the company behind every
  time. `pack_upgrade()` already handled an empty difference by recording the
  version, so the early return is gone rather than corrected. Found by the
  end-to-end run against a real project, upgrading an installation made at
  v0.2.0: Belgium moved 1.5.0 to 1.5.1 and the company stayed on 1.5.0.

- **`ekwo status` and `ekwo doctor` reported an ordinary installation as ahead
  of the CLI.**
  `ekwo migrate` applies the modules' migrations beside the socle's and records
  them in the same history, which is what it is meant to do. The other two
  computed their gap against the socle alone, read those versions as history
  they had no file for, and told the operator to upgrade a CLI that was already
  current. All three now build the same set.

- **`docs/schema.md` no longer reorders its overloads on its own.** The
  function table was ordered by name alone, and two functions of the same name
  were left in whatever order the rows came off `pg_proc` — so rewriting one of
  them could move the pair in a document nobody had edited. It now orders by
  name and `oid`, and the two `resolve_line_account` entries swapped places
  once, for good.

### Security

- **The schema grants its own rights, and the anonymous role holds none on any
  table.**
  Until now not one migration gave `anon` or `authenticated` a privilege on a
  table. A Supabase project carries default privileges on `public` that hand
  `all` on every new table, sequence and function to the three API roles, so
  everything worked — and `anon`, the role behind the publishable key any
  visitor holds, had INSERT, UPDATE and DELETE on every table of the ledger
  with row level security as the only thing in the way.
  **Migration `20260914151207` declares the privileges by name**, table by
  table and view by view, with one migration each for the `assets` and
  `budgets` modules. `authenticated` may attempt exactly the verbs the policies
  of that table are prepared to judge: the four on the twenty-six a policy
  `for all` governs, SELECT alone on the twenty-four a country pack or a
  `security definer` function writes, and SELECT alone on `audit_log`, which
  is append-only by trigger for everyone including its owner. `anon` gets
  nothing on any table, view or sequence, and keeps the ten policy helpers it
  already had. `service_role` gets what a person gets. The twenty-nine trigger
  bodies stop being callable at all.
  **No wildcard, and no `alter default privileges` as the mechanism** — that
  is the hidden dependency being removed. The project's defaults are taken
  back and stopped; Ekwo's own EXECUTE default from `20260911210131` goes with
  them. From here, **a migration that creates a table, a view or a function
  grants it in the same file**.
  **`anon` could read every table of the `assets` and `budgets` modules**,
  whose opening migrations carried `grant select on all tables … to anon`.
  Row level security answered every such read with an empty set, so nothing
  leaked; the surface is closed now.
  **`ekwo pack upgrade` could not have worked through PostgREST.**
  `pack_upgrade()` writes its own audit line and was `security invoker`, so it
  called `audit_record()` — closed to `authenticated` since `20260914103412` —
  as the caller. On a real project the upgrade committed and the trail did
  not. `20260914152840` makes the function `security definer`, like its peers,
  and the capability test it already carried is unchanged.
  **What enforces it**: the `grants` section of
  `packages/cli/assets/expected-objects.json` — the inventory that already
  carries the objects a release defines, because a privilege and the object it
  sits on ship in the same migration — generated by `npm run inventory` and
  refused by the CI when it drifts; `tests/grants.test.ts`, which compares the catalogue to it,
  checks the doctrine against `pg_policy`, and books a whole country pack's
  golden year on a database whose roles start with nothing at all; and
  `ekwo doctor`, which reports a missing grant or an extra one to `anon` as a
  problem and a wider grant to `authenticated` as a warning.
  **The test harness stopped supplying privileges.** The Supabase shim and
  `freshDatabase` used to grant the three roles everything, which made the
  whole suite pass against privileges no installation was guaranteed to have.
  Every test file is now also a test of the grants.
  **The installation guide says the new answer and keeps the old symptom.**
  `packages/cli/README.md` described where table access comes from as a known
  gap; it now says that the schema grants its own rights, what that means for
  an application that reads a table without signing a user in, and why an
  installation nobody has migrated can still answer `permission denied for
  table companies`.

## [0.2.0] — 2026-09-14

The first published release. `0.1.0` below was the first schema and was never
tagged; nothing outside this repository had run it. From `v0.2.0` on, a
published migration is never edited — the rule is enforced on every push and
against the latest tag, and a mistake is corrected by a new migration, always.

### Added

- **An append-only audit trail, and the first pack upgrade.**
  The ledger was already immutable — an entry is posted once and corrected by a
  reversal — but everything *around* it was not: the chart of accounts, the
  journals, the taxes and the accounts they post to, the bank accounts, the
  contacts, the products, the financial years, the members and their roles, the
  pack version a company holds. Those decide how every future entry is booked,
  and nothing recorded that one of them had moved.
  **`audit_log`** records who (`auth.uid()`, and the machine key where one was
  presented), what (the table, the natural key, the row before and after as
  `jsonb`, the operation), when, and the company the change belongs to. Beside
  the ordinary edits it records the acts: a document posted or cancelled, an
  entry posted or reversed, a payment booked, matched or unmatched, a financial
  year closed or reopened, a pack upgraded. The ledger itself is not audited: a
  posted entry is immutable and is corrected by a reversal, so what is recorded
  is the act of posting and never the lines.
  **Append-only is a trigger, not a policy.** Policies do not apply to the table
  owner and `service_role` carries BYPASSRLS, so an audit trail defended only by
  row level security is one the operator can quietly rewrite. Nothing updates a
  row and nothing deletes one, except `purge_audit_log(date)` — `service_role`
  only, no default retention, and it writes its own row saying how many it
  dropped. Members of a company read its trail and nobody else sees anything.
  `api_keys.key_hash` and `company_invitations.token_hash` are never copied into
  it.
  **`ekwo pack status`** shows what each company copied against what the
  installation holds, and changes nothing. **`ekwo pack upgrade <company>`**
  moves it: the difference is computed by natural key and every difference falls
  into one of three rules — an addition is copied in, a closed validity is
  applied, and everything else is listed and left exactly where it was until
  `--apply`. A row the company holds and the pack does not is never applied at
  all: nothing is removed from a company's books by an upgrade. The recorded
  version moves only when nothing is left waiting. The rules live in the schema,
  `pack_upgrade_diff()` and `pack_upgrade()`, so an application or an assistant
  asking the same question gets the same answer.
  **The upgrade is tested from the published 1.0.0**, not from a fixture: the
  four hand-written seeds kept since the pack format replaced them are replayed,
  a company is installed from them, this release's packs land on top, and the
  test asserts that nothing is silent.
  **Versioning the socle.** Each of `ekwo`, `@ekwo-ai/core` and `@ekwo-ai/mcp`
  declares a `schema_min`, in `package.json` and as a constant, the way a country
  pack declares one in its manifest; the MCP server asks `ekwo_schema_version()`
  before it offers a tool and refuses an older database by name; `ekwo migrate`
  recommends a snapshot before it applies anything, because migrations move
  forward only and there is no `down`.
  **`read_audit_log`** is the MCP tool for it — filters on table, natural key,
  user, act, operation and date range — and there is no tool that writes it.
- **An amount is rounded at the decimals of its currency, by the method of its
  country.** `currencies.decimal_places` and `country_defaults.rounding_method`
  were filled by every pack and read by nothing: every rounding in the schema
  was `round(x, 2)`, fifty-one times, in eighteen functions, a view and a
  generated column. Two decimals is right for the euro and wrong for the yen,
  which has none, and for the dinar, which has three.
  **`round_amount(amount, rounding_of(company, currency))` is the one path.**
  `money_rounding` is the pair the two columns answer, `round_amount` the
  arithmetic and the only function that names a rounding method — half up, half
  even, down, up, all on the absolute value, so a credit note is its invoice
  with the sign flipped — and `rounding_of` the only reader of the two columns.
  A currency, a company or a country it cannot resolve is refused by name.
  Every ledger-affecting rounding of the socle and of the `assets` and
  `budgets` modules goes through it, including `post_document`, `post_payment`,
  `reconcile`, `settle_cash_basis_tax`, `close_fiscal_year`, `vat_return`,
  `financial_statement`, `fec_lines` and the depreciation schedule.
  A function that handles two currencies resolves two: a document is stated in
  its own and the ledger keeps the company's.
  **`document_lines.amount_untaxed` is now written by a trigger** rather than
  generated, because a generated column may not look up the currency of its
  document. It is still derived and still cannot be keyed in.
  **The tolerances are fractions of a unit**, through `currency_unit()`, where
  they used to be fractions of a cent.
  **`evaluate_totals` takes the rounding as an argument** and its three-argument
  form is gone; it is immutable and looks nothing up.
  **CI refuses a new one.** `npm run check:rounding` reads every migration
  written since, and a test asks the catalogue whether any live function, view
  or generated column still rounds to a number written down.
  What is not done, and is named in `docs/decisions.md`: the monetary columns
  are still `numeric(16, 2)`, so a currency with more than two decimals is
  rounded right and stored short.

- **Every label a user reads, in every language the country pack publishes.**
  The schema was bilingual in shape and monolingual in fact: `name_i18n` sat on
  the chart of accounts, the declaration boxes and the statement lines, and all
  four language files of Belgium and France were empty. A Belgian company
  keeping its books in Dutch was handed a chart of accounts, a set of journals
  and a VAT return in French.
  **Belgium now ships in Dutch, German and English, and France in English.**
  354 accounts across both Belgian charts, 394 French ones, the journals, the
  taxes, the boxes of the periodic return, the lines of the annual accounts,
  the sentences an invoice must print and the fixed-asset categories — complete,
  from the official wording where a country publishes one. Sources are cited in
  `packs/<cc>/i18n/README.md`.
  `journal_templates`, `journals`, `tax_templates`, `taxes` and
  `country_defaults` gain `name_i18n`, which is what was missing for a company
  to read its journals and its VAT codes in its own language;
  `install_country_template()` copies them through `label_for()` the way it
  already copied the accounts.
  **A pack declares its languages** — `languages` in the manifest — and the
  declaration is a promise: `ekwo pack check` fails, naming every missing key,
  if a declared language stops covering the pack. A language file that is not
  declared may be partial and falls back, which is how a language is
  contributed one section at a time. A label under a code the pack does not
  carry is refused either way.
  **One file per language.** A translation now lives only in
  `i18n/<lang>.json`: the inline `text_i18n` of a legal mention and the
  `name_i18n` of an asset category moved there, so a contributor edits one file
  and a reviewer reads one file.
  `country_defaults.languages` records what a pack publishes, `ekwo init` lists
  those languages with nothing pre-selected rather than guessing, `ekwo pack
  list` shows them, and the demo company says which language it keeps its books
  in. [`docs/languages.md`](docs/languages.md) is the mechanism end to end.
- **The FEC carries its opening balances, and an unclosed year carries its
  result.** `fec_lines()` returned the movements of a period and nothing else,
  so the file of a financial year could not rebuild the balance sheet it
  belongs to. It now prepends the *à-nouveaux*: one line per account that
  carries forward, at the balance of the day before the year opens, on the
  journal `country_defaults.opening_journal_code` names and as one balanced
  entry. They are **computed from `trial_balance()` and never posted** — every
  report here reads the ledger from the beginning, so an opening entry would
  count each carried balance twice — and a balance-sheet account is one whose
  `account_type` carries forward, never a code prefix.
  **A year the meeting has not closed yet still carries its result**: the
  accounts that do not carry forward are the mirror image of the balance-sheet
  ones, so what is left over goes on one more line, on the balance-sheet
  account the close would have used — France's 120 or 129 under
  `result_accounts`, retained earnings under the other two styles, because an
  appropriation account is inside the income statement and the closing entry
  empties it. A pack that names none gets `no_result_account`; a first set of
  books with nothing to carry is asked for nothing at all. The export is never
  refused for a year that is merely open.
  **And the entries a close writes leave the file of the year they close**:
  kept, they show the result twice and the income statement read from the file
  is nil. So the file of a closed year is byte for byte the file of the same
  year still open, and the result reaches the balance sheet in the opening
  lines of the year that follows. `financial_statement()` keeps the
  appropriation entry, which is part of a statutory income statement, and
  `docs/decisions.md` says why the two readers differ.
  The wording of those lines is `defaults.opening_entry_label` in the pack —
  France says *À-nouveaux* — with a neutral English fallback, because the
  format fixes eighteen columns and no wording. An extract that is not a whole
  financial year gets no opening lines. Same signature, same eighteen columns:
  `@ekwo-ai/fec` and the `generate_fec` tool need no change.

- **Modules: one Postgres schema each, and the ledger only through a
  function.** The socle stays in `public` and knows nothing about what is built
  beside it. `public.modules` is the registry — a table, written by the last
  statement of a module's own first migration, never a plugin list in code —
  and `company_modules` says which company has enabled which, written only by
  `enable_module()` and `disable_module()` because the table has no write
  policy at all. `module_enabled(company, code)` is the one call a module's row
  level security policies make, and it joins the eight helpers `anon` may
  execute: what it gives a stranger is the word `is_company_member` already
  gives them.
  **`post_module_entry()` is how a module reaches the ledger**: it hands over a
  company, a date, a tag and its lines as data, and the socle builds the draft
  and calls `post_entry()`. `entries.module_code` and `entries.module_ref`
  carry the tag, and a unique index on `(company_id, module_code, module_ref)`
  is what makes a module idempotent — the database refuses the second posting
  rather than the module remembering to look. No `entry_kind` value per module.
  Nine guards hold the rest: row level security on every module table, every
  company table's policies through `module_enabled()`, `company_id` on every
  table that is not reference data, no function of a module schema executable
  by PUBLIC or `anon`, no country, currency or language literal under
  `modules/**`, no write to `entries` or `entry_lines` and no direct
  `post_entry()`, a manifest that validates against `modules/schema/module.1.json`,
  migration timestamps that sort after every socle migration and are unique
  across the repository, and a module held to what its manifest says about
  posting.
  `ekwo module list|migrate|enable|disable`; `ekwo migrate` applies the modules
  by default and `--no-modules` leaves them out, which is what to pass before
  `supabase db push`. Module migrations share the socle's history with the
  module in the recorded `name` (`assets/assets`). The MCP server registers a
  module's tools under the prefix its manifest declares, reading
  `public.modules` for what is installed, and turns PostgREST's profile error
  into the sentence that names the setting — because exposing a schema is the
  one thing no migration can do.

- **`assets` — fixed assets, their depreciation and their disposal.** Straight
  line and declining balance, with the country's prorata convention, its
  declining cap and its switch back to the straight line as pack data in
  `packs/<cc>/assets.json`; the usual durations of a kind of asset as
  `assets.category_templates`, each one naming what it comes from. Every amount
  is rounded to the cent and the last line takes the remainder, so a schedule
  sums to exactly `cost − residual_value` — asserted on every asset of every
  test. `run_depreciation` books one entry per period through
  `post_module_entry()` and is a no-op the second time; a closed financial year
  refuses it, because `post_entry()` asserts the period. `dispose_asset` follows
  the country's own mechanism: `net_result` puts the difference on one account
  (Belgium 763/663), `gross` books the net book value as a charge and the
  proceeds as an income in full (France 675/775) — the enum names the mechanism
  and never a country, as `closing_style` does. `units_of_production` is in the
  enum and refused by name. Four nullable `country_defaults` columns, none with
  a default, carry the accounts each style needs; both packs move to 1.4.0.

- **`budgets` — what was planned, against what was booked.** The module that
  proves the mechanism holds for one that is not `assets`: no country data, no
  pack section, no seed, and not one line written to the ledger. A budget per
  financial year, its lines per account and period, and
  `budgets.variance(company, budget, from, to)` against posted entries of kind
  `normal`. The sign is the one a business says out loud — an income and a cost
  are both positive — and it comes from `accounts.internal_group`. It writes no
  `can_disable()`, which is the other half of that convention: turning it off
  takes nothing away.
- **A role is a preset, a capability is what a policy tests, and a company has
  a face.** `capabilities` holds twenty codes — `documents.post`,
  `payments.write`, `settings.write`, `members.manage`, `year_end.close` and
  the rest — `role_capabilities` says what `owner`, `accountant` and `viewer`
  each hold, and `company_members.capabilities_granted` /
  `capabilities_revoked` adjust one member in both directions, a revoke
  winning over a grant and over the preset. **Every policy in the schema now
  calls `has_capability()`**, and `can_write_company()` is rewritten on top of
  it rather than left beside it; the three roles do exactly what they did
  before. Posting a document, posting an entry and closing a year are guarded
  by triggers on the transition, because what changes there is a state and not
  a row. A module adds its codes to the same table, with `area` set to its own
  code.
  **A guard written two days earlier had never fired**: the counters behind
  `next_entry_number()` and `next_matching_number()` checked
  `not can_write_company(...)`, which was NULL for a stranger and therefore
  never raised — so any signed-in user could burn numbers in any journal of
  the installation. It raises now.

- **Invitations.** `invite_member()` returns a token once and stores only its
  sha256; `accept_invitation()` requires `auth.email()` to match the address
  invited, is single use and expires; `revoke_invitation()` withdraws one.
  `company_members.user_id` still has no foreign key to `auth.users`, which is
  what lets a membership exist before the person signs up. MCP tools
  `invite_member`, `list_invitations` and `revoke_invitation`; accepting is
  the invitee's own act and has no tool.

- **User preferences, and one way to choose a label.** `user_preferences` —
  preferred company, language, timezone, `date_display_format`,
  `number_display_format` (named so that neither is confused with
  `country_defaults.number_format`, which is a numbering pattern), theme —
  nullable everywhere and with no default anywhere, because null means "take
  the company's answer, then the pack's". `label_for(name, name_i18n,
  languages)` replaces the resolution that was written out wherever it was
  needed, `preferred_languages(company)` builds the chain, and
  `install_country_template()` is republished on it. MCP tools
  `get_preferences` and `set_preferences`.

- **A company profile an invoice can be printed from.** Trade name, logo URL
  or storage path, stated capital with its own currency, activity code and the
  register it belongs to, default bank account, document template. A capital
  with no currency takes the company's own; a sales document with no payee
  IBAN takes the default bank account, and a purchase document never does.
  **`document_header`** is the third view beside `document_line_items` and
  `document_legal_mentions`, and `get_document` reads it instead of assembling
  the same thing itself. MCP tools `update_company_profile` and
  `create_company`. No `registry_reference`: `registration_number` already is
  the number the commercial register holds.

- **Numbering reads the country pack.** `next_entry_number()` builds the
  number from `country_defaults.number_format` — `{CODE}`, `{YYYY}`, `{YY}`,
  `{MM}` and a `{N…}` counter padded to its own width — through
  `format_number()`, which refuses a token it does not know. **No fallback
  literal**: a pack that declares nothing gets `no_number_format` naming
  `documents.number_format`. The counter follows the pattern: a year in it
  restarts with the year, and a pattern with none keeps one series. `post_entry()`
  reads `numbering_gapless` and refuses a number chosen by hand where the law
  forbids a hole — unless the caller holds **`entries.import`**, a capability
  in no preset, for taking over books that already have numbers; a duplicate
  is refused either way, and `catch_up_journal_sequence()` advances the
  counter to an imported number so the next automatic one continues the
  series. Belgium and France declare the pattern the engine used to
  hard-code, so no number changes.

- **Keys for machines.** `api_keys` — one company, an explicit list of
  capabilities, an expiry, a sha256 at rest — with `create_api_key()` (which
  refuses a capability the issuer does not hold), `use_api_key()` presenting a
  key for one transaction, `touch_api_key()`, `current_api_key()` and
  `revoke_api_key()`. `has_capability()` answers for a key where there is no
  member answer. A key is not a session, and the README says what that costs.
  MCP tools `create_api_key`, `list_api_keys` and `revoke_api_key`.

- **The first financial year is a parameter.** `fiscal_year_bounds()` opens it
  on the month `country_defaults.fiscal_year_default` declares and closes it a
  day before the same day a year later; a pack that says nothing gets
  `no_fiscal_year_default` rather than January. `ekwo init` gains
  `--fiscal-year-start`, and `create_company()` does the same work for a
  client. `ekwo init --iban` now also points the company at the account it
  creates, so the first invoice carries an IBAN.

- **The format libraries live here now, under `packages/formats/`, one MIT
  package per format and never one per country.** `@ekwo-ai/xbrl-cbso` and
  `@ekwo-ai/factur-x` came in by subtree with their history; the French FEC
  left `@ekwo-ai/core` for **`@ekwo-ai/fec`**, which `@ekwo-ai/core` and
  `@ekwo-ai/core/fec` re-export, deprecated, for one version. A brick imports
  nothing from the core and declares the row shapes it reads in its own types;
  `tests/formats.test.ts` fails if one loses its MIT `LICENSE`, imports the
  core or another brick, or takes a runtime dependency its format does not
  need. The CLI's published dependency list is unchanged — `pdf-lib` belongs to
  Factur-X alone.
  **The core stops asserting its fact keys and starts verifying them**: the
  fifty-three `xbrl` keys of the Belgian schemes are resolved against the NBB
  taxonomy the brick carries, and each one has to land on the very line code
  that wrote it. A statement that carries keys now names the taxonomy they were
  written against — `"taxonomy": "nbb-cbso:26.0"`, checked by `ekwo pack check`
  — and the Belgian pack moves to 1.3.1. No migration: the taxonomy never
  enters Postgres.
  **And the test the split into two repositories made impossible now exists**:
  the demo books are closed, presented on the three NBB schemes by
  `financial_statement()`, filed through `generateCbsoXbrl({ lines })`, checked
  against the arithmetic of the Filing application, and compared byte for byte
  with a committed golden instance.

- **VAT falls due when the cash moves, and the exchange difference when it
  settles.** A tax marked `cash_basis` is booked by `post_document` on the
  transition account its pack names and on **no declaration box**, and so is
  the base it is computed on: a cash-basis return reports the base collected,
  and a base declared a month before its tax is a return that does not tie
  out. `settle_cash_basis_tax()`, called by `reconcile()` and by
  `unreconcile()`, moves the settled share — pro rata, cumulative, the last
  payment carrying the remainder — to the account and the box it is declared
  on, dated on the day the settlement completes, on the miscellaneous journal.
  A cash-basis tax that names no transition account, that splits its tax over
  two postings or that also carries a non-deductible share is refused at
  posting and by `ekwo pack check`. `vat_return()` needed no change.
  **The French pack gains the six services taxes that fall due on collection**
  (CGI art. 269-2-c, and art. 271-I-2 on the purchase side) and the two
  accounts they wait on, `445870` and `445860`; the goods taxes are unchanged
  and are also the option for the debits. Belgium is unchanged: its regime has
  no general cash-basis option in the socle.
  **The ledger converts**, which it did not: a document in a foreign currency
  booked its foreign figures as if they were the company's, and
  `entry_lines.amount_currency` was written by nothing. `post_document` and
  `post_payment` now book the company's currency at the rate the document or
  the payment carries — `payments.exchange_rate` is new — and a matching
  between two lines in the same foreign currency is worked out in that
  currency, the difference realised on `country_defaults.fx_gain_code` /
  `fx_loss_code` so the third-party account goes to nil. Both packs name those
  accounts and move to 1.2.0. `reconciliations` gains `fx_entry_id` and
  `tax_transfer_entry_id`, which the MCP server returns. Revaluation of open
  items and cash accounting as a ledger stay out of scope. Migration
  `20260912112132`.
- **What a country requires on a document is data.** Twelve columns on
  `country_defaults` — `numbering_gapless`, `number_format`,
  `legal_payment_days`, `late_payment_reference`, `tax_point_rule`,
  `einvoice_profile`, `einvoice_mandatory_from`, `party_scheme`, `vat_scheme`,
  `bank_statement_formats`, `payment_formats`, `fiscal_year_default` — and
  `legal_mention_templates`, the sentences a country puts on an invoice with a
  closed vocabulary of nine conditions and a validity of their own. The
  `document_legal_mentions` view decides which of them apply to one document,
  from its country, its date and the treatments of the taxes on its lines;
  `document_line_items` gained `tax_treatment`, `tax_exemption_code` (BT-121)
  and `tax_cash_basis`. `pack.json` compiles its `documents`, `einvoicing` and
  `bank` sections at last, and `ekwo pack check` enforces their vocabularies —
  the nine conditions, the three tax points, the bank formats by name, four
  digits for an ISO 6523 scheme, a number pattern with exactly one counter,
  and a legal reference on every mention. `get_document` returns the
  applicable mentions and the country's payment and e-invoicing rules;
  `ekwo status` prints the e-invoicing profile of each pack. Belgium and
  France move to 1.2.0. **No function was added**: two views read the data and
  the numbering engine is untouched. Migration `20260912111751`.
- **A country has charts of accounts, not one chart.** `chart_templates` lists
  what a country offers, `account_templates.chart_code` says which one an
  account belongs to — the natural key is now `(country, chart_code, code)` —
  and `company_packs.chart_code` records which one a company copied. The
  journals, the taxes and the declaration form stay common to the charts of a
  country: an association files the same VAT return as a company. `pack.json`
  declares `charts`, exactly one of them the default, and `ekwo pack check`
  refuses a pack whose role codes and tax posting accounts are not in every
  chart it ships. `ekwo init --chart <code>` picks one, an interactive install
  asks only when there are several, and `ekwo status` prints the chart each
  company keeps its books on. Belgium ships a second chart, the PCMN as the
  associations title of the Code des sociétés et des associations applies it,
  marked `community` on the chart entry. Migration `20260912095825`.
- **Financial statements are data.** `statement_templates`,
  `statement_line_templates` and `statement_line_rules`, filled by the packs;
  `financial_statement(company, code, from, to)` returns the whole frame, nil
  lines included, in the order the scheme prints it. A line is summed from the
  ledger through rules — by code range, code prefix, account type or one code
  — or computed from other lines through plus and minus lists, with no
  expression language, as for a declaration form. Belgium gets the NBB
  abbreviated balance sheet, income statement and allocation section; France
  the 2050-2051 balance sheet and the 2052-2053 income statement of the 2026
  liasse; `packs/generic/` a country-less framework by account type that fits
  any chart, including one with no legal codes. `unmapped_accounts()` names
  what a scheme would silently leave out, and `ekwo pack check` refuses a
  chart with an account that reaches no line of any of its statements — which
  is what makes a balance sheet balance. Two MCP tools, `list_statements` and
  `financial_statement`, and `get_company` now says which pack and which chart
  a company sits on. An income statement leaves out the entries
  `close_fiscal_year()` marks `kind = 'closing'`, so a closed year still
  reports what it earned; a balance sheet keeps them, because that entry is
  what carries the result onto the line it shows. Migrations `20260912100412`
  and `20260912104719`.
- **One evaluator for both reports.** `evaluate_totals(values, formulas,
  keep_zero)` is the single place a plus/minus formula is worked out;
  `vat_return()` was rewritten onto it rather than have the calculation exist
  twice. It also gains what the statements needed: totals evaluated in the
  order they depend on each other rather than in the order the form declares
  them, and a cycle that raises `formula_cycle` instead of quietly reading
  zero. No pack changes answer.
- **An appropriation entry is not a closing entry.** `entries.kind` gains
  `appropriation`, which `close_fiscal_year()` puts on the entry that moves
  the result into the appropriation accounts; the entry that empties the
  income statement keeps `closing`. Under one name the two cancelled out and
  the Belgian "Affectations et prélèvements" section read nil the moment a
  year was closed. An allocation section now leaves out the closing entry and
  keeps the appropriation, an income statement leaves out both, and a balance
  sheet keeps both. `reopen_fiscal_year()` undoes both. Migrations
  `20260912105720` and `20260912105721`.

- **One tax engine, several kinds of tax.** `tax_kind`
  (`vat`/`gst`/`sales_tax`/`withholding`/`other`), `recoverable`,
  `jurisdiction`, `price_include` and `cash_basis` on `taxes` and
  `tax_templates`; `rounding_method` and `cash_rounding_unit` on
  `country_defaults`. All of them were already words in the pack format,
  marked deferred, and the compiler dropped them; they now reach the database.
  Every default is today's behaviour, so no existing tax changes by a cent.
- **`tax_on_base`, a posting that books non-deductible VAT on the account of
  the line.** A Belgian company car at 21 % with the deduction capped at 50 %
  books 1 000 on the vehicle, 105 on the deductible VAT account, 105 more on
  the vehicle and 1 210 to the supplier; Belgian grid 83 reports 1 105,
  because the form asks for the base plus the non-deductible VAT. The posting
  carries no account, exactly like `base`, and is split across the accounts of
  the lines it taxes in proportion to their bases.
- **Belgium and France gain the taxes that needed it**, both packs moving to
  `1.1.0`: `BE-P-21-50-I` and `BE-P-21-50-S` (vehicles and their running
  costs, art. 45 § 2 CTVA), `BE-P-21-ND` (frais de réception, art. 45 § 3),
  and `FR-P-20-CARB` (fuel at 20 % with the 80 % deduction of CGI art. 298,
  4, 1°).

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

- **Declaration boxes are data, and `vat_return()` holds no country.**
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
  in the same migration; `financial_statement()` reads them in a later release.

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

### Changed

- `docs/schema.md` gains a section per module schema, generated the same way
  the socle's is. `docs/modules.md` is how to write one; `docs/decisions.md`
  carries the reasoning. `supabase/config.toml` says in a comment which line
  exposes a module schema, and leaves it out by default. `ekwo migrate` applies
  the modules this release carries unless `--no-modules` is passed.

- **The postings of one side of a tax share out the amount of the group**, the
  last taking the remainder, instead of each rounding on its own. No tax had
  more than one posting per side before, so nothing that exists moves; two
  halves of 0,63 now come out as 0,32 and 0,31 rather than 0,32 twice, which
  would have been refused as `document_total_mismatch`.
- **`document_tax_summary.tax_charged` counts `tax_on_base` postings**, so the
  supplier of a partially deductible purchase is owed the whole invoice.
- **The two constraints on a posting's account become one**,
  `tax_postings_account_by_type` (and its twin on the templates): a `tax`
  posting needs an account, every other type must have none. A value added to
  the enum later has to come back to it rather than slip through.
- **`list_taxes` and the `ekwo://companies/{id}/taxes` resource expose the new
  columns**, and the postings carry their `report_code`.

- **The repository is `Ekwo-ai/ekwo-os`**, and every link, `homepage`,
  `repository` field and clone line in the documentation and in the six
  package manifests points there.

- **Eighty-five foreign keys had no index on the side that needs one.**
  Postgres indexes the referenced side of a foreign key, because that side is
  a primary key, and nothing on the referencing side — so every delete of a
  parent scans its children, and most joins an accounting core writes are on
  exactly those columns. Migration `20260913104232` creates 71 of them across
  the socle and the two module migrations `20260913104233` and
  `20260913104234` cover `assets` and `budgets`. Where a table has a
  single-column key and a composite one leading with the same column, the
  composite serves both and is the one created. On the demo company nothing
  was slow, which is why it survived forty-nine migrations; on four years of
  books it is the difference between a report and a timeout.

- **The additive-migrations rule runs on every push, not only on a pull
  request.** The job was gated on `pull_request` and everything went straight
  to `main`, so it never looked. It now compares a push to `main` against the
  previous commit and against the latest tag — the released set — and a pull
  request against its base branch. The README of a migrations directory is
  documentation, so it is out of the glob.

- **`docs/schema.md` is checked to be the output of the generator.** It is
  built from the migrations, the generator is deterministic, and the build
  fails when the committed file is not what `npm run docs:schema` produces. A
  hand-written line in a generated file is a lie that outlives the person who
  wrote it.

### Removed

- **`@ekwo-ai/core/fec` and the FEC re-exports of `@ekwo-ai/core` are gone.**
  The release that moved the format to `@ekwo-ai/fec` kept them alive for one
  version, and this is the next one: import `generateFec`, `checkFec`,
  `fecFileName`, `fromQueryRow`, `formatFecDate`, `formatFecAmount` and
  `FEC_COLUMNS` from `@ekwo-ai/fec`. The core still depends on it, because
  `EkwoClient.generateFec()` writes the file it has just fetched.

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

- **`aged_balance` reported any group it did not know as receivable.** The
  function tested `p_group = 'payable'` twice and fell through to the
  receivable ageing on everything else, so `'supplier'`, `'creditors'`,
  `'Payable'` or a typo returned a full, plausible, wrong report — the one
  failure mode a report must not have, because nothing about it looks like an
  error. Migration `20260913104014` names the two groups and refuses anything
  else.

- **A cash-basis tax whose posting named no declaration box never settled.**
  `post_document()` writes `box_amount` only for a posting that names a box,
  and `settle_cash_basis_tax()` looks for lines that have one, so the amount
  landed on the transition account and stayed there — silently, for as long as
  nobody reconciled that account. Migration `20260913103355` refuses the
  combination where it is created, in the pack compiler and in the schema,
  rather than at the moment it would have gone wrong.

- **Seven columns defaulted to `'EUR'` and one to `'fr'`.** A company,
  document, payment, product, bank account or statement created without a
  currency got euros instead of an error — the country literals in another
  hat. Migration `20260913102758` drops the defaults; the value now comes from
  the pack of the fiscal country or from the row above, and a pack that says
  nothing is refused by name instead of assuming Europe.

- **A negative half was rounded three different ways by three packages.**
  `@ekwo-ai/factur-x`, `@ekwo-ai/xbrl-cbso` and `@ekwo-ai/mcp` each reached
  for `Math.round` or `toFixed`, which disagree on `-0.005`. Each carries the
  same half-up-on-the-absolute-value rounding now, which is what the schema
  does, so a credit note is its invoice with the sign flipped in the export as
  well as in the ledger.

- **A connection that could not declare itself the installer carried on.**
  `connect()` swallowed the failure of `set_config('ekwo.installing', …)`, and
  the run then failed five guards later with a message about a capability the
  operator cannot have. It closes the connection and raises where it happened.

### Security

- **A machine key could do anything, because it has no session.** Eleven
  functions and triggers were written as `if auth.uid() is not null and not
  has_capability(…) then raise`, which checks a signed-in caller and exempts a
  caller with no session. That was the installer, until `20260913085932` added
  API keys — a key is deliberately not a session, `auth.uid()` stays null, and
  every one of those guards stood aside. A key issued with `["entries.read"]`
  could post an entry, close a financial year, invite a member, create a
  company and issue itself a second key carrying every capability of the
  installation. Migration `20260913102115` names the exemption instead of
  inferring it: `is_installer()` is true only when the migration runner set
  `ekwo.installing` on its own connection, and false outright when there is a
  session or a key presenting itself. A caller reaching the database through
  PostgREST cannot set it.
- **`is_company_owner()` and `can_write_company()` answered NULL to a
  stranger, and `not NULL` never raises.** Inside a policy that is harmless;
  inside a `security definer` function it is the opposite, and the stranger
  walked past the exception into the body. `enable_module()` and
  `disable_module()` did exactly that, on a table with no write policy at all,
  so the function was the only door and the door was open. Migration
  `20260913101536` makes both helpers answer false rather than null.
- **`EKWO_ACCESS_TOKEN` was the second door for a `service_role` key.** The
  MCP server refused one in `SUPABASE_ANON_KEY` and not in the access token,
  which goes into the `Authorization` header — where PostgREST reads the role
  — so a key pasted there bypassed every policy while the anon key beside it
  made the configuration look right. It is refused in both slots now, by name.
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

[Unreleased]: https://github.com/Ekwo-ai/ekwo-os/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/Ekwo-ai/ekwo-os/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/Ekwo-ai/ekwo-os/releases/tag/v0.2.0
