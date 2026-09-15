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
  France and change what differs. A pack comes with a golden scenario — ten
  documents of a year and the figures they produce — and a legal source on
  every tax and every box of the declaration.
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
3. **A migration that creates an object grants it.** A table, a view or a
   function comes with its `grant` in the same file, by name — never
   `grant … on all tables`, and never through `alter default privileges`,
   which is the hidden mechanism this rule exists to replace. The grant says
   the same thing as the policies: `authenticated` gets exactly the verbs a
   policy of that table is prepared to judge, `anon` gets nothing on any
   table, and a function keeps the `revoke execute … from public` that was
   already compulsory. Run `npm run inventory` and commit
   `packages/cli/assets/expected-objects.json` with the migration; the CI
   regenerates it and refuses a diff, and `tests/grants.test.ts` refuses a
   grant that does not match the policies.
4. **`company_id` on every table, never `tenant_id`.** One instance is one
   customer; several companies inside it is the normal case.
5. **snake_case, plural table names, English.** Foreign keys are
   `<entity>_id`. Timestamps are `created_at` and `updated_at`.
6. **Resolve accounts by role, never by code prefix.** `LIKE '411%'` means
   *customers* on one chart and *recoverable VAT* on another. Use the company
   defaults, the contact overrides, or `tax_postings.account_id`.
7. **Raise, do not warn.** An exception handler that swallows an error and
   returns is how an invoice ends up with no entry and nobody notices.
8. **Derive totals, never key them in.** If a header and its lines can
   disagree, one day they will.

## Country rules

A tax régime is data, not code. Everything a country adds — a chart of
accounts, its journals, its taxes and where each one posts, the boxes of the
periodic return, the financial statements, the sentences the law puts on an
invoice, the translations — is a set of files under `packs/<cc>/`, compiled
into one SQL seed that is committed. [`docs/packs.md`](docs/packs.md) is the
format, file by file, with every rule `ekwo pack check` applies and a
walkthrough for adding a country in a day. Read it before you open anything
else.

Seven invariants hold there, and a pull request that breaks one is a pull
request that will be sent back.

1. **Data, never code.** There is no field in the format through which a pack
   can run anything: no expression language, no hook, no module per country.
   `applies_when` is a closed vocabulary, a total is a list to add and a list
   to subtract, and a rule names accounts. A pack that could execute would be a
   localisation that breaks on every major version, which is exactly what this
   format exists not to be.
2. **No country literal in the core.** Not in a function, not in a column
   default, not in a migration, not in the CLI. `'BE'`, `'EUR'`, `'fr'` and a
   legal account code all belong to a pack, and a test enforces it. There is no
   fallback country either: a reader that needs a value a pack did not give
   says which value is missing, by name, rather than borrowing another
   country's law.
3. **Resolve an account by its role, never by its code prefix.** `411` is
   *customers* on the French chart and *recoverable VAT* on the Belgian one. Use
   `defaults.roles`, the company defaults or `tax_postings.account_id`.
4. **A legal reference on every tax and every box.** It is a required field,
   not a convention: `ekwo pack check` refuses a pack that leaves one out, and
   `"TODO"` is not a source. A rule nobody can trace to a text is a rule nobody
   can review.
5. **A golden scenario, or a written reason there is none.** A year of at least
   ten documents with the payments that settle some of them, and beside it the
   declaration, the statements and the trial balance the engine makes of them,
   to the cent. `UPDATE_GOLDEN=1 npm test -- tests/golden.test.ts` writes the
   three expectation files and never the scenario; **read the diff** — that is
   the review, and a figure you cannot explain is a defect in the pack.
6. **A review is a named professional, and nothing else.** `certification.status`
   is `community` until an accountant has read the pack against the law they
   apply, at which point it becomes `reviewed`, with their name and the date in
   the manifest. `maintained` means the maintainers keep it current and nobody
   has reviewed it. There is no status that means "certified by Ekwo", and
   writing a pack is not reviewing it.
7. **Nothing is ever deleted from a pack, and the seed is never edited by
   hand.** An account is deprecated, a tax gets a `valid_to`, a form version
   gets a new `valid_from` — because the return of a past period has to keep
   giving the same answer. And the SQL under `supabase/seed/` is a build
   artefact: change the pack, run `ekwo pack build <cc>`, commit the generated
   file alongside it. The CI recompiles and compares.

```sh
npm run build
node packages/cli/dist/bin.js pack check --all   # what the CI runs
node packages/cli/dist/bin.js pack build be      # after changing packs/be
```

Every pack has an owner in [`.github/CODEOWNERS`](.github/CODEOWNERS), who is
asked to look at a pull request that moves it. Ownership is not certification:
it is who knows the law, not who has signed anything.

If a régime cannot be expressed as rows, that is a design discussion worth
having in an issue before any SQL is written. It is a gap in the core, not a
reason to add a field that executes something.

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

To refresh a golden file after a deliberate change:

```sh
UPDATE_GOLDEN=1 npm test -- tests/fec.test.ts      # the FEC export
UPDATE_GOLDEN=1 npm test -- tests/golden.test.ts   # every country pack
```

The second rewrites the declaration, the statements and the trial balance each
pack's scenario produces, and never the scenario itself. Read the diff: that is
the review. A country pack without a golden scenario is refused by
`ekwo pack check` and by the CI — see [`docs/packs.md`](docs/packs.md), "Golden
scenario".

### A test may book in a country. It may not expect one.

A test about the core walks `listPacks()` and takes its expectation from the
pack — a role of the manifest, an account of a chart, a box of the declaration
form. `tests/helpers/packs.ts` is where that starts: `allPacks` to loop over
everything, `packWhere('taxes on collection', …)` to pick the pack that carries
the property under test rather than the country that happens to have it, and
`somePack` where a test needs a pack and does not care which.

Setting up may still name a country: a scenario books invoices somewhere, and
saying where is how it stays readable. Adding a pack then touches the pack
folder and its `golden/`, and nothing under `tests/`.

```sh
npm run check:no-country-literals
```

runs in the CI and says where a country was expected by hand. Where a literal
is genuinely right, one comment says so and why:

```ts
// country-literal: the demo company is Belgian, and this reads its books
```

### End to end

`tests/e2e/` runs with the rest of `npm test`. It installs the same release
twice — once through the CLI's runner, once the way `supabase db push` and
`psql -f` do — and compares every row of every table the seeds write; then it
takes a company installed at 1.0.0, upgrades its pack, opens a financial year,
books two invoices, files the VAT return, prints both financial statements,
closes the year, re-opens it and closes it again, comparing every figure to one
it works out itself from `sum(debit) - sum(credit)`.

Four things it cannot reach, because PGlite is not a project: the published
binary over a pooler connection, PostgREST (a function that exists and was
never granted to `authenticated` passes every test here), GoTrue, and the
extensions a hosted project has. `npm run e2e:supabase` covers those against a
real and empty Supabase project. It is run by hand before a release is tagged,
never by the CI, and [`docs/releasing.md`](docs/releasing.md) is where its
environment variables and its refusals are written down.

## No private data

The repository must contain no real company, person, VAT number or bank
account. `npm run check:no-private-data` enforces a denylist and runs in CI.
Demo data is fictional and stays that way.

## No conflict marker

```sh
npm run check:no-conflict-markers
```

reads every file git tracks and refuses the four lines a merge conflict leaves
behind: the opening marker, the separator, the closing marker, and the fourth
one naming the common ancestor that the `diff3` and `zdiff3` styles write. It
runs in the CI's *hygiene* job.

It exists because two `|||||||` lines sat in `CHANGELOG.md` for a day before
anybody read the file with their eyes. In a `.sql` or a `.ts` the same mistake
breaks the build on the first push; in prose it costs nothing at runtime, and
prose is exactly where a conflict is most likely — a changelog and a design
note are what every branch appends to.

Only tracked files are read: a marker in your working copy is a merge you are
in the middle of, which is not a fault. The separator is matched whole, a line
of seven `=` and nothing else, so a Markdown heading underlined with `=` is not
caught.

`tests/conflict_markers.test.ts` runs the guard the way the hygiene job does,
over a throwaway git repository built to carry all four markers. A guard that
is only ever run against a clean tree is one nobody knows the shape of.

## Commits

Conventional commits: `feat:`, `fix:`, `docs:`, `chore:`, `test:`, `refactor:`.

## Releases

A release is one tag carrying the migrations, the packs and the packages
together, and `v0.2.0` is the first. What has to move and in which order is in
[`docs/releasing.md`](docs/releasing.md). Two consequences reach an ordinary
pull request: a published migration is never edited, and anything that ships
gets a line under `[Unreleased]` in [`CHANGELOG.md`](CHANGELOG.md) in the same
pull request that ships it.
