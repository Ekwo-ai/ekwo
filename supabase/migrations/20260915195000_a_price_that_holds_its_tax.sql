-- Ekwo OS — a price that already holds its tax.
--
-- `taxes.price_include` has been a column since the tax engine landed on
-- 12 September and has never been read. The note beside it said the
-- gross-to-net computation "arrives with the country that needs it", and the
-- United Kingdom is that country: a retail price there is quoted with the VAT
-- in it as a matter of course, and VAT Notice 700 publishes the fraction that
-- takes it back out — the rate over one hundred plus the rate, one sixth at
-- 20 per cent. Australia, Canada and most of what a shop sells to a consumer
-- anywhere work the same way. Until now a line carrying such a tax was booked
-- with the tax added *on top* of the price the customer had already paid, so
-- a till roll of 7 401,32 became an invoice of 8 881,58.
--
-- What an invoice has to say is not negotiable. EN 16931 states the line net
-- amount in BT-131 and the taxable amount of each group in BT-116, both
-- excluding the tax, and BR-CO-14 requires the tax of a group to be the
-- rounded figure of that one group and not a sum of line roundings. So the
-- gross price is an input, never an output: it is converted, once, per tax
-- group, and what the document stores is the net.
--
-- **The rule.** For every tax group of a document whose tax prices with the
-- tax in it:
--
--     gross = sum of the lines, each quantity x unit price less its discount
--     tax   = round(gross - gross / (1 + rate/100))     once, at the currency
--     base  = gross - tax
--
-- and `base` is then shared over the lines of the group in proportion to their
-- gross, the last line of the group taking whatever is left. That is the
-- technique `post_document` already uses to share a `tax_on_base` over the
-- accounts it lands on, and it is used here for the same reason: the shares
-- have to add up to the figure that was rounded once, or the invoice does not
-- foot.
--
-- **Why the base is subtracted rather than computed.** `base = gross x 100 /
-- (100 + rate)` rounded on its own, with the tax rounded on its own beside it,
-- gives a pair that misses the gross by a unit often enough to notice: at
-- 20 per cent, one price in about fifty. Subtracting makes `base + tax =
-- gross` true by construction, which is the one thing a retail customer can
-- check by looking at the receipt in their hand. HMRC's VAT Notice 700,
-- §§ 17.5 and 17.6, admits two rounding methods to a retailer — line by line
-- or invoice by invoice — and this is the second, which is also the one
-- BR-CO-14 requires of a European invoice. Nothing here invents a word for the
-- choice: `rounding_method` is the *arithmetic* of a country, not the unit the
-- arithmetic is applied to, and a pack that had to declare "per line" would be
-- declaring an invoice that fails validation. The gap, where a country really
-- does allow a trader to choose, is written up in `docs/international.md`.
--
-- **Why the tax cannot be re-derived from the base.** `document_tax_summary`
-- computed the tax of every group as `round(base x rate / 100)`. Applied to a
-- base that came out of the subtraction above, that answer is not always the
-- tax that produced it: 99,99 at 20 per cent gives a tax of 16,67 and a base of
-- 83,32, and 83,32 at 20 per cent rounds back to 16,66 — a penny short, and a
-- total of 99,98 against a price of 99,99. So the view computes the tax of an
-- inclusive group from the gross it was quoted at, and of every other group
-- exactly as before. No figure of any existing pack moves by a cent.
--
-- **Two columns on the line, and why they are columns.**
--
--   * `unit_price_includes_tax` is a snapshot, taken from the tax while the
--     document is a draft and frozen when it is posted — the rule BT-151 and
--     BT-152 already follow. A pack upgrade that turns the flag on a tax must
--     not rewrite an invoice somebody has already sent. It is *derived* and
--     never keyed, because it is a fact about the tax and not a choice of the
--     line.
--   * `amount_incl_tax` keeps the gross the line was quoted at, which is the
--     only figure a retailer recognises and the only one the conversion can be
--     redone from. Null on every line whose price excludes the tax, so the
--     column says which world it is in rather than holding a copy of
--     `amount_untaxed`.
--
-- **Where the arithmetic runs.** `document_lines.amount_untaxed` stays the
-- truth and stays derived. Its `before` trigger cannot see the other lines of
-- the group, so it writes what one line on its own comes to — which *is* the
-- group's answer when the group has one line, the ordinary retail case — and
-- the `after` trigger that already refreshes the document's totals shares the
-- group's base over the group first. The share is written only where it
-- differs, so the write that corrects a line does not start again.
--
-- **Three refusals, each by name and each as early as it can be made.**
--
--   * A fixed-amount tax cannot price with the tax in it: there is no rate to
--     divide by, and "the price includes 0,50" is a discount, not a tax. A
--     check constraint on `taxes` and on `tax_templates` refuses it, and
--     `ekwo pack check` refuses it before a seed is written.
--   * A line whose price includes a tax has to have a tax. A check constraint
--     on `document_lines`.
--   * A tax group cannot be half inclusive. The only way to build one is to
--     turn the flag on a tax between two line writes of the same draft;
--     `mixed_price_include` says so where it happens, rather than letting a
--     document be posted whose gross and net lines were added together.

-- ---------------------------------------------------------------------------
-- 1. A price that includes a tax needs a rate to take it back out
-- ---------------------------------------------------------------------------

alter table taxes
  add constraint taxes_price_include_needs_a_rate
  check (not price_include or amount_type = 'percent');

alter table tax_templates
  add constraint tax_templates_price_include_needs_a_rate
  check (not price_include or amount_type = 'percent');

comment on column taxes.price_include is
  'The unit price of a line carrying this tax is the gross price: the engine takes the tax out of it per group rather than adding it on top. Only a percentage tax may say so.';

comment on column tax_templates.price_include is
  'The unit price of a line carrying this tax is the gross price. Compiled from the pack and copied onto the tax a company installs.';

-- ---------------------------------------------------------------------------
-- 2. What the line keeps
-- ---------------------------------------------------------------------------

alter table document_lines
  add column if not exists unit_price_includes_tax boolean not null default false,
  add column if not exists amount_incl_tax         numeric(16, 2);

comment on column document_lines.unit_price_includes_tax is
  'The unit price of this line was quoted with the tax in it. Derived from the tax while the document is a draft and frozen when it is posted, like BT-151 and BT-152, so a later change to the tax cannot rewrite an invoice that has been sent.';

comment on column document_lines.amount_incl_tax is
  'quantity x unit_price less the discount, tax included, as the line was quoted. Null where the price excludes the tax, which is every line of every pack but a retail one.';

alter table document_lines
  add constraint document_lines_included_tax_needs_a_tax
  check (not unit_price_includes_tax or tax_id is not null);

-- ---------------------------------------------------------------------------
-- 3. The line derives its own amounts
--
-- Same trigger, same name, one more thing to work out. Three cases:
--
--   * not a product line — nothing is billed and nothing is quoted;
--   * a price that excludes the tax — what the trigger has always done;
--   * a price that includes it — the gross is kept and the net is what this
--     line alone comes to. `documents_allocate_included_tax()` then replaces
--     that provisional with the line's share of a base rounded once on the
--     group. Where the group has one line the two are the same figure, which
--     is why the provisional is this and not the gross: a line that never
--     reached the allocator is out by at most one unit of the currency,
--     instead of out by the whole tax.
--
-- The provisional is recomputed only when the gross moved. That is what lets
-- the allocator write a share back through this trigger without it being
-- overwritten on the way in.
-- ---------------------------------------------------------------------------

create or replace function document_lines_amount_untaxed()
returns trigger
language plpgsql
as $$
declare
  v_company  uuid;
  v_currency char(3);
  v_state    doc_state;
  v_round    money_rounding;
  v_gross    numeric;
  v_rate     numeric;
begin
  if new.line_type <> 'product' then
    new.amount_untaxed          := 0;
    new.amount_incl_tax         := null;
    new.unit_price_includes_tax := false;
    return new;
  end if;

  -- Read in two steps: `select f(x) into a_composite` would assign the whole
  -- row to the first field of the target, which is a trap plpgsql lays for
  -- every function that returns a composite.
  select d.company_id, d.currency_code, d.state
    into v_company, v_currency, v_state
    from documents d where d.id = new.document_id;
  v_round := rounding_of(v_company, v_currency);

  -- The snapshot. Taken from the tax for as long as the document is a draft,
  -- and left alone from the moment it is posted.
  if tg_op = 'INSERT' or v_state = 'draft' then
    new.unit_price_includes_tax :=
      coalesce((select t.price_include from taxes t where t.id = new.tax_id), false);
  end if;

  v_gross := round_amount(
    new.quantity * new.unit_price * (1 - new.discount_percent / 100), v_round);

  if not new.unit_price_includes_tax then
    new.amount_incl_tax := null;
    new.amount_untaxed  := v_gross;
    return new;
  end if;

  new.amount_incl_tax := v_gross;
  if tg_op = 'INSERT'
     or not old.unit_price_includes_tax
     or old.amount_incl_tax is distinct from v_gross then
    select t.amount into v_rate from taxes t where t.id = new.tax_id;
    if coalesce(v_rate, 0) <= -100 then
      raise exception 'unsupported_included_rate: a price cannot include a tax of % per cent', v_rate;
    end if;
    new.amount_untaxed :=
      v_gross - round_amount(v_gross - v_gross / (1 + coalesce(v_rate, 0) / 100), v_round);
  end if;
  return new;
end;
$$;

comment on function document_lines_amount_untaxed() is
  'Derives a line''s amounts from its quantity, price and discount, rounded once at the decimals of the document''s currency: the net, the gross where the price includes the tax, and the snapshot of whether it does.';

-- ---------------------------------------------------------------------------
-- 4. The group is the unit of the rounding
--
-- One pass per tax group of the document whose lines are quoted with the tax
-- in them. The tax is rounded once on the gross of the group (BR-CO-14), the
-- base is the gross less that tax — so the two add back to the price that was
-- quoted, always — and the base is shared over the lines in proportion to
-- their gross, the last of them taking the remainder.
--
-- It writes each share only where it differs from what is stored. That is not
-- on its own enough to stop the loop it would otherwise start — the share goes
-- back through the `before` trigger and the column's own scale can round it, so
-- the comparison never settles in a currency with three decimals — which is why
-- the trigger below it allocates on the outermost write only.
-- ---------------------------------------------------------------------------

create or replace function documents_allocate_included_tax(p_document_id uuid)
returns void
language plpgsql
as $$
declare
  v_company  uuid;
  v_currency char(3);
  v_round    money_rounding;
  v_gross    numeric;
  v_tax      numeric;
  v_base     numeric;
  v_left     numeric;
  v_share    numeric;
  v_group    record;
  v_line     record;
begin
  -- The ordinary case, and the one this has to cost nothing in: a document
  -- with no line quoted with its tax in it.
  if not exists (
    select 1 from document_lines dl
     where dl.document_id = p_document_id
       and dl.line_type = 'product'
       and dl.unit_price_includes_tax
  ) then
    return;
  end if;

  select d.company_id, d.currency_code into v_company, v_currency
    from documents d where d.id = p_document_id;
  if not found then
    return;
  end if;
  v_round := rounding_of(v_company, v_currency);

  for v_group in
    select dl.tax_id,
           max(t.code)                          as tax_code,
           max(t.amount)                        as rate,
           bool_and(dl.unit_price_includes_tax) as all_inclusive,
           coalesce(sum(dl.amount_incl_tax), 0) as gross
      from document_lines dl
      join taxes t on t.id = dl.tax_id
     where dl.document_id = p_document_id
       and dl.line_type = 'product'
     group by dl.tax_id
    having bool_or(dl.unit_price_includes_tax)
     order by 1
  loop
    -- Half a group is not a group. The only way to build one is to change the
    -- tax between two line writes of the same draft, and adding a gross line
    -- to a net one would produce a base nobody can explain.
    if not v_group.all_inclusive then
      raise exception 'mixed_price_include: tax % prices some lines of document % with the tax in them and others without',
        v_group.tax_code, p_document_id;
    end if;
    if coalesce(v_group.rate, 0) <= -100 then
      raise exception 'unsupported_included_rate: a price cannot include a tax of % per cent', v_group.rate;
    end if;

    v_gross := v_group.gross;
    v_tax   := round_amount(v_gross - v_gross / (1 + coalesce(v_group.rate, 0) / 100), v_round);
    v_base  := v_gross - v_tax;
    v_left  := v_base;

    for v_line in
      select dl.id,
             coalesce(dl.amount_incl_tax, 0)                 as gross,
             row_number() over (order by dl.sequence, dl.id)
               = count(*) over ()                            as is_last
        from document_lines dl
       where dl.document_id = p_document_id
         and dl.line_type = 'product'
         and dl.tax_id = v_group.tax_id
       order by dl.sequence, dl.id
    loop
      if v_line.is_last then
        v_share := v_left;
      else
        v_share := case when v_gross = 0 then 0
                        else round_amount(v_base * v_line.gross / v_gross, v_round) end;
        v_left  := v_left - v_share;
      end if;

      update document_lines
         set amount_untaxed = v_share
       where id = v_line.id
         and amount_untaxed is distinct from v_share;
    end loop;
  end loop;
end;
$$;

comment on function documents_allocate_included_tax(uuid) is
  'Turns the gross of every tax group quoted with the tax in it into a base: the tax rounded once on the group (BR-CO-14), the base the gross less that tax, shared over the lines in proportion to their gross with the remainder on the last. Refuses a group that is half inclusive, by name.';

revoke execute on function documents_allocate_included_tax(uuid) from public, anon;
grant execute on function documents_allocate_included_tax(uuid) to authenticated, service_role;

-- The allocation runs before the totals, because the totals read the bases it
-- writes.
create or replace function document_lines_refresh_totals()
returns trigger
language plpgsql
as $$
begin
  -- The allocator writes its shares back through this same trigger, and what it
  -- wrote is already the answer. Only the outermost write allocates: a second
  -- pass would be work for nothing, and in a currency whose decimals the column
  -- cannot hold — `amount_untaxed` is `numeric(16, 2)`, which is a gap of its
  -- own — a share that comes back rounded would never compare equal and the
  -- two would call each other for ever.
  if pg_trigger_depth() <= 1 then
    perform documents_allocate_included_tax(coalesce(new.document_id, old.document_id));
  end if;
  perform documents_refresh_totals(coalesce(new.document_id, old.document_id));
  return null;
end;
$$;

comment on function document_lines_refresh_totals() is
  'After a line moves: shares out the base of every tax group quoted with its tax in it, then refreshes the three totals of the document.';

-- ---------------------------------------------------------------------------
-- 5. The breakdown reads the gross where there is one
--
-- `base_amount` is unchanged and needs to be: the bases the allocator wrote
-- add up to the group's base exactly. What changes is the tax beside it, for
-- an inclusive group only — computed from the gross the group was quoted at
-- rather than re-derived from the base, for the reason in the header.
-- `tax_charged` keeps its shape: the unrounded tax times the share of it that
-- reaches the other party, rounded once.
-- ---------------------------------------------------------------------------

create or replace view document_tax_summary
  with (security_invoker = true) as
  select l.document_id,
         l.company_id,
         d.doc_type,
         l.tax_id,
         t.code    as tax_code,
         t.name    as tax_name,
         t.vat_category,
         t.amount  as tax_rate,
         sum(l.amount_untaxed) as base_amount,
         -- Gross tax: what the VAT return reports.
         round_amount(
           case when bool_and(l.unit_price_includes_tax)
                then sum(l.amount_incl_tax)
                     - sum(l.amount_incl_tax) / (1 + coalesce(t.amount, 0) / 100)
                else sum(l.amount_untaxed) * coalesce(t.amount, 0) / 100
           end,
           rounding_of(l.company_id, d.currency_code)) as tax_amount,
         -- Charged tax: what the other party actually pays. Zero when the tax
         -- postings net out, which is exactly what self-assessment means.
         round_amount(
           case when bool_and(l.unit_price_includes_tax)
                then sum(l.amount_incl_tax)
                     - sum(l.amount_incl_tax) / (1 + coalesce(t.amount, 0) / 100)
                else sum(l.amount_untaxed) * coalesce(t.amount, 0) / 100
           end
           * coalesce((
               select sum(tp.factor_percent)
                 from tax_postings tp
                where tp.tax_id = t.id
                  and tp.posting_type in ('tax', 'tax_on_base')
                  and tp.document_kind = case
                        when d.doc_type in ('sale_credit_note', 'purchase_credit_note')
                          then 'credit_note'::tax_document_kind
                        else 'invoice'::tax_document_kind
                      end
             ), 100) / 100,
           rounding_of(l.company_id, d.currency_code)) as tax_charged
    from document_lines l
    join documents d on d.id = l.document_id
    left join taxes t on t.id = l.tax_id
   where l.line_type = 'product'
   group by l.document_id, l.company_id, d.doc_type, d.currency_code, l.tax_id,
            t.id, t.code, t.name, t.vat_category, t.amount;

comment on view document_tax_summary is
  'VAT breakdown of a document, one row per tax, rounded once on the group (EN 16931 BR-CO-14) — on the group''s base, or on the gross it was quoted at where the price includes the tax.';

-- ---------------------------------------------------------------------------
-- 6. The line items say which price they are showing
--
-- Two columns are appended: whether this line was quoted with its tax in it,
-- and the gross it was quoted at. A renderer that prints a till receipt needs
-- both, and so does anybody reading a base back to the price it came from.
--
-- `unit_price` keeps its own meaning — the price as it was keyed — and it is
-- therefore no longer BT-146 on a line quoted gross, because BT-146 is the net
-- price. Publishing the net one is a column this view does not get today: the
-- honest definition is the base divided by the quantity, which is the only one
-- that keeps BR-CO-10 true after the group's remainder has landed on a line,
-- and writing it needs a precision that is the *price* column's and not the
-- currency's — which `round_amount` does not express and a cast to
-- `numeric(16, 6)` would smuggle past the rule that there is one place where
-- decimals are decided. That is a gap and it is written up in
-- `docs/international.md` rather than solved by an exception here.
-- ---------------------------------------------------------------------------

create or replace view document_line_items
  with (security_invoker = true) as
  select l.id                          as document_line_id,
         l.document_id,
         l.company_id,
         l.sequence,
         l.line_type,
         l.name                        as item_name,               -- BT-153
         l.description                 as item_description,        -- BT-154
         p.code                        as seller_item_identifier,  -- BT-155
         l.product_id,
         p.kind                        as product_kind,
         l.quantity,                                               -- BT-129
         l.unit_code,                                              -- BT-130
         l.unit_price,                   -- as keyed; gross where the tax is in it
         l.discount_percent,
         l.amount_untaxed,                                         -- BT-131
         l.tax_id,
         l.vat_category,                                           -- BT-151
         l.vat_rate,                                               -- BT-152
         l.account_id,
         t.treatment                   as tax_treatment,
         t.exemption_code              as tax_exemption_code,      -- BT-121
         t.cash_basis                  as tax_cash_basis,
         l.unit_price_includes_tax,
         l.amount_incl_tax
    from document_lines l
    left join products p on p.id = l.product_id
    left join taxes t    on t.id = l.tax_id;

comment on view document_line_items is
  'Document lines with the EN 16931 item terms — BT-153 name, BT-154 description, BT-155 the seller identifier — what decides a legal mention on the line, and, where the price was quoted with the tax in it, the gross it was quoted at. unit_price is the price as keyed, which is that gross: BT-146 is the net price and this view does not publish it yet.';

grant select on table document_tax_summary, document_line_items
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. The invoice behind a link says which price it is showing
--
-- `shared_document()` names every field of a line by hand, so a column added
-- to `document_line_items` does not reach it: a customer following the link to
-- a retail invoice would be shown a `unit_price` that is gross, beside an
-- `amount_untaxed` that is net, with nothing saying which is which. The two
-- fields go into `lines[]` — `unit_price_includes_tax` and `amount_incl_tax`
-- — and a renderer can print a till receipt from the gross or an EN 16931
-- invoice from the net without guessing.
--
-- Everything else is `20260915191200` unchanged, republished because a
-- function is replaced whole. Its grants are restated below because a replaced
-- function keeps the privileges it had and this one is the single door an
-- anonymous reader comes through: saying so again is cheaper than trusting it.
--
-- The order matters and holds: this file recreates `document_line_items`
-- above, then the function that reads it. Between the two migrations nothing
-- is broken either — a function records no dependency on a view, so
-- `20260915191200`'s `shared_document()` kept working against the view as it
-- stood, and reads two more fields only from here on.
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
               -- The price as it was keyed. On a line quoted with the tax
               -- in it that is the gross one, and the two fields below say so
               -- rather than leaving a reader to divide `amount_untaxed` by
               -- the quantity and wonder.
               'unit_price',       li.unit_price::text,
               'unit_price_includes_tax', li.unit_price_includes_tax,
               'discount_percent', li.discount_percent::text,
               'amount_untaxed',   li.amount_untaxed::text,
               'amount_incl_tax',  li.amount_incl_tax::text,
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
  'One document, read by whoever holds its link: the header, the lines with the price as it was keyed and whether that price holds the tax, the tax breakdown, the totals, the legal mentions in the language the document was written in, and what is still owed today. Returns null — the same null, in the same shape — for a token that is unknown, withdrawn, expired, or onto a document that may no longer be shared.';

revoke execute on function shared_document(text) from public;
grant execute on function shared_document(text) to anon, authenticated, service_role;
