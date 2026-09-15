-- Ekwo OS — a document records the language it was written in.
--
-- Until here it did not. The language of an invoice was re-derived on every
-- read, from the customer's preference, then the company's, then the one the
-- country pack declares — and re-derived is the whole problem. A customer who
-- switches to another language rewrites every invoice ever sent to them: the
-- legal mentions at the foot of a document somebody filed last year come back
-- in a language that document was never written in. On the one part of an
-- invoice a country actually legislates, that is not a display preference, it
-- is a different document.
--
-- `documents.language` is the fix, and it is the same fix the lines already
-- have. `document_lines.vat_category` and `vat_rate` are snapshots — the value
-- the tax had when the line was written — so that a rate change cannot rewrite
-- history. The language is that, for the sentences.
--
-- Four decisions.
--
-- **The column is written from the chain that already existed, not from a
-- literal.** The customer's language, else the company's, else the one the
-- pack declares. No country and no language is named anywhere in this file:
-- `companies.language` is not null — it is filled from the pack when the
-- company is created — so the chain always ends somewhere, and it ends in
-- data.
--
-- **It stops moving when the document is posted**, and not before. A draft is
-- not a document anybody has seen: it carries no number, no entry, and the
-- customer it is addressed to may still change. So while a document is a
-- draft its language is the chain's answer, kept in step when the chain moves
-- under it; the moment it is posted it is the document's own, and the guard
-- refuses to move it. That is the shape `accounts_guard_frozen` already has
-- for the code of an account, and the reason is the same: a policy judges
-- which company a row belongs to and has nothing to say about which column
-- changes.
--
-- **`preferred_languages()` gains the overload it was missing.** The published
-- way of choosing a language starts at `user_preferences` for `auth.uid()`,
-- which is null for the one reader a shared link exists for, so
-- `shared_document()` wrote the chain out a second time inside itself. The
-- chain is not about a *user*, it is about a *starting point*: a person's
-- preference, or a document's own language. `preferred_languages(language,
-- company)` takes that starting point explicitly, and the function that takes
-- a company alone is now one line on top of it — the signed-in reader's
-- preference is simply the starting point a session supplies.
--
-- **The reader of the sentences reads the document.**
-- `document_legal_mentions` published the pack's own text and the object of
-- translations beside it, and left every caller to pick a language; the only
-- caller in this repository picked it from the contact of the day. The view
-- now answers in the document's language, because it is a view *about a
-- document*, and keeps `text_i18n` for a renderer that wants a second one.
--
-- Nothing in a pack moves: this is a column, a function and two views. The
-- golden files are identical to the byte.

-- ---------------------------------------------------------------------------
-- 1. The chain, from a starting point that is not a session
--
-- `stable security definer`, like the function it now carries: it answers
-- about a company the caller is not necessarily a member of — which is exactly
-- the case of somebody holding a link to one invoice — and what comes out is
-- two-letter language codes and nothing else.
--
-- Neither argument carries a default. A one-argument call would then be
-- ambiguous between this function and the one below it, and an ambiguity that
-- resolves on the type of an untyped literal is a call that works until
-- somebody writes it differently.
-- ---------------------------------------------------------------------------

create or replace function preferred_languages(p_language text, p_company_id uuid)
returns text[]
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select array_remove(array[
    p_language,
    (select c.language from companies c where c.id = p_company_id),
    (select d.language_default
       from companies c join country_defaults d on d.country = c.country
      where c.id = p_company_id)
  ], null);
$$;

comment on function preferred_languages(text, uuid) is
  'The languages to try, in order, from a starting point the caller names: that one, then the company''s, then the one the country pack declares. Feed it to label_for(). The starting point is a person''s preference for a reader who is signed in, and documents.language for a document being rendered.';

-- The published form, now one line on top of the one above. A signed-in
-- reader's preference is a starting point like any other; what was specific to
-- it was never the chain, only where the chain began.
create or replace function preferred_languages(p_company_id uuid default null)
returns text[]
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select preferred_languages(
    (select p.language from user_preferences p where p.user_id = auth.uid()),
    p_company_id);
$$;

comment on function preferred_languages(uuid) is
  'The languages to try, in order: the signed-in user''s own, then the company''s, then the one the country pack declares. The particular case of preferred_languages(language, company) where the starting point comes from the session.';

-- ---------------------------------------------------------------------------
-- 2. The column
--
-- `char(2)`, which is what `contacts.language` and `companies.language` are: a
-- language here is ISO 639-1, two characters by definition, and the padding
-- that made `char(2)` wrong for a VAT category cannot happen to a value that
-- is always exactly two long.
--
-- Not null, once the backfill below has filled what exists. A document that
-- did not know its own language is the thing this migration exists to remove,
-- and a nullable column would leave every reader with a coalesce to write —
-- which is the chain, written a third time, in as many places as there are
-- renderers.
-- ---------------------------------------------------------------------------

alter table documents
  add column if not exists language char(2);

comment on column documents.language is
  'The language this document is written in: its legal mentions, and whatever a renderer prints from the labels of the schema. Taken from the customer, else the company, else the country pack when the document is created, kept in step while it is a draft, and frozen the moment it is posted — a document already sent is not rewritten because its customer later changed preference.';

-- ---------------------------------------------------------------------------
-- 3. What the documents already here were written in
--
-- The same chain, applied once. It is a guess and it is worth saying so: for a
-- document already sent, nobody knows what language the PDF in the customer's
-- inbox was in — the only evidence the installation holds is the chain, which
-- is what produced that PDF at the time unless somebody has since changed a
-- preference. This is the best thing that can be said about a past document,
-- and from here on nothing is guessed.
-- ---------------------------------------------------------------------------

update documents d
   set language = (preferred_languages(ct.language, d.company_id))[1]
  from contacts ct
 where ct.id = d.contact_id
   and d.language is null;

alter table documents
  alter column language set not null;

-- ---------------------------------------------------------------------------
-- 4. Writing it, and refusing to rewrite it
--
-- One function on both events, because it is one rule read twice: the language
-- of a document is the chain's answer until the document is posted, and the
-- document's own afterwards.
--
--   on insert   the caller's value stands; where there is none, the chain
--               answers. `contact_id` is not null on this table, so there is
--               always a customer to start from.
--   on update   a draft may be given another language by hand, and follows the
--               chain again when the customer under it changes. A document
--               that is no longer a draft keeps the language it was sent in,
--               and says so by name.
--
-- `cancelled` is not a draft either. A cancelled invoice was sent before it
-- was cancelled, and the credit note that undoes it quotes it.
-- ---------------------------------------------------------------------------

create or replace function documents_guard_language()
returns trigger
language plpgsql
as $$
declare
  v_contact_language text;
begin
  if tg_op = 'INSERT' then
    if new.language is null then
      select ct.language into v_contact_language
        from contacts ct where ct.id = new.contact_id;
      new.language := (preferred_languages(v_contact_language, new.company_id))[1];
    end if;
    return new;
  end if;

  if old.state <> 'draft' then
    if new.language is distinct from old.language then
      raise exception 'document_language_frozen: % was sent in %, so it stays in %. A document already issued is not rewritten because its customer changed preference; issue the new one in the new language.',
        coalesce(new.number, old.number, new.id::text), old.language, old.language
        using errcode = '55006';
    end if;
    return new;
  end if;

  -- A draft whose customer changes follows the new customer, unless the same
  -- statement names a language itself.
  if new.contact_id is distinct from old.contact_id
     and new.language is not distinct from old.language then
    select ct.language into v_contact_language
      from contacts ct where ct.id = new.contact_id;
    new.language := (preferred_languages(v_contact_language, new.company_id))[1];
  end if;

  return new;
end;
$$;

comment on function documents_guard_language() is
  'Fills documents.language from the customer, then the company, then the country pack when a document is created, keeps a draft in step with the customer it is addressed to, and refuses document_language_frozen on anything that is no longer a draft.';

create trigger documents_guard_language
  before insert or update on documents
  for each row execute function documents_guard_language();

-- A trigger body is invoked by its table, never called.
revoke execute on function documents_guard_language() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. A customer who changes language, and the drafts addressed to them
--
-- The other half of "a draft follows the chain": the chain moves when the
-- customer moves, and a draft that is not touched again would keep an answer
-- that is no longer the chain's. Bounded to drafts of that one customer, and
-- to the one column — `documents_contact_idx` is the index it reads.
--
-- `security definer`, and the reason is worth writing down: the caller is
-- somebody editing a contact, and editing a contact is `contacts.write`, which
-- is not `documents.write`. A member allowed to correct a customer's record
-- should not be refused because a draft of theirs sits behind a policy the
-- member does not satisfy, and should not thereby gain the right to write a
-- document either. What this function writes is derived data, in one column,
-- on rows nothing has issued yet.
-- ---------------------------------------------------------------------------

create or replace function contacts_language_reaches_drafts()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update documents d
     set language = (preferred_languages(new.language, d.company_id))[1]
   where d.contact_id = new.id
     and d.state = 'draft'
     and d.language is distinct from (preferred_languages(new.language, d.company_id))[1];
  return null;
end;
$$;

comment on function contacts_language_reaches_drafts() is
  'A customer who changes language changes the drafts addressed to them, and nothing else: a posted document keeps the language it was sent in.';

create trigger contacts_language_reaches_drafts
  after update of language on contacts
  for each row
  when (new.language is distinct from old.language)
  execute function contacts_language_reaches_drafts();

revoke execute on function contacts_language_reaches_drafts() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. The sentences, in the language of the document they are on
--
-- `document_legal_mentions` handed back `text` — the pack's own wording — and
-- `text_i18n` beside it, and left the choice of a language to whoever read it.
-- There was one reader, and it chose from the contact of the day.
--
-- The view is about a document, so it answers in the document's language, and
-- `language` is published beside the sentence so that a reader can see which
-- one it picked. `label_for` is fed the whole chain rather than the one
-- language, so a pack that has not translated a mention into the customer's
-- language falls back to the company's and then to its own wording instead of
-- printing nothing — which is what `label_for` was built to do.
--
-- `text_i18n` stays. A renderer printing a bilingual invoice — which several
-- countries' customers ask for — has every language of the pack in it and does
-- not have to go back to the templates for the second one.
--
-- Dropped and recreated rather than replaced: a column moves, and `create or
-- replace view` may only add at the end. The grants the drop takes away are
-- given back by name in section 8, which is the arrangement
-- `20260915174500` used for the same reason.
-- ---------------------------------------------------------------------------

drop view if exists document_legal_mentions;

create view document_legal_mentions
  with (security_invoker = true) as
  with document_taxes as (
    select d.id             as document_id,
           d.company_id,
           c.fiscal_country as country,
           d.document_date,
           d.doc_type,
           d.language,
           coalesce(
             array_agg(distinct t.treatment::text) filter (where t.treatment is not null),
             array[]::text[]
           )                                 as treatments,
           coalesce(bool_or(t.cash_basis), false) as on_cash_basis
      from documents d
      join companies c           on c.id = d.company_id
      left join document_lines l on l.document_id = d.id
      left join taxes t          on t.id = l.tax_id
     group by d.id, d.company_id, c.fiscal_country, d.document_date, d.doc_type, d.language
  )
  select dt.document_id,
         dt.company_id,
         m.country,
         m.code,
         m.applies_when,
         dt.language,
         label_for(m.text, m.text_i18n,
                   preferred_languages(dt.language, dt.company_id)) as text,
         m.text_i18n,
         m.sequence,
         m.legal_reference
    from document_taxes dt
    join legal_mention_templates m
      on m.country = dt.country
     and m.valid_from <= dt.document_date
     and (m.valid_to is null or m.valid_to >= dt.document_date)
   where case m.applies_when
           when 'always'            then true
           when 'reverse_charge'    then dt.treatments
                                         && array['domestic_reverse_charge',
                                                  'foreign_services_received',
                                                  'intracom_triangular']
           when 'intra_eu_goods'    then dt.treatments && array['intracom_goods', 'intracom_acquisition_goods']
           when 'intra_eu_services' then dt.treatments && array['intracom_services', 'intracom_acquisition_services']
           when 'export'            then dt.treatments && array['export']
           when 'exempt'            then dt.treatments && array['exempt']
           when 'cash_basis'        then dt.on_cash_basis
           when 'late_payment'      then dt.doc_type in ('sale_invoice', 'sale_credit_note')
           else false
         end;

comment on view document_legal_mentions is
  'The legal mentions that apply to a document, each in the language the document was written in: its country, the validity of the mention on its date, and the treatments of the taxes its lines carry. A reverse-charge mention comes out for a domestic reverse charge, for a service received from a supplier who is not established here, and for the middle supply of a triangular arrangement — three articles behind one sentence, which is that the customer owes the tax. A small_business mention never comes out, because no column records the regime.';

-- ---------------------------------------------------------------------------
-- 7. The header a renderer reads once
--
-- It already carried everything printed above the lines except the one thing
-- that decides how the rest of it is worded. Appended at the end, which is
-- what `create or replace view` allows and what keeps the grants and the
-- comment of the object it replaces.
-- ---------------------------------------------------------------------------

create or replace view document_header
  with (security_invoker = true) as
  select d.id                             as document_id,
         d.company_id,
         d.doc_type,
         d.state,
         d.payment_state,
         d.number,
         d.supplier_reference,
         d.document_date,
         d.accounting_date,
         d.due_date,
         d.delivery_date,
         d.currency_code,
         d.amount_untaxed,
         d.amount_tax,
         d.amount_total,
         d.amount_paid,
         d.amount_residual,
         d.payment_terms,
         d.payment_means_code,
         d.payment_reference,
         d.buyer_reference,
         d.order_reference,
         d.contract_reference,
         d.project_reference,
         d.note,
         coalesce(d.payee_iban, seller_bank.iban) as payee_iban,
         seller_bank.bic                          as payee_bic,

         -- The seller: this company.
         coalesce(c.trade_name, c.name)   as seller_name,
         c.legal_name                     as seller_legal_name,
         c.legal_form                     as seller_legal_form,
         c.vat_number                     as seller_vat_number,
         c.registration_number            as seller_registration_number,
         c.address_line1                  as seller_address_line1,
         c.address_line2                  as seller_address_line2,
         c.postal_code                    as seller_postal_code,
         c.city                           as seller_city,
         c.country                        as seller_country,
         c.region                         as seller_region,
         c.email                          as seller_email,
         c.phone                          as seller_phone,
         c.website                        as seller_website,
         c.logo_url                       as seller_logo_url,
         c.share_capital                  as seller_share_capital,
         c.share_capital_currency         as seller_share_capital_currency,
         c.activity_code                  as seller_activity_code,
         c.activity_scheme                as seller_activity_scheme,
         c.document_template,

         -- The buyer: the contact the document is written against.
         ct.id                            as buyer_id,
         ct.name                          as buyer_name,
         ct.vat_number                    as buyer_vat_number,
         ct.registration_number           as buyer_registration_number,
         ct.address_line1                 as buyer_address_line1,
         ct.address_line2                 as buyer_address_line2,
         ct.postal_code                   as buyer_postal_code,
         ct.city                          as buyer_city,
         ct.country                       as buyer_country,
         ct.region                        as buyer_region,
         ct.email                         as buyer_email,

         -- What the country of the document requires. Its country is the
         -- company's fiscal_country — the country whose VAT rules apply — and
         -- not its address, which is the same distinction
         -- document_legal_mentions makes.
         c.fiscal_country                 as country,
         cd.number_format,
         cd.numbering_gapless,
         cd.legal_payment_days,
         cd.late_payment_reference,
         cd.tax_point_rule,
         cd.einvoice_profile,
         cd.einvoice_mandatory_from,
         cd.party_scheme,
         cd.vat_scheme,

         -- What the document is written in. Not the reader's preference and
         -- not the customer's of today: the document's own, as of the day it
         -- was issued.
         d.language
    from documents d
    join companies c                on c.id = d.company_id
    join contacts ct                on ct.id = d.contact_id
    left join bank_accounts seller_bank on seller_bank.id = c.default_bank_account_id
    left join country_defaults cd   on cd.country = c.fiscal_country;

comment on view document_header is
  'One document with everything printed above its lines: the seller, the buyer, the amounts, where it is paid, what its country requires and the language it is written in. The lines are document_line_items and the sentences are document_legal_mentions.';

-- ---------------------------------------------------------------------------
-- 8. The document behind a link, in the language it was written in
--
-- `shared_document()` as `20260915153000` published it, with one paragraph
-- gone: the two-column chain it resolved on every read. The document carries
-- its language now, and the sentences come out of the view already in it, so
-- what is left is a read of a column and a read of a view — and the second
-- place a language was chosen in this schema is no longer there.
--
-- Everything else is that function unchanged, republished because a function
-- is replaced whole.
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
      -- The document's own, snapshotted when it was created and frozen when it
      -- was posted. A customer who has since changed preference does not
      -- change what was sent to them.
      'language',          v_doc.language,
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
               'text', lm.text)
               order by lm.sequence, lm.code)
        from document_legal_mentions lm
       where lm.document_id = v_doc.id), '[]'::jsonb)
  );

  return v_payload;
end;
$$;

comment on function shared_document(text) is
  'One document, read by whoever holds its link: the header, the lines, the tax breakdown, the totals, the legal mentions in the language the document was written in, and what is still owed today. Returns null — the same null, in the same shape — for a token that is unknown, withdrawn, expired, or onto a document that may no longer be shared.';

-- ---------------------------------------------------------------------------
-- 9. Grants
--
-- The rule of `supabase/migrations/README.md`: the schema closes behind itself
-- and then says, by name, who may reach what. The dropped view takes its
-- privileges with it and gets them back here, to exactly who held them before.
-- `anon` gains nothing: not the view, not the overload. What an anonymous
-- reader reaches is still one `security definer` function, which reads both as
-- its owner.
-- ---------------------------------------------------------------------------

revoke execute on all functions in schema public from public;

revoke all on table document_legal_mentions from public, anon;
grant select on table document_legal_mentions to authenticated, service_role;

revoke execute on function preferred_languages(text, uuid) from public, anon;
grant execute on function preferred_languages(text, uuid) to authenticated, service_role;

revoke execute on function preferred_languages(uuid) from public, anon;
grant execute on function preferred_languages(uuid) to authenticated, service_role;

revoke execute on function shared_document(text) from public;
grant execute on function shared_document(text) to anon, authenticated, service_role;
