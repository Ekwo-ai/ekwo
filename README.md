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
5. **Format libraries** as independent MIT packages, in
   [`packages/formats/`](packages/formats/), organised by format and never by
   country: the [French FEC](packages/formats/fec/),
   [Factur-X](packages/formats/factur-x/) and
   [XBRL for the NBB](packages/formats/xbrl-cbso/) exist today; Peppol UBL,
   camt.053 and CODA follow.

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
- **Every label is data, in every language the country pack publishes.**
  Identifiers and error codes are English and never move; what a person reads
  is a row. Belgium ships its chart of accounts, its journals, its VAT codes,
  its declaration boxes and its annual accounts in French, Dutch, German and
  English, and a company keeping its books in Dutch reads Dutch throughout.
  [`docs/languages.md`](docs/languages.md) is the mechanism.
- **Belgium and France out of the box.** PCMN (AR du 21 octobre 2018) and PCG
  (règlement ANC 2022-06), with their VAT codes and declaration boxes.
- **The French FEC.** Eighteen columns, the arrêté du 29 juillet 2013, with
  the reconciliation letter and the sub-ledger code the format requires.
- **Modules, one Postgres schema each.** Fixed assets and budgets ship with
  this release, in `assets` and `budgets`. A module depends on the socle by
  foreign key, reaches the ledger only through one function, and is enabled per
  company. The socle ignores its modules.
- **Tested on real Postgres.** The test suite runs the migrations, the seeds,
  the accounting scenarios, the installer and the MCP server against Postgres
  compiled to WebAssembly.

## Modules

The socle is `public`. Beside it, a module is a schema of its own with its own
migrations, its own row level security and its own tests.

| Module | Schema | What it does |
|---|---|---|
| [`assets`](modules/assets/) | `assets` | Fixed assets, their depreciation schedule and their disposal. Durations, declining coefficients and the prorata convention are country pack data. |
| [`budgets`](modules/budgets/) | `budgets` | A budget per financial year and the variance against what the ledger holds. No country data, and nothing written to the ledger. |

```sh
npx ekwo module list                          # what is here, and what the database holds
npx ekwo module migrate                       # apply their migrations and country seeds
npx ekwo module enable assets --company "…"   # turn one on for a company
```

Then add the schema to the project's exposed schemas — Supabase dashboard →
Project Settings → API, or `[api] schemas` in `supabase/config.toml`. No
migration can do that: it is a setting of the API and not of the database, and
`ekwo module enable` prints the line every time.

**A module never writes the ledger by hand.** It hands its lines to
`post_module_entry()`, which builds the draft and calls `post_entry()` — so
sides, rounding, numbering and period locks stay in one place. The entry is
tagged `(module_code, ref)`, unique per company, which is what makes running a
depreciation twice a no-op rather than a duplicate. A test over every file of
`modules/**` refuses a write to `entries` or `entry_lines`.

[`docs/modules.md`](docs/modules.md) is how to write one.

## Install on your own Supabase project

Create a project at [supabase.com](https://supabase.com) — the free plan is
enough to start — and point the installer at it. Node 20 or later is the only
thing you need locally: no Supabase CLI, no Docker, no clone.

```sh
npx ekwo init
```

It asks for the connection string, the country, the chart of accounts and the
language where the pack offers a choice, your organisation, the first company
and the address of the first administrator, then applies the
migrations, seeds the chart of accounts and the VAT codes, creates that
administrator in *your* Supabase Auth and runs the six steps below. Every step
checks before it acts, so running it twice creates nothing twice.

Ekwo does not create the project and does not pay for it. Your books are on
your account from the first row, which is the only version of "you own your
data" that survives the maintainer going away. Full flags, environment variables and the
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
git clone https://github.com/Ekwo-ai/ekwo-os.git && cd ekwo-os
supabase link --project-ref <your-project-ref>
supabase db push                       # applies supabase/migrations in order
psql "$DATABASE_URL" -f supabase/seed/00_currencies.sql
psql "$DATABASE_URL" -f supabase/seed/05_framework_generic.sql
psql "$DATABASE_URL" -f supabase/seed/10_pack_be.sql    # or 11_pack_fr.sql, 12_pack_lu.sql, 13_pack_ee.sql
```

Those five files are the ones `config.toml` lists under `[db.seed]`, which is
what `supabase db reset` applies on a local project — and the same set
`ekwo init` loads. Leave `05_framework_generic.sql` out and the installation
has a chart of accounts but no financial statements for a chart that declares
none of its own.

Skip `supabase/seed/90_demo_company.sql` unless you want the sample data, and
then run the six statements above as a signed-in user. The two routes are
interchangeable: `ekwo migrate` and `supabase db push` read and write the same
`supabase_migrations.schema_migrations`.

### Keeping it running

```sh
npx ekwo status    # schema version installed against available, instance, companies
npx ekwo migrate   # apply what a new release adds
npx ekwo doctor    # every object this release defines, row level security, orphaned memberships, statements
npx ekwo demo      # the sample company, on explicit request only
```

## The schema in twenty lines

```
instance                                 one row: who installed it, where, which edition
instance_admins                          instance administrators
capabilities ── role_capabilities         what may be done, and what each preset holds
companies ─┬─ company_members            who may read or write, and what they may do
           ├─ company_invitations        an address invited, a token hashed
           ├─ api_keys                   machine access, scoped to capabilities
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
user_preferences                         one row per person, null everywhere
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
`general_ledger`, `aged_balance`, `vat_return`, `ec_sales_list`,
`financial_statement` and `fec_lines` read it back — `financial_statement` on the schemes of the country
pack, the Belgian abbreviated model or the French liasse, or on a generic
framework by account type that fits any chart of accounts. The FEC of a
financial year opens on its *à-nouveaux*, computed from the ledger and never
posted, and carries the result of a year nobody has closed yet, so the file
rebuilds the balance sheet it belongs to.
`opening_balance(company, year, lines)` takes the trial balance of whatever
kept the books before, and `close_fiscal_year(year)` closes a year the way the
country pack says — straight to retained earnings, into a current-year result
account, or through the appropriation accounts — with `reopen_fiscal_year` for
a close run too early. An invoice is printed from three views —
`document_header`, `document_line_items` and `document_legal_mentions` — so a
renderer reads the seller, the buyer, the amounts, the lines and the sentences
the law requires without being configured with any of them.
`docs/schema.md` describes every table and column; `docs/mapping.md` lines each
one up against Odoo, EN 16931 and the FEC; `docs/languages.md` says how a label
reaches a reader in their own language.

## Who may do what

**A role is a preset. A capability is what a policy tests.** `owner`,
`accountant` and `viewer` are three rows in `role_capabilities`, and what the
schema actually checks is a code from `capabilities` — `documents.post`,
`payments.write`, `settings.write`, `members.manage`, `year_end.close` and
fifteen more. Read `select * from capabilities order by area, code` on your own
installation: that list is the vocabulary, and a module adds its own to it.

| Preset | Holds |
|---|---|
| `viewer` | every `.read` — the books, the documents, the chart, the catalogue |
| `accountant` | that, plus writing and posting, matching, the settings and the year-end close |
| `owner` | that, plus `company.write` and `members.manage` |

**One member can be adjusted without inventing a role.**
`company_members.capabilities_granted` adds, `capabilities_revoked` takes away,
and a revoke wins over a grant and over the preset — an owner who may not close
a year is a separation of duties, not a mistake.

```sql
-- a bookkeeper who posts invoices and never touches a period lock
update company_members
   set capabilities_granted = array['documents.post'],
       capabilities_revoked = array['company.write']
 where company_id = :company and user_id = :user;

select member_capabilities(:company);   -- what you may do here
```

**Inviting somebody who has no account yet.** `invite_member()` returns a token
**once** — only a sha256 of it is stored — and the person accepts it themselves,
signed in with the address it was sent to:

```sql
select * from invite_member(:company, 'her@example.com', 'accountant',
                            '["members.manage"]'::jsonb);
-- she signs up in your Supabase Auth, then, as herself:
select * from accept_invitation('<the token>');
```

An invitation is single use, expires, and is withdrawn with
`revoke_invitation()`. The MCP server offers `invite_member`,
`list_invitations` and `revoke_invitation`; accepting is the invitee's own act
and has no tool.

## Keys for machines

A script — a nightly import, a till, a bank feed — has no browser to sign in
with. Do not hand it the `service_role` key, which bypasses row level security
by construction, and do not create a user for it. Issue a key:

```sql
select * from create_api_key(:company, 'Nightly bank import',
                             '["bank.write", "bank.read"]'::jsonb,
                             now() + interval '1 year');
```

The secret comes back once and is stored as a sha256. A key belongs to **one
company**, does exactly what its capabilities say, and can never carry a
capability the person issuing it does not hold themselves — so withdrawing
somebody's capability withdraws the keys they left behind. `revoke_api_key()`
stops one for good.

A key is presented for the length of a transaction, not for a session:

```sql
begin;
select * from use_api_key('ekwo_…');   -- has_capability() now answers for it
insert into bank_transactions (…) values (…);
commit;
```

Two consequences worth knowing before you build on it. A key is **not a
session**: `auth.uid()` stays null, so what it reaches is what a policy asks a
capability for — the tables of its company — and not the reference tables or
the company row. And because PostgREST runs every request in its own
transaction, `use_api_key()` cannot be a separate HTTP call: a key is for a
client that holds a connection, which is what the MCP server's self-hosted
route does.

## The TypeScript packages

`packages/core` carries the types of the schema and a typed client over its
functions, with no runtime dependency beyond an optional
`@supabase/supabase-js`. The FEC moved out to `@ekwo-ai/fec`, because a file
format is MIT; the re-exports `@ekwo-ai/core` kept for one version are gone
since `v0.2.0`, so import the generator from the package that owns it.
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
payment, import an opening balance, close a year, pull the trial balance, the
aged balance, the VAT return or the FEC — plus the chart of accounts and the taxes as resources, and two prompts for
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

## Format libraries

They live in [`packages/formats/`](packages/formats/), under MIT, one package
per format and never one per country. Each imports nothing from the core and
declares the row shapes it reads in its own types, so any book-keeping system
that can produce those columns can use them:

- [`@ekwo-ai/fec`](packages/formats/fec/) — the French *fichier des écritures
  comptables*: eighteen columns, the arrêté du 29 juillet 2013.
- [`@ekwo-ai/factur-x`](packages/formats/factur-x/) — Factur-X and ZUGFeRD
  e-invoices: EN 16931 CII XML and PDF/A-3 embedding.
- [`@ekwo-ai/xbrl-cbso`](packages/formats/xbrl-cbso/) — XBRL for the annual
  accounts filed with the National Bank of Belgium.

They are not dependencies of the core: the core produces rows, and a brick
turns rows into a file. The one place they meet is a test.

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
is a function of `auth.uid()` — through `has_capability()`, which is the one
question a policy asks — the reports run as the caller, and the views run with
the caller's rights. An anonymous request sees nothing and may call nothing but
the policy helpers. The MCP server refuses a `service_role` key.
`tests/rls.test.ts` and `tests/capabilities.test.ts` prove who may read and who
may write, and the CI fails if a table ever arrives without a policy.

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
  create the first administrator; nothing else in this repository does. A
  script that needs to work on its own gets an API key, which is scoped to one
  company and to a list of capabilities — see *Keys for machines* above.

## What this is not

Ekwo is software, not advice. Your books, returns and filings are yours; a
country pack is our reading of the rules at a date, and a review is a
professional's good-faith reading, not a guarantee. [DISCLAIMER.md](DISCLAIMER.md)
says this in full. Read it before you file anything.

## Finding your way

Each folder carries a short README saying what lives there and the rule
that applies to it: [`supabase/`](supabase/), [`supabase/migrations/`](supabase/migrations/),
[`supabase/seed/`](supabase/seed/), [`packages/core/`](packages/core/),
[`packages/cli/`](packages/cli/), [`packages/mcp/`](packages/mcp/), [`modules/`](modules/),
[`tests/`](tests/), [`docs/`](docs/), [`scripts/`](scripts/) and [`ee/`](ee/). The long-form
reference is in `docs/`.

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

**The format libraries under [`packages/formats/`](packages/formats/) are
MIT**, each with its own `LICENSE`. Their value is ubiquity: a file format
should be readable and writable by anyone, including a competitor.

"Ekwo" and the Ekwo logo are trademarks and are not covered by the licence.
Fork the code; do not call the fork Ekwo.
