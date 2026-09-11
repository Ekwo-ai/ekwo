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
`quantity x unit_price x (1 - discount / 100)`, rounded to two decimals, once.
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
closing entry itself comes next.

**No multi-currency revaluation.** `currencies`, `currency_rates`,
`amount_currency` and `documents.exchange_rate` are in place; the periodic
revaluation of open items in foreign currency is not.
