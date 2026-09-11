# `scripts/` — repository hygiene

| Script | Purpose | Runs in CI |
|---|---|---|
| `check-no-private-data.mjs` | Refuses the build if any file mentions a term from its deny list (customer and company names of the maintainers' own installations). Keep the list current; extend it before adding a seed or a fixture | yes |
| `generate-schema-doc.mjs` | Rewrites `docs/schema.md` from `supabase/migrations/`, splicing `docs/schema.intro.md` at the top. Needs Node 22.18+ or 24 (it imports a `.ts` file directly) | no — run it and commit the result |

```sh
npm run check:no-private-data
npm run docs:schema
```

A third check, that no published migration is modified or deleted, is a job
of the CI workflow itself (`.github/workflows/ci.yml`).
