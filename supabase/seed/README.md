# `supabase/seed/` — reference data

Rows, not code. Each file is plain SQL and idempotent (`on conflict do
nothing`), so applying it twice is harmless.

| File | Content | Applied by default |
|---|---|---|
| `00_currencies.sql` | 11 ISO 4217 currencies | yes |
| `05_framework_generic.sql` | **Generated from `packs/generic`.** The generic financial statements by account type: a balance sheet and an income statement that fit any chart of any country, and the fallback for a chart that declares none | yes |
| `10_pack_be.sql` | **Generated from `packs/be`.** Two charts — the PCMN, 353 accounts (AR du 21 octobre 2018), and an association chart of 349 — 6 journals, 19 VAT codes with their Intervat boxes, the NBB abbreviated schemes, default account roles | yes |
| `11_pack_fr.sql` | **Generated from `packs/fr`.** French PCG, 392 accounts (règlement ANC 2022-06), 6 journals, 17 VAT codes with their CA3 lines, the 2050-2053 liasse, default account roles | yes |
| `modules/<code>/*.sql` | **Generated from `packs/<cc>/<code>.json`.** The country data of one module — for `assets`, how a country prorates a first period, whether its declining balance is capped, how it derecognises an asset, and the usual durations of a kind of asset | **no** — applied by the module migration runner |
| `90_demo_company.sql` | A fictional company, « Exemple Conseil SRL », with contacts, four catalogue products, posted documents, a matched payment and a bank statement | **no** — sample data only |

`config.toml` lists the generated files and the currencies under `[db.seed].sql_paths`; the demo file
is deliberately left out. Load it by hand on a scratch project when you want
something to look at.

`modules/` is left out of that list too, and of the flat read this folder gets
everywhere else: `assets.category_templates` exists only on an installation
that carries the `assets` module, and a seed applied where its tables are
missing is a seed nobody can re-run. `ekwo migrate` and `ekwo module migrate`
apply them, for the modules they installed.

## Three of these files are generated

`05_framework_generic.sql`, `10_pack_be.sql` and `11_pack_fr.sql` are build artefacts, like
`docs/schema.md`. **Do not edit them**: change `packs/be` or `packs/fr` and run
`ekwo pack build --all`. `ekwo pack check --all` refuses a seed that is not the
exact output of its pack, and the CI runs it. The four files they replace —
`10_chart_be.sql`, `11_chart_fr.sql`, `20_taxes_be.sql`, `21_taxes_fr.sql` —
are kept in `tests/fixtures/seeds-before-packs/`, where a test loads them into
one database and the generated pair into another and compares every template
row.

## What the chart files do

They fill the *template* tables (`chart_templates`, `account_templates`,
`journal_templates`, `tax_templates`, `tax_posting_templates`,
`country_defaults`), the two declaration-form tables (`tax_report_templates`,
`tax_report_box_templates`) and the three statement tables
(`statement_templates`, `statement_line_templates`, `statement_line_rules`).
A company gets its own copy of the templates when
`install_country_template(company_id, 'BE')` runs — on the chart it names, or
the default one; the form and statement tables are read where they are,
because neither a declaration form nor the scheme the Banque nationale prints
is customisable. Changing
a pack changes what future companies receive; it does not touch a company that
already exists.

## What to check before you rely on the tax files

A pack is our reading of the rules at a date; you are responsible for what
you file. See [DISCLAIMER.md](../../DISCLAIMER.md).

The boxes and lines are a **working starting point, not a legal opinion**.
Each tax names the article it comes from (`legal_reference` in `taxes.json`)
and each manifest carries a certification status, but two mappings in
particular have not been read by an accountant:

- Belgium: credit notes on intra-community purchases (box 84 with 62 and 63).
- France: line 13 of the CA3 (the 2.1 % rate as a special rate).

If you find a wrong box, change the posting in `packs/<cc>/taxes.json`, run
`ekwo pack build <cc>`, and add a test in `tests/reporting.test.ts` that pins
the corrected amount.

## Products in the demo, and none in the country files

The chart files seed no product, and they never will: what a business sells is
not a country rule. The demo company carries four — a consulting day priced in
`DAY`, a workshop, a monthly support in `MON` and a printed brochure at the
reduced rate — because a product is worth seeing in use, and three of the demo
invoices are written from them. They are inserted `on conflict (company_id,
code) do nothing`, like everything else here.

## Adding a country

Not here: in `packs/<cc>/`, then `ekwo pack build <cc>` and add the generated
file to `config.toml`. The chart must give every account one of the 18
`account_type` values, the manifest must name the roles (receivable, payable,
suspense, retained earnings), and every account a tax posts to must exist in
the chart — the compiler refuses the pack otherwise, before any SQL is
written. `docs/packs.md` is the format.
