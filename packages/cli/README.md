# ekwo

The installer and the operator's tool for [Ekwo OS](https://github.com/Ekwo-ai/ekwo-os).
One command turns a Supabase project you already own into a set of double-entry
books: the schema, the chart of accounts, the VAT codes, the first
administrator, the first company and its first financial year.

```sh
npx ekwo init
```

You need Node 20 or later. That is the whole list. The Supabase CLI is not
required — this talks to Postgres directly — and Docker is not required
either.

## From a free Supabase account to a first invoice

1. **Create a project** at [supabase.com](https://supabase.com). The free plan
   is enough to start. Ekwo does not create it, does not pay for it and has no
   access to it: it is yours from the first row.
2. **Copy two things** from the dashboard:
   - Project Settings → Database → **Connection string** (URI). It contains
     your database password.
   - Project Settings → API → **`service_role` key**, and the **Project URL**.
     These are used once, to create the first administrator in your own
     Supabase Auth, and are never written to disk.

   **Take the pooler string, not the direct one, unless you know you have
   IPv6.** The direct host `db.<ref>.supabase.co` resolves to an IPv6 address
   only on any recent project, so from an IPv4-only network it simply never
   connects. The session pooler answers on IPv4 and supports everything a
   migration needs:

   ```
   postgresql://postgres.<ref>:<password>@aws-1-<region>.pooler.supabase.com:5432/postgres
   ```

   The region is in the hostname the dashboard gives you, and so is the
   generation prefix, which the region does not determine: verified on a real
   project on 11 September 2026 in `eu-west-3`, where `aws-1` worked and
   `aws-0` answered "Tenant or user not found". Copy the line from the
   dashboard — Connect → Session pooler — rather than building it by hand.
3. **Run the installer.**

   ```sh
   npx ekwo init
   ```

   It asks for the connection string, the country, your organisation, the
   currency, the first company, the address of the first administrator and —
   optionally — the IBAN of your main bank account, then does the rest. Five
   to ten seconds on a free project.

4. **Sign in** to your project as that administrator and start booking. Until
   the Community web application lands, the interface is the REST API Supabase
   generates from the schema, or `psql`, or `@ekwo-ai/core`.

Everything above in one non-interactive line:

```sh
npx ekwo init \
  --db-url "postgresql://postgres.YOURREF:PASSWORD@aws-1-eu-west-3.pooler.supabase.com:5432/postgres" \
  --supabase-url "https://YOURREF.supabase.co" \
  --service-role-key "$SUPABASE_SERVICE_ROLE_KEY" \
  --country BE \
  --org "My Organisation" \
  --company "My Company" \
  --admin-email "you@example.com" \
  --admin-password "a-long-password" \
  --fiscal-year 2026 \
  --iban "BE71096123456769" \
  --yes
```

## What `init` does, step by step

| Step | What happens | Why it is done this way |
|---|---|---|
| 1 | Applies `supabase/migrations/*.sql` in order | Recorded in `supabase_migrations.schema_migrations`, the Supabase CLI's own history table, so `supabase db push` and `ekwo migrate` stay interchangeable |
| 2 | Applies the reference seeds | Currencies, the Belgian PCMN and the French PCG, their VAT codes. `90_demo_company.sql` is sample data and is never applied here |
| 3 | Creates the first administrator through the Supabase Auth admin API | See below: a database connection cannot be a signed-in user |
| 4 | `init_instance()`, `claim_instance_admin()`, the company, `company_members` as owner, `install_country_template()`, the first financial year, and the bank account when an IBAN was given | The six steps of the root README, in the same order, plus the one thing nobody can derive |
| 5 | Writes `ekwo.json` | Project URL, country, schema version. Nothing else, ever |
| 6 | Asks whether to register with Ekwo | The default answer is no, and no is a supported answer forever |

Every step checks before it acts. Running `ekwo init` twice on the same
project reports what was already there and creates nothing a second time.

### Why the first user goes through Supabase Auth

Every row level security policy in the schema compares `auth.uid()` against a
row, and `auth.uid()` reads the JWT of the request. The CLI holds a Postgres
connection, not a session: it runs as the database owner, `auth.uid()` is
NULL, and row level security is *bypassed* rather than satisfied. So the
installer cannot be the first user. It can only create one and then write the
rows that user will be recognised by.

Creating that user in SQL is not an option either. `auth.users` belongs to
GoTrue — the password hash, the confirmation state, the identity row — and
writing it by hand produces an account that looks right and cannot sign in.
Hence the order: the admin API first, its user id second, `instance_admins`
and `company_members` third.

This is the only reason `--service-role-key` exists. Pass `--admin-user-id`
instead if the account already exists, and no key is needed.

## Commands

| Command | What it does |
|---|---|
| `ekwo init` | The whole installation, interactive or not. |
| `ekwo migrate` | Applies the migrations this release adds, after showing the gap — the socle's, then the modules'. Re-applies the reference seeds, which are idempotent. `--no-modules` leaves the modules alone. |
| `ekwo status` | Schema version installed against available, pending migrations, the instance, its administrators, the country packs it holds and, per company, the pack version it copied. Exits 1 when something is pending. |
| `ekwo doctor` | Row level security on every table, a policy on every protected table, no pending migration, no membership pointing at a deleted user, every company with a bank account, statements that tie to their lines, posted entries that balance. Exits 1 on a problem, 0 on warnings. |
| `ekwo register` | Opt in to security advisories and release notes. Also the retry when the announcement did not go through. |
| `ekwo unregister` | Opt back out. Clears the address and the date on the instance row. |
| `ekwo demo` | Loads the sample company. Fictional data, explicit request only. |
| `ekwo module` | What is installed beside the socle, applies a module's migrations and its country seeds, and turns one on or off for a company. |
| `ekwo pack` | Compiles a country pack into its seed, and refuses a seed that is no longer the output of its pack. Runs in a checkout of the repository only. |

There is no `eject`, because there is nothing to eject from. The schema is in
your database, the migrations are in the repository under AGPL-3.0, and
`supabase db push` applies them without this CLI ever running again.

## `ekwo module`

A module is a Postgres schema beside the socle — `assets` for fixed assets,
`budgets` for a plan against the ledger. Its migrations travel with this
package, and `ekwo migrate` applies them by default.

```sh
ekwo module list                          # what this release carries, and what the database holds
ekwo module migrate [<code>]              # the migrations, and the country seeds they need
ekwo module enable assets --company "…"   # turn it on for one company
ekwo module disable assets --company "…"  # turn it off; nothing it wrote is deleted
```

`enable` and `disable` go through `enable_module()` and `disable_module()`
rather than writing the table: the guard is in the function, so it applies to
psql and PostgREST alike. The CLI sets the request claim for an owner of the
company, the way `ekwo register` does, and `--as-user <uuid>` names another.

**One thing this CLI cannot do**, and says so every time: PostgREST serves a
schema other than `public` only once the project lists it under its exposed
schemas. That is a setting of the API, not of the database, so `ekwo module
enable` prints the line to add — Supabase dashboard → Project Settings → API,
or `[api] schemas` in `supabase/config.toml`.

**Before `supabase db push`**, run `ekwo migrate --no-modules`. The Supabase
CLI knows the socle's migration files and not a module's, so it would report
them as history it has no file for.

## `ekwo pack`, in a checkout

A country is data: `packs/<cc>/` holds a manifest, the chart of accounts as
CSV, the taxes as JSON, and — accepted today, compiled by later sub-tasks —
the declaration boxes, the financial statements and the translations. The
compiler turns one into `supabase/seed/<n>_pack_<cc>.sql`, which is committed —
and, where a pack carries a section for a module, into
`supabase/seed/modules/<code>/<n>_pack_<cc>.sql`, applied by the module
migration runner and by nothing else.

```sh
ekwo pack list           # the packs this checkout carries, and their certification
ekwo pack build be       # write supabase/seed/10_pack_be.sql from packs/be
ekwo pack build --all
ekwo pack check --all    # exit 1 if a committed seed is not the output of its pack
```

`check` is what the CI runs, so the SQL cannot drift from the pack. Neither
touches a database: the seed is applied by `ekwo init`, `supabase db push` or
`psql -f`, like every other seed. A published installation has the compiled
seeds and no `packs/` folder, and the command says so rather than guessing.

## Flags

Every command takes the connection flags:

| Flag | Meaning |
|---|---|
| `--db-url <url>` | Postgres connection string. The reliable way. |
| `--project-ref <ref>` | With `--db-password` and `--db-region`, the session pooler host. |
| `--db-password <pw>` | Database password. Prompted, masked, when omitted. |
| `--db-region <region>` | With `--project-ref`, the session pooler in that region. Both generation prefixes are tried and the one that answers is kept. |
| `--supabase-url <url>` | `https://<ref>.supabase.co`. Needed only to create a user. |
| `--service-role-key <key>` | Needed only to create a user. |
| `--yes`, `-y` | Never ask a question. Everything must come from flags or the environment. |

`--project-ref` with `--db-password` and `--db-region` builds the session
pooler host. It no longer guesses which one: the pooler hostname carries a
generation prefix as well as a region, and the region does not determine it,
so `aws-0-<region>` and `aws-1-<region>` are both opened on port 5432 and the
one that answers is kept and printed. Without `--db-region` nothing is
derived — the CLI asks for the connection string, because the direct host
`db.<ref>.supabase.co` is IPv6-only on recent projects and deriving it
silently produces a hang rather than an error. `--db-url`, copied from the
dashboard under Connect → Session pooler, is the form that is never derived.

`ekwo init` adds:

| Flag | Meaning |
|---|---|
| `--country BE\|FR` | Which chart of accounts and VAT rules. |
| `--org <name>` | Your organisation, written on the instance row. |
| `--company <name>` | The first company. Defaults to `--org`. |
| `--admin-email <address>` | The first administrator, created in your Supabase Auth. |
| `--admin-password <pw>` | Their password. Omitted, an invite link is generated and printed. |
| `--admin-user-id <uuid>` | Use an account that already exists, instead of creating one. |
| `--fiscal-year <year>` | Calendar year of the first financial year. Defaults to this year. |
| `--currency <code>` | Currency of the company. Defaults to what the country model says: `EUR` for both countries shipped. |
| `--language <xx>` | Language of the books, two letters. Defaults to `country_defaults.language_default`, which the pack fills. It decides which label of the pack lands on each account; the others are kept in `name_i18n`. |
| `--iban <iban>` | Creates the main bank account, wired to the bank journal and its ledger account. Omitted, no bank account is created and `ekwo doctor` says so. |
| `--bic <bic>` | Optional, on that account. |
| `--bank-name <name>` | Optional. It also names the account in the books. |
| `--demo` | Also load the sample company. |
| `--register` | Register without being asked. `--register-email` sets the address. |
| `--registry-url <url>` | Where the registration is announced. |

`ekwo status` and `ekwo doctor` take `--json`. `ekwo migrate` takes
`--skip-seeds`.

## Environment variables

| Variable | Same as |
|---|---|
| `EKWO_DB_URL` | `--db-url`. `SUPABASE_DB_URL` also works. |
| `EKWO_DB_PASSWORD` | `--db-password` |
| `SUPABASE_URL` | `--supabase-url` |
| `SUPABASE_SERVICE_ROLE_KEY` | `--service-role-key` |
| `EKWO_REGISTRY_URL` | `--registry-url`. Default `https://api.ekwo.ai/v1/registrations`. |
| `NO_COLOR` | Plain output. |

See [`.env.example`](../../.env.example) at the root of the repository.

## Secrets

The CLI never writes a secret to disk. The database password and the
`service_role` key are read from a flag, an environment variable or a masked
prompt, used, and forgotten. There is no credential cache, no dotfile in the
home directory, and nothing in `ekwo.json` but the project URL, the country
and the schema version.

It has one runtime dependency, the Postgres driver. Argument parsing, prompts
and the masked input are a few dozen lines each in this package rather than
packages from the registry, because everything this CLI is handed is a secret
and every dependency added is one more thing that could read it.

## Registering with Ekwo

At the end of `ekwo init` you are asked:

> Register this installation with Ekwo to receive security advisories and
> release notes?

The default answer is no, and no is supported forever. Community works
unregistered: nothing in the schema and nothing in this CLI reads
`contact_email` or `registered_at` to decide what you may do, and `edition`
gates no feature.

If you say yes, two things happen, independently. `register_instance(email)`
writes the address and a date onto your instance row, and a POST goes to
`EKWO_REGISTRY_URL` carrying exactly six fields:

```json
{
  "instance_id": "…",
  "organization": "My Organisation",
  "country": "BE",
  "edition": "community",
  "schema_version": "0.2.0",
  "contact_email": "you@example.com"
}
```

No ledger data, no user list, no connection string. `instance_id` is generated
locally by your own database and is not a licence key: no code path anywhere
checks it.

**The endpoint does not exist yet.** A failed POST is a soft message, not a
failed install: the local record stands and `ekwo register` retries it later.
`ekwo unregister` clears the local fields; it sends nothing, because the CLI
only holds the local row.

## Testing it against a real project

The test suite runs against Postgres compiled to WebAssembly, so it proves
the migration runner, the installation sequence and the checks without a
Supabase project. Two things it cannot prove: the network driver, and GoTrue.
To exercise those, on a scratch project:

```sh
npm install && npm run build

# 1. A project you can throw away. Note its ref, password, URL and key.
node packages/cli/dist/bin.js init \
  --db-url "postgresql://postgres.SCRATCHREF:PASSWORD@aws-1-REGION.pooler.supabase.com:5432/postgres" \
  --supabase-url "https://SCRATCHREF.supabase.co" \
  --service-role-key "$KEY" \
  --country BE --org "Scratch" --company "Scratch BV" \
  --admin-email "you@example.com" --admin-password "a-long-password" \
  --fiscal-year 2026 --iban "BE71096123456769" --yes

# 2. Everything should be green, and nothing pending.
node packages/cli/dist/bin.js status --db-url "$URL"
node packages/cli/dist/bin.js doctor --db-url "$URL"

# 3. The history must be the Supabase one: this should report no difference.
supabase link --project-ref SCRATCHREF
supabase migration list

# 4. And the other direction: db push finds nothing left to do.
supabase db push

# 5. Run init again. Every step should say it was already there.
node packages/cli/dist/bin.js init --db-url "$URL" --country BE \
  --org "Scratch" --company "Scratch BV" --admin-email "you@example.com" \
  --admin-user-id "<the uuid from step 1>" --fiscal-year 2026 --yes

# 6. Sign in as the administrator and confirm row level security really binds:
#    a company you were not invited to must be invisible.
```

## Licence

[AGPL-3.0-only](../../LICENSE) © Ekwo AI.
