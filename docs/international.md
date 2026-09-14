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
server; row level security everywhere. The three file formats are MIT packages
under [`packages/formats/`](../packages/formats/), organised by format and
never by country.

**No function of the core holds a country code, and a test enforces it.**
Belgium and France are two directories under [`packs/`](../packs/) and two
compiled seeds, each carrying a year of books and the figures it produces. What
the core does not yet have is a third pack — which is the point of the phases
below, and the reason the format was settled before any of them.

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
| France | `packs/fr/` | `maintained` | — |
| Luxembourg | `packs/lu/` | `community` | the eCDF XML of a filing, the FAIA audit file, the annual VAT return, the special regimes, and corporate income tax |

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
- **Out of scope, on purpose.** Depositing the XML of an eCDF form, the FAIA
  audit file, the annual VAT return (a different form with fields of its own),
  the franchise and VAT-group regimes, the full unabridged schemes and their
  notes, and the `tax` module. The first of those is a format library and not a
  pack; the rest wait for somebody who files them.

## What Luxembourg showed the core could not say

A country pack is a test of the format as much as of the country. Four things
the Luxembourg pack had to work around, with what would fix each. **None is
implemented**: a gap the core has is a core issue, and patching the core for one
country is what this format exists not to do.

- **A company does not record which period it files on.** Luxembourg sets the
  cadence by turnover — annual up to 112 000 euros, quarterly to 620 000,
  monthly above — and nothing in the schema holds that answer. `vat_return()`
  takes two dates, which is right, but `ekwo status`, a reminder and any client
  that offers "file the current period" have to ask the user every time. *Fix: a
  `vat_period` column on `companies`, wired at install from a new default on
  `country_defaults` and changeable afterwards. The return itself would not read
  it; everything around the return would.*
- **A form's `period` cannot say "month, quarter or year".** The enum offers
  `month`, `quarter`, `month_or_quarter` and `year`, so a country filing one
  set of boxes on three cadences cannot declare it. Luxembourg escapes because
  its annual return really is a different form, and the pack declares
  `month_or_quarter` truthfully. *Fix: make `period` an array of the cadences
  the form accepts, defaulting to the one value a pack writes today.*
- **`sequence` on a declaration box means print order and evaluation order at
  once.** `ekwo pack check` refuses a total that names a total at the same
  sequence or later, from before `evaluate_totals()` learned to order by
  dependency. Every subtotal of the Luxembourg form prints *above* the boxes it
  adds, so the two meanings cannot both hold and the pack orders by dependency.
  *Fix: drop that rule from `pack check` — a cycle is already reported by name —
  or add a `print_sequence` and let the two be different questions.*
- **A statement line may be computed and carry a sign, and the sign is applied
  to the total.** A line with `plus` already adds figures that read the way the
  scheme prints them, so a sign there flips them a second time, silently. It
  cost a wrong set of golden figures here, caught by reading them. *Fix: refuse
  `sign` together with `plus` or `minus` in `ekwo pack check`, the way it
  already refuses a line that is both summed and computed.*

One restriction turned out to be worth keeping. **A tax takes one `base`
posting per kind of document**, and the Luxembourg return reports the taxable
amount of a sale twice — as turnover in section I, and in the rate breakdown of
section II. The pack expresses the second as a total computed from the first,
which is one definition instead of two and is the better shape. The walkthrough
in [`packs.md`](packs.md) should say so where a country meets it.

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
