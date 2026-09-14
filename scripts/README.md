# `scripts/` — repository hygiene

| Script | Purpose | Runs in CI |
|---|---|---|
| `check-no-private-data.mjs` | Refuses the build if any file mentions a term from its deny list (customer and company names of the maintainers' own installations). Keep the list current; extend it before adding a seed or a fixture | yes |
| `generate-schema-doc.mjs` | Rewrites `docs/schema.md` from `supabase/migrations/`, splicing `docs/schema.intro.md` at the top. Needs Node 22.18+ or 24 (it imports a `.ts` file directly) | no — run it and commit the result |
| `generate-expected-objects.mjs` | Rewrites `packages/cli/assets/expected-objects.json`: every table, column, view, function, policy, trigger and type this release defines, and under `grants` which of `anon`, `authenticated` and `service_role` may reach each of them. `ekwo doctor` compares a live database against it. Same Node requirement as above | yes — it regenerates and refuses a diff |
| `e2e-supabase.mjs` | Installs, books a year, files the VAT return and closes it — against a **real, empty** Supabase project, through the published binary, GoTrue and PostgREST. Refuses a database that already holds an `instance` row | no, and never: it costs money and needs a throwaway project |

```sh
npm run check:no-private-data
npm run docs:schema
npm run inventory
npm run build && npm run e2e:supabase   # by hand, before a release is tagged
```

A third check, that no published migration is modified or deleted, is a job
of the CI workflow itself (`.github/workflows/ci.yml`).
