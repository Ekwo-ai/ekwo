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
`tax_posting_templates`, `tax_report_templates`, `tax_report_box_templates`,
`country_defaults` and `country_packs`, and **nothing that belongs to a
company**. Every insert upserts on the natural key
`(country, code)`, which matters more than it sounds: the seeds used to say
`on conflict do nothing`, so an instance installed last month received no
correction at all — not even for a company created afterwards, since a company
copies the templates when it is installed.

What an upsert cannot do is remove. A template deleted from a pack stays in
the database, which is the rule anyway: **nothing is ever deleted from a
pack**. An account is deprecated, a tax gets a `valid_to`, a form version gets
a new `valid_from`.

## What a tax says, and where its postings land

A tax in `taxes.json` says how much and what kind; its `postings` say where
the money goes, per kind of document.

| Field | What it decides |
|---|---|
| `kind` | `vat`, `gst`, `sales_tax`, `withholding`, `other`. A label for the reports, never an input to the calculation. Defaults to `vat`. |
| `recoverable` | `false` when the buyer never gets the tax back — American sales tax, Canadian PST, a wholly non-deductible VAT. |
| `price_include` | The unit price already holds the tax (UK and Australian retail). Compiled to a column; the gross-to-net computation waits for the country that needs it. |
| `jurisdiction` | ISO 3166-2 **with** the country prefix (`CA-QC`, `US-CA`) for a tax levied by a state. Null in Europe. |
| `cash_basis`, `cash_basis_transition_account` | The tax falls due when the invoice is paid. Compiled to columns; read by P0-6. |

A posting has one of three types:

- **`base`** — the taxed amount itself. It carries no account: the account is
  the one the document line names.
- **`tax`** — an amount on a tax account, which it must name.
- **`tax_on_base`** — a share of the tax that is *not* recoverable. It carries
  no account either, and for the same reason as `base`: non-deductible VAT is
  part of what the thing cost, so it lands on the accounts of the lines it
  taxes, split in proportion to their bases.

`factor` is the share of the amount that reaches the ledger, `box_factor` the
share reported in the box, and the two are independent because a box is filled
with the sign and the fraction the form expects. The Belgian vehicle tax uses
both:

```json
{
  "code": "BE-P-21-50-I",
  "rate": 21,
  "scope": "purchase",
  "legal_reference": "Code de la TVA, art. 45, par. 2",
  "postings": {
    "invoice": [
      { "type": "base", "box": "83" },
      { "type": "tax", "factor": 50, "account": "411000", "box": "59", "box_factor": 50 },
      { "type": "tax_on_base", "factor": 50, "box": "83", "box_factor": 50 }
    ]
  }
}
```

On a 1 000 € car: 1 000 on the vehicle, 105 on the deductible VAT account, 105
more on the vehicle, 1 210 owed to the supplier. Grid 83 reports 1 105 —
Belgium asks for the base **plus** the non-deductible VAT, which is what the
form's « TVA déductible non comprise » means. A wholly non-deductible tax is
the same shape with one `tax_on_base` posting at 100 % and no `tax` posting.
France needs no `box` on its `tax_on_base` posting at all: the CA3 carries no
grid for the base of a purchase.

The postings of one side share out the tax of the group, which is rounded once
(EN 16931 BR-CO-14); the last posting of each side takes the remainder, so two
halves of 0,63 come out as 0,32 and 0,31 rather than 0,32 twice.

`defaults.rounding_method` and `defaults.cash_rounding_unit` belong to the same
rule: a pack says how its country rounds, and a pack that says nothing gets the
column's own default. The compiler writes `default` rather than a value of its
own, so there is exactly one place where the mechanism is decided and no
country is anybody's fallback.

## Which declaration a box belongs to

A box number is unique inside one form and nowhere else. Belgium and France
each file one periodic return, so `59` has never been ambiguous; a Canadian
company files the federal GST/HST return and the Québec one at the same time,
and line `101` of one is not line `101` of the other. Every posting therefore
carries a `report_code`, which the compiler fills from the `code` of
`tax_report.json` — `BE-VAT-PERIODIC`, `FR-CA3` — and which a posting may
override with `"report": "…"` when a country files more than one.

## The boxes of a declaration, and how a total is computed

`tax_report.json` is one form — `BE-VAT-PERIODIC`, `FR-CA3` — and its boxes.
A `base` or a `tax` box is summed from what the postings wrote on the ledger;
a `total` is computed from the others:

```json
{ "box": "71", "kind": "total", "name": "TVA à payer à l'État", "sequence": 320,
  "plus": ["XX"], "minus": ["YY"], "floor_zero": true }
```

There is **no expression language**: a list to add, a list to subtract, a
floor at zero, evaluated in `sequence` order, so a total may name a total
declared before it. That covers the Belgian 71/72, the French 16, 23, 25 and
28, and the British box 5. `hidden` marks an intermediate total the form does
not print — `vat_return()` returns it with the flag rather than dropping it.

A reference is bare (`54`) where the form carries the box once, and qualified
(`08:tax`) where it carries a base and a tax on the same line, as the CA3
does. `ekwo pack check` refuses:

- a reference to a box the form does not carry;
- a bare reference that would match two kinds — qualify it;
- a total that names itself;
- a total that names a total computed **after** it in the sequence;
- a formula on a box that is summed from the ledger;
- the same box declared twice with the same kind;
- a tax that posts to a box the form does not declare.

The form is reference data and is never copied into a company: a chart of
accounts is customisable, a form is not. A new version of a form is a **new
code** with its own `valid_from`, like a new VAT rate is a new tax code, and
`vat_return()` takes the one in force at the end of the period.

## Which province a party is in

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

Account labels and declaration-box labels are compiled today; a box is keyed
by the same reference its formulas use — `59`, or `08:tax` where a form
carries a base and a tax on one line. Journals and taxes have their
`name_i18n` in the format and no column yet; the compiler says so when it
skips them.

## Certification

A golden test proves that a pack is internally coherent. It does not prove
that it is legally right, and no test can. So:

- every tax names the article it comes from (`legal_reference`), and the
  manifest lists its sources;
- the manifest carries `certification.status`, and `ekwo init` prints it in as
  many words before anyone books anything:

  | Status | What it means |
  |---|---|
  | `community` | contributed, not read by an accountant |
  | `maintained` | maintained by Ekwo, not yet reviewed by an accountant |
  | `reviewed` | read by a named professional — `by`, `on` and the sources they worked from |

- **Belgium and France are `maintained`.** Writing a pack and testing that it
  holds together is not reviewing it: *certified* describes a professional
  reading it against the law, and nothing else. There is deliberately no
  status that means "certified by Ekwo"; the value `ekwo` that used to exist
  is deprecated, refused by the schema, and moved to `maintained` by migration
  `20260912081015`.

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
4. Say how the year is closed. `defaults.closing_style` is one of
   `retained_earnings`, `result_accounts` or `appropriation_accounts`, and
   with it come `current_year_result_profit`, `current_year_result_loss` and
   `retained_earnings_loss` in `defaults.roles`, plus
   `defaults.journal_roles.opening`. The table below says which style a chart
   needs; `close_fiscal_year()` asserts the answer rather than trusting it.
5. `ekwo pack build <cc>`, then add the generated file to
   `supabase/config.toml` under `[db.seed].sql_paths`.
6. Set `certification.status` honestly. `community` is the right answer until
   an accountant has read it.

### Which closing style a chart needs

| Style | The result goes | Chosen when |
|---|---|---|
| `retained_earnings` | straight into retained earnings | the chart has no current-year result account (United Kingdom, United States) |
| `result_accounts` | into a current-year result account on the balance sheet | the chart keeps the result of the year apart until a meeting allocates it (France: 120 and 129) |
| `appropriation_accounts` | through an appropriation account of the income statement, then to retained earnings | the statutory income statement ends on an appropriation section (Belgium: 693 and 793, to 140 and 141) |

The accounts a style names have to be of the right kind, and the close says so
rather than finding out later: `appropriation_accounts` needs accounts that do
*not* carry forward, the other two need accounts that do. What a general
meeting then decides — a dividend, a reserve — is never part of a close, in
any country.

**There is no default.** Leave `closing_style` out and `close_fiscal_year`
refuses with `no_closing_defaults`; leave `journal_roles.opening` out and it
refuses with `no_opening_journal`. Nothing falls back on a Belgian or a French
value, because a default closing style would be one country's mechanism given
to every country that has not spoken. `ekwo pack check` refuses a pack that
declares a style without the accounts and the journal that style needs, so the
gap is found when the pack is written and not on somebody's year end.

## What is not in a pack

The engine: posting, matching, the returns, the installer. Also deliberately
out — the rates of American sales tax (thousands of jurisdictions, monthly
changes; the form belongs here, a maintained rate feed does not), the XML of
the filing formats, analytics, fixed assets, payroll, and the translation of
the application itself. Canadian rates *are* in the pack: fifteen stable
combinations published by the CRA is data, not a feed.
