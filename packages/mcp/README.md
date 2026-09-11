# @ekwo-ai/mcp

The [Model Context Protocol](https://modelcontextprotocol.io) server for
[Ekwo OS](https://github.com/Ekwo-ai/ekwo). It lets an AI assistant keep the
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

Thirteen read, nine write. Every write names its company explicitly.

| Tool | What it does |
|---|---|
| `list_companies` | The companies you are a member of, with your role on each |
| `get_company` | Financial years, lock dates, journals, default accounts |
| `list_accounts` | The chart of accounts, by code prefix, type or name |
| `search_contacts` | Customers and suppliers, by name, type or VAT number |
| `list_documents` | Invoices, credit notes and quotes, filtered |
| `get_document` | One document with its lines and the entry it produced |
| `list_bank_transactions` | Statement lines, pending by default |
| `trial_balance` | Opening, movements and closing per account |
| `general_ledger` | Every posted line of an account, with a running balance |
| `aged_balance` | What is still owed, bucketed by age, read from the ledger |
| `vat_return` | The boxes for a period, summed from the ledger |
| `generate_fec` | The French FEC as text, with its checks and its filename |
| `status` | Schema version, instance, connection, companies |
| `create_contact` | A customer, supplier or other third party |
| `create_document` | A draft invoice, credit note or quote, with its lines |
| `update_document_lines` | Replaces the lines of a **draft** |
| `post_document` | Books it. Cannot be undone. |
| `record_payment` | Books money in or out and matches it against open invoices |
| `reconcile` / `unreconcile` | Matches two ledger lines, or undoes one matching |
| `create_bank_transaction` | One statement line by hand, for an installation with no feed |
| `lock_period` | Moves the accounting and VAT lock dates. Owner only. |

`post_document`, `record_payment`, `update_document_lines`, `unreconcile` and
`lock_period` are annotated destructive in the protocol, so a client can ask
before calling them.

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
- **A missing tax is a missing tax.** A line with no tax books a base with no
  VAT box, which is not the same as 0 %.

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
4. **"Post it."** `post_document`. The entry books 704 / 451 / 400 and takes a
   number like `SAL/2026/0001`.
5. **"They paid 500 € on the 10th."** `record_payment`, which books the bank
   line and matches it; the invoice becomes partially paid.
6. **"Show me the trial balance and the VAT for the quarter."**
   `trial_balance` and `vat_return`.
7. **"Lock June."** `lock_period`, then try to post something dated in June:
   the refusal comes back as `period_locked:`.

A payment needs somewhere to book the bank side: either a bank account
(`bank_accounts`) wired to its journal, or a `default_account_id` on the
journal. `install_country_template` does not set one, so create the bank
account once before the first payment.

## Licence

[AGPL-3.0-only](../../LICENSE) © Ekwo AI.
