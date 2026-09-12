# Ekwo beyond Belgium and France

> The plan for making the core usable in any country, decided on
> 12 September 2026. The format of a country pack — the one taxonomy in this
> plan we will not get to redo — was decided the same day, before any code,
> and is written up in `decisions.md` with the full analysis in
> `decisions/`. This document is the map; that decision is the first step
> on it.

## The premise

A country is data, not code. Odoo ships one Python module per localisation;
Xero and QuickBooks ship one product per market. Ekwo ships **one core and
one versioned pack per country**, and a pack is something an accountant can
read, a contributor can propose in a pull request, and a test can prove.
Everything below follows from that.

Where the core stands today: 18 account types shared with Xero, QuickBooks
and Odoo; taxes and their declaration boxes as rows; EN 16931 fields as
columns; the French FEC; XBRL for the Belgian NBB; Factur-X; a REST API and an
MCP server; row level security everywhere. What it still is: Belgian and
French, with the country spread across a chart, a tax file, a defaults table
and a generator.

## What an international core needs and does not have

| Gap | Why it matters outside Belgium and France |
|---|---|
| No pack object | UK, US or Canada would each add a third place where a country lives |
| No year-end close, no shifted or 52/53-week years, no opening balances | UK years run April to March; US retail runs 52/53 weeks; every migration starts with an opening balance |
| Currencies without realised gains or revaluation | Mandatory the day a company invoices outside its functional currency |
| Accrual only | UK and US small businesses report on a cash basis; French VAT on services is due on collection; the UK has a cash accounting scheme |
| A tax engine that knows only EU VAT | GST with input credits (Canada, Australia, Singapore); stacked taxes on one line (GST + QST in Québec); non-recoverable sales tax (US, Canadian PST); withholding (Spain, Italy, Portugal); tax-inclusive pricing (UK, Australia retail) |
| No cash-flow statement, no audit log | Expected before tax compliance in the English-speaking world |

## Four phases

### Phase 0 — a complete, country-agnostic core (by the end of 2026)

The phase that decides everything. Nothing country-specific is added until
it is done. The format of the pack was decided on 12 September 2026 and is
written up in `decisions.md`; the twelve steps below are its execution order,
and they recut the first list in three places: opening balances come first
because they block adoption in Belgium and France; cash-basis VAT comes
before any new country because the French pack is wrong for services today;
the cash-flow statement, the revaluation of open items and several taxes on
one line wait for the countries that need them.

1. Pack format and compiler; Belgium and France extracted into `packs/`.
2. The pack migration: `country_packs`, `company_packs`, translated labels,
   seeds that upsert the template tables.
3. Declaration boxes as data, a generic `vat_return()`.
4. Financial statements as data, a generic statement by account type.
5. The generalised tax engine: kind, recoverability, jurisdiction,
   tax-inclusive prices, non-deductible VAT, rounding rules.
6. Cash-basis VAT and realised exchange differences.
7. Document rules, e-invoicing profiles and bank formats as data.
8. Opening balances and a parameterised year-end close.
9. Pack versioning, `ekwo pack upgrade`, an append-only audit log.
10. One golden test per pack, a certification status.
11. End-to-end test, including an upgrade from the published version.
12. Documentation: `docs/packs.md`, the contributor's guide.

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
  **before the United States**: closer to us, and a test of the tax model that
  the US does not offer. `report_code` on the postings and `region` on
  companies and contacts are in phase 0 so that this pack migrates nothing
  twice.
- **Netherlands, Germany, Luxembourg** — RGS, SKR03/04 with XRechnung, PCN.
- **United States** — a QuickBooks-style chart, the *shape* of sales tax in
  the core with rates and jurisdictions from a provider in the commercial
  layer, cash-basis reports, 1099 fields.
- **Formats** — Peppol PINT and UBL 2.1 as the universal invoice; OFX, BAI2,
  MT940 and camt.053 bank parsers as MIT libraries.

### Phase 2 — GST countries and southern Europe (mid-2027)

Australia and New Zealand (BAS), Singapore; Spain, Italy and Portugal
(withholding, FatturaPA, SII); consolidation across companies, which we need
ourselves; iXBRL accounts for Companies House.

### Phase 3 — the community makes the countries

A contribution kit for a pack with its golden test, a status page per
country, a "verified pack" label. Odoo's localisations are code; Ekwo's are
data, contributable without touching the core.

## Decisions taken with the plan

- **US sales tax is not in the core.** Tens of thousands of jurisdictions
  and their updates; the core models the shape, a provider supplies the
  rates, in the commercial layer. Xero and QuickBooks do the same.
- **Order: Europe, then the UK and Ireland, then Canada and Québec, then the
  Commonwealth, then the United States.** It is the order of proximity to our
  accounting model and to our customers, and the reverse of market size.
- **The pack comes before any new country.** Adding the UK on today's core
  would add a third dispersion. Phase 0 is first a taxonomy decision, and
  taxonomy is what we do not get to redo.

## Deliberately out of scope

Inventory, payroll, advanced fixed-asset regimes (MACRS), point of sale and
its certifications. A products table exists so that inventory can come later
as its own schema, as `decisions.md` describes.
