# @ekwo-ai/mcp

The [Model Context Protocol](https://modelcontextprotocol.io) server for
[Ekwo OS](https://github.com/Ekwo-ai/ekwo-os). It lets an AI assistant keep the
books in your own Postgres: read the ledger, raise an invoice, post it, match
a payment, pull the VAT return or the French FEC — **as you**, under the row
level security of your own installation.

```sh
npx @ekwo-ai/mcp
```

It speaks MCP over stdio and is started by a client, never by hand.

## What it is, and what it is not

The server holds no privileges of its own. It signs in as the person using it,
or is handed their access token, and everything it can do afterwards is
exactly what that person can do: a viewer reads and cannot write, a member of
one company cannot see another, a locked period refuses a posting. None of
that is checked in this package — the policies and the triggers in the schema
decide, and this server reports what they answered.

Three things it will never do:

- **Write a ledger line.** Every entry comes out of `post_document`,
  `post_payment`, `post_entry` or `reconcile`, which carry the accounting
  rules. Direct inserts are for the objects a person types: contacts, draft
  documents and their lines, payments, bank transactions.
- **Delete or edit a posted entry.** There is no unpost, and no tool that
  removes one. A mistake is corrected with a credit note, which is how
  accounting has always worked. `unreconcile` is the only undo here, and
  matching changes no account.
- **Use a `service_role` key.** It would work, and that is the objection: it
  bypasses every policy, so the assistant would answer for companies its user
  was never invited to. The server refuses to start with one.

## Configuration

### The recommended route: PostgREST, as the signed-in user

```json
{
  "mcpServers": {
    "ekwo": {
      "command": "npx",
      "args": ["-y", "@ekwo-ai/mcp"],
      "env": {
        "SUPABASE_URL": "https://YOURREF.supabase.co",
        "SUPABASE_ANON_KEY": "your anon (publishable) key",
        "EKWO_EMAIL": "you@example.com",
        "EKWO_PASSWORD": "your password"
      }
    }
  }
}
```

That block goes in `claude_desktop_config.json` for Claude Desktop, or in
`.mcp.json` at the root of a project for Claude Code. `EKWO_ACCESS_TOKEN`
replaces the address and the password when you already hold a session; with
the password, the session is kept in memory and refreshed, and nothing is
written to disk.

### The fallback: a direct Postgres connection

For a self-hosted installation with no PostgREST in front of the database, or
for tests.

```json
{
  "env": {
    "EKWO_DB_URL": "postgresql://…",
    "EKWO_ACT_AS_USER_ID": "the auth.users id this server acts for"
  }
}
```

`EKWO_ACT_AS_USER_ID` is **required**, and that is the whole point of this
mode. A database connection is nobody: `auth.uid()` is null, row level
security is bypassed rather than satisfied, and a server running that way
would be a way round the policies rather than a client of them. So every
query runs inside a transaction that sets `request.jwt.claims` to that user
and switches to the `authenticated` role, and the policies bind exactly as
they do over the API. This mode needs the `postgres` package installed
alongside the server; the recommended route needs no driver at all.

| Variable | Meaning |
|---|---|
| `SUPABASE_URL` | `https://<ref>.supabase.co` |
| `SUPABASE_ANON_KEY` | The anon (publishable) key. A `service_role` key is refused. |
| `EKWO_EMAIL` / `EKWO_PASSWORD` | The user this assistant acts as |
| `EKWO_ACCESS_TOKEN` | A session already in hand, instead of the two above |
| `EKWO_DB_URL` | A direct Postgres connection, for a self-hosted installation |
| `EKWO_ACT_AS_USER_ID` | Required with `EKWO_DB_URL`: the `auth.users` id to act for |

## The tools

Every write names its company explicitly.

| Tool | What it does |
|---|---|
| `list_companies` | The companies you are a member of, with your role on each |
| `get_company` | Financial years, lock dates, journals, default accounts |
| `list_accounts` | The accounts a company works with, by code prefix, type or name. `include_all` for the whole chart |
| `search_contacts` | Customers and suppliers, by name, type or VAT number |
| `search_products` | The catalogue: code, unit, price, account and tax of what is sold and bought |
| `list_documents` | Invoices, credit notes and quotes, filtered |
| `get_document` | One document with its lines and the entry it produced |
| `list_bank_accounts` | The bank accounts of a company, with the journal and ledger account behind each |
| `list_bank_transactions` | Statement lines, pending by default |
| `trial_balance` | Opening, movements and closing per account |
| `general_ledger` | Every posted line of an account, with a running balance |
| `aged_balance` | What is still owed, bucketed by age, read from the ledger |
| `vat_return` | The boxes for a period, summed from the ledger |
| `ec_sales_list` | The recapitulative statement of intra-Community supplies: one line per customer VAT number and per nature |
| `list_statements` / `financial_statement` | The schemes a company can be presented on, and one statement |
| `generate_fec` | The French FEC as text, with its checks and its filename |
| `read_audit_log` | Who changed what and when: the configuration of a company, and the acts that change a state. Append-only; nothing writes it |
| `get_preferences` | What you prefer, and the language chain to read labels with |
| `list_invitations` | Who has been invited into a company and not yet joined |
| `list_api_keys` | The machine keys of a company, and what each may do |
| `describe_pack` | Which country packs this installation holds: their version, how much anyone has read them, and the register of texts each was built from — title, official publisher, link and the day it was opened |
| `status` | Schema version, instance, connection, companies |
| `create_contact` | A customer, supplier or other third party |
| `create_product` | A catalogue row: code, name, unit, price, account, tax |
| `update_product` | Changes one, or retires it with `active: false` |
| `pin_accounts` | Adds accounts to the working chart a company sees first, or takes one back out with `pinned: false` |
| `create_document` | A draft invoice, credit note or quote, with its lines |
| `update_document_lines` | Replaces the lines of a **draft** |
| `post_document` | Books it. Cannot be undone. |
| `record_payment` | Books money in or out and matches it against open invoices |
| `reconcile` / `unreconcile` | Matches two ledger lines, or undoes one matching |
| `create_bank_account` | Registers an account from its IBAN and wires it to the bank journal. Running it twice with the same IBAN creates nothing |
| `create_bank_transaction` | One statement line by hand, for an installation with no feed |
| `lock_period` | Moves the accounting and VAT lock dates. Needs `company.write`. |
| `opening_balance` | The trial balance of whatever kept the books before, as the opening entry |
| `close_fiscal_year` / `reopen_fiscal_year` | Closes a year the way the country pack says, or reverses a close run too early |
| `create_company` | A company on a country pack, with its chart and its first financial year. An instance-level act |
| `update_company_profile` | What a company says about itself on its documents |
| `set_preferences` | Your own language, timezone, formats and default company |
| `invite_member` / `revoke_invitation` | Invites an address into a company, or withdraws the invitation. The token is shown once |
| `create_api_key` / `revoke_api_key` | A key for a machine, scoped to one company and a list of capabilities |

**`list_accounts` answers with the working chart, not the whole one.** A
country pack transcribes the regulation — 353 accounts in Belgium, 1 026 in
Luxembourg — and a company works with a few dozen of them, so the default is
what `accounts_in_use()` returns: the accounts carrying posted entries, those
the company's own settings or an enabled module point at, and those somebody
pinned, minus the deprecated ones. Every answer carries a `scope` field saying
which it used. `in_use_from` and `in_use_to` narrow the movements to a period;
`include_all` returns the whole chart; `include_deprecated` returns it with the
retired accounts too; and `ekwo://companies/{id}/chart` was already the
resource that carries everything. None of this restricts anything: a document
line may name any account of the chart that is not deprecated, and every write
tool still accepts one.

`post_document`, `record_payment`, `update_document_lines`, `unreconcile`,
`lock_period`, `opening_balance`, `close_fiscal_year`, `reopen_fiscal_year`,
`revoke_invitation` and `revoke_api_key` are annotated destructive in the
protocol, so a client can ask before calling them.

**What a tool may do is the capability the user holds**, not the tool's own
right: the server acts as the person it signed in as, so `post_document` works
for an accountant and is refused to a viewer, by the database, with the
database's own words. `get_company` returns `your_capabilities` for exactly
that reason.

**The modules.** A module of this installation gets its own tools, under the
prefix its `module.json` declares, and the server reads `public.modules` at
startup to know which: `assets_list`, `assets_create`, `assets_schedule`,
`assets_run_depreciation`, `assets_dispose`, `budgets_list`,
`budgets_upsert_lines`, `budgets_variance`. A module that is not installed is
not offered, because a tool a model cannot use is worse than a tool it cannot
see. PostgREST serves a module's schema only once the project exposes it, and
the refusal it answers with is a profile error that says nothing useful — so
every module tool turns it into the sentence that names the setting.

**Resources.** `ekwo://companies/{id}/chart` is the whole chart of accounts;
`ekwo://companies/{id}/taxes` is every tax with the ledger account and the
declaration box each of its postings feeds.

**Prompts.** `close_month` walks the month-end checklist — drafts, unmatched
bank lines, the balance, the VAT, what is still open. `prepare_vat_return`
pulls the boxes and ties them back to the ledger before anything is filed.

## Conventions

- **Amounts are decimal strings.** `"1210.00"`, never a float. They go in that
  way and come back that way, because `numeric` is exact and a float is not.
- **Dates are ISO**, `2026-06-15`. Identifiers are uuids.
- **Totals are computed by the database.** `create_document` returns the draft
  with the totals the schema derived, not with anything the caller supplied.
- **Refusals travel unchanged.** `period_locked:`, `entry_unbalanced:`,
  `document_total_mismatch:` and the rest arrive with the message the database
  raised, plus one sentence saying what it means. They are answers, not
  obstacles to route around.
- **A product fills a line in and never constrains it.** A line naming
  `product_code` takes the catalogue's text, description, unit, price, account
  and tax; anything the line carries wins over that. What is already posted is
  never touched when the catalogue changes, and a product referenced by a line
  is retired with `active: false` rather than deleted.
- **A missing tax is a missing tax.** A line with no tax books a base with no
  VAT box, which is not the same as 0 %. A missing *account* is different: it
  can only mean "resolve it", because a product line with no account is
  refused by a check constraint. So a line may leave `account_code` out, and
  the database fills it — the company default, then the country model.

## Testing it by hand

The automated tests run every tool against the real schema in Postgres
compiled to WebAssembly (`tests/mcp/`), including the refusals. Two things
they cannot run: PostgREST and GoTrue. To exercise those, on a project you can
throw away:

```sh
npx ekwo init --country BE --org "Scratch" --company "Scratch BV" …   # a real project
```

Then point a client at it — in Claude Desktop, the JSON block above — and:

1. **"List my companies."** The company you created, with `your_role: owner`.
2. **"What are the journals and the lock dates?"** `get_company`.
3. **"Create a customer called Dumont, then invoice them 1 000 € plus 21 %
   VAT for consulting."** `create_contact`, then `create_document`; the answer
   carries `amount_total: "1210.00"` computed by the database.
   Or with a catalogue: **"add a product CONS-JOUR, a consulting day at 500 €
   on 704000 at 21 %, then invoice Dumont two of them"** — `create_product`,
   then `create_document` with `product_code` and nothing else on the line.
4. **"Post it."** `post_document`. The entry books 704 / 451 / 400 and takes a
   number like `SAL/2026/0001`.
5. **"They paid 500 € on the 10th."** `record_payment`, which books the bank
   line and matches it; the invoice becomes partially paid.
6. **"Show me the trial balance and the VAT for the quarter."**
   `trial_balance` and `vat_return`.
7. **"Lock June."** `lock_period`, then try to post something dated in June:
   the refusal comes back as `period_locked:`.

A payment needs somewhere to book the bank side. On a company installed from a
country model the bank and cash journals already point at their account
(`550000` and `570000` in Belgium, `512000` and `530000` in France), so
`record_payment` works with nothing else set up. `create_bank_account` names
the real account — the IBAN is the one thing nobody can derive — and wires it
to the journal; `bank_account_id` on the payment then says which one the money
moved on, which is what you need with several accounts in one journal. Until a
company has one, `ekwo doctor` says so.

## Licence

[AGPL-3.0-only](../../LICENSE) © Ekwo AI.
