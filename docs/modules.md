# Modules

A module is a Postgres schema beside the socle. `assets` holds fixed assets and
their depreciation; `budgets` holds a plan and compares it to the ledger. The
socle stays in `public` and knows nothing about either of them.

The decision behind this, with what it rules out, is in
[`decisions.md`](decisions.md). This document is how to write one.

## The shape

```
modules/assets/
├── module.json                    what it is, where it lives, what it needs
├── README.md                      what it does, and what an accountant should check
├── supabase/migrations/*.sql      its own schema, its own row level security
└── tests/*.test.ts                picked up by the root `npm test`

supabase/seed/modules/assets/      the country data it compiled, if it has any
packs/<cc>/assets.json             the source of that data
```

`modules/schema/module.1.json` is the published shape of a manifest, and
`ekwo module list` refuses one that does not match it.

```json
{
  "code": "assets",
  "name": "Fixed assets",
  "schema": "assets",
  "version": "1.0.0",
  "status": "available",
  "requires_socle_min": "20260913075903",
  "posts": true,
  "mcp": { "prefix": "assets" },
  "pack": { "section": "assets" }
}
```

| Field | What it decides |
|---|---|
| `code` | The key of `public.modules`, and what is written on every entry the module posts. Immutable. |
| `schema` | The Postgres schema. One per module, never `public`. |
| `status` | `draft` is refused by `enable_module()`, `available` is enableable, `deprecated` keeps the companies it has and takes no new one. |
| `requires_socle_min` | The oldest socle migration it needs, by timestamp. `ekwo module enable` checks it against the history. |
| `posts` | Whether it writes to the ledger. A module that says `false` is held to it by a test. |
| `mcp.prefix` | Every MCP tool of the module is `<prefix>_<verb>`. |
| `pack.section` | The file a country pack carries for it: `packs/<cc>/<section>.json`. |

## The six rules

**1. One schema, and the socle is not it.** A module creates its own schema and
everything it owns lives there. It depends on `public` by foreign key —
`companies`, `accounts`, `contacts`, `products`, `fiscal_years` — and the
dependency points one way: the socle has no hook, no callback and no way for a
module to change what posting means.

**2. The ledger only through `post_module_entry()`.** A module hands over a
company, a date, a tag and a list of lines; the function builds the draft and
calls `post_entry()`, which is where sides, rounding, numbering and period
locks live. A module never names `entries` or `entry_lines` in a write
statement, and a test over `modules/**` refuses one that does. Reading the
ledger is another matter and is allowed — `budgets.variance` does exactly that.

```sql
select public.post_module_entry(
  p_company_id  => v_company,
  p_module_code => 'assets',
  p_ref         => 'depreciation:2026-12-31',
  p_date        => date '2026-12-31',
  p_description => 'Depreciation 2026',
  p_lines       => '[{"account_code":"630200","debit":"1200.00"},
                     {"account_code":"241900","credit":"1200.00"}]'::jsonb);
```

The tag `(module_code, ref)` is unique per company, so **a module is idempotent
because the database refuses the duplicate**, not because the module remembered
to look. That is what `entries.module_code` and `entries.module_ref` are for,
and it is why no `entry_kind` value is added per module: a depreciation entry is
an ordinary entry that a report may leave in.

**3. Row level security on every table, through `module_enabled()`.** A table
that carries `company_id` gets a policy of the shape

```sql
create policy assets_select on assets.assets
  for select using (
    public.module_enabled(company_id, 'assets')
    and public.has_capability(company_id, 'assets.read')
  );
create policy assets_write on assets.assets
  for all using (
    public.module_enabled(company_id, 'assets')
    and public.has_capability(company_id, 'assets.write')
  )
  with check (
    public.module_enabled(company_id, 'assets')
    and public.has_capability(company_id, 'assets.write')
  );
```

`module_enabled()` is the module being on for that company **and** the caller
being a member of it, so a stranger gets nothing before a capability is even
asked about. A table with no `company_id` is reference data of the
installation, like `country_defaults`, and gets the signed-in select policy. A
test refuses any other arrangement.

**The capability is the module's own**, declared in the module's own migration
with `capabilities.area` set to the module code — `assets.read` /
`assets.write` / `assets.post`, `budgets.read` / `budgets.write` — and added to
the three presets there too, because the socle filled the owner preset with
`select 'owner', code from capabilities` at its own migration time and a code
that arrives later has to name itself. Borrowing the socle's
`can_write_company()` is what these two did until 13 September 2026, and it
meant whoever could draft a journal entry could also rewrite the fixed asset
register. A test refuses a module policy that tests it.

**4. A module does its own grants.** `public` gets them from Supabase's default
privileges; a schema a migration created gets nothing at all. Every module
migration ends with the same block, and the last line is the one that matters:

```sql
grant usage on schema assets to anon, authenticated, service_role;
grant select on all tables in schema assets to anon;
grant select, insert, update, delete on all tables in schema assets to authenticated, service_role;
grant execute on all functions in schema assets to authenticated, service_role;
alter default privileges in schema assets revoke execute on functions from public, anon;
revoke execute on all functions in schema assets from public;
```

**5. A country is data, here too.** No module names a country. What Belgium or
France decides goes in `packs/<cc>/<section>.json`, is described in
`packs/schema/pack.1.json`, compiles into `supabase/seed/modules/<code>/`, and
lands in reference tables the module reads where they stand. A module whose
pack says nothing refuses by name — `no_assets_country_rules` — rather than
taking another country's answer. **The accounts a module needs are roles of the
chart**, in `defaults.roles` and `country_defaults`, because that is the one
place a pack says which account plays which part, and `ekwo pack check` already
proves every role code exists in every chart of the pack.

**6. The registry is a table.** The last statement of a module's first
migration inserts its row into `public.modules`. There is no plugin registry in
TypeScript: a module that is installed is a schema that exists and a row that
says so, and one query answers "what is here" for the CLI, the MCP server and a
human.

## Migrations

They live in `modules/<code>/supabase/migrations/` and follow the socle's rules
— `YYYYMMDDHHMMSS_subject.sql` from the clock, never a round hour, additive
only, row level security in the file that creates the table, no transaction of
their own. Two rules are theirs alone:

- **A module's timestamps sort after the socle migration its manifest
  declares it needs** (`requires_socle_min`), which is what guarantees the
  objects it builds on already exist. A test refuses one that does not. They
  are *not* asked to sort after every socle migration ever written: the socle
  gains one the week after a module ships, and renaming a published module
  migration to restore a total order is what rule 1 of
  `supabase/migrations/README.md` forbids. `ekwo migrate` applies the socle
  first and the modules after, so the applied order is right whatever the
  timestamps say.
- **They are recorded in the same history**, `supabase_migrations.schema_migrations`,
  with the plain timestamp as `version` and the module in the `name`:
  `assets/assets`. That is what keeps `ekwo migrate` and `supabase db push`
  interchangeable for the socle.

`ekwo migrate` applies the socle's, then every module's, then the reference
seeds and the module seeds. **By default**, because a module is a schema whose
tables are empty and whose row level security is on until a company enables it
— there is nothing to ask before creating them, and a schema whose migrations
are half applied is the state nobody can reason about.

`ekwo migrate --no-modules` leaves them alone, which is what to pass **before
running `supabase db push`**: the Supabase CLI knows the socle's files and not a
module's, so it would report them as history it has no file for.

## The commands

```sh
ekwo module list                          # what this release carries, and what the database holds
ekwo module migrate [<code>]              # apply the migrations, and the country seeds
ekwo module enable assets --company "…"   # turn it on for one company
ekwo module disable assets --company "…"  # turn it off, unless the module says it holds data
```

`enable` and `disable` go through `enable_module()` and `disable_module()`
rather than writing `company_modules`, because the guard lives in the function:
the table has no write policy at all, so the rule applies to psql and PostgREST
alike and not only to clients that respect it. The CLI sets the request claim
for an owner of the company, the way `ekwo register` does.

### `can_disable`, and the absence of it

`disable_module()` looks for `<schema>.can_disable(uuid)` and runs it if it is
there. It returns **null when there is nothing in the way, and a sentence when
there is**:

```sql
create or replace function assets.can_disable(p_company_id uuid)
returns text language sql stable as $$
  select case when exists (select 1 from assets.depreciation_lines l
                            where l.company_id = p_company_id and l.posted_at is not null)
              then 'depreciation has been booked from it' end;
$$;
```

A module that holds nothing a company would lose writes none at all, which is
what `budgets` does — turning it off hides the rows and turning it back on
gives them back. Nothing a module wrote is ever deleted by a disable.

## PostgREST, and the one thing no migration can do

A schema other than `public` is served only once the project lists it under its
exposed schemas. **No migration can set that**: it is a setting of the API, not
of the database. So:

- Supabase dashboard → Project Settings → API → Exposed schemas: add `assets`.
- Self-hosted: add it to `[api] schemas` in `supabase/config.toml` and restart.

`ekwo module enable` prints those two lines every time, and the MCP server turns
the profile error PostgREST answers with into the same sentence.

## MCP

A module's tools are declared as data in
`packages/mcp/src/tools/modules.ts` and registered by a loader that reads
`public.modules`. A module that is not installed is not offered, because a tool
a model cannot use is worse than a tool it cannot see. Adding a module to the
server is adding a toolset to that file and nothing else — the same shape the
registry takes in the database.

## Writing one in a day

1. `mkdir -p modules/<code>/{supabase/migrations,tests}` and write
   `module.json` and `README.md`.
2. One migration: `create schema <code>`, the enums, the tables with their
   foreign keys onto `public`, the functions, the policies, the grants, and the
   `insert into public.modules` last.
3. If the module has a country rule, add `<code>` to `packs/schema/pack.1.json`
   as a `$defs` document, read it in `packages/cli/src/pack/read.ts`, compile it
   in `packages/cli/src/pack/compile.ts`, and run `ekwo pack build --all`.
4. Tests in `modules/<code>/tests/`. The root `npm test` picks them up.
5. `npm run docs:schema` — the generator covers module schemas, one section
   each.
6. Tools in `packages/mcp/src/tools/modules.ts`, under your prefix.

The guards in `tests/modules.test.ts` are what will tell you if you got it
wrong: row level security, `module_enabled()` in the policies, `company_id` on
every table of a company, no country literal, no write to the ledger, the
manifest against its schema, and the migration timestamps in order.
