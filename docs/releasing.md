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

2. **The package versions.** Every workspace manifest, the private root
   included:

   ```sh
   npm version <x.y.z> --workspaces --include-workspace-root --no-git-tag-version
   npm install --package-lock-only
   npm ci     # this must pass before anything else is run
   ```

   Check the dependency ranges between the workspaces afterwards —
   `@ekwo-ai/core` on `@ekwo-ai/fec`, `@ekwo-ai/mcp` on both — and the
   formatting of the manifests, which npm rewrites.

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
   migrations. CI compares the committed file with what the generator
   produces.

6. **The checks.**

   ```sh
   npm run typecheck && npm test && npm run build
   node scripts/check-no-private-data.mjs
   node packages/cli/dist/bin.js --version    # prints the new number
   ```

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
