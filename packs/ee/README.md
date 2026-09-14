# Estonia

Everything Estonia adds to Ekwo, as data: a chart of accounts, the journals,
the VAT rates and where each one posts, the boxes of form KMD, the balance
sheet and the income statement of the annual report, and the sentences the law
puts on an invoice. The format is [`docs/packs.md`](../../docs/packs.md); this
file says where the content came from and which decisions it rests on, so that
an Estonian accountant reading the pack can disagree with a specific sentence
rather than with the whole of it.

**Status: `community`.** Nobody has reviewed it against the law they apply. The
figures are replayed against a year of books by `tests/golden.test.ts`, which
proves the pack is coherent and proves nothing about whether it is right.

## Sources

Every rate, box, mention and statement line carries its own `legal_reference`.
These are the texts the pack as a whole was built from.

| What | Text | Where |
|---|---|---|
| VAT rates, reverse charge, deduction limits, invoice particulars, the return | Käibemaksuseadus (KMS), consolidated | `riigiteataja.ee`, act 130122025021; official English translation 530122025010 |
| Form KMD and its completion instructions | Rahandusministri 10.06.2014 määrus nr 17 „Käibedeklaratsiooni vorm“, annex 1, in the wording of määrus nr 20 of 14.05.2025, in force 01.07.2025 | `riigiteataja.ee/aktilisa/1300/5202/5008/RAM_m17_lisa1.pdf`; the Tax and Customs Board publishes the same form, and an English edition, at `emta.ee` |
| Chart of accounts, internal rules, the statement schemes | Raamatupidamise seadus (RPS) § 8, § 11 and annexes 1 and 2 | `riigiteataja.ee`, act 110072025003; annex 1 in the wording of the Act of 18.09.2024, in force 01.07.2025 |
| How the schemes are presented | Raamatupidamise Toimkonna juhend RTJ 2, „Nõuded informatsiooni esitusviisile raamatupidamise aastaaruandes“ | `fin.ee`, and annex 2 to rahandusministri 22.12.2017 määrus nr 105 |
| E-invoicing | RPS § 7¹ (7), in force 01.07.2025 | `riigiteataja.ee`, same act |
| Payment term, late-payment interest, recovery costs | Võlaõigusseadus § 82¹, § 113 and § 113¹ | `riigiteataja.ee`, act 120062026018 |
| The ISO 6523 identifiers on an e-invoice | Peppol code list of participant identifier schemes: `0191` Company code, `9931` Estonia VAT number | `docs.peppol.eu/poacc/billing/3.0/codelist/eas/` |

Riigi Teataja is a single-page application and a plain fetch of an act's URL
returns an empty shell. The text is served at
`https://www.riigiteataja.ee/public-api/api/v1/akt/<id>/blob-html`, and the
official English translation at `.../api/v1/en/akt/<id>/blob-html`.

## The chart of accounts, and why this one

**Estonia prescribes no chart of accounts.** RPS § 8 obliges every accounting
entity to draw up its own, and § 11 obliges everyone but a micro-undertaking to
describe it in written internal rules. There is therefore nothing to copy from
a statute, and nothing that could be called *the* Estonian chart.

What exists is a convention that Estonian software and Estonian bookkeepers
share, and this chart follows it:

- **Four digits, four classes.** `1` assets, `2` liabilities **and equity
  together**, `3` income, `4` expenses. This is not the Belgian or the French
  shape: equity lives in class 2, and there is no separate class for it.
- **Flat.** No parent accounts. Estonian practice groups by the head of the
  code, and a two- or three-digit account is a summary line rather than a
  posting account. Every account here is a leaf, and the grouping is done by
  the `code_range` rules of `statements.json`.
- **Blocks that follow the statutory schemes.** Each range of codes maps onto
  one line of annex 1 or annex 2, so the balance sheet and the income statement
  are readable straight off the chart. That is the whole reason the ranges look
  as arbitrary as they do.

The chart is written for this pack. It is not a copy of any published chart;
the conventions above are, and the two widely published sample charts of
Estonian packages were read as evidence of what the convention is.

**One deliberate departure.** Estonian practice numbers input VAT inside the
class-2 VAT group, as a contra account of output VAT — `2310` output, `2311`
input. This pack keeps those codes, because that is what an Estonian bookkeeper
expects to see, but gives `2311` the account **type** `asset_current`, because
it is a claim on the tax authority and the account type is what the core reads:
`carries_forward`, the ageing, the country-less statements. Code by local
convention, type by what the account is. The balance sheet then splits both VAT
accounts by side — a debit balance is a prepaid tax, a credit balance is a tax
payable — which is the mechanism the core offers for exactly this.

## Taxes

A code is a rate at a date, and a new rate is a new code with a `valid_to` on
the old one. The pack therefore carries the standard rate three times:

| Rate | In force | Box on today's form |
|---|---|---|
| 20 % | 01.07.2009 – 31.12.2023 | 1¹ |
| 22 % | 01.01.2024 – 30.06.2025 | 1² |
| 24 % | from 01.07.2025 | 1 |

**The 24 % has no end date.** The reversion to 22 % on 1 January 2029 was
enacted by the Security Tax Act and then repealed with that Act, so a pack that
models a 2029 rate change models something that no longer exists.

The accommodation rate moved the other way: 9 % until 31.12.2024, 13 % from
01.01.2025, and the pack carries both. The press rate moved twice — 9 %, then
5 % from 01.08.2022, then 9 % again from 01.01.2025 — and the 5 % code is here
because a cash-accounting taxable person may still reach it through the
transitional rule of KMS § 46 (2⁷) until the end of 2026.

**The 50 % car restriction** is KMS § 30 (3), not § 30 (4): subsection 4 is the
list of exceptions, and subsection 7 is the two-year rule. It is 50 % of the
input VAT with no monetary cap, and it covers the car, its lease, and the goods
and services bought for it. The pack models it the way Belgium models its own:
a `tax` posting at 50 % onto the input VAT account, and a `tax_on_base` posting
at 50 % that lands the other half on the accounts of the lines it taxes,
because a share nobody gets back is part of what the thing cost.

## Form KMD

`tax_report.json` carries the form in force since 1 July 2025. Two things about
it are worth knowing before reading the file.

**The box identifiers are transliterated.** The form numbers its boxes with
superscripts and with dots, and the pack format allows only letters and digits.
So `1¹ 1² 2¹ 2² 4¹` are written `1a 1b 2a 2b 4a`, and `3.1 3.1.1 3.2 3.2.1 5.1
5.2 5.3 5.4 6.1 7.1` are written `31 311 32 321 51 52 53 54 61 71`. Every box
names its printed identifier in the first words of its `legal_reference`.

**Six boxes exist in the pack and not on the form**, marked `hidden`, and they
are there because the form nests and the format does not. A tax carries one
`base` posting per kind of document, so it can name one box; but the Estonian
form asks for the same amount in a box, in the memo box inside it, and
sometimes in a third one. The pack therefore posts to the innermost box and
rebuilds the printed parents as totals:

| Hidden box | Is the part of | That the form gives as |
|---|---|---|
| `1d` | box 1 | box 1 less the self-assessed acquisitions |
| `3s` | box 3.1 | 3.1 − 3.1.1 |
| `32e` | box 3.2 | 3.2 − 3.2.1 |
| `5g` | box 5 | 5 − 5.1 − 5.2 − 5.3 − 5.4 |
| `6s` | box 6 | 6 − 6.1 |
| `7f` | box 7 | the part of 7 that is not § 41¹ |

`ekwo pack check` and `vat_return()` both return them with the flag, so nothing
is lost; a filing brick reads the printed boxes and ignores the hidden ones.

**Box 4 is summed from the ledger, not computed.** The form derives it
arithmetically — 24 % of box 1, 9 % of box 2, and so on — and the pack format
has no expression language, deliberately. Summing the VAT the documents
actually posted is the closer figure anyway: each document's VAT is already
rounded, and a percentage of the period total can differ from the sum of the
documents by a cent or two.

**Boxes 6, 6.1, 7, 7.1 and 9 are informational**, in the instructions' own
words: their amounts are already inside box 1, or in box 9's case deliberately
outside it, and they feed no total. Box 9 is the trap worth naming — the
instructions say in as many words that a seller's § 41¹ turnover goes in box 9
and **not** in box 1.

**Boxes 10 and 11** are declared and nothing posts to them. They carry the
year-end recalculations of KMS § 32 and § 30 (7), which are a bookkeeper's
entry and not a consequence of a document.

## Closing the year

`closing_style` is `result_accounts`: the result of the year lands on
`2980 Aruandeaasta kasum (kahjum)`, a balance-sheet account, and stays there
until the shareholders decide what to do with it. That is what the statutory
balance sheet shows — `Eelmiste perioodide jaotamata kasum (kahjum)` and
`Aruandeaasta kasum (kahjum)` are two separate equity lines — and it is why the
style is not `retained_earnings`, which would merge them on the day of the
close.

**No tax provision is booked, and that is not an omission.** Estonia taxes
distributed profit, not earned profit, so a profitable year that distributes
nothing owes nothing. Corporate income tax on a distribution belongs to the
future `tax` module; the chart carries `4990 Tulumaks` and `2360
Tulumaksukohustis` so that a distribution can be booked by hand today.

Estonia keeps one account for both signs of the year's result, because the
balance sheet has one line for it. The core asks for a profit account and a
loss account, so the manifest names `2980` twice.

## What this pack does not carry

- **KMD INF**, the annex listing invoices of 1 000 euros or more per partner
  per period. It is a list of documents rather than a set of totals, and
  nothing in the pack format describes one.
- **The KMS § 44 cash-accounting scheme.** The core can express a tax that
  falls due on collection — France uses it — but the Estonian scheme applies to
  a whole taxable person rather than to a tax, and modelling it as a parallel
  set of tax codes would be a claim this pack cannot support.
- **The car counts of boxes 5.3 and 5.4.** The form asks for a number of cars
  beside each amount; a box of a declaration is a monetary amount here.
- **Earlier versions of form KMD.** A period ending before 1 July 2025 has no
  form in the pack, and `vat_return()` takes the form in force at the end of
  the period. The historical 20 % and 22 % codes are here for the documents and
  the credit notes, which the current form does have boxes for.
- **The fixed assets module.** There is no `assets.json`: the usual
  depreciation durations of Estonian practice come from guidance rather than
  from a text, and this pack cites texts.
- **The XBRL fact keys of the annual report.** See below.

## The annual report, and why the statements carry no fact keys

Annual reports are filed to the Estonian Business Register in XBRL, against the
`et-gaap` taxonomy published at `xbrl.eesti.ee` under EUPL. The taxonomy is
public and the primary statements in it are plain, non-dimensional concepts —
one element per line, named like `et-gaap:CashAndCashEquivalents`.

The pack leaves `xbrl` and `taxonomy` null on both statements anyway, because
the core's fact-key format cannot hold an Estonian key. It expects a key to be
a metric plus at least one dimension member, each part lower-case, as the
Belgian CBSO taxonomy is built; and it expects a taxonomy version to be a
dotted number, where the Estonian one is a date. Both are recorded in
[`docs/international.md`](../../docs/international.md) as gaps in the core,
with a proposed fix. A wrong key is worse than no key, so there are none here.

The line codes of `statements.json` follow the order of the statutory annexes,
so a future `xbrl-ee` brick has a stable thing to map from.

## Reviewing this pack

Open an issue titled "Review: Estonia". What a review is, and what it is not,
is in [`docs/packs.md`](../../docs/packs.md) under "Certification, and who may
say what". The points a reviewer is most likely to disagree with, and which the
author is least sure of, are the informational boxes, the box a service
received from outside the Union is declared in, the invoice mention chosen for
an intra-Community supply of services, and the treatment this pack gives such a
service in the tax model.
