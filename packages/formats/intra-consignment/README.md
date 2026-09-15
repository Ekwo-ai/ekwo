# `@ekwo-ai/intra-consignment`

The Belgian **intra-Community sales listing** — the XML Intervat takes for
form 723 — in TypeScript, with no dependencies.

Give it the rows of a recapitulative statement and it gives you the file, a
name for it, and the list of what could not be put in it.

```ts
import { generateIntraConsignment } from '@ekwo-ai/intra-consignment';

const { file, filename, violations } = generateIntraConsignment(rows, {
  declarant: { vatNumber: '0999999999', name: 'Demo SRL', countryCode: 'BE' },
  period: { year: 2026, quarter: 3 },
});
```

`StatementRow` is the row shape of the `ec_sales_list(company, from, to)`
function of [Ekwo OS](https://github.com/Ekwo-ai/ekwo-os), declared here so
that nothing is imported from it. Any book-keeping system that can produce
those columns can use this package; it reads no database and knows no
accounting.

## The specification this was written from

| What | Where |
|---|---|
| The schema, `NewICO-in_v0_9.xsd` | <https://finances.belgium.be/sites/default/files/downloads/NewICO-in_v0_9.zip> |
| Its common types | <https://finances.belgium.be/sites/default/files/downloads/IntervatInputCommon_v0_9-20240703.zip> |
| Its ISO types | <https://finances.belgium.be/sites/default/files/downloads/IntervatIsoTypes_v0_9-20240806.zip> |
| Technical documentation, Intervat 14.x | <https://finances.belgium.be/fr/E-services/Intervat/documentation-technique> |
| Directives for form 723, ref. 723.2, edition 2024 | <https://finances.belgium.be/sites/default/files/downloads/165-723-directives-releve-intracommunautaire-2024.pdf> |
| How the listing is filed | <https://finances.belgium.be/fr/E-services/Intervat/comment-utiliser-intervat/deposer-releve-intracommunautaire> |

The output of this package was checked against that schema with `xmllint`
before it was committed. The schema is not shipped here — it belongs to the
administration and it moves — so the test suite proves the shape of the
document and not its validity; re-running the validation after a change to this
package is a minute of work and worth it.

Two traps that cost an afternoon, written down so they cost nobody else one:

- **Take the dated archives of the common and ISO types.** The undated URLs
  answer 200 and serve an older version, in which the declarant's number may
  not begin with a 1 — which refuses every enterprise number issued since.
- **The children of `Declarant` are in the `InputCommon` namespace**, not in
  the listing's own. `elementFormDefault` is `qualified` in both schemas, so
  the validator refuses a `Declarant` whose children carry the listing's
  namespace, and no published example makes that obvious.

## The three codes

From the directives, § 2.3.1.4 b: category I is `L` — exempt supplies of goods
— category II is `T`, the supply in the Member State of arrival under a
triangular operation, and category III is `S`, services taxed where the
customer is. The enumeration in the schema is exactly `{L, S, T}`; the `G` that
circulates in third-party documentation is refused by the validator.

The directives also say the three categories are never merged: a customer
supplied both goods and services appears twice, with the same number and two
codes. That is what the rows already are, and this package does not group them.

## What it refuses and what it reports

An exception, because it would make the whole file meaningless:

- a period that is neither one month nor one quarter;
- a declarant number the schema cannot hold — ten digits, the `BE` removed.

A violation, because one line is wrong and the rest of the file is not:

| `code` | Why |
|---|---|
| whatever the producer flagged | The row arrived with an `issue` on it: a customer with no VAT number recorded, or a number that is not in another Member State |
| `unknown_nature` | A nature other than goods, services or a triangular operation |
| `wrong_currency` | The listing is filed in euro and the line is not |
| `no_vat_number` | A client of the listing is identified by a number, and this line has none |
| `vat_country_is_the_declarant_country` | The schema's `MSCountryCodeExclBE`, said without naming a country |
| `vat_number_too_long` | More than twelve characters after the country prefix |
| `nil_balance` | The directives leave out a customer whose balance is 0,00 euro |

`AmountSum` is the total of the lines that were kept, so a file with violations
still balances against itself.

## The file name

**The administration imposes none.** Intervat takes a bare `.xml`; only the ZIP
archive that carries attachments has a fixed extension, `.ic` for this listing.
The `VATINTRA` prefix that circulates comes from accounting software and
appears nowhere in the published documentation. `intraConsignmentFileName` is
therefore a name of ours — stable and readable — and a caller is free to pick
another.

## What is out of scope, on purpose

- **Part 2 of the listing, call-off stock.** Since 1 January 2020 it is a
  separate electronic filing with a schema of its own, `cos-in_v1_0_0.xsd` and
  root `COSConsignment`. It reports movements of stock rather than supplies,
  and nothing in the rows this package reads describes one.
- **Corrections of an earlier period.** The schema carries them as an ordinary
  client line with a signed delta and a `CorrectingPeriod`; producing one means
  knowing what was filed before, which is a question for the books and not for
  a file writer.
- **Filing.** This package writes bytes. Uploading them, signing them and
  reading the acknowledgement are Intervat's business.

MIT.
