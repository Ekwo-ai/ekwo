# Sharing a document

A company sends an invoice and the customer wants to look at it: what it says,
what is still owed on it, what the law put at its foot. Everything needed to
answer already exists in this schema, and every bit of it is behind row level
security — which is right, because the customer is not a member of the company
and never will be.

A **share** is a row that says *this document may be read by whoever presents
this secret*, and one function that takes the secret and returns the document.
The token in the link is the whole secret. There is no account, no password and
no second factor.

The core provides the data and the three functions. The page the customer looks
at is the application's, and it lives outside this repository.

## The three functions

| Function | Who may call it | What it does |
|---|---|---|
| `share_document(document_id, expires_at)` | a member holding `documents.share` | creates a link and returns the token **once** |
| `revoke_share(share_id)` | a member holding `documents.share` | stops the link working, for good |
| `shared_document(token)` | **`anon`** and `authenticated` | returns one document as jsonb, or null |

`document_shares` is the table under them. Members of the company read it —
`documents.read`, which every preset holds — and nobody writes it through the
API: the two functions above are the only way in. That is why there is no
fourth function called `list_shares`: the list is a `select` that row level
security already answers correctly, and a function producing it a second way
would be a second place where the rule is written.

## Creating a link

```sql
select * from share_document('…document id…');
-- share_id | token                                       | url
-- 3f2a…    | kZ3m…_Q                                     | https://books.example/shared/kZ3m…_Q
```

The token is 32 bytes rendered base64url, 43 characters. It is returned by this
call and by nothing else, ever: the table holds a sha256 of it and no column
anywhere holds the token itself. A lost link is withdrawn and made again.

`url` is `instance.public_base_url` plus **`/shared/<token>`**. That path is the
contract between the core and whatever serves the page: an operator putting a
reverse proxy in front of their installation has to route it to the
application. `instance.public_base_url` is nullable and has no default — a
self-hosted installation answers at the address its operator chose, and a core
that guessed would hand out links to somebody else's host. Where it is empty,
`share_document` returns the token with a null `url` and the caller builds the
link itself.

`expires_at` is optional. Null means the link answers until it is withdrawn,
which is the ordinary case: an invoice is looked at years later.

**A share is never edited.** There is no update policy and no `change_share()`.
An expiry that can move is a lifetime nobody can rely on, and a token that
outlives the decision to withdraw it is the one failure a sharing feature must
not have. To change anything about a link, revoke it and make another.

## What may be shared

Sales documents only — an invoice, a credit note, a quote — that are not
cancelled and carry a number. Each refusal is named:

| Refusal | When |
|---|---|
| `share_not_a_sale` | a purchase document: somebody else's own document, their prices, their bank details, their mentions |
| `share_cancelled_document` | the document was cancelled |
| `share_draft_document` | an invoice or a credit note that has not been posted |
| `share_unnumbered_document` | anything else without a number |
| `share_expires_in_the_past` | an expiry that is already behind us |

The same four rules are re-read by `shared_document` on every visit, so
cancelling an invoice closes every link onto it without anybody having to
remember to revoke them.

## Reading a link

```sql
select shared_document('kZ3m…_Q');
```

It takes the token and nothing else, so there is nothing to enumerate and
nothing to widen. It answers with one jsonb object:

```jsonc
{
  "document":  { "type", "number", "document_date", "due_date", "delivery_date",
                 "currency", "language", "payment_terms", "payment_reference",
                 "buyer_reference", "order_reference", "note" },
  "seller":    { "name", "legal_name", "legal_form", "vat_number",
                 "registration_number", "address_line1", "address_line2",
                 "postal_code", "city", "country", "email", "phone", "website",
                 "logo_url", "iban", "bic" },
  "buyer":     { "name", "vat_number", "registration_number", "address_line1",
                 "address_line2", "postal_code", "city", "country" },
  "lines":     [ { "sequence", "type", "name", "description", "quantity",
                   "unit_code", "unit_price", "discount_percent",
                   "amount_untaxed", "tax_category", "tax_rate",
                   "tax_exemption_code" } ],
  "tax_summary": [ { "name", "category", "rate", "base_amount", "tax_amount" } ],
  "totals":    { "amount_untaxed", "amount_tax", "amount_total" },
  "payment":   { "state", "amount_paid", "amount_residual", "last_payment_date" },
  "legal_mentions": [ { "code", "text" } ]
}
```

Four things about that shape are deliberate.

**Every amount is a decimal string.** A JSON number is a double by the time it
reaches a browser, and an invoice total that arrives as `1210.0000000000002` is
the oldest bug in billing software.

**No identifier of anything is in it.** Not the document, not the company, not
the contact, not a tax, not an account. A link is one document, and nothing it
carries can be turned into a question about a second one.

**`payment` is the one thing that moves after the document was sent**, which is
what makes a link worth keeping: a customer who paid last week opens the same
link and sees that it is settled. `tax_amount` in the breakdown is what the
other party actually pays — zero where the tax self-assesses — so the breakdown
adds up to `totals.amount_tax`.

**The legal mentions come out in the document's own language**: the customer's,
else the company's, else the one the country pack is written in. They are the
sentences `document_legal_mentions` produces, which is what a printed invoice
carries, so a link and a PDF cannot come to disagree.

## The same answer for every kind of no

Unknown token, withdrawn link, expired link, a document that may no longer be
shared: all four return **null**, the same null in the same shape. An error
message that distinguished them would tell somebody feeding tokens at the
function which of their guesses had been a real link.

## What is counted, and what is not

`document_shares.view_count` and `last_viewed_at` record that the link was
opened, which is the question a sender actually asks. There is no IP address
and no user agent: who opened a link and from where is a log of the people a
company invoices, which is personal data with a retention policy, a lawful
basis and a subject-access request behind it. An application that is prepared
to answer for such a log keeps its own.

## Through the MCP server

`share_document`, `revoke_share` and `list_shares` are tools, with the same
contract and the same refusals.

`shared_document` is **not** a tool, and that is a decision rather than an
omission: it is the public door, and an assistant that could read a document by
presenting a token would be an assistant somebody hands a token to.

## Why there is no access code

The token is the secret. A second factor — a code the sender reads out over the
phone, the customer's own VAT number, a one-time password by e-mail — is a
useful option and is not the floor: it turns every link into a conversation,
and most invoices are sent to somebody who is expected to open them. It belongs
on the share, as something the sender chooses, the day somebody needs it. The
shape here does not stand in its way: a column on `document_shares` and a
second argument to `shared_document` is the whole of it.
