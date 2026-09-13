# `modules/` — one Postgres schema each, beside the socle

The socle is `public`: companies, accounts, taxes, entries, documents, the
reports. What is built beside it lives here, one folder and one schema per
module.

| Module | Schema | Posts to the ledger | Country data |
|---|---|---|---|
| [`assets`](assets/) | `assets` | yes, through `post_module_entry()` | `packs/<cc>/assets.json` |
| [`budgets`](budgets/) | `budgets` | no | none |

`schema/module.1.json` is the published shape of a `module.json`, and
`ekwo module list` refuses one that does not match it.

## The rules, in one screen

1. **One schema, and the socle is not it.** A module depends on `public` by
   foreign key; the socle has no hook, no callback and no idea it exists.
2. **The ledger only through `post_module_entry()`.** The words `entries` and
   `entry_lines` never appear in a write statement here, and a test over every
   file of this folder refuses one that does. Reading the ledger is allowed.
3. **Row level security on every table**, through `module_enabled()` where the
   table carries a `company_id`.
4. **A module does its own grants.** `public` gets them from Supabase; a schema
   a migration created gets nothing.
5. **A country is data.** No module names one. What Belgium decides is in
   `packs/be/<section>.json` and compiles into `supabase/seed/modules/<code>/`.
6. **The registry is a table.** The last statement of a module's first
   migration writes its row into `public.modules`.

Migrations live in `<code>/supabase/migrations/`, share the socle's history
with the module in the recorded `name`, and their timestamps sort after the
socle migration the manifest declares it needs, `requires_socle_min`. Tests live in `<code>/tests/` and the root `npm test` runs
them.

The full version, and how to write a module in a day, is
[`docs/modules.md`](../docs/modules.md). Why it is shaped this way is in
[`docs/decisions.md`](../docs/decisions.md).
