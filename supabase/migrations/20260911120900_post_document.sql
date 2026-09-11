-- Ekwo OS — turning a document into a journal entry.
--
-- Rules this function keeps, each of them a bug seen in the wild:
--   * amounts are always positive; a credit note flips the side, it does not
--     negate;
--   * the counterpart line is the difference of the lines already written, so
--     the entry is balanced by construction and the document header is what
--     gets challenged, never the ledger;
--   * accounts are resolved by role (contact, then company default), never by
--     matching a code prefix;
--   * a tax that nets to zero is still booked on both sides and still feeds
--     its declaration boxes, so the ledger and the VAT return agree;
--   * anything that goes wrong raises. A swallowed error is a missing entry.

create or replace function resolve_counterpart_account(
  p_company_id uuid,
  p_contact_id uuid,
  p_is_sale    boolean
)
returns uuid
language plpgsql
stable
as $$
declare
  v_account uuid;
begin
  if p_is_sale then
    select c.receivable_account_id into v_account from contacts c where c.id = p_contact_id;
    if v_account is null then
      select co.receivable_account_id into v_account from companies co where co.id = p_company_id;
    end if;
  else
    select c.payable_account_id into v_account from contacts c where c.id = p_contact_id;
    if v_account is null then
      select co.payable_account_id into v_account from companies co where co.id = p_company_id;
    end if;
  end if;

  if v_account is null then
    raise exception 'no_counterpart_account: set receivable_account_id / payable_account_id on the contact or the company';
  end if;
  return v_account;
end;
$$;

comment on function resolve_counterpart_account(uuid, uuid, boolean) is
  'Third-party account by role: contact override first, company default second. Never by code prefix.';


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
  v_amount     numeric(16, 2);
  v_side_credit boolean;
  v_label      text;
  r            record;
  p            record;
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
    select tp.declaration_box, tp.factor_percent, tp.box_factor_percent
      into p
      from tax_postings tp
     where tp.tax_id = r.tax_id
       and tp.document_kind = v_kind
       and tp.posting_type = 'base'
     limit 1;

    v_amount := round(r.base_amount * coalesce(p.factor_percent, 100) / 100, 2);
    v_seq := v_seq + 10;

    insert into entry_lines (entry_id, company_id, account_id, sequence, name,
                             debit, credit, tax_id, tax_line,
                             declaration_box, box_amount, currency_code)
    values (v_entry.id, v_doc.company_id, r.account_id, v_seq, left(r.label, 200),
            case when v_base_credit then 0 else v_amount end,
            case when v_base_credit then v_amount else 0 end,
            r.tax_id, false,
            p.declaration_box,
            case when p.declaration_box is null then null
                 else round(r.base_amount * coalesce(p.box_factor_percent, 100) / 100, 2) end,
            v_doc.currency_code);
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
    for p in
      select tp.factor_percent, tp.account_id, tp.declaration_box, tp.box_factor_percent
        from tax_postings tp
       where tp.tax_id = r.tax_id
         and tp.document_kind = v_kind
         and tp.posting_type = 'tax'
       order by tp.sequence, tp.id
    loop
      v_amount := round(r.tax_amount * abs(p.factor_percent) / 100, 2);
      if v_amount = 0 then
        continue;
      end if;
      -- A positive factor keeps the side of the base, a negative one flips it.
      v_side_credit := case when p.factor_percent >= 0 then v_base_credit else not v_base_credit end;
      v_seq := v_seq + 10;

      insert into entry_lines (entry_id, company_id, account_id, sequence, name,
                               debit, credit, tax_id, tax_line,
                               declaration_box, box_amount, currency_code)
      values (v_entry.id, v_doc.company_id, p.account_id, v_seq, r.tax_name,
              case when v_side_credit then 0 else v_amount end,
              case when v_side_credit then v_amount else 0 end,
              r.tax_id, true,
              p.declaration_box,
              case when p.declaration_box is null then null
                   else round(r.tax_amount * coalesce(p.box_factor_percent, 100) / 100, 2) end,
              v_doc.currency_code);
    end loop;
  end loop;

  -- ------------------------------------------------------------ counterpart
  select total_debit - total_credit into v_diff from entries where id = v_entry.id;

  if v_diff = 0 then
    raise exception 'document_counterpart_zero: document % produced a nil counterpart', p_document_id;
  end if;

  v_contact := commercial_entity(v_doc.contact_id);
  v_counterpart := resolve_counterpart_account(v_doc.company_id, v_contact, v_is_sale);

  select payment_terms_days into v_terms from contacts where id = v_contact;
  v_maturity := coalesce(v_doc.due_date, v_doc.document_date + coalesce(v_terms, 30));

  v_amount := abs(v_diff);
  v_seq := v_seq + 10;

  insert into entry_lines (entry_id, company_id, account_id, sequence, name,
                           debit, credit, contact_id, date_maturity, currency_code)
  values (v_entry.id, v_doc.company_id, v_counterpart, v_seq, v_label,
          case when v_diff > 0 then 0 else v_amount end,
          case when v_diff > 0 then v_amount else 0 end,
          v_contact, v_maturity, v_doc.currency_code);

  -- The ledger is right by construction. If the header disagrees, the header
  -- is what is wrong, and we say so instead of quietly patching a line.
  if abs(v_amount - abs(v_doc.amount_total)) > 0.005 then
    raise exception 'document_total_mismatch: document % totals % but its lines book %',
      p_document_id, v_doc.amount_total, v_amount;
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
  'Books a document: base lines, tax lines from tax_postings, and a counterpart that balances by construction.';
