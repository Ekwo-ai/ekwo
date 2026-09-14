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

   It asks for the connection string, the country, the chart of accounts and
   the language where the pack offers a choice, your organisation, the
   currency, the first company, the address of the first administrator and —
   optionally — the IBAN of your main bank account, then does the rest. Five
   to ten seconds on a free project. Nothing is preselected for you on the
   three questions whose wrong answer is expensive: the country, the chart and
   the language.

4. **Sign in** to your project as that administrator and start booking. Until
   the Community web application lands, the interface is the REST API Supabase
   generates from the schema, or `psql`, or `@ekwo-ai/core`.

5. **Do the four things below**, while the dashboard is still open. The
   installer prints them at the end of a successful run, because three of them
   are settings of your project rather than rows in your database, and nothing
   holding a connection string can reach them.

Everything above in one non-interactive line:

```sh
npx ekwo init \
  --db-url "postgresql://postgres.YOURREF:PASSWORD@aws-1-eu-west-3.pooler.supabase.com:5432/postgres" \
  --supabase-url "https://YOURREF.supabase.co" \
  --service-role-key "$SUPABASE_SERVICE_ROLE_KEY" \
  --country BE \
  --chart default \
  --language fr \
  --org "My Organisation" \
  --company "My Company" \
  --admin-email "you@example.com" \
  --admin-password "a-long-password" \
  --fiscal-year 2026 \
  --iban "BE71096123456769" \
  --yes
```

`--chart` and `--language` are in that line because the Belgian pack offers a
choice on both, and `--yes` means there is nobody to ask. See "Installing
without a terminal" below.

## Installing without a terminal

`--yes` turns off every question, and then every answer has to arrive as a flag
or an environment variable. Two of them are worth knowing about before you
write the script, because `ekwo init` **refuses rather than picking one for
you**:

- **the chart of accounts**, where the country publishes more than one. Belgium
  publishes two, a company chart and an association chart. Pass `--chart`; the
  refusal lists the codes the pack carries.
- **the language of the books**, where the pack publishes more than one. Pass
  `--language`; the refusal lists them. The choice decides which label of the
  pack lands in `accounts.name`, and the others stay beside it in `name_i18n`,
  so it is not irreversible — but it is not a question a script should answer
  by accident either.

`--country` behaves the same way and has no default at all: the refusal names
the packs the database holds. A preselected country is a chart of accounts
nobody chose.

The same is true of the financial year: a pack that declares no usual opening
month makes `--fiscal-year-start` required. Both packs shipped here open on the
calendar year, so it rarely comes up.

## Where table access comes from

**The schema grants its own rights.** Every table, view and function of Ekwo
names the roles that may reach it — `anon`, `authenticated`, `service_role` —
in the migration that creates it. `ekwo doctor` reads the privileges of a live
database and reports a grant that is missing, a grant wider than the release
declares, and a table `anon` can reach at all.

Two rules follow, and both are worth knowing before you change anything by
hand.

**`anon` holds no privilege on any table.** The anonymous role — the one behind
the publishable key your front end ships — may execute the ten helper functions
row level security calls on its behalf, and nothing else. An anonymous request
to a table is refused at the privilege, before any policy is read. If part of
your application reads a table without signing a user in, it will stop working,
and that is the intended answer: sign the user in, or grant a function
deliberately.

**`authenticated` may attempt exactly the verbs a policy of that table is
prepared to judge.** A grant and a policy are two halves of one sentence: a
grant says which verbs may be attempted, a policy says on which rows they
succeed. The reference tables a country pack fills, the tables written only by
a `security definer` function, and the audit trail are readable and not
writable — by privilege as well as by policy.

**It was not always so, and the history explains a symptom you may still meet
on an installation nobody has migrated.** Until the migration of 14 September
2026, nothing in `supabase/migrations` granted table access at all. Row level
security was written in the migrations in full and the underlying `GRANT` was
not: on a Supabase project it came from that project's own default privileges
on the `public` schema, which are there before Ekwo is. Those privileges live
in `pg_default_acl`, keyed by the schema, so dropping and recreating `public`
took them away — and then the reinstall succeeded, `ekwo doctor` reported a
healthy installation, and the first read through PostgREST answered
`permission denied for table companies`. Nothing was wrong with the schema; the
grant that had never been in it was missing.

On an installation that has run `ekwo migrate` since, that cannot happen: the
migrations put the privileges back themselves, and they take away the blanket
table access the project's defaults had handed `anon`. Dropping `public` is
still not something to do on a project you intend to keep — it takes your books
with it. The decision and what it changed are in
[`docs/decisions.md`](../../docs/decisions.md).

## Before you go live: four things on your project

An installation leaves four things undone, and they are undone on purpose:
they are yours to decide, on a project Ekwo does not have access to. `ekwo
init` prints this list at the end of a successful run. `ekwo doctor` does not
check it and does not mention it — a database connection cannot see the
settings of the project it is connected to.

**1. Turn off self sign-up on your project.**
Supabase dashboard → **Authentication → Sign In / Providers → "Allow new users
to sign up"**, and switch it off. A fresh Supabase project accepts anyone who
posts an e-mail address and a password to its authentication endpoint, which is
the right default for a public application and the wrong one for a set of
books. An Ekwo installation is closed: the people who keep the books are
invited to it. Row level security means a stranger who signs up sees nothing —
they are a member of no company — but they are a row in `auth.users` that
nobody asked for, on a project whose sign-up endpoint is open to the internet.

**2. Keep two administrators.**
An instance administrator is what claims the instance and invites everybody
else. With one, a lost password, a closed mailbox or a person on holiday is a
set of books that nobody can let anyone into. Create the second account in your
Supabase Auth and add it with `claim_instance_admin()`, or invite it from the
application once it is signed in.

**3. Keep the service_role key off every machine that does not need it.**
It is not a powerful user: it is the absence of a door. A request carrying it
bypasses row level security entirely and reads every company in the instance.
This CLI reads it from a flag, an environment variable or a masked prompt, uses
it once to create the first account, and writes it nowhere — see
[Secrets](#secrets). Anywhere else it sits, it sits as a copy of your whole
ledger. `--admin-user-id` installs against an account that already exists and
needs no key at all.

**4. Read DISCLAIMER.md before you file anything.**
[`DISCLAIMER.md`](../../DISCLAIMER.md), at the root of the repository. A
country pack is a reading of a country's rules at the date of its version, and
its golden test proves that the pack agrees with itself — not that it agrees
with the law. `ekwo init` prints the certification status of the pack it
installs for the same reason. The books are yours, in every country where you
file.

None of these is an action Ekwo performs on your project, now or later. The
project is yours from the first row: the settings are yours to change, the key
is yours to hold, and what you file is yours to answer for.

Automatic verification of the first three is a phase 1 question, and it is not
free: they are answered by the Supabase management API, so checking them means
handing `ekwo doctor` a management token, and a token that can read a project's
settings can change them. Until that trade is worth making, the list is printed
and read by a person.

## What `init` does, step by step

| Step | What happens | Why it is done this way |
|---|---|---|
| 1 | Applies `supabase/migrations/*.sql` in order | Recorded in `supabase_migrations.schema_migrations`, the Supabase CLI's own history table, so `supabase db push` and `ekwo migrate` stay interchangeable |
| 2 | Applies the six reference seeds, in file-name order: `00_currencies.sql`, `05_framework_generic.sql`, `10_pack_be.sql`, `11_pack_fr.sql`, `12_pack_lu.sql`, `13_pack_ee.sql` | The currencies, the country-less financial statements every chart falls back on, and the four country packs. They are exactly the six `supabase/config.toml` lists, so `supabase db push` installs the same set; a test compares both paths row by row. `90_demo_company.sql` is sample data and is never applied here |
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
| `ekwo doctor` | Every object this release defines and every privilege it grants, against what the database holds; row level security on every table, a policy on every protected table, no pending migration, no membership pointing at a deleted user, every company with a bank account, statements that tie to their lines, posted entries that balance. Exits 1 on a problem, 0 on warnings. |
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

## `ekwo doctor`

What a healthy installation is true of, and nothing in the schema can enforce
on its own. It reads and reports; it never repairs, because the fix for a
missing policy is a migration and the fix for an orphaned membership is a
decision about who should have access.

```sh
ekwo doctor --db-url "$URL"          # readable
ekwo doctor --db-url "$URL" --json   # the whole report, findings included
```

**The `catalogue` check compares your database to an inventory of everything
this release defines** — tables and their columns, views, functions with their
identity arguments, policies, triggers and types. That inventory is
[`assets/expected-objects.json`](assets/expected-objects.json), generated from
the migrations themselves and shipped inside this package, so it cannot be a
list somebody forgot to update. In `--json` output it is the check named
`catalogue`. Four outcomes, and they are not the same thing:

| Finding | What it means | Severity |
|---|---|---|
| Missing | The installation is behind or has been damaged. | Problem |
| Extra | Your own table, function or trigger. Reported so you know it is there. | Information |
| Extra or missing **policy** on a table of this schema | Row level security is the security model. A policy that is gone closes everything; one that was added is a grant nobody reviewed. | Problem |
| A column whose type has moved | The schema was patched by hand. Reported as **changed**, not as missing: "missing" would send you looking for a migration that did land. | Problem |

A module's objects are required only of a database that carries the module.
One you never installed is named and skipped.

**A database older than this CLI is still compared.** The report says which
schema version the inventory describes and which one the database reports, and
goes on to list what differs — refusing to look would be refusing the case the
check exists for.

**Exit codes.** `0` when there is no problem, warnings and information
included; `1` when there is at least one problem, or when the schema is not
installed at all. Nothing else. So `ekwo doctor` is usable as a deployment
gate, and an operator's own extra table never turns a pipeline red.

**What the catalogue does not cover.** Constraints, indexes and the bodies of
functions. A dropped unique index is real damage and this check will not see
it: the question it answers is "is the object there, and is it still that
shape". `docs/schema.md` lists the constraints for a human reader, and the
argument against putting them in the inventory is that each is an order of
magnitude more text for a diff that would move on every Postgres upgrade — and
an inventory whose diff nobody reads is worth nothing.

**The `grants` check compares the privileges**, from the same inventory: the
`grants` section of each schema says which of `anon`, `authenticated` and
`service_role` may reach each table, view and function, and with which verbs.
Its own check rather than a category of `catalogue`, because the rule is not
the same.

| Finding | What it means | Severity |
|---|---|---|
| A privilege the release grants and the database does not hold | Nothing else notices it, and it reaches a client as `permission denied for table companies`. | Problem |
| Any privilege `anon` holds beyond what the release grants | The anonymous role reaches the ten policy helpers and no table. One more is a surface nobody reviewed. | Problem |
| A privilege `authenticated` or `service_role` holds and the release does not grant | Usually a local customisation. Row level security is then the only thing refusing a verb the schema meant to withhold. | Warning |
| A default privilege still standing on a schema | A privilege that comes from there comes from something no migration wrote, and a recreated schema takes it away. | Warning |

In a checkout, `npm run inventory` regenerates the inventory from the
migrations; the CI regenerates it and fails on any difference, the way it does
for `docs/schema.md`, and a second job checks that the copy shipped in `dist`
is the one in the repository.

## `ekwo pack`, in a checkout

A country is data: `packs/<cc>/` holds a manifest, the chart of accounts as
CSV, the taxes and where they post, the boxes of the declaration, the financial
statements, the sentences the country requires on an invoice, the translations,
and a year of books with the figures it produces. The compiler turns one into
`supabase/seed/<n>_pack_<cc>.sql`, which is committed — and, where a pack
carries a section for a module, into
`supabase/seed/modules/<code>/<n>_pack_<cc>.sql`, applied by the module
migration runner and by nothing else.

```sh
ekwo pack list           # the packs this checkout carries, and their certification
ekwo pack build be       # write supabase/seed/10_pack_be.sql from packs/be
ekwo pack build --all
ekwo pack check be       # validate one pack and compare its seed
ekwo pack check --all    # exit 1 if a committed seed is not the output of its pack
```

`check` validates every file of the pack against
[`packs/schema/pack.1.json`](../../packs/schema/pack.1.json) and against the
rest of the pack, then compares the committed seed with what the compiler makes
of it now. It is what the CI runs, so the SQL cannot drift from the pack. Every
rule it applies is listed in [`docs/packs.md`](../../docs/packs.md), under
"What `ekwo pack check` refuses".

Neither command touches a database: the seed is applied by `ekwo init`,
`supabase db push` or `psql -f`, like every other seed. A published
installation has the compiled seeds and no `packs/` folder, and the command
says so rather than guessing.

Two commands under `ekwo pack` do the opposite and read an installation rather
than a checkout, so they take a connection and work without `packs/`:

```sh
ekwo pack status --db-url "$EKWO_DB_URL"          # which pack version each company copied
ekwo pack upgrade "My Company" --db-url "…"       # move it to the version this installation holds
```

`status` changes nothing and exits 1 while a company is behind, so a scheduled
job can ask. `upgrade` applies an addition and a closed validity by itself,
lists everything else for a person to read, and never removes anything from a
company's books; `--apply` is what accepts the differences it listed.

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
| `--country <cc>` | Which country pack: its chart of accounts, its journals, its taxes and its declaration. One of the packs the database holds — `ekwo pack list` names them, and there is no default. |
| `--chart <code>` | Which chart of accounts, where the country publishes several. Required outside a terminal when it does. |
| `--org <name>` | Your organisation, written on the instance row. |
| `--company <name>` | The first company. Defaults to `--org`. |
| `--admin-email <address>` | The first administrator, created in your Supabase Auth. |
| `--admin-password <pw>` | Their password. Omitted, an invite link is generated and printed. |
| `--admin-user-id <uuid>` | Use an account that already exists, instead of creating one. |
| `--fiscal-year <year>` | Calendar year of the first financial year. Defaults to this year. |
| `--fiscal-year-start <date>` | The day that year opens, as `YYYY-MM-DD`. Needed only where the pack names no usual opening month; the two packs shipped both open on the calendar year. |
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

The test suite runs against Postgres compiled to WebAssembly, so it proves the
migration runner, the installation sequence and the checks without a Supabase
project. Four things it cannot prove: the network driver, PostgREST, GoTrue,
and the extensions a hosted project has.

**The automated way.** From a checkout of the repository, against an empty
project you can throw away:

```sh
npm run e2e:supabase
```

It installs, migrates, upgrades the pack, signs in, books, files the
declaration and closes the year, and prints a pass/fail table with **how long
each step took** — which is the number worth reading, because what matters
about a release is which step holds it rather than the total. Everything comes
from the environment and no secret reaches the output; it refuses a database
that already holds an `instance` row, and `--reset` empties a throwaway project
so a failed run can be replayed.

Point `EKWO_E2E_PREVIOUS` at the last tag to make the run upgrade an
installation instead of creating one. The packages are not on npm yet, so it
takes **a path to a built binary of an older checkout** rather than a version:

```sh
git worktree add /tmp/prev v0.2.0
(cd /tmp/prev && npm ci && npm run build)
EKWO_E2E_PREVIOUS=/tmp/prev/packages/cli/dist/bin.js npm run e2e:supabase
```

[`docs/releasing.md`](../../docs/releasing.md) lists every variable it reads and
every refusal it makes. It is run by hand before a release is tagged, never by
the CI.

**By hand**, if you want to watch each step:

```sh
npm install && npm run build

# 1. A project you can throw away. Note its ref, password, URL and key.
#    --chart and --language are required here and not optional: the Belgian
#    pack publishes two charts of accounts and four languages, and `ekwo init`
#    refuses to pick either for you when there is nobody to ask.
node packages/cli/dist/bin.js init \
  --db-url "postgresql://postgres.SCRATCHREF:PASSWORD@aws-1-REGION.pooler.supabase.com:5432/postgres" \
  --supabase-url "https://SCRATCHREF.supabase.co" \
  --service-role-key "$KEY" \
  --country BE --chart default --language fr \
  --org "Scratch" --company "Scratch BV" \
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
  --chart default --language fr \
  --org "Scratch" --company "Scratch BV" --admin-email "you@example.com" \
  --admin-user-id "<the uuid from step 1>" --fiscal-year 2026 --yes

# 6. Sign in as the administrator and confirm row level security really binds:
#    a company you were not invited to must be invisible.
```

## Licence

[AGPL-3.0-only](../../LICENSE) © Ekwo AI.
