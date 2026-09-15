# United Kingdom

Everything the United Kingdom adds to Ekwo, as data: a chart of accounts, the
journals, the VAT rates and where each one posts, the nine boxes of the VAT
Return, the balance sheet and the profit and loss account of the small
companies regime, the usual lives of a fixed asset, and the sentences the law
puts on an invoice. The format is [`docs/packs.md`](../../docs/packs.md); this
file says where the content came from and which decisions it rests on, so that
a British accountant reading the pack can disagree with a specific sentence
rather than with the whole of it.

**Status: `community`.** Nobody who files a British return has reviewed it
against the law they apply. The figures are replayed against a year of books by
`tests/golden.test.ts`, which proves the pack is coherent and proves nothing
about whether it is right.

**This is the first pack of a country outside the European Union**, and that is
most of what is interesting about it. Four things the core could not say
precisely are written up in
[`docs/international.md`](../../docs/international.md) under "What the United
Kingdom showed". None of them was patched for this pack's sake: a gap the core
has is a core issue, and patching the core for one country is what the pack
format exists not to do.

## Sources

Every rate, box, mention, statement and asset category carries its own
`legal_reference`, and beside it the key of the text that article is in. The
register in `pack.json` holds thirty-two texts and every one of them was opened
on 15 September 2026. The ones the rest of this file leans on:

| What | Text | Where |
|---|---|---|
| The charge, the rates, zero-rating, exemption, the reverse charge on services from abroad, input tax | Value Added Tax Act 1994 | `legislation.gov.uk/ukpga/1994/23` |
| The return, the prescribed accounting period, the particulars of an invoice | Value Added Tax Regulations 1995 (S.I. 1995/2518), regs. 13 to 16 and 25 | `legislation.gov.uk/uksi/1995/2518` |
| Which amount goes in which of the nine boxes | How to fill in and submit your VAT Return (VAT Notice 700/12), HMRC | `gov.uk/guidance/how-to-fill-in-and-submit-your-vat-return-vat-notice-70012` |
| The construction reverse charge | VATA 1994 s. 55A and S.I. 2019/892, with HMRC's guidance | `legislation.gov.uk/uksi/2019/892` |
| Postponed VAT accounting | Complete your VAT Return to account for import VAT, HMRC | `gov.uk/guidance/complete-your-vat-return-to-account-for-import-vat` |
| Business entertainment | Value Added Tax (Input Tax) Order 1992 (S.I. 1992/3222), art. 5 | `legislation.gov.uk/uksi/1992/3222` |
| The form and content of the accounts | Companies Act 2006 s. 396; S.I. 2008/409 Schedule 1 for the small companies regime, S.I. 2008/410 Schedule 1 otherwise | `legislation.gov.uk` |
| The accounting standards behind them | FRS 102 and FRS 105, Financial Reporting Council | `frc.org.uk` |
| Payment terms and late payment | Late Payment of Commercial Debts (Interest) Act 1998, ss. 4, 5A and 6 | `legislation.gov.uk/ukpga/1998/20` |
| Rounding | VATREC12010 and VATREC12020, HMRC VAT Trader Records manual | `gov.uk/hmrc-internal-manuals/vat-trader-records` |
| Electronic invoicing | Promoting electronic invoicing across UK businesses and the public sector — consultation response, 26 November 2025 | `gov.uk` |

## The chart of accounts, and why this one

**The United Kingdom prescribes no chart of accounts.** Companies Act 2006,
s. 396 requires the accounts to comprise a balance sheet and a profit and loss
account complying with regulations as to their *form and content*, and those
regulations prescribe the **formats of the statements** — Schedule 1 to
S.I. 2008/409 for a small company, to S.I. 2008/410 for everyone else. Neither
says a word about a nominal ledger. There is therefore nothing to copy from a
statute, and nothing that could be called *the* British chart.

What exists is a convention that British bookkeeping packages and British
bookkeepers share, and this chart follows it:

- **Four digits, ten classes.** `0` fixed assets, `1` current assets, `2`
  creditors due within one year, `3` creditors due later, provisions, accruals
  and the capital and reserves, `4` turnover and other income, `5` cost of
  sales, `6` distribution costs, `7` administrative expenses, `8` finance costs
  and tax. It is the shape of a British nominal ledger and not of a continental
  chart of accounts: there is no class per statement caption and no legal code.
- **Flat.** No parent accounts. Every account is a leaf and the grouping is done
  by the `code_range` rules of `statements.json`, which is why the ranges look
  as arbitrary as they do: each block was cut so that it maps onto exactly one
  item of Balance Sheet Format 1 or of Profit and Loss Account Format 1.
- **Cost and accumulated depreciation are adjacent.** `0120` plant and
  machinery and `0121` its accumulated depreciation, so a single range reaches
  the net book value the format prints.

190 accounts, all of them postable. The chart is written for this pack and is
not a copy of any published one; the conventions above are.

**One thing to look at twice.** Input VAT (`1140`) reports as an *other debtor*
and output VAT (`2200`) as an *other creditor*, because Format 1 gives debtors
three items and creditors four and neither has a line of its own for tax. A
British balance sheet usually nets the two into one figure in the notes; this
pack keeps them apart in the ledger, which is what a VAT account under
VAT Notice 700/21 needs, and leaves the netting to whoever presents the
accounts. The `2210` VAT control account is there for that entry and nothing
posts to it automatically.

## Taxes

A code is a rate at a date, and a new rate is a new code with a `valid_to` on
the old one. The standard rate therefore appears four times:

| Rate | In force | Why it changed |
|---|---|---|
| 17.5 % | 1 September 1994 – 30 November 2008 | the rate when the Act itself came into force (s. 101(1)) |
| 15 % | 1 December 2008 – 31 December 2009 | S.I. 2008/3020, whose end date the Finance Act 2009, s. 9 moved from 30 November to 31 December 2009 |
| 17.5 % | 1 January 2010 – 3 January 2011 | the 2008 Order ceased and s. 2(1) applied again |
| 20 % | from 4 January 2011 | Finance (No. 2) Act 2010, s. 3 |

The temporary hospitality rates are here too — 5 % from 15 July 2020 under
S.I. 2020/728 as extended to 30 September 2021 by the Finance Act 2021, s. 92,
then 12.5 % to 31 March 2022 under s. 93 of the same Act — because a credit note
on a supply of that period has to find its rate.

**Zero-rated and exempt are two codes and not one.** On the return they are the
same box: VAT Notice 700/12 puts the value of both in box 6 and neither carries
output tax. In the ledger they are not the same thing at all, because only a
zero-rated supply carries a right to deduct the input tax attributable to it.
The pack keeps `GB-S-00` and `GB-S-EXEMPT` apart so that the distinction
survives into whatever computes a partial exemption; the pack itself computes
none.

**Four ways a British buyer taxes themselves**, and the return treats them
differently enough to be worth a table:

| Tax | Mechanism | Boxes |
|---|---|---|
| `GB-P-20-DRC-CIS`, `GB-P-05-DRC-CIS` | construction reverse charge, VATA s. 55A | 1, 4, 7 — and **not** 6 |
| `GB-P-20-PVA` | postponed VAT accounting on an import of goods | 1, 4, 7 |
| `GB-P-20-RCS` | service received from a supplier established abroad, VATA s. 8 | 1, 4, **6 and 7 at once** |
| `GB-P-20-ENT` | business entertainment: not a self-charge, a block | 7 only; the tax follows the account of the line |

The third is the one the pack format could not say directly, and the answer is
under "The return" below.

**No intra-Community tax, on either side.** Since 1 January 2021 a supply from
Great Britain to a member State is an export and an arrival from one is an
import, so `intracom_goods`, `intracom_services`, `intracom_triangular` and the
two acquisitions do not occur in this pack at all. The core carries the dates:
the `territories` table has `GB` inside the common system of VAT from 1 January
1973 to **31 December 2020**, which is the transition period of the Withdrawal
Agreement and not the day of withdrawal.

**Northern Ireland is deliberately out of scope.** The same table carries `XI`
as a territory of `GB`, in the common system for **goods only** since 1 January
2021 and identified under the `XI` prefix, with the article of the Windsor
Framework that says so — go there rather than to this README for what Northern
Ireland is. Boxes 2, 8 and 9 of the return are about that trade and nothing
else. They are declared here, because a form with six boxes would not be this
form, and nothing posts to them: a pack is keyed on a country and has no unit
below it, so carrying the Northern Ireland taxes would claim they apply to a
company in Manchester. What it would take is the last of the gaps in
[`docs/international.md`](../../docs/international.md).

**Business entertainment is a `tax_on_base` posting at 100 %.** Art. 5 of the
Input Tax Order excludes the whole of the tax from credit, and a share nobody
gets back is part of what the thing cost, so it lands on the account of the
line it taxes — `7330` in the golden year, which ends up holding 720 for a 600
invoice. The same shape, at 50 %, is how Belgium books a car.

## The return

`tax_report.json` is the VAT Return as it stands since 1 January 2021, when
boxes 2, 8 and 9 stopped being about the United Kingdom and became about
Northern Ireland alone. Four things about it are worth knowing before reading
the file.

**Box 5 is a subtraction, and a repayment comes out negative.** VAT Notice
700/12 says in as many words: deduct the number in box 4 from the number in
box 3 and enter the difference. The pack writes exactly that, so a repayment
period reports a negative box 5 where the printed form shows a positive figure
and a separate indication of which way it goes. In the golden year the third
quarter, which carries only a credit note, comes to −400.00.

**Three boxes exist in the pack and not on the form**, marked `hidden`:

| Hidden box | Is | Because |
|---|---|---|
| `6s` | the sales of the period | box 6 is a total of this and `67` |
| `7p` | the purchases of the period | box 7 is a total of this and `67` |
| `67` | the value of a service received from abroad | the notice asks for it in box 6 **and** in box 7 |

A tax writes one taxable amount to one box — the rule is in
[`docs/packs.md`](../../docs/packs.md), "A base is written once, and printed as
often as the form likes" — and the British form asks for one amount in two
printed boxes at the same time. Estonia met the same rule on a form whose boxes
*nest*; here they are siblings, which is a second shape of the same gap and is
recorded as such. `vat_return()` returns the hidden boxes with the flag, so
nothing is lost, and a filing brick reads the printed ones.

**Box 1 is summed from the ledger and not computed.** The form derives nothing,
and neither does the pack: what reaches box 1 is the output tax the documents
actually posted, each already rounded once, which is the closer figure to what
a VAT account under Notice 700/21 shows.

**Boxes 2, 8 and 9 are declared and empty**, for the Northern Ireland reason
above. Box 3 is the sum the notice states; boxes 6 and 7 are totals of the
hidden boxes; nothing else is derived.

**The cadence, and the one field this pack wanted and could not have.**
Regulation 25(1) of the VAT Regulations 1995 makes the prescribed accounting
period three months **for everybody**; a month is allowed on application and a
year under the annual accounting scheme. That is a default the law gives without
knowing anything about the company — the Estonian case, not the Belgian, French
or Luxembourg one, where the cadence follows turnover and the pack must say
nothing. So `defaults.vat_period` should read `quarter`.

It does not. The core judges a proposal by the number of cadences the **form**
accepts: a form filed on one has its cadence proposed, a form filed on several
proposes nothing, and `tests/tax_report.test.ts` holds that as an invariant over
every pack. The British form is filed on three and the British law still has a
default, which is a question the rule does not ask. A pack does not change a
test, so this one proposes nothing, `ekwo init` asks, and the gap is written up
in [`docs/international.md`](../../docs/international.md). A British company
that has asked HMRC for nothing files quarterly.

**Making Tax Digital is out of scope and is not a gap.** Every VAT-registered
business must keep its records digitally and file through functional compatible
software under the Value Added Tax (Amendment) Regulations 2018 (S.I. 2018/261),
which is why the portal entry of the register is where a return is filed and not
a form anybody types into. Submitting to HMRC's API is a format library and a
credential, not a pack: the boxes of a return are here and the envelope is not,
the same distinction Luxembourg draws with the eCDF file.

## The accounts

`statements.json` carries Balance Sheet Format 1 and Profit and Loss Account
Format 1 of Schedule 1 to S.I. 2008/409 — the **small companies regime**, which
is what the overwhelming majority of British companies file. Every line code is
the format's own letter or numeral and every name is the format's own wording.

Three decisions a reviewer should weigh.

**Items 15 to 18 do not exist.** The extraordinary items of the format as
originally made were removed when the formats were amended, so the numbering
runs 1 to 14 and then 19 and 20. The pack keeps the numbers the format keeps
rather than closing the gap, because a line 15 that meant item 19 would mislead
anybody holding the Schedule.

**Item F takes the whole of item J.** Note 5 to Section B puts the accruals and
deferred income *falling due within one year* into net current assets. Nothing
in the pack format splits a line by maturity, so the whole of item J is treated
as current and deducted at F, and not again below it. For a small company whose
accruals are current, which is the ordinary case, the figure is right; for one
carrying long-term deferred income it is not, and the fix is two accounts and
two lines rather than anything in the core.

**`NET` is not an item of Format 1.** The format ends on item K, and a British
balance sheet prints a net assets figure above the capital and reserves so a
reader can see the two agree. They agree only once the year is closed: until
then net assets exceed capital and reserves by exactly the profit of the income
statement. In the golden year both come to 22 330.00 and 0.00 respectively, and
the difference is the 22 330.00 of line 20.

**No fact keys.** Companies House takes small company accounts in iXBRL against
taxonomies the Financial Reporting Council publishes, and nothing here was
verified against one, so `xbrl` and `taxonomy` are null on both statements. A
wrong key is worse than no key.

## Closing the year

`closing_style` is `retained_earnings`: the result goes straight into `3400
Profit and loss account`, the reserve item K.V of the balance sheet. There is no
current-year result account on a British balance sheet — Format 1 has five items
under capital and reserves and none of them is "profit for the year" — so the
manifest names no `current_year_result_profit` and no
`current_year_result_loss`, which is what that style is for. A dividend is not
part of a close in any country: `3410 Dividends paid` sits beside the reserve
and is booked by hand.

**No tax provision is booked by the close either.** Corporation tax is an
expense of item 13 of the profit and loss account and a creditor of item E.4,
and it is a computation nobody can derive from the ledger. The chart carries
`8200` and `2280` so that it can be booked, and the pack computes nothing.

## Fixed assets

`assets.json` exists and is the part of this pack that is most plainly
**practice rather than law**. The United Kingdom has no legal or fiscal table of
useful lives: FRS 102, Section 17 asks an entity to estimate the life of its own
asset, and capital allowances are a tax computation that never touches the
accounting charge. Every category therefore cites FRS 102 and says, in the same
sentence, that the duration is common practice and not a rule. The two that are
more than practice are goodwill and other intangibles, where FRS 102 caps the
life at ten years when it cannot be reliably estimated.

Disposal is `net_result`: FRS 102 recognises the difference between the proceeds
and the carrying amount in profit or loss as one figure, and Format 1 has no
line for the two halves.

## On the invoice

`documents.mentions` carries four sentences and each cites the article that
requires it, and `documents.references` carries one citation per rule — the
numbering under reg. 14(1)(a) of the VAT Regulations 1995, the payment term
under s. 4 of the Late Payment of Commercial Debts (Interest) Act 1998, the tax
point under s. 6 of the VAT Act 1994. Three rules, three texts, which is why
that block takes one reference each and not one for the section. Two things to
look at.

**One sentence covers two reverse charges.** `applies_when` has a single
`reverse_charge` condition, and the United Kingdom has two mechanisms behind it:
s. 55A for construction services supplied here, and s. 8 for a service received
from a supplier established abroad. The pack prints one sentence and names both
articles in its legal reference. A country that needs two sentences cannot say
so, and that is already on the list in `docs/international.md`; the United
Kingdom is the first pack where the two articles genuinely differ.

**Numbering is `sequential`, not gapless.** Regulation 14(1)(a) requires "a
sequential number based on one or more series which uniquely identifies" the
document. It requires uniqueness and a series, not the absence of a hole, so the
pack does not claim gapless numbering. A retailer may issue a less detailed
invoice where the consideration does not exceed £250 (reg. 16), which is a
rendering decision and not a field of this format.

**The tax point is a derogation and says so.** Section 6 of the Act puts the
basic tax point at the removal of the goods or the performance of the service,
and s. 6(4) and (5) displace it to the invoice where one is issued within
fourteen days, or to an earlier payment. `invoice_date` is right for the
ordinary business-to-business case and is not the principle, which is written
into the reference so a reader is not left believing the pack read the wrong
article.

**Payment terms.** 30 days is the default of s. 4(2H) of the Late Payment of
Commercial Debts (Interest) Act 1998 where the parties agreed no payment day,
and s. 4(2E) is the 60-day ceiling on what two businesses may agree. The rate of
statutory interest is set by order under s. 6 and is deliberately not a number in
this pack; the fixed recovery sums of s. 5A — £40, £70 and £100 by band — are in
the reference, because they are in the Act.

## Rounding, and prices that include the tax

`rounding_method` is `half_up`, half away from zero at the two decimals of
sterling, applied once per tax group.

HMRC allows more than one method and the manual says so plainly. VATREC12010
records the concession of VAT Notice 700 §17.5 that lets an **invoice trader**
round the VAT payable *down*, because the rounding is tax-neutral between the
supplier's output tax and the customer's input tax. VATREC12020 says the same
concession is "not appropriate for retailers", for whom rounding down reduces
the tax accounted to HMRC without reducing the tax charged, and lists rounding
up and down to the nearest penny among what a retailer may do. `half_up` is
therefore the method that is right for a retailer and permitted for an invoice
trader, which is why the pack declares it; a company on the concession changes
one field.

**Prices that include the tax are the unfinished part of this pack.**
`GB-S-20-INC` carries `price_include: true`, which is true of every British
retail price, and the core has no gross-to-net computation: it adds the tax on
top of the price instead of taking one sixth out of it. The golden scenario
books such a sale on purpose, with a `why` that says so, so that the gap is
visible in a figure rather than only in a document. Until the core reads the
column, a British retailer enters net prices.

## What this pack does not carry

- **Northern Ireland.** No `XI` identification, no intra-Community tax, nothing
  in boxes 2, 8 and 9. The `territories` table of the core says what `XI` is and
  from when; this pack does not model it. See above.
- **Making Tax Digital submission.** The boxes are here; the API, the
  credentials and the digital-links obligations are not.
- **The VAT schemes.** Flat rate, cash accounting, annual accounting, margin
  schemes, retail schemes and the Tour Operators' Margin Scheme are each a
  regime of a whole taxable person rather than a property of a tax, and
  modelling one as a parallel set of codes would be a claim this pack cannot
  support. The core *can* express a tax that falls due on collection — France
  uses it — and the cash accounting scheme is still not that.
- **Partial exemption.** The pack keeps exempt supplies on their own codes so
  that a calculation is possible; it performs none, and there is no de minimis
  test anywhere in it.
- **The Construction Industry Scheme deduction.** `2230` is in the chart so a
  contractor can book the 20 % or 30 % withheld from a subcontractor, and the
  monthly CIS return is not a VAT return and has no form here.
- **Corporation tax, capital allowances and the CT600.**
- **The medium and large formats** of S.I. 2008/410, the Format 2 profit and
  loss account by nature, and the notes to the accounts.
- **iXBRL for Companies House.**

## Reviewing this pack

Open an issue titled "Review: United Kingdom". What a review is, and what it is
not, is in [`docs/packs.md`](../../docs/packs.md) under "Certification, and who
may say what".

Nine points a reviewer holding an ICAEW or ACCA practising certificate should
look at first, roughly in the order the author is least sure of them:

1. **The exemption reason code.** `GB-S-EXEMPT` and `GB-P-EXEMPT` carry
   `VATEX-GB-SCH9`, which **no published list contains**. `ekwo pack check`
   requires a VATEX code as soon as the category is `E`, the VATEX list carries
   articles of Directive 2006/112/EC and the national codes of Member States,
   and the United Kingdom is neither. The shape is one the check accepts for a
   national code; the code itself is this pack's invention and is the single
   thing in it most likely to be wrong. The gap is written up in
   `docs/international.md`.
2. **`VATEX-EU-G` on a British export.** The VATEX list names that code "Export
   outside the EU". A British export is a supply outside the *United Kingdom*,
   and a supply to a member State is one. The check requires `G` with that
   reason and nothing else; it is the least wrong pair available and it says
   something false about the destination.
3. **Which boxes each self-charge fills.** The four-row table above is read off
   VAT Notice 700/12 and HMRC's guidance for the construction charge and for
   postponed VAT accounting. That a construction purchase goes in box 7 and not
   box 6, while a service received from abroad goes in both 6 and 7, is the
   distinction most worth a second reading.
4. **Whether the installer should ask at all.** The pack proposes nothing and
   `ekwo init` asks, for the reason under "The return". A reviewer who reads
   reg. 25(1) as giving every British company a quarterly default would want
   the installer to stop asking, and that is an argument for the core and not
   for this pack.
5. **The reduced rate as one code.** Schedule 7A has many Groups, added at
   different dates, and the pack carries one 5 % code running from 11 May 2001,
   the day s. 29A was inserted. A supply falling under a Group added after that
   day is accepted by this code on dates when the Group did not yet exist. The
   pack carries the rate and not the list, and a reviewer who wants the Groups
   dated is asking for a code per Group.
6. **Item F and the whole of item J.** See "The accounts".
7. **The chart's mapping onto Format 1.** Every account reaches a line —
   `ekwo pack check` refuses a chart where one reaches none — and only the
   suspense account reaches two, as a debtor while it is in debit and a creditor
   while it is in credit. *Which* line is a judgement everywhere else,
   especially for the VAT accounts and for everything that falls into
   administrative expenses because Format 1 classifies by function.
8. **The fixed asset durations**, every one of which is practice and says so.
9. **The historical rates**, which matter only for a credit note on an old
   supply and which nobody has replayed.
