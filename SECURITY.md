# Security

Ekwo OS holds books. A flaw here is not a crash, it is a company reading
another company's ledger, or an entry that posts without a trace. Please
report it, and please report it privately first.

## Reporting a vulnerability

Use GitHub's private reporting: **Security → Report a vulnerability** on this
repository. It opens a private advisory that only the maintainers can read,
and it keeps the report, the fix and the credit in one place.

If you cannot use it, write to **security@ekwo.ai**.

Say what you found, where, and how to reproduce it. A failing test is the best
report there is; a `curl` against a demo instance is the second best. Do not
include real books, real people or real keys in a report — a fictional company
reproduces everything a real one does.

Please do not open a public issue for a vulnerability, and please do not test
against an instance you do not own.

## What to expect

- An acknowledgement within three working days.
- A fix, or a reason why not, within thirty days for anything that crosses a
  row level security boundary or lets a posting bypass the ledger's rules.
  Shorter when the exploit is simple.
- Credit in the advisory and the changelog, unless you would rather not.

No bounty programme yet. The project is young; what it can offer today is a
fast fix and a public thank-you.

## What counts

The threat model is short, and it is in [`docs/decisions.md`](docs/decisions.md):

- **Every table has row level security, and a user only ever sees the
  companies they are a member of.** Reading, writing or listing a row of a
  company you are not a member of — through a table, a view, a function or
  the MCP server — is a vulnerability.
- **A function runs with the caller's rights, or checks membership itself.**
  A `security definer` function reachable by `anon` or by any authenticated
  user that does not verify the company is a vulnerability.
- **The ledger is append-only in effect.** Any path that changes a posted
  entry, or posts one without its document, without a journal, or unbalanced,
  is a vulnerability.
- **No secret reaches the disk.** The CLI writing a password, a
  `service_role` key or a token anywhere but memory is a vulnerability. The
  MCP server accepting a `service_role` key is one too.

Out of scope: a misconfigured Supabase project (a disabled RLS on a table you
created yourself, an exposed `service_role` key in your own environment), and
anything in a dependency that is already reported upstream.

## Supported versions

`v0.2.0`, released on 14 September 2026, is the first tagged release. The
latest minor is the supported line: it receives the fixes, and the changelog
says what changed. `main` is where they land first.

There is no backport to an earlier minor. Migrations move forward only —
there is no `down` — so the answer to a fix on an old installation is
`npx ekwo migrate`, and [`docs/releasing.md`](docs/releasing.md) is how a
release carrying one is cut.
