# `@ekwo-ai/ecdf`

The Luxembourg **eCDF** interface file, version 2.0, in TypeScript, with no
dependencies — and the four forms it carries that are a recapitulative
statement of intra-Community supplies.

```ts
import { generateEcdf } from '@ekwo-ai/ecdf';

const { file, filename, declarations, violations } = generateEcdf(rows, {
  prefix: '000000',
  interfaceId: 'DEMO',
  agent: { matrNbr: '19999999999', rcsNbr: 'B999999', vatNbr: '99999999' },
  declarer: { matrNbr: '19999999999', rcsNbr: 'B999999', vatNbr: '99999999' },
  cadence: 'quarter',
  year: 2026,
  period: 3,
});
```

`StatementRow` is the row shape of the `ec_sales_list(company, from, to)`
function of [Ekwo OS](https://github.com/Ekwo-ai/ekwo-os), declared here so
that nothing is imported from it. Any book-keeping system that can produce
those columns can use this package; it reads no database and knows no
accounting.

## eCDF is an envelope, not a form

One XML file carries any number of declarations, each named by a `type` and
filled with fields identified by number. This package writes the envelope and
knows the four types that carry a statement:

| `type` | What it declares | Filed |
|---|---|---|
| `TVA_LICM` | Supplies of goods and triangular operations | Monthly |
| `TVA_LICT` | The same | Quarterly |
| `TVA_PSIM` | Supplies of services | Monthly |
| `TVA_PSIT` | The same | Quarterly |

**One call writes both forms** where the period carries both natures: goods and
services are separate filings in Luxembourg, and the envelope is made to hold
several. A nature with nothing in it produces no declaration, because eCDF
refuses a statement whose every table is empty — and `generateEcdf` says so in
a violation rather than handing back a file that will be rejected.

The field identifiers are the ones the forms print: state I of the goods form
is 01 country, 02 number, 03 amount, with 04 as its total; state II — the
triangular operations — is 05, 06, 07 with total 08; the services form uses 01,
02, 03 with total 04. Field 16 is the total of the corrections, written as zero
here because corrections are out of scope.

## The specification this was written from

| What | Where |
|---|---|
| The schema, `eCDF_file_v2.0-XML_schema.xsd` | <https://ecdf-developer.b2g.etat.lu/ecdf/formdocs/eCDF_file_v2.0-XML_documentation-01-EN.pdf> |
| Documentation of the XML file, v2.0, CTIE, 24 November 2022 | <https://ecdf-developer.b2g.etat.lu/ecdf/formdocs/eCDF_file_v2.0-XML_documentation-01-EN.pdf> |
| A complete example, with `TVA_LICM`, `TVA_LICT`, `TVA_PSIM` and `TVA_PSIT` | <https://ecdf.b2g.etat.lu/ecdf/formdocs/eCDF_XML_file_example-FR.pdf> |
| The blank forms and the filing rules, 2026 | `https://ecdf.b2g.etat.lu/ecdf/formdocs/2026/TVA_LICM/2026M1V001/` and the three siblings |

The schema itself is at
<https://ecdf-developer.b2g.etat.lu/ecdf/formdocs/eCDF_file_v2.0-XML_schema.xsd>.

The output of this package was checked against that schema with `xmllint`
before it was committed, with one caveat worth writing down: libxml2 cannot
evaluate the `[\P{Cc}]+` pattern the schema puts on every `TextField`, and
rejects `DE` against it. Replacing that one pattern with `.+` makes the file
validate. The schema is not shipped here — it belongs to the administration
and it moves.

Three things about it that an example does not show:

- **Tables come last.** Every simple field of a `FormData` is written before the
  first `Table`, and a file that interleaves them is refused.
- **`id="352"` is not `id="0352"`.** The identifier is a string, and a leading
  zero makes a different field.
- **There is no schema per form.** The XSD accepts any `id` under `FormData`;
  which identifiers a given `type` allows is checked by the server. The
  validation-rules document that would state each field's type formally sits
  behind authentication, so the field types here come from the published
  example and the printed forms.

## Amounts and numbers

**A comma, never a point** — not even as a thousands separator. Up to two
decimals, and a minus sign where a credit note has taken the line below zero.
Everything is in euro; the forms carry no currency field.

**The customer's country and number are two separate fields**, which is exactly
the shape the statement rows already have. Do not concatenate them. The
declarer's own VAT number is eight digits without `LU`, or `NE`.

## The file name

eCDF fixes it: the file on disk is called `<FileReference>.xml`, where the
reference is `<prefix>X<yyyymmdd>T<hhmmss><nn>` — the agent's six-character
eCDF prefix, an `X` for an XML file, the moment it was built, and two digits
that separate two files of the same second. A fresh reference is generated for
every file. `generateEcdf` returns both the name and the reference.

## What it refuses and what it reports

An exception, because it would make the whole file meaningless: a prefix that
is not six characters, a missing interface identifier, a `MatrNbr`, `VATNbr` or
`RCSNbr` the schema's own patterns reject, or a period that does not fit the
cadence.

A violation, because one line is wrong and the rest of the file is not:
whatever the producer flagged, `unknown_nature`, `wrong_currency`,
`no_vat_number`, `vat_number_is_the_declarer`, `nil_amount`, and
`nothing_to_declare` when no form came out at all.

## What is out of scope, on purpose

- **Corrections.** States III and V of the goods form and state II of the
  services form carry them, with the period being corrected and, on the goods
  side, a localised "Oui"/"Ja" in field 15. Producing one means knowing what
  was filed before, which is a question for the books.
- **Call-off stock**, states IV and V of the goods form. The published example
  predates them and the type of their boolean fields could not be read from any
  document available without an account, so nothing is guessed at here.
- **Filing.** `Interface` must hold an identifier the CTIE attributes after an
  access request and an interface validation. A file without one is refused.
  Writing valid XML is possible today; depositing it is not, until that
  agreement exists.

MIT.
