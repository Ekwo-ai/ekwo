# Ekwo OS

**Ekwo OS** is free and open source, under AGPL-3.0. Install it on your own Supabase project and own your accounting data, forever.
Built and maintained by **Ekwo**. A fully managed edition — your own instance, operated and supervised by our AI agents — is available at **[ekwo.ai](https://ekwo.ai)**.

---

A double-entry accounting core for Postgres. It is the schema, the posting
rules and the reports, as migrations you apply to a database you control.
There is no server to run: Supabase turns the schema into a REST API with an
OpenAPI description, and row level security decides who sees what.

- **Double entry, enforced by the database.** Amounts are positive, a
  reversal flips the side, an entry cannot be posted unless it balances, and
  a locked period refuses writes at the trigger — not in a form validator.
- **Documents and entries are two layers, joined by a foreign key.** An
  invoice answers to EN 16931 and Peppol; an entry answers to the chart of
  accounts and to the FEC. Keeping them apart keeps both honest.
- **Country rules are data.** A tax points at the ledger accounts it posts to
  and at the boxes of the VAT return it feeds. Adding a régime is a row, not
  a release.
- **Belgium and France out of the box.** PCMN (AR du 21 octobre 2018) and PCG
  (règlement ANC 2022-06), with their VAT codes and declaration boxes.
- **The French FEC.** Eighteen columns, the arrêté du 29 juillet 2013, with
  the reconciliation letter and the sub-ledger code the format requires.
- **Tested on real Postgres.** 71 tests run the migrations, the seeds and the
  accounting scenarios against Postgres compiled to WebAssembly.

## Install on your own Supabase project

You need the [Supabase CLI](https://supabase.com/docs/guides/cli) and a
project — the free plan is enough to start.

```sh
git clone https://github.com/Ekwo-ai/ekwo.git
cd ekwo

supabase link --project-ref <your-project-ref>
supabase db push                       # applies supabase/migrations in order
psql "$DATABASE_URL" -f supabase/seed/00_currencies.sql
psql "$DATABASE_URL" -f supabase/seed/10_chart_be.sql   # or 11_chart_fr.sql
psql "$DATABASE_URL" -f supabase/seed/20_taxes_be.sql   # or 21_taxes_fr.sql
```

Skip `supabase/seed/90_demo_company.sql` unless you want the sample data.

Then create your company and let the template do the rest:

```sql
insert into companies (name, country, fiscal_country, currency_code)
values ('My Company', 'BE', 'BE', 'EUR')
returning id;

insert into company_members (company_id, user_id, role)
values ('<company-id>', auth.uid(), 'owner');

select install_country_template('<company-id>', 'BE');

insert into fiscal_years (company_id, name, start_date, end_date)
values ('<company-id>', 'FY2026', date '2026-01-01', date '2026-12-31');
```

`install_country_template` copies the chart of accounts, the journals and the
taxes, and wires the company's default accounts — receivable, payable,
suspense, retained earnings — and its journals.

A `npx ekwo init` that does all of the above in one command is the next piece
of work; until it lands, the CLI above is the supported path.

## The schema in twenty lines

```
companies ─┬─ company_members            who may read or write
           ├─ fiscal_years               periods, open or closed
           ├─ accounts                   chart of accounts, 18 account types
           ├─ journals ── journal_sequences
           ├─ contacts                   customers, suppliers, employees
           ├─ taxes ── tax_postings      ledger account + VAT box, per tax
           ├─ entries ── entry_lines     the ledger; lines carry the truth
           ├─ documents ── document_lines invoices, credit notes, quotes
           ├─ payments                   money in and out
           ├─ reconciliations            bilateral matching, by amount
           ├─ bank_accounts ── bank_statements ── bank_transactions
           ├─ analytic_axes ── analytic_values ── entry_line_analytics
           └─ attachments                files, polymorphic
```

`post_document(id)` turns a document into an entry. `trial_balance`,
`general_ledger`, `aged_balance`, `vat_return` and `fec_lines` read it back.
`docs/schema.md` describes every table and column; `docs/mapping.md` lines
each one up against Odoo, EN 16931 and the FEC.

## The TypeScript package

`packages/core` carries the types of the schema and the FEC generator, with
no runtime dependency beyond an optional `@supabase/supabase-js`.

```ts
import { EkwoClient } from '@ekwo-ai/core';
import { createClient } from '@supabase/supabase-js';

const ekwo = new EkwoClient(createClient(url, key));

await ekwo.postDocument(documentId);
const balance = await ekwo.trialBalance({ companyId, from: '2026-01-01', to: '2026-12-31' });
const boxes   = await ekwo.vatReturn({ companyId, from: '2026-07-01', to: '2026-09-30' });
const fec     = await ekwo.generateFec({ companyId, from: '2026-01-01', to: '2026-12-31' });
```

## Related libraries

Two format libraries live in their own repositories, under MIT, and will be
dependencies of the higher layers rather than of this core:

- [`@ekwo-ai/factur-x`](https://github.com/Ekwo-ai/factur-x) — Factur-X and
  ZUGFeRD e-invoices: EN 16931 CII XML and PDF/A-3 embedding.
- [`@ekwo-ai/xbrl-cbso`](https://github.com/Ekwo-ai/xbrl-cbso) — XBRL for the
  annual accounts filed with the National Bank of Belgium.

## Community and cloud

The line is operational, not functional. Everything a bookkeeper can do alone
is here and always will be.

| Ekwo OS, on your Supabase | Managed edition, on [ekwo.ai](https://ekwo.ai) |
|---|---|
| The whole schema, migrations, row level security | Provisioning and running the instance |
| Journals, entries, matching, charts of accounts | Backups, restores, version upgrades |
| Invoicing, credit notes, VAT, reports, FEC | AI agents that book, match and check |
| Manual import of bank files | Bank connections under contract |
| Generating XBRL, Factur-X and UBL files | Peppol access point, certificate included |
| Everything above, forever, for nothing | Filing to Intervat, Teledec, the NBB, with someone answerable |

The test is simple: if Ekwo disappeared tomorrow, would it keep working? If
yes, it belongs here. `ee/` holds the commercial layer and has its own
licence.

## Development

```sh
npm install
npm run typecheck
npm test          # applies every migration and seed to an in-memory Postgres
```

Tests use [PGlite](https://pglite.dev), so no Docker and no local Postgres.
`tests/helpers/supabase-shim.sql` stands in for Supabase's `auth` schema and
its API roles; it is a test file and never ships.

## Contributing

Issues and pull requests are welcome. Contributions require the
[Contributor Licence Agreement](CLA.md); see [CONTRIBUTING.md](CONTRIBUTING.md)
for how to work on the schema without breaking a database somebody already
installed.

## Licence

[AGPL-3.0-only](LICENSE) © Ekwo AI. Installing Ekwo OS and running it for your
own organisation — modified or not — puts no obligation on you. The share-alike
clause bites only if you modify it *and* offer that modified version to people
outside your organisation over a network.

"Ekwo" and the Ekwo logo are trademarks and are not covered by the licence.
Fork the code; do not call the fork Ekwo.
