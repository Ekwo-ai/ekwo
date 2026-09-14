# Contributing to Ekwo OS

Thank you for being here. This file is short and every line of it is a rule
that has cost somebody a day.

## Ways to help

Ekwo is built by a network, not a vendor ([MANIFESTO.md](MANIFESTO.md)).
You do not have to write TypeScript to matter here:

- **You keep books for a living.** Review the pack for your country — the
  chart, the taxes, the declaration boxes — against the law you apply every
  day, and put your name on it. A pack is *reviewed* when a named
  professional has read it, and never before. Open an issue titled
  "Review: <country>".
- **You know your country's rules.** Propose a pack: `packs/<cc>/` is JSON
  and CSV, and `docs/packs.md` walks you through it. Start from Belgium or
  France and change what differs.
- **You speak a language we do not.** Translate a chart of accounts or the
  labels of a declaration in `packs/<cc>/i18n/`.
- **You write software.** A bank-statement parser, an exchange export
  parser, a format library, a connector, a module in its own schema: the
  `good first issue` label lists what is small and self-contained.
- **You run Ekwo.** Say what broke and what you expected. A precise bug
  report is a contribution.

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

A tax régime is data, not code, and the data lives in `packs/<cc>/` — a
manifest, the chart of accounts as CSV, the taxes and their postings as JSON.
Change the pack, run `ekwo pack build <cc>`, and commit the generated seed
alongside it; never edit the seed, the CI recompiles it and compares. The
format, and what a pack may not do, is in [`docs/packs.md`](docs/packs.md).

If a régime cannot be expressed as rows, that is a design discussion worth
having in an issue before any SQL is written. It is a gap in the core, not a
reason to add a field that executes something: a pack has none, and adding one
is how a localisation becomes a plugin that breaks on every major version.

## Working on the installer

`packages/cli` is the `ekwo` command. Three rules hold there.

1. **No migration may open a transaction of its own.** The runner applies each
   file as one command string inside a transaction it owns, together with the
   history row, so a failure halfway leaves nothing behind. A `begin` in a
   migration breaks that.
2. **The migration history belongs to Supabase.** `supabase_migrations.schema_migrations`
   is written in the Supabase CLI's format so `supabase db push` and
   `ekwo migrate` stay interchangeable. Do not add a column to it and do not
   invent a second history table.
3. **No secret reaches the disk, and the dependency list stays at one.** The
   database password and the `service_role` key come from a flag, the
   environment or a masked prompt. Everything this CLI handles is a secret, so
   a new runtime dependency needs an argument in the pull request.

## Tests

```sh
npm install
npm run typecheck
npm test
```

Tests run against [PGlite](https://pglite.dev): real Postgres, no Docker. Add
a test for any behaviour you change. Accounting scenarios belong in
`tests/posting.test.ts`; schema-level invariants in `tests/schema.test.ts`;
anything the installer does in `tests/cli/`.

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

## Releases

A release is one tag carrying the migrations, the packs and the packages
together, and `v0.2.0` is the first. What has to move and in which order is in
[`docs/releasing.md`](docs/releasing.md). Two consequences reach an ordinary
pull request: a published migration is never edited, and anything that ships
gets a line under `[Unreleased]` in [`CHANGELOG.md`](CHANGELOG.md) in the same
pull request that ships it.
