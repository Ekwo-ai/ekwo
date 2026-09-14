# Country packs

A country is data. Everything Belgium or France adds to Ekwo — a chart of
accounts, journals, VAT codes, the accounts each of them posts to, the boxes
of the periodic return — is a set of files under `packs/<cc>/`, compiled into
one SQL seed that is committed. There is no module per country, no Python
hook, and no field in the format through which a pack could run anything.

The decision behind this, with the alternatives that were weighed, is in
[`decisions.md`](decisions.md).

## What a pack is

```
packs/be/
├── pack.json          manifest: version, certification, defaults, roles, journals, charts
├── accounts.csv       the default chart: code, parent, type, reconcilable, name, sequence
├── accounts.asbl.csv  a second chart, named by charts[] in the manifest
├── taxes.json         taxes and their postings, per kind of document
├── tax_report.json    the boxes of the periodic return and their totals
├── statements.json    the balance sheet, the income statement and their rules
├── assets.json        the section of the fixed assets module, where the country has one
└── i18n/
    ├── README.md      where each language's wording comes from
    ├── nl.json        every label of the pack, in one more language
    ├── de.json
    └── en.json

packs/generic/         a pack with no country: statements by account type
├── pack.json
└── statements.json
```

## A country has charts, not a chart

`pack.json` declares them, exactly one of them the default:

```json
"charts": [
  { "code": "default", "name": "PCMN — plan comptable minimum normalisé",
    "accounts": "accounts.csv", "default": true, "audience": "companies",
    "statements": ["BE-BNB-ABBR-BS", "BE-BNB-ABBR-IS", "BE-BNB-ABBR-AF"] },
  { "code": "asbl", "name": "PCMN — associations et fondations",
    "accounts": "accounts.asbl.csv", "audience": "nonprofits", "statements": [],
    "certification": { "status": "community" } }
]
```

A pack that declares no `charts` has one chart called `default` whose accounts
are in `accounts.csv`, which is what every pack written before this said.

**The journals, the taxes and the declaration form are common to the charts of
a country.** An association buys, sells and banks through the same journals as
a company and files the same VAT return; only the accounts differ, and the
statements that present them. So do the roles — receivable, payable, suspense
— which stay in `defaults.roles`, and `ekwo pack check` refuses a pack whose
role codes and tax posting accounts are not in *every* chart it ships.

`ekwo init --chart <code>` picks one; without the flag, an interactive install
asks only when the pack offers several, and a non-interactive one refuses and
lists them. `ekwo status` prints the chart each company keeps its books on.

## Financial statements

`statements.json` holds one entry per scheme: a `code`, a `kind`
(`balance_sheet`, `income_statement`, `allocation`), a `framework`, and its
lines. A line is either summed from the ledger, through `rules`, or computed
from other lines, through `plus` and `minus` — there is no expression
language, as there is none for a declaration form.

```json
{ "code": "40/41", "parent": "29/58", "name": "Créances à un an au plus",
  "sequence": 150, "xbrl": "met:am1|bas:m9|rst:m2",
  "rules": [ { "kind": "code_range", "code_from": "40", "code_to": "41" },
             { "kind": "code_range", "code_from": "499", "code_to": "499", "side": "debit" } ] }
```

Four kinds of rule: `account_code` names one code, `code_range` and
`code_prefix` compare the head of the code (`40`..`41` takes 400000 and 411000
and stops at 42), `account_type` is what the generic framework is made of.
`side` splits one account between two lines — a suspense account is a
receivable while it is in debit and a payable while it is in credit — and is
the only way two lines may share an account.

`sign` multiplies the debit-minus-credit balance so the line reads the way the
scheme prints it: `1` on an asset or an expense, `-1` on a liability, equity or
income line.

`xbrl` is the **fact key** of the line in the taxonomy the country files in,
and it is optional: null where nothing could be verified. The three Belgian
schemes name all fifty-three of theirs. A taxonomy such as
the Belgian CBSO has no element per reporting code — it is dimensional, so a
line is a metric plus a set of domain members, written metric first and
separated by `|`. One key, one fact, therefore **one line**: `ekwo pack check`
refuses two lines of a statement carrying the same key, which is how a key
missing a member shows up. The two sides of a balance sheet are the case to
watch — `met:am1|bas:m25` is the total of the assets *and* the total of the
liabilities until `part:m1` or `part:m3` says which.

The totals of a scheme and the totals of a declaration form are worked out by
the same function, `evaluate_totals()`, in the order they depend on each other.
A statement prints its whole frame and a return omits a box that comes to
nothing, which is one argument to it and not a second evaluator.

A `balance_sheet` reads balances cumulative to the end of the period; an
`income_statement` reads the movements inside it, **less the entries
`close_fiscal_year()` marks `kind = 'closing'`**, so a closed year still
reports what it earned. A balance sheet keeps those entries: they are what
carries the result onto the line it shows.

**A chart names the statements it reports on.** A statement named by exactly
one chart belongs to that chart; one named by several, or by none, fits every
chart of the country. A chart that names none falls back to `packs/generic/`,
the country-less pack whose rules are all `account_type` — which is what the
eighteen account types buy, and what gives a British or American chart with no
legal codes a balance sheet that ties out.

`ekwo pack check` refuses a statement whose totals form a cycle, a line that is
both summed and computed, two lines that catch one account on the same side,
two lines that carry the same fact key, and — the check that makes a balance
sheet balance — **a chart with an account that reaches no line of any of its
statements**. A heading, an account with
children, may reach none: it straddles the lines its children are split over
and nothing is posted to it.

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

The compiler writes `chart_templates`, `account_templates`,
`journal_templates`, `tax_templates`, `tax_posting_templates`,
`tax_report_templates`, `tax_report_box_templates`, `statement_templates`,
`statement_line_templates`, `statement_line_rules`, `country_defaults` and
`country_packs`, and **nothing that belongs to a company**. Every insert
upserts on the natural key — `(country, chart_code, code)` for an account,
`(country, code)` for the rest — which matters more than it sounds: the seeds used to say
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
| `cash_basis`, `cash_basis_transition_account` | The tax falls due when the invoice is paid, not when it is issued. `post_document` books it — and the base it is computed on — on the transition account and on no declaration box; the matching moves the settled share to the account and the box it is declared on. A cash-basis tax has to name its transition account and takes **one** `tax` posting per document kind, with no `tax_on_base`: `ekwo pack check` refuses the rest. |

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

`rounding_method` is read. It is half of the pair `round_amount()` applies to
every amount the schema writes; the other half is `decimal_places` on the
currency the pack names in `defaults.currency`, which says that the yen has
none and the dinar has three. A pack that declares `half_even` therefore
changes what its country's ledger holds, and the four methods — half up, half
even, down, up — are all applied to the absolute value, so a credit note is
always its invoice with the sign flipped. `cash_rounding_unit` is still
declared and read by nothing: the socle has no cash-payment path to round a
total on.

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

## What a country puts on an invoice

Three sections of the manifest — `documents`, `einvoicing` and `bank` —
compile into twelve columns of `country_defaults` and into
`legal_mention_templates`. None of them has a default: a pack that says
nothing leaves null, and a reader that needs the value says which one is
missing rather than borrowing another country's law.

```json
"documents": {
  "numbering": "gapless_per_year",
  "number_format": "{CODE}/{YYYY}/{NNNN}",
  "legal_payment_days": 30,
  "late_payment_reference": "…où le taux et l'indemnité sont fixés",
  "tax_point": "invoice_date",
  "mentions": [
    {
      "code": "reverse_charge",
      "applies_when": "reverse_charge",
      "text": "Autoliquidation — taxe à acquitter par le cocontractant.",
      "sequence": 10,
      "legal_reference": "Arrêté royal n° 1 du 29 décembre 1992, art. 20"
    }
  ]
},
"einvoicing": {
  "profile": "peppol-bis-3",
  "mandatory_from": "2026-01-01",
  "party_scheme": "0208",
  "vat_scheme": "9925"
},
"bank": {
  "statement_formats": ["coda", "camt.053"],
  "payment_formats": ["pain.001"]
}
```

**The number.** `numbering` is `gapless_per_year`, `gapless`, `sequential` or
`free`, and the first two compile to `numbering_gapless = true`. Whether the
counter restarts each year is readable in `number_format`, which carries the
year or does not. The pattern is four tokens and literal text around them:

| Token | Is |
|---|---|
| `{CODE}` | the journal or series code |
| `{YYYY}`, `{YY}` | the year of the document |
| `{MM}` | the month |
| `{NNNN}` | the counter, zero-padded to as many `N` as are written |

Nothing reads the pattern yet — `next_entry_number()` builds `CODE/YYYY/NNNN`
— so a pack declares what its numbers look like, and the day a numbering
engine consumes a format it produces the same numbers it always did.
`ekwo pack check` refuses a token nobody defined and a pattern with no
counter, or with two.

**The tax point** is the country's general rule: `invoice_date`,
`delivery_date` or `payment_date`. A tax that departs from it says so itself,
with `cash_basis` — which is how France taxes goods on delivery and services
on collection without the country model contradicting itself.

**The schemes** are ISO 6523 identifier codes, four digits, and there are two
because they are not the same identifier: `party_scheme` is how a party is
addressed on the network (`0208` the Belgian enterprise number, `0009` the
French SIRET) and `vat_scheme` is the VAT identifier (`9925`, `9957`). Where a
country has two registration identifiers, declare the one its invoices carry
and name the other in the legal reference.

**The bank formats** are a known list rather than free text — `camt.052`,
`camt.053`, `camt.054`, `mt940`, `mt942`, `coda`, `cfonb120`, `ofx`, `qif`,
`bai2`, `csv` for statements; `pain.001`, `pain.008`, `cfonb160`, `mt101`,
`ach`, `bacs`, `eft`, `csv` for payments — because a parser is written against
a format and not against a name somebody typed. The list grows with the
country that needs it.

### The mentions, and when each applies

`applies_when` is a closed vocabulary and never an expression: an accountant
reads the value and knows what it means, and a pack that could write a
condition would be a pack that executes.

| `applies_when` | Applies when |
|---|---|
| `always` | every document of the country |
| `reverse_charge` | a line carries a tax treated as a domestic reverse charge |
| `intra_eu_goods` | a line carries an intra-Union supply or acquisition of goods |
| `intra_eu_services` | the same, for services |
| `export` | a line carries a supply outside the Union |
| `exempt` | a line carries an exemption that is none of the above |
| `late_payment` | the document is one the seller issues |
| `cash_basis` | a line carries a tax that falls due on collection |
| `small_business` | never selected — see below |

`document_legal_mentions(document_id)` is the view that decides. It joins on
the company's **fiscal country**, on the **document's own date** — so a reprint
of an old invoice carries the wording of its own year — and on the treatments
of the taxes the lines already carry, which is why nothing extra has to be
recorded on a document for its mentions to come out right.

`small_business` is the exception and it is deliberate: a franchise regime is a
property of the seller and the core records no such column, so the sentence is
in the table for a renderer that knows the regime and the view never selects
it. The day the regime becomes a column, the view gains one branch.

A mention cites the article that requires it. `ekwo pack check` refuses one
that does not, a duplicate code, and a validity that runs backwards. Retiring
a wording is a `valid_to` and a new row, never an edit — the rule that governs
a tax rate and a box of a form governs a sentence too.

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

### Where a company stands, and moving it

Two commands read an installation rather than a checkout, so they need a
connection and know nothing about `packs/`.

```sh
ekwo pack status --db-url "$EKWO_DB_URL"
```

```
Packs loaded here (2)
  BE Belgique  1.5.0
  FR France    1.4.0

Companies (2)
  · Example One  BE/default  copied 1.0.0, loaded 1.5.0
        4 addition(s), 1 closure(s) — applied by rule; 2 to review
  · Example Two  FR/default  copied 1.4.0, loaded 1.4.0 — up to date
```

It changes nothing and exits 1 while a company is behind, so a cron can ask.

```sh
ekwo pack upgrade "Example One" --db-url "$EKWO_DB_URL"
```

```
Example One — BE pack 1.0.0 → 1.5.0
  · tax BE-P-21-50-I — added from the pack
  · tax BE-S-06 — added from the pack
  · tax BE-S-21 — validity closed on 2026-12-31
  4 change(s) applied: an addition and a closed validity take nothing away.

To review (2)
  Not applied. Read them, then run again with --apply if the pack is right.
  ! account 700000 — differs: {"pack":{…},"company":{…}}
  ! tax_posting BE-S-21 — differs: {"pack":[…],"company":[…]}

Yours, not the pack's (1)
  Never applied by an upgrade: nothing is removed from a company's books.
  account 999500 — held here, not in the pack

Version
  still 1.0.0: 2 difference(s) are waiting to be decided.
```

The difference is computed by natural key — an account code, a journal code, a
tax code — and every difference falls into one of three rules:

| Rule | What an upgrade does |
|---|---|
| `addition` | The pack has something the company does not. Copied in. |
| `closure` | The pack has closed the validity of a tax the company still holds open. Applied — this is how a rate change reaches a company: the old one stops, the new one is an addition. |
| `review` | Everything else: a label that differs, a rate that differs on the same code, a posting that books somewhere else. **Listed and never applied without `--apply`.** |

A row the company holds and the pack does not is listed under its own heading
and is never applied, whatever is asked: nothing is removed from a company's
books by an upgrade. An account may carry entries and a tax may be on a posted
document, and a pack that retires a code retires it with a `valid_to`.

**The recorded version moves only when nothing is left waiting.** A company
that still holds a difference it has not decided on has not finished
upgrading, and moving the number would hide that difference at the next run.

The same three rules are in the schema — `pack_upgrade_diff(company)` and
`pack_upgrade(company, country, apply)` — so an application, a module or an
assistant asking the same question gets the same answer, and every upgrade
writes a `pack_upgraded` row into [`audit_log`](schema.md) naming what it
applied and what it left. Installing again in the meantime adds what is
missing and changes nothing that exists.

**Immutable once published**: the country of a pack; the code of an account
and its type — reclassifying a code would reclassify history; the code of a
tax and what it means; the identifier of a box inside a version of a form. A
new VAT rate is a new tax code plus a `valid_to` on the old one, never an
edit, which is how the return of a past period keeps giving the same answer.

## Languages

The pack's own files are written in `defaults.language`. Every other language
is one file, `i18n/<lang>.json`, and that file is the only place a translation
lives — the manifest carries no second wording and neither does `assets.json`.
One file per language means a contributor edits one file and a reviewer reads
one file.

```json
{
  "language": "nl",
  "pack_name": "België",
  "charts":           { "default": "MAR — minimum algemeen rekeningenstelsel" },
  "accounts":         { "400000": "Handelsdebiteuren" },
  "journals":         { "SAL": "Verkoopdagboek" },
  "taxes":            { "BE-S-21": "Verkoop 21 %" },
  "tax_report_boxes": { "54": "Btw op de handelingen van de roosters 01, 02 en 03" },
  "statement_lines":  { "BE-BNB-ABBR-BS:10/15": "EIGEN VERMOGEN" },
  "legal_mentions":   { "reverse_charge": "Btw verlegd — …" },
  "asset_categories": { "machinery": "Installaties, machines en uitrusting" }
}
```

A box is keyed by the same reference its formulas use — `59`, or `08:tax`
where a form carries a base and a tax on one line. A statement line is keyed
`<statement>:<line>`, because two statements may both carry a line `20`.

**The manifest declares which languages the pack publishes**, and that
declaration is a promise rather than a description:

```json
"languages": ["nl", "de", "en"]
```

`ekwo pack check` fails, naming every missing key, if a declared language stops
covering the accounts of every chart, the journals, the taxes, the boxes, the
statement lines, the legal mentions or the asset categories. A file that is
**not** declared may be partial — a key it does not carry falls back to the
pack's own label — which is how a language is contributed one section at a
time. A label under a code the pack does not carry is refused either way.

The labels land in `name_i18n` / `text_i18n` on every template table, and
`install_country_template(company, country, language)` copies the chosen one
into `name` while keeping the whole object beside it, so a company installed in
Dutch can be read in English later without importing anything again.
[`languages.md`](languages.md) is the whole mechanism, including how a reader's
own preference comes before the company's.

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
   are what the installer wires. Add `fx_gain` and `fx_loss` if any company of
   your country ever invoices in another currency: a matching that realises a
   difference is refused by name when they are missing, and only then. Every
   code must exist in your chart; the compiler refuses the pack before writing
   any SQL if one does not.
4. Say how the year is closed. `defaults.closing_style` is one of
   `retained_earnings`, `result_accounts` or `appropriation_accounts`, and
   with it come `current_year_result_profit`, `current_year_result_loss` and
   `retained_earnings_loss` in `defaults.roles`, plus
   `defaults.journal_roles.opening`. The table below says which style a chart
   needs; `close_fiscal_year()` asserts the answer rather than trusting it.
5. Say what the country puts on an invoice: `documents`, `einvoicing` and
   `bank`, described above. All three are optional and none of them has a
   default — a pack that stays silent leaves the columns null rather than
   inheriting somebody else's law — and every mention cites the article that
   requires it.
6. `ekwo pack build <cc>`, then add the generated file to
   `supabase/config.toml` under `[db.seed].sql_paths`.
7. Set `certification.status` honestly. `community` is the right answer until
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
