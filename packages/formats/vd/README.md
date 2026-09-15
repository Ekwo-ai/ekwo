# `@ekwo-ai/vd`

The Estonian **form VD** — *ühendusesisese käibe aruanne*, the report of
intra-Community turnover — in TypeScript, with no dependencies.

Give it the rows of a recapitulative statement and it gives you the XML the
e-MTA loads, a name for it, and the list of what could not be put in it.

```ts
import { generateVd } from '@ekwo-ai/vd';

const { file, filename, violations } = generateVd(rows, {
  registryCode: '19999999',
  year: 2026,
  month: 2,
});
```

`StatementRow` is the row shape of the `ec_sales_list(company, from, to)`
function of [Ekwo OS](https://github.com/Ekwo-ai/ekwo-os), declared here so
that nothing is imported from it. Any book-keeping system that can produce
those columns can use this package; it reads no database and knows no
accounting.

## One line per acquirer, not one per nature

This is the thing to know before anything else. Form VD prints one row per
customer with three amount columns beside it, so an acquirer who was supplied
goods and services appears **once**, with two amounts. The instructions say it
in as many words: *not a single VAT identification number shall recur in the
column*, and the loader rejects a duplicate by row number.

Every other recapitulative statement in Europe does the opposite — the Belgian
listing prints the same number three times with three operation codes. So this
package merges the rows it is given, and a package for another format must not.

| Column | What it holds | Element |
|---|---|---|
| 1 | Country code of the acquirer | `riik`, an attribute of `kmkrKood` |
| 2 | VAT number, **without the country prefix** | the text of `kmkrKood` |
| 3 | Taxable value of the goods | `kaup` |
| 4 | Value of triangular transactions | `kolmnurktehing` |
| 5 | Taxable value of the services | `teenusteMyyk` |

A row carries at least one of the three amounts, which this package enforces by
leaving out an acquirer whose every amount rounds to nothing, and saying so.

## The specification this was written from

| What | Where |
|---|---|
| The technical section that carries them all | <https://www.emta.ee/ariklient/e-teenused-koolitused/e-teenuste-kasutamine/teenuste-tehniline-info#vd-aruanne> |
| The schema, served with an `.xml` extension | <https://www.emta.ee/sites/default/files/documents/2021-06/vorm_vd_xsd_2011.xml> |
| Description of the XML file | <https://www.emta.ee/sites/default/files/documents/2021-06/vorm_vd_xml_kirjeldus_2011%281%29.rtf> |
| A complete example | <https://www.emta.ee/sites/default/files/documents/2023-04/vorm_vd_xml_2011.xml> |
| The error messages the loader gives | <https://www.emta.ee/sites/default/files/documents/2023-01/vd_vdp_veateated_12012023.xlsx> |
| The regulation behind the form, consolidated | <https://www.riigiteataja.ee/akt/107012021006> |

The output of this package was checked against that schema with `xmllint`
before it was committed. The schema is not shipped here — it belongs to the
administration and it moves — so the test suite proves the shape of the
document and not its validity.

Two things worth knowing about those documents:

- **The specification is only on the Estonian page.** The English technical
  page carries no VD section at all; its VAT page points at the KMD instead.
- **`elementFormDefault` is `unqualified`**, so only the root carries the
  namespace prefix and its children are bare. The published example shows it,
  and this package writes it that way.

## Amounts

**Whole euros**, rounded away from zero at the half, with no decimals and no
separator — the form says `täiseurodes` under each column, the schema types the
three as `xs:integer`, and the loader refuses `1.5` by name. **Negative values
are allowed**: a cancelled invoice or a credit note is reported on form VD for
the period of the credit note, with a minus sign.

## What it refuses and what it reports

An exception, because it would make the whole file meaningless: a month outside
1 to 12, or a registry code longer than the eleven characters the schema holds.

A violation, because one line is wrong and the rest of the file is not:
whatever the producer flagged, `unknown_nature`, `wrong_currency`,
`no_vat_number`, `country_code_length`, `vat_number_is_the_declarer`,
`vat_number_shape` — the schema allows twelve characters of letters, digits,
`+` and `*` — and `nil_amounts`.

The loader also validates the structure of each number against the Member State
it claims, which this package does not: the table of per-country shapes is
published with the form and belongs to whoever wants that check, not to a file
writer that would then hold a list of Member States.

## The file name

**The administration imposes none.** The technical description prescribes no
convention: the e-MTA checks the header of the file — declarer code, year,
month — against the report it is being loaded into, and nothing else.
`vdFileName` is a name of ours, and a caller is free to pick another.

## Two things about loading it

- **A load replaces everything already in the report**, whether it was loaded
  before or typed in, and only works on a report that has not been confirmed.
- **There is no nil report.** Where there was no intra-Community supply, form VD
  is not filed at all.

## What is out of scope, on purpose

- **Form VDP, the corrections.** It exists, it is described, and it has **no
  file format**: the e-MTA offers loading from a file for VD and only manual
  entry for VDP. Nothing here can be written against a specification that does
  not exist.
- **Call-off stock**, column 6 of the form. It is a separate schema with its own
  namespace, `VD_NV_toimingud`, and it reports movements of stock rather than
  supplies.
- **Filing.** This package writes bytes; the e-MTA screen is what turns them
  into a report, and confirming it is irreversible.

MIT.
