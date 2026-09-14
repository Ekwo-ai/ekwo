# `packs/lu/` — Luxembourg

A Luxembourg company keeps its books on one legal chart, files one periodic VAT
return and deposits two abridged schemes of annual accounts. All three are
published by the State, all three are transcribed here, and every file below
names the text it comes from.

`certification.status` is **`community`**: this pack was written from the
published sources and **no Luxembourg accountant has read it**. What that means
in practice is in [`../../DISCLAIMER.md`](../../DISCLAIMER.md), and the list of
points a reviewer should look at first is at the end of this file.

## The chart

`accounts.csv` is the **plan comptable normalisé (PCN)** in the version
annexed to the *règlement grand-ducal du 12 septembre 2019 déterminant le
contenu du plan comptable normalisé visé à l'article 12 du Code de commerce*
(Mémorial A n° 631 of 23 September 2019), which applies to financial years
beginning on or after 1 January 2020.

It is the **whole chart, at the depth the regulation prescribes**: 1 026
accounts over the seven classes, of which **747 are `comptes d'imputation`** —
the accounts a business posts to — and 279 are `comptes de regroupement`, which
aggregate and carry no entries. The regulation itself draws that line, in
article 7: *« Les entreprises ne peuvent renseigner leurs opérations qu'au sein
des comptes d'imputation. »* A grouping account is therefore a heading here,
with children and nothing posted to it.

**There is no abridged chart.** What Luxembourg abridges for a small company is
the *presentation* — the balance sheet and the profit and loss account, below —
and not the chart, which is one and the same for every undertaking subject to
article 75 of the amended law of 19 December 2002. A company that keeps its
day-to-day books on a chart of its own still reports the balances of the PCN at
the year end, which article 6 of the regulation allows and article 8 lets it
extend with accounts of its own beneath an imputation account.

Sources of the account names: French from the regulation itself; German and
English from the eCDF deposit form for the PCN, which the State publishes in the
three languages.

## The taxes

`taxes.json` carries the four rates of article 39, paragraph 3, of the
*loi modifiée du 12 février 1979 concernant la taxe sur la valeur ajoutée* —
17 % normal, 14 % intermediate, 8 % reduced, 3 % super-reduced — with the annex
that attaches each reduced rate to its goods and services: annex A for the
8 %, annex B for the 3 % and annex C for the 14 %, through article 40.

**The 2023 rates are here as history.** The law of 26 October 2022 (Mémorial A
n° 534) cut three of the four rates by two points for the year 2023 alone:
16 %, 13 % and 7 %; the super-reduced rate did not move. A document dated in
2023 therefore has its own tax codes, in force from 1 January to 31 December of
that year, and the periodic return carries its own boxes for them — the form
prints seven rate rows, not four. The codes without a year suffix are the ones
in force today.

Beyond the rates, the pack carries what a Luxembourg company books without
being anything but an ordinary taxable person: the intra-Union supply of goods
and of services, the export, the intra-Union acquisition of goods and of
services, the domestic reverse charge on both sides, and an exempt operation of
article 44.

**No partly deductible VAT.** Luxembourg prescribes no fixed share of
non-deductibility — no Belgian-style fifty per cent on a car, no French eighty
per cent on fuel. What restricts a deduction is article 49 (the input tax on an
exempt output is not deductible at all) and article 50 (a *prorata* computed
from the undertaking's own turnover, year by year). Neither is a number a
country pack can hold: the first is all of it, the second belongs to the
company. The two boxes the form provides for them — 094 and 095 — are declared
so that a future feature can fill them, and no tax of this pack posts to them.

**No cash accounting either.** Article 25 lets an undertaking below 500 000
euros of turnover ask to be taxed on what it collects. It is an option a
company exercises, not the general rule — the general rule is article 24, the
tax falls due when the invoice is issued — so v1 leaves it out. Adding it would
be a set of tax codes with `cash_basis` and a transition account, the way the
French pack carries the ordinary rule for services.

## The declaration

`tax_report.json` is the **eCDF periodic VAT return**, code `LU-VAT-PERIODIC`,
with the 156 numbered fields of its four sections and the totals its own
validation rules define. The monthly form (`TVA_DECM`) and the quarterly form
(`TVA_DECT`) carry **the same field numbers**, which is why one definition
covers both, and the manifest declares the period as `month_or_quarter`.

Which of the two an undertaking files follows its turnover: annual only up to
112 000 euros, quarterly from there to 620 000, monthly above. **The core has
no company-level parameter for that** — `vat_return()` is given two dates — so
the pack says what the form allows and the caller says which period it is
filing. The **annual return** (`TVA_DECA`, and the simplified `TVA_DECAS`) is a
different form with fields of its own and is not in this pack.

One field is computed rather than summed, and it is worth knowing why. The
Luxembourg form reports the taxable amount of a sale **twice** — once as
turnover in section I and once in the rate breakdown of section II — and a tax
of a pack takes one `base` posting per kind of document. Field **472**, *Autres
ventes / recettes*, is therefore a total of the rate boxes and the exemption
boxes rather than a box the postings fill. The figures come out the same and
there is one definition instead of two; the cost is that the boxes of section I
are ordered by what they depend on rather than by where they print.

## The financial statements

`statements.json` carries the two abridged schemes a small undertaking deposits:

| Code | Is |
|---|---|
| `LU-ECDF-BS-ABR` | *Bilan abrégé* — annex II of the *règlement grand-ducal du 18 décembre 2015*, eCDF form `CA_BILANABR` |
| `LU-ECDF-PL-ABR` | *Compte de profits et pertes abrégé* — annex IV of the same regulation, eCDF form `CA_COMPPABR` |

**Every line is keyed by the eCDF field identifier of the current-year column** —
`203` for the debtors falling due within one year, `651` for the gross result —
so a filing brick that writes the XML of either form maps a line to a field
without a table in between. The totals are the ones the form's own validation
rules state: field 201 is 101 + 107 + 109 + 151 + 199, field 667 is the sum of
the eleven lines above it, and so on.

**The mapping is the State's own, account by account.** The same annex that
publishes the chart publishes the *tableau de passage* — which item of the
abridged balance sheet or of the abridged profit and loss account each account
reports in. All 747 imputation accounts are mapped, each to exactly one line,
by an `account_code` rule naming the code. A range would have been shorter and
would have been an inference; this is a transcription, and a reviewer checking
one account finds one line.

Every line of the profit and loss account reads credit minus debit, because the
form takes a charge as a negative figure and **adds** every line — field 667 is
the sum of the eleven above it, charges included, which the validation rules
state in those terms.

## The close

`closing_style` is `result_accounts`: the result of the year lands on account
**142, *Résultat de l'exercice***, which the abridged balance sheet prints on
its own line (field 321) and which stays there until a general meeting
allocates it. That is the Luxembourg scheme, and it is France's rather than
Belgium's — the abridged profit and loss account ends on *18. Résultat de
l'exercice* and has no appropriation section.

Luxembourg keeps **one** account for the result of the year, whichever sign it
has, so `current_year_result_profit` and `current_year_result_loss` both name
142. Belgium and France keep two.

## The invoice

Article 63, paragraph 8, of the VAT law lists what an invoice carries, and the
mentions of `pack.json` are the sentences it requires: *Autoliquidation* where
the customer is liable (point 14°), the reference to the provision that exempts
(point 13°), *Comptabilité de caisse* where the tax falls due on collection
(point 8°). Numbering follows point 2° — *« un numéro séquentiel, basé sur une
ou plusieurs séries, qui identifie la facture de façon unique »*.

Electronic invoicing is Peppol and EN 16931. Public bodies have received
electronic invoices since 18 May 2019; the obligation to **send** them reached
large undertakings on 18 May 2022, medium ones on 18 October 2022 and small and
new ones on 18 March 2023, which is the date the manifest carries because it is
the one from which the obligation no longer depends on a size the core cannot
hold.

## The golden scenario

`golden/scenario.json` is a year of a Luxembourg trading company filing
quarterly: the four positive rates, a credit note, an intra-Union supply, an
export, an intra-Union acquisition of goods and one of services, two matched
payments and one on account. The three files beside it are what the engine
makes of that year, to the cent, and they are generated —
`UPDATE_GOLDEN=1 npm test -- tests/golden.test.ts`.

The balance sheet of that year does not balance, and that is not a defect: the
result of an open financial year is not on the balance sheet until
`close_fiscal_year()` puts it there, so the assets exceed the liabilities by
exactly the result of the profit and loss account — 16 300 euros here.

## What a Luxembourg reviewer should look at first

Ten points where the reading could go another way. None is a known error; each
is a place where the text allows more than one answer, or where no text was
found.

1. **Numbering.** Article 63, paragraph 8, point 2°, asks for a *sequential*
   number unique to the invoice, based on one or several series. It does not
   say in so many words that the sequence may not have a hole. The pack
   declares `gapless_per_year`; `sequential` would also be defensible.
2. **The payment term.** 30 days and the interest of the amended law of
   18 April 2004 — the ECB rate plus eight points, and the fixed 40 euros. The
   article numbers cited should be checked against the consolidated text.
3. **The Peppol party scheme.** ICD 9938 is the Luxembourg VAT number, and it is
   the scheme declared. An operator addressed by its eleven-digit *matricule*
   uses another scheme, which the format holds only one of.
4. **The account roles.** Receivable 4011, payable 44111, suspense 484,
   rounding 6488, exchange gain 7562 and loss 6562, retained earnings 1412 —
   rather than 1411, *Résultats reportés en instance d'affectation*, which is
   where the result sits between the close and the meeting.
5. **The account types.** Each of the 1 026 accounts carries one of the
   eighteen types of the core, derived from the side of the *tableau de
   passage* it reports on. The third-party accounts are narrower: only the
   customer and supplier balances are receivable or payable.
6. **The domestic reverse charge.** Article 61, paragraphs 2 and 3, is narrow
   in Luxembourg — emission allowances, gas and electricity certificates, and
   the supplies of article 18, paragraph 4. The pack offers a code for it on
   both sides; whether it is worth offering at all is a question for somebody
   who meets it.
7. **Section F of the return carries no 16 % row**, where section E.3 does. A
   domestic reverse charge on goods in 2023 therefore has no box at the rate of
   that year. The pack routes its reverse-charge purchase through section E.3,
   which has both rates.
8. **The free-rate rows of section II.A** — fields 033/042, 416/417 and
   451/452, where a declarant types a rate of its own — are not declared, and
   the totals 037 and 046 therefore cover the seven statutory rates only.
9. **Article 25**, the taxation on collection, and **article 50**, the
   *prorata*, are both out of v1. Both are options or company parameters rather
   than country rules; both are expressible if a reviewer says they belong.
10. **The German and the English labels** are the versions the State itself
    publishes, on the eCDF forms. They are not a translation made here, and
    where the French and the German of a form differ, the French is the
    reference — `i18n/README.md` says so at length.
