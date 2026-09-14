# `supabase/seed/` — reference data

Rows, not code. Everything here is plain SQL and safe to apply twice: the
currencies insert `on conflict do nothing`, and every row a country pack writes
upserts on its natural key, so re-applying a seed is how a correction reaches an
installation that already exists.

## What is here

| File | Content | Applied by default |
|---|---|---|
| `00_currencies.sql` | 11 ISO 4217 currencies — CAD, CHF, CZK, DKK, EUR, GBP, JPY, NOK, PLN, SEK, USD — with the number of decimals each is rounded at | yes |
| `05_framework_generic.sql` | **Generated from `packs/generic`.** Two country-less financial statements, `IFRS-SME-BS` and `IFRS-SME-IS`, whose rules are all account types: they fit any chart of any country, and they are the fallback for a chart that names no statement of its own | yes |
| `10_pack_be.sql` | **Generated from `packs/be`.** Two charts — the PCMN, 353 accounts, and an association chart of 349 — 6 journals, 22 taxes with their postings, the 31 boxes of `BE-VAT-PERIODIC`, the three abbreviated NBB schemes, the legal mentions, the account roles, and labels in Dutch, German and English | yes |
| `11_pack_fr.sql` | **Generated from `packs/fr`.** The PCG, 394 accounts, 6 journals, 24 taxes with their postings, the 22 lines of `FR-CA3`, the 2050 and 2052 statements, the legal mentions, the account roles, and labels in English | yes |
| `12_pack_lu.sql` | **Generated from `packs/lu`.** The plan comptable normalisé, 1 026 accounts, 6 journals, 35 taxes with their postings, the 156 fields of `LU-VAT-PERIODIC`, the two abridged eCDF schemes, the legal mentions, the account roles, and labels in German and English | yes |
| `13_pack_ee.sql` | **Generated from `packs/ee`.** An Estonian small-business chart of 120 accounts, 6 journals, 29 taxes with their postings, the 34 boxes of `EE-KMD`, the balance sheet and income statement scheme 1 of the annual report, the legal mentions, the account roles, and labels in English. **Its number is declared in the pack**, as `seed_index`, so that adding a country in the middle of the alphabet renames nobody | yes |
| `modules/assets/10_pack_be.sql`<br>`modules/assets/11_pack_fr.sql` | **Generated from `packs/<cc>/assets.json`.** The fixed-asset rules of one country: how it prorates a first period, whether its declining balance is capped, how it derecognises an asset, and the usual duration of each kind of asset | **no** — applied by the module migration runner |
| `90_demo_company.sql` | A fictional company, « Exemple Conseil SRL », with contacts, four catalogue products, posted documents, a matched payment and a bank statement | **no** — sample data only |

## The order they are applied in, and by whom

The six files applied by default are applied **in file-name order**, and the
order matters twice: the currencies exist before a pack names one, and the
generic framework exists before a chart falls back to it.

| Who | What it applies |
|---|---|
| `ekwo init` and `ekwo migrate` | the six default files, in order. `90_demo_company.sql` never, unless `--demo` or `ekwo demo` asks for it |
| `supabase db push` / `supabase start` | the same six: `config.toml` lists exactly them under `[db.seed].sql_paths` |
| by hand | `psql "$DATABASE_URL" -f supabase/seed/<file>` for each of the six, in order |
| `ekwo migrate` and `ekwo module migrate` | the files under `modules/`, and only for the modules that installation carries |

`modules/` is deliberately out of `config.toml`, and out of the flat read this
folder gets everywhere else. `assets.category_templates` exists only on an
installation that carries the `assets` module, and a seed applied where its
tables are missing is a seed nobody can re-run.

A test installs the release both ways — through the CLI's runner, and the way
`supabase db push` and `psql -f` do — and compares every row of every table
these files write. The two paths agree byte for byte, which is what lets the
documentation say they are interchangeable.

## Seven of these files are generated

`05_framework_generic.sql`, `10_pack_be.sql`, `11_pack_fr.sql`,
`12_pack_lu.sql`, `13_pack_ee.sql` and the two under `modules/assets/` are
build artefacts, like `docs/schema.md`.

**Do not edit them.** Change `packs/<cc>/` and run `ekwo pack build --all`.
`ekwo pack check --all` refuses a seed that is not the exact output of its
pack, and the CI runs it on every push, so an edit here is caught rather than
shipped. [`docs/packs.md`](../../docs/packs.md) is the pack format and the
whole list of what `check` refuses.

One thing to know while you work: each generated pack seed carries a sha256 of
every file of its pack, so changing **any** file under `packs/<cc>/` — including
one the compiler never reads — makes the committed seed stale. Build again and
commit the result.

The four files the packs replaced — `10_chart_be.sql`, `11_chart_fr.sql`,
`20_taxes_be.sql`, `21_taxes_fr.sql` — are kept in
`tests/fixtures/seeds-before-packs/`, where a test loads them into one database
and the generated pair into another and compares every template row.

## What the generated files fill

The *template* tables, and nothing that belongs to a company:
`chart_templates`, `account_templates`, `journal_templates`, `tax_templates`,
`tax_posting_templates`, `country_defaults`, `country_packs` and
`legal_mention_templates`; the two declaration-form tables,
`tax_report_templates` and `tax_report_box_templates`; and the three statement
tables, `statement_templates`, `statement_line_templates` and
`statement_line_rules`.

A company gets its own copy of the templates when
`install_country_template(company_id, 'BE')` runs — on the chart it names, or
the default one. The form and the statements are read where they are, because
neither a declaration form nor the scheme a national bank prints is something a
company customises.

Changing a pack changes what future companies receive. It does not touch a
company that already exists: `ekwo pack upgrade` is what moves one, and it
applies an addition and a closed validity by itself and lists everything else
for a person to decide.

## What to check before you rely on the tax files

A pack is a reading of the rules at a date; you are responsible for what you
file. See [DISCLAIMER.md](../../DISCLAIMER.md).

The boxes and the lines are a **working starting point, not a legal opinion**.
Every tax and every box names the text it comes from (`legal_reference`, a
required field), and each manifest carries a certification status — both packs
here are `maintained`, which means kept up to date by the maintainers and not
yet read by an accountant. Four mappings are known to want a professional's
eye:

- Belgium: credit notes on intra-community purchases (box 84 with 62 and 63).
- France: line 13 of the CA3 (the 2.1 % rate as a special rate).
- France: line 01 can come out negative when a quarter's credit notes exceed
  its sales, because it is derived from the taxable bases.
- France: line 08 does not tie to itself on an intra-Union acquisition, whose
  base goes to line 03 and whose tax goes to line 08.

The last two were found by the golden scenario on the day it shipped and are
written up in [`docs/decisions.md`](../../docs/decisions.md); they are reported
rather than patched away, because adjusting a golden until it passes is how a
bug gets recorded as a fact.

If you find a wrong box, change the posting in `packs/<cc>/taxes.json`, run
`ekwo pack build <cc>`, and add a test in `tests/reporting.test.ts` that pins
the corrected amount.

## Products in the demo, and none in the country files

The country files seed no product, and they never will: what a business sells is
not a country rule. The demo company carries four — a consulting day priced in
`DAY`, a workshop, a monthly support in `MON` and a printed brochure at the
reduced rate — because a product is worth seeing in use, and three of the demo
invoices are written from them. They are inserted `on conflict (company_id,
code) do nothing`, like everything else here.

## Adding a country

Not here: in `packs/<cc>/`, then `ekwo pack build <cc>`, then add the generated
file to `config.toml`. [`docs/packs.md`](../../docs/packs.md) walks through the
whole day, and `ekwo pack check` is what tells you whether you are still on the
path.
