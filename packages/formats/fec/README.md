# `@ekwo-ai/fec`

The French **FEC** — *fichier des écritures comptables* — in TypeScript, with
no dependencies.

Eighteen columns, in the order fixed by the arrêté du 29 juillet 2013 (art.
A. 47 A-1 du Livre des procédures fiscales). Give it ledger rows and it gives
you the file, the name the administration expects, and the list of what does
not add up.

```ts
import { checkFec, fecFileName, fromQueryRow, generateFec } from '@ekwo-ai/fec';

const lines = rows.map(fromQueryRow); // rows of a `fec_lines(...)` query
const violations = checkFec(lines);   // empty, or what an inspector reads first
const file = generateFec(lines);      // `|` separated, comma decimals, CRLF
const name = fecFileName('123456789', '2026-12-31'); // 123456789FEC20261231.txt
```

`FecQueryRow` is the row shape of the `fec_lines(company, from, to)` function of
[Ekwo OS](https://github.com/Ekwo-ai/ekwo), declared here so that nothing is
imported from it. Any book-keeping system that can produce those columns can
use this package; it reads no database and knows no accounting.

The separators are options: `decimalSeparator`, `fieldSeparator`, `newline`,
`header`. The defaults are what the French tooling expects.

MIT.
