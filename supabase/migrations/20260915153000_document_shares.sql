-- Ekwo OS — a document, opened by whoever holds its link.
--
-- A company sends an invoice and the customer wants to look at it: what it
-- says, what is still owed on it, which sentences the law put at its foot. The
-- three answers already exist in this schema — `document_header`,
-- `document_line_items`, `document_tax_summary`, `document_legal_mentions`,
-- `documents.amount_residual` — and every one of them is behind row level
-- security, which is right: the customer is not a member of the company and
-- never will be. So the usual answers are both bad. A login for a customer who
-- will read one invoice is an account nobody maintains; an attachment is a
-- copy that stops being true the day the invoice is paid.
--
-- A **share** is the third answer: a row that says *this document may be read
-- by whoever presents this secret*, and one function that takes the secret and
-- returns the document as it was sent, with what is still owed on it today.
--
-- Six decisions, each of them a thing that could have been done otherwise.
--
-- **The token is the whole secret, and only its hash is stored.** 32 bytes,
-- rendered base64url, 43 characters. `document_shares.token_hash` is a sha256
-- of it and the clear token is returned by `share_document()` and by nothing
-- else, ever — the same arrangement `company_invitations` and `api_keys` are
-- already built on, and for the same reason: a database backup, a replica or a
-- support engineer reading a table hands nobody a live link.
--
-- **Where the 32 bytes come from is not `gen_random_bytes`.** That function is
-- `pgcrypto`, and `pgcrypto` is not available under PGlite, which is what this
-- repository's whole test suite runs on — an invariant that cannot be tested
-- is an invariant nobody is keeping. `gen_random_uuid()` is core Postgres and
-- is the source the primary keys of every table here already come from; two of
-- them are 32 bytes, of which 244 bits are random (a v4 UUID fixes six bits for
-- its version and its variant). 244 bits is far past the point where guessing
-- is the attack anybody would choose, and `sha256()` is core too, since
-- PostgreSQL 11. No extension is added by this migration and none is needed.
--
-- **`anon` gets one function and not one table.** The invariant of
-- `20260911210131` and `20260914151207` — the anonymous role holds no
-- privilege on any table or view of this schema, and reaches only functions
-- that answer about the caller — is not bent here. `shared_document()` is
-- `security definer`: the reader has no rights of their own, the function has
-- them, and what comes out is one document rendered into one jsonb. There is
-- no view to select from, no filter to widen and no second row to reach.
--
-- **No IP address and no user agent.** Who opened a link and from where is a
-- log, and a log of the people a company invoices is personal data with a
-- retention policy, a lawful basis and a subject-access request behind it. The
-- core records `view_count` and `last_viewed_at`, which is what the sender
-- actually asks ("did they open it?"), and the application in front of it
-- records whatever it is prepared to answer for.
--
-- **A share is not edited.** There is no `update` policy and no
-- `change_share()`. An expiry that moves is a link whose lifetime is a moving
-- target, and a token that outlives the decision to withdraw it is the one
-- failure a sharing feature must not have. Revoke it and make another.
--
-- **Sales only.** A purchase invoice is a document somebody else wrote about
-- their own business: their prices, their bank details, their legal mentions.
-- Publishing it under a link this company controls would be publishing a third
-- party's data, and there is no request behind it — nobody shares a supplier's
-- invoice with the supplier. `share_document()` refuses it by name.

-- ---------------------------------------------------------------------------
-- 1. The instance learns its own address
--
-- A link has to be absolute, and nothing in this schema knew where the
-- installation answers. The column is nullable, carries no default, and no URL
-- of Ekwo's is written anywhere: a self-hosted installation is reachable at
-- the address its operator chose, and a core that guessed would hand out links
-- to somebody else's host. Null is a supported state — `share_document()`
-- returns the token with a null `url`, and the caller builds the link itself.
-- ---------------------------------------------------------------------------

alter table instance
  add column if not exists public_base_url text;

comment on column instance.public_base_url is
  'Where this installation answers on the public internet, as an origin with no trailing slash — the base a shared document link is built on. Null where the operator has not said, and then a share returns its token with no URL.';

alter table instance
  add constraint instance_public_base_url_absolute
    check (public_base_url is null or public_base_url ~ '^https?://[^[:space:]]+$');

-- ---------------------------------------------------------------------------
-- 2. What a share is about
--
-- One value today. It exists because the second one is already foreseeable —
-- a statement of account, a financial statement, an ageing balance sent to a
-- customer are the same act with a different subject — and because the shape
-- that survives it is decided now or paid for later. `document_id` is nullable
-- and tied to the kind by a check, so the kind that arrives next adds its own
-- column and its own branch of the same check, and every row written before it
-- keeps meaning exactly what it meant.
-- ---------------------------------------------------------------------------

create type share_subject_kind as enum ('document');

comment on type share_subject_kind is
  'What a share gives access to. One value today; a statement or a report is the same act with another subject, and the column is here so that arriving costs a branch rather than a rewrite.';

create table document_shares (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references companies(id) on delete cascade,
  subject_kind   share_subject_kind not null default 'document',
  document_id    uuid references documents(id) on delete cascade,
  -- sha256 of the token, hex. Unique, because presenting a token is a lookup
  -- on this column and two rows answering it would be two links nobody can
  -- tell apart.
  token_hash     text not null unique,
  expires_at     timestamptz,
  revoked_at     timestamptz,
  created_by     uuid,
  created_at     timestamptz not null default now(),
  view_count     integer not null default 0,
  last_viewed_at timestamptz,
  constraint document_shares_subject_matches_kind
    check ((subject_kind = 'document') = (document_id is not null)),
  constraint document_shares_expiry check (expires_at is null or expires_at > created_at),
  constraint document_shares_view_count_positive check (view_count >= 0),
  constraint document_shares_token_hash_shape check (token_hash ~ '^[0-9a-f]{64}$'),
  foreign key (document_id, company_id) references documents(id, company_id) on delete cascade
);

comment on table document_shares is
  'Public links onto a document. The token is handed over once and kept only as a sha256; the link is withdrawn by revoking it, never by editing it.';
comment on column document_shares.token_hash is
  'sha256 of the token, hex. The token itself is returned by share_document() and stored nowhere.';
comment on column document_shares.expires_at is
  'When the link stops answering. Null means it answers until it is revoked, which is a deliberate choice and not an oversight: an invoice is looked at years later.';
comment on column document_shares.revoked_at is
  'When the link was withdrawn. A withdrawn link answers exactly like one that never existed.';
comment on column document_shares.created_by is
  'auth.users.id of whoever created it. No foreign key, for the same reason company_members has none.';
comment on column document_shares.view_count is
  'How many times the document was read through this link. No address and no user agent: who opened it and from where is a log the application keeps, with the retention policy that goes with it.';

-- The second one leads with the two columns of the composite foreign key, in
-- its order, which is the rule `20260913104232` set and a test enforces: a key
-- without an index is a sequential scan on every delete of the parent row.
create index document_shares_company_idx on document_shares (company_id, created_at desc);
create index document_shares_document_idx on document_shares (document_id, company_id);

-- ---------------------------------------------------------------------------
-- 3. Sharing is its own capability
--
-- `documents.write` would have been close enough to work and wrong to read: a
-- bookkeeper who drafts invoices is not necessarily the person a company wants
-- publishing them on the open internet, and the two acts are refused and
-- granted separately the first time somebody asks. It sits on the two presets
-- that issue documents, and on neither the viewer nor anything below.
-- ---------------------------------------------------------------------------

insert into capabilities (code, area, description) values
  ('documents.share', 'documents',
   'Publish a sales document behind a link anyone holding it can open, and withdraw such a link.')
on conflict (code) do nothing;

insert into role_capabilities (role, capability)
select r.role, 'documents.share'
  from (values ('owner'::member_role), ('accountant'::member_role)) as r(role)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 4. Which documents may be shared, and the refusal each one gets
--
-- Four rules, and a named refusal for each, because "not allowed" on an
-- invoice somebody is trying to send is the least useful sentence a database
-- can produce. Written once here and read by both `share_document()` — which
-- refuses — and `shared_document()` — which stops answering the day the
-- document leaves the set, so cancelling an invoice closes the links onto it
-- without anybody having to remember to revoke them.
-- ---------------------------------------------------------------------------

create or replace function document_share_refusal(p_document documents)
returns text
language sql
immutable
as $$
  select case
    when p_document.doc_type::text not like 'sale%' then
      'share_not_a_sale: a ' || p_document.doc_type::text ||
      ' is a third party''s own document — their prices, their bank details, their mentions — and this installation does not publish it'
    when p_document.state = 'cancelled' then
      'share_cancelled_document: that document was cancelled, and a cancelled document is not sent to anybody'
    when p_document.doc_type in ('sale_invoice', 'sale_credit_note')
         and p_document.state = 'draft' then
      'share_draft_document: that document is still a draft. Post it — a draft has no number, carries no entry, and is not what was sent'
    when p_document.number is null then
      'share_unnumbered_document: that document carries no number, so there is nothing to show a customer that they can quote back'
    else null
  end;
$$;

comment on function document_share_refusal(documents) is
  'Why this document may not be shared, or null when it may. Sales only, never cancelled, never an unposted invoice, always numbered.';

-- ---------------------------------------------------------------------------
-- 5. Creating a link
--
-- `security definer`, for three reasons at once: the token has to be hashed
-- where nobody sees it, `audit_record()` is reachable by no client, and a
-- caller who may share a document is not necessarily a caller who may insert
-- into a table nothing else writes.
--
-- The token comes back in this answer and in no other. The URL is the
-- installation's base plus `/shared/<token>` — one path, written down in
-- `docs/sharing.md`, so that an operator putting a reverse proxy in front of
-- their installation knows which route has to reach the application.
-- ---------------------------------------------------------------------------

create or replace function share_document(
  p_document_id uuid,
  p_expires_at  timestamptz default null
)
returns table (share_id uuid, token text, url text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_doc     documents%rowtype;
  v_refusal text;
  v_token   text;
  v_base    text;
  v_row     document_shares%rowtype;
begin
  select * into v_doc from documents where id = p_document_id;
  if v_doc.id is null then
    raise exception 'unknown_document: document % does not exist', p_document_id;
  end if;

  if not is_installer() and not has_capability(v_doc.company_id, 'documents.share') then
    raise exception 'not_allowed: publishing a document of this company needs documents.share'
      using errcode = '42501';
  end if;

  v_refusal := document_share_refusal(v_doc);
  if v_refusal is not null then
    raise exception '%', v_refusal;
  end if;

  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'share_expires_in_the_past: % is not in the future, so this link would be born dead',
      p_expires_at;
  end if;

  -- 32 bytes as base64url, 43 characters, no padding. `translate` maps the two
  -- characters base64 and base64url disagree on and drops the `=`, whose
  -- position is implied by the length.
  v_token := translate(
    encode(
      decode(replace(gen_random_uuid()::text, '-', '') ||
             replace(gen_random_uuid()::text, '-', ''), 'hex'),
      'base64'),
    '+/=', '-_');

  insert into document_shares (company_id, subject_kind, document_id, token_hash,
                               expires_at, created_by)
  values (v_doc.company_id, 'document', v_doc.id,
          encode(sha256(convert_to(v_token, 'UTF8')), 'hex'),
          p_expires_at, auth.uid())
  returning * into v_row;

  perform audit_record(
    v_doc.company_id, 'document_shares', v_row.id,
    coalesce(v_doc.number, v_doc.id::text), 'insert', 'document_shared',
    null,
    jsonb_build_object('document_id', v_doc.id, 'doc_type', v_doc.doc_type,
                       'expires_at', v_row.expires_at));

  select i.public_base_url into v_base from instance i where i.id = 1;

  return query select v_row.id,
                      v_token,
                      case when v_base is null then null
                           else rtrim(v_base, '/') || '/shared/' || v_token end;
end;
$$;

comment on function share_document(uuid, timestamptz) is
  'Publishes a sales document behind a link and returns the token once — only its hash is stored. `url` is the instance''s public base plus /shared/<token>, or null where the instance has not recorded one. A share is never edited: revoke it and make another.';

create or replace function revoke_share(p_share_id uuid)
returns document_shares
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row document_shares%rowtype;
begin
  select * into v_row from document_shares where id = p_share_id;
  if v_row.id is null then
    raise exception 'unknown_share: no share with that id';
  end if;

  if not is_installer() and not has_capability(v_row.company_id, 'documents.share') then
    raise exception 'not_allowed: withdrawing a link of this company needs documents.share'
      using errcode = '42501';
  end if;

  update document_shares
     set revoked_at = coalesce(revoked_at, now())
   where id = p_share_id
  returning * into v_row;

  perform audit_record(
    v_row.company_id, 'document_shares', v_row.id,
    (select coalesce(d.number, d.id::text) from documents d where d.id = v_row.document_id),
    'update', 'document_share_revoked',
    null, jsonb_build_object('revoked_at', v_row.revoked_at));

  return v_row;
end;
$$;

comment on function revoke_share(uuid) is
  'Withdraws a link, now and for good. A withdrawn link answers exactly like one that never existed; there is no un-withdraw, because a secret that has been out of the building is issued again rather than brought back.';

-- ---------------------------------------------------------------------------
-- 6. Reading one
--
-- The public door. `anon` may execute it and it takes one argument: the token
-- is the whole of what the caller presents and the whole of what the function
-- consults, so there is nothing to enumerate and nothing to widen. Unknown,
-- revoked, expired, and a document that has since left the shareable set all
-- produce the *same* answer — SQL null — because an error message that
-- distinguished them would tell somebody feeding tokens at it which of their
-- guesses had been a real link.
--
-- What comes out is the document as it was sent, plus the one thing that
-- legitimately moves after sending: what is still owed. Every figure is read
-- from the views the renderer of this schema already uses, so a shared link
-- and a printed invoice cannot come to disagree.
--
-- What deliberately does not come out: no identifier of anything — not the
-- document, not the company, not the contact, not a tax, not an account —
-- no analytic axis, no cost, no internal contact note, no list of anything
-- the company owns. A link is one document, and nothing it carries can be
-- turned into a question about a second one.
--
-- Every amount is rendered as a decimal *string*. A JSON number is a double
-- by the time it reaches a browser, and an invoice total that arrives as
-- 1210.0000000000002 is the oldest bug in billing software. It is also what
-- the rest of this project already says on the wire: the MCP server tells its
-- clients that amounts are decimal strings, and `::text` on a numeric keeps
-- the scale the column was rounded at.
-- ---------------------------------------------------------------------------

create or replace function shared_document(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_share    document_shares%rowtype;
  v_doc      documents%rowtype;
  v_header   document_header%rowtype;
  v_language text;
  v_last_payment date;
  v_payload  jsonb;
begin
  select * into v_share
    from document_shares
   where token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex');

  if v_share.id is null
     or v_share.revoked_at is not null
     or (v_share.expires_at is not null and v_share.expires_at <= now())
     or v_share.subject_kind <> 'document' then
    return null;
  end if;

  select * into v_doc from documents where id = v_share.document_id;
  if v_doc.id is null or document_share_refusal(v_doc) is not null then
    return null;
  end if;

  -- The link was used. Counted before the payload is built, so a reader who
  -- gives up halfway is still a reader.
  update document_shares
     set view_count = view_count + 1,
         last_viewed_at = now()
   where id = v_share.id;

  select * into v_header from document_header where document_id = v_doc.id;

  -- The language the document speaks: the one the customer reads, else the one
  -- the company keeps its books in. `companies.language` is not null — it is
  -- filled from the pack when the company is created — so the chain always
  -- ends somewhere, and it ends without a literal. A language written into
  -- this function would be one country's answer printed on every other
  -- country's invoice.
  --
  -- `preferred_languages()` is the published way of choosing a language and it
  -- cannot be used here: it starts at the preferences of `auth.uid()`, which
  -- is null for the one reader this function exists for. The gap is written
  -- down in `docs/international.md`.
  select coalesce(ct.language, c.language)
    into v_language
    from documents d
    join companies c on c.id = d.company_id
    join contacts ct on ct.id = d.contact_id
   where d.id = v_doc.id;

  -- When the last money against it arrived. The other side of every matching
  -- on the document's own third-party lines, where that side is a payment.
  select max(p.payment_date) into v_last_payment
    from entry_lines dl
    join reconciliations r
      on r.debit_line_id = dl.id or r.credit_line_id = dl.id
    join entry_lines ol
      on ol.id = case when r.debit_line_id = dl.id then r.credit_line_id else r.debit_line_id end
    join payments p on p.entry_id = ol.entry_id
   where dl.entry_id = v_doc.entry_id;

  v_payload := jsonb_build_object(
    'document', jsonb_build_object(
      'type',              v_header.doc_type,
      'number',            v_header.number,
      'document_date',     v_header.document_date,
      'due_date',          v_header.due_date,
      'delivery_date',     v_header.delivery_date,
      'currency',          v_header.currency_code,
      'language',          v_language,
      'payment_terms',     v_header.payment_terms,
      'payment_reference', v_header.payment_reference,
      'buyer_reference',   v_header.buyer_reference,
      'order_reference',   v_header.order_reference,
      -- BT-22, the note the seller wrote on the invoice itself. An internal
      -- remark about a customer is `contacts.notes` and is not in this object.
      'note',              v_header.note
    ),
    'seller', jsonb_build_object(
      'name',                v_header.seller_name,
      'legal_name',          v_header.seller_legal_name,
      'legal_form',          v_header.seller_legal_form,
      'vat_number',          v_header.seller_vat_number,
      'registration_number', v_header.seller_registration_number,
      'address_line1',       v_header.seller_address_line1,
      'address_line2',       v_header.seller_address_line2,
      'postal_code',         v_header.seller_postal_code,
      'city',                v_header.seller_city,
      'country',             v_header.seller_country,
      'email',               v_header.seller_email,
      'phone',               v_header.seller_phone,
      'website',             v_header.seller_website,
      'logo_url',            v_header.seller_logo_url,
      'iban',                v_header.payee_iban,
      'bic',                 v_header.payee_bic
    ),
    'buyer', jsonb_build_object(
      'name',                v_header.buyer_name,
      'vat_number',          v_header.buyer_vat_number,
      'registration_number', v_header.buyer_registration_number,
      'address_line1',       v_header.buyer_address_line1,
      'address_line2',       v_header.buyer_address_line2,
      'postal_code',         v_header.buyer_postal_code,
      'city',                v_header.buyer_city,
      'country',             v_header.buyer_country
    ),
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
               'sequence',         li.sequence,
               'type',             li.line_type,
               'name',             li.item_name,
               'description',      li.item_description,
               'quantity',         li.quantity::text,
               'unit_code',        li.unit_code,
               'unit_price',       li.unit_price::text,
               'discount_percent', li.discount_percent::text,
               'amount_untaxed',   li.amount_untaxed::text,
               'tax_category',     li.vat_category,
               'tax_rate',         li.vat_rate::text,
               'tax_exemption_code', li.tax_exemption_code)
               order by li.sequence)
        from document_line_items li
       where li.document_id = v_doc.id), '[]'::jsonb),
    'tax_summary', coalesce((
      select jsonb_agg(jsonb_build_object(
               'name',         ts.tax_name,
               'category',     ts.vat_category,
               'rate',         ts.tax_rate::text,
               'base_amount',  ts.base_amount::text,
               -- What the other party actually pays, which is what an invoice
               -- prints: zero where the tax self-assesses, and what the four
               -- totals below add up from.
               'tax_amount',   ts.tax_charged::text)
               order by ts.tax_rate, ts.tax_name)
        from document_tax_summary ts
       where ts.document_id = v_doc.id), '[]'::jsonb),
    'totals', jsonb_build_object(
      'amount_untaxed', v_header.amount_untaxed::text,
      'amount_tax',     v_header.amount_tax::text,
      'amount_total',   v_header.amount_total::text
    ),
    -- The one thing that legitimately moves after the document was sent, so a
    -- link a customer keeps stays worth opening.
    'payment', jsonb_build_object(
      'state',             v_header.payment_state,
      'amount_paid',       v_header.amount_paid::text,
      'amount_residual',   v_header.amount_residual::text,
      'last_payment_date', v_last_payment
    ),
    'legal_mentions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'code', lm.code,
               'text', label_for(lm.text, lm.text_i18n, array[v_language]))
               order by lm.sequence, lm.code)
        from document_legal_mentions lm
       where lm.document_id = v_doc.id), '[]'::jsonb)
  );

  return v_payload;
end;
$$;

comment on function shared_document(text) is
  'One document, read by whoever holds its link: the header, the lines, the tax breakdown, the totals, the legal mentions in the document''s own language, and what is still owed today. Returns null — the same null, in the same shape — for a token that is unknown, withdrawn, expired, or onto a document that may no longer be shared.';

-- ---------------------------------------------------------------------------
-- 7. Row level security
--
-- Reading the links of a company is reading its documents, so it is
-- `documents.read` — which every preset holds, viewer included, because seeing
-- that an invoice was published is part of reading it. Nothing writes the
-- table through the API: the two functions above are the only way in, and each
-- checks what a policy would have. That is the shape `api_keys` and
-- `company_invitations` already have, and it is why `list_shares` is a select
-- and not a fourth function — a list that row level security already produces
-- correctly does not need a function to produce it a second way.
--
-- There is no policy for `anon`, on this table or on any other. What an
-- anonymous reader reaches is one `security definer` function, and the table
-- under it is as closed to them as every other table of this schema.
-- ---------------------------------------------------------------------------

alter table document_shares enable row level security;

create policy document_shares_select on document_shares
  for select using (has_capability(company_id, 'documents.read'));

comment on policy document_shares_select on document_shares is
  'Anyone who may read the documents of the company may see which of them are published, and since when. The token is not here: only its hash is.';

-- ---------------------------------------------------------------------------
-- 8. Grants
--
-- The rule of `supabase/migrations/README.md`: the schema closes behind itself
-- and then says, by name, who may reach what. `anon` gains exactly one
-- execute, on the function that is the public door, and nothing on the table.
-- ---------------------------------------------------------------------------

revoke execute on all functions in schema public from public;

grant select on table document_shares to authenticated, service_role;

revoke execute on function document_share_refusal(documents) from public, anon;
grant execute on function document_share_refusal(documents) to authenticated, service_role;

revoke execute on function share_document(uuid, timestamptz) from public, anon;
grant execute on function share_document(uuid, timestamptz) to authenticated, service_role;

revoke execute on function revoke_share(uuid) from public, anon;
grant execute on function revoke_share(uuid) to authenticated, service_role;

revoke execute on function shared_document(text) from public;
grant execute on function shared_document(text) to anon, authenticated, service_role;
