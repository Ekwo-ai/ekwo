# @ekwo-ai/core

TypeScript types and the French FEC generator for the
[Ekwo OS](https://github.com/Ekwo-ai/ekwo) accounting schema.

- **Types of the whole schema**, hand written so they stay readable: accounts,
  journals, entries and lines, documents and lines, taxes and tax postings,
  and the row shapes the report functions return.
- **The French FEC.** Eighteen columns, the arrêté du 29 juillet 2013, with
  date and amount formatting, field cleaning and the file-level checks a tax
  inspector applies first.
- **A thin client** over the functions that carry the accounting rules —
  `post_document`, `reconcile`, `trial_balance`, `vat_return`, `fec_lines`.
  Everything else is a table, and Supabase already exposes those as REST.
- **No runtime dependency.** `@supabase/supabase-js` is an optional peer.

## Install

```sh
npm install @ekwo-ai/core
```

## Usage

```ts
import { EkwoClient, checkFec, fecFileName } from '@ekwo-ai/core';
import { createClient } from '@supabase/supabase-js';

const ekwo = new EkwoClient(createClient(url, key));

const entry = await ekwo.postDocument(documentId);
await ekwo.reconcile(receivableLineId, bankLineId);

const balance = await ekwo.trialBalance({ companyId, from: '2026-01-01', to: '2026-12-31' });
const boxes   = await ekwo.vatReturn({ companyId, from: '2026-07-01', to: '2026-09-30' });
const aged    = await ekwo.agedBalance(companyId, '2026-09-30', 'receivable');

const fec = await ekwo.generateFec({ companyId, from: '2026-01-01', to: '2026-12-31' });
await writeFile(fecFileName('123456789', '2026-12-31'), fec, 'utf8');
```

Without a Supabase client, format the file yourself from the rows of
`fec_lines()`:

```ts
import { checkFec, fromQueryRow, generateFec } from '@ekwo-ai/core/fec';

const lines = rows.map(fromQueryRow);
const violations = checkFec(lines);   // [] when the file is clean
const file = generateFec(lines, { decimalSeparator: ',', fieldSeparator: '|' });
```

## API

| Export | Description |
|---|---|
| `EkwoClient` | Wrapper over the accounting functions of the schema. |
| `initInstance`, `claimInstanceAdmin` | Record the installation and take the first administrator seat. |
| `registerInstance`, `unregisterInstance` | Opt into being reachable by Ekwo, and out again. Never required. |
| `generateFec(lines, options?)` | The FEC as a string. |
| `checkFec(lines)` | Mandatory fields, one side per line, entries balancing. |
| `fecFileName(siren, fiscalYearEnd)` | `123456789FEC20261231.txt`. |
| `formatFecDate`, `formatFecAmount`, `FEC_COLUMNS` | The formatting primitives. |
| `fromQueryRow(row)` | Maps a `fec_lines()` row onto a `FecLine`. |
| `ACCOUNT_TYPES`, `internalGroup(type)` | The eighteen account types and their balance-sheet group. |
| `isRegistered(instance)` | Whether the operator opted into registering with Ekwo. |
| `isSale`, `isCreditNote`, `isAccountable` | Document type predicates. |
| Types | `Instance`, `InstanceMember`, `MemberRole`, `CompanyRole`, `Account`, `Journal`, `Entry`, `EntryLine`, `EkwoDocument`, `DocumentLine`, `Tax`, `TaxPosting`, `Contact`, `TrialBalanceRow`, `AgedBalanceRow`, `VatReturnRow`, … |

Amounts come back from Postgres as strings, and the types say so: `numeric`
is carried as `Decimal = string` rather than rounded into a float on the way
in.

## Licence

[AGPL-3.0-only](../../LICENSE) © Ekwo AI.
