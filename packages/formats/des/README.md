# `@ekwo-ai/des`

The French **DES** — *déclaration européenne de services* — in TypeScript, with
no dependencies.

Give it the rows of a recapitulative statement and it gives you the XML the
DGDDI accepts, a name for it, and the list of what could not be put in it.

```ts
import { generateDes } from '@ekwo-ai/des';

const { file, filename, violations } = generateDes(rows, {
  vatNumber: 'FRKK999999999',
  year: 2026,
  month: 8,
});
```

`StatementRow` is the row shape of the `ec_sales_list(company, from, to)`
function of [Ekwo OS](https://github.com/Ekwo-ai/ekwo-os), declared here so
that nothing is imported from it. Any book-keeping system that can produce
those columns can use this package; it reads no database and knows no
accounting.

## It is the services half, and only the services half

France splits the recapitulative statement in two. Services taxed where the
customer is are declared here. Supplies of goods go on the **état
récapitulatif TVA**, filed through DEBWEB2 in the INSTAT XML envelope, which is
a different format and is not in this package — see the end of this file for
why. A row of goods handed to `generateDes` comes back as a violation rather
than being written into a declaration that has no field for it.

## The specification this was written from

| What | Where |
|---|---|
| DES — description des échanges DTI+ en XML (DGDDI/DNSCE) | <https://www.douane.gouv.fr/sites/default/files/uploads/files/2020-10/ManuelDesXML.pdf> |
| Manuel utilisateur DES | <https://www.douane.gouv.fr/sites/default/files/uploads/files/2020-01/Manuel%20Utilisateur%20DES.pdf> |
| The administration's own page | <https://www.douane.gouv.fr/fiche/la-declaration-europeenne-de-services-des> |
| Rounding and the obligation itself | <https://bofip.impots.gouv.fr/bofip/979-PGP.html/identifiant=BOI-TVA-DECLA-20-20-40-20220216> |
| Filing calendar | <https://www.douane.gouv.fr/fiche/calendrier-des-declarations-relatives-letat-recapitulatif-tva-et-aux-des> |

Two things a reader should know about those documents:

- **No XSD is published for the DES.** The only schema on the portal is the one
  of DEBWEB2. The DES is described by a dictionary of tags and a table of
  checks, and the checks in that table are what this package applies.
- **The cahier des charges contradicts itself about the encoding.** Its
  conventions section prescribes ISO-8859-1 and its own complete example
  declares UTF-8. The file holds nothing but digits and the letters of a VAT
  number, so the two are the same bytes; this package writes UTF-8, which is
  the half of the document that was executed.

The specification has not been reissued since 2014. That is not an oversight
here: a targeted search of the portal found no later version.

## The checks, from the table in the cahier des charges

| Field | What it holds |
|---|---|
| `num_des` | 1 to 6 digits |
| `num_tvaFr` | Thirteen characters: `FR`, a two-character key, nine digits of SIREN |
| `mois_des` | `01` to `12` |
| `an_des` | Four digits, 2010 or later |
| `numlin_des` | Six digits, from 1 |
| `valeur` | A whole number, never zero, between −9 999 999 999 and 99 999 999 999 |
| `partner_des` | 4 to 14 characters, **country prefix included** |

**The tags must appear in that order**, which the document says in as many
words, and this package writes them in it.

**Amounts are whole euros**, rounded away from zero at the half: below 0,50 €
an amount is dropped, at 0,50 € or more it counts for one. **Negative values
are allowed** on the DES, unlike on the état récapitulatif of goods, and a
minoration is declared as one.

## What it refuses and what it reports

An exception, because it would make the whole file meaningless: a month outside
1 to 12, a year before 2010, a declaration number outside 1 to 999 999, or a
declarant number that is not the thirteen characters the specification fixes.

A violation, because one line is wrong and the rest of the file is not:

| `code` | Why |
|---|---|
| whatever the producer flagged | The row arrived with an `issue` on it |
| `not_a_service` | Goods or a triangular operation: the état récapitulatif TVA, not this file |
| `wrong_currency` | The DES is filed in euro and the line is not |
| `no_vat_number` | A line is identified by the customer's number and this one has none |
| `vat_country_is_the_declarant_country` | The customer is not in another Member State |
| `partner_length` | Fewer than four or more than fourteen characters, prefix included |
| `nil_value` | The value rounds to zero, which the format refuses |

## The file name

**The administration imposes none.** The manual describes a file picker and
nothing else: no convention, no extension beyond `.xml`, no size limit.
`desFileName` is a name of ours, and a caller is free to pick another.

## Why the état récapitulatif TVA on goods is not here

It is a real format with a published schema, and it was left out on purpose
rather than forgotten. Two things in it do not come from a set of books:

- **`envelopeId` is a habilitation number** issued by the collection centre to
  a declarant who asked for one. A file writer cannot invent it, and a package
  that took it as a parameter would be pretending the hard part is the XML.
- **An `Item` carries statistical fields** — the CN8 commodity code, the net
  mass, the mode of transport, the region — which an accounting core does not
  hold. The fiscal-only declaration, `declarationTypeCode` 4, needs fewer of
  them than the statistical one, but the published schema is shared with the
  statistical flow and is more permissive than the regulation, so what is truly
  required could not be settled from the documents alone.

Whoever picks it up will want the DEBWEB2 cahier des charges,
<https://www.douane.gouv.fr/sites/default/files/2022-02/15/DEB%20_Manuel_mode_DTI%2B_Xml_v1.3.8.pdf>,
and its schema,
<https://www.douane.gouv.fr/sites/default/files/2022-02/24/Sch%C3%A9maXSD.xsd>.
The six régime codes of the fiscal declaration — 10, 20, 21, 25, 26 and 31 —
are on <https://www.douane.gouv.fr/fiche/letat-recapitulatif-tva>.

## What else is out of scope

Filing. This package writes bytes; enregistrement on the portal is what makes a
DES a declaration, and it is the portal's business. Note that the deposit is a
**window** and not a deadline: a declaration may not be enregistrée before the
first day of the month following the period, nor after the tenth working day.

MIT.
