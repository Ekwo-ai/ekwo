-- Ekwo OS — every amount the schema writes is rounded at the decimals of its
-- currency, by the method of its country.
--
-- The previous migration added the vocabulary. This one makes the socle speak
-- it: fifty-one `round(x, 2)` in eighteen functions, a view and a generated
-- column, replaced by `round_amount(x, rounding)` — and the rounding resolved
-- once per call from `rounding_of()`, which is the only reader of
-- `currencies.decimal_places` and `country_defaults.rounding_method`.
--
-- Four things are worth saying about what changed beyond the substitution.
--
-- **A function rounds in as many currencies as it handles.** `post_document`
-- writes the base and the tax of a document in the document's own currency
-- and the ledger lines in the company's; `post_payment` and `reconcile` do
-- the same. Each resolves both and uses the right one on each line, so a yen
-- invoice settled from a euro account rounds each side at the decimals that
-- side has, instead of assuming both have two.
--
-- **A local that carries a scale is a second rounding rule.** `v_amount
-- numeric(16, 2)` rounds on every assignment, silently, at two decimals,
-- whatever the currency — so the declarations of every rewritten function are
-- plain `numeric` now and the only thing that rounds is `round_amount`.
--
-- **A tolerance is a fraction of a unit, not of a cent.** `0.005` meant "half
-- a cent" and `0.001` "a tenth of one"; in a currency with no decimals they
-- are a two-hundredth and a thousandth of the smallest coin there is, which
-- is to say nothing at all. They are written against `currency_unit()` now.
--
-- **`document_lines.amount_untaxed` stops being a generated column.** Its
-- expression was `round(quantity * unit_price * (1 - discount / 100), 2)`, and
-- a generated column may not look anything up — so it could not ask what
-- currency the document is in. It becomes a column written by a `before`
-- trigger that always overwrites it, which keeps the guarantee that mattered:
-- the total is derived and can never be keyed in.
--
-- What this migration does *not* change is the scale the amounts are stored
-- at. Every monetary column is `numeric(16, 2)`, so a currency with three
-- decimals is rounded correctly by the engine and then held at two by the
-- column. Widening them is a migration of its own — it rewrites the text of
-- every amount this schema returns — and `docs/decisions.md` says so.

-- ---------------------------------------------------------------------------
-- document_lines.amount_untaxed
--
-- `drop expression` keeps the column and its values and takes away only the
-- rule that computed them; the trigger below puts a better rule back. A
-- document that is already posted is never rewritten, so nothing recomputes
-- history.
-- ---------------------------------------------------------------------------

alter table document_lines alter column amount_untaxed drop expression;

comment on column document_lines.amount_untaxed is
  'quantity x unit_price less the discount, rounded once at the decimals of the document''s currency. Written by a trigger on every insert and update, so it is derived and never keyed in.';

create or replace function document_lines_amount_untaxed()
returns trigger
language plpgsql
as $$
declare
  v_company  uuid;
  v_currency char(3);
  v_round    money_rounding;
begin
  if new.line_type <> 'product' then
    new.amount_untaxed := 0;
    return new;
  end if;

  -- Read in two steps: `select f(x) into a_composite` would assign the whole
  -- row to the first field of the target, which is a trap plpgsql lays for
  -- every function that returns a composite.
  select d.company_id, d.currency_code into v_company, v_currency
    from documents d where d.id = new.document_id;
  v_round := rounding_of(v_company, v_currency);

  new.amount_untaxed := round_amount(
    new.quantity * new.unit_price * (1 - new.discount_percent / 100), v_round);
  return new;
end;
$$;

comment on function document_lines_amount_untaxed() is
  'Derives a line''s amount from its quantity, price and discount, rounded once at the decimals of the document''s currency. What the generated column used to do, minus the assumption that every currency has cents.';

create trigger document_lines_amount_untaxed
  before insert or update on document_lines
  for each row execute function document_lines_amount_untaxed();

-- ---------------------------------------------------------------------------
-- document_tax_summary
--
-- VAT is still rounded once per tax group on the rounded basis (BR-CO-14);
-- what changes is the number of decimals it is rounded to.
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
         round_amount(sum(l.amount_untaxed) * coalesce(t.amount, 0) / 100,
                      rounding_of(l.company_id, d.currency_code)) as tax_amount,
         -- Charged tax: what the other party actually pays. Zero when the tax
         -- postings net out, which is exactly what self-assessment means.
         round_amount(
           sum(l.amount_untaxed) * coalesce(t.amount, 0) / 100
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

create or replace function documents_refresh_totals(p_document_id uuid)
returns void
language plpgsql
as $$
declare
  v_untaxed  numeric;
  v_tax      numeric;
  v_company  uuid;
  v_currency char(3);
  v_round    money_rounding;
begin
  select d.company_id, d.currency_code into v_company, v_currency
    from documents d where d.id = p_document_id;
  if not found then
    return;
  end if;
  v_round := rounding_of(v_company, v_currency);

  select coalesce(sum(base_amount), 0), coalesce(sum(tax_charged), 0)
    into v_untaxed, v_tax
    from document_tax_summary
   where document_id = p_document_id;

  -- The three totals are written in the document's currency, which is the one
  -- `amount_total` is compared against when the entry is built.
  update documents
     set amount_untaxed = round_amount(v_untaxed, v_round),
         amount_tax     = round_amount(v_tax, v_round),
         amount_total   = round_amount(v_untaxed + v_tax, v_round)
   where id = p_document_id;
end;
$$;

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
                        else round_amount(l.matched_amount * l.amount_currency
                                          / nullif(abs(l.debit - l.credit), 0),
                                          rounding_of(d.company_id, d.currency_code))
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
  -- Plain `numeric`, not `numeric(16, 2)`: a local that carries a scale is a
  -- second rounding rule hiding in a declaration, and it is not the currency's.
  -- The only thing that rounds here is `round_amount`.
  v_diff       numeric;
  v_diff_cur   numeric;
  v_amount     numeric;
  v_book       numeric;
  v_box_amount numeric;
  v_share      numeric;
  v_share_book numeric;
  v_share_box  numeric;
  v_left       numeric;
  v_left_box   numeric;
  v_side_left     numeric;
  v_side_left_neg numeric;
  v_side_credit boolean;
  v_label      text;
  v_rate       numeric(18, 8);
  v_home       char(3);
  v_foreign    boolean;
  v_total_cur  numeric;
  -- Two currencies, one method: the document is stated in its own and the
  -- ledger keeps the company's, and a yen invoice paid in euros rounds each
  -- side at the decimals that side has.
  v_round      money_rounding;
  v_book_round money_rounding;
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
  v_round      := rounding_of(v_doc.company_id, v_doc.currency_code);
  v_book_round := rounding_of(v_doc.company_id);

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

    v_amount := round_amount(r.base_amount * coalesce(p.factor_percent, 100) / 100, v_round);
    v_book   := round_amount(v_amount / v_rate, v_book_round);
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
                 else round_amount(r.base_amount * coalesce(p.box_factor_percent, 100) / 100 / v_rate,
                                   v_book_round) end,
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
      -- And it needs a box to fall due *into*. `settle_cash_basis_tax()` only
      -- ever looks at lines that carry a `box_amount`, and a posting with no
      -- `declaration_box` produces none — so the amount would sit on the
      -- transition account for ever, settled by nothing and reported by
      -- nothing, with no error anywhere. Refuse it here, where the pack can
      -- still be corrected, rather than discover it in a balance years later.
      if not exists (select 1 from tax_postings tp
                      where tp.tax_id = r.tax_id and tp.document_kind = v_kind
                        and tp.posting_type = 'tax'
                        and tp.declaration_box is not null) then
        raise exception 'no_cash_basis_box: tax % falls due on collection and its posting names no declaration box; the amount would wait on the transition account and never settle',
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
          v_side_left := round_amount(r.tax_amount * p.side_factor / 100, v_round);
        end if;
        if p.is_last_of_side then
          v_amount := v_side_left;
        else
          v_amount    := round_amount(r.tax_amount * abs(p.factor_percent) / 100, v_round);
          v_side_left := v_side_left - v_amount;
        end if;
      else
        if v_side_left_neg is null then
          v_side_left_neg := round_amount(r.tax_amount * p.side_factor / 100, v_round);
        end if;
        if p.is_last_of_side then
          v_amount := v_side_left_neg;
        else
          v_amount        := round_amount(r.tax_amount * abs(p.factor_percent) / 100, v_round);
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
                           else round_amount(r.tax_amount * p.box_factor_percent / 100 / v_rate,
                                             v_book_round) end;
      v_book := round_amount(v_amount / v_rate, v_book_round);

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
          v_share     := round_amount(v_amount * g.base_amount / g.total_base, v_round);
          v_share_box := case when v_box_amount is null then null
                              else round_amount(v_box_amount * g.base_amount / g.total_base,
                                                v_book_round) end;
          v_left      := v_left - v_share;
          v_left_box  := v_left_box - v_share_box;
        end if;

        if v_share = 0 then
          continue;
        end if;

        v_seq := v_seq + 10;
        v_share_book := round_amount(v_share / v_rate, v_book_round);

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
  -- Half a unit of the document's own currency, which is what `0.005` used to
  -- mean when every currency was assumed to have cents.
  if abs(v_total_cur - abs(v_doc.amount_total)) > currency_unit(v_round) / 2 then
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
  v_book       numeric;
  v_book_round money_rounding;
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
  -- The payment is stated in its own currency and booked in the company's, so
  -- what the ledger takes is rounded at the ledger's decimals.
  v_book_round := rounding_of(v_pay.company_id);
  v_book       := round_amount(v_pay.amount / v_pay.exchange_rate, v_book_round);

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
  v_amount   numeric;
  v_letter   text;
  v_result   reconciliations%rowtype;
  v_reconcilable boolean;
  v_home     char(3);
  v_country  char(2);
  v_journal  uuid;
  v_fx       boolean := false;
  v_open_d   numeric;
  v_open_c   numeric;
  v_cur_d    numeric;
  v_cur_c    numeric;
  v_cur      numeric;
  v_comp_d   numeric;
  v_comp_c   numeric;
  v_gap      numeric := 0;
  -- The ledger's rounding, and the one of the currency the two lines are
  -- stated in when that is not the ledger's.
  v_round    money_rounding;
  v_cur_round money_rounding;
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

  v_round  := rounding_of(v_debit.company_id);
  v_open_d := abs(v_debit.debit - v_debit.credit) - v_debit.matched_amount;
  v_open_c := abs(v_credit.debit - v_credit.credit) - v_credit.matched_amount;

  v_fx := v_debit.currency_code is not null
      and v_debit.currency_code = v_credit.currency_code
      and v_debit.currency_code <> v_home
      and coalesce(v_debit.amount_currency, 0) <> 0
      and coalesce(v_credit.amount_currency, 0) <> 0;

  if v_fx then
    v_cur_round := rounding_of(v_debit.company_id, v_debit.currency_code);
    -- What is still open on each line, in its own currency, in proportion to
    -- what is still open in the ledger.
    v_cur_d := round_amount(v_debit.amount_currency * v_open_d
                            / nullif(abs(v_debit.debit - v_debit.credit), 0), v_cur_round);
    v_cur_c := round_amount(v_credit.amount_currency * v_open_c
                            / nullif(abs(v_credit.debit - v_credit.credit), 0), v_cur_round);
    v_cur   := coalesce(p_amount, least(v_cur_d, v_cur_c));

    if v_cur is null or v_cur <= 0 then
      raise exception 'reconcile_nothing_left: no open amount to match';
    end if;
    -- A tenth of a unit of that currency, which is what `0.001` was when
    -- every currency was assumed to have cents.
    if v_cur > v_cur_d + currency_unit(v_cur_round) / 10
       or v_cur > v_cur_c + currency_unit(v_cur_round) / 10 then
      raise exception 'reconcile_over_currency: % exceeds what is open in %',
        v_cur, v_debit.currency_code;
    end if;

    v_comp_d := round_amount(v_cur * abs(v_debit.debit - v_debit.credit)
                             / v_debit.amount_currency, v_round);
    v_comp_c := round_amount(v_cur * abs(v_credit.debit - v_credit.credit)
                             / v_credit.amount_currency, v_round);
    v_amount := least(v_comp_d, v_comp_c);
    v_gap    := v_comp_d - v_comp_c;
  else
    v_amount := coalesce(p_amount, least(v_open_d, v_open_c));
  end if;

  if v_amount is null or v_amount <= 0 then
    raise exception 'reconcile_nothing_left: no open amount to match';
  end if;
  if v_amount > v_open_d + currency_unit(v_round) / 10 then
    raise exception 'reconcile_over_debit: % exceeds the open amount of the debit line', v_amount;
  end if;
  if v_amount > v_open_c + currency_unit(v_round) / 10 then
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
  v_total     numeric;
  v_paid      numeric;
  v_ratio     numeric;
  v_seq       integer := 0;
  v_final     uuid;
  v_box       text;
  v_target    uuid;
  v_due       numeric;
  v_done      numeric;
  v_delta     numeric;
  v_box_due   numeric;
  v_box_done  numeric;
  v_box_delta numeric;
  -- The transfer is written in the ledger's currency on both sides, which is
  -- the company's own: the entry it produces says so.
  v_round     money_rounding;
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
  v_round := rounding_of(v_doc.company_id);
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
      v_due := round_amount((w.debit + w.credit) * v_ratio, v_round);
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

    v_box_due := round_amount(w.box_amount * v_ratio, v_round);
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

create or replace function opening_balance(
  p_company_id            uuid,
  p_fiscal_year_id        uuid,
  p_lines                 jsonb,
  p_allow_result_accounts boolean default false
)
returns uuid
language plpgsql
as $$
declare
  v_year     fiscal_years%rowtype;
  v_journal  uuid;
  v_entry    entries%rowtype;
  v_line     jsonb;
  v_account  uuid;
  v_code     text;
  v_debit    numeric;
  v_credit   numeric;
  v_carries  boolean;
  v_sequence integer := 0;
  v_debits   numeric := 0;
  v_credits  numeric := 0;
  -- An opening balance is the ledger's own, so it is written at the decimals
  -- of the company's currency.
  v_round    money_rounding := rounding_of(p_company_id);
begin
  select * into v_year from fiscal_years where id = p_fiscal_year_id;
  if not found then
    raise exception 'unknown_fiscal_year: fiscal year % does not exist', p_fiscal_year_id;
  end if;
  if v_year.company_id <> p_company_id then
    raise exception 'fiscal_year_other_company: fiscal year % does not belong to company %',
      p_fiscal_year_id, p_company_id;
  end if;
  if v_year.is_closed then
    raise exception 'fiscal_year_closed: % is closed', v_year.name
      using errcode = '55006';
  end if;
  if has_opening_entry(p_fiscal_year_id) then
    raise exception 'opening_entry_exists: % already has an opening entry', v_year.name;
  end if;

  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'opening_empty: opening_balance takes a non-empty array of lines';
  end if;

  v_journal := opening_journal_id(p_company_id);
  if v_journal is null then
    raise exception 'no_opening_journal: the pack of this company names no journal of type opening. Set defaults.journal_roles.opening in the pack, which fills country_defaults.opening_journal_code.'
      using errcode = '55006';
  end if;

  perform set_config('ekwo.year_end_entry', 'on', true);
  insert into entries (company_id, journal_id, fiscal_year_id, entry_date,
                       description, state, kind)
  values (p_company_id, v_journal, p_fiscal_year_id, v_year.start_date,
          'Opening balance', 'draft', 'opening')
  returning * into v_entry;
  perform set_config('ekwo.year_end_entry', 'off', true);

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_sequence := v_sequence + 10;
    v_code := v_line ->> 'account_code';
    if v_code is null then
      raise exception 'opening_line_without_account: line % names no account_code', v_sequence / 10;
    end if;

    select a.id, a.carries_forward into v_account, v_carries
      from accounts a
     where a.company_id = p_company_id and a.code = v_code;
    if v_account is null then
      raise exception 'unknown_account: % is not an account of this company', v_code;
    end if;
    if not v_carries and not p_allow_result_accounts then
      raise exception 'opening_result_account: % is an income or expense account; an opening balance is made of the balance sheet. Pass p_allow_result_accounts when taking over books mid-year.',
        v_code;
    end if;

    v_debit  := round_amount(coalesce((v_line ->> 'debit')::numeric, 0), v_round);
    v_credit := round_amount(coalesce((v_line ->> 'credit')::numeric, 0), v_round);
    if v_debit < 0 or v_credit < 0 then
      raise exception 'opening_negative_amount: % has a negative amount; a side is chosen, never a sign', v_code;
    end if;
    if v_debit <> 0 and v_credit <> 0 then
      raise exception 'opening_two_sides: % carries both a debit and a credit', v_code;
    end if;
    if v_debit = 0 and v_credit = 0 then
      raise exception 'opening_no_amount: % carries neither a debit nor a credit', v_code;
    end if;

    insert into entry_lines (entry_id, company_id, account_id, sequence, name,
                             debit, credit, contact_id)
    values (v_entry.id, p_company_id, v_account, v_sequence,
            coalesce(v_line ->> 'label', 'Opening balance'),
            v_debit, v_credit, (v_line ->> 'contact_id')::uuid);

    v_debits  := v_debits + v_debit;
    v_credits := v_credits + v_credit;
  end loop;

  if v_debits <> v_credits then
    raise exception 'opening_unbalanced: the opening balance has debit % and credit %',
      v_debits, v_credits;
  end if;

  v_entry := post_entry(v_entry.id);
  return v_entry.id;
end;
$$;

create or replace function post_module_entry(
  p_company_id  uuid,
  p_module_code text,
  p_ref         text,
  p_date        date,
  p_description text,
  p_lines       jsonb,
  p_journal_id  uuid default null
)
returns uuid
language plpgsql
as $$
declare
  v_company  companies%rowtype;
  v_journal  uuid;
  v_entry    entries%rowtype;
  v_line     jsonb;
  v_account  uuid;
  v_code     text;
  v_debit    numeric;
  v_credit   numeric;
  v_sequence integer := 0;
  v_debits   numeric := 0;
  v_credits  numeric := 0;
  -- A module writes into the ledger, so its lines are written at the decimals
  -- of the company's own currency, like every other entry.
  v_round    money_rounding;
begin
  select * into v_company from companies where id = p_company_id;
  if not found then
    raise exception 'unknown_company: %', p_company_id;
  end if;
  v_round := rounding_of(p_company_id);

  if not module_is_enabled(p_company_id, p_module_code) then
    raise exception 'module_not_enabled: % is not enabled on this company', p_module_code
      using errcode = '55006';
  end if;

  if p_ref is null or p_ref = '' then
    raise exception 'module_entry_without_ref: an entry written by a module says what it is for, so a second one cannot repeat it';
  end if;

  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'module_entry_empty: post_module_entry takes a non-empty array of lines';
  end if;

  -- The miscellaneous journal unless the caller names one. A module booking is
  -- not a movement of money and not a document, so it has no business on a
  -- bank or a sales journal — the same reasoning that put the exchange
  -- difference and the cash-basis transfer there.
  v_journal := coalesce(p_journal_id, v_company.miscellaneous_journal_id);
  if v_journal is null then
    raise exception 'no_miscellaneous_journal: this company has no journal for an entry that is neither a document nor a payment';
  end if;

  insert into entries (company_id, journal_id, fiscal_year_id, entry_date,
                       description, state, module_code, module_ref)
  values (p_company_id, v_journal, fiscal_year_at(p_company_id, p_date), p_date,
          p_description, 'draft', p_module_code, p_ref)
  returning * into v_entry;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_sequence := v_sequence + 10;
    v_code := v_line ->> 'account_code';
    v_account := (v_line ->> 'account_id')::uuid;
    if v_account is null then
      if v_code is null then
        raise exception 'module_line_without_account: line % names neither account_id nor account_code', v_sequence / 10;
      end if;
      v_account := account_id_by_code(p_company_id, v_code);
      if v_account is null then
        raise exception 'unknown_account: % is not an account of this company', v_code;
      end if;
    end if;

    v_debit  := round_amount(coalesce((v_line ->> 'debit')::numeric, 0), v_round);
    v_credit := round_amount(coalesce((v_line ->> 'credit')::numeric, 0), v_round);
    if v_debit < 0 or v_credit < 0 then
      raise exception 'module_line_negative: a line chooses a side, never a sign';
    end if;
    if v_debit <> 0 and v_credit <> 0 then
      raise exception 'module_line_two_sides: a line carries a debit or a credit, not both';
    end if;
    if v_debit = 0 and v_credit = 0 then
      raise exception 'module_line_no_amount: a line with neither a debit nor a credit says nothing';
    end if;

    insert into entry_lines (entry_id, company_id, account_id, sequence, name,
                             debit, credit, contact_id, date_maturity)
    values (v_entry.id, p_company_id, v_account, v_sequence,
            coalesce(v_line ->> 'label', p_description),
            v_debit, v_credit,
            (v_line ->> 'contact_id')::uuid,
            (v_line ->> 'date_maturity')::date);

    v_debits  := v_debits + v_debit;
    v_credits := v_credits + v_credit;
  end loop;

  if v_debits <> v_credits then
    raise exception 'entry_unbalanced: the lines of % have debit % and credit %', p_ref, v_debits, v_credits;
  end if;

  v_entry := post_entry(v_entry.id);
  return v_entry.id;
end;
$$;

create or replace function close_fiscal_year(p_fiscal_year_id uuid)
returns jsonb
language plpgsql
as $$
declare
  v_year        fiscal_years%rowtype;
  v_company     companies%rowtype;
  v_defaults    country_defaults%rowtype;
  v_journal     uuid;
  v_result      numeric;
  v_profit      boolean;
  v_kind        text;
  v_cyr         uuid;          -- current-year result account, the side that applies
  v_retained    uuid;          -- retained earnings, the side that applies
  v_carries     boolean;
  v_appropriate uuid;
  v_closing     uuid;
  v_entry       entries%rowtype;
  v_lines       integer;
  v_debits      numeric;
  v_credits     numeric;
  -- A close is written in the ledger's own currency, and the figure it
  -- reports is written with the decimals that currency has.
  v_round       money_rounding;
begin
  select * into v_year from fiscal_years where id = p_fiscal_year_id for update;
  if not found then
    raise exception 'unknown_fiscal_year: fiscal year % does not exist', p_fiscal_year_id;
  end if;
  if v_year.is_closed then
    raise exception 'fiscal_year_already_closed: % was closed on %', v_year.name, v_year.closed_at;
  end if;

  select * into v_company from companies where id = v_year.company_id;
  v_round := rounding_of(v_year.company_id);

  -- 1. What has to be true before a year can be closed.

  if exists (
    select 1 from entries e
     where e.company_id = v_year.company_id
       and e.entry_date between v_year.start_date and v_year.end_date
       and e.state = 'draft'
  ) then
    raise exception 'fiscal_year_has_drafts: % still holds draft entries; post or cancel them first', v_year.name;
  end if;

  if exists (
    select 1 from fiscal_years f
     where f.company_id = v_year.company_id
       and f.start_date < v_year.start_date
       and not f.is_closed
       and exists (select 1 from entries e where e.fiscal_year_id = f.id and e.state = 'posted')
  ) then
    raise exception 'earlier_fiscal_year_open: a year before % holds posted entries and is not closed', v_year.name;
  end if;

  if exists (
    select 1 from fiscal_years f
     where f.company_id = v_year.company_id
       and f.start_date > v_year.start_date
       and f.is_closed
  ) then
    raise exception 'later_fiscal_year_closed: a year after % is already closed; re-open it first', v_year.name;
  end if;

  -- 2. The accounts the result travels through, from the country model.

  select * into v_defaults from country_defaults where country = v_company.country;
  if not found then
    raise exception 'unknown_country_template: no country model for %; close_fiscal_year reads its accounts from the pack',
      v_company.country;
  end if;

  if v_defaults.closing_style is null then
    raise exception 'no_closing_defaults: the pack of this company says nothing about how a year is closed. Set defaults.closing_style, and the account roles it needs, in the pack.'
      using errcode = '55006';
  end if;

  v_journal := opening_journal_id(v_year.company_id);
  if v_journal is null then
    raise exception 'no_opening_journal: the pack of this company names no journal of type opening. Set defaults.journal_roles.opening in the pack, which fills country_defaults.opening_journal_code.'
      using errcode = '55006';
  end if;

  -- The result of the year: income less expense, over the accounts that do
  -- not carry forward. A credit balance is a profit.
  select round_amount(coalesce(-sum(l.balance), 0), v_round) into v_result
    from entry_lines l
    join entries e on e.id = l.entry_id and e.state = 'posted'
    join accounts a on a.id = l.account_id
   where l.company_id = v_year.company_id
     and e.entry_date between v_year.start_date and v_year.end_date
     and not a.carries_forward;

  v_profit := v_result >= 0;
  v_kind := case when v_result > 0 then 'profit'
                 when v_result < 0 then 'loss'
                 else 'nil' end;

  v_retained := coalesce(
    case when v_profit then v_company.retained_earnings_account_id end,
    account_id_by_code(v_year.company_id,
      case when v_profit then v_defaults.retained_earnings_code
           else coalesce(v_defaults.retained_earnings_loss_code, v_defaults.retained_earnings_code) end));

  v_cyr := account_id_by_code(v_year.company_id,
    case when v_profit then v_defaults.current_year_result_profit_code
         else v_defaults.current_year_result_loss_code end);

  if v_defaults.closing_style = 'retained_earnings' then
    if v_retained is null then
      raise exception 'no_retained_earnings_account: the country model of % names none, and the company has none',
        v_company.country;
    end if;
    v_cyr := v_retained;
  else
    if v_cyr is null then
      raise exception 'no_current_year_result_account: the country model of % names no account for a %',
        v_company.country, v_kind;
    end if;
  end if;

  -- A style is a promise about where the result sits at the end. Assert it
  -- rather than trust it: a pack that names an income account where the
  -- balance sheet is expected would carry nothing forward, silently.
  select a.carries_forward into v_carries from accounts a where a.id = v_cyr;
  if v_defaults.closing_style = 'appropriation_accounts' and v_carries then
    raise exception 'closing_style_mismatch: % expects an appropriation account inside the income statement, and % carries forward',
      v_defaults.closing_style, v_cyr;
  end if;
  if v_defaults.closing_style <> 'appropriation_accounts' and not v_carries then
    raise exception 'closing_style_mismatch: % expects an account on the balance sheet, and % does not carry forward',
      v_defaults.closing_style, v_cyr;
  end if;

  -- 3. The appropriation entry: the result leaves the income statement
  --    through an account that is itself part of it, and lands on retained
  --    earnings. Only the third style has one, and only when there is a
  --    result to move.

  if v_defaults.closing_style = 'appropriation_accounts' and v_result <> 0 then
    if v_retained is null then
      raise exception 'no_retained_earnings_account: the country model of % names none, and the company has none',
        v_company.country;
    end if;

    perform set_config('ekwo.year_end_entry', 'on', true);
    insert into entries (company_id, journal_id, fiscal_year_id, entry_date,
                         description, state, kind)
    values (v_year.company_id, v_journal, v_year.id, v_year.end_date,
            'Result of the year', 'draft', 'appropriation')
    returning * into v_entry;
    perform set_config('ekwo.year_end_entry', 'off', true);
    v_appropriate := v_entry.id;

    insert into entry_lines (entry_id, company_id, account_id, sequence, name, debit, credit)
    values (v_appropriate, v_year.company_id, v_cyr, 10, 'Result of the year',
            case when v_profit then abs(v_result) else 0 end,
            case when v_profit then 0 else abs(v_result) end),
           (v_appropriate, v_year.company_id, v_retained, 20, 'Result of the year',
            case when v_profit then 0 else abs(v_result) end,
            case when v_profit then abs(v_result) else 0 end);

    perform post_entry(v_appropriate);
  end if;

  -- 4. The closing entry: every income and expense account back to zero.
  --    In the first two styles the difference is the result and goes to the
  --    account chosen above; in the third the accounts already net to zero,
  --    because the appropriation entry put the result among them.

  perform set_config('ekwo.year_end_entry', 'on', true);
  insert into entries (company_id, journal_id, fiscal_year_id, entry_date,
                       description, state, kind)
  values (v_year.company_id, v_journal, v_year.id, v_year.end_date,
          'Closing entry', 'draft', 'closing')
  returning * into v_entry;
  perform set_config('ekwo.year_end_entry', 'off', true);
  v_closing := v_entry.id;

  insert into entry_lines (entry_id, company_id, account_id, sequence, name, debit, credit)
  select v_closing, v_year.company_id, s.account_id,
         row_number() over (order by s.code) * 10,
         'Closing entry',
         case when s.balance < 0 then -s.balance else 0 end,
         case when s.balance > 0 then s.balance else 0 end
    from (
      select a.id as account_id, a.code,
             round_amount(sum(l.balance), v_round) as balance
        from entry_lines l
        join entries e on e.id = l.entry_id and e.state = 'posted'
        join accounts a on a.id = l.account_id
       where l.company_id = v_year.company_id
         and e.entry_date between v_year.start_date and v_year.end_date
         and not a.carries_forward
       group by a.id, a.code
      having round_amount(sum(l.balance), v_round) <> 0
    ) s;

  select count(*) into v_lines from entry_lines where entry_id = v_closing;

  if v_lines = 0 then
    delete from entries where id = v_closing;
    v_closing := null;
  else
    if v_defaults.closing_style <> 'appropriation_accounts' and v_result <> 0 then
      insert into entry_lines (entry_id, company_id, account_id, sequence, name, debit, credit)
      values (v_closing, v_year.company_id, v_cyr, 1000000, 'Result of the year',
              case when v_profit then 0 else abs(v_result) end,
              case when v_profit then abs(v_result) else 0 end);
    end if;

    select total_debit, total_credit into v_debits, v_credits from entries where id = v_closing;
    if v_debits <> v_credits then
      raise exception 'closing_unbalanced: the closing entry has debit % and credit %. The income statement of % does not net to its result.',
        v_debits, v_credits, v_year.name;
    end if;

    perform post_entry(v_closing);
  end if;

  -- 5. The year is closed, and only from here.

  perform set_config('ekwo.closing_fiscal_year', 'on', true);
  update fiscal_years
     set is_closed = true,
         closed_at = now()
   where id = p_fiscal_year_id;
  perform set_config('ekwo.closing_fiscal_year', 'off', true);

  return jsonb_build_object(
    'fiscal_year_id', p_fiscal_year_id,
    'closing_style', v_defaults.closing_style,
    -- The figure is written the way the currency writes it: a yen result
    -- carries no decimals and a dinar one carries three.
    'result', to_char(v_result, amount_text_format(v_round)),
    'result_kind', v_kind,
    'appropriation_entry_id', v_appropriate,
    'closing_entry_id', v_closing
  );
end;
$$;

create or replace function aged_balance(
  p_company_id uuid,
  p_at         date default current_date,
  p_group      text default 'receivable'
)
returns table (
  contact_id   uuid,
  contact_name text,
  account_id   uuid,
  account_code text,
  not_due      numeric,
  days_1_30    numeric,
  days_31_60   numeric,
  days_61_90   numeric,
  days_over_90 numeric,
  total        numeric
)
language plpgsql
stable
as $$
declare
  -- What is still open is read in the ledger's currency, so the ageing is
  -- written at the decimals the company keeps its books in.
  v_round money_rounding;
begin
  if p_group is null or p_group not in ('receivable', 'payable') then
    raise exception 'invalid_group: % is not an ageing group; it is receivable or payable', coalesce(p_group, 'null');
  end if;

  v_round := rounding_of(p_company_id);

  return query
  with open_lines as (
    select l.contact_id,
           l.account_id,
           case when p_group = 'payable' then -l.balance else l.balance end
             * (case when abs(l.balance) = 0 then 0
                     else (abs(l.balance) - l.matched_amount) / abs(l.balance) end) as residual,
           coalesce(l.date_maturity, e.entry_date) as due_date
      from entry_lines l
      join entries e on e.id = l.entry_id
      join accounts a on a.id = l.account_id
     where l.company_id = p_company_id
       and e.state = 'posted'
       and e.entry_date <= p_at
       and a.reconcilable
       and a.account_type = case when p_group = 'payable'
                                 then 'liability_payable'::account_type
                                 else 'asset_receivable'::account_type end
       -- Half a unit of the currency: below that, nothing is open.
       and abs(l.balance) - l.matched_amount > currency_unit(v_round) / 2
  )
  select o.contact_id,
         c.name,
         o.account_id,
         a.code,
         round_amount(sum(o.residual) filter (where o.due_date >= p_at), v_round),
         round_amount(sum(o.residual) filter (where p_at - o.due_date between 1 and 30), v_round),
         round_amount(sum(o.residual) filter (where p_at - o.due_date between 31 and 60), v_round),
         round_amount(sum(o.residual) filter (where p_at - o.due_date between 61 and 90), v_round),
         round_amount(sum(o.residual) filter (where p_at - o.due_date > 90), v_round),
         round_amount(sum(o.residual), v_round)
    from open_lines o
    left join contacts c on c.id = o.contact_id
    join accounts a on a.id = o.account_id
   group by o.contact_id, c.name, o.account_id, a.code
   order by c.name nulls last;
end;
$$;

create or replace function statement_account_matches(
  p_company_id     uuid,
  p_statement_code text,
  p_from           date,
  p_to             date
)
returns table (
  account_id   uuid,
  account_code text,
  account_name text,
  account_type account_type,
  balance      numeric,
  line_code    text
)
language sql
stable
as $$
  with statement as (
    select s.code, s.kind from statement_templates s where s.code = p_statement_code
  ),
  balances as (
    select a.id, a.code, a.name, a.account_type,
           round_amount(coalesce(sum(l.balance), 0), rounding_of(p_company_id)) as balance
      from accounts a
      join entry_lines l on l.account_id = a.id
      join entries e on e.id = l.entry_id
      cross join statement st
     where a.company_id = p_company_id
       and e.state = 'posted'
       and case when st.kind = 'balance_sheet'
                then e.entry_date <= p_to
                else e.entry_date between p_from and p_to
           end
       -- An income statement is what the period earned, and the entry that
       -- closes a year is not that: it books the mirror image of every income
       -- and expense account so they start the next year at nil. Left in, a
       -- closed year reads as a result of zero. An allocation section leaves
       -- it out for the same reason and keeps the appropriation entry, which
       -- is the movement it exists to show. A balance sheet keeps both, and
       -- must: together they are what puts the result on the line it shows.
       and (st.kind not in ('income_statement', 'allocation') or e.kind <> 'closing')
     group by a.id, a.code, a.name, a.account_type
  ),
  ranked as (
    select b.id, b.code, b.name, b.account_type, b.balance, r.line_code,
           row_number() over (
             partition by b.id
             order by case r.rule_kind
                        when 'account_code' then 1
                        when 'code_range'   then 2
                        when 'code_prefix'  then 2
                        else                     3
                      end,
                      length(coalesce(r.code_from, '')) desc,
                      r.sequence, r.line_code
           ) as rank
      from balances b
      join statement_line_rules r on r.statement_code = p_statement_code
     where case r.rule_kind
             when 'account_code' then b.code = r.code_from
             when 'code_prefix'  then left(b.code, length(r.code_from)) = r.code_from
             when 'code_range'   then left(b.code, length(r.code_from)) >= r.code_from
                                  and left(b.code, length(r.code_to))   <= r.code_to
             else                     b.account_type = r.account_type
           end
       and case r.balance_side
             when 'debit'  then b.balance > 0
             when 'credit' then b.balance < 0
             else               true
           end
  )
  select b.id, b.code, b.name, b.account_type, b.balance, r.line_code
    from balances b
    left join ranked r on r.id = b.id and r.rank = 1
   order by b.code;
$$;

-- ---------------------------------------------------------------------------
-- evaluate_totals
--
-- The one evaluator the declaration forms and the statements share. It is
-- immutable and looks nothing up, so the rounding reaches it as an argument
-- rather than as a lookup — which is also what keeps it usable from both.
-- The three-argument form is dropped rather than left beside the new one: two
-- overloads where one silently rounds at two decimals is the bug this
-- migration exists to remove.
-- ---------------------------------------------------------------------------

drop function if exists evaluate_totals(jsonb, jsonb, boolean);

create or replace function evaluate_totals(
  p_values    jsonb,
  p_formulas  jsonb,
  p_rounding  money_rounding,
  p_keep_zero boolean default false
)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_values  jsonb := coalesce(p_values, '{}'::jsonb);
  v_out     jsonb := '{}'::jsonb;
  v_done    jsonb := '{}'::jsonb;
  v_all     jsonb := coalesce(p_formulas, '[]'::jsonb);
  v_left    integer;
  v_settled integer;
  v_ready   boolean;
  v_amount  numeric;
  v_part    numeric;
  v_refs    text[];
  v_ref     text;
  v_key     text;
  v_stuck   text;
  f         jsonb;
begin
  select count(*) into v_left from jsonb_array_elements(v_all);

  while v_left > 0 loop
    v_settled := 0;

    for f in
      select t.x from jsonb_array_elements(v_all) with ordinality as t(x, ord)
       order by coalesce((t.x ->> 'sequence')::integer, 0), t.ord
    loop
      v_key := f ->> 'key';
      if v_done ? v_key then
        continue;
      end if;

      select coalesce(array_agg(e.value), '{}'::text[]) into v_refs
        from (
          select jsonb_array_elements_text(coalesce(f -> 'plus', '[]'::jsonb)) as value
          union all
          select jsonb_array_elements_text(coalesce(f -> 'minus', '[]'::jsonb))
        ) as e;

      -- Ready when every reference that names another formula has been worked
      -- out already.
      v_ready := true;
      foreach v_ref in array v_refs loop
        if exists (
          select 1 from jsonb_array_elements(v_all) as g(x)
           where (g.x ->> 'key') <> v_key
             and not (v_done ? (g.x ->> 'key'))
             and case when strpos(v_ref, ':') > 0
                      then (g.x ->> 'key') = replace(v_ref, ':', '|')
                      else split_part((g.x ->> 'key'), '|', 1) = v_ref
                 end
        ) then
          v_ready := false;
        end if;
      end loop;
      if not v_ready then
        continue;
      end if;

      v_amount := 0;
      for v_ref in
        select jsonb_array_elements_text(coalesce(f -> 'plus', '[]'::jsonb))
      loop
        select coalesce(sum(e.value::numeric), 0) into v_part
          from jsonb_each_text(v_values) as e(key, value)
         where case when strpos(v_ref, ':') > 0
                    then e.key = replace(v_ref, ':', '|')
                    else split_part(e.key, '|', 1) = v_ref
               end;
        v_amount := v_amount + v_part;
      end loop;
      for v_ref in
        select jsonb_array_elements_text(coalesce(f -> 'minus', '[]'::jsonb))
      loop
        select coalesce(sum(e.value::numeric), 0) into v_part
          from jsonb_each_text(v_values) as e(key, value)
         where case when strpos(v_ref, ':') > 0
                    then e.key = replace(v_ref, ':', '|')
                    else split_part(e.key, '|', 1) = v_ref
               end;
        v_amount := v_amount - v_part;
      end loop;

      -- The floor belongs to the pair it splits — the Belgian 71 and 72, the
      -- French 25 and 28 — so it applies before the sign the caller reads the
      -- line with.
      if coalesce((f ->> 'floor_zero')::boolean, false) then
        v_amount := greatest(v_amount, 0);
      end if;
      v_amount := round_amount(v_amount * coalesce((f ->> 'factor')::numeric, 1), p_rounding);

      v_values := v_values || jsonb_build_object(v_key, v_amount);
      v_done   := v_done   || jsonb_build_object(v_key, true);
      if p_keep_zero or v_amount <> 0 then
        v_out := v_out || jsonb_build_object(v_key, v_amount);
      end if;
      v_settled := v_settled + 1;
      v_left := v_left - 1;
    end loop;

    if v_settled = 0 then
      select string_agg(t.x ->> 'key', ', ' order by t.x ->> 'key') into v_stuck
        from jsonb_array_elements(v_all) as t(x)
       where not (v_done ? (t.x ->> 'key'));
      raise exception 'formula_cycle: these totals depend on each other and on nothing else: %', v_stuck;
    end if;
  end loop;

  return v_out;
end;
$$;

create or replace function financial_statement(
  p_company_id     uuid,
  p_statement_code text,
  p_from           date,
  p_to             date
)
returns table (
  line_code    text,
  parent_code  text,
  name         text,
  sequence     integer,
  is_total     boolean,
  amount       numeric,
  xbrl_element text
)
language plpgsql
stable
as $$
declare
  -- line code -> amount: the lines summed from the ledger, then the totals
  -- `evaluate_totals()` derives from them.
  v_values   jsonb := '{}'::jsonb;
  v_formulas jsonb := '[]'::jsonb;
  v_rows     jsonb := '[]'::jsonb;
  -- A statement is the ledger read back, so it is written with the decimals
  -- of the currency the ledger is kept in.
  v_round    money_rounding;
  r          record;
begin
  if not exists (select 1 from companies c where c.id = p_company_id) then
    raise exception 'unknown_company: %', p_company_id;
  end if;
  v_round := rounding_of(p_company_id);
  if not exists (select 1 from statement_templates s where s.code = p_statement_code) then
    raise exception 'unknown_statement: % is not a statement of this installation', p_statement_code;
  end if;

  -- 1. The lines summed from the ledger. All of them first, whatever their
  --    place in the scheme: a scheme prints a subtotal above the lines it adds
  --    up — every balance sheet does — and only a total that names another
  --    total depends on an order, which the evaluator keeps.
  select coalesce(jsonb_object_agg(l.code,
           round_amount(coalesce(s.balance, 0) * l.sign, v_round)), '{}'::jsonb)
    into v_values
    from statement_line_templates l
    left join (
      select m.line_code, round_amount(sum(m.balance), v_round) as balance
        from statement_account_matches(p_company_id, p_statement_code, p_from, p_to) m
       where m.line_code is not null
       group by m.line_code
    ) s on s.line_code = l.code
   where l.statement_code = p_statement_code
     and not l.is_total;

  -- 2. The totals, worked out by the one evaluator the declaration forms use.
  --    A statement prints its whole frame, so every total comes back, and the
  --    sign it reads the line with is the factor.
  select coalesce(jsonb_agg(jsonb_build_object(
           'key', l.code, 'plus', to_jsonb(l.plus_lines), 'minus', to_jsonb(l.minus_lines),
           'factor', l.sign, 'sequence', l.sequence
         ) order by l.sequence, l.code), '[]'::jsonb)
    into v_formulas
    from statement_line_templates l
   where l.statement_code = p_statement_code
     and l.is_total;

  v_values := v_values || evaluate_totals(v_values, v_formulas, v_round, true);

  -- 3. The frame, in the order it is printed. Every line is returned, nil
  --    included: a statement is read top to bottom and tied out, where a
  --    declaration prints what it has — which is why `vat_return()` drops a
  --    nil box and this does not.
  for r in
    select l.code, l.parent_code, l.name, l.sequence, l.is_total, l.xbrl_element
      from statement_line_templates l
     where l.statement_code = p_statement_code
     order by l.sequence, l.code
  loop
    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'line_code', r.code, 'parent_code', r.parent_code, 'name', r.name,
      'sequence', r.sequence, 'is_total', r.is_total,
      'amount', coalesce((v_values ->> r.code)::numeric, 0),
      'xbrl_element', r.xbrl_element));
  end loop;

  return query
  select (x ->> 'line_code')::text,
         (x ->> 'parent_code')::text,
         (x ->> 'name')::text,
         (x ->> 'sequence')::integer,
         (x ->> 'is_total')::boolean,
         (x ->> 'amount')::numeric,
         (x ->> 'xbrl_element')::text
    from jsonb_array_elements(v_rows) as x;
end;
$$;

create or replace function vat_return(
  p_company_id  uuid,
  p_from        date,
  p_to          date,
  p_report_code text default null
)
returns table (
  box         text,
  kind        text,
  amount      numeric,
  computed    boolean,
  name        text,
  sequence    integer,
  hidden      boolean,
  report_code text
)
language plpgsql
stable
as $$
declare
  -- 'box|kind' -> amount, for every box summed from the ledger, then the
  -- totals `evaluate_totals()` derives from them. The key carries the kind
  -- because the French CA3 puts a base and a tax on line 08 and a formula has
  -- to be able to name one of them.
  v_values   jsonb := '{}'::jsonb;
  v_formulas jsonb := '[]'::jsonb;
  v_totals   jsonb := '{}'::jsonb;
  v_rows     jsonb := '[]'::jsonb;
  v_country  char(2);
  v_report   text;
  v_in       char(2);
  v_count    integer;
  v_codes    text;
  -- A declaration figure is not a ledger figure, but it is written in the
  -- same currency and with the same decimals.
  v_round    money_rounding;
  r          record;
begin
  select c.fiscal_country into v_country from companies c where c.id = p_company_id;
  if not found then
    raise exception 'unknown_company: %', p_company_id;
  end if;
  v_round := rounding_of(p_company_id);

  -- Which form. The caller names one, or the country files exactly one on
  -- that date. Two and no name is a question only the caller can answer — a
  -- Canadian company files the federal return and the Québec one at once — so
  -- this asks instead of guessing.
  if p_report_code is not null then
    select t.country, t.code into v_in, v_report
      from tax_report_templates t
     where t.code = p_report_code
       and t.valid_from <= p_to
       and (t.valid_to is null or t.valid_to >= p_to)
     order by t.country
     limit 1;
    if v_report is null then
      raise exception 'unknown_tax_report: % is not a declaration form in force on %',
        p_report_code, p_to;
    end if;
  else
    select count(*), min(t.code), string_agg(t.code, ', ' order by t.code)
      into v_count, v_report, v_codes
      from tax_report_templates t
     where t.country = v_country
       and t.is_periodic_return
       and t.valid_from <= p_to
       and (t.valid_to is null or t.valid_to >= p_to);
    if v_count > 1 then
      raise exception 'ambiguous_tax_report: % files several declarations on % (%); name one',
        v_country, p_to, v_codes;
    end if;
    v_in := v_country;
    if v_count = 0 then
      v_report := null;  -- no pack for this country: the ledger boxes, and no total.
    end if;
  end if;

  -- 1. What the tax postings wrote on the ledger. Unchanged: this half never
  --    knew a country.
  for r in
    with ledger as (
      select l.declaration_box as lbox,
             case when l.tax_line then 'tax' else 'base' end as lkind,
             round_amount(sum(l.box_amount), v_round) as lamount
        from entry_lines l
        join entries e on e.id = l.entry_id
       where l.company_id = p_company_id
         and e.state = 'posted'
         and e.entry_date between p_from and p_to
         and l.declaration_box is not null
         -- A box number belongs to one form. A line whose posting names
         -- another form is not on this declaration; one that names none is
         -- the single-return case every European company is in.
         and (v_report is null or coalesce((
               select min(tp.report_code)
                 from tax_postings tp
                where tp.tax_id = l.tax_id
                  and tp.declaration_box = l.declaration_box
                  and tp.posting_type =
                      (case when l.tax_line then 'tax' else 'base' end)::tax_posting_type
             ), v_report) = v_report)
       group by 1, 2
      having round_amount(sum(l.box_amount), v_round) <> 0
    )
    select g.lbox, g.lkind, g.lamount, b.name as lname,
           b.sequence as lsequence, coalesce(b.hidden, false) as lhidden
      from ledger g
      left join tax_report_box_templates b
        on b.country = v_in and b.report_code = v_report
       and b.box = g.lbox and b.kind = g.lkind
     order by coalesce(b.sequence, 2147483647), g.lbox, g.lkind
  loop
    v_values := v_values || jsonb_build_object(r.lbox || '|' || r.lkind, r.lamount);
    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'box', r.lbox, 'kind', r.lkind, 'amount', r.lamount, 'computed', false,
      'name', r.lname, 'sequence', r.lsequence, 'hidden', r.lhidden,
      'report_code', v_report));
  end loop;

  -- 2. The totals of the form, through the evaluator the statements use. A
  --    return prints what it has, so a nil total is left out of the answer —
  --    and kept in the working set, so a later total that names it reads a
  --    zero rather than a gap.
  if v_report is not null then
    select coalesce(jsonb_agg(jsonb_build_object(
             'key', b.box || '|total', 'plus', to_jsonb(b.plus_boxes),
             'minus', to_jsonb(b.minus_boxes), 'floor_zero', b.floor_zero,
             'sequence', b.sequence
           ) order by b.sequence, b.box), '[]'::jsonb)
      into v_formulas
      from tax_report_box_templates b
     where b.country = v_in
       and b.report_code = v_report
       and b.kind = 'total'
       and (b.valid_from is null or b.valid_from <= p_to)
       and (b.valid_to is null or b.valid_to >= p_to);

    v_totals := evaluate_totals(v_values, v_formulas, v_round, false);

    for r in
      select b.box as tbox, b.name as tname, b.sequence as tsequence, b.hidden as thidden
        from tax_report_box_templates b
       where b.country = v_in
         and b.report_code = v_report
         and b.kind = 'total'
         and (b.valid_from is null or b.valid_from <= p_to)
         and (b.valid_to is null or b.valid_to >= p_to)
         and v_totals ? (b.box || '|total')
       order by b.sequence, b.box
    loop
      v_rows := v_rows || jsonb_build_array(jsonb_build_object(
        'box', r.tbox, 'kind', 'total',
        'amount', (v_totals ->> (r.tbox || '|total'))::numeric, 'computed', true,
        'name', r.tname, 'sequence', r.tsequence, 'hidden', r.thidden,
        'report_code', v_report));
    end loop;
  end if;

  return query
  select (x ->> 'box')::text,
         (x ->> 'kind')::text,
         (x ->> 'amount')::numeric,
         (x ->> 'computed')::boolean,
         (x ->> 'name')::text,
         (x ->> 'sequence')::integer,
         (x ->> 'hidden')::boolean,
         (x ->> 'report_code')::text
    from jsonb_array_elements(v_rows) as x;
end;
$$;

create or replace function fec_lines(
  p_company_id uuid,
  p_from       date,
  p_to         date
)
returns table (
  journal_code   text,
  journal_lib    text,
  ecriture_num   text,
  ecriture_date  date,
  compte_num     text,
  compte_lib     text,
  comp_aux_num   text,
  comp_aux_lib   text,
  piece_ref      text,
  piece_date     date,
  ecriture_lib   text,
  debit          numeric,
  credit         numeric,
  ecriture_let   text,
  date_let       date,
  valid_date     date,
  montant_devise numeric,
  idevise        text
)
language plpgsql
stable
as $$
declare
  v_year        fiscal_years%rowtype;
  v_defaults    country_defaults%rowtype;
  v_journal     journals%rowtype;
  v_label       text;
  v_number      text;
  v_result      numeric := 0;
  -- The file is the ledger written out, so the opening lines carry the same
  -- decimals as the movements below them.
  v_round       money_rounding;
  v_carried     integer := 0;
  v_role        text;
  v_account     uuid;
  v_result_code text;
  v_result_name text;
  v_carries     boolean;
begin
  v_round := rounding_of(p_company_id);

  -- 1. Is this the file of a whole financial year? Only then are there
  --    opening balances to carry.

  select f.* into v_year
    from fiscal_years f
   where f.company_id = p_company_id
     and f.start_date = p_from
     and f.end_date = p_to;

  if found then
    -- What stands on the day before the year opens. `trial_balance` is where
    -- this repository computes a cumulative balance, and computing it a
    -- second time here is how the two would start to disagree.
    select coalesce(round_amount(sum(t.opening_balance) filter (where not a.carries_forward),
                                 v_round), 0),
           count(*) filter (where a.carries_forward
                              and round_amount(t.opening_balance, v_round) <> 0)
      into v_result, v_carried
      from trial_balance(p_company_id, p_from, p_to) t
      join accounts a on a.id = t.account_id;

    -- A first set of books has nothing to carry, and asks the pack for
    -- nothing. Everything below is needed only when there is a balance.
    if v_carried > 0 or v_result <> 0 then
      select d.* into v_defaults
        from companies c
        join country_defaults d on d.country = c.country
       where c.id = p_company_id;

      select j.* into v_journal from journals j where j.id = opening_journal_id(p_company_id);
      if not found then
        raise exception 'no_opening_journal: the pack of this company names no journal of type opening, and the opening balances of a financial year are booked on one. Set defaults.journal_roles.opening in the pack, which fills country_defaults.opening_journal_code.'
          using errcode = '55006';
      end if;

      v_label := coalesce(v_defaults.opening_entry_label, 'Opening balance');

      -- One entry, so the file has one balanced *à-nouveaux* rather than as
      -- many single-sided entries as there are accounts. The number is built
      -- from the journal the pack names and the day the year opens, which
      -- makes it stable across two exports of the same year and distinct
      -- between years — including two short years inside one calendar year.
      v_number := v_journal.code || '-' || to_char(v_year.start_date, 'YYYYMMDD');

      -- 2. The result of the years that are not closed yet, on the account
      --    the close would have left it on. `result_accounts` keeps it on a
      --    balance-sheet account of its own until a meeting allocates it;
      --    the other two styles have already reached retained earnings by the
      --    time the year is over — an appropriation account is inside the
      --    income statement and the closing entry empties it, so it is never
      --    what a balance sheet carries forward.
      if v_result <> 0 then
        v_role := case v_defaults.closing_style
                    when 'result_accounts' then
                      case when v_result < 0 then v_defaults.current_year_result_profit_code
                           else v_defaults.current_year_result_loss_code end
                    when 'appropriation_accounts' then
                      case when v_result < 0 then v_defaults.retained_earnings_code
                           else coalesce(v_defaults.retained_earnings_loss_code,
                                         v_defaults.retained_earnings_code) end
                    when 'retained_earnings' then
                      case when v_result < 0 then v_defaults.retained_earnings_code
                           else coalesce(v_defaults.retained_earnings_loss_code,
                                         v_defaults.retained_earnings_code) end
                  end;

        -- A company may name its own retained earnings account, and
        -- `close_fiscal_year` prefers it for a profit. The same preference
        -- here, or the two would carry the result to two different places.
        if v_result < 0 and v_defaults.closing_style is distinct from 'result_accounts' then
          select c.retained_earnings_account_id into v_account
            from companies c where c.id = p_company_id;
        end if;
        v_account := coalesce(v_account, account_id_by_code(p_company_id, v_role));

        if v_account is null then
          raise exception 'no_result_account: the books hold a result of % that no year has closed, and the country model of this company names no balance-sheet account to carry it to. Set defaults.closing_style and the account roles it needs in the pack.',
            to_char(-v_result, amount_text_format(v_round))
            using errcode = '55006';
        end if;

        select a.code, a.name, a.carries_forward
          into v_result_code, v_result_name, v_carries
          from accounts a where a.id = v_account;

        if not v_carries then
          raise exception 'no_result_account: % is an income or expense account, and an opening balance is made of the balance sheet. The country model names it for a result that no year has closed; name an account that carries forward.',
            v_result_code
            using errcode = '55006';
        end if;
      end if;

      -- 3. The lines themselves. The account rows and the result row share
      --    one shape, so the side is chosen once: a positive balance is a
      --    debit, and a sign never reaches the file.
      return query
        with opening as (
          select t.account_code as code,
                 t.account_name as name,
                 round_amount(t.opening_balance, v_round) as balance
            from trial_balance(p_company_id, p_from, p_to) t
            join accounts a on a.id = t.account_id
           where a.carries_forward
             and round_amount(t.opening_balance, v_round) <> 0
          union all
          select v_result_code, v_result_name, v_result
           where v_result <> 0
        )
        select v_journal.code,
               v_journal.name,
               v_number,
               p_from,
               o.code,
               o.name,
               null::text,
               null::text,
               v_number,
               p_from,
               v_label,
               -- Down to the scale the ledger keeps, so an opening line and a
               -- movement line come back in the same shape.
               round_amount(case when o.balance > 0 then o.balance else 0 end, v_round),
               round_amount(case when o.balance < 0 then -o.balance else 0 end, v_round),
               null::text,
               null::date,
               p_from,
               null::numeric,
               null::text
          from opening o
         order by o.code;
    end if;
  end if;

  -- 4. The movements of the period, as before, less the entries the close
  --    wrote inside it.

  return query
    select j.code,
           j.name,
           e.number,
           e.entry_date,
           a.code,
           a.name,
           c.auxiliary_code,
           case when c.auxiliary_code is not null then c.name end,
           coalesce(d.number, d.supplier_reference, e.reference, e.number),
           coalesce(d.document_date, e.entry_date),
           coalesce(nullif(l.name, ''), e.description, a.name),
           l.debit,
           l.credit,
           l.matching_number,
           (select max(r.matched_at) from reconciliations r
             where r.debit_line_id = l.id or r.credit_line_id = l.id),
           coalesce(e.posted_at::date, e.entry_date),
           case when l.currency_code is not null and l.currency_code <> co.currency_code
                then l.amount_currency end,
           -- `char(3)` where the column of this function is `text`: RETURN
           -- QUERY matches types exactly, where the SQL body this replaces
           -- coerced them on the way out.
           case when l.currency_code is not null and l.currency_code <> co.currency_code
                then l.currency_code::text end
      from entry_lines l
      join entries e   on e.id = l.entry_id
      join journals j  on j.id = e.journal_id
      join accounts a  on a.id = l.account_id
      join companies co on co.id = l.company_id
      left join contacts c on c.id = l.contact_id
      left join documents d on d.id = e.document_id
     where l.company_id = p_company_id
       and e.state = 'posted'
       and e.entry_date between p_from and p_to
       and e.kind not in ('closing', 'appropriation')
     order by e.entry_date, e.number, l.sequence, l.id;
end;
$$;

comment on function aged_balance(uuid, date, text) is
  'Ageing of what is still open, read from the ledger and from the matching, written at the decimals of the company''s currency. Two groups, receivable and payable; anything else is refused by name.';

comment on function evaluate_totals(jsonb, jsonb, money_rounding, boolean) is
  'Works out the totals of a declaration form or a statement from the figures below them, rounding each at the decimals of the currency it is stated in.';

revoke execute on function evaluate_totals(jsonb, jsonb, money_rounding, boolean) from public, anon;
grant execute on function evaluate_totals(jsonb, jsonb, money_rounding, boolean) to authenticated, service_role;

-- A trigger function runs as the statement that fired it and is called by
-- nobody directly, so it is open to nobody.
revoke execute on function document_lines_amount_untaxed() from public, anon;

-- ---------------------------------------------------------------------------
-- Two columns stop being a promise
--
-- `20260913105120` marked five columns "declared, no reader yet", because a
-- column with a plausible name and no reader is read as behaviour. Two of the
-- five now have one, and `docs/schema.md` is generated from these comments.
-- The other three — `cash_rounding_unit`, `bank_statement_formats`,
-- `payment_formats` — are still promises and their comments are untouched.
-- ---------------------------------------------------------------------------

comment on column currencies.decimal_places is
  'Decimals this currency is written with: 2 for the euro, 0 for the yen, 3 for the dinar. Read by rounding_of(), which is what every amount in the schema is rounded at. The columns that hold an amount are still numeric(16, 2), so a currency with more than two decimals is rounded right and stored short until they are widened.';

comment on column country_defaults.rounding_method is
  'How a country rounds an amount, from the pack. Read by rounding_of() and applied by round_amount(), which is the only function of the schema that names a method. A pack that says nothing about rounding gets this column''s own default, not a country''s.';

revoke execute on all functions in schema public from public;
