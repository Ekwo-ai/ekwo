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
