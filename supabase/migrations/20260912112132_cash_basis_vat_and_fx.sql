-- Ekwo OS — VAT when the cash moves, and the exchange difference when it settles.
--
-- Two things a country decides that the core could not say yet, and they meet
-- in the same place: the moment a document is settled.
--
-- 1. **A tax that falls due on collection.** `taxes.cash_basis` and
--    `cash_basis_transition_account_id` landed with the tax engine and nothing
--    read them. From here `post_document` books such a tax on the transition
--    account **and on no declaration box**, because nothing is due yet, and
--    the matching moves the settled share to the final account with the box.
--    The share is pro rata of what has been settled, cumulative, so a partial
--    payment carries its part and the last one carries the remainder to the
--    cent. The whole operation waits, base and tax together: a return whose
--    base is declared in one period and whose tax is declared in the next is
--    a return that does not tie out, and the base column of a line is the
--    base *collected*.
--
--    This is not cash accounting as a ledger. Revenue and expense are booked
--    when the document is, which is what every chart in scope expects; only
--    the declaration waits. A cash-basis *report* is derived from matched
--    payments, and stays derived.
--
-- 2. **The exchange difference realised at matching.** A receivable booked at
--    one rate and collected at another leaves a residual in the company's
--    currency that no payment will ever clear. It is a gain or a loss, and it
--    is booked as such on the accounts the pack names, so the third-party
--    account goes to nil. Revaluation of open items — the difference that is
--    not realised, at a closing date — stays out of scope.
--
-- What had to be fixed on the way: **the ledger did not convert**. A document
-- in a foreign currency booked its foreign figures as if they were the
-- company's own, and `entry_lines.amount_currency` — which the FEC exports and
-- which this change needs — was never written by anything. So `post_document`
-- and `post_payment` now book the company's currency in `debit`/`credit` and
-- the document's in `amount_currency`, at the rate the document or the payment
-- carries. There is deliberately no rate feed: the rate is an input, as
-- `documents.exchange_rate` has been since the first migration.

-- ---------------------------------------------------------------------------
-- Where an exchange difference lands
--
-- Two columns, nullable, with no default. A country that has not named them
-- gets a refusal the day a difference actually arises, and never somebody
-- else's account: an exchange gain sits in the financial income of the chart
-- the company keeps, and that number is a fact about a chart, not a constant.
-- ---------------------------------------------------------------------------

alter table country_defaults
  add column if not exists fx_gain_code text,
  add column if not exists fx_loss_code text;

comment on column country_defaults.fx_gain_code is
  'Account a realised exchange gain is booked on, from the pack. Null until the pack names one, and then a matching that realises a gain is refused rather than booked somewhere plausible.';
comment on column country_defaults.fx_loss_code is
  'The same for a realised loss. A pair, because every chart in scope keeps the gain and the loss apart.';

-- ---------------------------------------------------------------------------
-- The rate a payment was made at
--
-- `documents.exchange_rate` has existed since the first migration and nothing
-- read it. A payment had no equivalent at all, and without one a payment in a
-- foreign currency cannot differ from the invoice — which is the entire
-- subject. Same convention on both, stated here once.
-- ---------------------------------------------------------------------------

alter table payments
  add column if not exists exchange_rate numeric(18, 8) not null default 1;

alter table payments
  drop constraint if exists payments_rate_positive;
alter table payments
  add constraint payments_rate_positive check (exchange_rate > 0);

comment on column payments.exchange_rate is
  'Units of the payment currency for one unit of the company currency, as currency_rates states it. The ledger amount is the payment amount divided by it. 1 when the payment is in the company currency.';
comment on column documents.exchange_rate is
  'Units of the document currency for one unit of the company currency, as currency_rates states it. The ledger amount is the document amount divided by it. 1 when the document is in the company currency.';
comment on column entry_lines.amount_currency is
  'The amount of this line in its own currency, written whenever that currency is not the company''s. Positive like debit and credit; the side carries the sign.';
comment on column entry_lines.box_amount is
  'Amount to report in that box, in the sign the form expects. A line of a cash-basis tax carries the amount with no box: it is computed when the document is posted and waits for the matching that names the box it is finally reported in.';

-- ---------------------------------------------------------------------------
-- What a matching had to book
--
-- A matching is not supposed to touch the accounts — that is the sentence the
-- MCP server prints when it undoes one. It stays true of the matching itself
-- and stops being true of what a matching *reveals*: a tax that falls due, a
-- difference that is realised. Both are entries of their own, and the row that
-- caused them says so, so a client can show them and `unreconcile` can find
-- them.
-- ---------------------------------------------------------------------------

alter table reconciliations
  add column if not exists fx_entry_id           uuid references entries(id) on delete set null,
  add column if not exists tax_transfer_entry_id uuid references entries(id) on delete set null;

comment on column reconciliations.fx_entry_id is
  'Entry that booked the exchange difference this matching realised, when there was one.';
comment on column reconciliations.tax_transfer_entry_id is
  'Entry that moved the cash-basis tax this matching made due, when there was one.';

create index if not exists reconciliations_fx_entry_idx on reconciliations (fx_entry_id);
create index if not exists reconciliations_tax_entry_idx on reconciliations (tax_transfer_entry_id);

-- ---------------------------------------------------------------------------
-- What a document has been settled by, when it is not in the company currency
--
-- `amount_paid` is compared with `amount_total`, which is the document's own
-- currency, and it was summing `matched_amount`, which is the ledger's. The
-- two were the same number as long as nothing converted. Now that something
-- does, the settled share is read back through the currency amount of the line
-- it was matched on. A line with no currency amount contributes what it always
-- did, so a document in the company's currency answers exactly as before.
-- ---------------------------------------------------------------------------

create or replace function documents_refresh_amount_paid(p_document_id uuid)
returns void
language plpgsql
as $$
begin
  -- The statement names amount_paid so that documents_refresh_payment_state,
  -- which watches that column, fires in turn.
  update documents d
     set amount_paid = coalesce((
           select sum(case
                        when l.amount_currency is null then l.matched_amount
                        else round(l.matched_amount * l.amount_currency
                                   / nullif(abs(l.debit - l.credit), 0), 2)
                      end)
             from entry_lines l
             join accounts a on a.id = l.account_id
            where l.entry_id = d.entry_id
              and a.reconcilable
              and a.account_type in ('asset_receivable', 'liability_payable')
         ), 0)
   where d.id = p_document_id
     and d.entry_id is not null;
end;
$$;

-- ---------------------------------------------------------------------------
-- post_document — the same function, converting, and deferring what is not due
--
-- Three changes, and nothing else moves:
--
--   * every amount is worked out in the document's currency exactly as
--     before, then divided by the rate to give the ledger amount. At a rate
--     of 1 the division is the identity, which is why `posting.test.ts` is
--     untouched and green.
--   * the counterpart still balances by construction, in both currencies; the
--     total it is checked against is the one in the document's currency,
--     which is the currency `documents.amount_total` is stated in.
--   * a tax on a cash basis lands on its transition account and names no box,
--     and so does the base it is computed on. The box amount is worked out
--     here all the same and waits on the line: it is what the matching will
--     report, pro rata, and working it out twice is how two answers appear.
-- ---------------------------------------------------------------------------

create or replace function post_document(p_document_id uuid)
returns entries
language plpgsql
as $$
declare
  v_doc        documents%rowtype;
  v_entry      entries%rowtype;
  v_journal    uuid;
  v_date       date;
  v_is_sale    boolean;
  v_is_credit  boolean;
  v_kind       tax_document_kind;
  v_base_credit boolean;
  v_seq        integer := 0;
  v_contact    uuid;
  v_maturity   date;
  v_terms      smallint;
  v_counterpart uuid;
  v_diff       numeric(16, 2);
  v_diff_cur   numeric(16, 2);
  v_amount     numeric(16, 2);
  v_book       numeric(16, 2);
  v_box_amount numeric(16, 2);
  v_share      numeric(16, 2);
  v_share_book numeric(16, 2);
  v_share_box  numeric(16, 2);
  v_left       numeric(16, 2);
  v_left_box   numeric(16, 2);
  v_side_left     numeric(16, 2);
  v_side_left_neg numeric(16, 2);
  v_side_credit boolean;
  v_label      text;
  v_rate       numeric(18, 8);
  v_home       char(3);
  v_foreign    boolean;
  v_total_cur  numeric(16, 2);
  v_cash       boolean;
  v_transition uuid;
  v_postings   integer;
  r            record;
  p            record;
  g            record;
begin
  select * into v_doc from documents where id = p_document_id for update;
  if not found then
    raise exception 'unknown_document: document % does not exist', p_document_id;
  end if;
  if v_doc.state = 'posted' then
    raise exception 'document_already_posted: document % is already posted', p_document_id;
  end if;
  if v_doc.state = 'cancelled' then
    raise exception 'document_cancelled: document % cannot be posted', p_document_id;
  end if;
  if v_doc.entry_id is not null then
    raise exception 'document_already_booked: document % already points at entry %',
      p_document_id, v_doc.entry_id;
  end if;

  if v_doc.doc_type in ('sale_quote', 'purchase_order') then
    raise exception 'document_not_accountable: a % is not booked', v_doc.doc_type;
  end if;

  v_is_sale   := v_doc.doc_type in ('sale_invoice', 'sale_credit_note');
  v_is_credit := v_doc.doc_type in ('sale_credit_note', 'purchase_credit_note');
  v_kind      := case when v_is_credit then 'credit_note' else 'invoice' end::tax_document_kind;
  -- Sale invoice and purchase credit note credit the base; the other two debit it.
  v_base_credit := (v_is_sale <> v_is_credit);

  v_date := coalesce(v_doc.accounting_date, v_doc.document_date);

  if not exists (
    select 1 from document_lines
     where document_id = p_document_id and line_type = 'product' and amount_untaxed <> 0
  ) then
    raise exception 'document_empty: document % has no billable line', p_document_id;
  end if;

  -- A fixed-amount tax has no basis to spread over lines; refuse rather than
  -- guess.
  if exists (
    select 1 from document_lines l join taxes t on t.id = l.tax_id
     where l.document_id = p_document_id and t.amount_type <> 'percent'
  ) then
    raise exception 'unsupported_tax_amount_type: only percentage taxes can be posted';
  end if;

  -- Every tax used must be in force on the accounting date.
  for r in
    select distinct t.id, t.code, t.valid_from, t.valid_to
      from document_lines l join taxes t on t.id = l.tax_id
     where l.document_id = p_document_id
  loop
    if v_date < r.valid_from or (r.valid_to is not null and v_date > r.valid_to) then
      raise exception 'tax_not_in_force: tax % is not applicable on %', r.code, v_date;
    end if;
  end loop;

  -- Totals are derived; make sure they reflect the lines as they stand now.
  perform documents_refresh_totals(p_document_id);
  select * into v_doc from documents where id = p_document_id;

  select c.currency_code into v_home from companies c where c.id = v_doc.company_id;
  v_rate    := v_doc.exchange_rate;
  v_foreign := v_doc.currency_code <> v_home;

  v_journal := coalesce(
    v_doc.journal_id,
    case when v_is_sale
      then (select sales_journal_id from companies where id = v_doc.company_id)
      else (select purchase_journal_id from companies where id = v_doc.company_id)
    end
  );
  if v_journal is null then
    raise exception 'no_journal: set journal_id on the document or a default journal on the company';
  end if;

  perform assert_period_open(v_doc.company_id, v_date, true);

  v_label := coalesce(v_doc.number, v_doc.supplier_reference, 'document');

  insert into entries (company_id, journal_id, fiscal_year_id, entry_date, reference,
                       description, state, document_id, currency_code)
  values (v_doc.company_id, v_journal, fiscal_year_at(v_doc.company_id, v_date), v_date,
          coalesce(v_doc.number, v_doc.supplier_reference),
          v_label || case when v_doc.supplier_reference is not null and v_doc.number is not null
                          then ' / ' || v_doc.supplier_reference else '' end,
          'draft', p_document_id, v_doc.currency_code)
  returning * into v_entry;

  -- ------------------------------------------------------------------ bases
  for r in
    select l.account_id,
           l.tax_id,
           sum(l.amount_untaxed) as base_amount,
           min(l.sequence)       as seq,
           string_agg(distinct l.name, ', ') as label
      from document_lines l
     where l.document_id = p_document_id
       and l.line_type = 'product'
     group by l.account_id, l.tax_id
    having sum(l.amount_untaxed) <> 0
     order by 4
  loop
    select tp.declaration_box, tp.factor_percent, tp.box_factor_percent,
           coalesce(t.cash_basis, false) as cash_basis
      into p
      from tax_postings tp
      join taxes t on t.id = tp.tax_id
     where tp.tax_id = r.tax_id
       and tp.document_kind = v_kind
       and tp.posting_type = 'base'
     limit 1;

    v_amount := round(r.base_amount * coalesce(p.factor_percent, 100) / 100, 2);
    v_book   := round(v_amount / v_rate, 2);
    v_seq := v_seq + 10;

    insert into entry_lines (entry_id, company_id, account_id, sequence, name,
                             debit, credit, tax_id, tax_line,
                             declaration_box, box_amount, currency_code, amount_currency)
    values (v_entry.id, v_doc.company_id, r.account_id, v_seq, left(r.label, 200),
            case when v_base_credit then 0 else v_book end,
            case when v_base_credit then v_book else 0 end,
            r.tax_id, false,
            case when coalesce(p.cash_basis, false) then null else p.declaration_box end,
            case when p.declaration_box is null then null
                 else round(r.base_amount * coalesce(p.box_factor_percent, 100) / 100 / v_rate, 2) end,
            v_doc.currency_code,
            case when v_foreign then v_amount end);
  end loop;

  -- ------------------------------------------------------------------ taxes
  for r in
    select s.tax_id, s.tax_code, s.tax_name, s.tax_amount
      from document_tax_summary s
     where s.document_id = p_document_id
       and s.tax_id is not null
       and s.tax_amount <> 0
     order by s.tax_code
  loop
    select t.cash_basis, t.cash_basis_transition_account_id
      into v_cash, v_transition
      from taxes t where t.id = r.tax_id;

    if v_cash then
      -- A tax that waits needs somewhere to wait. Refuse by name rather than
      -- book it on the account it is due on, which would make it due.
      if v_transition is null then
        raise exception 'no_cash_basis_account: tax % falls due on collection and names no transition account',
          r.tax_code;
      end if;
      -- One posting per side, or the transition lines of a document cannot be
      -- told apart when the matching sends each of them on. A tax whose
      -- postings net out has nothing waiting to collect anyway.
      select count(*) into v_postings
        from tax_postings tp
       where tp.tax_id = r.tax_id and tp.document_kind = v_kind
         and tp.posting_type = 'tax';
      if v_postings > 1 then
        raise exception 'cash_basis_split_tax: tax % falls due on collection and has % tax postings; it takes one',
          r.tax_code, v_postings;
      end if;
      if exists (select 1 from tax_postings tp
                  where tp.tax_id = r.tax_id and tp.document_kind = v_kind
                    and tp.posting_type = 'tax_on_base') then
        raise exception 'cash_basis_tax_on_base: tax % falls due on collection and carries a non-deductible share; a cost is not deferred',
          r.tax_code;
      end if;
    end if;

    -- The postings of one side share out the tax of the group; the last of
    -- each side takes what is left. Until `tax_on_base` there was never more
    -- than one posting per side, so this changes no existing tax by a cent —
    -- and it is what keeps a 50/50 split honest: 0.63 becomes 0.32 and 0.31,
    -- where rounding each half on its own would book 0.64 against a document
    -- that totals 0.63.
    v_side_left     := null;
    v_side_left_neg := null;

    for p in
      select tp.posting_type, tp.factor_percent, tp.account_id,
             tp.declaration_box, tp.box_factor_percent,
             case when tp.factor_percent >= 0 then 1 else -1 end as side,
             sum(abs(tp.factor_percent))
               over (partition by case when tp.factor_percent >= 0 then 1 else -1 end)
               as side_factor,
             row_number() over (
               partition by case when tp.factor_percent >= 0 then 1 else -1 end
               order by tp.sequence, tp.id)
             = count(*) over (
               partition by case when tp.factor_percent >= 0 then 1 else -1 end)
               as is_last_of_side
        from tax_postings tp
       where tp.tax_id = r.tax_id
         and tp.document_kind = v_kind
         and tp.posting_type in ('tax', 'tax_on_base')
       order by tp.sequence, tp.id
    loop
      -- The tax of the group was rounded once, in the view. Every posting is
      -- a share of that one figure, never of a re-derived one.
      if p.side >= 0 then
        if v_side_left is null then
          v_side_left := round(r.tax_amount * p.side_factor / 100, 2);
        end if;
        if p.is_last_of_side then
          v_amount := v_side_left;
        else
          v_amount    := round(r.tax_amount * abs(p.factor_percent) / 100, 2);
          v_side_left := v_side_left - v_amount;
        end if;
      else
        if v_side_left_neg is null then
          v_side_left_neg := round(r.tax_amount * p.side_factor / 100, 2);
        end if;
        if p.is_last_of_side then
          v_amount := v_side_left_neg;
        else
          v_amount        := round(r.tax_amount * abs(p.factor_percent) / 100, 2);
          v_side_left_neg := v_side_left_neg - v_amount;
        end if;
      end if;

      if v_amount = 0 then
        continue;
      end if;
      -- A positive factor keeps the side of the base, a negative one flips it.
      v_side_credit := case when p.factor_percent >= 0 then v_base_credit else not v_base_credit end;
      -- The box keeps its own rounding: `box_factor_percent` was always
      -- independent from `factor_percent`, because a declaration figure is
      -- not a ledger figure and only the ledger has to balance.
      v_box_amount := case when p.declaration_box is null then null
                           else round(r.tax_amount * p.box_factor_percent / 100 / v_rate, 2) end;
      v_book := round(v_amount / v_rate, 2);

      if p.posting_type = 'tax' then
        v_seq := v_seq + 10;

        insert into entry_lines (entry_id, company_id, account_id, sequence, name,
                                 debit, credit, tax_id, tax_line,
                                 declaration_box, box_amount, currency_code, amount_currency)
        values (v_entry.id, v_doc.company_id,
                case when v_cash then v_transition else p.account_id end,
                v_seq, r.tax_name,
                case when v_side_credit then 0 else v_book end,
                case when v_side_credit then v_book else 0 end,
                r.tax_id, true,
                case when v_cash then null else p.declaration_box end,
                v_box_amount, v_doc.currency_code,
                case when v_foreign then v_amount end);
        continue;
      end if;

      -- `tax_on_base`: the tax is a cost, so it lands on the accounts of the
      -- lines it taxes, split in proportion to their base. The last share
      -- takes whatever is left, so the shares add up to the amount that was
      -- rounded once on the group and the entry still balances to the cent.
      v_left     := v_amount;
      v_left_box := v_box_amount;

      for g in
        select account_id,
               base_amount,
               seq,
               sum(base_amount) over ()                                   as total_base,
               row_number() over (order by seq) = count(*) over ()         as is_last
          from (
            select l.account_id,
                   sum(l.amount_untaxed) as base_amount,
                   min(l.sequence)       as seq
              from document_lines l
             where l.document_id = p_document_id
               and l.line_type = 'product'
               and l.tax_id = r.tax_id
             group by l.account_id
            having sum(l.amount_untaxed) <> 0
          ) as groups
         order by seq
      loop
        if g.is_last then
          v_share     := v_left;
          v_share_box := v_left_box;
        else
          v_share     := round(v_amount * g.base_amount / g.total_base, 2);
          v_share_box := case when v_box_amount is null then null
                              else round(v_box_amount * g.base_amount / g.total_base, 2) end;
          v_left      := v_left - v_share;
          v_left_box  := v_left_box - v_share_box;
        end if;

        if v_share = 0 then
          continue;
        end if;

        v_seq := v_seq + 10;
        v_share_book := round(v_share / v_rate, 2);

        -- `tax_line` stays false: the amount is on a base account and belongs
        -- to the base side of the declaration, which is why the Belgian grids
        -- 82 and 83 report it together with the base.
        insert into entry_lines (entry_id, company_id, account_id, sequence, name,
                                 debit, credit, tax_id, tax_line,
                                 declaration_box, box_amount, currency_code, amount_currency)
        values (v_entry.id, v_doc.company_id, g.account_id, v_seq, r.tax_name,
                case when v_side_credit then 0 else v_share_book end,
                case when v_side_credit then v_share_book else 0 end,
                r.tax_id, false,
                p.declaration_box, v_share_box, v_doc.currency_code,
                case when v_foreign then v_share end);
      end loop;
    end loop;
  end loop;

  -- ------------------------------------------------------------ counterpart
  select total_debit - total_credit into v_diff from entries where id = v_entry.id;
  select coalesce(sum(case when l.debit > 0 then l.amount_currency else -l.amount_currency end), 0)
    into v_diff_cur
    from entry_lines l where l.entry_id = v_entry.id;

  if v_diff = 0 then
    raise exception 'document_counterpart_zero: document % produced a nil counterpart', p_document_id;
  end if;

  v_contact := commercial_entity(v_doc.contact_id);
  v_counterpart := resolve_counterpart_account(v_doc.company_id, v_contact, v_is_sale);

  select payment_terms_days into v_terms from contacts where id = v_contact;
  v_maturity := coalesce(v_doc.due_date, v_doc.document_date + coalesce(v_terms, 30));

  v_amount := abs(v_diff);
  -- The counterpart balances the entry in both currencies. The total it is
  -- checked against is the document's own, which is the currency
  -- `amount_total` is stated in.
  v_total_cur := case when v_foreign then abs(v_diff_cur) else v_amount end;
  v_seq := v_seq + 10;

  insert into entry_lines (entry_id, company_id, account_id, sequence, name,
                           debit, credit, contact_id, date_maturity, currency_code,
                           amount_currency)
  values (v_entry.id, v_doc.company_id, v_counterpart, v_seq, v_label,
          case when v_diff > 0 then 0 else v_amount end,
          case when v_diff > 0 then v_amount else 0 end,
          v_contact, v_maturity, v_doc.currency_code,
          case when v_foreign then v_total_cur end);

  -- The ledger is right by construction. If the header disagrees, the header
  -- is what is wrong, and we say so instead of quietly patching a line.
  if abs(v_total_cur - abs(v_doc.amount_total)) > 0.005 then
    raise exception 'document_total_mismatch: document % totals % but its lines book %',
      p_document_id, v_doc.amount_total, v_total_cur;
  end if;

  -- --------------------------------------------------------------- posting
  v_entry := post_entry(v_entry.id);

  update documents
     set state  = 'posted',
         number = coalesce(number, v_entry.number),
         entry_id = v_entry.id,
         accounting_date = v_date
   where id = p_document_id;

  return v_entry;
end;
$$;

comment on function post_document(uuid) is
  'Books a document: base lines, tax lines from tax_postings — the non-deductible share on the accounts of the lines, a cash-basis tax on its transition account and on no box — a counterpart that balances by construction, and the company currency in the ledger at the rate the document carries.';

-- ---------------------------------------------------------------------------
-- post_payment — the same two lines, in the company's currency
-- ---------------------------------------------------------------------------

create or replace function post_payment(p_payment_id uuid)
returns entries
language plpgsql
as $$
declare
  v_pay        payments%rowtype;
  v_entry      entries%rowtype;
  v_money      uuid;
  v_third      uuid;
  v_contact    uuid;
  v_inbound    boolean;
  v_label      text;
  v_home       char(3);
  v_foreign    boolean;
  v_book       numeric(16, 2);
begin
  select * into v_pay from payments where id = p_payment_id for update;
  if not found then
    raise exception 'unknown_payment: payment % does not exist', p_payment_id;
  end if;
  if v_pay.entry_id is not null then
    raise exception 'payment_already_booked: payment % already points at entry %',
      p_payment_id, v_pay.entry_id;
  end if;
  if v_pay.state = 'cancelled' then
    raise exception 'payment_cancelled: payment % cannot be booked', p_payment_id;
  end if;

  v_inbound := v_pay.direction = 'inbound';

  -- The bank side: the account behind the payment's bank account, or the
  -- default account of the journal it goes through.
  select b.account_id into v_money
    from bank_accounts b
   where b.id = v_pay.bank_account_id;

  if v_money is null then
    select coalesce(j.default_account_id, b.account_id) into v_money
      from journals j
      left join bank_accounts b on b.id = j.bank_account_id
     where j.id = v_pay.journal_id;
  end if;

  -- A bank account wired to the journal from its own side counts too: that is
  -- the direction an operator fills in first.
  if v_money is null then
    select b.account_id into v_money
      from bank_accounts b
     where b.journal_id = v_pay.journal_id
       and b.active
       and b.account_id is not null
     order by b.created_at
     limit 1;
  end if;

  if v_money is null then
    raise exception 'no_bank_account: set bank_account_id on the payment, or default_account_id on journal %',
      v_pay.journal_id;
  end if;

  -- The third-party side, by role.
  v_contact := commercial_entity(v_pay.contact_id);
  v_third   := resolve_counterpart_account(v_pay.company_id, v_contact, v_inbound);

  v_label := coalesce(v_pay.reference, v_pay.memo, 'payment');

  select c.currency_code into v_home from companies c where c.id = v_pay.company_id;
  v_foreign := v_pay.currency_code <> v_home;
  v_book    := round(v_pay.amount / v_pay.exchange_rate, 2);

  insert into entries (company_id, journal_id, fiscal_year_id, entry_date, reference,
                       description, state, currency_code)
  values (v_pay.company_id, v_pay.journal_id,
          fiscal_year_at(v_pay.company_id, v_pay.payment_date), v_pay.payment_date,
          v_pay.reference, v_label, 'draft', v_pay.currency_code)
  returning * into v_entry;

  insert into entry_lines (entry_id, company_id, account_id, sequence, name,
                           debit, credit, currency_code, amount_currency)
  values (v_entry.id, v_pay.company_id, v_money, 10, v_label,
          case when v_inbound then v_book else 0 end,
          case when v_inbound then 0 else v_book end,
          v_pay.currency_code,
          case when v_foreign then v_pay.amount end);

  insert into entry_lines (entry_id, company_id, account_id, sequence, name,
                           debit, credit, contact_id, currency_code, amount_currency)
  values (v_entry.id, v_pay.company_id, v_third, 20, v_label,
          case when v_inbound then 0 else v_book end,
          case when v_inbound then v_book else 0 end,
          v_contact, v_pay.currency_code,
          case when v_foreign then v_pay.amount end);

  v_entry := post_entry(v_entry.id);

  update payments
     set entry_id = v_entry.id,
         state    = 'posted'
   where id = p_payment_id;

  return v_entry;
end;
$$;

comment on function post_payment(uuid) is
  'Books a payment: the bank side from the payment''s bank account or its journal, the third-party side by role, both in the company currency at the payment''s rate. Matches nothing.';

-- ---------------------------------------------------------------------------
-- settle_cash_basis_tax — the share of a waiting tax that has become due
--
-- Called by `reconcile` and by `unreconcile`, and derived entirely from the
-- ledger: what is waiting on the document, what share of the document has been
-- settled, and what earlier matchings already sent on. The difference is the
-- entry this posts, so the function is idempotent and works the same in both
-- directions — undoing a matching lowers the share and books the mirror.
--
-- The share is cumulative and rounded once against the whole, never payment by
-- payment: three thirds of 210,00 come to 70,00 + 70,00 + 70,00, and a tax of
-- 0,63 settled in halves comes to 0,32 then 0,31. The last matching always
-- carries the remainder because at full settlement the share is the whole.
--
-- The base of the operation travels with its tax. A cash-basis return declares
-- the base collected, so the base line of the document waits too — with no
-- ledger movement, because revenue was earned when it was invoiced. That is
-- what a line with a box and no amount is: a figure on a declaration, which
-- this schema has kept apart from a figure in the ledger since the tax engine.
-- ---------------------------------------------------------------------------

create or replace function settle_cash_basis_tax(
  p_document_id uuid,
  p_date        date
)
returns uuid
language plpgsql
as $$
declare
  v_doc       documents%rowtype;
  v_company   companies%rowtype;
  v_entry     entries%rowtype;
  v_kind      tax_document_kind;
  v_total     numeric(16, 2);
  v_paid      numeric(16, 2);
  v_ratio     numeric;
  v_seq       integer := 0;
  v_final     uuid;
  v_box       text;
  v_target    uuid;
  v_due       numeric(16, 2);
  v_done      numeric(16, 2);
  v_delta     numeric(16, 2);
  v_box_due   numeric(16, 2);
  v_box_done  numeric(16, 2);
  v_box_delta numeric(16, 2);
  v_credit    boolean;
  w           record;
begin
  select * into v_doc from documents where id = p_document_id;
  if not found or v_doc.entry_id is null then
    return null;
  end if;

  -- Nothing is waiting on this document: the answer for every tax that falls
  -- due when it is invoiced, which is most of them.
  if not exists (
    select 1
      from entry_lines q join taxes t on t.id = q.tax_id
     where q.entry_id = v_doc.entry_id
       and t.cash_basis
       and q.declaration_box is null
       and q.box_amount is not null
  ) then
    return null;
  end if;

  select * into v_company from companies where id = v_doc.company_id;
  if v_company.miscellaneous_journal_id is null then
    raise exception 'no_miscellaneous_journal: company % has no journal for the transfer of a cash-basis tax',
      v_doc.company_id;
  end if;

  v_kind := case when v_doc.doc_type in ('sale_credit_note', 'purchase_credit_note')
                 then 'credit_note' else 'invoice' end::tax_document_kind;

  -- What share of this document has been settled, read on its own third-party
  -- lines and in the ledger's currency on both sides of the division.
  select coalesce(sum(abs(tl.debit - tl.credit)), 0), coalesce(sum(tl.matched_amount), 0)
    into v_total, v_paid
    from entry_lines tl join accounts a on a.id = tl.account_id
   where tl.entry_id = v_doc.entry_id
     and a.reconcilable
     and a.account_type in ('asset_receivable', 'liability_payable');

  if v_total = 0 then
    return null;
  end if;
  -- An overpayment settles the document, and no more: a tax is due on what
  -- was invoiced.
  v_ratio := least(1, greatest(0, v_paid / v_total));

  for w in
    select l2.id, l2.account_id, l2.tax_id, l2.tax_line, l2.box_amount,
           l2.debit, l2.credit, l2.name, l2.sequence
      from entry_lines l2 join taxes t on t.id = l2.tax_id
     where l2.entry_id = v_doc.entry_id
       and t.cash_basis
       and l2.declaration_box is null
       and l2.box_amount is not null
     order by l2.sequence
  loop
    select tp.account_id, tp.declaration_box
      into v_final, v_box
      from tax_postings tp
     where tp.tax_id = w.tax_id
       and tp.document_kind = v_kind
       and tp.posting_type = (case when w.tax_line then 'tax' else 'base' end)::tax_posting_type
     limit 1;

    -- The account the transfer of this line lands on, which is also how an
    -- earlier transfer of the same line is recognised.
    v_target := case when w.tax_line then v_final else w.account_id end;
    if v_target is null then
      raise exception 'no_cash_basis_target: the tax of line % names no account to fall due on', w.id;
    end if;
    -- A line only waits because a box was worked out for it, and that box came
    -- from this very posting. If it has none, the amount would wait for ever.
    if v_box is null then
      raise exception 'no_cash_basis_box: the tax of line % holds an amount for a box the posting does not name', w.id;
    end if;

    if w.tax_line then
      v_due := round((w.debit + w.credit) * v_ratio, 2);
      select coalesce(sum(case when w.credit > 0 then x.credit - x.debit
                               else x.debit - x.credit end), 0)
        into v_done
        from entry_lines x join entries e on e.id = x.entry_id
       where e.document_id = p_document_id
         and e.id <> v_doc.entry_id
         and x.tax_id = w.tax_id
         and x.tax_line
         and x.account_id = v_target;
    else
      v_due  := 0;
      v_done := 0;
    end if;
    v_delta := v_due - v_done;

    v_box_due := round(w.box_amount * v_ratio, 2);
    select coalesce(sum(x.box_amount), 0)
      into v_box_done
      from entry_lines x join entries e on e.id = x.entry_id
     where e.document_id = p_document_id
       and e.id <> v_doc.entry_id
       and x.tax_id = w.tax_id
       and x.tax_line = w.tax_line
       and x.account_id = v_target;
    v_box_delta := v_box_due - v_box_done;

    if v_delta = 0 and v_box_delta = 0 then
      continue;
    end if;

    if v_entry.id is null then
      insert into entries (company_id, journal_id, fiscal_year_id, entry_date, reference,
                           description, state, document_id, currency_code)
      values (v_doc.company_id, v_company.miscellaneous_journal_id,
              fiscal_year_at(v_doc.company_id, p_date), p_date,
              v_doc.number,
              coalesce(v_doc.number, 'document') || ' — tax due on settlement',
              'draft', p_document_id, v_company.currency_code)
      returning * into v_entry;
    end if;

    -- The side the document put the tax on, kept when the share grows and
    -- flipped when it shrinks.
    v_credit := (w.credit > 0) = (v_delta > 0);

    v_seq := v_seq + 10;
    insert into entry_lines (entry_id, company_id, account_id, sequence, name,
                             debit, credit, tax_id, tax_line,
                             declaration_box, box_amount, currency_code)
    values (v_entry.id, v_doc.company_id, v_target, v_seq, w.name,
            case when v_credit then 0 else abs(v_delta) end,
            case when v_credit then abs(v_delta) else 0 end,
            w.tax_id, w.tax_line,
            v_box, v_box_delta,
            v_company.currency_code);

    if v_delta <> 0 then
      v_seq := v_seq + 10;
      insert into entry_lines (entry_id, company_id, account_id, sequence, name,
                               debit, credit, tax_id, tax_line, currency_code)
      values (v_entry.id, v_doc.company_id, w.account_id, v_seq, w.name,
              case when v_credit then abs(v_delta) else 0 end,
              case when v_credit then 0 else abs(v_delta) end,
              w.tax_id, true, v_company.currency_code);
    end if;
  end loop;

  if v_entry.id is null then
    return null;
  end if;

  v_entry := post_entry(v_entry.id);
  return v_entry.id;
end;
$$;

comment on function settle_cash_basis_tax(uuid, date) is
  'Moves the share of a cash-basis tax that settlement has made due, from the transition account to the account and the box it is declared on. Derived from the ledger, so it is the same call whether a matching was made or undone.';

-- ---------------------------------------------------------------------------
-- reconcile — the same matching, plus what the matching reveals
--
-- Two lines in the same currency, and that currency is not the company's: the
-- matching is worked out in *their* currency, because that is where they are
-- equal, and each side turns it back into the company's at the rate it was
-- booked with. The two figures differ by the movement of the rate, and that
-- difference is realised the moment the money arrives. It is booked on the
-- accounts the pack names, on the third-party account so that account goes to
-- nil, and matched under the same letter.
--
-- `p_amount` is read in the currency the two lines share, which is the
-- currency an operator is looking at when a dollar invoice is settled by a
-- dollar payment. Nothing else changes: two lines in the company's currency
-- are matched exactly as before, and every line booked before this migration
-- carries no currency amount at all.
--
-- The unmatched residual that a rate creates has no other way out. Leaving it
-- on the receivable would mean a customer who has paid in full still owes a
-- few cents of a currency they never used.
-- ---------------------------------------------------------------------------

create or replace function reconcile(
  p_line_a uuid,
  p_line_b uuid,
  p_amount numeric default null
)
returns reconciliations
language plpgsql
as $$
declare
  v_a        entry_lines%rowtype;
  v_b        entry_lines%rowtype;
  v_debit    entry_lines%rowtype;
  v_credit   entry_lines%rowtype;
  v_amount   numeric(16, 2);
  v_letter   text;
  v_result   reconciliations%rowtype;
  v_reconcilable boolean;
  v_home     char(3);
  v_country  char(2);
  v_journal  uuid;
  v_fx       boolean := false;
  v_open_d   numeric(16, 2);
  v_open_c   numeric(16, 2);
  v_cur_d    numeric(16, 2);
  v_cur_c    numeric(16, 2);
  v_cur      numeric(16, 2);
  v_comp_d   numeric(16, 2);
  v_comp_c   numeric(16, 2);
  v_gap      numeric(16, 2) := 0;
  v_gain     uuid;
  v_loss     uuid;
  v_result_account uuid;
  v_fx_entry entries%rowtype;
  v_fx_line  uuid;
  v_date     date;
  v_transfer uuid;
  v_doc      uuid;
begin
  select * into v_a from entry_lines where id = p_line_a for update;
  if not found then raise exception 'unknown_entry_line: %', p_line_a; end if;
  select * into v_b from entry_lines where id = p_line_b for update;
  if not found then raise exception 'unknown_entry_line: %', p_line_b; end if;

  if v_a.account_id <> v_b.account_id then
    raise exception 'reconcile_account_mismatch: lines are on different accounts';
  end if;
  if v_a.company_id <> v_b.company_id then
    raise exception 'reconcile_company_mismatch: lines belong to different companies';
  end if;

  select a.reconcilable into v_reconcilable from accounts a where a.id = v_a.account_id;
  if not v_reconcilable then
    raise exception 'account_not_reconcilable: account of line % is not reconcilable', p_line_a;
  end if;

  if (v_a.debit > 0) = (v_b.debit > 0) then
    raise exception 'reconcile_same_side: a debit must be matched against a credit';
  end if;

  if v_a.debit > 0 then
    v_debit := v_a; v_credit := v_b;
  else
    v_debit := v_b; v_credit := v_a;
  end if;

  select c.currency_code, c.country, c.miscellaneous_journal_id
    into v_home, v_country, v_journal
    from companies c where c.id = v_debit.company_id;

  v_open_d := abs(v_debit.debit - v_debit.credit) - v_debit.matched_amount;
  v_open_c := abs(v_credit.debit - v_credit.credit) - v_credit.matched_amount;

  v_fx := v_debit.currency_code is not null
      and v_debit.currency_code = v_credit.currency_code
      and v_debit.currency_code <> v_home
      and coalesce(v_debit.amount_currency, 0) <> 0
      and coalesce(v_credit.amount_currency, 0) <> 0;

  if v_fx then
    -- What is still open on each line, in its own currency, in proportion to
    -- what is still open in the ledger.
    v_cur_d := round(v_debit.amount_currency * v_open_d
                     / nullif(abs(v_debit.debit - v_debit.credit), 0), 2);
    v_cur_c := round(v_credit.amount_currency * v_open_c
                     / nullif(abs(v_credit.debit - v_credit.credit), 0), 2);
    v_cur   := coalesce(p_amount, least(v_cur_d, v_cur_c));

    if v_cur is null or v_cur <= 0 then
      raise exception 'reconcile_nothing_left: no open amount to match';
    end if;
    if v_cur > v_cur_d + 0.001 or v_cur > v_cur_c + 0.001 then
      raise exception 'reconcile_over_currency: % exceeds what is open in %',
        v_cur, v_debit.currency_code;
    end if;

    v_comp_d := round(v_cur * abs(v_debit.debit - v_debit.credit) / v_debit.amount_currency, 2);
    v_comp_c := round(v_cur * abs(v_credit.debit - v_credit.credit) / v_credit.amount_currency, 2);
    v_amount := least(v_comp_d, v_comp_c);
    v_gap    := v_comp_d - v_comp_c;
  else
    v_amount := coalesce(p_amount, least(v_open_d, v_open_c));
  end if;

  if v_amount is null or v_amount <= 0 then
    raise exception 'reconcile_nothing_left: no open amount to match';
  end if;
  if v_amount > v_open_d + 0.001 then
    raise exception 'reconcile_over_debit: % exceeds the open amount of the debit line', v_amount;
  end if;
  if v_amount > v_open_c + 0.001 then
    raise exception 'reconcile_over_credit: % exceeds the open amount of the credit line', v_amount;
  end if;

  -- Reuse a letter already carried by either side, otherwise draw a new one.
  v_letter := coalesce(v_debit.matching_number, v_credit.matching_number,
                       next_matching_number(v_debit.company_id));

  -- Two chains meeting: merge them under a single letter.
  if v_debit.matching_number is not null
     and v_credit.matching_number is not null
     and v_debit.matching_number <> v_credit.matching_number then
    update reconciliations
       set matching_number = v_letter
     where company_id = v_debit.company_id
       and matching_number = v_credit.matching_number;
  end if;

  -- The date the settlement is complete on: the later of the two entries.
  select greatest(ed.entry_date, ec.entry_date) into v_date
    from entries ed, entries ec
   where ed.id = v_debit.entry_id and ec.id = v_credit.entry_id;

  -- ------------------------------------------------------- exchange difference
  if v_gap <> 0 then
    select account_id_by_code(v_debit.company_id, cd.fx_gain_code),
           account_id_by_code(v_debit.company_id, cd.fx_loss_code)
      into v_gain, v_loss
      from country_defaults cd where cd.country = v_country;

    -- A debit side short of the credit side means more of the company's money
    -- came in than the receivable was booked at: a gain.
    v_result_account := case when v_gap < 0 then v_gain else v_loss end;
    if v_result_account is null then
      raise exception 'no_fx_accounts: matching % with % realises % and the country model names no exchange gain and loss account',
        p_line_a, p_line_b, v_gap;
    end if;
    if v_journal is null then
      raise exception 'no_miscellaneous_journal: company % has no journal for an exchange difference',
        v_debit.company_id;
    end if;

    insert into entries (company_id, journal_id, fiscal_year_id, entry_date,
                         description, state, currency_code)
    values (v_debit.company_id, v_journal, fiscal_year_at(v_debit.company_id, v_date), v_date,
            'Exchange difference on ' || v_letter, 'draft', v_home)
    returning * into v_fx_entry;

    insert into entry_lines (entry_id, company_id, account_id, sequence, name,
                             debit, credit, contact_id, currency_code)
    values (v_fx_entry.id, v_debit.company_id, v_debit.account_id, 10,
            'Exchange difference',
            case when v_gap < 0 then abs(v_gap) else 0 end,
            case when v_gap < 0 then 0 else abs(v_gap) end,
            coalesce(v_debit.contact_id, v_credit.contact_id), v_home)
    returning id into v_fx_line;

    insert into entry_lines (entry_id, company_id, account_id, sequence, name,
                             debit, credit, currency_code)
    values (v_fx_entry.id, v_debit.company_id, v_result_account, 20,
            'Exchange difference',
            case when v_gap < 0 then 0 else abs(v_gap) end,
            case when v_gap < 0 then abs(v_gap) else 0 end,
            v_home);

    v_fx_entry := post_entry(v_fx_entry.id);

    -- And it is matched with the side it completes, under the same letter.
    if v_gap < 0 then
      insert into reconciliations (company_id, debit_line_id, credit_line_id, amount, matching_number)
      values (v_debit.company_id, v_fx_line, v_credit.id, abs(v_gap), v_letter);
    else
      insert into reconciliations (company_id, debit_line_id, credit_line_id, amount, matching_number)
      values (v_debit.company_id, v_debit.id, v_fx_line, abs(v_gap), v_letter);
    end if;
  end if;

  insert into reconciliations (company_id, debit_line_id, credit_line_id, amount,
                               matching_number, fx_entry_id)
  values (v_debit.company_id, v_debit.id, v_credit.id, v_amount, v_letter, v_fx_entry.id)
  returning * into v_result;

  -- ------------------------------------------------------- a tax falling due
  for v_doc in
    select distinct d.id
      from entry_lines l join documents d on d.entry_id = l.entry_id
     where l.id in (v_debit.id, v_credit.id)
  loop
    v_transfer := coalesce(settle_cash_basis_tax(v_doc, v_date), v_transfer);
  end loop;

  if v_transfer is not null then
    update reconciliations set tax_transfer_entry_id = v_transfer where id = v_result.id
    returning * into v_result;
  end if;

  return v_result;
end;
$$;

comment on function reconcile(uuid, uuid, numeric) is
  'Matches a debit line against a credit line, in the currency the two share when it is not the company''s, and books what the matching reveals: the realised exchange difference, and the share of a cash-basis tax that has become due.';

-- ---------------------------------------------------------------------------
-- unreconcile — and what has to be taken back with the matching
-- ---------------------------------------------------------------------------

create or replace function unreconcile(p_reconciliation_id uuid)
returns void
language plpgsql
as $$
declare
  v_row     reconciliations%rowtype;
  v_date    date;
  v_fx      entries%rowtype;
  v_mirror  entries%rowtype;
  v_doc     uuid;
  fl        record;
begin
  select * into v_row from reconciliations where id = p_reconciliation_id;
  if not found then
    raise exception 'unknown_reconciliation: %', p_reconciliation_id;
  end if;

  select greatest(ed.entry_date, ec.entry_date) into v_date
    from entry_lines ld join entries ed on ed.id = ld.entry_id,
         entry_lines lc join entries ec on ec.id = lc.entry_id
   where ld.id = v_row.debit_line_id and lc.id = v_row.credit_line_id;

  delete from reconciliations where id = p_reconciliation_id;

  -- An exchange difference was realised by this matching and by nothing else,
  -- so undoing the matching takes it back: its own matching goes, and a mirror
  -- entry cancels it on the same date. The period has to be open, which is the
  -- honest refusal — a difference that has been declared is not unmade quietly.
  if v_row.fx_entry_id is not null then
    select * into v_fx from entries where id = v_row.fx_entry_id;

    delete from reconciliations r
     where r.company_id = v_row.company_id
       and (r.debit_line_id in (select id from entry_lines where entry_id = v_fx.id)
         or r.credit_line_id in (select id from entry_lines where entry_id = v_fx.id));

    insert into entries (company_id, journal_id, fiscal_year_id, entry_date,
                         description, state, currency_code, reversed_entry_id)
    values (v_fx.company_id, v_fx.journal_id, v_fx.fiscal_year_id, v_fx.entry_date,
            'Exchange difference undone', 'draft', v_fx.currency_code, v_fx.id)
    returning * into v_mirror;

    for fl in select * from entry_lines where entry_id = v_fx.id order by sequence loop
      insert into entry_lines (entry_id, company_id, account_id, sequence, name,
                               debit, credit, contact_id, currency_code)
      values (v_mirror.id, fl.company_id, fl.account_id, fl.sequence, fl.name,
              fl.credit, fl.debit, fl.contact_id, fl.currency_code);
    end loop;

    perform post_entry(v_mirror.id);
  end if;

  -- The share of a cash-basis tax that is due has just fallen; the same
  -- function books the difference, which is now the other way round.
  for v_doc in
    select distinct d.id
      from entry_lines l join documents d on d.entry_id = l.entry_id
     where l.id in (v_row.debit_line_id, v_row.credit_line_id)
  loop
    perform settle_cash_basis_tax(v_doc, v_date);
  end loop;
end;
$$;

comment on function unreconcile(uuid) is
  'Undoes a matching, and with it what the matching had booked: the exchange difference it realised and the share of a cash-basis tax it had made due.';

-- Rule 6 of supabase/migrations/README.md: a function created here comes out
-- executable by PUBLIC otherwise.
revoke execute on all functions in schema public from public;
