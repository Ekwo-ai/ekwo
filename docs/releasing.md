# `docs/releasing.md` — how a release is cut

A release of Ekwo OS is one tag carrying the migrations, the country packs and
the npm packages together. There is no "down": a database that has run a
migration cannot be walked back, so every release is forward, and the version
a database answers with is what a client decides on.

`v0.2.0`, on 14 September 2026, is the first published release. `0.1.0` was the
first schema of this repository and was never tagged.

## What has to move, and in which order

Nothing below is optional. Each step fails a test or the build when it is
skipped, which is deliberate: a release that is half done is worse than one
that is not cut.

1. **The schema version.** A migration
   `supabase/migrations/<YYYYMMDDHHMMSS>_schema_version_<x_y_z>.sql` that
   redefines `ekwo_schema_version()` to return the new number, keeping the
   comment and ending with the revoke every migration ends with. It is the
   only thing that migration does. `instance.schema_version` follows on its
   own: the column default and `init_instance()` both call the function, and
   `ekwo migrate` writes it back onto an installation that already exists.

   Bump it when the release adds anything a package of this release reads — a
   table, a column, a function. A release that touches no schema keeps the
   number and needs no migration.

   `tests/cli/schema-version.test.ts` writes the three numbers out by hand —
   `RELEASE`, `PREVIOUS` and `BUMP`, the name of the migration that carries
   nothing else — because a test that asks the code what it says proves
   nothing. Move them in the same commit.

2. **The package versions.** Every workspace manifest, the private root
   included:

   ```sh
   npm version <x.y.z> --workspaces --include-workspace-root --no-git-tag-version
   npm install --package-lock-only
   npm ci     # this must pass before anything else is run
   ```

   Check the dependency ranges between the workspaces afterwards —
   `@ekwo-ai/core` on `@ekwo-ai/fec`, `@ekwo-ai/mcp` on both — and the
   formatting of the manifests, which npm rewrites. The final `npm install`
   `npm version` runs on its own fails until those ranges name the new number,
   because a workspace at `0.3.0` no longer answers a range of `^0.2.0` and npm
   goes looking on the registry for a package that is not there.

   `SERVER_VERSION` in `packages/mcp/src/server.ts` follows the manifest, for
   the reason `SCHEMA_MIN` does: a bundle that ships no manifest still has to
   say what it is in the MCP handshake. A test keeps the two equal.

3. **The schema floor.** `ekwo.schemaMin` in the manifests of `ekwo`,
   `@ekwo-ai/core` and `@ekwo-ai/mcp`, and the `SCHEMA_MIN` constant in each
   package's `src/schema.ts`. A test keeps the manifest and the constant
   equal, and another refuses a floor newer than the schema the release
   defines.

   Raise it when the packages of the release read something an older database
   does not have. It is a floor, not the version: a release that adds nothing
   a package reads leaves it where it is. The MCP server refuses a database
   below it by name, and says to run `ekwo migrate`.

4. **The changelog.** `CHANGELOG.md` follows
   [Keep a Changelog](https://keepachangelog.com/en/1.1.0/): `[Unreleased]`
   becomes `## [x.y.z] — YYYY-MM-DD`, a fresh empty `[Unreleased]` goes above
   it, and a link reference at the bottom points at the release. Group the
   entries Added / Changed / Removed / Fixed / Security, once each. Read
   `git log` against it before you close the section; what shipped without a
   line is what nobody will find later.

5. **The generated documentation.** `npm run docs:schema`, because the version
   migration changes a function body and `docs/schema.md` is the output of the
   migrations. `npm run inventory` is in the list below for the same reason:
   `packages/cli/assets/expected-objects.json` carries the objects this
   release defines and the privileges it grants on them, and it travels inside
   the published package for `ekwo doctor` to read. CI compares both committed
   files with what the generators produce.

6. **The checks.**

   ```sh
   npm run typecheck && npm test && npm run build
   node scripts/check-no-private-data.mjs
   node packages/cli/dist/bin.js --version    # prints the new number
   ```

7. **The end-to-end run, against a real project.** `tests/e2e/` proves the
   whole story against PGlite — the same release installed through the CLI and
   the way `supabase db push` and `psql -f` do, compared row by row, then a
   company brought from 1.0.0 through an opening balance, two invoices, the VAT
   return, both financial statements, a close, a re-opening and a close again.
   PGlite is real Postgres and four things it is not, and they are the four
   that break a release:

   - the published binary, over a pooler connection string;
   - PostgREST — a function that exists and was never granted to
     `authenticated` passes every test in this repository and answers
     "permission denied" to the first user;
   - GoTrue, so row level security judged on a real JWT rather than on a
     session variable a test set;
   - the extensions, roles and defaults a hosted project has.

   ```sh
   npm run build
   npm run e2e:supabase
   ```

   It reads everything from the environment and writes no secret anywhere:

   | Variable | What |
   |---|---|
   | `EKWO_DB_URL` | the pooler connection string of the project |
   | `SUPABASE_URL` | `https://<ref>.supabase.co` |
   | `SUPABASE_ANON_KEY` | the anon key — what a real client sends |
   | `SUPABASE_SERVICE_ROLE_KEY` | used once, by `ekwo init`, to create the administrator |
   | `EKWO_E2E_COUNTRY` | the pack to install. No default: a default country is a chart of accounts nobody chose |
   | `EKWO_E2E_CHART` / `EKWO_E2E_LANGUAGE` | required whenever the pack carries more than one of either — `ekwo init` refuses to pick for you when there is nobody to ask, which is the right answer and the first thing this script found |
   | `EKWO_E2E_ADMIN_EMAIL` / `EKWO_E2E_ADMIN_PASSWORD` | the administrator it creates and signs in as |
   | `EKWO_E2E_PREVIOUS` | optional: install that release first, so the run upgrades an installation instead of creating one. Left out, those steps are skipped rather than passed |

   **Point `EKWO_E2E_PREVIOUS` at the last tag.** It is the only way the run
   exercises what a user will actually do, and the packages are not on npm yet,
   so it takes a path to a built binary of an older checkout:

   ```sh
   git worktree add /tmp/prev v0.2.0
   (cd /tmp/prev && npm ci && npm run build)
   EKWO_E2E_PREVIOUS=/tmp/prev/packages/cli/dist/bin.js npm run e2e:supabase
   ```

   Once they are published, `ekwo@<x.y.z>` works in the same variable. They are
   not today — `npm view ekwo` answers 404 — so the path is the only form that
   works.

   **Read the times, not only the marks.** Every step of the table carries how
   long it took and the run carries its total. What is worth noticing is which
   step holds the release: a migration set that doubled since the last tag, a
   first query waiting on a cold project, a close that got slower as the ledger
   grew. A number that moved between two releases is the question; the total on
   its own answers nothing.

   **The project has to be empty, and has to be one nobody minds losing.** The
   script installs an instance, an administrator and a company, books into them
   and closes a financial year, so it refuses a database that already holds an
   `instance` row. It deletes nothing on its own: what is left behind is the
   evidence. It is not in the CI and never will be — it costs money, and a
   shared throwaway project would be a project two releases install into at
   once.

   **`--reset` empties the project so a failed run can be replayed.** It drops
   the module schemas, `public` and `supabase_migrations`, and recreates the
   schema with the default privileges a Supabase project has. Since
   `20260914151207` the migrations no longer need that — they grant their own
   rights, by name — and the reset restores the defaults anyway, on purpose: a
   real project has them, and a reset that left them out would be a reset that
   quietly stopped exercising what that migration does about them. What the run
   should then find is the revoke working, which is the step named "the
   anonymous role reaches no table". Before all this, a reset that forgot the
   defaults left an installation `ekwo doctor` called healthy and PostgREST
   answered `permission denied for table companies` on.

   ```sh
   npm run e2e:supabase -- --reset
   ```

   It is as destructive as it sounds and it is deliberately not an `ekwo`
   command: an installer that can empty a database is one somebody points at
   the wrong connection string. For a throwaway project and nothing else.

## Cutting it

1. Open a pull request with all of the above. The CI job *Migrations are
   additive* compares the branch against `main` and, on a push, against the
   latest tag: a published migration that was modified or deleted fails the
   build whatever route it took.
2. Merge it.
3. Tag `main`, annotated, and push the tag:

   ```sh
   git tag -a v<x.y.z> -m "Ekwo OS v<x.y.z>"
   git push origin v<x.y.z>
   ```

   The tag is what the additive-migrations job compares against from then on,
   which is why it is never moved and never deleted.
4. Publish a GitHub Release on that tag, with the changelog section of the
   version as its body.

## npm

The packages are not published yet: there is no npm account for the
organisation. When there is one, publishing is part of the release and comes
after the tag, so a version on npm is always a version someone can read the
source of:

```sh
npm publish --workspace packages/formats/fec --access public
npm publish --workspace packages/formats/factur-x --access public
npm publish --workspace packages/formats/xbrl-cbso --access public
npm publish --workspace packages/formats/intra-consignment --access public
npm publish --workspace packages/formats/des --access public
npm publish --workspace packages/formats/ecdf --access public
npm publish --workspace packages/formats/vd --access public
npm publish --workspace packages/core --access public
npm publish --workspace packages/cli --access public
npm publish --workspace packages/mcp --access public
```

The order is the dependency order: a package is published after everything it
depends on. The root workspace is `private` and is never published.

Until then, `npx ekwo init` in the README is what the CLI will be called, not
what it is reachable as today; an installation runs from a clone.

## After a release

`[Unreleased]` is empty and the next change starts a new section under it. A
published migration is never edited from `v0.2.0` on — not to fix a typo in a
comment, not to correct a value. It has run on databases nobody here controls,
and the correction is a new file.
