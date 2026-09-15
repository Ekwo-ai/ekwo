# Decisions

Why the schema is shaped this way. One paragraph each, with the reason, so a
future contributor can argue with the reason rather than guess at it.

## The instance

**One installation belongs to one customer, and `instance` records it.** A
single row — primary key `1`, plus a check constraint, so a second one is
impossible rather than merely unusual — holding a locally generated
`instance_id`, the organisation's name, its country, the edition, the schema
version and the install date. This table is the reason there is no
`tenant_id` anywhere in the schema: the instance *is* the tenant, so the
cross-customer column and its risk of leaking never exist. What remains
inside an instance is several companies and several people with different
rights, which is `company_id` and row level security.

**Registering with Ekwo is an opt-in, and never a condition of use.**
`contact_email` and `registered_at` are empty on a fresh install. Nothing
writes them unless the operator calls `register_instance()`, nothing in this
repository reads them, and `unregister_instance()` puts them back —
because opting in that cannot be undone is not a choice. `instance_id` is
generated locally and is not a licence key: no code path checks it, and no
feature depends on it.

**`edition` records who operates the installation, and gates nothing.**
`community` when you run it yourself, `cloud` when Ekwo does. It is there so
support and migrations know what they are looking at, not so a feature can be
switched off. Gating an accounting feature on a column would make the open
core a demo.

**There is an instance-level role, and it lives in its own table.**
`instance_admins` is keyed on the user alone, because that is genuinely its
key: a company role is keyed by (company, user). Making `company_id` nullable
in `company_members` to hold an instance role would break its primary key and
the meaning of every row in it. The table name carries the role, so there is
no `role` column to get wrong. `member_role` still carries `instance_admin`
as a value, so an interface can render one list of roles for the whole
installation, and `company_members` refuses it by check constraint.

**An instance administrator creates companies and invites members; that is
all.** They can list the companies and administer them, and they cannot read
a ledger they were not invited to. Administering an installation is not the
same as being on the books, and a test asserts the difference.

**The first user to ask takes the instance.** `claim_instance_admin()` is
open while `instance_members` is empty and closed afterwards, which is the
same bootstrap the first member of a company gets. It avoids an installer
that has to hold a password.

**A select policy has to follow every insert policy.** `insert ... returning`
is checked against the select policy as well, and PostgREST always returns
the row, so an administrator creating a company would have seen the row
created and an error returned. `companies_select` and
`company_members_select` therefore admit the instance administrator too. This
is worth writing down because the symptom — "violates row-level security" on
a row that was in fact written — points at the wrong policy.

**Users live in the customer's own Supabase Auth.** `company_members.user_id`
and `instance_admins.user_id` hold an `auth.users.id` from the customer's
project, matched against `auth.uid()` in every policy. Ekwo holds no account
and no directory.

**The foreign key onto `auth.users` is on `instance_admins` and deliberately
not on `company_members`.** An administrator is necessarily a signed-in user,
so there is nothing to accommodate and the key costs nothing. A company
membership is different: inviting someone into a company before they have an
account is a normal thing to want, and a foreign key would forbid it. The
price of the asymmetry is that a deleted auth user leaves an orphan company
membership, which a cleanup job handles; the instance administrator row
cascades away on its own. Outside Supabase the schema needs an `auth.users`
table to exist — `tests/helpers/supabase-shim.sql` shows the two columns that
are enough.

**Reading the instance row is for people who are on this installation.** A
member of at least one company, or an administrator. Not simply anyone
holding a valid token: on a shared Supabase project that would tell a
stranger which organisation runs here.

## Structure

**Documents and entries stay two layers, joined by a foreign key.** An invoice
answers to EN 16931 and Peppol; an entry answers to the chart of accounts and
to the FEC. Merging them into one table buys a shorter schema and costs a
display-type discriminator with nine values on every ledger line. Unified
accounting APIs that had no reason to copy anyone — Merge, Apideck — keep the
two apart, and so do we. What we do not keep is the string join: `documents.entry_id`
is a real foreign key, not `reference = 'INVOICE-' || number`.

**Sales invoices, purchase invoices, credit notes and quotes are one table
with a `doc_type`.** Not to imitate anyone, but because matching, attachments,
bank reconciliation and Peppol are otherwise written once per table. One path
per object.

**Document lines are a table, not JSON.** EN 16931 requires a VAT category per
line, Peppol validation checks it, the FEC wants the detail, and JSON is
neither indexable nor aggregatable nor constrainable.

**No `tenant_id`.** One instance belongs to one customer. Several companies
inside one instance is the normal case — a firm with its clients — so
`company_id` and role-based row level security stay, and the cross-customer
layer disappears along with its risk of leaking.

**`company_id` is repeated on child tables, and a composite foreign key keeps
it honest.** `entry_lines(entry_id, company_id)` references
`entries(id, company_id)`, so the denormalisation cannot drift. The alternative
— a join to the parent inside every policy — makes row level security a
performance problem on the largest tables.

**`entry_date`, `state` and `journal_id` are *not* copied onto entry lines.**
Denormalising them makes reports faster and gives the schema a second source
of truth for three facts. Reports join; if that ever hurts, an index or a
materialised view is the answer, not a copy.

## Accounts

**Eighteen account types instead of five.** `asset_receivable` and
`liability_payable` are what make the aged balance, reconcilability and the
statement mapping computable. With five types, all of that lives in code
patterns on account codes — and `411` means *customers* on the French chart
and *recoverable VAT* on the Belgian one, so a pattern that works in one
country silently books to the wrong account in the other.

**The balance-sheet group is derived, not stored.** `internal_group` is a
generated column over `account_type`, and `carries_forward` likewise. Neither
can drift from the type.

**A receivable or payable account that is not reconcilable is refused by a
check constraint.** Without matching there is no residual, no aged balance and
no FEC letter, so the configuration is not merely unusual, it is broken.

**Accounts are resolved by role, never by code prefix.** Order of resolution:
the contact's override, then the company default. `tax_postings.account_id`
does the same for VAT. `LIKE '411%' ORDER BY code LIMIT 1` is how a customer
debit ends up on a VAT account.

## Amounts and signs

**Amounts are always positive; a reversal flips the side.** A credit note
debits what the invoice credited, with the same positive figures. Negative
debits break every check constraint that says a line has one side, and they
make a trial balance unreadable.

**Totals are derived from the lines, never keyed in.** `document_lines.amount_untaxed`
is a generated column; document and entry totals are maintained by trigger.
Where a header and its lines can disagree, one day they will, and the ledger
is the one that has to be right.

**What a document has been settled by is derived from its matching.**
`documents.amount_paid` is recomputed from the matched amounts on the
third-party lines of its entry, so `amount_residual` and `payment_state`
follow from the ledger rather than from whoever remembered to update the
header. It shipped as a column somebody had to write by hand, which was the
rule above broken on its own terms; the recomputation is folded into the
existing reconciliation trigger rather than added as a second one, because two
`after` row triggers on the same table fire in name order and this one has to
run after the line residuals are updated. A value written by hand still
sticks until the next matching, because the socle does not yet model a
prepayment that is settled against nothing.

**The counterpart line is the difference of everything already written.** The
entry therefore balances by construction, and when the document header
disagrees with it, `post_document` raises and names the document. The header
is what is wrong; patching a ledger line to make the header true is how a
wrong invoice becomes a wrong ledger.

**One discount rule in the whole system: a percentage off the line.**
`quantity x unit_price x (1 - discount / 100)`, rounded once, at the decimals
of the document's currency.
Three coexisting discount semantics is a real failure mode, and an absolute
discount amount can be expressed as a percentage or as its own line.

**VAT is rounded once per tax group, on the rounded basis.** That is
EN 16931 BR-CO-14 and what every validator checks. Not per line, which
accumulates drift; not on the document total, which loses the breakdown.

**A missing tax is a missing tax, never zero per cent.** A line with no
`tax_id` produces a base line with no declaration box. Defaulting to zero
turns a data-entry gap into a false return.

## Taxes

**`tax_postings` carry both the ledger account and the declaration box.**
Country rules become rows: a tax says how much, its postings say where it
lands. Adding a régime is data, not a release, and the VAT return needs no
country-specific code — `vat_return()` just sums what the postings wrote.

**A positive `factor_percent` keeps the side of the base; a negative one flips
it.** That single rule expresses self-assessment: +100 on the recoverable
account and -100 on the payable one net to zero in the ledger while both
boxes are filled. The alternative — a boolean for reverse charge that nothing
reads — leaves the ledger and the return disagreeing on every intra-community
purchase, by construction.

**`box_factor_percent` is separate from `factor_percent`.** A box is filled
with the sign the form expects, which has nothing to do with which side of the
ledger the amount landed on. Conflating them means a box comes out negative
and the file is rejected.

**A tax whose tax postings net to zero is not added to the document total.**
That falls out of the postings rather than needing a flag: on a self-assessed
purchase the supplier is owed the net amount, and the VAT never leaves.

**Goods, services and capital goods are separate taxes, not a guess.** Boxes
81, 82 and 83 in Belgium cannot be derived from a rate and a country. Three
taxes at the same rate is the honest model, and it is how national
localisations everywhere do it.

**Taxes have `valid_from` and `valid_to`.** A rate change is a period, not a
new record to be archived; `post_document` refuses a tax that is not in force
on the accounting date, rather than silently rewriting history.

## Numbering, locks and state

**Entry numbers are `CODE/YYYY/NNNN`, counted per journal *and* per year.** A
counter per journal alone makes the year in the number decorative. The counter
is a row in `journal_sequences`, so concurrent bookings serialise on that row
and not on the journal.

**A number is assigned at posting, not at creation.** A draft that is deleted
should not leave a hole in the sequence.

**`state` and `payment_state` are different questions, and so is `sent_at`.**
One column that mixes "draft", "sent" and "paid" cannot answer any of the
three.

**Locks are triggers on `entries` and `entry_lines`, not application checks.**
`lock_date`, `tax_lock_date` and a closed fiscal year are enforced in the
database, because the path that bypasses the application is exactly the path
that needs stopping. Matching is exempt: it changes no account and stays
possible after a period closes.

**Everything raises. Nothing warns.** An exception handler that logs and
returns leaves the document saved and the entry missing, cleanly and silently.
Postgres error codes are prefixed with a stable identifier
(`period_locked:`, `entry_unbalanced:`) so callers can match on them.

## Reports

**Posted entries are filtered in `WHERE`, never in a `LEFT JOIN` condition.**
A line whose entry is not posted survives an outer join with a null entry and
walks straight into the closing balance. This is a named class of bug and the
schema tests for it.

**The aged balance reads the ledger, not the invoices.** It buckets what is
still unmatched on reconcilable third-party accounts, by `date_maturity`. An
aged balance computed from documents can never tie back to the balance sheet,
and a test asserts that this one does.

**`vat_return()` knows no country rule.** It sums `declaration_box` and
`box_amount` off the ledger lines. The only exception is boxes 71 and 72 for
Belgium, which are the arithmetic of the other boxes and are flagged
`computed = true`.

## The installer

**Ekwo provisions no Supabase project and pays for none.** The customer
creates the project; `npx ekwo init` connects to it. The alternative — a
Management API call that creates a project under an Ekwo-held token — would
make every Community installation depend on an Ekwo account and an Ekwo
billing relationship, which is the thing this project exists not to do. It
also costs the operator nothing: the free plan is enough to start, and their
books are on their account from the first row.

**The CLI requires Node and nothing else.** Not the Supabase CLI, not Docker,
not psql. It opens a Postgres connection and applies the SQL itself. Requiring
a second tool to install the first one loses people at the step where they
have decided to try it.

**The migration history is Supabase's, not ours.** `ekwo migrate` writes
`supabase_migrations.schema_migrations` — the same schema, the same table, the
same `version` / `name` / `statements` columns, `version` being the timestamp
prefix of the filename. So `supabase db push` and `ekwo migrate` are
interchangeable in both directions, and an operator who prefers the Supabase
CLI never has to choose. A private history table would have been simpler to
write and would have forked the ecosystem at the first `db push`.

**Each migration is applied whole, in one transaction with its history row.**
The file is sent as a single command string, so Postgres runs it as one unit;
the insert that records it commits with it. A migration that fails halfway
therefore leaves neither half-applied schema nor a history row that lies, and
the next run resumes at the file that failed. The consequence, which is a rule
for contributors: no migration may open a transaction of its own.

**`statements` is recorded but never executed.** The column is split out of
the file by a small parser that understands dollar quoting, `E''` escapes and
nested block comments. Execution does not go through it. A bug in the splitter
can therefore make that column less pretty and can never break an
installation — which is the right place to put a parser nobody has to trust.

**The first administrator is created through GoTrue, not through SQL.** Every
policy compares `auth.uid()` against a row, and `auth.uid()` reads the JWT of
the request. The CLI holds a connection, not a session: it runs as the
database owner, `auth.uid()` is NULL and row level security is *bypassed*
rather than satisfied. So the installer cannot be the first user; it can only
create one and write the rows that user will be recognised by. Writing
`auth.users` by hand was the alternative and it produces an account that looks
right and cannot sign in — the password hash, the confirmation state and the
identity row belong to GoTrue. This is the only reason the `service_role` key
is ever asked for, and `--admin-user-id` avoids it entirely when the account
already exists.

**Where a guard lives in a function, the CLI satisfies it rather than going
round it.** `register_instance()` refuses anyone who is not an instance
administrator, and a superuser connection is nobody. So the CLI sets
`request.jwt.claims` the way PostgREST does, for the administrator it is
acting for, and calls the function. It would have been one line shorter to
update the column directly; it would also have meant the rule only applies to
clients that happen to respect it.

**No secret is ever written to disk.** The database password and the
`service_role` key come from a flag, an environment variable or a masked
prompt, and are forgotten. `ekwo.json` holds the project URL, the country and
the schema version — a file that is safe to commit, so it stays useful. A
credential cache would have saved one paste per command and would have made
the first accidental `git add .` a disclosure.

**One runtime dependency, the Postgres driver.** Argument parsing, the
prompts and the masked input are written out in the package. Everything this
CLI is handed is a secret, so every dependency is one more thing that could
read it, and the three it replaces are a few dozen lines each.

**Orphaned memberships are a `doctor` warning, not a foreign key.**
`company_members` has no key to `auth.users` on purpose: inviting someone into
a company before they have an account is a normal thing to want, and a key
forbids it. The price is that deleting a user leaves a row behind. Those rows
grant nothing — `auth.uid()` can never match them — but they misreport who has
access, so `ekwo doctor` names them and leaves the decision alone. Deleting
them automatically would silently undo an invitation that has not been taken
up yet. `instance_admins` does have the key, and cascades, because an
administrator is necessarily a signed-in user.

**There is no `eject`.** Nothing is held to eject from: the data is already in
the customer's database, the schema is AGPL-3.0 in this repository, and
`supabase db push` keeps applying it if the CLI is never run again. The help
says so rather than staying silent, because "how do I get out" is the first
question an open-core promise has to answer.

**The demo seed is a command of its own and refuses to be routine.** It
invents a company *and* a fictional administrator, because it has to stand
alone on an empty database. `ekwo init` never applies it, `ekwo migrate` never
applies it, and `ekwo demo` asks before adding it to an installation that
already holds a company.

**The account of a document line is resolved in the database, and the tax is
not.** Order for the account, most specific first: the line, the product, the
company default (`default_sales_account_id` / `default_purchase_account_id`),
the country model (`country_defaults.sales_account_code` /
`purchase_account_code`). It runs in a trigger on `document_lines` rather than
in each client, because `document_lines_product_has_account` forbids a product
line with no account — so a null account can only ever mean "resolve it", and
every client that inserts a line, MCP server or PostgREST or psql, has to get
the same answer. A null *tax* is the opposite case: it means no tax at all,
which is a real answer, so nothing fills it in. What a product carries besides
its account — description, price, unit, tax — is a pre-fill done by whoever is
typing the line, the way an ERP's onchange works: those columns accept a
chosen value, and overwriting them in a trigger would take the choice away.

**Three columns of `country_defaults` were given a reader rather than
deleted.** `sales_account_code`, `purchase_account_code` and `currency_code`
shipped in the first release and were read by nothing, which is the state the
naming policy forbids: keep it or use it, never "in case". The first two are
the last step of the resolution above. The third is read by `ekwo init`, which
offers it as the currency of the company — and it has to be read there,
because `companies.currency_code` is `not null default 'EUR'` and is therefore
never empty by the time `install_country_template` runs. Deleting a published
column is irreversible and would have been the easier decision to defend and
the harder one to undo.

**A bank account is created from its IBAN and nothing else is asked.** The
journal and the ledger account behind it are already chosen — the country
template points the bank journal at 550000 or 512000 — so asking for them
would be asking the operator to repeat what the model already says. The IBAN
is the one fact nobody can derive, and it is also the natural key: a unique
index on `(company_id, iban)` makes `ekwo init --iban …` and
`create_bank_account` idempotent without a flag for it. A company with no bank
account is a `doctor` warning and never an error: payments still book on the
journal's default account, but there is no IBAN for an invoice and no
statement to reconcile against.

**`--db-region` no longer derives a hostname.** The pooler host carries a
generation prefix as well as a region, and the region does not determine it: a
project created in `eu-west-3` in September 2026 answered on `aws-1-eu-west-3`
and returned "Tenant or user not found" on `aws-0-` — a message that reads
like a wrong password. So both are opened and the one that answers is kept and
printed. Without a region nothing is built at all: the direct host
`db.<ref>.supabase.co` is IPv6-only on recent projects, and deriving it
silently produces a hang rather than an error, so the CLI asks for the string
the dashboard prints instead. A convenience that fails in a way that points at
the wrong cause is worse than a question.

## Products

**A product is in the core, not in a module beside it.** Every invoice line
answers the same four questions — what is it called, what does it cost, which
account, which tax — and a catalogue is the place those answers are written
once. Putting it in a module would mean `document_lines.product_id` either
does not exist (and the module reinvents the join) or exists and points at a
table the core does not ship, which is the worst of the two.

**It is a catalogue, not stock.** No quantity on hand, no valuation, no
movements. Stock is a different piece of software with its own correctness
problems — costing methods, negative quantities, period-end valuation — and
the moment those live next to the ledger, a wrong stock movement becomes a
wrong entry. What a business sells is in the core; what it holds in a
warehouse is not.

**A product pre-fills a line and never constrains it.** The line keeps its own
text, price, unit, account and tax, and anything the caller gave wins over the
catalogue. So `products.name` changing next month cannot alter what an invoice
said last month, and `product_id` on a posted line is a reference to where the
line came from rather than a source the line is read through. This is also why
`document_lines.product_id` has `on delete restrict` and why withdrawing a
product is `active = false`: deleting one referenced by a posted invoice would
quietly rewrite a document.

**`product_id` is nullable and always will be.** Free text is how most
invoices are written. A schema that demands a catalogue row per line makes the
operator invent one, and a catalogue of inventions is worse than no catalogue.

**The unit stays on `document_lines.unit_code`, and the product fills it in.**
That column shipped in the first release, mapped to BT-130. A second `unit`
column beside it would be two answers to one question. The check on
`products.unit_code` is on the shape only — three characters, upper case —
because UN/ECE recommendation 20 carries some eighteen hundred codes and a
short list in the database would refuse `KWH` or `TNE` on the grounds that a
developer had not thought of them. The short list lives in `@ekwo-ai/core` as
what a client *proposes*.

**BT-155 is the product code and lives nowhere else.** The seller's item
identifier is exactly what `products.code` is, so a line with no product has
none — which is the correct answer, since BT-155 is optional in EN 16931,
rather than a gap to fill with the line number. `document_line_items` is the
view that puts BT-153, BT-154 and BT-155 side by side for whoever is building
a Factur-X or Peppol document; `docs/mapping.md` carries the field-by-field
mapping, and it is written down rather than imported because
`@ekwo-ai/factur-x` is in a private repository that CI cannot install from.
*(Superseded on 12 September 2026 by "Format libraries live in this
repository" below: the brick is now `packages/formats/factur-x`, and CI builds
and tests it with everything else. The mapping stays written down — it is
documentation, not a dependency.)*

## The MCP server

**It acts as the user, and never as `service_role`.** The server signs in with
the operator's own address and password — or takes their access token — and
everything it can then read or write is what row level security lets that
person read or write. The alternative was one service key and a `company_id`
argument, which is shorter to write and means an assistant that can answer for
every company of an installation, including the ones its user was never
invited to. The key is refused at startup in both shapes Supabase has issued,
because a mistake that appears to work is the expensive kind.

**The direct-Postgres mode demands the user it acts for.** `EKWO_DB_URL` exists
for a self-hosted installation with no PostgREST in front of the database, and
a database connection is nobody: `auth.uid()` is null and row level security
is bypassed rather than satisfied. So that mode requires
`EKWO_ACT_AS_USER_ID`, and every query runs inside a transaction that sets
`request.jwt.claims` and switches to the `authenticated` role. Without that,
the fallback would quietly be the privileged mode, and it is the one an
operator in a hurry would reach for.

**Every ledger write goes through a function of the schema.** `post_document`,
`post_payment`, `post_entry`, `reconcile`, `unreconcile`. Nothing in the MCP
package inserts an `entries` or an `entry_lines` row; the direct inserts it
does are the objects a person types — contacts, draft documents and their
lines, payments, bank transactions. The moment a client writes ledger lines,
the rules about sides, accounts, rounding and locks live in that client, and
the next client answers differently. `post_payment` was added for exactly this
reason: money moving had no function, so a client would have had to assemble
the two lines itself.

**No tool deletes or edits a posted entry.** There is no unpost and no way to
ask for one. A mistake is corrected with a credit note, which is how
accounting has always worked and what an audit trail means. `unreconcile` is
the only undo in the server, and matching changes no account.

**Amounts cross as decimal strings, in both directions.** `numeric` is exact
and a float is not; a table read asks for `amount::text` and a date for
`date::text`, so `"1210.00"` and `"2026-06-15"` arrive as themselves on either
route rather than as whatever a driver or JSON made of them. The one place a
float can appear is a function result crossing PostgREST as JSON, and it is
rendered back to two decimals in one place.

**Refusals are answers.** `period_locked:`, `entry_unbalanced:`,
`document_total_mismatch:` travel to the model with the message the database
raised, plus one sentence saying what it means. Paraphrasing them, or catching
them and retrying with a different date, would turn a company's own rule into
an obstacle the assistant routes around.

**One query language for two backends.** Tool handlers are written against
five operations — select, insert, update, delete, call a function — and each
backend implements them: PostgREST through `@supabase/supabase-js`, Postgres
through parameterised SQL. The library is a dependency this repository would
otherwise have avoided, but the two things it does here are the password grant
with its refresh and the PostgREST query string, which are exactly the parts
no test in this repository can exercise. Untested code of our own was the
worse trade.

## Licensing and packaging

**AGPL-3.0 for the core, MIT for the format libraries.** The format libraries'
value is ubiquity — they should be able to end up inside a competitor, a
software house or an administration. The core's value is that nobody can turn
it into a closed service. Installing it and running it internally, modified or
not, obliges the installer to nothing.

**A contributor licence agreement is mandatory.** Without it the project can
never change its licence, and recent history shows that projects sometimes
have to.

**`ee/` lives in this repository, with its own licence.** A separate private
repository would make every schema change a two-repository coordination
problem, and this project does not have the people to pay for that.

**The line between free and paid is operational, not functional.** If it keeps
working when Ekwo disappears, it is free. Removing the footer attribution is
never sold: it is an attribution, not a toll.

## Scope of this release

**No Odoo-compatible RPC adapter.** Nobody consumes an Odoo-compatible
*server*; every verified integration is a client reading a real Odoo. The route
to the French filing tools is the FEC, which is an order of the
administration rather than an API, and Odoo has dated the removal of
`/xmlrpc` and `/jsonrpc`. A published mapping table costs five per cent of an
adapter and is more useful — see [mapping.md](mapping.md).

**Only percentage taxes can be posted.** `amount_type = 'fixed'` exists in the
schema and `post_document` refuses it rather than guessing how to spread a
fixed amount over lines.

**No fiscal year closing function yet.** Carrying balances forward and merging
the result into retained earnings is a real piece of work with several
national variants; `fiscal_years.is_closed` already blocks writes, and the
closing entry itself comes next. *(Superseded on 12 September 2026 by "Opening and closing are
parameters, not code" below.)*

**No multi-currency revaluation.** `currencies`, `currency_rates`,
`amount_currency` and `documents.exchange_rate` are in place; the periodic
revaluation of open items in foreign currency is not.


## The anonymous role executes only the policy helpers (11 September 2026)

Postgres grants EXECUTE on a new function to PUBLIC, and Supabase exposes the
functions of `public` as RPC endpoints, so every function of the schema was
callable without signing in. Row level security made each call return an
empty set, which is safe and still wrong: the surface should be closed, not
merely empty. Migration `20260911210131` revokes EXECUTE from PUBLIC and from
`anon`, grants it to `authenticated` and `service_role`, and changes the
default privileges so that a function written next month starts closed.

Eight helpers keep their grant to `anon`: `company_role`, `is_company_member`,
`can_write_company`, `is_company_owner`, `is_instance_admin`,
`is_any_company_member`, `company_has_no_member`, `instance_has_no_admin`.
Policies call them on behalf of whoever is asking, and without EXECUTE an
anonymous SELECT would raise "permission denied for function" instead of
returning nothing. They answer only about `auth.uid()`, which is null for
`anon`, so what they give away is the word *no*.

In the same migration, `instance_admins` stops being readable by every
signed-in user. Self sign-up is on by default on a Supabase project, so a
signed-in stranger is an ordinary thing; administrators are visible to the
members of a company, to administrators, and to oneself. The README now says
to turn public sign-ups off, which the schema cannot do by itself.


## A country is a pack of data, compiled into SQL (12 September 2026)

The one taxonomy in the international plan that will not get to be redone,
settled before any code was written.

**The truth of a country lives in `packs/<cc>/`**: JSON with a published JSON
schema for everything structured, one `accounts.csv` for the chart, an
`i18n/` folder of labels, and a `golden/` folder of expected results —
**built on 14 September 2026**; see the section at the end of this file. No YAML, no
TOML, no package per country: the CLI has one dependency and Node reads JSON.
`ekwo pack build` compiles a pack into a seed SQL file that is committed, and
the CI refuses a seed that is not the exact output of its pack — the SQL is
a build artefact, like `docs/schema.md`. `supabase db push` and `psql -f`
remain enough to install without the CLI. The runtime stays the existing
`*_templates` tables, extended additively; a company still copies them at
install time.

**A pack is versioned** (semver in its manifest); `country_packs` records what
the instance holds and `company_packs` what each company copied.
`ekwo pack upgrade` — **built on 14 September 2026**, together with `ekwo pack
status`; see the section at the end of this file — diffs by
natural key `(country, code)` and follows three rules: an addition is applied,
a validity that closes is applied, everything else is listed and never applied
without explicit consent. A new VAT rate is
a new tax plus a `valid_to` on the old one, never an edit. Once published, an
account code and its type, a tax code and its meaning, and a box in a form
version are immutable: things are retired, never renamed or deleted.

**Two findings that changed the plan.** The seeds were `on conflict do
nothing`, so an installed instance received no pack change at all — not even
for a company created afterwards; generated seeds upsert on the template
tables only. And the French pack is wrong today for every service business,
because French VAT on services is due on collection; cash-basis VAT is a
Belgian-French hole before it is a British option.

**Declaration boxes and financial statements become data** with declarative
formulas — lists of boxes to add and subtract and a floor at zero, no
expression language — which removes the last `fiscal_country = 'BE'` from
`vat_return()`. A test asserts that no function of the schema contains a
country code. A generic statement by account type gives a readable balance
sheet on any chart, including the code-less charts of the UK and the US.

**Kept in phase 0**: the pack format; opening balances and a parameterised
year-end close; cash-basis VAT and non-deductible VAT (`tax_on_base`);
realised exchange differences at matching; translated labels; and the
append-only `audit_log` by trigger, **built on 14 September 2026** with the two
`ekwo pack` subcommands above. **Deferred**: revaluation of open items, cash
accounting as a ledger (a report derived from matched payments instead), the
cash-flow statement (indirect, when it comes), several taxes on one line
(`document_line_taxes`, with Canada). Shifted and 52/53-week years were
already covered by `fiscal_years`.

**A golden test is the contract of a pack, not proof of legal truth.** Each
box and each tax cites its legal source, the manifest carries a certification
status that `ekwo init` prints, and a pack moves to *reviewed* only after a
named professional has read it. Ekwo **maintains** Belgium and France — the
line above said "certifies" until the scale was settled on 12 September, and
there is deliberately no status that means certified by Ekwo.


## The pack format, built: `packs/`, a compiler, and two tables (12 September 2026)

What the decision above became, in two changes, and what it deliberately left
for later.

**Built.** `packs/be/` and `packs/fr/` hold a manifest, the chart as
`accounts.csv`, the taxes and their postings as `taxes.json`, the boxes of the
periodic return as `tax_report.json`, an empty `statements.json` and an
`i18n/` folder. `packs/schema/pack.1.json` is the published JSON Schema for
all of them. `ekwo pack build` compiles a pack into a committed seed and
`ekwo pack check --all` — which the CI runs — refuses one that is stale. The
CLI gained no dependency: its validator walks the subset of JSON Schema the
format uses, because a binary handed a `service_role` key should not grow a
package tree.

Belgium and France carry over with no change of content, and the proof is a
test rather than a promise: the four hand-written seeds are kept in
`tests/fixtures/seeds-before-packs/`, loaded into one database while the
compiled pair is loaded into another, and every row of the five template
tables is compared — 353 and 392 accounts, 12 journals, 36 taxes, 128
postings, 2 country models.

Then migration `20260912074712`: `country_packs` (what this installation
holds, with a sha256 of the pack and the certification status `ekwo init`
prints), `company_packs` (what each company copied, backfilled at `1.0.0`),
`name_i18n` and `statement_hint` on `account_templates` and `accounts`,
`companies.language`, `country_defaults.language_default`, and
`install_country_template(company, country, language)` — which copies
`coalesce(name_i18n->>language, name)` into `accounts.name` and records the
version in `company_packs`. **The generated seeds upsert** on the template
tables and on nothing else, which closes the hole the analysis found: an
installed instance used to receive no pack change at all, not even for a
company created afterwards.

**Found on the way.** `alter default privileges … revoke execute on functions
from public` does not close a function created later — PostgreSQL merges the
stored default with the built-in one — so `20260911210131` did not keep the
promise it made, and `install_country_template` came out of its migration
executable by PUBLIC. Every migration that adds a function now ends with
`revoke execute on all functions in schema public from public;`, from PUBLIC
and never from `anon`, which holds explicit grants on the eight policy
helpers.

**Canada, before it arrives.** Two columns land now rather than with the pack
that needs them, because adding them later would mean migrating
`tax_postings` a second time, over years of postings:
`report_code` on `tax_posting_templates` and `tax_postings` — a box number is
unique inside one form, and a Canadian company files two returns at once,
where line 101 of the federal one is not line 101 of the Québec one — and
`region` on `companies` and `contacts`, because Canadian tax follows the
buyer's province and the core can only suggest a tax if it knows where the
parties are. Canadian **rates live in the pack**: fifteen or so stable
combinations published by the CRA are data, unlike the thousands of
American jurisdictions that change monthly and belong to a maintained feed.
What waits for the pack itself is the group tax (`tax_amount_type = group`
plus `tax_group_members`) and `entry_line_boxes`, the table that lets one base
line feed two forms; both are phase 1, and `report_code` and `region` are here
now so that migration happens once.

The header comment of `20260912080311` names `entry_lines` as a second table
`report_code` would have to be added to. It was never added there, and it is
not needed there: a ledger line carries `declaration_box`, and which form that
box belongs to is a fact about the posting it came from, which already holds
it. The comment is in a published migration, so it stays where it is and this
paragraph is the correction.

**Accepted, validated, not yet compiled**, because the tables they need do not
exist: `tax_report.json`, `statements.json`, the `documents`, `einvoicing`
and `bank` sections of the manifest, and the journal, tax and box labels of
`i18n/` (only account labels are compiled). The compiler names each one it
skipped, in its output and in the header of every seed it writes, so nothing
is quietly dropped. `tax_report.json` is written for both countries already —
the Belgian 71/72 and the French CA3 totals — so that the declaration boxes
have the data they need on the day that work starts. *(All of these have since
been compiled; the entries below say when.)*


## Ekwo maintains a pack; only an accountant reviews one (12 September 2026)

The certification scale shipped that morning with three values, and `ekwo`
meant "certified by Ekwo". That is a claim we cannot make: we write the pack,
a golden test proves it is internally coherent, and neither is an accountant
reading it against the law. The word *certified* should describe a review by a
named professional, or nothing.

So `pack_certification` gains **`maintained`** — maintained by Ekwo, not yet
reviewed by an accountant — which is what Belgium and France are. `reviewed`
keeps its meaning and now carries who read it and when. `ekwo` stays in the
enum, because a published column never loses a value, and is deprecated:
nothing writes it, the pack schema refuses it, and migration `20260912081015`
moves the rows that hold it, emptying `certified_by` along the way — it held
"Ekwo AI", which was the claim itself. Migrations `20260912081014` and
`20260912081015` are two files because PostgreSQL refuses a new enum value in
the transaction that added it.

One sentence describes a pack, written once in the CLI and printed by
`ekwo init`, by `ekwo status` and in the header of every generated seed:
"maintained by Ekwo — not yet reviewed by an accountant", "reviewed by X on
Y", "community pack — not reviewed". This supersedes the last line of the
paragraph above, which said Ekwo certifies Belgium and France.



## Declaration boxes are data (12 September 2026)

`vat_return()` summed whatever the tax postings wrote on the ledger lines —
which never knew a country — and then hard-coded the Belgian frame VI: boxes
71 and 72, the six boxes that make up what is due, the three that make up what
is deductible, and `c.fiscal_country = 'BE'`. It was the last country rule in
the core. A French company got no total at all, and a British one never would
have.

A form is now two tables filled by a pack. **`tax_report_templates`** is one
declaration form of one country; **`tax_report_box_templates`** is one box,
with `plus_boxes`, `minus_boxes` and `floor_zero` where it is a total. There
is deliberately **no expression language**: a list to add, a list to subtract,
a floor at zero, evaluated in the `sequence` the form declares. That covers
the Belgian 71/72, the French 16, 23, 25 and 28, and the British box 5, and an
accountant can read it. The day a country needs a real expression it is a
discussion about the core, not a field added to a pack.

Three things follow from the shape.

**A reference names a box and a kind.** `"54"` is enough on a Belgian form;
the French CA3 carries a base and a tax on line 08, so it writes `"08:base"`
and `"08:tax"`. `ekwo pack check` refuses a bare reference that would match
both, one that names a box the form does not carry, one that names the box
itself, and one that names a total computed later in the sequence — the totals
are evaluated once, in order, so a forward reference would silently read a
zero. It also refuses a tax that posts to a box the form does not declare.

**These tables are not copied into a company.** A chart of accounts is
customisable and a form is not: an operator does not get to redefine box 59.
They stay reference data that `vat_return()` reads directly, which is also why
they carry no `company_id`.

**A new version of a form is a new code**, with its own `valid_from` and
`valid_to`, the way a new VAT rate is a new tax code. The key is
`(country, code)`, and `vat_return()` takes the form in force at the end of
the period — so the return of a past period keeps giving the same answer. The
original sketch keyed the table on `(country, code, valid_from)`; one key and
one row per form version is the simpler half of the same guarantee.

`vat_return(company, from, to, report_code default null)` returns what it
always returned — `box`, `kind`, `amount`, `computed` — plus the `name` of the
box, its `sequence`, `hidden` and `report_code`. Hidden totals (the Belgian XX
and YY) are **returned and flagged** rather than dropped: a caller that wants
to check a total the form does not print can, and a renderer filters on one
column. A nil box is still left out, computed or not, exactly as before.
`report_code` picks the form where a country files several; without it, the
periodic return of the company's fiscal country in force on the last day of
the period, and an error rather than a guess if there are two. A company in a
country with no pack still gets its ledger boxes and no total.

The guard that keeps this true is three tests: no function in `public`, no
file under `supabase/migrations/`, and no source file of the CLI, the MCP
server or the core may hold a country code. They pass today, and they are what
makes "a country is data" checkable rather than aspirational. Making them pass
took five deletions beyond `vat_return()` — four backfills that named Belgium
and France in published migrations, and the `PCMN`/`PCG` labels and Belgian
default of `ekwo init`. The backfilled values are pack data that the compiled
seeds upsert, so nothing was lost by deleting them; `ekwo init` now builds its
question from `country_packs` and **preselects nothing**, because the one
question whose wrong answer is a chart of accounts has no right default, and a
system that ships with a country already chosen is not international.

Editing published migrations breaks rule 1 of
`supabase/migrations/README.md`. It was done once, knowingly, because no
installation anywhere had run those files, and because a country literal in a
published migration is a country literal in the repository whatever the file's
date says. The exception is written into that README beside the rule.


## Opening and closing are parameters, not code (12 September 2026)

The first release said the year-end close was "a real piece of work with
several national variants". The variants turned out to be one value.

**Three styles, named after the mechanism.** In Belgium, in France, in the
United Kingdom and in the United States a close does the same two things:
move the result out of the income statement, then zero every income and
expense account. What differs is the account the result travels through, and
that is now `country_defaults.closing_style`: `retained_earnings` closes
straight into retained earnings (United Kingdom, United States);
`result_accounts` closes into a current-year result account that sits on the
balance sheet and waits for the meeting that allocates it (France, 120 for a
profit and 129 for a loss); `appropriation_accounts` travels through an
account that is itself part of the income statement and lands on retained
earnings (Belgium, 693 to 140 and 793 to 141). The enum values name the
mechanism and never a country, because the third style is not "the Belgian
one" — it is what any chart does that ends its income statement on an
appropriation section.

**A profit account and a loss account, not one.** Belgium and France both
keep the two apart on the chart, and a single account would have to be
allowed to go debit, which is exactly what their filing formats refuse. So
the pack names `current_year_result_profit`, `current_year_result_loss`,
`retained_earnings` and `retained_earnings_loss`, and
`country_defaults.opening_journal_code` names the journal all of this is
booked on. Five columns, all read: none of them is there "in case".

**None of the five carries a default, and that is the whole point.** A
default `closing_style` is one country's mechanism handed to every country
that has not spoken, and `'OPN'` is the journal code Belgium and France happen
to use. A pack that says nothing gets a refusal naming the field it is
missing — `no_closing_defaults`, `no_opening_journal` — and never somebody
else's answer. `ekwo pack check` catches the same gaps before a seed is
written: a pack that declares a `closing_style` has to name the accounts that
style needs and a journal of type `opening`. The one fallback left is inside a
pack and not between countries: `retained_earnings_loss` left empty means the
chart keeps one account for both signs, which is the ordinary case outside
Belgium and France.

**The style is asserted, not trusted.** `appropriation_accounts` requires an
account that does *not* carry forward, the other two require one that does. A
pack that named an income account where the balance sheet is expected would
otherwise close a year into an account that is zeroed the same evening, and
the result would vanish quietly.

**The close writes no *à-nouveaux*, and that is the one place we depart from
what a Belgian or French package prints.** Every report in this schema reads
the ledger from the beginning — `trial_balance` computes the opening balance
of a period as the sum of everything booked before it — so a balance-sheet
account already stands on 1 January at the figure it carried on 31 December.
An opening entry on top of that does not carry a balance forward, it counts
it twice; the first version of this function did, and a test now forbids it.
What the opening journal carries is the *first* opening of a set of books,
which is `opening_balance`, and the year-end entries themselves. Reversing
this decision means changing the reports first — to a balance computed inside
one exercise — and the à-nouveaux entry after; doing it the other way round
doubles every carried balance on the day it ships.

One consequence to know: once a year is closed, its income statement read
from the *movements* of that year is zero, because the closing entry is one of
them. That is what a post-closing trial balance is, and it is true of every
system that closes the income statement at all. The financial statements read
a closed year by leaving out `entries.kind <> 'normal'`.

**`entries.kind` says what an entry is for, and is not writable by hand.**
`normal`, `opening`, `closing`. The first draft of this change identified a
closing entry by a heuristic — a journal of type `opening`, dated on the first
or the last day of a fiscal year — and a statement built on a heuristic goes
wrong the first time somebody books something by hand on that journal. The
column is set by `opening_balance()`, `close_fiscal_year()` and
`reopen_fiscal_year()` and by nothing else: a trigger refuses any other value
unless `ekwo.year_end_entry` is set, which only those three do, and only while
they write. The reason is the one behind `is_closed`: a label any client may
set is a label a report cannot be built on, and an ordinary purchase invoice
quietly marked `closing` would leave an income statement without anything
looking wrong. A reversal carries the kind of what it undoes, so a closing
entry and its reversal leave a report together.

**The allocation decided by a meeting is never in the close.** A dividend, the
legal reserve, a French 120 moved to 110 or to 106 — all of it is a later
entry taken by people. A close that guessed at it would be writing a decision
nobody made, and it would be wrong for most companies most years.

**`is_closed` stops being an ordinary column.** It decides whether a whole
period accepts entries, and until now any client that could write a fiscal
year could flip it, which is the same as having no lock. A trigger refuses the
*transition*: an update that changes `is_closed` or `closed_at` raises unless
`ekwo.closing_fiscal_year` is set, and only `close_fiscal_year()` and
`reopen_fiscal_year()` set it — transaction-locally, so it is gone when they
return. Creating a year that is *already* closed stays allowed, because that
is a different act: it describes a year that happened in whatever kept the
books before, it computes nothing and it writes no entry. That is how a
company arrives with three closed years, one open one, and an opening balance
that carries their result.

**An opening balance refuses the income statement.** `opening_balance` takes a
trial balance as rows — `{account_code, debit, credit, contact_id, label}` —
because that is what every previous system exports, and it refuses an income
or expense account unless the caller passes `p_allow_result_accounts`. A year
that starts with a profit already on it is the commonest way an import goes
wrong. The flag exists for the one case where it is right: taking the books
over in the middle of a year that has already run.

**A close is undone by reversing, never by deleting.** `reopen_fiscal_year`
reverses the entries the close wrote and clears the flag, and refuses the
moment a later year is closed or holds entries of its own — re-opening changes
a result those years stand on. It is the same rule as everywhere else here:
there is no unpost.

**For an accountant to read.** Three things in this are our reading of the
mechanics rather than a rule we can cite. The closing entry is dated on the
last day of the year, which is the convention everywhere but is not written
anywhere. Belgium goes through 693 and 793 rather than straight to 140 and
141, which is what the minimum chart's appropriation section is for, but a
firm that books it directly is not doing anything unusual. And the
appropriation entry is posted as a separate entry *before* the closing entry,
so that a statutory income statement can show a movement on 693: merged into
one entry the two movements cancel and the line disappears.

## One tax engine, several kinds of tax (12 September 2026)

The core knew one tax: European VAT, fully deductible, computed on a price
that excludes it, rounded to the cent. The pack format already had words for
everything else — `kind`, `recoverable`, `price_include`, `jurisdiction`,
`cash_basis`, `rounding_method`, `cash_rounding_unit` were in
`packs/schema/pack.1.json` marked *deferred*, and the compiler dropped them on
the floor. This step gives each of them a column, and adds the one behaviour
that could not be written as a flag.

**A kind is a label, never an input to the calculation.** `tax_kind` is
`vat | gst | sales_tax | withholding | other` and drives reports only: a GST is
computed exactly like a VAT, and a report that lists "the VAT" of a Canadian
company needs to know which of two taxes it is looking at. Deriving that from
a tax code is how a localisation ends up in application code. Same for
`recoverable` and `jurisdiction`: they say what a tax *is*, so nothing has to
guess.

**Non-deductible VAT is a cost, and a cost has an account — the line's.**
`tax_posting_type` gains `tax_on_base`. Like `base` it carries no account,
because the account is the one the document line names; unlike `base`, its
amount is a share of the tax. A Belgian company car at 21 % with the deduction
capped at 50 % by art. 45 § 2 CTVA books 1 000 on the vehicle, 105 on the
deductible VAT account, 105 more on the vehicle, and 1 210 to the supplier.
Belgium's grid 83 comes out at 1 105: the form says « montant (TVA déductible
non comprise) », which excludes the *deductible* VAT and not all of it, and
the Intervat notice spells it out. That needed no new column —
`box_factor_percent` has always been independent from `factor_percent`, so the
base posting reports 100 % of the base in box 83 and the `tax_on_base` posting
reports 50 % of the tax in the same box. France needs none of this: the CA3
has no grid for the base of a purchase at all, so the French fuel tax is
ledger-only on its non-deductible fifth.

**A `tax_on_base` line is not a tax line.** It sits on a base account and
belongs to the base side of the declaration, which is exactly why Belgium puts
it in 82/83. Marking it `tax_line = true` would split one grid into two rows in
`vat_return()` and would send every reader that filters on `tax_line` looking
for it among the VAT accounts, where it is not.

**The postings of one side share out the tax of the group; the last takes the
remainder.** Until now no tax had more than one posting per side, so each one
could round on its own. Two halves cannot: 3,00 € at 21 % is 0,63, and
rounding 0,315 twice books 0,64 against a document that totals 3,63. The tax
of the group is still rounded once (BR-CO-14, unchanged) and is then shared
out — 0,32 and 0,31. Every tax that existed before comes out to the same cent,
and `posting.test.ts` was not touched, which is the proof. The same rule runs
one level down when a `tax_on_base` share is spread over the several accounts
of an invoice, in proportion to their bases.

**A declaration figure is not a ledger figure.** Box amounts keep rounding per
posting, so on that 3,00 € invoice the ledger books 0,31 where box 82 reports
0,32. Only the ledger has to balance, `box_factor_percent` was separate from
`factor_percent` by design, and the alternative is to let a grid drive a
posting.

**No country is anybody's default.** A pack says how its country rounds; a
pack that says nothing gets the column's own default, and the compiler writes
`default` rather than a value of its own — otherwise the CLI becomes a second
place where a country model is decided, and the first country that rounds
differently finds out by reading TypeScript. `half_up`, `recoverable = true`
and `tax_kind = 'vat'` are the neutral mechanism, not Belgium and not France.
The repo-wide guard catches a country *literal*; `tax_on_base.test.ts` adds
the subtler one, a country's *answer* used as a fallback.

**`cash_basis`, `rounding_method` and `cash_rounding_unit` land without a
reader.** VAT on collection comes later; `half_up` is what `round()` on a
numeric already does in every country, so the default changes nothing; the
Swiss five-centime unit waits for Switzerland. The alternative was migrating a
table of tax rows and their postings a second time, which is the argument
`20260912080311` made for `report_code`. Three columns is where this stops.

**Both packs move to 1.1.0** — and have moved on since: Belgium and France are
both at **1.4.0** as this is written, `generic` at 1.1.0. Belgium gains the
vehicle taxes at 50 % and a
wholly non-deductible one for frais de réception (art. 45 § 3 CTVA); France
gains fuel at 20 % with the 80 % deduction of CGI art. 298, 4, 1°. Adding a
tax is a minor version, and `ekwo pack upgrade` will diff on that number when
it is built, so a pack that grows without saying so is a pack nobody can
upgrade to. The before/after test the pack format shipped with still
proves that **nothing that existed changed**: `after`
is narrowed to the natural keys `before` held, and the four new codes are
named in a test of their own, so a row that appears without anyone saying so
still fails.


## A country has charts, and a financial statement is data (12 September 2026)

Two changes in one sub-task, in that order, because the second depends on the
first: a statement presents a chart, so which chart has to exist before what
presents it.

**`account_templates` was keyed on `(country, code)`, and a country has more
than one chart of accounts.** A Belgian ASBL keeps its books on the PCMN as
the associations title of the Code des sociétés et des associations applies
it; a French association on ANC 2018-06; Germany ships SKR03 and SKR04. So a
chart becomes a dimension: `chart_templates` lists what a country offers,
`account_templates.chart_code` says which one an account belongs to — the key
is now `(country, chart_code, code)` — and `company_packs.chart_code` records
which one a company copied. Every published row is backfilled to `default`,
which is a mechanism word and not a chart name: the pack says the chart is
called PCMN or PCG, in its own data.

**The journals, the taxes and the declaration form stay common to the charts
of a country.** An association buys, sells and banks through the same journals
as a company and files the same VAT return; only the accounts differ, and what
presents them. The roles — which account is receivable, payable, suspense —
stay on `country_defaults` for the same reason, and `ekwo pack check` refuses
a pack whose role codes and tax posting accounts are not in *every* chart it
ships. That check is what lets one set of taxes install on any chart, and it
fails where it can be read, in the pack, rather than at install time.

**`ekwo init --chart`, and a question only when there is something to choose.**
A country with one chart is not a question. A country with two is asked about,
with nothing preselected beyond the default the pack itself declares, and
non-interactively the flag is required and the refusal lists the charts. Same
rule as the country question: the one whose wrong answer is a plan of accounts
has no right default.

**A financial statement is three tables and one function.**
`statement_templates` is one scheme, `statement_line_templates` its lines with
the plus/minus lists a total is computed from, `statement_line_rules` how
accounts reach a line — by code range, code prefix, account type or one code.
`financial_statement(company, code, from, to)` returns the whole frame, nil
lines included, in the order the scheme prints it. A balance sheet reads
balances cumulative to the end of the period, an income statement the
movements inside it, which is the one difference `kind` decides.

**Mapping by code range is presentation, and presentation is allowed.** The
rule that forbids choosing an account *to post to* by prefix is about posting.
The NBB scheme, the liasse and every XBRL taxonomy map by ranges of the legal
chart — in Belgium the rubric code *is* the range, `40/41` being accounts 40
and 41 — and refusing that would mean hand-listing four hundred codes per
country. A range compares the head of the code, so `40`..`41` takes 400000 and
411000 and stops at 42.

**`balance_side` is what splits one account between two lines.** A suspense
account is a receivable while it is in debit and a payable while it is in
credit; French VAT lives in the 445 family on both sides of the balance sheet.
Two lines may share an account only when their sides exclude each other, and
`ekwo pack check` refuses any other overlap.

**The check that makes a statement tie out is in the pack, not in the
runtime.** Every account of a chart that can be posted to reaches a line of
some statement of that chart — a heading, an account with children, may reach
none, because it straddles the lines its children are split over. At runtime
`unmapped_accounts()` answers the same question for a company, which catches
the account somebody opened outside the pack, and the MCP tool returns that
list beside the statement so a model cannot present a balance sheet that does
not balance.

**One evaluator, called twice.** A declaration form and a financial statement
derive their totals the same way, so they derive them in one function:
`evaluate_totals(values, formulas, keep_zero)`, which `vat_return()` and
`financial_statement()` both call. The first draft of this sub-task wrote the
evaluation a second time and argued that the two differed — a return omits a
box that comes to nothing, a statement prints its whole frame. They are one
argument (`p_keep_zero`) and, for the sign a scheme reads a line with, a
second (`factor`). Two implementations of one calculation is the thing this
repository is built against, and the cost of undoing it — replacing a function
published the same morning, in a file of its own because it was published —
was an hour.

**The totals are evaluated in the order they depend on each other**, not the
order they are printed in: a balance sheet prints `ACTIFS IMMOBILISÉS` above
the three lines it adds up, and one of those three is itself a total. Each
pass takes every total whose parts are known; a reference that names no
formula is a value, present or nil, so a total over ledger boxes is ready on
the first pass; a pass that settles nothing is a cycle and names the totals in
it. `vat_return()` gains that: it used to evaluate strictly in the order the
form declares, where a forward reference read a silent zero — which
`ekwo pack check` refuses anyway, so no pack changes answer.

**A closing entry is not what a period earned.** `close_fiscal_year()` books
the mirror image of every income and expense account so the next year starts
at nil, and marks the entry `kind = 'closing'`. An income statement leaves
those out — a closed year would otherwise read as a result of zero — and a
balance sheet keeps them, because that entry is what carries the result onto
the line the balance sheet shows it on.

**And an appropriation entry is not a closing entry.** Where a country
appropriates through accounts of its own income statement — Belgium, 693 for a
profit and 793 for a loss — `close_fiscal_year()` writes two entries: one that
moves the result into those accounts and on to retained earnings, one that
takes every income and expense account back to zero, that pair included. Both
were marked `closing`, so they cancelled each other out and the "Affectations
et prélèvements" section of the Belgian annual accounts read nil the moment a
year was closed. They are two acts and they now have two names:
`entries.kind` gains `appropriation`, an allocation section reads it and
leaves the closing entry out, an income statement leaves out both, and a
balance sheet keeps both because together they are what puts the result on the
line it shows. `reopen_fiscal_year()` undoes both, and a reversal keeps the
kind of what it undoes. The guard on the column needed nothing: it already
admits any value under the session flag the three year-end functions set, and
refuses everything but `normal` outside it.

**The generic balance sheet derives the result; the legal ones do not.** The
NBB frame and the liasse are filed after the year is closed, so they show the
result on the line the close put it on — rubric 14 in Belgium, `DI` in France
— and show nothing while the year is open. The generic scheme has a line that
sums the income and expense types instead, so it balances on its own whether
or not the year is closed, and reads nil once the close has moved the
movements away. A management balance sheet and a filing frame are not the same
document, and this is where they part.

**The generic framework is a pack with no country.** `packs/generic/` compiles
like any other pack into `supabase/seed/05_framework_generic.sql`, and its
rules are all `account_type` — a reader refuses any other kind in it. That is
what the eighteen account types buy: a readable balance sheet on any chart,
including the code-less charts of the United Kingdom and the United States,
and the fallback for a chart that declares no scheme of its own. The Belgian
association chart ships exactly that way.

**What the packs gained.** Belgium: the NBB abbreviated balance sheet, income
statement and allocation section, from the 2021 standard model — and the micro
model is the same three schemes, so one set serves both. France: the 2050/2051
balance sheet and the 2052/2053 income statement of the 2026 liasse. Both were
read off the published forms rather than off the tables that circulate, which
matters more than it sounds: `20/28`, `70/74`, `60/64` and `9902` are
pre-2016 Belgian codes that no longer exist, and the French `CS`/`CU` pair
swapped meaning in the 2026 millésime — participations moved from `CU` to
`CS`, and the public mappings have not followed.

**`xbrl_element` holds a fact key, not an element name.** The premise that the
NBB CBSO taxonomy has one element per rubric is false: it is dimensional, with
fifteen generic metrics, and a rubric is a metric plus a set of dimension
members. So the column carries `met:am1|bas:m9|rst:m2`, verified against
taxonomy 26.0.15, and null on the lines where nothing could be verified.
`@ekwo-ai/xbrl-cbso` reads it — and that library targets framework 25.0 and
has two rubrics swapped, which is its own fix.


## What a country requires on a document is data (12 September 2026)

An invoice is where a country speaks loudest, and the core answered for it.
The number was built as `CODE/YYYY/NNNN` in a function; the legal payment
term existed nowhere; the e-invoicing profile and the bank formats existed
nowhere; and the legal mentions existed nowhere at all, so a renderer either
printed "Autoliquidation" from its own source or printed nothing. Twelve
columns of `country_defaults`, one table of sentences, and two views move all
of it into the pack.

**Nothing executable, and that is the sub-task.** This change adds no
function. Two views read the data — one enriched, one new — so a renderer or
the e-invoice brick has something to select, and a test asserts that no
function body mentions any of the new columns.

**`numbering_gapless` and `number_format` are two questions, not one.**
Whether a number may skip is the law: most of Europe forbids a hole, some
countries only ask for an order. What the number *looks like* is a pattern —
`{CODE}`, `{YYYY}` or `{YY}`, `{MM}`, and a run of `N` for a counter padded to
its own width. Whether the counter restarts each year is readable in the
pattern itself, because a pattern that carries the year restarts with it,
which is why the four numbering styles of the pack format compile to one
boolean without losing anything. **`next_entry_number()` does not read the
pattern**, and this change does not make it: a numbering engine that consumes
a format is its own piece of work, and both packs declare exactly the pattern
the engine already produces, so nothing moves under anybody's feet the day it
lands.

**`tax_point_rule` is the country's general rule, and the exception is on the
tax.** France taxes goods on delivery and services on collection. A second
country column for the second half would be a country model that contradicts
itself; the service rule is `taxes.cash_basis`, which the tax engine landed and
cash-basis VAT gives behaviour to. So France declares `delivery_date` and its service taxes
will say the rest themselves.

**`party_scheme` and `vat_scheme` are both there because they are not the same
identifier.** A company is addressed on the network by its registration
number — ISO 6523 `0208` in Belgium, `0009` in France — and taxed on its VAT
number, `9925` and `9957`. Four digits, checked by the schema: the Belgian
pack used to carry `BE:VAT`, which is a string nobody can look up in a
register. Where a country has two registration identifiers, the pack declares
the one its invoices carry and names the other in the legal reference: France
declares SIRET and says in the same breath that SIREN is the same company
without its establishment.

**`applies_when` is a closed vocabulary of nine values, never an expression.**
The same decision as the plus and minus lists of a declaration total, for the
same reason: an accountant reads `reverse_charge` and knows what it means, and
a pack that could write a condition would be a pack that executes. Six of the
nine are resolved from the treatment of the taxes a document's lines already
carry, so nothing new has to be recorded on a document for its mentions to
come out right. `late_payment` is about the direction — interest and recovery
costs belong on what a seller issues, never on an invoice somebody else
wrote. `cash_basis` is about the tax. The day a country needs a tenth value it
is a discussion about the core, not a field a pack may fill with anything.

**`small_business` is data the view never selects, and says so.** A franchise
regime is a property of the seller, and the core records no such column. The
sentence is in the table so a renderer that knows the regime can fetch it by
code, and `document_legal_mentions` does not pretend to know: it has no branch
for it, a test asserts that the view returns it for no document anywhere, and
the day a regime becomes a column the view gains one line. The alternative was
to invent a flag on `companies` in a sub-task about country data, or to drop a
sentence that two countries genuinely require.

**The mentions are not copied into a company**, for the reason a declaration
form is not: a chart of accounts is customisable and the law is not. An
operator does not get to rewrite article 39bis. A wording that changes is a
`valid_to` and a new row, and the view joins on the **document's own date**, so
a reprint of an old invoice carries the wording of its own year.

**The country of a document is the company's `fiscal_country`**, not its
address. A Belgian company with a French VAT registration invoices under
French rules, and that distinction was already in the schema; the view uses it
rather than adding a second answer.

**The generated seed writes these columns with an `update`, not a second
insert.** The row is created a few lines above by the same file, and an insert
would have to restate the name, the currency and the two account roles its
not-null columns need — the same values twice in one generated file. The
update touches only the columns this section owns, which also keeps the two
blocks of the compiler independent of each other.

**What a pack may declare and what it may not.** The closed vocabularies live
in `packs/schema/pack.1.json`, so an editor sees them and `ekwo pack check`
enforces them before a seed is written: the nine conditions, the three tax
points, the four fiscal year openings, the bank formats by name, four digits
for an ISO 6523 scheme, a date for the obligation. Four things the schema
cannot say are checked in the reader — a duplicate mention code, a validity
that runs backwards, a mention with no legal reference, and a number format
with an unknown token or without a counter — plus one that is a half-declared
pack: a day an obligation starts with no profile saying what becomes
obligatory.

**For an accountant to read.** Belgium declares a thirty-day legal term (loi
du 2 août 2002, art. 4), interest at the ECB rate plus eight points with the
40 € indemnity (art. 5 and 6), the tax point at the issue of the invoice
(art. 17 of the VAT code), Peppol BIS 3 mandatory between taxable persons from
1 January 2026, CODA and camt.053 statements, pain.001 payments, and six
mentions (AR n° 1 art. 20, art. 39bis, art. 21 § 2, art. 39, art. 56bis, and
the late payment terms). France declares thirty days (art. L441-10), the same
40 € indemnity (art. D441-5), the tax point on delivery with the service
exception on the tax, Factur-X from 1 September 2026 for reception, SIRET and
the French VAT scheme, camt.053 and CFONB 120 statements, pain.001 and
CFONB 160 payments, and six mentions (art. 283, 262 ter I, 283-2, 262 I,
293 B, and the late payment terms). **Three things are deliberately absent.**
The French *escompte* mention is one: article L441-9 requires the invoice to
state the discount conditions, and "néant" is a seller's commercial choice
that a country pack has no business asserting. The emission calendar of the
French reform is the second: it depends on the size of the company, which the
core does not hold, so the date in the column is reception — the one that
binds everybody at once — and the calendar is in the legal reference. The
third is an `exempt` mention for either country: both packs carry an
exemption tax, neither law prescribes one sentence for it, and a sentence we
would have written ourselves is not data.
## VAT when the cash moves, and the exchange difference when it settles (12 September 2026)

Two rules a country decides that the core had no way of applying, and they
meet in one place: the moment a document is settled.

**The French pack was wrong for every service business, and it is the reason
this sub-task exists.** French VAT on a supply of services falls due when the
price is collected, not when the invoice is issued (CGI art. 269-2-c); goods
fall due on delivery. A pack that offers one sale tax per rate offers the
goods answer to everybody, and a service company filing on it declares its VAT
one to three months early, every month. The columns to say otherwise landed
with the tax engine — `cash_basis` and `cash_basis_transition_account_id` —
and nothing read them. Now something does.

**A tax that waits is booked on an account that says so, and on no box.**
`post_document` puts the tax of a cash-basis tax on the transition account the
pack names and writes no declaration box, because nothing is due. The matching
moves the settled share to the account and the box it is finally declared on,
dated on the day the settlement completes, as an entry of its own.
`vat_return()` needed no change at all, which is the proof that the boxes are
the only thing that moved: it sums lines that name a box, and until the
transfer there is no such line.

**The base travels with its tax.** A cash-basis return reports the base
*collected* — line 08 of the CA3 carries a base column and a tax column, and
they have to be the same operation. So the base line of a cash-basis document
also waits, and the transfer carries it: a line with a box, an amount to
report and no debit and no credit. That is not a trick, it is the distinction
this schema has made since the tax engine — a declaration figure is not a
ledger figure — used for what it is worth. Revenue is still earned when it is
invoiced; only the declaration waits. Cash accounting as a *ledger* stays out
of scope, and a cash-basis report stays derived from matched payments.

**The share is cumulative, and the last payment carries the remainder.**
`settle_cash_basis_tax()` works out what *should* have been transferred at the
current settlement ratio, subtracts what earlier matchings already sent on,
and books the difference. Nothing is stored about the history: the ledger is
the history. A tax of 200,00 settled in three parts of 400,00 out of 1 200,00
comes to 66,67 then 66,66 then 66,67, because each step rounds the whole and
not the step. And because the function only ever books a difference, it is the
same call when a matching is *undone*: the share falls, the difference is
negative, and the mirror entry is posted. `unreconcile` needed one line.

**A cash-basis tax takes one tax posting per document kind.** The transition
lines of a document have to be told apart when the matching sends each of them
on, and two postings on one transition account cannot be. It is not a
limitation in practice: a tax whose postings net out is self-assessed, and a
self-assessed tax has no cash to wait for. `post_document` refuses it by name
and `ekwo pack check` refuses it before a seed is written — as it does a
cash-basis tax that names no transition account, and one that also carries a
non-deductible share, because a cost is not deferred to a payment.

**The French pack gains six taxes and two accounts, and changes none.**
`FR-S-20-ENC`, `FR-S-10-ENC`, `FR-S-055-ENC` for services sold and
`FR-P-20-ENC`, `FR-P-10-ENC`, `FR-P-055-ENC` for services bought — the
purchase side because the right to deduct arises when the tax falls due at the
supplier (CGI art. 271-I-2), which for a service is the payment. The accounts
they wait on are `445870` and `445860`, under the 4458 head the PCG calls
*taxes sur le chiffre d'affaires à régulariser ou en attente*. **The option
for the debits is the tax that was already there**: a services company that has
opted for the debits invoices on `FR-S-20`, unchanged, and declaring a second
identical tax to mean "the same thing without the option" would be two rows
for one calculation. Belgium gains nothing here: the Belgian regime has no
general cash-basis option in the socle, and inventing one would be a country
rule written by us.

**The ledger did not convert, and now it does.** A document in a foreign
currency booked its foreign figures into `debit` and `credit` as if they were
the company's own, and `entry_lines.amount_currency` — which the FEC exports —
was written by nothing. Without that, an exchange difference cannot exist,
because both sides are already equal. So `post_document` and `post_payment`
book the company's currency in the ledger and the document's beside it, at the
rate carried by `documents.exchange_rate` and by the new
`payments.exchange_rate`: units of the foreign currency for one of the
company's, which is how `currency_rates` has always stated one. There is no
rate feed and there will not be one here; the rate is an input.

**Every amount is worked out in the document's currency and divided once.**
The share-out of a tax between postings, the rounding of the group, the split
of a non-deductible share over the accounts of the lines: all unchanged, in
the document's currency, and each result divided by the rate as it is written.
At a rate of 1 the division is the identity, which is why `posting.test.ts`
was not touched and is green. The counterpart still balances by construction,
and it balances in both currencies; the total it is checked against is the one
`documents.amount_total` is stated in, which is the document's.

**A matching between two lines in the same foreign currency is worked out in
that currency.** That is where they are equal: 1 000,00 USD settles 1 000,00
USD, whatever each side was booked at. Each side turns it back into the
company's currency at its own rate, the two figures differ, and the difference
is realised — booked on `fx_gain_code` / `fx_loss_code` of the country model,
against the third-party account, so that account goes to nil and the customer
who has paid in full owes nothing. `p_amount` is read in the shared currency in
that case, and in the company's in every other, which is every matching made
before this change. A missing role is a refusal *the day a difference arises*
and not a day earlier: a pack that never meets a foreign currency never has to
name an account it does not use.

**The transfer and the difference go on the miscellaneous journal, not the
bank.** A bank journal has to tie to a bank statement, and neither of these is
a movement of money. They are dated on the day the settlement completes — the
later of the two entries matched — and `post_entry` asserts the period is open,
including the tax lock, so a matching that would move a declared figure is
refused rather than booked quietly.

**What a matching caused is part of what it returns.** `reconciliations` gains
`fx_entry_id` and `tax_transfer_entry_id`, the MCP server exposes both, and
`unreconcile` uses the first to take the difference back: its companion
matching is deleted and a mirror entry cancels it on its own date.

**Out of scope, said plainly.** Revaluation of open items at a closing date —
the difference that is *not* realised — is not here; `755`/`655` in Belgium and
`476`/`477` in France are the accounts it would need, and it is a question for
audited accounts rather than for a first invoice. Neither is a gross-to-net
computation for a tax-inclusive price, which waits for the country that sells
that way.


## Format libraries live in this repository, under MIT, one package per format (12 September 2026)

A country is data; a file format is code, and a format is not a country: Factur-X
is French and German, UBL is universal, camt.053 is European. So the export bricks
are organised by format under `packages/formats/`, never by country — the pack says
which formats a country uses, in `einvoice_profile` and the bank format lists.
They join this repository for the reason `ee/` did: a taxonomy change is one pull
request, not a two-repository coordination, and the golden test that proves the
pack and the brick agree can only run where both are. Each package keeps its own
MIT `LICENSE`, imports nothing from the core, and declares the row shapes it reads
in its own types; a test enforces all three. The truth of a mapping stays in the
pack; the brick carries only the official taxonomy, generated from the published
package, and `ekwo pack check` resolves every key against it — for the NBB schemes
a key has to resolve to the very line code that carries it. A brick declares no
`schema_min`: the contract is the shape of the rows, and the end-to-end test is
what breaks when it moves. `@ekwo-ai/xbrl-cbso` and `@ekwo-ai/factur-x` come in by
subtree; the FEC leaves `@ekwo-ai/core` for `@ekwo-ai/fec` — `packages/core`
still re-exports it from `src/fec.ts`, marked `@deprecated` and unchanged, so
that `@ekwo-ai/core` and `@ekwo-ai/core/fec` keep working for one version;
the re-export goes in the next. Should the core still
be private when the phase 1 formats begin, `packages/formats/` splits out as one
public repository with the same structure.


## Modules — one schema each, and the ledger only through a function (13 September 2026)

The socle is an accounting core, and fixed assets, budgets, a carbon ledger or
a crypto register are not it. Each of them is a set of tables, a calculation
and a report that a company either wants or does not — and every one of them
ends the same way, with an entry. The question this answers is where they live
and what they are allowed to touch.

**One Postgres schema per module, and the socle stays in `public`.** `assets`,
`budgets`, `carbon`. The alternative was a prefix on the socle's own tables —
`asset_*`, `budget_*` — which is what most products do and what makes a schema
nobody can read after the fourth module. A schema is also what makes the rest
of this possible: one line of PostgREST configuration turns a module on for the
API, one `revoke` closes it, `docs/schema.md` has a section per module, and a
module that is not installed is not an empty table, it is nothing at all.

**The registry is a table, not a plugin system.** `public.modules` holds one row
per module this installation carries, written by the last statement of the
module's own first migration; `company_modules` says which company has enabled
which. There is deliberately no registry in TypeScript: a module that is
installed is a schema that exists and a row that says so, and one query answers
"what is here" for the CLI, the MCP server and a human. A plugin registry in
code would have been a second place to keep in step with the database, and the
first release where they disagreed would be a module that half exists.

**A module never writes the ledger by hand: `post_module_entry()` does.** This
is the whole architecture. The sub-task as written asked for a *privilege* —
revoke insert on `entries` from the module schema — and Postgres has no such
thing: privileges belong to roles, not to schemas, and a module's functions run
as the signed-in user, who legitimately writes the ledger through
`post_document`. So the rule was made structural instead. A module hands over a
company, a date, a tag and its lines as data, and the socle builds the draft and
calls `post_entry()` — exactly what `post_document`, `post_payment` and
`close_fiscal_year` already do. The words `entries` and `entry_lines` therefore
do not appear in a write statement anywhere under `modules/`, and a test over
every file proves it. That is a stronger guarantee than the revoke would have
been, and it is checkable.

**The tag is what makes a module idempotent, and the database enforces it.**
`entries.module_code` and `entries.module_ref`, with a unique index on
`(company_id, module_code, module_ref)`. `assets.run_depreciation` cannot book
the same period twice because the second insert fails, not because the function
remembered to look. Every package that guards a posting with a flag it checks
first has the same hole: a stale screen, a double click or two clients at once,
and the entry is there twice with nothing looking wrong. Tagging by
`(module_code, ref)` is also why `entry_kind` gains no value per module: a
depreciation entry is an ordinary entry that a report may leave in, and a
fifteenth enum value per module would be a report that has to know every module
before it can filter.

**A module is enabled per company, and the table has no write policy.**
`enable_module()` and `disable_module()` are definer functions with the owner
check written inside, for the reason `register_instance()` is: a guard that
lives in the function applies to psql and to PostgREST alike, and a guard that
lives in a policy applies to whoever respects it. `module_enabled(company,
code)` — the module being on *and* the caller being a member — is the one call
every module policy makes, which is why it joins the eight helpers `anon` may
execute: what it gives away to a stranger is the word `is_company_member`
already gives them.

**Disabling asks the module, by convention and not by column.**
`disable_module()` looks for `<schema>.can_disable(uuid)` and runs it if it
exists: null allows, a sentence refuses and is quoted in the error. A column on
`modules` naming the function would have been one more thing to keep in step
with the code; the absence of the function is itself meaningful, and `budgets`
is the module that exercises it — turning it off takes nothing away, because
row level security hides the rows and enabling it again gives them back.
Nothing a module wrote is ever deleted by a disable.

**A country is data inside a module too, and the accounts are roles of the
chart.** `packs/<cc>/assets.json` says how a country prorates a first period,
whether its declining balance is capped and how it derecognises an asset;
`ekwo pack build` compiles it into `supabase/seed/modules/assets/`, applied by
the module migration runner and by nothing else, because those tables do not
exist on an installation without the module. The accounts, though, went into
`country_defaults` and `defaults.roles` rather than into a table of the
module's own: a role is the answer to "which account of this chart plays this
part", there is one place a pack answers that, and putting the fourth answer
somewhere else would mean `ekwo pack check` — which already refuses a role code
missing from any chart the pack ships — was not checking it.

**A disposal is two mechanisms, and the enum names them and not the
countries.** Belgium clears the asset and puts the difference on one account,
763 or 663; France books the net book value as a charge on 675 and the proceeds
as an income on 775, both in full, and the income statement prints the two.
Neither is a variant of the other, so `assets.country_rules.disposal_style` is
`net_result` or `gross`, named after the mechanism — the same decision
`closing_style` made, for the same reason. Four nullable role columns follow,
two per style, none with a default: a pack that has said nothing gets a refusal
naming the role it is missing.

**Migrations of a module share the socle's history, and sort after it.**
`supabase_migrations.schema_migrations`, the plain timestamp as `version`, the
module in the `name` — `assets/assets`. Anything else forks the history that
makes `ekwo migrate` and `supabase db push` interchangeable, which is the whole
point of having written it Supabase's way. The consequence is a rule and a
test: a module's timestamps come after every socle migration, and no two
migrations anywhere share a version. `ekwo migrate` applies the modules by
default — a schema whose migrations are half applied is the state nobody can
reason about, and an empty table under row level security is not a feature
anybody has been given — and `--no-modules` is what to pass before running
`supabase db push`, which knows the socle's files and not a module's.

**The one thing no migration can do is expose the schema.** PostgREST serves
what the project lists under its exposed schemas, which is a setting of the API.
So `ekwo module enable` prints the line to add, every time, and the MCP server
turns the profile error PostgREST answers with into the same sentence rather
than into something that reads like a bug in the server.

**What `assets` deliberately does not do.** It refuses a schedule by output
(`units_of_production` is in the enum and raises by name, the way
`post_document` refuses a fixed-amount tax), it refuses to rewrite a schedule
whose lines are already booked, and it refuses a disposal while a period that
has already ended is unbooked. Each of those is a place where guessing would
have produced a register that no longer ties to the ledger, which is the one
thing a fixed asset register is for.

**Three conventions here are our reading of the mechanics.** A prorata in days
counts the day of entry into service — 184/365 for a Belgian asset in service on
1 July, 256/360 for a French one on 15 April — which is the convention that
makes a full year come to exactly one, and not the only one in use. A declining
balance measures what is left to run in periods and not in months. And Belgium
prorates the first annuity for every company, because article 196, § 2, 1° CIR
92 obliges it for companies that are not small ones and the core holds no
"small company" column; a small company that takes the whole first annuity sets
`prorata = 'none'` on the asset. All three are in `modules/assets/README.md`
under a heading that says an accountant should read them.

## A company has a face, members have capabilities, machines have keys (13 September 2026)

Everything an accounting product has that the core did not: a company profile
an invoice can be printed from, invitations, user preferences, fine
permissions, a numbering engine that reads the pack, machine keys, and a first
financial year that is not January by assumption. Seven changes, one theme — the core knew how to
keep books and did not know who was keeping them.

**A role becomes a preset, and a capability becomes what a policy tests.**
`company_members.role` had three values and every policy in the schema read
one of them, through `is_company_member`, `can_write_company` and
`is_company_owner`. That is a permission model with three positions: a
bookkeeper who may post invoices and must never move a period lock has no row
to sit on, and the answer in every product that meets the case is a fourth
role, then a fifth. So `capabilities` is a table of twenty codes — twenty-one
since `entries.import` (`20260913092527`), and five more once the `assets` and
`budgets` modules add their own —
`role_capabilities` says what each preset holds, and
`company_members.capabilities_granted` / `capabilities_revoked` adjust one
member in both directions. A revoke wins over a grant and over a preset —
including on an owner, because a company that wants its owner unable to close
a year is describing its own separation of duties, not making a mistake. Every
policy **of the socle** now calls `has_capability()` — a module's policies
went on asking `can_write_company()` until 13 September 2026, when each module
took its own codes — and `can_write_company()` is rewritten on
top of it rather than left beside it: it is the answer to `entries.write` and
nothing else. **The three roles do exactly what they did the day before**, and
that is the half of it a test would notice.

**No fourth role, and two capabilities that were not written.** `admin` was
considered and left out: the existing helpers drew one line — write the books,
or administer the company — and `owner` is already the second half of it, so a
role between them would have been a name with no work to do. Somebody who
needs exactly that is an accountant with `members.manage` granted. And
`reports.read` and `exports.run` are absent on purpose: `trial_balance()` and
the statements sum ledger lines that row level security has already filtered,
so a member without `entries.read` gets an empty report today. A second lock
on the same door is a lock nobody turns, and a capability nothing can refuse
on is the thing the naming policy forbids.

**Posting and closing are acts, so they are guarded by triggers.**
`documents.post`, `entries.post` and `year_end.close` name three things a
policy on a table cannot express: what changes is a state, on a row the member
may already write. A trigger on the transition holds for every path into it,
including a client that updates the column itself, and it does not require
republishing a function that carries a thousand lines of accounting for four
lines of permission.

**A guard written a day earlier had never fired.** `next_entry_number()` and
`next_matching_number()` became `SECURITY DEFINER` on 11 September with a check
that the caller may write the company — "a definer function that skipped that
check would be a way to burn numbers in somebody else's journal". The check
was `if auth.uid() is not null and not can_write_company(...)`, and
`can_write_company()` was `company_role(...) in ('owner','accountant')`:
`company_role()` returns NULL for a stranger, `NULL in (…)` is NULL, and `if
not NULL then raise` does nothing. So any signed-in stranger could draw
numbers in any journal of the installation. `has_capability()` returns false
rather than null and the guard fires; the test that would have caught it is in
`tests/capabilities.test.ts`. The demo seed fell over the fix, correctly: it
was booking as whoever ran `ekwo demo`, who is not a member of the fictional
company, and it now sets the claim to its own fictional owner for the length
of its transaction.

**An invitation names an address, not a user id.** `company_members.user_id`
has no foreign key to `auth.users` precisely so a membership can exist before
the person signs up — and there was no act that produced one, so somebody had
to read an id out of the Auth dashboard. `invite_member()` returns a token
once and stores a sha256 of it; `accept_invitation()` requires that
`auth.email()` match the address invited, case-insensitively, and is single
use and expiring. `sha256()` is core Postgres since 11, so no extension —
`pgcrypto` is not available in PGlite and the schema does without it.
Accepting is deliberately not an MCP tool: it is the invitee's own act, from
the application or from any client holding their session. `ekwo
accept-invitation` is not in this release because the CLI has no GoTrue
sign-in — it creates the first administrator through the admin API and holds a
database connection, not a session — and adding a password grant to a binary
that is handed a `service_role` key is not a small decision.

**A preference has no default, and a label is chosen in one place.**
Every *preference* column of `user_preferences` is nullable and carries no
default — `preferred_company_id`, `language`, `timezone`,
`date_display_format`, `number_display_format`, `theme` — and null means "take
the company's answer, then the pack's", which is the rule the document and
year-end decisions already keep for a country. Three columns are not nullable and are not
preferences: `user_id`, which is the key, and `created_at` / `updated_at`,
which are when the row was written. A row's own timestamp is not an answer
somebody inherits, so `now()` on those two is not the kind of default this
rule is about. `label_for(name, name_i18n, languages)` is now the only spelling of
the resolution that was written out wherever it was needed, and
`preferred_languages(company)` builds the chain — the user, then the company,
then the pack. `install_country_template()` is republished on it and keeps
passing one language, the company's: a chart of accounts is copied in the
language the books are kept in, not in the language of whoever ran the
installer. The MCP hands a client the chain and the material; it does not pick
a label for it, because which label a renderer prints is the renderer's
question.

**A display format is not a numbering pattern, and they stop sharing a name.**
The preference columns are `date_display_format` and `number_display_format`:
`country_defaults.number_format` already existed, where it is the pattern a
document number is built from, and two questions that have nothing to do with
each other should not answer to one name — a reader meeting both would have to
know which table they were in to know what they had. The guard that watches
for a country rule leaking into a function had already had to learn the
difference, which is what made the homonym visible.

**The numbering engine the document rules deferred.** That entry said, in as
many words,
that `next_entry_number()` did not read `number_format` and that "a numbering
engine that consumes a format is its own piece of work". This is it, on the
grammar already published: `{CODE}`, `{YYYY}`, `{YY}`, `{MM}` and a `{N…}`
counter padded to its own width, and `format_number()` raises on a token it
does not know rather than printing it. There is **no fallback literal**: a
pack that declares nothing gets `no_number_format` naming the field it has to
fill. The counter follows the pattern — a year in it restarts with the year,
and a pattern with none keeps one series for the life of the journal, under
period 0 in `journal_sequences`. A `{MM}` **prints** the month and does not
restart the counter: a monthly series is a fifth numbering style, no pack
declares one, and inventing the behaviour before a pack asks for it is how a
guess becomes a rule. Belgium and France declare exactly the pattern the
engine used to hard-code, so nothing about their numbers changed, and the
demo's FEC is byte for byte what it was.

**`numbering_gapless` gets its reader, and the exception has a name.**
`post_entry()` refuses a number chosen by hand where the country forbids a
hole in the sequence, because a number that skips the counter is exactly how a
hole appears. The argument that rule would have with an import arrived
immediately rather than later: a company moving from another system arrives
with years of entries whose numbers its returns, its filings and its auditor
already know, and refusing them would make the core unable to take over a set
of books.

So **`entries.import` is a capability, in no preset**. Not a flag on the call,
not a session setting: the one thing that lets an explicit number through is
something an owner grants on purpose to the person doing the import, and takes
back after it. Importing is not something an accountant does on a Tuesday.
What it does not relax: a duplicate is still refused, by the unique index on
`(company_id, number)` that has been there since the first release — stricter
than per journal, and it fires when the entry is written rather than when it
is posted — and an explicit number from somebody without the capability is
refused exactly as before. The guard carries no exemption for the
installation, unlike the permission checks, because a gapless sequence is a
rule about the books and not a permission: an importer running over a
superuser connection sets the request claim for the user it acts for, the way
`ekwo demo` already does. It asks for the capability and for nothing else,
which is also how a machine key holding `entries.import` is admitted.

**And the counter catches up.** `number_counter()` reads a counter back out of
a number through the pattern it was written with, and
`catch_up_journal_sequence()` advances `journal_sequences` to it — so the
first entry booked after an import continues the series instead of restarting
at one and colliding with it. A number written in another system's shape does
not parse against the pattern, and then the counter is left alone, because
there is nothing in it the counter could learn.

**A key is a third kind of caller, and it is narrower than both the others.**
A script has no browser to sign in with, and the two usual answers are wrong:
a `service_role` key gives it every company and every table, and a fake user
puts a password in a crontab and makes the audit trail say a person did it. An
`api_keys` row belongs to one company, carries an explicit list of
capabilities, expires when it is told to and is stored as a sha256. Nobody
mints a key stronger than they are — every capability on it has to be one the
issuer holds — which is also what makes revoking a person's capability revoke
the keys they left behind. **How it authenticates**: the holder calls
`use_api_key(secret)` at the start of a transaction, which puts the key's
fingerprint in `ekwo.api_key` transaction-locally, and `has_capability()` then
answers for it. The alternative was exchanging a key for a GoTrue session,
which needs either a fake user per key — the thing this avoids — or a service
that mints tokens, which is a second secret to hold. The setting is simpler
and its blast radius is one transaction. What it is not, stated rather than
discovered: a key is not a session. `auth.uid()` stays null, so the policies
that ask for a signed-in user rather than for a capability — the reference
tables, the company row — stay closed to it; and because PostgREST runs each
request in its own transaction, a key is for a client that holds a connection,
which is the self-hosted route the MCP server already has. Forging the setting
buys nothing: what goes into it is the hash, and the hash is only readable by
somebody who already holds `members.manage` and can simply issue a key.

**The installer is named, because "no session" turned out to mean "a key".**
Eleven guards were written as `auth.uid() is not null and not
has_capability(…)`, meaning "the installation itself is exempt": `ekwo
migrate`, the seeds and the CLI hold a database connection and no session, and
a guard that asks for a capability would refuse the install. A key is
precisely a caller with no `auth.uid()` — that is the design, not an accident
— so every one of those guards stood aside for it, and the narrowest caller in
the schema became the widest: a key issued with `["entries.read"]` could post
an entry, book a document, close a year, invite a member, create a company and
issue itself a second key carrying everything. Corrected on 13 September 2026
by **`is_installer()`**, which is true only when the runner set
`ekwo.installing` on its own connection, and false outright when there is a
session or when `ekwo.api_key` is set. A caller reaching the database through
PostgREST cannot set a GUC, and a caller holding a key has one set for it, so
neither can ever be the installer whatever it does. `has_capability()` is now
the only authority over people and machines alike, which is what this section
already claimed it was.

**A guard that answers NULL never fires.** The same audit found the other half
of it: `is_company_owner()` and `can_write_company()` were built on
`company_role()`, which is NULL for somebody who is not a member. In a policy
that is harmless — `USING (NULL)` admits nothing — but `if not
is_company_owner(c) then raise` does not branch on NULL, and
`enable_module()` / `disable_module()` are SECURITY DEFINER on a table with no
write policy, so they were the only door and it was open to any signed-in
stranger. Both helpers now answer `false`, the two module functions ask for
`company.write` instead of a role, and `hardening.test.ts` calls every boolean
helper of the schema as a stranger and refuses one that answers NULL — so the
shape stays safe for whoever writes the next guard.

**A company has a face.** Eight columns on `companies` — trade name, logo URL
or storage path (the core keeps no file), stated capital with its own
currency, activity code with the register it belongs to, default bank account,
document template. No `registry_reference`: `registration_number` already is
the number the commercial register holds, and a second column for it would be
two answers to one question. The capital with no currency takes the company's
own, in a trigger, because the alternative was a literal. A sales document
with no payee IBAN takes the default bank account, in a trigger on `documents`
for the reason the account of a line is resolved in one — every client has to
get the same answer — and a purchase document never does, because the payee
there is somebody else. `document_header` is the third view a renderer needs
beside `document_line_items` and `document_legal_mentions`, and `get_document`
was rewritten onto it rather than keeping its own assembly.

**The first financial year is a parameter.** `ekwo init` opened it on 1
January in two string literals, which is right for Belgium and France and
wrong for the United Kingdom, India and Australia — and
`country_defaults.fiscal_year_default` has carried the answer since the
country model learned what a document requires.
`fiscal_year_bounds()` is its reader, in the schema rather than in the CLI
because three callers ask the same question and three answers is how a company
ends up with two overlapping first years. A pack that says nothing gets
`no_fiscal_year_default` naming the field and the flag, never a January nobody
chose.

**`create_company()` and `bootstrap()` both create a company, and that is
deliberate.** The two rules involved — what a country pack puts in a company,
and what two dates a financial year has — live in `install_country_template()`
and `fiscal_year_bounds()`, and both callers delegate to them. What is
duplicated is the order of four inserts, and what differs is the behaviour
that cannot be shared: the installer is check-then-act, reports "already
there" for every step and can be run twice on a half-finished project, where
the function creates or raises.

**One rule of the modules change had to be narrowed, and it would have had to
be narrowed by whatever landed next.** A module's migrations were asked to
sort after *every* socle migration, so that one recorded history reads in
order. This release was the first socle change to land after a module, and it
broke
that test by existing: the socle will always gain a migration the week after a
module ships, and the only way to restore a total order is to rename a
published module migration — the one thing rule 1 of
`supabase/migrations/README.md` forbids. What a module can promise, and what
the order actually needs, was already the test beside it: every migration of a
module sorts after the socle migration its manifest declares it needs. The
applied order never depended on the timestamps anyway — `ekwo migrate` runs
the socle first and the modules after.

**The module policies already go through `has_capability()`, and their own
codes are theirs to add.** `assets` and `budgets` wrote
`module_enabled(company, code) and can_write_company(company)`, and
`can_write_company()` is one capability — so a member who lost `entries.write`
lost the module with it, which was the behaviour that was there before. **Done
on 13 September 2026**, each in its own migration, because a migration of the
socle that named `assets` would be the socle knowing what is built beside it.
`assets` declares `assets.read` / `assets.write` / `assets.post`, `budgets`
declares `budgets.read` / `budgets.write` and no `post` because it writes
nothing to the ledger; `capabilities.area` is the module code, which is what
that column was for. `assets.post` is asked *as well as* `entries.post`, not
instead of it: one says the module may send this to the ledger, the other is
the socle's own question, and an accountant who posts the books may be
deliberately kept off the asset register. The presets follow the socle's — a
viewer reads, an accountant works, an owner holds everything — and a code
added after the socle's migration has to name the owner itself, because that
preset was filled with `select 'owner', code from capabilities` at the time.

## The audit of 13 September 2026

**A currency and a decimal are rounded half up, on the absolute value, at the
currency's decimals — one rule, in every language this repository is written
in.** Three packages answered it three ways: `factur-x` added an epsilon and
rounded, `xbrl-cbso` rounded without one, and the MCP server used
`toFixed(2)`. All three are `Math.round` underneath in spirit, and `Math.round`
goes towards positive infinity — so -0.005 became -0.00 in one place and -0.01
in another, and a credit note stopped being its invoice with the sign flipped.
The other case is the one a binary float cannot hold: `2.675 * 100` is
267.49999999999994, so half up gives 2.67 where the rule says 2.68.

Half up on the absolute value is what an invoice, a VAT return and a set of
annual accounts are written with, and it is symmetric by construction. The
decimals are the currency's, which is two for every currency this repository
has met and is not two for all of them — `currencies.decimal_places` is the
column that will answer it, and until something reads that column the helpers
take the number as an argument and default it to two.

A format brick may not import the core or another brick, so the rule cannot be
shared as code: `rounding.ts` is the same file in `packages/formats/factur-x`,
`packages/formats/xbrl-cbso` and `packages/mcp`, and `tests/rounding.test.ts`
runs one vector through all three and then compares the three files byte for
byte. A copy that drifts fails the build.

**Five columns are declared and read by nobody, and now they say so.**
`country_defaults.rounding_method`, `country_defaults.cash_rounding_unit`,
`country_defaults.bank_statement_formats`, `country_defaults.payment_formats`
and `currencies.decimal_places` are each filled by a pack and consulted by no
code path. Every one of them was added for the right reason — the alternative
is migrating a table of years of rows a second time — and none is removed.
What was missing is the sentence that tells the next reader which columns are
load-bearing and which are a promise, because a column with a plausible name
and no reader is read as behaviour, and a pack author fills it expecting
something to happen. `20260913105120` puts that sentence in each column's own
comment, and `docs/schema.md` is generated from those.

One of the five has to stop being a comment: **`decimal_places` is what "at
the currency's decimals" means**, and every rounding in the schema and in the
three copies of `rounding.ts` is at two. Two is right for every currency the
packs carry and wrong for the yen, which has none, and the dinar, which has
three. Making the rule read the column is its own piece of work — it touches
`post_document`, `post_payment`, `settle_cash_basis_tax`, the statements and
the three format packages, and it needs a currency with something other than
two decimals in a pack before it can be tested honestly. It is not done here.

## A label is data, and a declared language is a promise (13 September 2026)

The schema had been bilingual in shape since the country packs landed —
`name_i18n` beside `name`, `label_for()` to choose between them — and
monolingual in fact. All four language files of Belgium and France held
`{}`. A Belgian company keeping its books in Dutch got a chart of accounts, a
set of journals and a VAT return in French, because the columns existed and
nobody had written the rows.

**Identifiers are English, permanently; labels are data.** Table names, column
names, enum values, function names and error codes are English `snake_case`
and are part of the interface a program tests against. Error messages are
English too, prefixed by a stable code — `period_locked: …` — so that a client
matching on the code can write its own sentence in any language without the
core ever holding two vocabularies. Everything a person reads because a
country said so is a row.

**Two tables were missing their column, and that was the whole gap.** The
accounts, the charts, the declaration boxes, the statement lines, the legal
mentions and the fixed-asset categories already carried a translation; the
journals and the taxes did not. So "translate Belgium" was never only a data
job: a company reading `Verkoopdagboek` over a chart in Dutch needed
`journal_templates.name_i18n` and `tax_templates.name_i18n` to exist first.
`country_defaults.name_i18n` came with them, because the country's own name is
shown as often as anything else.

**A declared language must be complete, and an undeclared one may be partial.**
These are the two halves of one rule. `languages` in the manifest is a promise
to a reader, and `ekwo pack check` holds the pack to it: every account of every
chart, every journal, every tax, every box, every statement line, every legal
mention and every asset category, or the check fails naming what is missing. A
half-translated pack is worse than an untranslated one — a chart of accounts in
Dutch under a return in French leaves nobody able to tell whether the software
is incomplete or the rule is different. But refusing anything short of complete
would mean no language ever gets contributed, so a file that is *not* declared
is allowed to be partial and falls back key by key. That is the path: write
what you are sure of, add the code to `languages` on the day it is finished.

**A translation lives in one file and nowhere else.** A legal mention carried
its `text_i18n` inline in the manifest and an asset category its `name_i18n`
inline in `assets.json`, which meant that adding Dutch to Belgium touched three
files and that two of them could disagree with the third. They moved into
`i18n/<lang>.json`, which now carries every section. One file per language is
what makes a translation reviewable by somebody who reads that language and
nothing else.

**Where a country publishes the wording, the pack uses it rather than
translating.** Belgium publishes its minimum chart of accounts in four
languages, its VAT return boxes in three and the models of its Central Balance
Sheet Office in four; those are the labels, and their source is cited in
`packs/be/i18n/README.md`. The German set is the Accounting Standards
Commission's own, which that Commission itself publishes as an unofficial
translation — so it is authoritative exactly as far as that document is, and
the README says so. France has no official English chart of accounts and there
is nothing to transcribe, so `packs/fr/i18n/en.json` is the wording the
profession uses, said plainly in its README. The rule when neither exists is to
leave the key absent: an absent key falls back and is visibly untranslated,
where a guessed one is wrong and looks right.

**The check lists the cause before the consequence.** Take a box out of a
declaration form and every language stops resolving it, so a single structural
mistake used to bury itself under forty translation errors. Structural problems
are now listed first. Nothing about the check changed except the order, and the
order is what makes it usable.

**`ekwo init` asks rather than assumes.** It offered the pack's own language as
the answer to press Enter on, which is right for one Belgian company in three.
The question now lists what the pack publishes, with nothing pre-selected, and
`--language` is required outside an interactive session whenever there is a
choice. `country_defaults.languages` is where the list comes from, because an
installation has the compiled seeds and no pack folder to read.

## The FEC carries its opening balances, and an unclosed year carries its result (13 September 2026)

`fec_lines()` returned the movements of a period and nothing else, so the file
of a financial year could not rebuild the balance sheet it belongs to: every
account started the year at nil. A tax inspector reads the *à-nouveaux* first,
and the closing decision of the release before this one had made them
impossible to post — every report here reads the ledger from the beginning, so
an opening entry does not carry a balance forward, it counts it twice.

**So they are computed, and never posted.** The opening lines exist in the
export and nowhere else. That is the whole reconciliation of the two
decisions: the ledger stays cumulative and free of *à-nouveaux*, and the file
carries them because the file is a per-year artefact and the ledger is not.
The amounts come from `trial_balance()`, which is where this repository
computes a cumulative balance — a second way of computing one is a second
answer waiting to differ from the first.

**A balance-sheet account is one that carries forward, and that is a fact
about its type.** The lines are selected on `accounts.carries_forward`, derived
from `account_type`, so nothing reads a code prefix: a chart that numbers its
assets in a fifth class is read correctly without anyone saying so.

**An unclosed year carries its result, and the export is never refused for
it.** An accountant produces the file of a year long before the meeting that
closes the one before it. The accounts that do not carry forward are the mirror
image of the balance-sheet ones, so leaving them out leaves the opening lines
short by exactly the accumulated result — and that amount goes on one more
line, on the balance-sheet account **the close would have left it on**. Which
account that is comes from `closing_style`, and the three answers are not the
same: `result_accounts` keeps it on a balance-sheet account of its own until a
meeting allocates it (France, 120 or 129); the other two have already reached
retained earnings by the time the year is over — an appropriation account is
*inside* the income statement and the closing entry empties it, so 693 is
never what a Belgian balance sheet carries forward, 140 is. A pack that names
no such account gets `no_result_account`, and so does one that names an income
or expense account, which would carry nothing at all.

**The entries a close writes are left out of the file of the year they
close.** A closing entry books the mirror image of every income and expense
account, and an appropriation entry moves the result to retained earnings;
both are dated inside the year being exported. Kept, they show the result
twice — once in the ordinary movements, once on the balance sheet — and the
income statement read from the file is nil. Left out, the file of a closed
year is byte for byte the file of the same year still open, and the result
reaches the balance sheet in the opening lines of the year that follows, which
is where a French or a Belgian package prints it too. Two tests hold that
sentence: closing a year does not change its file, and the opening lines of
the year after are the same whether the year before is closed or not.

**`financial_statement()` leaves out `closing` and keeps `appropriation`, and
the FEC leaves out both — deliberately, not by oversight.** They are not the
same question. An appropriation account is part of the statutory income
statement of the countries that have one, and the section that shows the
allocation would read nil without it. The FEC is not a statement: it is the
movements themselves, and it already carries the whole income statement in its
ordinary lines. Forcing the two readers through one predicate would mean one
of them is wrong; what they share is the column, and this paragraph.

**Only a whole financial year gets opening lines.** The FEC is a file per
financial year — its name is built from the year end — and an extract of a
quarter is an extract of movements. A period that starts or ends anywhere but
on the bounds of a year gets exactly what it got before this change.

**The wording of those lines is a value of the country model.** The
specification fixes eighteen columns and the format of each; it fixes no
wording for `EcritureLib`, and an administration reads the file in its own
language. So `defaults.opening_entry_label` sits in the pack next to
`closing_style` — France says *À-nouveaux* — and it is not an i18n key: the
label is addressed to an administration and not to whoever happens to be
signed in. Unlike an account code it keeps a fallback rather than a refusal, a
neutral English label, because a format that fixes no wording has no wrong
answer to give and a missing label is not a reason to hold an export back.
A pack is asked for nothing at all when there is nothing to carry: a first set
of books opens on nil and needs neither a journal nor a result account.

**And the deprecated FEC re-export is gone**, which is the other half of a
sentence written on 12 September: `packages/core` kept `src/fec.ts` alive,
marked `@deprecated` and unchanged, so that `@ekwo-ai/core` and
`@ekwo-ai/core/fec` went on working for one version — "the re-export goes in
the next". This is the next one. The core still depends on `@ekwo-ai/fec`,
because `EkwoClient.generateFec()` writes the file it has just fetched; what it
no longer does is re-export somebody else's API as its own.

**For an accountant to read.** Three things here are our reading rather than a
rule we can cite. The opening lines are one entry per year rather than one per
account, numbered from the opening journal's code and the day the year opens —
the format requires a number and fixes none. They are aggregated per account
and carry no sub-ledger code, so the *à-nouveaux* of a customer account is one
line and not one line per customer; a firm that details them by auxiliary is
not doing anything unusual, and that is the change to ask for if an inspection
expects it. And the destination of a result no meeting has allocated is the
account the close would have used — 120 or 129 in France, 140 or 141 in
Belgium rather than 693 or 793, which are inside the income statement and
would carry nothing forward.


## An append-only audit trail, and the first pack upgrade (14 September 2026)

Two things that had been promised in this file since 12 September and did not
exist: a record of who changed what, and a way to move a company from the pack
version it copied to the one the installation now holds.

### What is recorded, and what is deliberately not

Everything the ledger does is already immutable: an entry is posted once and
corrected by a reversal. What sat outside that guarantee is everything
*around* the ledger — the chart of accounts, the journals, the taxes and the
accounts they post to, the bank accounts, the contacts, the products, the
financial years, who is a member of a company and with which role, which pack
version the company holds. Those decide how every future entry is booked, and
nothing recorded that one of them had moved. An auditor asking who changed the
VAT account on this tax, and when, had no answer, and neither did the operator.

`audit_log` is one table, one generic trigger function and seventeen triggers.
It records `who` (`auth.uid()`, and the machine key where one was presented),
`what` (the table, the natural key, the row before and after as `jsonb`, the
operation), `when`, and the `company_id` row level security reads. Beside the
ordinary edits it records the *acts*: a document posted or cancelled, an entry
posted or reversed, a payment booked, matched or unmatched, a financial year
closed or reopened, a pack upgraded.

**The ledger itself is not audited.** `entries` and `entry_lines` are immutable
once posted and are corrected by a reversal, which is already a visible act; a
second copy of every ledger line would double the largest table in the schema
to record what it already holds. What is recorded is the act of posting, never
the content.

**Not `pgaudit`.** The extension is unavailable under PGlite, so none of this
could be tested where the rest of the schema is tested, and its output goes to
the Postgres log — a file an application cannot query and a self-hosted
operator often cannot reach. An audit trail nobody can read is a promise, not a
control.

### Three decisions inside it

**Append-only is a trigger, not a policy.** Policies do not apply to the table
owner, and on Supabase `service_role` carries BYPASSRLS — so an audit trail
defended only by row level security is one the operator can quietly rewrite. A
`before update or delete` trigger that raises holds for everyone. The one
exception is `purge_audit_log(date)`, which lifts it for its own transaction,
takes the cutoff it is asked for rather than a default retention, is reachable
by `service_role` alone, and writes its own row saying how many it dropped.

**`company_id` carries no foreign key.** The trail outlives the rows it
describes: a cascade from `companies` would delete the record of the company's
own deletion. It is indexed and the policy reads it, which is all a foreign key
would have bought.

**The installer's bulk copy is not audited row by row.** Installing a country
pack copies a thousand accounts into a company, and a thousand rows saying
"account created" carry nothing the single `company_packs` row does not.
`is_installer()` is already this schema's name for the migration runner, the
seeds and `ekwo init`, so the trigger stands down for it and for nothing else.
A person, a machine key, and anyone connecting with `psql` are all audited —
`is_installer()` is set by the runner on its own connection and can never be a
session or a key. Creating a company through `create_company()`, which is what
an instance administrator actually calls, is audited in full.

Two secrets are never copied into the trail: `api_keys.key_hash` and
`company_invitations.token_hash` are replaced by null. A hash is a credential
that can be attacked offline, and the trail is read by more people than the
table that owns it.

### The upgrade, and why the version sometimes does not move

A chart of accounts is not a file to overwrite — the company has been booking
on those accounts for a year — so the difference is computed by natural key and
every difference falls into one of the three rules this file promised in
September: an addition is copied in, a closed validity is applied, and
everything else is listed and left exactly where it was. That third rule is the
point of the whole thing: silently overwriting a company's chart from a pack is
how an upgrade destroys a year of bookkeeping, and there is no way to be sure
from here which of the two is right, because an operator may have renamed an
account deliberately.

One thing is never applied whatever is asked: a row the company holds and the
pack does not. Nothing is removed from a company's books by an upgrade.

**The recorded version moves only when nothing is left waiting.** A company
that still holds a difference nobody has decided on has not finished
upgrading, and moving the number would hide that difference at the next run.

The rules live in the schema — `pack_upgrade_diff()` and `pack_upgrade()` — and
not in the CLI, so an application, a module or an assistant asking the same
question gets the same answer. `ekwo pack status` is the read-only half.

**The test is from 1.0.0, not from a fixture.** The first upgrade is the risk
nobody can rehearse twice, so `tests/pack_upgrade.test.ts` replays the four
published 1.0.0 seeds kept under `tests/fixtures/seeds-before-packs/` since the
pack format replaced them, installs a company from them, loads the packs of
this release on top, and asks what an upgrade does. Without that, "never
silent" is an intention.

### Versioning the socle

The schema version was already exposed in `instance` and printed by `ekwo
status`. Three things joined it.

**Each package declares a `schema_min`**, in `package.json` under `ekwo.schemaMin`
and as a constant in its source, the way a country pack declares one in its
manifest — the rows a package reads and the functions it calls are a contract
with a version of the database. **The MCP server enforces it**: it asks
`ekwo_schema_version()` before it offers a single tool and refuses an older
database by name, because what an assistant does with a missing column is
improvise, and the improvisation is an accounting entry. The CLI declares one
and prints it; it cannot fail on it, since it is the package that carries the
migrations.

**`ekwo migrate` recommends a snapshot before it applies anything**, and says
why: migrations move forward only, there is no `down` and there will not be
one, so undoing a schema change on a database with a year of entries in it is a
restore and not a script.

The rule that no published migration is ever edited is enforced by CI since
13 September and was not redone here. The tag that rule is measured against
arrived the next day: `v0.2.0`, on 14 September 2026, is the first release of
this repository, and from it the rule is absolute rather than conditional on
nothing having been installed.

**`ekwo doctor` gained one check and not an inventory.** It now reads the
catalogue and says whether the audit trail is still what it claims to be: the
guard trigger on the table, row level security on, no policy that lets a client
write, update or delete a row, and `purge_audit_log` executable by nothing but
`service_role`. A migration added later that put an insert policy on `audit_log`
"so the application can log too" would break the one property the table exists
for, and nothing else would notice. What is **left out** is the full
expected-object comparison the card also scoped: an inventory of every table,
column and function this release defines is a generated artefact like
`docs/schema.md`, not a list kept by hand in the CLI, and it is worth its own
change.

## An amount is rounded at the decimals of its currency (14 September 2026)

The audit of 13 September left one sentence to be made true: *"`decimal_places`
is what 'at the currency's decimals' means"*, and until then every rounding in
the schema was `round(x, 2)`. There were fifty-one of them, in eighteen
functions, a view and a generated column, and two columns that every pack
filled and nothing read — `currencies.decimal_places` and
`country_defaults.rounding_method`.

Two decimals is right for the euro and for every currency the packs carry. It
is wrong for the yen, which has none, and for the dinar, which has three; and
"half up" was never a decision anywhere, it was what Postgres `round()` happens
to do. A yen invoice of 1 234,5 would have been booked at 1 234,50 and settled
at 1 235, and the half unit that does not exist in that currency would have sat
on a suspense account until somebody went looking for it.

**One pair, one arithmetic, one lookup.** `money_rounding` is the pair that
answers "how is this amount written": the decimals of a currency and the method
of a country. `round_amount(amount, rounding)` is the arithmetic, and the only
place in the schema where a rounding method is named — it switches on all four
the pack format allows, looks nothing up, and is therefore immutable and usable
from a view. `rounding_of(company, currency)` is the lookup, and the only
reader of the two columns; the currency defaults to the company's own, which is
what a ledger line is stated in. A test asks the catalogue for both lists and
fails on a third name in either.

**Nothing is guessed.** A currency the installation does not carry, a company
that does not exist, a country with no model: each is refused by name —
`unknown_currency`, `unknown_company`, `no_country_model`. There is no fallback
currency and no fallback country. What a pack that says nothing about rounding
gets is the column's own default, decided once in the schema by
`20260912091918` and written into the row when the pack was compiled; that was
settled on 13 September and nothing here reopens it.

**A function rounds in as many currencies as it handles.** `post_document`
writes the base and the tax of a document in the document's currency and the
ledger lines in the company's, and it resolves both. So do `post_payment` and
`reconcile`. A document in a currency with three decimals settled from an
account in one with two rounds each side at the decimals that side has, instead
of assuming both have two.

**A local that carries a scale is a second rounding rule.** `v_amount
numeric(16, 2)` rounds on every assignment, silently, at two decimals, whatever
the currency — so the declarations of every rewritten function are plain
`numeric` and the only thing that rounds is `round_amount`. For the same
reason a cast to `numeric(n, 2)` in the body of a reporting function is a
rounding wearing the clothes of a type, and the ones in `assets.register`,
`assets.movements`, `budgets.variance` and `fec_lines` are gone.

**A tolerance is a fraction of a unit, not of a cent.** `0.005` meant "half a
cent" and `0.001` "a tenth of one". In a currency with no decimals they are a
two-hundredth and a thousandth of the smallest coin there is, which is to say
nothing at all. They are written against `currency_unit()` now, which answers
1 for the yen and 0,01 for the euro.

**`document_lines.amount_untaxed` stops being a generated column.** Its
expression was `round(quantity * unit_price * (1 - discount / 100), 2)`, and a
generated column may not look anything up — so it could not ask what currency
the document is in. It becomes a column a `before` trigger writes on every
insert and update. The guarantee that mattered is intact: the total is derived
and can never be keyed in.

**The rule is the same one in four places, and a test proves it.** A format
brick may not import the core, so `roundCurrency` lives in three copies of
`rounding.ts` that are compared byte for byte. `round_amount` is the fourth,
and `tests/currency_rounding.test.ts` runs the same vector — zero, halves,
negatives, three decimals, a currency with none — through the SQL function and
through the TypeScript one and asserts they agree. The vector itself is one
file, so neither test can quietly stop covering a case the other still does.

**The proof is a whole ledger, not a unit test.** A fixture pack — the Belgian
chart, taxes and declaration form, moved to a country code that exists nowhere
and given a currency with no decimals — carries a document through its entry,
a payment, the matching, the VAT return, the trial balance and the close of the
year. Every figure is a whole unit. It is a fixture and not a pack of
`packs/`, because `packs/` is the law of real places and no real place uses it.

**What is not done: the columns still hold two decimals.** Every monetary
column of the schema is `numeric(16, 2)`, so an amount in a currency with three
decimals is rounded correctly by the engine and then rounded again, to two, by
the column it is stored in. Widening them is its own migration and its own
decision: the scale of a `numeric` column is what makes an amount print as
`100.00` rather than `100`, so widening rewrites the text of every amount this
schema returns, and dropping the scale instead leaves the normalisation to
whatever wrote the row. Neither belongs in the same change as the engine. A
test pins the present behaviour so that the gap is visible rather than
discovered, and `currencies.decimal_places` says it in its own comment.

**And the format bricks still round half up only.** `roundCurrency` takes
decimals and not a method, because every pack in this repository declares
`half_up` and a Factur-X or CBSO file is written from amounts the ledger has
already rounded. The first pack to declare `half_even` will have to hand the
method to the bricks as well; the vector test is where that will be noticed.

## The first release is v0.2.0 (14 September 2026)

The repository had a `[0.1.0]` section in its changelog and no tag. That was
the honest state — 0.1.0 was the first schema and nothing outside this
repository had run it, which is the one circumstance in which editing a
published migration costs nothing, and it is what the exception of 11 to 13
September relied on. A tag ends that circumstance, and it ends it for good:
from here a mistake in a published migration is corrected by a new migration,
and CI measures the rule against the latest tag on every push.

**The number is 0.2.0 and not 0.1.1 or 1.0.0.** Everything between the two is
additive — the installer, the MCP server, country packs, capabilities and
machine keys, modules, the audit trail, the generalised tax engine, financial
statements, languages, currency-aware rounding — so a minor is what semantic
versioning asks for. 1.0.0 is a promise about stability that a schema three
days old cannot make.

**The schema floor moves with it.** `ekwo`, `@ekwo-ai/core` and `@ekwo-ai/mcp`
declare `schema_min` 0.2.0, because the packages of this release read
`audit_log`, the rounding functions and `company_packs`, and a 0.1.0 database
has none of them. The floor is a floor and not the version: a later release
that adds nothing a package reads leaves it where it is.

**A release bumps `ekwo_schema_version()` in a migration of its own**, and
nothing else in that file. The column default and `init_instance()` call the
function, so a fresh installation records the new number without a second
edit; an installation that already exists gets it from `ekwo migrate`, which
writes the answer back onto `instance.schema_version`. The two were always
going to drift otherwise, and the number that drifts is the one a client
refuses an old database on.

**The packages are not on npm.** There is no account for the organisation yet,
so `npx ekwo init` is what the CLI will be called and not what it is reachable
as today. The order is deliberate when there is one: tag first, publish after,
so a version on npm is always a version whose source someone can read.
`docs/releasing.md` is the procedure.


## A golden year per country, and what it immediately found (14 September 2026)

The pack format has been able to describe a country since 12 September: a
chart, taxes and where they post, the boxes of a return, financial statements.
What it has never had is a way of being *wrong in a way anyone would notice*.
A tax that posts to the wrong grid and a grid that expects the wrong postings
agree with each other. The seed compiles, `ekwo pack check` is silent, every
unit test passes, and the return is wrong.

**So a pack now carries a year of books and the figures they produce.**
`packs/<cc>/golden/scenario.json` is ten documents at least and the payments
that settle some of them, declarative like the rest of the pack; beside it,
generated and never hand-written, `vat_return.json`, `statements.json` and
`trial_balance.json` — every box, every statement line and every account that
moved, to the cent, in the pack's currency. `UPDATE_GOLDEN=1 npm test --
tests/golden.test.ts` rewrites the three and never the scenario: a runner that
can rewrite its own inputs proves nothing.

**One runner, no country in it.** `tests/golden.test.ts` reads `packs/`,
installs a company on each pack from what that pack's own scenario declares,
and replays it through `post_document`, `post_payment` and `reconcile` before
comparing `vat_return`, `financial_statement` and `trial_balance`. What it
demands of a scenario, it demands of the *pack*: a tax due on collection is
required of a scenario whose pack has one, and of no other. The alternative —
a list of Belgian and French things a scenario must contain — is the country
code in the test file that the whole pack format exists to remove.

**A pack with no golden is refused**, by `readPack` and therefore by `ekwo pack
check` and the CI. A pack that cannot have one says so in its manifest, in a
sentence the commands print: `packs/generic` is the only one here, and the
reason is structural — a framework has no chart, no journal, no tax and no
currency, so no company can be installed on it. An exemption is a claim
somebody made and it is printed, never a silence.

**The expectations are outside the pack's checksum, the scenario is inside
it.** A scenario is a decision about what a country's books look like and
moving it moves the pack. The three expectation files are what the engine made
of that scenario — a build artefact, like the seed and like `docs/schema.md` —
and a checksum that moved because the statements function gained a line would
tell every operator that Belgium had changed.

### What it proves, and what carries the rest

Internal coherence, and nothing else. A box expected wrongly and a posting
written wrongly pass together, and no test reaches past that. Two things
carry the rest and both are now enforced rather than encouraged:
`legal_reference` is **required** on every tax and on every box of a
declaration — `ekwo pack check` refuses a pack that leaves one out, and a
`"TODO"` is not a source — and `certification.status` says out loud how much
anyone has read, which `ekwo init` prints before a company is created.
`.github/CODEOWNERS` names an owner per pack, for the same reason: a rate is
right or wrong against a law, and the person who knows is the person who
applies it.

### Two things the first run found, both in the French pack

Reported and not quietly corrected. A golden that is adjusted until it passes
is a golden that records a bug.

**Line 01 of the CA3 can come out negative.** It is computed as the sum of the
taxable bases — `plus: ["08:base", "09:base", "9B:base", "13:base"]` — so a
quarter whose credit notes exceed its sales reports a negative turnover, which
is not a figure the form accepts. The second quarter of the French golden
shows −1 200,00.

**Line 08 does not tie to itself on an intra-Union acquisition.** The
acquisition posts its base to line 03 and its tax to line 08, so `08:tax` is
not 20 % of `08:base` in any period that carries one: the golden's second
quarter reports 460,00 of tax against −1 200,00 of base. On the paper form,
cadre B line 08 carries every operation taxed at 20 %, acquisitions included,
and cadre A line 01 is only the sales — they are two totals, not one derived
from the other. The pack derives line 01 from line 08, which is right only
while line 08 carries nothing but sales.

The two are the same defect seen from either end, and fixing them is one
decision about what cadre A owes cadre B on the CA3 — a decision for the
French pack and for an accountant reading it, not for the change that made
them visible. They are the argument for the golden, made on the day it
shipped.

## Two install paths, one installation, proved end to end (14 September 2026)

**The README has always said the two routes are interchangeable; nothing
checked it.** `npx ekwo init` runs the CLI's migration runner and its seed
loader; `supabase db push` followed by `psql -f` runs neither — the Supabase
CLI reads the same folder of files, and the operator applies the seeds by
hand. "Interchangeable" is a claim about the state of a database, so
`tests/e2e/install_parity.test.ts` builds one of each and compares them: the
migration history, the columns of every table, the body of every function, and
every row of every table the seeds write, rendered as JSON and sorted. The
second path deliberately imports nothing from `packages/cli` — a test that
drove both through the same runner would prove the runner is deterministic,
which nobody doubted.

**The list of tables is read from the seeds, not written down.** A list
written down is one a new pack section quietly falls out of. Three kinds of
column are left out and each is named: `id` where it is a surrogate key behind
`gen_random_uuid()`, the clock (`created_at`, `updated_at`, `installed_at`),
and a uuid that is a foreign key to another template — for which the dump
refuses to guess and demands a natural key. A migration that adds a reference
between two template tables fails this test until somebody names it, which is
the intended behaviour: comparing two random numbers and calling them equal is
worse than not comparing at all.

**What it found: the README told an operator to apply two seed files of the
four.** `config.toml` lists `00_currencies`, `05_framework_generic` and the two
packs; the by-hand instructions named the currencies and one pack. An
installation made that way came up with a chart of accounts and no generic
financial statements — the fallback for a chart that declares none of its own —
and nothing failed, anywhere, until somebody asked for a balance sheet. The
README is fixed, and a test now reads it: every seed file the installer applies
must be named in it. Beyond that the two paths agreed on every byte.

**The year is played out, not asserted at.** `tests/e2e/lifecycle.test.ts`
starts where a real installation starts — the frozen 1.0.0 seeds, a company
created from them, four releases of schema since — brings it to this release,
upgrades its pack through `ekwo pack upgrade`, and then does the year: the
opening balance, a sale, a purchase, the VAT return, both financial statements,
the close, the re-opening, the close again. It runs once per country the frozen
seeds carry and names none of them: the accounts, the journals, the tax, the
declaration form and the schemes all come out of the pack, and a country that
names no opening journal fails by name rather than silently.

**Every figure is compared to one the test works out itself.** A test that
reads `financial_statement()` and compares it to `financial_statement()` proves
the database is deterministic. `tests/e2e/expected.ts` starts from
`sum(debit) - sum(credit)` — an aggregate no function of this schema takes part
in — and from the pack's own rows, and rebuilds the answer in TypeScript: the
rule engine that puts an account on a line of a scheme, the evaluator the
declaration forms and the statements share, and the boxes a tax posting writes.
It is a reimplementation and not a second opinion, which is worth saying
plainly: it follows the same rules, because the rules are the specification.
What it cannot do is share a bug with the SQL. The rounding is the one
deliberate exception — `roundCurrency` is the TypeScript half of a rule already
pinned against the SQL half — so the two engines agree about rounding and about
nothing else.

**Closing is what makes a balance sheet balance, and the test says so.** Before
the result of the year is appropriated, the accounts that carry forward are out
by exactly that result and every scheme prints the gap; after the close they
net to nil. Both figures are asserted, in both countries, which is how the
end-to-end test would notice a closing style that moved the result to the wrong
side.

**What only a real run proves, and why it is not in the CI.** PGlite is real
Postgres, and four things it is not. It is not the published binary over a
pooler connection. It is not PostgREST — a function that exists and was never
granted to `authenticated` passes every test in this repository and answers
"permission denied" to the first user. It is not GoTrue, so row level security
is judged on a session variable a test set rather than on a JWT a person was
issued. And it is not a hosted project's extensions, roles and defaults.
`scripts/e2e-supabase.mjs` covers those four against a real project, through
`node packages/cli/dist/bin.js`, a GoTrue sign-in and PostgREST, and prints a
pass/fail table. It is run by hand before a release is tagged and never by the
CI: it costs money and it needs a project nobody minds losing.

**It refuses a database that is not empty.** The script installs an instance,
an administrator and a company, books into them and closes a financial year.
Run against books that matter it would be a disaster with a pass/fail table at
the end, so the first thing it does is ask whether `public.instance` holds a
row and stop if it does. It deletes nothing on its own: what is left behind is
the evidence. `--reset` is the exception and exists for one reason — a run that
fails halfway leaves an instance row, so the next one is refused, which is
right and useless while a script is being written. It is deliberately not an
`ekwo` command: an installer that can empty a database is one somebody points
at the wrong connection string.

**What the first real run found, in the order it found it.** All four are
things no test against PGlite could have said.

*`ekwo init` cannot be run unattended on a pack with several charts or several
languages* — it refuses to pick, by name, and says which flag to pass. That is
the right answer and not a defect; it is written down here because every
script that installs Ekwo will meet it.

*Nothing in `supabase/migrations` grants table access to `anon` or
`authenticated`.* On a real project those come from the project's own default
privileges on `public`, and the test harness supplies them from a shim. Drop
and recreate the `public` schema without putting them back — which is what the
first `--reset` did — and the reinstall succeeds, `ekwo doctor` is content, and
the first read through PostgREST answers `permission denied for table
companies`. The reset restores them now. The schema being self-contained on
that point is a decision for another day; what is decided here is that the gap
is visible rather than discovered.

*`ekwo pack upgrade` left the company behind.* It asked for the difference and
returned early when it was empty, saying the company was already at the version
this installation holds — two different claims. A patch release moves the
version and touches no natural key, so the difference is empty and the company
recorded the old version for ever. The early return is gone; `pack_upgrade()`
already did the right thing with an empty difference.

*`ekwo doctor` told the operator to upgrade a CLI that was already current.*
`ekwo migrate` applies the modules' migrations beside the socle's, into the
same history; `status` and `doctor` computed their gap against the socle alone
and read the eight module versions as history they had no file for. One command
after another, on the same database, the two disagreed. All three build the
same set now.

## `ekwo doctor` knows what a release defines (14 September 2026)

The change of 13 September gave the doctor one catalogue check — whether the
audit trail is still append-only — and left the rest for its own change, with
the reason written down: *"an inventory of every table, column and function
this release defines is a generated artefact like `docs/schema.md`, not a list
kept by hand in the CLI"*. This is that change.

**The inventory is generated, committed and shipped.**
`scripts/generate-expected-objects.mjs` applies the migrations under PGlite —
the same way `scripts/generate-schema-doc.mjs` does — and writes
`packages/cli/assets/expected-objects.json`: per schema, the tables and their
columns, the views, the functions with their identity arguments, the policies,
the triggers and the types. `copy-assets.mjs` puts it in `dist/assets` so it
travels with `npx ekwo`, and two CI jobs hold it in place: one regenerates it
and fails on any difference, one diffs the shipped copy against the repository's.
A list typed out by a human is wrong the first time somebody adds a table and
forgets the list, and then it lies in both directions at once.

**Everything sorts on a key, and `oid` is never one.** A name, or a name and a
signature; columns by name rather than by `attnum`. `oid` is an allocation
order, not an order anybody chose, so it belongs nowhere except as a tiebreaker
between two objects that a human would call the same name — which is exactly
what `docs/schema.md` needed and did not have: its function table was ordered
by `proname` alone, and the two `resolve_line_account` overloads sat in
whatever order the rows came off the heap. It now orders by `proname, oid` and
the two overloads swapped places once, for good. The inventory does not use
that tiebreaker at all: it keys a function on its name **and** its identity
arguments, which is what makes an overload a different function in the first
place, so it needs no tiebreaker and cannot be moved by one.

**Missing, extra and a policy are three different answers.** Something missing
means the installation is behind or has been damaged, and that is a problem.
Something extra means an operator added their own table or their own function,
which is their business and is reported as information — a doctor that failed
on it would be a doctor telling people not to use their own database. A
**policy** is the exception in both directions: row level security is the whole
security model here, so a policy that is gone closes a table to everyone and a
policy that was added is a grant nobody reviewed. Both are problems. A column
whose type has moved is a problem too, and is reported as changed rather than
as missing, because "missing" would send the operator looking for a migration
that did land.

**The exit code says one thing.** `0` when nothing is a problem, information and
warnings included; `1` on the first problem. That is what makes `ekwo doctor`
usable as a deployment gate, and what keeps an operator's extra table from
turning a pipeline red.

**A module is required of a database that carries it, and of no other.** The
inventory holds a section per module, and the comparison asks `public.modules`
what this installation actually holds. A module whose migrations never ran is
named and skipped rather than reported as two hundred missing objects. Whether
a *company* has enabled the module is a different question with a different
table, and it changes nothing about what the schema must contain.

**A database older than the CLI is compared anyway.** The report names the
version the inventory describes and the version the database reports, and then
lists what differs. Gating on the version would refuse precisely the
installation somebody runs the doctor on.

**What is left out.** Constraints, indexes, grants and function bodies. A
dropped unique index is real damage and this will not see it; the inventory
answers "is it there and is it still that shape", and the three of them are
each an order of magnitude more text for a diff that would move on every
Postgres upgrade. `docs/schema.md` carries the constraints for a human reader
today, and an inventory that nobody reads the diff of is worth nothing.

Grants came back the same day: the entry below gave the schema its own
privileges, which made them a thing the migrations state rather than a thing
the project happens to hold — and a statement is exactly what an inventory can
check. They are a `grants` section of this file and a `grants` check of the
doctor, kept apart from the categories above because missing, extra and
changed do not mean the same thing about a privilege.


## The country pack is finished as a taxonomy, and is written down (14 September 2026)

Phase 0 set out to make a country describable in data rather than in code, and
it is done. This entry closes the chapter: what the format ended up carrying,
what was deliberately left out of it, and what the documentation now promises.

**What a pack turned out to need.** The first sketch was a chart of accounts,
taxes and their postings. It shipped as eleven things, and the six that were
not in the sketch are the six that would each have become a country-shaped hole
in the core: the boxes of a declaration and their totals; financial statements
and a country-less framework behind any chart that prescribes none; several
charts per country, because an association and a company file the same return
on different accounts; what the country puts on a document — numbering, the
payment term, the tax point, the e-invoicing profile, the bank formats, and the
sentences the law requires with a closed vocabulary of conditions; the labels of
all of it in every language the pack declares; and a year of books with the
figures it produces. Each was found the same way: by trying to write the second
country and noticing what still lived in a function.

**The taxonomy is the part that will not be redone**, and it is three rules, all
of which held. A pack is data and cannot execute: no expression language, no
hook, no field through which a country could run anything, so a formula is a
list to add and a list to subtract and a condition is a value out of a closed
list. Nothing in the core carries a country, a currency or a language of its
own, and nothing falls back on one: a reader that needs a value a pack did not
give names the value, and a default closing style would have been one country's
mechanism handed to every country that had not spoken. And nothing is ever
deleted from a pack — an account is deprecated, a tax gets a `valid_to`, a form
version gets a new `valid_from` — because the return of a past period has to
keep giving the same answer for as long as anyone can be asked about it.

**What was deliberately left out, and why it is not a gap.** The rates of
American sales tax: tens of thousands of jurisdictions changing monthly is a
feed, not data somebody reviews, and the form belongs in a pack while the rates
do not. Canadian rates *are* in a pack, because fifteen stable combinations
published by one administration is data. Revaluation of open items, cash
accounting as a ledger, several taxes stacked on one line, the gross-to-net
computation of a tax-inclusive price, and the cash-flow statement: each is
declared or accepted by the format and implemented by nobody, waiting for the
country that needs it rather than being guessed at from Belgium. Analytics,
fixed-asset regimes beyond what a module carries, payroll, inventory, and the
translation of the application itself, which is a different problem from the
translation of a chart of accounts.

**Certification stayed honest, which cost a status.** There is no value meaning
"certified by Ekwo", and the one that existed was deprecated and migrated away.
Writing a pack and testing that it holds together is not reviewing it. So the
scale is `community`, `maintained`, `reviewed`; `reviewed` names a person and a
date and nothing else counts; `legal_reference` is a required field on every tax
and every box so that a reviewer has something to read against; and
`.github/CODEOWNERS` puts a name next to each pack, which is who is asked and
not who has signed.

**The documentation is a deliverable of the phase and not a write-up of it.**
[`packs.md`](packs.md) is the format file by file, the compiler and what it
writes, every rule `ekwo pack check` applies grouped by what it guards, the
certification policy, and a ten-step walkthrough for adding a country in a day.
The reason for the list of refusals is narrow: a contributor meets those rules
one error message at a time, and a rule they cannot find written down reads as
the tool being arbitrary.

**And four things an installation cannot do for its operator are now printed
rather than assumed.** Disabling self sign-up, keeping a second administrator,
keeping the `service_role` key off machines that do not need it, and reading
[`DISCLAIMER.md`](../DISCLAIMER.md) before filing anything. Three of the four
are settings of a Supabase project rather than rows in a database, so no
connection string reaches them and `ekwo doctor` cannot check them. They are
printed at the end of a successful `ekwo init`, where the person still has the
dashboard open, and written in the installation guide in the same words — with
a test reading both, because a checklist kept in two places drifts. Checking
them automatically would mean handing the CLI a Supabase management token, and
a token that can read a project's settings can change them; that is a phase 1
trade and it is not obviously worth making. None of it is ever an action Ekwo
takes on somebody else's project.

**Three things the installation guide was not saying**, all of which a script
meets before it meets anything else. `ekwo init` refuses to pick a country, a
chart of accounts or a language when there is nobody to ask, and names the flag
— which is the right behaviour and was written down as a finding rather than as
documentation. Table access for `anon` and `authenticated` is not in
`supabase/migrations`: it comes from a Supabase project's own default
privileges on `public`, so dropping and recreating that schema without putting
them back leaves an installation the doctor calls healthy and PostgREST answers
`permission denied for table companies` on. It is recorded as a known gap, not
as a promise; whether the migrations should be self-contained on that point is
still a decision for another day. And the catalogue check now says what it does
not cover, because a check whose boundaries are unwritten is read as covering
everything.


## The schema grants its own rights (14 September 2026)

Answering the question the two entries above both leave open, in the same
words: *whether the migrations should be self-contained on that point is still
a decision for another day*. This is that day.

**What was borrowed.** A Supabase project carries default privileges on
`public` — `grant all on tables`, `on sequences`, `on functions`, to
`postgres`, `anon`, `authenticated` and `service_role` — so every table a
migration created came out readable and writable by the three API roles
without a single `grant` in `supabase/migrations`. The arrangement worked and
was wrong twice over.

It was a hole. Those defaults give `anon` — the role behind the publishable
key that any visitor holds — INSERT, UPDATE and DELETE on every table of the
ledger, with row level security as the only thing in the way. That is one
layer where the rest of this project has two, and it sat under a doctrine
which says, in the entry above about the anonymous role, that a surface should
be closed rather than merely empty.

And it was a dependency nobody had written down. The defaults live in
`pg_default_acl`, keyed by the schema; drop `public` and they go with it. The
reinstall then succeeds, `ekwo doctor` reports a healthy database, and the
first read through PostgREST answers `permission denied for table companies`.

**Migration `20260914151207` declares them instead**, by name, table by table
and view by view, with two module migrations doing the same for `assets` and
`budgets`. The rule it writes down is that the grant and the policy are two
halves of one sentence: `authenticated` may attempt exactly the verbs the
policies of that table are prepared to judge. Twenty-six tables carry a policy
`for all` and get the four; twenty-four have a select policy and get SELECT
alone — the reference tables a pack installs, the five written only by a
`security definer` function, and `audit_log`. `anon` holds nothing on any
table, view or sequence anywhere, and keeps the ten policy helpers it already
had. `service_role` gets what a person gets and no more: it bypasses row level
security, so its grants are the only limit it has.

**DELETE is granted where deleting is bookkeeping.** On `entries`,
`entry_lines`, `documents` and `payments`, deleting a draft is an ordinary act
and deleting a posted one is refused by the period lock and by
`entries_guard_period`. Withholding the privilege would break the first and
change nothing about the second. On `audit_log` it is withheld, and so is
UPDATE and INSERT: the trigger already refuses them for every role including
the owner, and the missing privilege is the statement of intent beside the
guarantee.

**No wildcard grant, and no `alter default privileges` as the mechanism.**
`grant all on all tables` is how a table added next year becomes writable by a
role nobody thought about, and a default privilege is the same thing one level
down — which is the mechanism being removed, so it cannot also be the fix. The
convention from here: **a migration that creates a table, a view or a function
grants it in the same file**, beside the `revoke execute … from public` that
was already compulsory. Ekwo's own default privilege that granted EXECUTE on
future functions to `authenticated` is revoked too; functions created before
keep what they hold, and a function created after is granted in its own
migration or is reachable by nobody.

**What enforces it, because a convention nobody checks is a comment.**
The `grants` section of `packages/cli/assets/expected-objects.json` — the
inventory that already carries the objects a release defines, because a
privilege and the object it sits on ship in the same migration — is generated
from a freshly migrated database by `scripts/generate-expected-objects.mjs`
and committed; the
CI regenerates it and refuses a diff, so a migration that forgets its grants
moves a file and is caught before it is merged. `tests/grants.test.ts`
compares the catalogue to it and asserts the doctrine separately — `anon`
reaches no table, a grant says what the policies say, a trigger body is
callable by nobody. `ekwo doctor` asks a live database the same question: a
missing grant is a problem, an extra grant to `anon` is a problem, an extra
grant to `authenticated` is a warning, and a default privilege still standing
is a warning.

**The test harness stopped helping.** `tests/helpers/supabase-shim.sql` ended
with those default privileges and `freshDatabase` with a `grant … on all
tables in schema public`, which between them made every test in the repository
pass against privileges no installation was guaranteed to have. Both are gone.
Every test file is now also a test of the grants, and `tests/grants.test.ts`
goes further: it builds a database where the three roles begin with nothing at
all and no default privilege exists, replays the migrations, and books a whole
country pack's golden year through it as `authenticated`. The last test of
that file takes one grant away and shows the year stops, because a scenario
that would pass whatever the grants are proves nothing about them.

**Two things it found, neither of which any test could have said before.**

*`anon` could read every table of the `assets` and `budgets` modules.* Their
opening migrations carried `grant select on all tables in schema … to anon` —
the only place in the whole schema where the anonymous role held a privilege
on a table. Row level security answered every such read with an empty set, so
nothing leaked; the surface is closed now.

*`ekwo pack upgrade` could not have worked through PostgREST.* `pack_upgrade()`
records its own line in the audit trail rather than leaving it to a trigger,
and it was `security invoker`, so the call to `audit_record()` was made as the
caller — who has not been able to execute it since `20260914103412` closed it.
Nothing noticed because the harness granted EXECUTE on every function back.
On a real project the writes would have committed and the trail would not.
`20260914152840` makes the function `security definer`, like `enable_module()`
and `invite_member()` and for the same reason: it already refuses a caller
without `company.write` on the company it was given, by name, before it
touches anything.

**What is deliberately not decided here.** Which companies a role may see —
that is row level security, and not one policy of this schema changed. A grant
says which verbs may be attempted; a policy says on which rows they succeed.
This settles the half that was being borrowed.

## Luxembourg is a pack, and it is `community` (14 September 2026)

The third country, and the first written from published sources alone rather
than from books somebody was already keeping. Three decisions in it are worth
recording, because each of them is the kind a later pack will meet again.

**The whole chart, at the depth the law prescribes.** The *plan comptable
normalisé* runs to 1 026 accounts, 747 of them postable, where Belgium ships 353
and France 394. The temptation was to ship a working subset, and it was refused:
Luxembourg publishes no abridged chart — what it abridges for a small company is
the *presentation*, not the chart — so a subset would have been this
repository's opinion of which accounts matter, sitting in a file that claims to
be the regulation. What the pack ships is a transcription, and a company that
needs an account it does not use simply has it.

**The mapping to the financial statements is the State's own, account by
account.** The same annex carries the chart and the *tableau de passage* — which
line of the abridged balance sheet or profit and loss account each account
reports in — so all 747 postable accounts reach exactly one line by an
`account_code` rule naming the code. Compressing that into ranges would have
been about a third as many rules and would have been an inference: a range says
"everything between these two codes", which is true of the chart as it stands
today and is not what the regulation says. A reviewer checking one account finds
one line.

**`community`, and the pack says what a reviewer should read first.** Belgium
and France are `maintained` because the maintainers keep them current and use
them. Nobody here files a Luxembourg return, so the honest status is the one
that means *contributed, not read by an accountant* — and the pack's README ends
on ten points where the text allows more than one answer, from whether article
63 requires a gapless number to whether the domestic reverse charge is worth
offering at all. A list of known soft spots is worth more to a reviewer than a
status that overstates the work.

What the pack could not say, and what would fix it, is in
[`international.md`](international.md) under the countries: a company records no
declaration periodicity, a form's `period` cannot name three cadences, the
`sequence` of a declaration box means print order and evaluation order at once,
and a computed statement line may carry a sign that is applied twice. None of
the four was patched into the core for Luxembourg's sake. That is the whole
point of a pack being data — and three of the four were closed on their own
merits on 14 September 2026, for every country, in the last two entries of
this file.

## Estonia was written to test the format, not to open a market (14 September 2026)

The plan put the United Kingdom and Canada first. Estonia went ahead of both,
alongside Luxembourg, and the reason is what the pack format was for.

**A country nobody designed the format for is the only thing that proves a
format is a format.** Belgium and France were extracted from a core that had
been built around them, so everything they needed was there by construction. A
pack written from the outside in — by somebody reading a foreign statute, with
no permission to change the core — is the honest test of the claim that a
country is data. Estonia was picked because it is small enough to finish and
awkward enough to be interesting: a standard rate that moved twice in eighteen
months, a return whose boxes nest three deep, a reduced rate that went 9 %, 5 %
and 9 % again, and **no legal chart of accounts at all**, which is the case the
format had never met.

**The rule held, and the pack is entirely data.** No migration, no function, no
column, and no change to `tests/golden.test.ts`, which installed a company on
the new pack and replayed fourteen documents without knowing that Estonia
exists. Six things the core cannot say turned up, and all six are written in
[`international.md`](international.md) with a fix and with the workaround the
pack uses instead — because a gap fixed quietly during a pack is a gap the next
contributor meets again.

**The one place where the format bent is worth naming.** A tax carries one
`base` posting per kind of document, so it reports to one box; form KMD asks
for the same amount in a box, in the memo box inside it, and sometimes in a
third. The pack posts to the innermost box and rebuilds the printed parents as
totals, which needs six boxes the form does not print. That is exact and it is
not obvious, so it is documented in the pack's own README rather than left for
somebody to find in a diff. The alternative — filling the parent and leaving
the memo boxes empty — would have produced a return the tax authority
cross-checks and rejects, and would have looked fine in every test.

**Estonia is `community`, and stays there.** Nobody has read it against the law
they apply. Writing a pack carefully, citing an article on every rate and every
box, and proving that fourteen documents produce the figures somebody wrote
down is exactly what `community` means: contributed, not reviewed. The status
moves when an Estonian accountant puts their name in the manifest, and not
before.

## A test may book in a country. It may not expect one.

*14 September 2026*

The suite named `BE`, `FR` and `LU` by hand in eleven files: six loops over a
literal pair of slugs, and tables of rows keyed by country — the statements and
their line counts, the declaration forms and their box counts, the exchange
accounts, the charts, the closing parameters, the fixed-asset rules. Luxembourg
landed a week earlier and most of those tables had to be edited for it to be
seen at all. Which is the argument: **until a test walks the packs, a new pack
proves nothing, because nothing looks at it.**

The line drawn is between the two halves of a test. **Setting up may name a
country** — a scenario books invoices somewhere, with some chart and some tax
code, and saying which is how it stays readable; a new pack never has to touch
that line. **Expecting may not** — what a test asserts about the core comes
from the pack, or it is an assertion about the countries somebody remembered.

Three things follow.

**`tests/helpers/packs.ts` reads every pack once.** `allPacks` to loop,
`packWhere('taxes on collection', …)` to pick by the property under test rather
than by the country that happens to have it, `somePack` where any pack will do.
`packWhere` throws when no pack carries the property, naming it: a loop that
silently checked nothing is the failure being prevented, not a lesser one.

**A claim only one pack can make lives with that pack.** A fact key of a
national filing taxonomy is written in `statements.json`, so a test comparing
the two would compare a file to itself — and a generic test cannot check it
either. It goes to `packs/<cc>/golden/expectations.json`, beside the golden and
outside the pack checksum, loaded by one runner. A contributor states a claim by
editing their own pack. The alternative, a `tests/packs/<cc>.ts` per country,
was refused for exactly the reason the whole change exists: it would have put a
file under `tests/` back on the path of adding a pack.

**A grep guard in the CI**, because the pull request that reintroduces one
literal is the one nobody notices. It fails on a country code inside an
`expect(…)`, on a list of two or more country codes, and on a pack named by hand
where `listPacks()` would have found it. One comment, with a reason, is the way
out.

What is deliberately left: `tests/closing.test.ts` still books its scenarios in
a named country, because the amounts it asserts carry that country's VAT rate.
Deriving those from the pack's own taxes is a change to the fixtures, not to an
enumeration, and it is worth doing separately.

## The chart stays whole and the list gets short (14 September 2026)

A country pack transcribes the regulation: Estonia ships 120 accounts, Belgium
353, France 394, Luxembourg 1 026. That was decided on purpose — an abridged
chart would be this repository's opinion of which accounts matter, sitting in a
file that claims to be the law — and nothing here takes it back. What it costs
is a different thing: somebody looking for the account a purchase invoice goes
on is handed three hundred rows, and an assistant reading the chart through the
MCP server is handed the same three hundred rows before every question.

Two production installations were measured on a full year of books. One used
**60 accounts out of roughly 300**; the other **126 out of roughly 300**. Both
are ordinary companies of the same country, and neither would have been served
by a smaller pack — they use a different sixty.

**So the chart is not narrowed; a second question is added beside it.**
`accounts_in_use(company, from, to)` answers "which of these accounts is this
company working with", and the answer is read from what the company already
holds rather than kept in a list somebody has to maintain:

- **moved** — the account carries a line of a posted entry. With a period, a
  line dated inside it; without one, ever.
- **referenced** — the configuration of the company names the account by
  foreign key: a role default, a contact override, a journal, a tax posting,
  the transition account of a cash-basis tax, a bank account, a product. A
  configuration reference is not dated, and only the movement is. An account a
  product posts to is in use before anything is booked on it, and stays in use
  in a quarter nothing was booked in.
- **a module** — a module the company has enabled holds it.
- **pinned** — somebody said so.

minus `deprecated`, which is already how a chart retires an account.

**Two alternatives were considered and refused.** A *core plus creation on
demand* — ship thirty accounts and add one when it is needed — would have made
the pack a subset again, and the account somebody needs is exactly the one they
cannot name. *Subsets by activity inside the pack* — a retail set, a services
set — would have put a classification of businesses into a file that is
supposed to hold a chart of accounts, and it would have to be maintained per
country by whoever maintains the pack. Both replace a fact with an opinion. The
fact is in the database already.

**`accounts.pinned` is the column an operator edits**, and
`install_country_template()` pins what it wires: the roles of the country
model, the accounts its financial journals post to, the accounts its taxes book
on, the transition account of a cash-basis tax. That is **eleven accounts on
Belgium, eleven on Estonia, fifteen on France, eleven on Luxembourg** — fewer
than the thirty the first sketch assumed, because the roles and the tax
postings overlap heavily and a country model names about a dozen accounts, not
thirty. It names about a dozen whatever the size of the chart: Estonia's
hundred and twenty accounts and Luxembourg's thousand wire the same eleven.
The union above would have found most of them anyway; what pinning adds is that
the set is written down, so a company that later points a role at a different
account keeps the first one in the list it has been reading for a year.

**Pinning restricts nothing.** A document line takes any account of the chart
that is not deprecated, exactly as before, and every write tool still accepts
one. This is a reading, and the only thing it changes is what is offered first.
A tool that narrowed what may be booked on would be a tool that makes a wrong
entry by being helpful.

**The socle still ignores its modules.** `accounts_in_use()` does not name
`assets` or `budgets`. It asks each module the company has enabled for
`<schema>.accounts_in_use(uuid)` — the convention `disable_module()` already
reads for `<schema>.can_disable(uuid)` — and `to_regprocedure` answers null for
a module that references no account. The dependency keeps pointing one way: a
module reads the socle, the socle asks its modules a question they may decline
to answer.

**What the working chart does not include**, and the reason in each case. The
accounts a pack names for opening and closing — the result of the year, the
accumulated loss — are resolved by `close_fiscal_year()` from the pack at the
moment it runs and are never written onto the company, so nothing points at
them until the first year is closed, and then the movement does. The parent of
a used account is left out: a heading is not an account anybody books on, and
including headings would put the whole hierarchy back. A line of a *draft*
document is left out too, because it would make the period argument useless —
an account named on an undated draft would be in use in every quarter.

`list_accounts` answers with this set, and says in its output which scope it
used, so a model that finds nothing knows there is a wider question to ask.
`include_all` gives the whole chart, `include_deprecated` gives it with the
retired accounts, and `ekwo://companies/{id}/chart` was already the resource
that carries everything.

## A code is frozen by the first line booked on it (14 September 2026)

Every reference to an account inside a company is a foreign key on
`accounts(id)`: the roles of the company, the overrides of a contact, the
journals, the tax postings, the lines of every document and of the ledger, and
the tables of the modules. That was checked, and it held. So renaming an
account breaks nothing, and renumbering one appears to break nothing either —
the keys follow.

**The rules do not follow the key.** A financial statement maps an account to a
line by its code: `statement_line_rules` carries `account_code` rules, and on
the Belgian chart a rubric code *is* a range of codes. A declaration box is
reached through a tax posting whose account the pack named by code.
`account_id_by_code()` is how half the schema finds an account at all. Moving
`700000` to `701000` therefore moves the account to a different line of the
balance sheet or the profit and loss account, and the year already booked on it
moves with it — silently, and in a statement somebody has filed.

`accounts_write` could not have stopped it: a policy judges which rows a caller
may touch and has nothing to say about which column changes. So there is a
trigger, and it raises by name.

- `account_code_frozen` — the code may not change once the account carries a
  line of the ledger, is named by a tax posting, or plays one of the company's
  roles.
- `account_type_frozen` — neither may the type, for the same reason. The
  eighteen types are what put an account on one side of the balance sheet or in
  the income statement, and `internal_group` and `carries_forward` are
  generated from it.

Everything else stays editable at any moment: the label, the translations, the
notes, the parent, `reconcilable`, `deprecated`, `pinned`. Renaming an account
is ordinary work — it is the first thing an operator does to a chart they have
just installed — and `pack_upgrade` does it too when a pack changes a label.

**Deprecating is the way out, and it always was.** An account that was given the
wrong code is deprecated and a new one takes the entries from here on, which is
the same rule that says nothing is ever deleted from a pack: the statements of a
past period have to keep giving the same answer.

One consequence is deliberate. `pack_upgrade(…, apply => true)` now fails by
name rather than moving a used account between statements. That difference was
already classified `review` — the rule that exists precisely because there is no
way to be sure from here which of the two is right — and a refusal is the honest
end of that sentence.

## A sign belongs to a line summed from the ledger (14 September 2026)

A statement line carries `sign: -1` when the scheme prints a credit balance as
a positive figure, and `financial_statement()` applies it when it sums that
line from the ledger. A total is worked out afterwards, from lines that already
read the way the scheme prints them — and the evaluator multiplied the total by
the total's own sign as well. So a scheme that flips a credit line and flips
the subtotal above it got the figure back the way it started, silently. It cost
the Luxembourg pack a wrong set of golden figures, caught by somebody reading
them rather than by any check.

**`ekwo pack check` refuses `sign` on a line with `plus` or `minus`**, next to
the rule that already refuses a line that is both summed and computed. The
explicit `1` is refused too: it changes no figure, and a pack that writes it is
saying something about a total that a total cannot say — the moment to tell its
author is while they are writing the pack, not when a reviewer is checking the
figures.

**The evaluator is not changed, and the option to change it is not left open
either.** "Apply the sign once" has no meaning while every line under the total
carries its own: there is no second application to remove, only a first one on
figures that were already read correctly. The day a country wants a total
presented against the direction of its components, the honest shape is a line
of its own — a total is what the lines add up to, not a place to reverse them —
and `minus` is what expresses the subtraction meanwhile. No pack combined the
two, so the refusal moved no golden figure.

## How often a company files is data, and the return reads it (14 September 2026)

`vat_return()` takes two dates, which is right: a return is a period and the
caller knows which one. What nothing held was how often the company files at
all. Luxembourg sets the cadence by turnover — annual up to 112 000 euros,
quarterly to 620 000, monthly above — and Belgium and France each have a
principal cadence and a threshold below which another is allowed. A quarterly
filer could be handed a July return and nothing anywhere said so.

**Three pieces, each in the place that owns the answer.**
`tax_report_templates.periods` is what the *form* accepts, a list because one
set of boxes may be filed on more than one cadence. `companies.vat_period` is
what *this company* files. `country_defaults.vat_period_default` is what the
*pack* proposes. Splitting it that way is what keeps `vat_return()` free of a
country: the form says what is possible, the company says what is true, and
neither is a constant in a function.

**One vocabulary, not two.** `month`, `quarter`, `year` — an enum now, where
they were three spellings agreed by convention in a check constraint. A second
set of words for the same three facts (`monthly`, `quarterly`) would have been
the same fact written twice, which is the one thing this schema will not do.
`month_or_quarter` was never a cadence anybody files on; it was two of them
pretending to be one, and there was no `month_or_quarter_or_year` to invent
next. It is read as the two it names, so a pack written before the list keeps
working.

**The column default is the part that had to go.** `period` defaulted to
`month_or_quarter`, so a pack that had never considered its cadence filed on
Belgium's and France's, silently, in a column a reader would take for data.
There is no default now, and a form that names none is refused by name.

**A pack proposes a cadence only where the law gives one answer that does not
depend on a fact about the company.** One of the four does. Estonia's taxable
period is the calendar month for everybody, with no option and no threshold
(käibemaksuseadus § 27 lõige 1), so `packs/ee` proposes `month` and a company
installed there never sees the question.
Belgium's law makes the monthly return the rule (Code de la TVA, art. 53, §1er,
alinéa 1er, 2°) and allows the quarterly one below turnover thresholds (AR n. 1,
art. 18, §2); France's is the same shape (CGI, art. 287, 2 — monthly, quarterly
admitted under 4 000 euros of annual tax); Luxembourg's three cadences follow
turnover outright. In those three, which one applies is a fact about the
company and not about the country, so `vat_period_default` is null and each
pack cites the article on its form instead. This is the same argument the language
question settled: offering one of several lawful answers as the one to press
Enter on is how the other one ends up installed. A wrong cadence is a missed
deadline.

**What the return does with it, and what it deliberately does not.** It refuses
a period the company does not file on, and only when the refusal is certain:
the company has recorded a cadence, the form offers that cadence, the dates
asked for are themselves a whole cadence of that form, and the two differ.
Everything else goes through — a fortnight, a half-year, the annual
recapitulative form a quarterly filer also files. `vat_return()` is a control
query as often as it is a filing, and a guard that refused an analysis would be
a guard people work around.

## A document is shared by a link, and the link is the whole secret (15 September 2026)

A customer who receives an invoice wants to look at it, and everything that
would let them is behind row level security: they are not a member of the
company and never will be. The two usual answers are both bad. An account for
somebody who will read one invoice is a login nobody maintains and a password
nobody remembers. A PDF attached to an e-mail is a copy that stops being true
the day the invoice is paid.

**A share is a row and a function.** `document_shares` says that one document
may be read by whoever presents one secret; `shared_document(token)` takes the
secret and returns the document as it was sent, with what is still owed on it
today. The application draws the page; the core answers the question.

**The token is hashed, and 256 bits wide.** Only `sha256(token)` is stored, so
a backup, a replica or a support engineer reading the table hands nobody a live
link — the arrangement `company_invitations` and `api_keys` were already built
on. The width is the answer to "could somebody guess one": at 244 bits of
randomness inside 32 bytes, no. The 244 rather than 256 is where the bytes come
from, and that is the second decision.

**The bytes are two `gen_random_uuid()`, not `gen_random_bytes(32)`.** The
latter is `pgcrypto`, and `pgcrypto` is not available under PGlite, which is
what the whole of `tests/` runs on. An invariant that cannot be tested is an
invariant nobody is keeping, and a token generator that only works on a hosted
project is exactly the kind of difference between "it works here" and "it works
where you run it" this project refuses. `gen_random_uuid()` is core Postgres
and is where every primary key in this schema already comes from; a v4 UUID
fixes six bits for its version and its variant, so two of them are 244 random
bits rendered into 43 base64url characters. `sha256()` is core too, since
PostgreSQL 11.

**`anon` gets one function and not one table.** The doctrine of `20260911210131`
and `20260914151207` is that the anonymous role holds no privilege on any table
or view and reaches only functions that answer about the caller.
`shared_document` is the first function it reaches that is not a policy helper,
and the invariant is kept rather than bent: it is `security definer`, the
visitor has no rights of their own, and what comes out is one document rendered
into one jsonb. There is no view to select from, no filter to widen and no
second row to reach. `tests/hardening.test.ts` and `tests/grants.test.ts` both
assert the list by name, so an eleventh entry is a decision somebody argued for.

**Unknown, withdrawn, expired and no-longer-shareable are the same null.** Four
different refusals would be an oracle: somebody feeding tokens at the function
would learn which of their guesses had been a real link. The function takes the
token and nothing else, so it is an oracle for nothing at all.

**No IP address and no user agent.** `view_count` and `last_viewed_at` answer
the question a sender actually has — did they open it. A log of the people a
company invoices, with where they were when they read the invoice, is personal
data with a retention policy, a lawful basis and a subject-access request
behind it, and the core does not collect what it is not prepared to answer for.
An application that is prepared to keeps its own.

**There is no access code, and the door is left open for one.** A second factor
— a code read out over the phone, the customer's own VAT number, a one-time
password by e-mail — is a useful option and a bad floor: it turns every link
into a conversation, and most invoices go to somebody who is expected to open
them. The day it is wanted it is a column on `document_shares` and a second
argument to `shared_document`, which is why neither is shaped to prevent it.

**Sales only.** A purchase invoice is a third party's own document: their
prices, their bank details, their legal mentions. Publishing it under a link
this company controls would be publishing somebody else's data, and there is no
request behind it — nobody shares a supplier's invoice with the supplier.
`share_not_a_sale` says so by name.

**A share is not edited.** No update policy and no `change_share()`. An expiry
that can move is a lifetime nobody can rely on, and a token that outlives the
decision to withdraw it is the one failure this feature must not have. Revoke
it and make another; there is no un-withdraw, for the reason there is none on a
machine key.

**`subject_kind` exists with one value in it.** A statement of account, an
ageing balance, a financial statement sent to a customer are the same act with
another subject, and the shape that survives the second one is decided now or
paid for later. `document_id` is nullable and tied to the kind by a check, so
the kind that arrives next adds its own column and its own branch of the same
check, and every row written before it keeps meaning what it meant.

**The list of links is row level security, not a function.** `list_shares()`
would have been a fourth function producing a list that a `select` on
`document_shares` already produces correctly, under a policy this schema
already has to write. Two places where the same rule is decided is the one
thing this schema will not do.

**`instance.public_base_url` is nullable and has no default.** A link has to be
absolute, and a self-hosted installation answers at the address its operator
chose. A core that guessed would hand out links to somebody else's host, and no
URL of Ekwo's is written anywhere. Where it is empty, `share_document` returns
the token with a null `url` and the caller builds the link — which is the same
answer `no_currency_default` and the filing cadence give: a value nobody has
stated is null and said to be null, never one country's answer given to
everyone.

## The sources of a pack are a register, not a bibliography (15 September 2026)

`legal_reference` has been required on every tax and every box since the format
existed, and it is half an answer. *Arrêté royal n° 20 du 20 juillet 1970,
tableau A* tells a reviewer what is being claimed and leaves them a search
engine to find out whether it is true. `certification.sources` was the other
half and was not: a list of bare titles, in a manifest, with no link on any of
them.

**A register, and a key on the rule.** Each text is declared once — a key, a
title, the official publisher, an absolute `https` URL and the day somebody
opened it — and every rule names the key of the text its own article is in. The
alternative was a URL on each rule, which would have put the same link on
thirty-one Belgian boxes and made a publisher's site reorganisation a sweep
across four files. The article is the claim and belongs where the claim is; the
link is where a text lives and changes on the publisher's schedule, not on the
pack's.

**The publisher is a field, not part of the title.** A link says where
something is served and not who stands behind it, and those come apart exactly
when it matters: a mirror, a commentary, a law firm's copy of a statute all
resolve. A reviewer checks the publisher first, so the pack says it in a column
rather than hoping the hostname does.

**Six kinds, closed.** `law`, `regulation`, `form`, `standard`, `portal`,
`guidance`. A register that is readable across countries is worth more than one
that lets each pack invent its own words for the same six things, and the split
that earns its keep is `law` against `form`: the rate comes from a statute and
the box comes from a form, and in three of the four packs here they are
different documents published by different administrations.

**A portal is in the register although it is not a legal source.** Whoever
installs a pack needs to know where the return is filed, and the register is
the one place in a pack where they will look for it. It is also the thing a new
contributor is least likely to write down and most likely to need.

**Nothing is copied.** No pack holds a sentence of the law it transcribes. A
quotation ages without anybody noticing and would make a country pack a second,
unversioned edition of a statute — which is the failure mode this repository
avoids everywhere else by deriving rather than restating.

**The register is what a reviewed pack is refused for leaving out.** A
professional who reads a pack against the law reads something, and a status
that let them leave that unsaid would be a signature rather than a review. So
`reviewed` requires a source on every tax and every box; `maintained` warns,
because the register arrived after four packs did and a missing link is a link
that is missing, never a figure that is wrong; `community` asks nothing, which
is what `community` means.

**Following the links is not a check.** `ekwo pack check --links` exists and
the CI will never run it. Légifrance answers `403` to anything without a
browser behind it — all four of its entries here do — Riigi Teataja serves the
same page for a text and for a typo, and a ministry moves a form the week
before a deadline. A gate on any of that fails a contributor's pull request for
something nobody in it did, and the cheapest way to make it green is to delete
the link, which is the opposite of what the register is for. It reports a
reading. A maintainer decides.
