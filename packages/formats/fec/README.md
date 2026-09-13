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
[Ekwo OS](https://github.com/Ekwo-ai/ekwo-os), declared here so that nothing is
imported from it. Any book-keeping system that can produce those columns can
use this package; it reads no database and knows no accounting.

## The opening lines

A file that covers a whole financial year starts with its *à-nouveaux*: one
line per balance-sheet account, at the balance it carried on the last day of
the year before, on the opening journal and dated on the first day of the year.
This package does nothing special with them — they arrive as ordinary rows,
they carry one entry number of their own, and `checkFec` balances them like any
other entry.

Where they come from is the producer's business. In Ekwo OS they are computed
from the ledger rather than posted, and two of their properties are worth
knowing when you read a file:

- **An unclosed year still carries its result.** When the year before has not
  been closed, the difference between the balance-sheet lines is the result
  nobody has allocated yet, and it arrives as one more opening line on the
  balance-sheet account the close would have put it on. The file balances
  whether or not the meeting has happened.
- **The entries of a year-end close are not in the file of the year they
  close.** They would show the result twice — once in the ordinary movements,
  once on the balance sheet — so the income statement reads from the movements
  as it always did, and the result reaches the balance sheet in the opening
  lines of the year that follows.

An extract that is not a whole financial year gets no opening lines: it is an
extract of movements, and `fecFileName` is built from a year end.

The separators are options: `decimalSeparator`, `fieldSeparator`, `newline`,
`header`. The defaults are what the French tooling expects.

MIT.
