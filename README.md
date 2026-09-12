# Ekwo OS

**Ekwo OS** is free and open source, under AGPL-3.0. Install it on your own Supabase project and own your accounting data, forever.
Built and maintained by **Ekwo**. A fully managed edition — your own instance, operated and supervised by our AI agents — is available at **[ekwo.ai](https://ekwo.ai)**.

---

## Why Ekwo

> The long version — financial autonomy for every business, accounting as a
> commons, a network rather than a vendor — is in [MANIFESTO.md](MANIFESTO.md).

Accounting software has settled into two shapes, and both take something
from you. The SaaS keeps your books on its servers, behind its API and its
price list, and leaving means exporting a PDF. The open-source ERP gives you
the code but keeps the parts that save time — bank feeds, automatic matching,
invoice recognition — for the paid edition and a network of integrators.

Ekwo is built on a different premise: **the ledger belongs to the business,
and the work of keeping it can be done by software that the business also
owns.** So the whole accounting core is open, the data sits in a Postgres
database that you control, and the interface is designed for machines as
much as for people. A REST API and an OpenAPI description come free with
Supabase, and an MCP server sits on top of them, so an AI agent can book a
purchase, match a payment, prepare a VAT return or produce a FEC on your own
data — as you, under your own row level security, without the data ever
leaving your account.

What we are building, in order:

1. **This repository — the core.** Schema, posting rules, VAT, reports, the
   FEC, Belgian and French charts of accounts. Done, tested, installable
   today.
2. **`npx ekwo init`** — point it at your own Supabase project and it applies
   the schema, seeds the country rules, creates the first administrator and
   the first company, in one command. Done; see
   [`packages/cli`](packages/cli/).
3. **The MCP server** — `npx @ekwo-ai/mcp`, so any AI assistant can operate
   the books: read the ledger, raise an invoice, post it, match a payment,
   pull the VAT return or the FEC. Done; see [`packages/mcp`](packages/mcp/).
   A Community web application comes next.
4. **Any country as a versioned pack of data**, with one golden test per
   country — Belgium and France first, then the United Kingdom, Canada and
   Québec, the Netherlands, Germany, Luxembourg. The plan is in
   [`docs/international.md`](docs/international.md).
5. **Format libraries** as independent MIT packages:
   [Factur-X](https://github.com/Ekwo-ai/factur-x) and
   [XBRL for the NBB](https://github.com/Ekwo-ai/xbrl-cbso) already exist;
   Peppol UBL follows.

Who it is for: a company that wants to keep its own books with an AI at the
keyboard; an accounting firm that runs several companies inside one
installation; a developer who needs a real double-entry core with VAT rules
as data rather than as code; and anyone who wants to leave a proprietary
system with the books intact.

What we sell, so that this stays free: a managed edition at
[ekwo.ai](https://ekwo.ai) where the same schema runs on your own Supabase
project, and Ekwo operates the application, the AI agents, the bank
connections, the Peppol access point and the filings. If Ekwo disappeared
tomorrow, the Community edition would keep working. That is the test every
feature has to pass before it lands here.

## What is in this repository

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
- **Tested on real Postgres.** The test suite runs the migrations, the seeds,
  the accounting scenarios, the installer and the MCP server against Postgres
  compiled to WebAssembly.

## Install on your own Supabase project

Create a project at [supabase.com](https://supabase.com) — the free plan is
enough to start — and point the installer at it. Node 20 or later is the only
thing you need locally: no Supabase CLI, no Docker, no clone.

```sh
npx ekwo init
```

It asks for the connection string, the country, your organisation, the first
company and the address of the first administrator, then applies the
migrations, seeds the chart of accounts and the VAT codes, creates that
administrator in *your* Supabase Auth and runs the six steps below. Every step
checks before it acts, so running it twice creates nothing twice.

Ekwo does not create the project and does not pay for it. Your books are on
your account from the first row, which is the only version of "you own your
data" that survives us going away. Full flags, environment variables and the
non-interactive form are in [`packages/cli`](packages/cli/).

### What it does underneath

Six steps, in this order. They are ordinary SQL, and running them by hand is a
supported path — with the Supabase CLI, `supabase db push` applies the same
migrations and writes the same history table the installer does.

```sql
-- 1. Record the installation. Once, ever.
select init_instance('My Organisation', 'BE', 'community');

-- 2. Take the administrator seat. The first user to ask takes it; after
--    that, only an administrator can appoint another.
select claim_instance_admin();

-- 3. Create the company. Only an instance administrator may.
insert into companies (name, country, fiscal_country, currency_code)
values ('My Company', 'BE', 'BE', 'EUR')
returning id;

-- 4. Put yourself on its books. Administering the installation is not the
--    same as being a member of a company.
insert into company_members (company_id, user_id, role)
values ('<company-id>', auth.uid(), 'owner');

-- 5. Chart of accounts, journals, taxes and the company's default accounts.
--    The third argument is the language of the labels; left out, the company's.
select install_country_template('<company-id>', 'BE', 'fr');

-- 6. The first financial year.
insert into fiscal_years (company_id, name, start_date, end_date)
values ('<company-id>', 'FY2026', date '2026-01-01', date '2026-12-31');
```

Steps 1 and 2 are plain inserts underneath — `init_instance()` writes the
single `instance` row and `claim_instance_admin()` writes one row in
`instance_admins`. The functions exist so the bootstrap rules live in the
database rather than in whichever client happens to run first.

`install_country_template` copies the chart of accounts, the journals and the
taxes, and wires the company's default accounts — receivable, payable,
suspense, retained earnings — and its journals. It also records, in
`company_packs`, which version of which country pack this company copied, so
a later release can say what has moved since.

Those seeds are compiled from [`packs/`](packs/): a country is a manifest, a
chart of accounts as CSV and a taxes file, and `ekwo pack build` turns one
into the SQL above. The format is in [`docs/packs.md`](docs/packs.md).

The installer does steps 1 and 2 in a particular order for a reason worth
knowing. It holds a database connection, not a session, so `auth.uid()` is
NULL and row level security is bypassed rather than satisfied: it cannot *be*
the first user. So it creates that user through the Supabase Auth admin API
first — which also needs the `service_role` key, the only reason the key is
ever asked for — and writes the rows that user will be recognised by second.

By hand instead, with the Supabase CLI:

```sh
git clone https://github.com/Ekwo-ai/ekwo.git && cd ekwo
supabase link --project-ref <your-project-ref>
supabase db push                       # applies supabase/migrations in order
psql "$DATABASE_URL" -f supabase/seed/00_currencies.sql
psql "$DATABASE_URL" -f supabase/seed/10_pack_be.sql    # or 11_pack_fr.sql
```

Skip `supabase/seed/90_demo_company.sql` unless you want the sample data, and
then run the six statements above as a signed-in user. The two routes are
interchangeable: `ekwo migrate` and `supabase db push` read and write the same
`supabase_migrations.schema_migrations`.

### Keeping it running

```sh
npx ekwo status    # schema version installed against available, instance, companies
npx ekwo migrate   # apply what a new release adds
npx ekwo doctor    # row level security everywhere, orphaned memberships, statements
npx ekwo demo      # the sample company, on explicit request only
```

## The schema in twenty lines

```
instance                                 one row: who installed it, where, which edition
instance_admins                          instance administrators
companies ─┬─ company_members            who may read or write
           ├─ fiscal_years               periods, open or closed
           ├─ accounts                   chart of accounts, 18 account types
           ├─ journals ── journal_sequences
           ├─ contacts                   customers, suppliers, employees
           ├─ taxes ── tax_postings      ledger account + VAT box, per tax
           ├─ entries ── entry_lines     the ledger; lines carry the truth
           ├─ products                   what a line is filled in from, never stock
           ├─ documents ── document_lines invoices, credit notes, quotes
           ├─ payments                   money in and out
           ├─ reconciliations            bilateral matching, by amount
           ├─ bank_accounts ── bank_statements ── bank_transactions
           ├─ analytic_axes ── analytic_values ── entry_line_analytics
           └─ attachments                files, polymorphic
```

One installation belongs to one customer, so there is no `tenant_id`
anywhere: `instance` is that fact, in one row. Inside it, `instance_admins`
says who may create companies and invite people, and `company_members` gives
each person `owner`, `accountant` or `viewer` on each company. Your users live
in your own Supabase Auth; Ekwo never holds an account.

**Registering with Ekwo is optional and empty by default.** `contact_email`
and `registered_at` on the instance row stay null unless you call
`register_instance()`, nothing in this repository reads them, and
`unregister_instance()` puts them back. `ekwo init` asks the question once, at
the end, and the default answer is no. Community works unregistered, forever,
and `edition` gates no feature.

`post_document(id)` turns a document into an entry. `trial_balance`,
`general_ledger`, `aged_balance`, `vat_return` and `fec_lines` read it back.
`docs/schema.md` describes every table and column; `docs/mapping.md` lines
each one up against Odoo, EN 16931 and the FEC.

## The TypeScript packages

`packages/core` carries the types of the schema and the FEC generator, with
no runtime dependency beyond an optional `@supabase/supabase-js`.
`packages/cli` is the `ekwo` command above; it has one runtime dependency, the
Postgres driver, and never writes a secret to disk.

```ts
import { EkwoClient } from '@ekwo-ai/core';
import { createClient } from '@supabase/supabase-js';

const ekwo = new EkwoClient(createClient(url, key));

await ekwo.postDocument(documentId);
const balance = await ekwo.trialBalance({ companyId, from: '2026-01-01', to: '2026-12-31' });
const boxes   = await ekwo.vatReturn({ companyId, from: '2026-07-01', to: '2026-09-30' });
const fec     = await ekwo.generateFec({ companyId, from: '2026-01-01', to: '2026-12-31' });
```

`packages/mcp` is the Model Context Protocol server, published as
`@ekwo-ai/mcp`. It is the same idea as the client above, for an assistant
rather than for your code: tools over stdio — read the chart of accounts,
create a draft invoice, post it, register a bank account, record and match a
payment, pull the trial balance, the aged balance, the VAT return or the FEC
— plus the chart of accounts and the taxes as resources, and two prompts for
closing a month and preparing a return.

It runs **as the user**, never as `service_role`: it signs in with their
address and password, or takes their access token, and row level security
decides the rest. Every ledger write goes through the schema's own functions,
so nothing in the server writes an `entries` row, and nothing in it can unpost
an entry. Configuration is a block of environment variables in
`claude_desktop_config.json` or `.mcp.json`; see
[`packages/mcp`](packages/mcp/).

```sh
npx @ekwo-ai/mcp
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

## Security

Row level security is the whole model: every table carries it, every policy
is a function of `auth.uid()`, the reports run as the caller, and the views
run with the caller's rights. An anonymous request sees nothing and may call
nothing but the policy helpers. The MCP server refuses a `service_role` key.
`tests/rls.test.ts` proves who may read and who may write, and the CI fails
if a table ever arrives without a policy.

Three things the schema cannot do for you:

- **Turn off public sign-ups** on your Supabase project (Authentication →
  Sign In / Providers → *Allow new users to sign up*). Ekwo invites people;
  it never needs strangers to be able to create an account. A stranger with
  an account sees nothing, but there is no reason to let them in.
- **Keep two administrators.** If the last row of `instance_admins` goes —
  a deleted user cascades — the seat reopens to the first signed-in user
  who claims it, by design, so that an installation is never locked out.
  `ekwo doctor` warns when an installation has no administrator left.
- **Keep the `service_role` key off every machine that does not need it.**
  It bypasses row level security by construction. The CLI needs it once, to
  create the first administrator; nothing else in this repository does.

## What this is not

Ekwo is software, not advice. Your books, returns and filings are yours; a
country pack is our reading of the rules at a date, and a review is a
professional's good-faith reading, not a guarantee. [DISCLAIMER.md](DISCLAIMER.md)
says this in full. Read it before you file anything.

## Finding your way

Each folder carries a short README saying what lives there and the rule
that applies to it: [`supabase/`](supabase/), [`supabase/migrations/`](supabase/migrations/),
[`supabase/seed/`](supabase/seed/), [`packages/core/`](packages/core/),
[`packages/cli/`](packages/cli/), [`packages/mcp/`](packages/mcp/), [`tests/`](tests/),
[`docs/`](docs/), [`scripts/`](scripts/) and [`ee/`](ee/). The long-form reference is in `docs/`.

## Development

```sh
npm install
npm run typecheck
npm test          # applies every migration and seed to an in-memory Postgres
npm run build     # builds both packages; the CLI copies supabase/ into its dist
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
