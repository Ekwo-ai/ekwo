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
| `fec.test.ts` | the eighteen columns in order, the formats, `checkFec()`, and a golden file against the demo company |

The installer has its own folder, `tests/cli/`, which runs the CLI's code
against the same PGlite.

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

Two things these do not run: the network driver and GoTrue. Both sit behind an
injected seam — `SqlClient` for the first, `fetch` for the second — so the
substitution is one object and not a layer of mocks.

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

## Writing a test

Build the scenario with the factory, act through the same functions a client
would call (`post_document`, `reconcile`, `vat_return`…), and assert on what
the database says afterwards. Test the refusal too: a rule that only has a
happy-path test is a rule nobody has tried to break.
