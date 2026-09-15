# Ekwo OS beyond Belgium and France

> The plan for making the core usable in any country. The format of a country
> pack — the one taxonomy in this plan that will not get to be redone — was
> settled first, before any code was written, and is recorded in
> [`decisions.md`](decisions.md). This document is the map; that decision is
> the first step on it.

## The premise

A country is data, not code. Odoo ships one Python module per localisation;
Xero and QuickBooks ship one product per market. Ekwo ships **one core and
one versioned pack per country**, and a pack is something an accountant can
read, a contributor can propose in a pull request, and a test can prove.
Everything below follows from that.

Where the core stands today, phase 0 being done: 18 account types shared with
Xero, QuickBooks and Odoo; taxes, their postings and the boxes of a declaration
as rows a pack fills; financial statements as rows too, with a country-less
framework behind any chart that prescribes none; EN 16931 fields as columns;
the French FEC; XBRL for the Belgian NBB; Factur-X; a REST API and an MCP
server; row level security everywhere. The seven file formats — the French FEC,
the Belgian CBSO taxonomy, Factur-X, and the four recapitulative statements
added with `ec_sales_list()` — are MIT packages under
[`packages/formats/`](../packages/formats/), organised by format and never by
country.

**No function of the core holds a country code, and a test enforces it.**
Belgium, Estonia, France and Luxembourg are four directories under
[`packs/`](../packs/) and four compiled seeds, each carrying a year of books
and the figures it produces.

## What an international core needs and does not have

The list this plan started from, with what phase 0 closed and what it did not.

| Gap | Where it stands | Why it matters outside Belgium and France |
|---|---|---|
| No pack object | **Closed.** `packs/<cc>/` compiled into a committed seed, versioned, with `country_packs` and `company_packs` recording what an installation and a company hold | UK, US or Canada would each add a third place where a country lives |
| Nothing on the invoice itself | **Closed.** Numbering and its pattern, the legal payment term, the tax point, the e-invoicing profile, the bank formats and the legal mentions are pack data | Every country prescribes different sentences on an invoice, and a renderer that hard-codes them is a renderer per country |
| No year-end close, no opening balances | **Closed.** `opening_balance()`, `close_fiscal_year()`, `reopen_fiscal_year()` and a `closing_style` the pack declares; shifted and 52/53-week years were always covered by `fiscal_years` | UK years run April to March; US retail runs 52/53 weeks; every migration starts with an opening balance |
| Currencies without realised gains or revaluation | **Half closed.** A matching that realises an exchange difference books it on the accounts the pack names; revaluation of open items is still out | Mandatory the day a company invoices outside its functional currency |
| Accrual only | **Half closed.** A tax can fall due on collection, which is what French services needed; cash accounting as a ledger is still out | UK and US small businesses report on a cash basis; French VAT on services is due on collection; the UK has a cash accounting scheme |
| A tax engine that knows only EU VAT | **Closed except stacked taxes on one line.** Kind, recoverability, jurisdiction, tax-inclusive prices, non-deductible VAT on the account of the line it taxes, rounding method per country | GST with input credits (Canada, Australia, Singapore); stacked taxes on one line (GST + QST in Québec, phase 1); non-recoverable sales tax (US, Canadian PST); withholding (Spain, Italy, Portugal); tax-inclusive pricing (UK, Australia retail) |
| No cash-flow statement | **Open**, and deliberately: `statements.json` already accepts `cash_flow` as a kind, and no pack here prescribes one | Expected before tax compliance in the English-speaking world |
| Nothing proved a pack against figures | **Closed.** A golden year of books per pack, and a legal source required on every tax and every box | A pack that cannot be wrong in a way anyone notices is a pack nobody can review |

## Four phases

### Phase 0 — a complete, country-agnostic core — **done, 14 September 2026**

The phase that decides everything. Nothing country-specific was added until it
was done. The format of the pack was decided on 12 September 2026 and is
written up in `decisions.md`; the twelve steps below were its execution order,
and they recut the first list in three places: opening balances came first
because they blocked adoption in Belgium and France; cash-basis VAT came
before any new country because the French pack was wrong for services; the
cash-flow statement, the revaluation of open items and several taxes on one
line wait for the countries that need them.

All twelve are delivered and shipped in `v0.2.0`. What that buys is narrow and
worth stating plainly: a country can now be described entirely in data, checked
by a tool, replayed against a year of books, translated, versioned and upgraded
in place — and a third country adds no place where a country lives. It does not
buy a third country, which is phase 1.

1. Pack format and compiler; Belgium and France extracted into `packs/`. **Done.**
2. The pack migration: `country_packs`, `company_packs`, translated labels,
   seeds that upsert the template tables. **Done.**
3. Declaration boxes as data, a generic `vat_return()`. **Done** — the boxes
   and their plus/minus formulas live in `tax_report_templates` and
   `tax_report_box_templates`, filled by the pack; the Belgian 71/72 and the
   French CA3 totals are pack data, and no function in the core holds a
   country code any more, which a test now enforces.
4. Financial statements as data, a generic statement by account type.
   **Done** — `statement_templates`, `statement_line_templates` and
   `statement_line_rules` filled by the packs, `financial_statement()` and
   `unmapped_accounts()`; the NBB abbreviated schemes and the French liasse
   2050-2053; a country-less `packs/generic/` whose rules are all account
   types, which gives any chart a balance sheet that ties out. A country also
   gained **several charts of accounts** — `chart_templates`, `chart_code` on
   the template accounts and on `company_packs`, `ekwo init --chart` — with
   the Belgian association chart as the first second chart.
5. The generalised tax engine: kind, recoverability, jurisdiction,
   tax-inclusive prices, non-deductible VAT, rounding rules. **Done**
   (12 September 2026): `tax_kind`, `recoverable`, `jurisdiction`,
   `price_include`, `cash_basis` on the taxes and their templates;
   `rounding_method` and `cash_rounding_unit` on the country model; the
   `tax_on_base` posting, which books non-deductible VAT on the account of the
   line it taxes. Belgian cars at 50 % and French fuel at 80 % are in the
   packs. The gross-to-net computation of a tax-inclusive price and the
   behaviour of `cash_basis` are not: the first waits for the country that
   sells that way, the second is phase 6.
6. Cash-basis VAT and realised exchange differences. **Done**
   (12 September 2026): `post_document` books a cash-basis tax — and the base
   it is computed on — on the transition account the pack names and on no
   declaration box, and `reconcile()` moves the settled share, pro rata and
   cumulative, to the account and the box it is declared on. `post_document`
   and `post_payment` convert to the company's currency and write
   `amount_currency`, which nothing did before, and a matching between two
   lines in the same foreign currency books the realised difference on
   `fx_gain_code` / `fx_loss_code` of the country model. The French pack gains
   the six services taxes that fall due on collection; the option for the
   debits is the tax that was already there. Out of scope and staying out:
   revaluation of open items, and cash accounting as a ledger.
7. Document rules, e-invoicing profiles and bank formats as data. **Done**:
   twelve columns on the country model — gapless numbering and the
   number pattern, the legal payment term and where its interest comes from,
   the tax point, the e-invoicing profile and the day it becomes obligatory,
   the ISO 6523 party and VAT schemes, the bank statement and payment
   formats, the usual opening of the financial year — plus
   `legal_mention_templates`, the sentences a country requires on an invoice
   with a closed vocabulary of nine conditions. `document_legal_mentions`
   decides which of them apply to one document from its country, its date and
   the treatments of the taxes on its lines; `document_line_items` gained the
   treatment and the exemption reason. Nothing executable: no function was
   added, and the numbering engine still builds its own number — the pattern
   is declared so that the engine which reads one changes nothing when it
   arrives.
8. Opening balances and a parameterised year-end close. **Done** —
   `opening_balance()`, `close_fiscal_year()`, `reopen_fiscal_year()`, and
   `closing_style` with its four account roles in the pack.
9. Pack versioning, `ekwo pack upgrade`, an append-only audit log. **Done** —
   `country_packs` and `company_packs` carry the versions, `ekwo pack status`
   and `ekwo pack upgrade` diff by natural key and apply only an addition and
   a closed validity, and `audit_log` records every change to the
   configuration of a company and every act that changes a state. The ledger
   itself is not audited: a posted entry is immutable and is corrected by a
   reversal.
10. One golden test per pack, a certification status. **Done** — each pack
    carries `golden/scenario.json`, a year of at least ten documents with the
    payments that settle some of them, and beside it the declaration, the
    statements and the trial balance the engine makes of it, to the cent.
    `tests/golden.test.ts` is one runner with no country in it: what it asks of
    a scenario, it asks of that scenario's own pack. A pack with no golden is
    refused unless its manifest says why. `legal_reference` became **required**
    on every tax and every box, and `certification.status` — `community`,
    `maintained`, `reviewed` — is printed by `ekwo init` before a company is
    created. There is no status meaning "certified by Ekwo": writing a pack is
    not reviewing it. The first run reported two defects in the French pack
    rather than adjusting the golden to match them.
11. End-to-end test, including an upgrade from the published version. **Done** —
    `tests/e2e/` installs the same release twice, once through the CLI's runner
    and once the way `supabase db push` and `psql -f` do, and compares every row
    of every table the seeds write; then it takes a company installed at the
    previous version, upgrades its pack, replays that pack's own golden
    scenario, files the declaration, prints both statements, closes the year,
    re-opens it and closes it again — comparing every figure to one it works
    out itself from `sum(debit) - sum(credit)`. `npm run e2e:supabase` covers
    what PGlite cannot reach: the published binary over a pooler connection,
    PostgREST, GoTrue and a hosted project's extensions.
12. Documentation: `docs/packs.md`, the contributor's guide. **Done** —
    [`packs.md`](packs.md) is the format file by file, the compiler, every rule
    `ekwo pack check` applies, the certification policy and a walkthrough for
    adding a country in a day; [`CONTRIBUTING.md`](../CONTRIBUTING.md) carries
    the invariants a country pack may not break; and the installation
    documentation names the four things an operator has to do on their own
    project, which `ekwo init` prints at the end of a successful run.

The original six-item list, for the record:

1. **The country pack format** — chart of accounts with translations, taxes
   and boxes, financial-statement mappings per framework, document rules,
   e-invoicing profile, bank formats, defaults; versioned; installed by a
   generalised `install_country_template`; **one golden test per pack**:
   ten posted documents, every box and every statement line to the cent.
   Belgium and France become the first two packs, which purges the core of
   what was theirs.
2. **Year-end close and periods** — result allocation, opening entries,
   monthly or 13 periods, shifted and 52/53-week years, opening balance
   import.
3. **Multi-currency, properly** — functional currency per company, realised
   gains and losses at matching, periodic revaluation of open items and of
   foreign-currency bank accounts.
4. **Cash basis alongside accrual** — reports derived from payments; VAT on
   collection (French services, the UK cash accounting scheme).
5. **Cash-flow statement, immutable audit log, translated labels.**
6. **A generalised tax engine** — a tax declares its kind (VAT, GST, sales
   tax, withholding, excise), whether it is recoverable, what it is computed
   on, whether prices include it, its jurisdiction, and its rounding rule.
   Reverse charge is already there.

### Phase 1 — first wave (first quarter of 2027)

- **Estonia** — **done, 14 September 2026**, and out of order: a small VAT
  system with a rate that moved twice in eighteen months, no legal chart of
  accounts, and a return that nests its boxes. It was picked to test the format
  against a country nobody designed it for, and the six gaps below are what it
  returned. A seventh — that a seed's file name was the country's alphabetical
  rank, so adding one renamed the seeds of every country after it — was fixed
  rather than recorded, because leaving it would have meant shipping the
  damage.
- **United Kingdom and Ireland** — a Xero-style chart, VAT boxes 1 to 9,
  FRS 102 mapping, tax point; MTD VAT submission in the commercial layer.
- **Canada and Québec** — GST, HST and QST stacked per line, PST as a
  non-recoverable tax in British Columbia, Saskatchewan and Manitoba, two
  administrations (CRA and Revenu Québec), bilingual labels, a QuickBooks or
  Sage 50 style chart, shifted years. **Rates live in the pack**: fifteen or so
  stable combinations published by the CRA are data, not the thousands of
  monthly-changing American jurisdictions that belong to a feed. It comes
  **before the United States**: closer to the accounting model this core was
  built on, and a test of the tax model that the US does not offer.
  `report_code` on the postings and `region` on companies and contacts were
  built in phase 0 so that this pack migrates nothing twice.
- **Netherlands, Germany, Luxembourg** — RGS, SKR03/04 with XRechnung, PCN.
  **Luxembourg is done**, as `packs/lu/`, and is described below.
- **United States** — a QuickBooks-style chart, the *shape* of sales tax in
  the core with rates and jurisdictions from a provider in the commercial
  layer, cash-basis reports, 1099 fields.
- **Formats** — Peppol PINT and UBL 2.1 as the universal invoice; OFX, BAI2,
  MT940 and camt.053 bank parsers. MIT packages under `packages/formats/`,
  one per format: camt.053 is no more European than UBL is universal, and
  neither is a country.

### Phase 2 — GST countries and southern Europe (mid-2027)

Australia and New Zealand (BAS), Singapore; Spain, Italy and Portugal
(withholding, FatturaPA, SII); consolidation across companies; iXBRL accounts
for Companies House.

### Phase 3 — the community makes the countries

A contribution kit for a pack with its golden test, a status page per
country, a reviewed-pack label. Odoo's localisations are code; Ekwo's are
data, contributable without touching the core.

Part of this arrived early, as a by-product of phase 0: the golden runner takes
any pack, `ekwo pack check` tells a contributor what is wrong in their own
terms, the three certification statuses exist and `ekwo init` prints the one it
is installing, and [`packs.md`](packs.md) walks through adding a country. What
is missing is the outside of it — a page that shows the state of every pack,
and enough contributed packs for the question to be interesting.

## The packs, country by country

| Country | Pack | Status | Out of scope, and why |
|---|---|---|---|
| Belgium | `packs/be/` | `maintained` | — |
| Estonia | `packs/ee/` | `community` | KMD INF, the § 44 cash-accounting scheme, the fixed-asset rules, the XBRL fact keys of the annual report, and versions of form KMD before 1 July 2025 |
| France | `packs/fr/` | `maintained` | — |
| Luxembourg | `packs/lu/` | `community` | the eCDF XML of the periodic return, the FAIA audit file, the annual VAT return, the special regimes, and corporate income tax |

### Estonia

Written from the outside in, against a country nobody had designed the format
for, and picked because it is small enough to finish and awkward enough to be
interesting: a standard rate that moved twice in eighteen months, a reduced
rate that went 9 %, 5 % and 9 % again, a return whose boxes nest three deep,
and **no legal chart of accounts at all**.

It carries an original chart of 120 accounts, 29 taxes with the rate history
back to 2009, form KMD as it stands since 1 July 2025, and the balance sheet
and income statement scheme 1 of the annual report. Three things are worth
knowing beyond the pack's own [`README`](../packs/ee/README.md):

- **The chart is written, not transcribed.** The Accounting Act obliges every
  entity to draw up its own, so there is no text to copy. The pack follows the
  convention Estonian practice shares — four digits, four classes, equity
  inside class 2 — and blocks the codes so each range maps onto one line of the
  statutory schemes.
- **No tax provision is booked at the close, and that is the law.** Estonia
  taxes distributed profit, not earned profit. `closing_style` is
  `result_accounts` because the statutory balance sheet keeps the year's result
  on a line of its own until the shareholders allocate it.
- **It is `community`.** Nobody who files an Estonian return has read it, and
  the pack's README ends on the four points a reviewer should look at first.

### Luxembourg

The third pack, and the first written from published sources alone rather than
from a running installation. It carries the **plan comptable normalisé** of the
*règlement grand-ducal du 12 septembre 2019* whole — 1 026 accounts, 747 of them
postable — the four VAT rates of article 39 with the temporary 2023 rates beside
them, the 156 numbered fields of the eCDF periodic return, and the two abridged
schemes of annual accounts keyed by their own eCDF field identifiers.

Three things about it are worth knowing beyond the pack's own
[`README`](../packs/lu/README.md):

- **The State publishes the mapping.** The annex that carries the chart carries
  the *tableau de passage* as well: which line of the abridged balance sheet or
  of the abridged profit and loss account each account reports in. The pack
  transcribes it account by account, so every postable account reaches exactly
  one line without anybody inferring a range.
- **It is `community`.** Nothing here was read by a Luxembourg accountant, and
  the pack's README ends on the ten points a reviewer should look at first.
- **Out of scope, on purpose.** The eCDF XML of the *periodic return*, the FAIA
  audit file, the annual VAT return (a different form with fields of its own),
  the franchise and VAT-group regimes, the full unabridged schemes and their
  notes, and the `tax` module. The first of those is a format library and not a
  pack; the rest wait for somebody who files them. The eCDF envelope itself is
  written by [`@ekwo-ai/ecdf`](../packages/formats/ecdf/) since the
  recapitulative statement arrived, which is what the distinction looks like in
  practice: an envelope is a format, the boxes of a return are a pack.

## What a new country shows the core cannot say

### From Luxembourg

A country pack is a test of the format as much as of the country. Four things
the Luxembourg pack had to work around, with what would fix each. None was
implemented for Luxembourg's sake — a gap the core has is a core issue, and
patching the core for one country is what this format exists not to do. Three
were then closed on their own merits, a day later and for every country; the
fourth still stands.

- ~~**A company does not record which period it files on.**~~ **Closed, 14
  September 2026.** `companies.vat_period` holds the answer, nullable and with
  no default; `country_defaults.vat_period_default` is where a pack proposes
  one, and every pack here leaves it null because Belgium, France and
  Luxembourg all make the cadence follow turnover. `ekwo init` asks when the
  form offers several, `ekwo status` prints it, and `vat_return()` does read it
  after all: it refuses a period the company does not file on, which is the one
  use of the answer that nothing around the return could have.
- ~~**A form's `period` cannot say "month, quarter or year".**~~ **Closed, 14
  September 2026.** `tax_report_templates.periods` is a list of
  `declaration_period`, and `tax_report.json` takes either the list or the
  single word it used to. `month_or_quarter` is read as the two cadences it
  always meant, and the column's default — which handed Belgium's cadence to
  every country that had not spoken — is gone: a form that names none is
  refused by `ekwo pack check`.
- **`sequence` on a declaration box means print order and evaluation order at
  once.** `ekwo pack check` refuses a total that names a total at the same
  sequence or later, from before `evaluate_totals()` learned to order by
  dependency. Every subtotal of the Luxembourg form prints *above* the boxes it
  adds, so the two meanings cannot both hold and the pack orders by dependency.
  *Fix: drop that rule from `pack check` — a cycle is already reported by name —
  or add a `print_sequence` and let the two be different questions.*
- ~~**A statement line may be computed and carry a sign, and the sign is applied
  to the total.**~~ **Closed, 14 September 2026.** `ekwo pack check` refuses
  `sign` together with `plus` or `minus`, the way it already refuses a line
  that is both summed and computed. The evaluator is unchanged: applying the
  sign "once" has no meaning while the lines below carry their own, and the day
  a country wants a total presented against its components, the honest shape is
  a second line rather than a flag that reverses one. No pack combined the two,
  so no golden figure moved.

One restriction turned out to be worth keeping. **A tax takes one `base`
posting per kind of document**, and the Luxembourg return reports the taxable
amount of a sale twice — as turnover in section I, and in the rate breakdown of
section II. The pack expresses the second as a total computed from the first,
which is one definition instead of two and is the better shape. **Documented,
15 September 2026**, and not a change to the core: [`packs.md`](packs.md)
carries the rule where the postings are defined and again in the walkthrough,
with box `472` as the worked example.

### From Estonia

None of these blocked the pack. Each one made it say something less precise
than the law does, and each is a change to the core rather than to a pack.

**A fact key cannot be a plain element name, and a taxonomy version cannot be a
date.** `ekwo pack check` requires an `xbrl` key to be a metric plus at least
one domain member, each part lower case, because the Belgian CBSO taxonomy is
dimensional; and it requires `taxonomy` to read `<name>:<dotted number>`. The
Estonian `et-gaap` taxonomy names the lines of its primary statements with
plain, undimensioned concepts — `et-gaap:CashAndCashEquivalents` — and versions
itself by date, `et-gaap_2026-01-01`. *Fix*: accept a single-part key, allow a
hyphen in the prefix and mixed case in the local name, and widen the version to
any sequence of letters, digits, dots and hyphens. *Until then*: the Estonian
statements carry no fact keys at all, because a wrong key is worse than none,
and no filing brick can read them.

**A declaration form whose boxes nest cannot be expressed directly.** A tax
carries one `base` posting per kind of document, so it reports to one box. Form
KMD asks for the same amount in a box, in the memo box inside that one, and
sometimes in a third: an intra-Community acquisition is box 1, box 6 and box
6.1 at once. *Fix*: let a `base` posting name several boxes, or add a posting
type that reports to a box and writes nothing to the ledger. *Until then*: the
Estonian pack posts to the innermost box, adds six `hidden` leaf boxes for the
parts the form prints only as a difference, and rebuilds every printed parent
as a total. It is exact, and it is six boxes a reader has to be told about.
That shape is the documented rule — one base posting, every further printing a
total, in [`packs.md`](packs.md) — and the gap stays open all the same: the six
boxes are what the rule costs on a form whose boxes nest.

~~**There is no treatment for a service received from outside the Union.**~~
**Closed, 15 September 2026**, and not under the name this note proposed. The
value is `foreign_services_received`, not `import_services`, because the rule
it names — articles 44 and 196 of Directive 2006/112/EC — turns on whether the
supplier is **established** in the buyer's country and not on whether the
service crossed the Union's border; a name built on "import" would have been
as wrong for it as `import` already was, and `import` in this vocabulary means
goods declared to customs, which is a different mechanism behind a different
document. The Estonian `EE-P-VS-24` carries it and has dropped the sentence of
its legal reference that apologised for saying `import`. On the invoice it
resolves to the reverse-charge mention: the same mechanism as a domestic
reverse charge, under a different article.

**A country that keeps one account for both signs of the year's result has to
name it twice.** `retained_earnings_loss` may be null and falls back to
`retained_earnings`; `current_year_result_loss` has no such fallback, and
`result_accounts` closing requires both. The Estonian balance sheet has one
line, *Aruandeaasta kasum (kahjum)*, and Estonian practice one account. *Fix*:
let `current_year_result_loss` fall back to `current_year_result_profit`, as
its sibling already does. *Until then*: the manifest names `2980` twice.

**An e-invoicing obligation that depends on the buyer cannot be said.**
`einvoicing.mandatory_from` is a date and nothing else, so a pack can say "from
this day everyone is bound" or say nothing. Since 1 July 2025 an Estonian
seller must issue an e-invoice when the buyer is registered in the commercial
register as an e-invoice recipient and asks for one; there is no day on which
everyone is bound. *Fix*: an `obligation` field beside the date, with a closed
vocabulary — `none`, `on_buyer_request`, `reception`, `emission`. *Until then*:
Estonia leaves `mandatory_from` null and puts the rule in the legal reference,
so a reader asking whether e-invoicing is obligatory there is told nothing
rather than told wrongly.

**A box of a declaration is a monetary amount.** Boxes 5.3 and 5.4 of form KMD
each carry a number of cars beside the amount deducted. No fix is proposed
here: a count comes from somewhere other than the ledger, and where that is
belongs to a longer conversation than this list. *Until then*: the Estonian
pack declares the two amounts and not the two counts, and says so.

One of Luxembourg's four turned up again, which is the answer to whether it was
a Luxembourg problem: **`sequence` on a declaration box means print order
and evaluation order at once**. Box 1 of form KMD is printed first and is a
total of boxes printed after it. Estonia escapes because the rule only
constrains a total that names another total, and box 1 names base boxes — but
it escapes by luck, and the fix Luxembourg proposes is the fix.

### From the EN 16931 code lists

Found while teaching `ekwo pack check` to compare a tax's treatment with its
category and its exemption reason. Neither blocked that work; both are about
the same two columns, and both are a change to the core rather than to a pack.

**A VAT category comes back padded with a space.** `taxes.vat_category`,
`tax_templates.vat_category` and `document_lines.vat_category` are `char(2)`,
and every category of EN 16931 but `AE` is one character — so the database
answers `S `, `K `, `E `, `G `, `Z `, `O `, and has done since the column was
created. `document_line_items` and `document_tax_summary` publish it that way
as BT-151, which is not a code of UNCL5305: a renderer writing it straight
into an invoice emits one that fails validation, and a reader comparing it to
`'S'` finds nothing. Nothing in this repository noticed, because the only test
that compared the column compared two databases that pad identically.
*Fix*: a migration widening the three columns to `text`, which means dropping
and recreating the two views that select them, and a check constraint if the
width was ever the point. *Until then*: every reader trims, and
`tests/packs.test.ts` pads its expectation on purpose with a comment pointing
here.

**A legal mention cannot tell a domestic reverse charge from a foreign one.**
`applies_when` is a closed vocabulary of nine conditions, and
`foreign_services_received` had to join `reverse_charge` because that is the
sentence all four packs print for it — the mechanism is the same and the
wording is the same. A country whose law prescribes a different sentence for a
service bought from a supplier established elsewhere cannot say so: it would
have to choose between the two sentences for both cases. *Fix*: a tenth
condition, `foreign_reverse_charge`, beside the one that exists. *Until then*:
no pack here needs the distinction, and a pack that does will be the argument
for adding it.


### From a document read by its recipient

Publishing an invoice behind a link (`20260915153000`) put a reader in front of
it who has no session, no preferences and no membership, and that reader found
two things the core cannot say.

**A document does not record the language it was written in.** `documents` has
no `language` column: the language is re-derived, every time, from the
contact's, then the company's, then the one the country pack declares. So an
invoice reprinted after the customer switched to another language comes out in
a language it was never sent in — which is wrong on a document whose legal
mentions are part of what the law requires. *Fix*: `documents.language`,
written from that same chain when the document is created, snapshotted like
`document_lines.vat_category` and `vat_rate` already are, for the same reason.
*Until then*: `shared_document()` resolves the chain on every read and a link
follows the contact.

**`preferred_languages()` cannot serve a reader who is not signed in.** It
starts at `user_preferences` for `auth.uid()`, which is null for `anon`, so the
one published way of choosing a language is unavailable to the one reader who
is outside the installation. `shared_document()` therefore resolves the chain
itself — the customer's language, then the company's — and that is a second
place a language is chosen. *Fix*: a `document_language(document_id)` that
answers for a document rather than for a user, with `preferred_languages()`
keeping its own chain for a person reading their own books. *Until then*: the
chain is two columns inside `shared_document()`, and it is the only copy.

### From the recapitulative statement

The statement of intra-Community supplies — `ec_sales_list()` and the four
format bricks beside it — was the first thing written that is European rather
than national: one engine, four files, no `packs/eu/`. Five things it could not
say precisely, each a change to the core rather than to a pack.

**A company records how often it files its return, and that is not how often it
files anything else.** `companies.vat_period` holds one cadence. The
recapitulative statement has its own, and it is a different one in three of the
four countries read while writing this: Belgium files it monthly above a
threshold that counts goods only, whatever the return's cadence; France files
it monthly always; Luxembourg lets goods and services take different cadences,
both independent of the return; only Estonia files it with the return. *Fix*: a
cadence per declaration a company is subject to, rather than one column named
after the return — `tax_report_templates.periods` already says what each form
accepts, so what is missing is the company's side of it. *Until then*:
`ec_sales_list()` refuses no period at all, where `vat_return()` refuses one the
company does not file on. Borrowing the return's guard would have refused a
lawful monthly statement from a quarterly Belgian filer, which is the ordinary
case.

**The core cannot say whether a country is a Member State.** Every one of these
four forms carries supplies to the Union and nothing else, and the only check
this engine can make is that the customer's country is not the company's own.
A list of Member States in a function would be a country literal, and in a pack
it would be wrong: membership is the Union's law and not any one country's.
*Fix*: a small reference table of territories beside `currencies` — which is
already framework data rather than pack data — carrying membership with its
validity dates, so a supply to a country that left the Union is reported as a
supply to a third country from the day it left. *Until then*: each format brick
reports what its own administration's schema refuses, which catches a good deal
of it and catches it late.

**A VAT identification prefix is not always the ISO country code.** Greece
identifies under `EL` and Northern Ireland under `XI`; `contacts.country` is
ISO 3166-1 and `contacts.vat_number` may carry either, depending on who typed
it. *Fix*: the same reference table, mapping a territory to the prefix its
numbers carry. *Until then*: the prefix is read from the number where the
number carries one, and falls back to the contact's ISO country where it does
not — so a Greek customer recorded without a prefix is listed under `GR`, which
every one of these four administrations refuses.

**A ledger line does not say which posting wrote it.** `entry_lines` carries
`tax_id` and `tax_line`, so a `base` line and a `tax_on_base` line of the same
tax on the same account are indistinguishable once written. Anything reading
the ledger by tax rather than by box has to know that one of the two cannot
occur. *Fix*: a `posting_type` on `entry_lines`, copied from the posting that
produced it, beside the `declaration_box` that is already copied there. *Until
then*: `ec_sales_list()` reads the lines of a tax that are not tax lines, which
is exact because an intra-Community supply is exempt and has no tax to
capitalise — and would stop being exact the day a pack said otherwise.

**There is no treatment for a triangular operation.** All four forms print it
as a category of its own: `T` on the Belgian listing, state II of the
Luxembourg one, column 4 of the Estonian form. `tax_treatment` has
`intracom_goods` and `intracom_services` and nothing between them, so a
supply under a triangular arrangement is declared as ordinary goods. *Fix*: add
`intracom_triangular`. *Until then*: nothing else has to move — the engine
derives the nature by taking `intracom_` off the treatment, and all four bricks
already have a column for it, so the value alone would light the whole path up.


## The same rule, next: the One-Stop Shop

Nothing is coded for it here, and this paragraph exists so that the next person
does not rediscover the shape.

A recapitulative statement asks: *who, in another Member State, did I supply,
and how much*. The One-Stop Shop asks: *in which Member State did I have to
charge the tax, at what rate, and how much*. Both are answered from the same
two facts — **the treatment of the tax on the line, and the country of the
customer** — and from nothing else. The statement reads a treatment that says
the supply is exempt in the seller's country and taxable in the buyer's, and
groups by the buyer's VAT number; the One-Stop Shop reads a treatment that says
the supply is taxable in the buyer's country, and groups by that country and by
the rate applied. `ec_sales_list()` is the first of the two, written as a
function of the core with a flat row shape and a brick per file, and the second
is the same three pieces: a treatment the pack declares, an aggregation the
core computes, a format package per administration.

Two things the second one will need that the first did not, and both are on the
list above. It needs to know which country a customer is in **and whether that
country is in the Union**, because the scheme applies to consumers and not to
identified businesses, so the VAT number is not the key. And it needs a rate
per Member State of consumption, which is not the seller's pack: a French
company selling into Germany charges German rates, and today the only place a
German rate lives is the German pack that company does not hold. That is the
one genuinely new question, and it is worth answering before any code — either a
company holds several packs, or the rates of the scheme are framework data like
the currencies. Neither is decided here.

### From the register of sources

Found while turning `certification.sources` into a register a reviewer can
open — a key, a title, the publisher, an absolute link — and pointing every
`legal_reference` at one of its keys. Neither blocked that work. Both are
places where the format lets a pack claim something and gives it nowhere to
say where the claim comes from.

**What a country puts on an invoice cites nothing.** `documents` carries the
numbering style, the number pattern, the legal payment term and the tax point,
and it has no `legal_reference` of its own — only the sentences under
`documents.mentions` do, one per sentence. So a pack that took its numbering
rule from an article of a decree has no field to say which, and the register
entry for that text ends up pointed at by nothing: the French pack holds
`cgi-annexe-2` for exactly the article that prescribes continuous numbering and
the compulsory mentions, and no rule of the pack names it. *Fix*: a
`legal_reference` and a `source` on `documents`, beside the four rules it
carries, the way `einvoicing` and `bank` already have one. *Until then*: the
text is in the register and a reviewer finds it there, one step further away
than it should be.

**A legal reference the schema accepts and the compiler drops.**
`einvoicing.legal_reference` is read by `pack.1.json`, written by all four
packs — it is where the day an obligation starts is justified — and it reaches
no column: `country_defaults` holds the profile, the date and the two ISO 6523
schemes, and nothing carries the article behind them. The same is true of
`charts[].legal_reference`, which does compile, and of the `source` beside
either, which does not. Nothing is wrong in the pack; the information stops at
the seed. *Fix*: an `einvoicing_legal_reference` column beside the four that
exist, and `source_key` on `chart_templates` and `statement_line_templates`,
the way this change added it to `tax_templates` and
`tax_report_box_templates`. *Until then*: `country_packs.sources` answers
"where do these rules come from" for the pack as a whole, and the pack file is
where the per-rule answer is read.

## Decisions taken with the plan

- **US sales tax is not in the core.** Tens of thousands of jurisdictions
  and their updates; the core models the shape, a provider supplies the
  rates, in the commercial layer. Xero and QuickBooks do the same.
- **Order: Europe, then the UK and Ireland, then Canada and Québec, then the
  Commonwealth, then the United States.** It is the order of proximity to the
  accounting model this core was built on, and the reverse of market size.
- **The pack comes before any new country.** Adding the UK on the core as it
  stood would have added a third place where a country lives. Phase 0 was first
  a taxonomy decision, and a taxonomy is the one thing that does not get
  redone.

## Deliberately out of scope

Inventory, payroll, advanced fixed-asset regimes (MACRS), point of sale and
its certifications. A products table exists so that inventory can come later
as its own schema, as `decisions.md` describes.
