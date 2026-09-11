# `supabase/` — the database

Everything that ends up in your Postgres lives here, and nothing else does.

| Folder | What it is | When it runs |
|---|---|---|
| [`migrations/`](migrations/) | The schema: tables, enums, functions, triggers, row level security | `npx ekwo migrate` or `supabase db push`, once per version, on every installation |
| [`seed/`](seed/) | Reference data: currencies, charts of accounts, taxes, and a demo company | After the migrations; the demo file is opt-in |
| `config.toml` | The Supabase CLI configuration, including which seeds are applied by default | Read by the CLI |

Two rules that hold for the whole folder:

- **A published migration is never edited.** It has already run on databases
  we do not control. Change the schema with a new migration; the CI refuses a
  pull request that touches an existing one.
- **Country rules are data, not code.** A VAT rate, the accounts it posts to
  and the boxes it fills are rows in `seed/`. If you find a wrong box, fix the
  seed row, not a function.

Both installers write the same history. `ekwo migrate` records what it applied
in `supabase_migrations.schema_migrations`, in the Supabase CLI's own format,
so the two are interchangeable in either direction on the same project. The
CLI also carries a copy of this folder inside its published package, and a test
pins that copy to these files byte for byte.

`docs/schema.md` is generated from this folder and describes every table and
column; read it before adding one.
