# `tests/` — the schema, proven

Every test applies the whole of `supabase/migrations/` and `supabase/seed/`
to a fresh Postgres and then exercises it. Postgres runs compiled to
WebAssembly ([PGlite](https://pglite.dev)), so there is no Docker, no local
server and nothing to clean up.

```sh
npm test
```

| File | Proves |
|---|---|
| `schema.test.ts` | migrations are ordered, every expected table and function exists, the Postgres enum and the TypeScript constant agree, no template row points at a missing account |
| `posting.test.ts` | a Belgian sale posts to 704 / 451 / 400 and balances; a credit note flips the sides with no negative amount; VAT rounds once per tax group; an intra-community purchase fills boxes 86, 55 and 59 and nets to zero in the ledger; the refusals (empty document, quote, double post, tax out of validity) |
| `reconciliation.test.ts` | partial then full matching under one letter, refusals beyond the open amount, un-matching |
| `locks.test.ts` | `lock_date`, `tax_lock_date`, closed years, and that matching stays possible after a lock |
| `reporting.test.ts` | the trial balance balances and excludes drafts, twelve VAT boxes to the cent, the aged balance ties to the receivable account |
| `rls.test.ts` | every table has row level security and a policy, a non-member sees nothing, a viewer cannot write, two companies cannot see each other, `anon` sees nothing |
| `instance.test.ts` | the instance row is a true singleton, only an instance administrator creates a company, registration is optional and reversible, no table carries a `tenant_id` |
| `line_defaults.test.ts` | the account a line with none falls back to — the line, the company default, the country model — including under `set role authenticated`, and the refusal when nothing anywhere has an answer |
| `fec.test.ts` | the eighteen columns in order, the formats, `checkFec()`, and a golden file against the demo company |

The installer and the MCP server have their own folders, `tests/cli/` and
`tests/mcp/`, which run their code against the same PGlite.

| File | Proves |
|---|---|
| `cli/migrations.test.ts` | migrations are applied in order and recorded in `supabase_migrations.schema_migrations` the way the Supabase CLI records them, a second run does nothing, a failure halfway leaves neither schema nor history behind and the next run resumes at it, and the statement splitter puts every real migration back together unchanged |
| `cli/bootstrap.test.ts` | the six steps of the installation sequence, twice over with nothing created the second time, the refusal of an unseeded country, and the refusal to hand the administrator seat to a second person |
| `cli/init-sequence.test.ts` | the whole non-interactive install end to end, ending in a posted invoice; `ekwo.json` with no secret in it; the demo seed applied on behalf of a real administrator |
| `cli/auth.test.ts` | the Supabase Auth admin call: created, already registered, invite link, refused |
| `cli/status-doctor.test.ts` | what `status` reports, and each doctor check with exactly one thing broken |
| `cli/registry.test.ts` | registering writes the instance row and posts six fields, an unreachable endpoint is not a failure, unregistering puts it back, and a non-administrator is refused |
| `cli/package.test.ts` | the SQL copied into the published package is byte for byte the repository's, and nothing from `ee/` ships |
| `cli/cli.test.ts` | argument parsing and its refusals, the connection-string helpers, and what the help promises |

And `tests/mcp/`, which calls the MCP server's tools the way the protocol
does — including once through a real client over the in-memory transport.

| File | Proves |
|---|---|
| `mcp/accounting.test.ts` | a quarter of bookkeeping through the tools an assistant calls: a contact, a Belgian invoice at 21 %, posting it to 704 / 451 / 400, two payments matched against it, un-matching and re-matching, then the trial balance, the VAT return and the FEC read back |
| `mcp/guards.test.ts` | the refusals, all of them the database's: a locked period, a viewer who may read and not write, an owner of one company who cannot see or write the other, a stranger who sees nothing |
| `mcp/surface.test.ts` | what a client actually sees, over the in-memory transport: every tool this release ships, a valid JSON Schema for each, the read-only and destructive annotations, the two resources, the two prompts, and a refusal arriving as a tool error rather than a broken connection |
| `mcp/bank.test.ts` | the setup path an operator used to have to do in SQL: a viewer refused a bank account, an accountant given one wired to the bank journal and its ledger account, the same IBAN twice returning the first, another company seeing none of it, and a payment that books 550000 against 400000 |
| `mcp/config.test.ts` | what the server refuses to start with: a `service_role` key, and a database connection with no user to act for |

Three things these do not run: the network driver, GoTrue, and PostgREST.
Each sits behind an injected seam — `SqlClient` for the first, `fetch` for the
second, the `Backend` interface for the third — so the substitution is one
object and not a layer of mocks. `packages/mcp/README.md` carries the manual
sequence that exercises the PostgREST route against a real project.

## Helpers

- `helpers/db.ts` — boots PGlite, applies the shim, the migrations and the
  seeds, and hands back a connection.
- `helpers/factory.ts` — creates a company, a member, a fiscal year, a
  contact, a document, so a test reads as the scenario it proves.
- `helpers/supabase-shim.sql` — stands in for what Supabase provides and
  Postgres does not: the `auth` schema (`auth.users`, `auth.uid()`,
  `auth.jwt()`) and the roles `anon`, `authenticated`, `service_role`. It is
  applied **before** the migrations, because the security-definer functions
  will not create without it, and it never ships.
- `fixtures/demo-fec.txt` — the golden FEC of the demo company. If a change
  to the seeds moves it, regenerate it on purpose and say so in the commit.
- `cli/helpers.ts` — PGlite behind the CLI's `SqlClient`, an `auth.users` row
  standing in for an account GoTrue created, and a `fetch` that answers from a
  table of routes and records what it was sent.
- `mcp/helpers.ts` — PGlite behind the MCP server's `SqlClient`, which sets
  the JWT claims and the `authenticated` role on every call, so a tool is
  refused here for the same reason it would be refused over the API.

## Test the writes under row level security, not only the reads

The schema was shipped with a bug no test caught: the numbering counters
had a select policy only, and `next_entry_number()` ran as the caller, so
**no signed-in user could post an entry**. The suite had proved who could
*read* under `authenticated` and had run every *write* — `post_document`,
`post_entry`, `reconcile` — as the table owner, which row level security
does not apply to. A suite that checks who may read and never who may write
gives false assurance.

Rule: every write path gets at least one test that performs it under
`set role authenticated` with `request.jwt.claims` set to a real member of
the company — the `viewer` who must be refused and the `accountant` who must
succeed. `tests/rls.test.ts` shows the pattern; `tests/mcp/` runs the whole
invoice-to-payment cycle that way.

## Writing a test

Build the scenario with the factory, act through the same functions a client
would call (`post_document`, `reconcile`, `vat_return`…), and assert on what
the database says afterwards. Test the refusal too: a rule that only has a
happy-path test is a rule nobody has tried to break.
