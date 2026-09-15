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
Belgium, Estonia, France, Luxembourg and the United Kingdom are five
directories under [`packs/`](../packs/) and five compiled seeds, each carrying
a year of books and the figures it produces. The fifth is the first that is not
a Member State of the Union, which is the whole reason it was written.

## What an international core needs and does not have

The list this plan started from, with what phase 0 closed and what it did not.

| Gap | Where it stands | Why it matters outside Belgium and France |
|---|---|---|
| No pack object | **Closed.** `packs/<cc>/` compiled into a committed seed, versioned, with `country_packs` and `company_packs` recording what an installation and a company hold | UK, US or Canada would each add a third place where a country lives |
| Nothing on the invoice itself | **Closed.** Numbering and its pattern, the legal payment term, the tax point, the e-invoicing profile, the bank formats and the legal mentions are pack data, each rule citing the article that imposes it | Every country prescribes different sentences on an invoice, and a renderer that hard-codes them is a renderer per country |
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
   twenty columns on the country model — gapless numbering and the
   number pattern, the legal payment term and where its interest comes from,
   the tax point, the e-invoicing profile and the day it becomes obligatory,
   the ISO 6523 party and VAT schemes, the bank statement and payment
   formats, the usual opening of the financial year, and the article behind
   four of those rules with the register entry it is read at — plus
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
- **United Kingdom** — **done, 15 September 2026**, and the first pack of a
  country outside the Union: no intra-Community tax on either side, retail
  prices quoted with the tax in them, an exemption the European code lists have
  no code for, and a nine-box return that prints one amount in two boxes at
  once. A British-style chart mapped onto the statutory small-company formats,
  the nine boxes of the VAT Return, FRS 102 for the fixed assets, and the gaps
  listed under "From the United Kingdom" are what it returned — the first two
  of them closed the same week. Northern Ireland,
  Making Tax Digital submission and the VAT schemes are out of its scope.
- **Ireland** — a chart of accounts and form VAT 3; the pack format has
  everything it needs since the United Kingdom landed.
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
| United Kingdom | `packs/gb/` | `community` | Northern Ireland and the `XI` prefix, Making Tax Digital submission, the flat rate, cash accounting, annual accounting, margin and retail schemes, partial exemption, the Construction Industry Scheme return, corporation tax and capital allowances, the medium and large formats of S.I. 2008/410, and iXBRL for Companies House |

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

### United Kingdom

The fifth pack, and the first of a country that is **not** a Member State of
the Union. It was written for that reason: every pack before it could lean on
the VAT Directive, on the intra-Community mechanism and on the European code
lists, and nobody knew how much of the format silently assumed them.

It carries an original chart of 190 accounts, 25 taxes with the standard rate
back to the commencement of the Value Added Tax Act 1994, the nine boxes of the
VAT Return as they stand since 1 January 2021, the balance sheet and the profit
and loss account of the small companies regime, and the usual lives of a fixed
asset under FRS 102. Four things are worth knowing beyond the pack's own
[`README`](../packs/gb/README.md):

- **There is no legal chart of accounts, and no legal statement schemes
  either — there are legal *formats*.** Companies Act 2006, s. 396 requires the
  accounts to comply with regulations as to their form and content, and those
  regulations prescribe the lines of the balance sheet and of the profit and
  loss account letter by letter. So the statements of this pack are
  transcribed, exactly as Luxembourg's are, while the chart underneath them is
  written: the codes are the four-digit convention a British nominal ledger
  uses, blocked so that each range reaches one item of Schedule 1 Format 1.
- **Nothing here is intra-Community, on either side.** Since 1 January 2021 a
  supply from Great Britain to a Member State is an export and an arrival is an
  import, so four of the eleven treatments never occur. What replaced them is
  postponed VAT accounting, which the pack models as an `import` posting to
  boxes 1, 4 and 7 that nets to nothing in the ledger.
- **Northern Ireland is deliberately absent.** The Windsor Framework keeps it
  inside the Union's rules for goods under one registration with Great Britain,
  and boxes 2, 8 and 9 of the return are about that trade alone. They are
  declared and empty; see the last gap below for why the pack could not carry
  them.
- **It is `community`.** Nobody who files a British return has read it, and the
  pack's README ends on the points a reviewer should look at first. The first
  two of them were the exemption reason code this pack had to invent and the
  Union's export code it had to borrow; both are gone with pack version 0.1.1,
  which leaves no `exemption_code` on any British tax.

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

### From the United Kingdom

Seven things the first pack outside the Union could not say precisely. Four of
them are about the same assumption — that a country's VAT is the Union's VAT —
and the other three are about what a price, a rounding rule and a filing cadence
belong to. None blocked the pack. None was patched for its sake: the first two
were closed afterwards, on their own, with the pack already landed and its own
README naming them as the things a reviewer should refuse first.

An eighth is of a different kind and is recorded at the end: ten assertions of
the test suite that had never been contradicted, and that were fixed rather than
worked around, because a test reading the pack is what this repository asks for
in as many words.

~~**A VAT exemption outside the Union has no reason code, and one is
required.**~~ **Closed, 15 September 2026.** `ekwo pack check` demanded an
`exemption_code` as soon as `vat_category` was `E`, and checked its shape
against `VATEX-EU-<article>` or `VATEX-<country>-<article>`. The VATEX list is
European: its own codes name articles of Directive 2006/112/EC, and its
national codes — `VATEX-FR-CGI261-1` and the rest — belong to Member States
that publish them. A British exemption is Schedule 9 to the Value Added Tax Act
1994 and no published list carries a code for it, because no administration
that would publish one has any reason to. The rule was right for a Member State
and had no answer for a third country.
The fix is the one proposed, generalised: the last column of the table under
"What a tax says on the invoice" now applies where the Union's VAT does, and
nowhere else. For a pack whose country the common system does not reach,
`exemption_code` stays null, the article goes in `legal_reference` where it was
going anyway, a `VATEX-*` code is refused by name, and the five `intracom_*`
treatments are refused outright. The categories are untouched, because UNCL5305
is a UN/CEFACT list and `E`, `G`, `O` and `AE` mean there what they mean
anywhere. Which side of the line a pack is on is read from `territories` — the
`eu_vat_scope` of its country at the manifest's `released_at` — and nothing
about it is written into the code: `pack check` has no database, so it parses
`supabase/seed/00_territories.sql`, and `tests/vat_codes.test.ts` holds its
answer against `eu_vat_scope_of()` for every territory on every date the table
carries. Should a third country ever publish reason codes of its own, the
column takes them where the pack's register declares that list with
`kind: standard`; the field is provided for and the content is not, because
nobody has published one. `packs/gb/` 0.1.1 drops `VATEX-GB-SCH9` and the three
Union codes it had borrowed, and its README's first two review points are gone
with them.

~~**`G` and `VATEX-EU-G` say "export outside the EU", and a third country's
export is not that.**~~ **Closed, 15 September 2026**, as the same change and
by reading the standard more carefully. The claim that `G` describes the
Union's border came from use case 4 of the Commission's technical guidance,
which is written for a seller established in a Member State. UNCL5305 itself
says of `G` *free export item, VAT not charged*: the goods leave the territory
of whoever levies the tax, and a supply from Great Britain to a Member State is
one. So the category was never wrong for a British export and the refusal
message was — it now says what UNCL5305 says, with the guidance's use case
named as the Member State's case of it, and `docs/packs.md` reads the same way.
The code was the wrong half: `VATEX-EU-G` names article 146 of a Directive that
does not bind the seller, and it is refused outside the Union along with the
rest of the list. `GB-S-EXPORT` carries `G` and nothing else, with s. 30(6) of
the Value Added Tax Act 1994 in its `legal_reference`.

**One taxable amount, two printed boxes that are siblings and not nested.**
Estonia recorded this for a form whose boxes contain one another, and proposed
the fix: let a `base` posting name several boxes, or add a posting type that
reports to a box and writes nothing to the ledger. The British form shows the
second shape of the same gap. VAT Notice 700/12 asks for the value of a service
received from a supplier established abroad in **box 6**, which is outputs, and
in **box 7**, which is inputs — two boxes on opposite sides of the return,
neither containing the other. A tax carries one `base` posting per document
kind, so it can name one of them. *Until then*: the pack posts that value to a
hidden box `67` and rebuilds boxes 6 and 7 as totals of the period's own sales
or purchases plus that box, which costs three hidden boxes on a nine-box form —
and is exact. The Estonian fix covers both shapes and is still the fix.

~~**A price that includes the tax is declared and never computed.**~~
**Closed, 15 September 2026.** The engine takes the tax out of the gross of
each tax group, rounds it once as BR-CO-14 requires, subtracts it to get the
base — so `base + tax` is the price that was quoted, always — and shares that
base back over the lines in proportion to their gross, the last line taking the
remainder. The line keeps the gross it was quoted at and a snapshot of the flag,
frozen when the document is posted. `GB-S-20-INC` is now booked in the golden
scenario for what it is, a day of counter sales of 5 493,92 gross, and
`docs/decisions.md` is where the arithmetic and the three refusals are written
down. The shared invoice carries the two fields too, so a link says which price
it is showing. Two narrower gaps came out of it and are below: the choice HMRC
gives a retailer between two rounding units, and BT-146, the net unit price,
which nothing publishes where the price was quoted gross.

**A rounding *unit* is a choice a country may give a trader, and nothing can
record it.** VAT Notice 700, §§ 17.5 and 17.6, lets a retailer work the tax out
line by line or invoice by invoice, and both are lawful. Ekwo does it invoice by
invoice, per tax group, because that is what EN 16931 BR-CO-14 requires of a
structured invoice and a line-by-line figure would fail validation. That is the
right default and it is still a choice made for the trader rather than by them.
*Fix*: whatever records the choice belongs beside the other one on this page —
a nullable column on `companies` overriding the country, in the shape
`vat_period` already has — and it is a different field from
`rounding_method`, which is the arithmetic and not the unit it applies to. No
new vocabulary was invented for it here, on purpose: a word in the pack format
is a word every pack has to mean something by. *Until then*: a British retailer
who works line by line files a figure Ekwo does not produce, and is within a
penny or two of it on any invoice with more than one line.

**BT-146 is the net unit price, and nothing publishes it where the price was
quoted gross.** `document_lines.unit_price` is the price as it was keyed, which
on a retail line is the gross one, and `document_line_items` hands it on under
that name. Nothing is ambiguous about it — the view and the shared payload both
carry `unit_price_includes_tax` and `amount_incl_tax`, so a reader knows which
price they have and what the gross was — but the net unit price itself is not
published anywhere. Its honest definition is the base divided by the quantity,
because BR-CO-10 wants quantity times BT-146 to be BT-131 and the group's
remainder lands on a line. What stops it
being a column today is the precision: it is the *price* column's six decimals
and not the currency's, which `round_amount` does not express, and writing
`::numeric(16, 6)` would put a second place where decimals are decided —
exactly what `npm run check:rounding` exists to refuse, and it refuses it.
*Fix*: a way to say "at the precision this column has" that the rounding rule
owns, then a `unit_price_net` beside the two fields that are already there.
*Until then*: a renderer that needs BT-146 divides `amount_untaxed` by the
quantity itself, which is the same arithmetic done one layer out, and every
pack here but the British retail tax prices net and is unaffected.

**A rounding rule belongs to a country, and HMRC gives one to each kind of
trader.** `country_defaults.rounding_method` is one value per country and there
is no column beside it on `companies`. HMRC's concession, recorded in
VATREC12010 and VATREC12020, lets an **invoice trader** round the VAT payable
*down* to a whole penny, because the rounding is neutral between the supplier's
output tax and the customer's input tax; and it says the same concession is not
appropriate for a **retailer**, for whom rounding down reduces the tax accounted
for without reducing the tax charged. Two lawful methods in one country,
chosen by what the business is. *Fix*: a nullable `rounding_method` on
`companies` that overrides the country's, which is the shape `vat_period`
already has — the pack proposes, the company decides, and nothing falls back on
another country. *Until then*: `packs/gb/` declares `half_up`, which is the
method a retailer must use and one an invoice trader may, and a company on the
concession has nowhere to record it.

**A tax cannot depend on the territory the parties are in, and one
registration can cover two tax territories.** Half of what this note first
proposed landed the same day, from the recapitulative statement's own list:
`territories` is reference data of the framework, `XI` is in it with
`eu_vat_scope = 'goods'` and the prefix VIES publishes for it, and `GB` carries
the day it left the common system. What that buys is a **reader** — the
statement asks the table and stops listing supplies to the United Kingdom after
2020. What it does not buy is a **pack**. Since 1 January 2021 one VAT
registration covers Great Britain, where the Union's rules do not apply, **and**
Northern Ireland, where they do for goods: a Northern Irish seller identifies
under `XI`, makes intra-Community supplies of goods, and files boxes 2, 8 and 9
of the same nine-box return. A pack is keyed on a country and has no unit below
it; `companies.region` and `contacts.region` exist and nothing reads them; and
no tax may be conditioned on either. So `packs/gb/` cannot carry the Northern
Ireland taxes without claiming they apply to a company in Manchester. *Fix*: let
a tax name a territory the way it already names a `jurisdiction`, and let a
company record the territory it is established in, so that one country's pack
can carry two sets of taxes and offer each where it applies — the table that
says which territory is which already exists. *Until then*: `packs/gb/` is Great
Britain's return, boxes 2, 8 and 9 are declared and empty, and the pack's README
sends a reader to `territories` for what `XI` is.

**A pack may propose a filing cadence only where its form accepts exactly one,
and the United Kingdom has a default its form does not show.**
`tests/tax_report.test.ts` states the policy as an invariant over every pack: a
form filed on one cadence has that cadence proposed in `defaults.vat_period`, a
form filed on several proposes nothing. The reason given is sound for every pack
written before this one — everywhere in Europe the cadence follows turnover, so
the answer is a fact about the company and a pack proposing one would be
choosing a filing deadline for somebody it knows nothing about. Regulation 25(1)
of the Value Added Tax Regulations 1995 makes the prescribed accounting period
three months **for everybody**, and a month or a year is something the
Commissioners *allow or direct* on application. So the British form is filed on
three cadences and the British law still gives one default, which is the case
the rule cannot express: it reads the length of a list where the question is
what the law says. *Fix*: judge the proposal against the law rather than against
the form — keep the refusal of a proposed cadence the form is not filed on,
which catches a real mistake, and drop the rule that a form with several may
propose none. If the invariant is worth keeping mechanically, the manifest is
where the distinction belongs: a cadence the law gives, and a cadence left to
the company, are two different silences and today they are the same one. *Until
then*: `packs/gb/` proposes nothing, `ekwo init` asks a British company what it
files on, and the pack's README says that a company which has asked HMRC for
nothing files quarterly.

**And ten assertions that were an unnamed country.** These are not gaps in the
format: the core supported everything the United Kingdom asked of it. They are
places where `tests/` had assumed something every pack until now happened to
satisfy, and the invariant CONTRIBUTING states — *a test may book in a country,
it may not expect one* — is what says they are defects. Unlike the seven above,
they were fixed, in a commit of their own, and every fix **removes** an
assumption rather than adding a country: `npm run check:no-country-literals`
never saw any of them, because none of them spelled a country code.

| What was assumed | What the United Kingdom is | What the test reads now |
|---|---|---|
| every pack declares at least one other language | a pack written in English has none to declare | the promise is checked for what is declared, and one assertion says the repository still has a multilingual pack |
| `manifest.languages` is an array | it is optional and absent | `?? []` |
| every asset category has translated labels | a pack with no i18n file has none | the column's own empty object |
| a declaration form has more than twenty boxes | the VAT Return has nine, and twelve with the pack's hidden ones | the form carries every box the pack's taxes post to, at least one of them, and at least one total |
| the fixed-assets module has exactly two country seeds, named | it has one per pack that says something about fixed assets | derived from `allPacks` and each manifest's `seed_sequence` |
| `country_packs` in slug order is `allPacks` order | the first pack whose name does not sort where its slug does — United Kingdom after Luxembourg | sorted the way the query asks, by name |
| a closing style is `appropriation_accounts` or `result_accounts` | the first pack that closes straight into retained earnings, which the schema has always allowed and `docs/packs.md` names the United Kingdom for | the enum of `packs/schema/pack.1.json`, beside the statuses and the cadences already read there |
| every pack names an account for the result of the year | under `retained_earnings` there is no such account and the schema says the roles are null | the roles, nullable |
| every pack's country is a Member State | it is in `territories` with the day it left | the country has to be *known* to the table, and a Member State exactly where the pack's own treatments are intra-Community |

The last one arrived with `territories` on the same day, and is the sharpest of
them: the table was written so that the core could say whether a country is in
the common system, and the test that read it asked every pack's country to be a
Member State. It now asks the pack. A pack whose taxes are intra-Community has
to be inside the system and one whose taxes are not has to be outside it, which
is a stronger claim than the one it replaces and the only one a pack of a third
country can satisfy.

The eleventh is the cadence above, and it is the one that was **not** fixed: it
is a policy and not an assumption, so the pack works around it and the fix is
proposed rather than taken.

One thing the United Kingdom **confirmed** rather than found. A legal mention
cannot tell a domestic reverse charge from a foreign one — recorded from the
EN 16931 code lists, where no pack needed the distinction. This one does: s. 55A
of the Value Added Tax Act 1994 moves the liability on a construction service
supplied inside the United Kingdom, and s. 8 does it on a service received from
a supplier established abroad. Two articles, two mechanisms, one
`applies_when`. The pack prints one sentence and names both articles in its
legal reference, which is the argument for the tenth condition that note
proposed.

### From the EN 16931 code lists

Found while teaching `ekwo pack check` to compare a tax's treatment with its
category and its exemption reason. Neither blocked that work; both are about
the same two columns, and both are a change to the core rather than to a pack.

~~**A VAT category comes back padded with a space.**~~ **Closed, 15 September
2026.** `taxes.vat_category`, `tax_templates.vat_category` and
`document_lines.vat_category` were `char(2)`, and every category of EN 16931
but `AE` is one character — so the database answered `S `, `K `, `E `, `G `,
`Z `, `O `, and had done since the column was created. `document_line_items`
and `document_tax_summary` published that as BT-151, which is not a code of
UNCL5305: a renderer writing it straight into an invoice emits one that fails
validation, a reader comparing it to `'S'` finds nothing, and since
`shared_document()` reads both views it reached whoever held the link to an
invoice. Nothing here noticed, because the only test that compared the column
compared two databases that pad identically and trimmed before it looked.
The three columns are `text`, under a check constraint that accepts one or two
capitals and nothing else, so the column now refuses what it used to
manufacture; the two views were dropped and recreated unchanged but for
existing, with their comments and their grants. No pack moved: a pack never
wrote the space, the column added it — the golden files are identical and the
seeds are untouched. `tests/vat_category.test.ts` follows one pack's category
from the manifest to the payload an anonymous reader receives, and
`tests/packs.test.ts` has dropped the expectation it used to pad on purpose.

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

**And it cannot name the simplification a triangular supply is relieved
under.** `intracom_triangular` joined the same condition on 15 September 2026,
for the same reason — the mechanism is the customer owing the tax and the
sentence is *Reverse charge*, which is what article 226(11a) requires. But
article 226(11) also wants a reference to the provision that relieves the
supply, and several Member States ask a triangular invoice to name article 141
itself. A pack that wants that sentence has today to fold it into its
reverse-charge wording, where it would also print on a domestic reverse charge
that has nothing to do with article 141. *Fix*: the same tenth condition
generalised, or an eleventh — three articles behind one sentence is one too
many. *Until then*: three treatments share `reverse_charge`, and the value of
the treatment on the line is the only place the difference is recorded.


### From a document read by its recipient

Publishing an invoice behind a link (`20260915153000`) put a reader in front of
it who has no session, no preferences and no membership, and that reader found
two things the core could not say. Both are closed by `20260915191200`, and
they turned out to be one thing: a chain that was re-walked on every read, from
a starting point only a session could supply.

~~**A document does not record the language it was written in.**~~ **Closed,
15 September 2026.** `documents` had no `language` column: the language was
re-derived, every time, from the contact's, then the company's, then the one
the country pack declares. So an invoice reprinted after the customer switched
to another language came out in a language it was never sent in — wrong on a
document whose legal mentions are part of what the law requires.
`documents.language` is now a column of the table, filled from that same chain
when the document is created and frozen the moment it is posted, which is what
`document_lines.vat_category` and `vat_rate` already are and for the same
reason. A draft keeps following the chain — it carries no number, no entry, and
the customer on it may still change — and a posted document refuses the move
by name, `document_language_frozen`. The documents that were already here were
filled from the chain once, in the migration, which is the best that can be
said about a document somebody has already sent.

~~**`preferred_languages()` cannot serve a reader who is not signed in.**~~
**Closed, 15 September 2026.** It started at `user_preferences` for
`auth.uid()`, which is null for `anon`, so the one published way of choosing a
language was unavailable to the one reader who is outside the installation, and
`shared_document()` resolved the chain itself — a second place a language was
chosen. The chain was never about a *user*, only about where it starts:
`preferred_languages(language, company)` takes the starting point explicitly,
and `preferred_languages(company)` is now one line on top of it, supplying the
signed-in reader's preference. `document_legal_mentions` walks the chain from
`documents.language`, `shared_document()` reads the column and the view, and
neither writes a chain of its own. `anon` gains nothing: the overload is
granted to `authenticated` and `service_role`, and the public door is still one
`security definer` function.

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

~~**The core cannot say whether a country is a Member State.**~~ **Closed, 15
September 2026**, and by the fix this note proposed: `territories`, a reference
table of the framework beside `currencies`, seeded by
`supabase/seed/00_territories.sql` and read by `is_eu_member(code, on)`,
`eu_vat_scope_of(code, on)` and `territory_of(code)`. It carries 49 rows — the
27 Member States with the day each became bound, the United Kingdom with the
day it stopped being, Northern Ireland, and the territories articles 6 and 7 of
Directive 2006/112/EC take out of the common system or put into it — each with
the text it comes from. `ec_sales_list()` asks it **as at the entry date of the
line**, so a statement for a period in 2020 still reports supplies to the
United Kingdom and one for 2021 does not, and a supply to a territory the
system did not reach comes back as `vat_country_outside_the_union` instead of
being listed. Two decisions are worth knowing: the columns are named for VAT
and not for membership — the United Kingdom left the Union on 31 January 2020
and the common system on 31 December 2020, and the reader of this table is VAT
code — and Northern Ireland is a **row of its own** with a parent rather than a
flag on the United Kingdom, with an `eu_vat_scope` of `goods`, because it is
inside the system for supplies of goods and outside it for supplies of
services. A statement of services to an `XI` customer therefore comes back as
`vat_country_outside_the_union_for_this_supply`, which nothing could have said
before.

~~**A VAT identification prefix is not always the ISO country code.**~~
**Closed, 15 September 2026**, by the same table: `vat_prefix_of(code)` answers
the two letters a territory's numbers carry, and `territories.vat_prefix` holds
that answer only where it differs from the code — `EL` for Greece, `FR` for
Monaco, `GB` for the Isle of Man — so the column is a difference and never a
copy. Both paths into `ec_sales_list()` go through it, the prefix read off the
number and the contact's ISO country alike, which means a number typed `GR…` is
corrected as readily as one typed with none. It also fixed a defect nobody in
Belgium or France could have seen: the company's own country was compared raw,
so `vat_country_is_the_company_country` would never have fired for a Greek
filer and a domestic supply would have been listed as an intra-Community one.
A territory the table does not carry keeps its own two letters, so a third
country is still readable on the statement that then refuses it.

**A ledger line does not say which posting wrote it.** `entry_lines` carries
`tax_id` and `tax_line`, so a `base` line and a `tax_on_base` line of the same
tax on the same account are indistinguishable once written. Anything reading
the ledger by tax rather than by box has to know that one of the two cannot
occur. *Fix*: a `posting_type` on `entry_lines`, copied from the posting that
produced it, beside the `declaration_box` that is already copied there. *Until
then*: `ec_sales_list()` reads the lines of a tax that are not tax lines, which
is exact because an intra-Community supply is exempt and has no tax to
capitalise — and would stop being exact the day a pack said otherwise.

~~**There is no treatment for a triangular operation.**~~ **Closed, 15 September
2026**, and it cost exactly what this note predicted: the value
`intracom_triangular`, and nothing else. `ec_sales_list()` returns the nature
`triangular` without a line of it changing, and the four bricks — published
before the value existed — write `T` on the Belgian listing, the `TVA_LICT`
form of the Luxembourg envelope and the `kolmnurktehing` column of the Estonian
form VD, while the French DES says by name that a supply of goods belongs on
another file. It is the middle supply of the arrangement — B's sale to C,
relieved by article 141 of Directive 2006/112/EC and reverse-charged to C by
article 197 — and not A's, which is an ordinary intra-Community supply. On the
invoice it resolves to the **reverse-charge** mention and not to the
intra-Community one, which is the sentence article 226(11a) requires: the
supply is not exempt under article 138, it takes place where the goods arrive
and the customer owes the tax. **No pack of this repository declares a
triangular tax**, and a test insists on that — the path is proved on a fixture,
a company's own tax with its treatment changed, because writing an invented tax
into `packs/<cc>/` is writing a rule nobody can review.


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

Two things the second one will need that the first did not. **One of them now
exists.** It needs to know which country a customer is in *and whether that
country is in the Union*, because the scheme applies to consumers and not to
identified businesses, so the VAT number is not the key — and that is
`territories`, asked as at a date, which is what `ec_sales_list()` already does
line by line. A consumer in a territory the system does not reach is not a
One-Stop Shop supply at all, and the table says so for the Canary Islands and
for Northern Ireland's services as readily as for Switzerland.

What it does **not** give is a rate per Member State of consumption, which is
the genuinely new question and is unchanged by any of this. A French company
selling into Germany charges German rates, and today the only place a German
rate lives is the German pack that company does not hold. Adding rates to
`territories` would be the wrong answer twice over: a rate has a validity and a
category and an exemption reason, which is a tax and not a territory, and a tax
is what a pack carries. So the choice stays the one this paragraph always
named — either a company holds several packs, or the rates of the scheme are
framework data of their own — and the table below it settles only where the
system applies, not what it charges.

### From the register of sources

Found while turning `certification.sources` into a register a reviewer can
open — a key, a title, the publisher, an absolute link — and pointing every
`legal_reference` at one of its keys. Neither blocked that work. Both were
places where the format let a pack claim something and gave it nowhere to
say where the claim came from, and both were closed the day after.

~~**What a country puts on an invoice cites nothing.**~~ **Closed, 15 September
2026.** `documents.references` carries a `legal_reference` and a `source` per
rule — `numbering`, `payment_terms`, `tax_point` — and not one for the section,
because they are two or three different texts in every country the packs cover:
Belgium numbers an invoice under a royal decree of 1992 and counts a payment
term under a law of 2002, France numbers under an annex to the tax code and
counts under the commercial code. A single citation would have had to name them
all in one string, and then no rule would have had one. Six columns of
`country_defaults` hold the three pairs, beside the rule each belongs to, and
`cgi-annexe-2` is now named by the rule it was read for. `ekwo pack check`
refuses a declared rule that cites no article on a `reviewed` pack, warns about
one on any other, and refuses a key the register does not carry.

One thing the reading turned up and this change did not act on. The Luxembourg
pack declares `tax_point: invoice_date`, and the principle of the VAT law is
art. 21 — the tax falls due when the supply is made. The invoice date is the
derogation of art. 24, par. 1er, which applies where an invoice is obligatory
and only while it is issued within the legal delay; it does not cover a supply
with no invoicing obligation, nor a service the customer is liable for. The
reference written into the pack says exactly that rather than citing art. 24 as
if it were the rule, so nobody is misled — but the single-word column cannot
hold "the principle, except where a facture is due", and either a second value
of the vocabulary or an explicit note on the country model is the honest next
step.

~~**A legal reference the schema accepts and the compiler drops.**~~ **Closed,
15 September 2026**, for the half of it that was about e-invoicing.
`einvoicing.legal_reference` had been read by `pack.1.json` and written by all
four packs since the section existed — it is where the day an obligation starts
is justified, and where France writes out an emission calendar that depends on
the size of a company the core cannot yet hold — and the compiler dropped it on
the floor. `country_defaults.einvoice_legal_reference` and
`einvoice_source_key` now sit beside the profile and the date, written by the
same `update` so that a rule and the text imposing it cannot reach the database
by two routes and have one of them left behind.

What is left of the note is the other two: `charts[].legal_reference` compiles
and the `source` beside it does not, and a statement line carries both in the
pack and neither in the database. *Fix*: `source_key` on `chart_templates` and
`statement_line_templates`, the way the register added it to `tax_templates`
and `tax_report_box_templates`. *Until then*: `country_packs.sources` answers
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
