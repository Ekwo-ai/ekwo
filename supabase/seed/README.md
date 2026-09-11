# `supabase/seed/` — reference data

Rows, not code. Each file is plain SQL and idempotent (`on conflict do
nothing`), so applying it twice is harmless.

| File | Content | Applied by default |
|---|---|---|
| `00_currencies.sql` | 11 ISO 4217 currencies | yes |
| `10_chart_be.sql` | Belgian PCMN, 353 accounts (AR du 21 octobre 2018), 6 journals, default account roles | yes |
| `11_chart_fr.sql` | French PCG, 392 accounts (règlement ANC 2022-06), 6 journals, default account roles | yes |
| `20_taxes_be.sql` | 19 Belgian VAT codes and their postings: ledger accounts and Intervat boxes | yes |
| `21_taxes_fr.sql` | 17 French VAT codes and their postings: ledger accounts and CA3 lines | yes |
| `90_demo_company.sql` | A fictional company, « Exemple Conseil SRL », with contacts, four catalogue products, posted documents, a matched payment and a bank statement | **no** — sample data only |

`config.toml` lists the first five under `[db.seed].sql_paths`; the demo file
is deliberately left out. Load it by hand on a scratch project when you want
something to look at.

## What the chart files do

They fill the *template* tables (`account_templates`, `journal_templates`,
`tax_templates`, `tax_posting_templates`, `country_defaults`). A company gets
its own copy when `install_country_template(company_id, 'BE')` runs. Editing a
seed changes what future companies receive; it does not touch a company that
already exists.

## What to check before you rely on the tax files

The boxes and lines are a **working starting point, not a legal opinion**.
Two mappings in particular have not been reviewed by an accountant and are
flagged in the file headers:

- Belgium: credit notes on intra-community purchases (box 84 with 62 and 63).
- France: line 13 of the CA3 (the 2.1 % rate as a special rate).

If you find a wrong box, change the seed row and add a test in
`tests/reporting.test.ts` that pins the corrected amount.

## Products in the demo, and none in the country files

The chart files seed no product, and they never will: what a business sells is
not a country rule. The demo company carries four — a consulting day priced in
`DAY`, a workshop, a monthly support in `MON` and a printed brochure at the
reduced rate — because a product is worth seeing in use, and three of the demo
invoices are written from them. They are inserted `on conflict (company_id,
code) do nothing`, like everything else here.

## Adding a country

One chart file and one tax file, following the two existing pairs. The chart
must give every account one of the 18 `account_type` values, name the roles
in `country_defaults` (receivable, payable, suspense, retained earnings), and
every `tax_posting_templates.account_code` must exist in the chart — a test
checks for orphans.
