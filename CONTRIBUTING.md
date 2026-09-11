# Contributing to Ekwo OS

Thank you for being here. This file is short and every line of it is a rule
that has cost somebody a day.

## Before you start

- Open an issue first for anything that changes the schema. A migration is a
  public artefact: once it is released, a database somewhere has run it.
- By opening a pull request you agree to the [Contributor Licence Agreement](CLA.md).
  The bot will ask you to confirm it on your first contribution. It is not
  optional: without it Ekwo cannot relicense its own code, and a project that
  cannot relicense is a project that cannot change its mind.

## Working on the schema

1. **Migrations are additive and never edited.** Add
   `supabase/migrations/<YYYYMMDDHHMMSS>_<what>.sql`. Do not touch a file that
   has been released. To change a column, add a migration that changes it.
2. **Row level security at creation.** Every new table gets
   `alter table ... enable row level security` and at least a select policy in
   the same migration. A test fails otherwise.
3. **`company_id` on every table, never `tenant_id`.** One instance is one
   customer; several companies inside it is the normal case.
4. **snake_case, plural table names, English.** Foreign keys are
   `<entity>_id`. Timestamps are `created_at` and `updated_at`.
5. **Resolve accounts by role, never by code prefix.** `LIKE '411%'` means
   *customers* on one chart and *recoverable VAT* on another. Use the company
   defaults, the contact overrides, or `tax_postings.account_id`.
6. **Raise, do not warn.** An exception handler that swallows an error and
   returns is how an invoice ends up with no entry and nobody notices.
7. **Derive totals, never key them in.** If a header and its lines can
   disagree, one day they will.

## Country rules

A tax régime is data, not code. Add rows to `tax_templates` and
`tax_posting_templates`, with the ledger accounts and the declaration boxes.
If a régime cannot be expressed that way, that is a design discussion worth
having in an issue before any SQL is written.

## Tests

```sh
npm install
npm run typecheck
npm test
```

Tests run against [PGlite](https://pglite.dev): real Postgres, no Docker. Add
a test for any behaviour you change. Accounting scenarios belong in
`tests/posting.test.ts`; schema-level invariants in `tests/schema.test.ts`.

To refresh the golden FEC file after a deliberate change:

```sh
UPDATE_GOLDEN=1 npm test -- tests/fec.test.ts
```

## No private data

The repository must contain no real company, person, VAT number or bank
account. `npm run check:no-private-data` enforces a denylist and runs in CI.
Demo data is fictional and stays that way.

## Commits

Conventional commits: `feat:`, `fix:`, `docs:`, `chore:`, `test:`, `refactor:`.
