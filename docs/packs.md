# Country packs

A country is data. Everything Belgium or France adds to Ekwo — a chart of
accounts, journals, VAT codes, the accounts each of them posts to, the boxes
of the periodic return — is a set of files under `packs/<cc>/`, compiled into
one SQL seed that is committed. There is no module per country, no Python
hook, and no field in the format through which a pack could run anything.

The decision behind this, with the alternatives that were weighed, is in
[`decisions.md`](decisions.md) and in
[`decisions/2026-09-12-country-pack-format.fr.md`](decisions/2026-09-12-country-pack-format.fr.md).

## What a pack is

```
packs/be/
├── pack.json          manifest: version, certification, defaults, roles, journals
├── accounts.csv       the chart: code, parent, type, reconcilable, name, sequence
├── taxes.json         taxes and their postings, per kind of document
├── tax_report.json    the boxes of the periodic return and their totals
├── statements.json    balance sheet and income statement (empty for now)
└── i18n/
    ├── nl.json        labels by code, in another language
    ├── de.json
    └── en.json
```

Every file is validated against [`packs/schema/pack.1.json`](../packs/schema/pack.1.json),
a JSON Schema draft 2020-12 that describes all of them: the manifest is the
root, the others are `$defs`. Two formats and no third: JSON for anything with
a shape, CSV for the chart, which is flat, long, and what Odoo, Xero and
QuickBooks all exchange — a reviewer reads one line per account in a diff, and
an accountant opens it in a spreadsheet.

`accounts.csv` is a **strict subset** of CSV: a header line, no newline inside
a field, a field quoted only when it holds a comma or a quote, a quote doubled
inside a quoted field. The parser is forty lines and refuses anything else.

## Compiling

```sh
ekwo pack list           # the packs this checkout carries, and their certification
ekwo pack build be       # writes supabase/seed/10_pack_be.sql
ekwo pack build --all
ekwo pack check --all    # exit 1 if a committed seed is not the output of its pack
```

The SQL is a **build artefact**, like `docs/schema.md`. The source is the
pack; the output is committed so that `supabase db push` and `psql -f` install
a country without the CLI ever running; the CI's *hygiene* job runs
`ekwo pack check --all` so the two cannot drift. Never edit a generated seed:
the next `pack build` overwrites it and the CI refuses it in the meantime.

The compiler writes `account_templates`, `journal_templates`, `tax_templates`,
`tax_posting_templates`, `country_defaults` and `country_packs`, and **nothing
that belongs to a company**. Every insert upserts on the natural key
`(country, code)`, which matters more than it sounds: the seeds used to say
`on conflict do nothing`, so an instance installed last month received no
correction at all — not even for a company created afterwards, since a company
copies the templates when it is installed.

What an upsert cannot do is remove. A template deleted from a pack stays in
the database, which is the rule anyway: **nothing is ever deleted from a
pack**. An account is deprecated, a tax gets a `valid_to`, a form version gets
a new `valid_from`.

## Which declaration a box belongs to

A box number is unique inside one form and nowhere else. Belgium and France
each file one periodic return, so `59` has never been ambiguous; a Canadian
company files the federal GST/HST return and the Québec one at the same time,
and line `101` of one is not line `101` of the other. Every posting therefore
carries a `report_code`, which the compiler fills from the `code` of
`tax_report.json` — `BE-VAT-PERIODIC`, `FR-CA3` — and which a posting may
override with `"report": "…"` when a country files more than one.

`defaults.region` is the other half of the same story: Canadian tax follows
the buyer's province, so `companies.region` and `contacts.region` exist (ISO
3166-2 without the country prefix — `QC`, `BC`). Nothing reads them before the
Canadian pack; the declarative rules that turn a region into a *suggested*
tax, and the group tax that puts GST and QST on one line, are phase 1. The
core never chooses a tax for anyone, in any country.

## Versions, and what a company holds

`pack.json.version` is semver:

| Change | Version |
|---|---|
| A label, a translation, a legal source | patch |
| An account, a tax, a box, a statement line; a validity that closes | minor |
| A new declaration form, a new statement framework | major |

The generated seed writes one row in **`country_packs`**: the version this
installation holds, the certification status, and a sha256 of every file of
the pack. `install_country_template` writes **`company_packs`**: which version
that company copied, and when. `ekwo status` prints both and says so when a
company is behind.

Moving a company from one version to the next is `ekwo pack upgrade` (P0-9),
which shows the difference and applies only what is safe: an addition is
added, a validity that closes is closed, and anything else is listed and never
applied without being asked for. Installing again in the meantime adds what is
missing and changes nothing that exists.

**Immutable once published**: the country of a pack; the code of an account
and its type — reclassifying a code would reclassify history; the code of a
tax and what it means; the identifier of a box inside a version of a form. A
new VAT rate is a new tax code plus a `valid_to` on the old one, never an
edit, which is how the return of a past period keeps giving the same answer.

## Languages

`i18n/<lang>.json` holds labels by code. They land in
`account_templates.name_i18n`, and `install_country_template(company, country,
language)` copies `coalesce(name_i18n->>language, name)` into `accounts.name`
while keeping the whole object beside it — so a company can be installed in
Dutch and read in English later without importing anything again. A code the
pack does not translate keeps the pack's own label.

Only account labels are compiled today. Journals, taxes and declaration boxes
have their `name_i18n` in the format and no column yet; the compiler says so
when it skips them.

## Certification

A golden test proves that a pack is internally coherent. It does not prove
that it is legally right, and no test can. So:

- every tax names the article it comes from (`legal_reference`), and the
  manifest lists its sources;
- the manifest carries `certification.status` — `community` (contributed, not
  read by an accountant), `reviewed` (read by a named professional), `ekwo`
  (maintained by Ekwo) — and `ekwo init` prints it, in as many words, before
  anyone books anything;
- Belgium and France are `ekwo`. Anything else says what it is.

## Adding a country

1. Copy `packs/be/` to `packs/<cc>/` and replace its contents. Keep the
   structure: a manifest, a chart, taxes.
2. Give every account one of the eighteen `account_type` values. Nothing is
   guessed from a code prefix anywhere in Ekwo — `411` is *customers* on the
   French chart and *recoverable VAT* on the Belgian one.
3. Name the roles in `defaults.roles`: receivable and payable are required,
   and suspense, rounding, retained earnings, sales, purchase, bank and cash
   are what the installer wires. Every code must exist in your chart; the
   compiler refuses the pack before writing any SQL if one does not.
4. `ekwo pack build <cc>`, then add the generated file to
   `supabase/config.toml` under `[db.seed].sql_paths`.
5. Set `certification.status` honestly. `community` is the right answer until
   an accountant has read it.

## What is not in a pack

The engine: posting, matching, the returns, the installer. Also deliberately
out — the rates of American sales tax (thousands of jurisdictions, monthly
changes; the form belongs here, a maintained rate feed does not), the XML of
the filing formats, analytics, fixed assets, payroll, and the translation of
the application itself. Canadian rates *are* in the pack: fifteen stable
combinations published by the CRA is data, not a feed.
