# `assets` — fixed assets, depreciation and disposal

One Postgres schema, `assets`. It depends on the socle by foreign key and
reaches the ledger only through `public.post_module_entry()`.

| Object | What it is |
|---|---|
| `assets.country_rules` | How one country prorates a first period, whether its declining balance is capped, and how it derecognises an asset. Pack data. |
| `assets.category_templates` | The usual duration, method and coefficient of a kind of asset, with the source it comes from. Pack data. |
| `assets.assets` | One fixed asset: what it cost, how it is depreciated, and the three accounts that carry it. |
| `assets.depreciation_lines` | The schedule, one row per period, with the entry that booked it. |
| `assets.disposals` | What leaving the books cost or earned. One row per asset. |

## The five functions

```sql
select assets.create_asset(
  company, 'IT-01', 'Laptop', date '2026-07-01', 3000,
  '241000',              -- the asset account
  '241900',              -- accumulated depreciation
  '630200',              -- the depreciation charge
  'it-equipment');       -- a category of the country pack, which fills in the rest

select assets.generate_schedule(asset);              -- rewrites the plan
select assets.run_depreciation(company, date '2026-12-31');
select assets.dispose_asset(asset, date '2028-01-15', 15000, '400000');
select * from assets.register(company, date '2026-12-31');
select * from assets.movements(company, date '2026-01-01', date '2026-12-31');
```

`assets.can_disable(company)` is the convention `disable_module()` reads: it
answers with a sentence while depreciation has been booked, and null otherwise.

## How a schedule is worked out

The periods are **twelve-month periods anchored on the financial year that
covers the day the asset entered service**. Where the company has declared the
year a period falls in, that year's own end date is used, so the schedule
follows the books; beyond the declared years it rolls twelve months at a time,
because a building bought this year is depreciated over twenty and nineteen of
those years have not been declared yet.

**Straight line.** The annuity is `(cost − residual) × 12 / duration_months`.
The first period is multiplied by the prorata the country declares.

**Declining balance.** `(net book value) × 12 / duration_months × coefficient`,
capped at `declining_cap_percent` of the acquisition value where the country
caps it, and replaced by the straight line over the **remaining periods** the
moment that is larger — which is what makes a declining schedule end at all. At
the last period the straight line is the whole remaining value.

**Units of production** is in the enum and refused by name: a schedule by
output needs the units of each period, which this module does not record.

**Rounding.** Every amount is rounded to the cent as it is computed and the
last line takes the remainder, so a schedule sums to exactly
`cost − residual_value`. A test asserts it on every asset of every test.

**Monthly.** `enable_module(company, 'assets', '{"period":"monthly"}')` splits
each annuity into the months of its period, the last month taking the
remainder. The annuity is computed first and cut afterwards, because an annuity
is what every country's rule is written in.

## Worked example, Belgium

A laptop of 3 000 €, three years, in service on 1 July 2026, on the Belgian
pack: the first annuity is prorated in real days, 184 of the 365 of 2026.

| Period | Amount | Accumulated | Net book value |
|---|---|---|---|
| 2026 | 504,11 | 504,11 | 2 495,89 |
| 2027 | 1 000,00 | 1 504,11 | 1 495,89 |
| 2028 | 1 000,00 | 2 504,11 | 495,89 |
| 2029 | 495,89 | 3 000,00 | 0,00 |

`run_depreciation(company, '2026-12-31')` books one entry: 504,11 debit on
630200, 504,11 credit on 241900, tagged `assets` / `depreciation:2026-12-31`.

## Worked example, France

A machine of 100 000 €, five years, declining balance at the 1,75 of article
39 A CGI — 35 % — acquired on 1 January 2026.

| Period | Declining | Straight line on what is left | Booked |
|---|---|---|---|
| 2026 | 35 000,00 | 20 000,00 | 35 000,00 |
| 2027 | 22 750,00 | 16 250,00 | 22 750,00 |
| 2028 | 14 787,50 | 14 083,33 | 14 787,50 |
| 2029 | 9 611,88 | 13 731,25 | **13 731,25** |
| 2030 | — | 13 731,25 | 13 731,25 |

## Disposals

A country derecognises an asset one of two ways, and neither is a variant of
the other. `assets.country_rules.disposal_style` says which, and the accounts
are roles of the chart, in `country_defaults`:

- **`net_result`** (Belgium) — clear the asset and its accumulated
  depreciation, book the proceeds, and put the difference on one account:
  `asset_disposal_gain` (763) or `asset_disposal_loss` (663).
- **`gross`** (France) — the same clearing, plus the net book value in full on
  `asset_disposal_value` (675) and the proceeds in full on
  `asset_disposal_proceeds` (775). The income statement prints both.

A disposal refuses while a period that has already ended is still unbooked:
run the depreciation first. What the schedule still planned after the disposal
date is deleted; what the ledger already knows is kept.

**The disposal books no VAT, and `proceeds` is stated net of it.** Selling a
fixed asset is a taxable supply in both countries, and the tax on it belongs on
a sales invoice — which the socle already knows how to post, with the right
tax, the right box and the right account. Booking a second VAT path inside a
module would be a second answer to a question `post_document` answers. So the
usual sequence is: issue the sales invoice for the sale, then dispose of the
asset against the same receivable, for the amount excluding tax.

## For an accountant to read

Four things here are our reading of the mechanics, and an accountant should
say whether they are right.

1. **A prorata in days counts the day of entry into service.** A Belgian asset
   in service on 1 July takes 184/365 and not 183/365; a French one on 15 April
   takes 256/360 and not 255/360. Both conventions are in use; this one makes a
   full year come to exactly 1, which the other does not.
2. **The declining balance measures what is left to run in periods, not in
   months.** At the start of the second year of a five-year asset, four
   annuities remain, whatever day of the first year it was bought on.
3. **Belgium prorates the first annuity for every company.** Article 196, § 2,
   1° CIR 92 obliges it for companies that are not small ones, and the core
   holds no "small company" column, so the pack declares the rule that binds
   everybody. A small company that takes the whole first annuity sets
   `prorata = 'none'` on the asset.
4. **The usual durations are administrative practice, not statute.** Each one
   names what it comes from; the Belgian ones cite article 61 CIR 92 and say
   so in as many words.

## Enabling it

```sh
ekwo module migrate assets          # its migrations and its country seeds
ekwo module enable assets --company "…"
```

Then add `assets` to the project's exposed schemas — Supabase dashboard →
Project Settings → API, or `[api] schemas` in `supabase/config.toml`. No
migration can do that: it is a setting of the API and not of the database.
