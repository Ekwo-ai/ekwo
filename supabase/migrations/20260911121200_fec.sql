-- Ekwo OS — the French FEC, as a query.
--
-- Eighteen columns fixed by the arrete du 29 juillet 2013 (art. A. 47 A-1 du
-- LPF). The schema was shaped so this needs no application logic: the letter
-- comes from `reconciliations`, the sub-ledger code from
-- `contacts.auxiliary_code`, the validation date from `entries.posted_at`.

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
language sql
stable
as $$
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
         case when l.currency_code is not null and l.currency_code <> co.currency_code
              then l.currency_code end
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
   order by e.entry_date, e.number, l.sequence, l.id;
$$;

comment on function fec_lines(uuid, date, date) is
  'The eighteen columns of the French FEC for a period, in chronological order.';
