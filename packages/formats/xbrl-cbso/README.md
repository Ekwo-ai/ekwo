# @ekwo-ai/xbrl-cbso

Generate the XBRL file of Belgian annual accounts for the National Bank of Belgium
(Central Balance Sheet Office, *CBSO* / *Centrale des bilans* / *Balanscentrale*),
taxonomy **26.0**, abridged model for companies with capital (**m01-f**).

- **Pure TypeScript, zero runtime dependencies.** Works in Node ≥ 18, Deno, Bun and browsers.
- **Generated from the official taxonomy.** The 297 reporting codes of the model (430 cells,
  current and previous year), with their metric and dimension members, are read straight out of
  the NBB taxonomy package by
  [`scripts/build-taxonomy.mjs`](scripts/build-taxonomy.mjs) — not transcribed by hand. Sources
  and method: [`docs/sources.md`](docs/sources.md).
- **Two ways in.** Reporting codes (`20/58`, `9904`), or the fact keys a book-keeping system
  already stores next to each statement line (`met:am1|bas:m9|rst:m2`).
- **Partial forms welcome.** Only the codes you provide are emitted; Filing fills the rest.
  `unknownCodes()` tells you which of your codes the model would skip.
- **Built-in checks.** Enterprise-number check digits, ISO dates, Belgian postal codes, and the
  arithmetic identities of the form (`20/58 = 10/49`, `9904 = 9903 + 780 − 680 − 67/77`, …).
- **Optional PCMN layer.** Turn a trial balance (Belgian minimum chart of accounts) into the
  reporting codes.

## Install

```sh
npm install @ekwo-ai/xbrl-cbso
```

## Usage

```ts
import { generateCbsoXbrl, checkBnbEquations, LegalForm, EnterpriseCourt } from '@ekwo-ai/xbrl-cbso';

const input = {
  entityNumber: '0123.456.749',
  denomination: 'Exemple Conseil',
  legalForm: LegalForm.SA_NV,          // 'lgf:m014'
  court: EnterpriseCourt.BRUSSELS_FR,  // 'cct:m31'
  address: { street: "Rue de l'Exemple", number: '1', postalCode: '1000', city: 'Bruxelles' },
  periodStart: '2025-01-01',
  periodEnd: '2025-12-31',
  prevPeriodStart: '2024-01-01',
  prevPeriodEnd: '2024-12-31',
  gaDate: '2026-05-15',   // general meeting approving the accounts
  deedDate: '2019-03-04', // deed of incorporation / latest amendment of the articles
  values: {
    '20/58': { n: 201500, p: 171000 }, // total assets, current and previous year
    '10/49': { n: 201500, p: 171000 },
    '9904':  { n: 57500,  p: 43600 },
    '9087':  { n: 3.5,    p: 3 },      // full-time equivalents
    // … any other code of the abridged model
  },
  administrators: [
    { kind: 'person', lastName: 'Dupont', firstName: 'Marie',
      street: 'Avenue des Tilleuls', number: '12', postalCode: '1180', city: 'Uccle' },
    { kind: 'company', name: 'Gestion Exemple', enterpriseNumber: '0400.000.086',
      street: 'Kerkstraat', number: '7', postalCode: '9000', city: 'Gent',
      representative: { lastName: 'Janssens', firstName: 'Pieter' } },
  ],
};

const violations = checkBnbEquations(input.values); // [] when the form adds up
const xml = generateCbsoXbrl(input);                 // string, UTF-8, ready to upload
```

See [`examples/basic.ts`](examples/basic.ts) for a runnable version (`npm run example`).

### From statement lines that already carry their taxonomy key

A book-keeping system that stores the CBSO fact key next to each line of its
financial statements does not need to know the reporting codes at all. Hand the
lines over as they are:

```ts
import { generateCbsoXbrl } from '@ekwo-ai/xbrl-cbso';

const xml = generateCbsoXbrl({
  ...identification,
  lines: [
    { xbrl_element: 'met:am1|bas:m2|ntr:m2', amount: 12000, previous_amount: 15000 }, // 22/27
    { xbrl_element: 'met:am1|bas:m5|ntr:m2', amount: 8000,  previous_amount: 10000 }, // 24
    { xbrl_element: 'met:am1|bas:m9|rst:m2', amount: 60000, previous_amount: 47500 }, // 40/41
  ],
});
```

A key is the metric followed by the domain members that matter; the members that
only place a fact in a column (`dim:part`, `dim:prd`) may be left out. It
resolves to the line that adds the fewest members of its own, so
`met:am1|bas:m2` is the heading *ACTIFS IMMOBILISÉS* (21/28) and not one of the
three lines under it. A key that fits two lines equally well is refused rather
than guessed:

```ts
resolveFactKey('met:am1|bas:m25', CBSO_26_M01F);
// CbsoFactKeyError: signature shared by 10/49, 20/58 — add the member that
// separates them (usually a "part:" member)
```

`met:am1|bas:m25|part:m1` is the total of the assets, `|part:m3` the total of
the liabilities. `resolveFactKey`, `valuesFromFactKeys` and `factKeyOf` are
exported for callers that want to do the mapping themselves; `mergeValues`
shows what a filing would carry when both `values` and `lines` are given, and
refuses a code that the two disagree on.

### From a trial balance

```ts
import { valuesFromTrialBalance } from '@ekwo-ai/xbrl-cbso/pcmn';

// balance = debit − credit, for the current and the previous year
const values = valuesFromTrialBalance([
  { account: '400000', balance: 52000, priorBalance: 41000 },
  { account: '440000', balance: -31000, priorBalance: -28000 },
  { account: '700000', balance: -320000, priorBalance: -270000 },
  // …
]);
```

`valuesFromTrialBalance` computes the four sections (assets, equity and liabilities, income
statement, appropriation) with the sign conventions of the standardised form, and returns them in
the shape the generator expects. Lower-level functions (`computeBalanceSheet`,
`computeIncomeStatement`, `computeAppropriation`, the `ASSETS` / `LIABILITIES` /
`INCOME_STATEMENT` / `APPROPRIATION` tables) are exported for custom pipelines.

Annex figures that do not derive from the trial balance (fixed-assets movements `8029`–`8395`,
staff `9087`, …) are plain codes: add them to `values` yourself.

## API

| Export | Description |
|---|---|
| `generateCbsoXbrl(input, options?)` | One call: `CbsoInput` → XBRL string. Validates the input unless `options.validate === false`. `options.lang` sets `xml:lang` (default `fr`). |
| `checkBnbEquations(values, options?)` | Returns the identities that do not add up (`code`, `column`, `expected`, `actual`, `rule`). Missing operands count as zero, as in Filing. |
| `unknownCodes(values)` | Codes the abridged model does not carry (they would be silently skipped), sorted. |
| `unfiledValues(input)` | Figures that would be dropped: an unknown code, or a code whose column the model does not have. |
| `resolveFactKey(key, template)` | `"met:am1\|bas:m9\|rst:m2"` → `"40/41"`. Throws a `CbsoFactKeyError` naming the candidates when the key fits more than one line. |
| `valuesFromFactKeys(lines, template)`, `factKeyOf(fact)`, `parseFactKey(key)` | The pieces of that path, for callers doing the mapping themselves. |
| `mergeValues(input, template?)` | `values` plus the resolved `lines`; throws when the two disagree on a code. |
| `validateInput(input)` | Throws a `CbsoInputError` (`path`, `message`) on the first problem. |
| `normalizeEnterpriseNumber`, `isValidEnterpriseNumber` | `"BE 0123.456.749"` → `"0123456749"`; mod-97 check digits. |
| `LegalForm`, `EnterpriseCourt` | Taxonomy members verified against accepted filings. Any other `lgf:*` / `cct:*` member can be passed as a string. |
| `XbrlCbso`, `CBSO_26_M01F`, `FRAMEWORK`, `NAMESPACES` | Class API and bundled template, for a custom or updated taxonomy. |

Types: `CbsoInput`, `FactKeyLine`, `PostalAddress`, `Administrator`, `YearValues`,
`Declarations`, `TemplateFact`, `CbsoTemplate`.

`CbsoInput.values` is the legacy path: it makes the caller hold its own mapping
from its accounts to the reporting codes of the model. `CbsoInput.lines` exists
so that mapping can live in one place — the system that produced the statement —
instead of being copied here. Both stay supported, and they can be combined.

## How it works

The CBSO taxonomy carries the reporting code (*rubrique* / *rubriek*) in the **dimensions** of the
context (`dim:bas → bas:mXX`, `dim:part`, `dim:prd` for current vs previous year…), never in the
element name: amounts are all `met:am1` / `met:am2`, figures `met:int*` / `met:dec1`. A template
lists, for each of the 430 cells of the abridged model, that exact signature. The generator:

1. keeps the template facts that have a value (identification fields, reporting codes);
2. adds the enumerated identification facts (legal form, court, postal code, country) and the
   board members (typed dimensions keyed by name);
3. builds the deduplicated contexts, declares only the namespaces actually used, and formats
   numbers according to the element facets (two decimals for amounts, one for FTEs, integers).

The previous financial year is **not** a second period: both columns are reported in a context
whose period is the closing date of the current year, and `dim:prd` (`prd:m1` / `prd:m2`) says
which column. The boxes the NBB itself suffixes with `P` in the annexes (`8059P`, `1003P`) measure
the same thing as their base code one year earlier, so they are its `p` figure. `14P` is not in
that case — "profit carried forward from the previous year" is a line of its own — and keeps its
own code.

To rebuild the table against a newer taxonomy package:

```sh
node scripts/build-taxonomy.mjs --package ~/nbb-cbso-26.0.15            # rewrite
node scripts/build-taxonomy.mjs --package ~/nbb-cbso-26.0.15 --check    # verify only
```

## Scope and limitations

- Model **m01-f** only (abridged, companies with capital). Full and micro models, and the
  non-profit taxonomy, are not covered yet — though the build script takes `--model` and
  `--framework`, so the table for another one is a command away.
- The **identification** facts (section 1) are not generated: they carry no reporting code, and
  are kept from a filing the NBB accepted. Everything else comes from the taxonomy.
- Only the legal form and court identifiers verified in accepted filings are named constants;
  other members must be looked up in the taxonomy's `lgf` / `cct` domains.
- The generator does not validate against the XSD. The NBB *Filing* application remains the
  authority: import the file in a draft and check its validation report before submitting.

## Development

```sh
npm install
npm run typecheck
npm test
npm run build
```

## License

[MIT](LICENSE) © Ekwo AI
