# Sources

Everything this library asserts about the Belgian annual accounts is taken from
the taxonomy the National Bank of Belgium publishes, and can be re-derived from
it. Nothing here is copied from a third-party mapping.

## The taxonomy package

- Page: <https://www.nbb.be/en/central-balance-sheet-office/drawing-and-filing/technical-information-and-taxonomy/taxonomy>
- Package used: `nbb-cbso-26.0.15.zip`, downloaded from that page
  (<https://www.nbb.be/doc/ba/xbrl/taxo2026/nbb-cbso-26.0.15.zip>), together
  with its technical guide and changelog.
- The page states that the final version of the taxonomy has been in use by the
  Central Balance Sheet Office **since 2 January 2026**.

`src/taxonomy/cbso-26-m01-f.ts` is generated from that package:

```sh
node scripts/build-taxonomy.mjs --package ~/nbb-cbso-26.0.15
node scripts/build-taxonomy.mjs --package ~/nbb-cbso-26.0.15 --check   # CI-style check
```

The package is not vendored: it weighs about 60 MB, most of it validation rules
this library does not read.

## Framework 25.0 → 26.0

The package ships several frameworks side by side (`fws/19.5`, `fws/23.0`,
`fws/25.0`, `fws/26.0`). Two things follow from its `changelog.txt`:

- Every entry between 26.0.0 and 26.0.15 concerns models this library does not
  generate — `m90-f` (country-by-country report), `m06-p`, `m200-f` — or the
  postal-code labels: *"pcd-label.xml: implementation of municipalities mergers
  applicable since 01/01/2025"* (26.0.9 to 26.0.11).
- **The abridged model `m01-f` did not change between 25.0 and 26.0.** Running
  the generator against `fws/25.0` and against `fws/26.0` yields the same 430
  facts, member for member.

So the bump to 26.0 changes the `link:schemaRef` and the enumeration namespaces
and nothing else in what a filing carries. It matters because 26.0 is the
framework in use, and because the postal-code enumeration this library uses to
encode an address (`pcd:mXXXX`) follows the municipality mergers of 1 January
2025 in 26.0.9 and later.

## How a reporting code becomes a fact

The premise that the taxonomy has one element per reporting code is false. It is
dimensional: about ten generic metrics (`met:am1` an amount, `met:am2` an amount
that may be negative, `met:dec1` a decimal, `met:int4` a count, `met:str2` a
string, `met:dte1` a date), and the reporting code is the set of explicit
dimension members of the context.

The model `fws/26.0/mod/m01/m01-f.xsd` groups sections; each section is a table
(`fws/26.0/sect/s.*-rend.xml`) whose rows and columns are rule nodes carrying
dimension members, and whose rows carry the reporting code in a label of role
`http://www.nbb.be/fr/xbrl/rub` (`fws/26.0/sect/s.*-lab.xml`). One cell — row
members plus column members — is one fact. That is exactly what
`scripts/build-taxonomy.mjs` reads.

Two details the generator has to get right:

- **The previous-year column is a dimension, not a period.** Both columns are
  reported in a context whose period is the closing date of the current
  financial year; `dim:prd` (`prd:m1` / `prd:m2`) says which column.
- **The movement tables of the annexes are laid out diagonally.** A row carrying
  `aln:m1` ("Diagonal") belongs to the previous-year column, which is the one
  carrying `rut:m1` ("Rubrique de l'exercice précédent"). Crossing every row
  with every column without that rule invents cells that do not exist.

## The rubrics that were wrong

The following were filed under each other's fact before this branch. Each line
cites the domain labels that settle it — `dict/dom/<domain>-label.xml` in the
package — and the section table the pairing comes from.

| Code | Label | Fact | Source |
| --- | --- | --- | --- |
| `22/27` | Immobilisations corporelles | `met:am1` + `bas:m2` + `ntr:m2` + `part:m1` | `bas:m2` = "Fixed assets / Actifs immobilisés", `ntr:m2` = "Tangible / Corporel" |
| `24` | Mobilier et matériel roulant | `met:am1` + `bas:m5` + `ntr:m2` + `part:m1` | `bas:m5` = "Furniture and vehicles / Mobilier et matériel roulant" |
| `20/58` | TOTAL DE L'ACTIF | `met:am1` + `bas:m25` + `part:m1` | `part:m1` is the assets side, `part:m3` the liabilities side (`s.03.01.0.cdefhi`, `s.03.02.0.c`) |
| `10/49` | TOTAL DU PASSIF | `met:am1` + `bas:m25` + `part:m3` | idem |
| `10/11` | Apport | `met:am1` + `bas:m38` + `ntr:m4` + `part:m3` | `bas:m38` = "Contribution / Apport" |
| `10` | Capital | `met:am1` + `bas:m39` + `ntr:m4` + `part:m3` | `bas:m39` = "Capital" |
| `44` | Dettes commerciales | `met:am1` + `bas:m50` + `rst:m2` + `typ:m3` + `part:m3` | `440/4` "Fournisseurs" is the same fact plus `spec:m3` (`s.03.02.0.c`) |
| `62` | Rémunérations, charges sociales et pensions | `met:am2` + `bas:m1` + `ntr:m7` + `part:m4` | `ntr:m7` = "Personnel / De personnel" (`s.04.00.0.cd`) |
| `65/66B` | Charges financières | `met:am2` + `bas:m1` + `ntr:m3` + `part:m4` | the recurring part `65` is the same fact plus `typ:m8` |
| `29` | Créances à plus d'un an | `met:am1` + `bas:m9` + `rst:m1` + `part:m1` | `bas:m9` = "Amounts receivable / Créances", `rst:m1` more than one year |
| `66A` | Charges d'exploitation non récurrentes | `met:am2` + `bas:m1` + `ntr:m6` + `typ:m7` + `part:m4` | `s.04.00.0.cd` |
| `9906` | Bénéfice (Perte) à affecter | `met:am2` + `bas:m44` + `part:m5` + `sts:m11` | `s.05.00.0.cdef`, where `14P` is a line of its own on `bas:m61` |
| `14` | Bénéfice (Perte) à reporter | `met:am2` + `bas:m44` + `ntr:m4` + `part:m3` + `sts:m8` | idem |
| `8179` / `8309` | Cessions et désaffectations / Annulés | `bkd:m4`+`mdp:m8` / `bkd:m1`+`mdp:m12` | `s.06.01.2.cdef` |
| `1051`…`1203` | Social balance sheet rows | one `wrg` member per column | `s.12.00.0.cd`, rows labelled `1051-1052-1053` |

`test/rubrics.test.ts` pins each of them.

## Still to be confirmed by someone who files

This library generates a file; it does not file it. Nobody has yet imported a
26.0 instance produced from this branch into the Filing application
(`filing.cbso.nbb.be`) and seen it accepted. In particular:

- whether Filing still accepts an instance whose `schemaRef` points at
  framework 25.0, for a financial year closed before the 26.0 switch;
- whether the identification section, which is carried over from a filing
  accepted under an earlier framework rather than generated, still matches;
- the arithmetic rules of `ABRIDGED_IDENTITIES`, which were written from the
  published form and not from the assertion linkbases of the package
  (`m01-f-legal-formula.xml`, `m01-f-nbb-formula.xml`) — those hold several
  thousand assertions and would be the authority.
