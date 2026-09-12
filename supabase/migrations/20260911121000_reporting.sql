-- Ekwo OS — the reports the schema exists for.
--
-- Every one of them filters posted entries in the WHERE clause, never in a
-- LEFT JOIN condition: a draft line that survives an outer join is how a
-- trial balance silently stops tying out.

-- ---------------------------------------------------------------------------
-- trial_balance
-- ---------------------------------------------------------------------------

create or replace function trial_balance(
  p_company_id uuid,
  p_from       date,
  p_to         date
)
returns table (
  account_id       uuid,
  account_code     text,
  account_name     text,
  account_type     account_type,
  internal_group   text,
  opening_balance  numeric,
  debit            numeric,
  credit           numeric,
  closing_balance  numeric
)
language sql
stable
as $$
  select a.id,
         a.code,
         a.name,
         a.account_type,
         a.internal_group,
         coalesce(sum(l.balance) filter (where e.entry_date < p_from), 0)::numeric as opening_balance,
         coalesce(sum(l.debit)   filter (where e.entry_date between p_from and p_to), 0)::numeric as debit,
         coalesce(sum(l.credit)  filter (where e.entry_date between p_from and p_to), 0)::numeric as credit,
         coalesce(sum(l.balance) filter (where e.entry_date <= p_to), 0)::numeric as closing_balance
    from accounts a
    left join entry_lines l on l.account_id = a.id
    left join entries e on e.id = l.entry_id and e.state = 'posted'
   where a.company_id = p_company_id
     -- Kill the outer-join leak: a line whose entry is not posted is dropped.
     and (l.id is null or e.id is not null)
     and (e.id is null or e.entry_date <= p_to)
   group by a.id, a.code, a.name, a.account_type, a.internal_group
   order by a.code;
$$;

comment on function trial_balance(uuid, date, date) is
  'Opening balance, movements of the period and closing balance per account, posted entries only.';

-- ---------------------------------------------------------------------------
-- general_ledger
-- ---------------------------------------------------------------------------

create or replace function general_ledger(
  p_company_id uuid,
  p_from       date,
  p_to         date,
  p_account_ids uuid[] default null
)
returns table (
  account_id      uuid,
  account_code    text,
  account_name    text,
  entry_line_id   uuid,
  entry_id        uuid,
  entry_number    text,
  entry_date      date,
  journal_code    text,
  reference       text,
  line_name       text,
  contact_name    text,
  debit           numeric,
  credit          numeric,
  matching_number text,
  running_balance numeric
)
language sql
stable
as $$
  with opening as (
    select l.account_id, sum(l.balance) as balance
      from entry_lines l
      join entries e on e.id = l.entry_id
     where l.company_id = p_company_id
       and e.state = 'posted'
       and e.entry_date < p_from
     group by l.account_id
  ),
  movements as (
    select l.id, l.account_id, l.entry_id, e.number, e.entry_date, j.code as journal_code,
           e.reference, l.name, c.name as contact_name, l.debit, l.credit, l.balance,
           l.matching_number, l.sequence
      from entry_lines l
      join entries e on e.id = l.entry_id
      join journals j on j.id = e.journal_id
      left join contacts c on c.id = l.contact_id
     where l.company_id = p_company_id
       and e.state = 'posted'
       and e.entry_date between p_from and p_to
  )
  select a.id, a.code, a.name,
         m.id, m.entry_id, m.number, m.entry_date, m.journal_code, m.reference,
         m.name, m.contact_name, m.debit, m.credit, m.matching_number,
         (coalesce(o.balance, 0)
          + sum(m.balance) over (partition by a.id
                                 order by m.entry_date, m.number, m.sequence, m.id
                                 rows between unbounded preceding and current row))::numeric
    from movements m
    join accounts a on a.id = m.account_id
    left join opening o on o.account_id = a.id
   where p_account_ids is null or a.id = any (p_account_ids)
   order by a.code, m.entry_date, m.number, m.sequence, m.id;
$$;

comment on function general_ledger(uuid, date, date, uuid[]) is
  'Posted lines of a period per account, with the balance carried forward from before the period.';

-- ---------------------------------------------------------------------------
-- aged_balance
--
-- Read from the ledger and from what is still unmatched, not from documents.
-- An aged balance built on invoices can never tie back to the balance sheet.
-- ---------------------------------------------------------------------------

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
language sql
stable
as $$
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
       and abs(l.balance) - l.matched_amount > 0.005
  )
  select o.contact_id,
         c.name,
         o.account_id,
         a.code,
         round(sum(o.residual) filter (where o.due_date >= p_at), 2),
         round(sum(o.residual) filter (where p_at - o.due_date between 1 and 30), 2),
         round(sum(o.residual) filter (where p_at - o.due_date between 31 and 60), 2),
         round(sum(o.residual) filter (where p_at - o.due_date between 61 and 90), 2),
         round(sum(o.residual) filter (where p_at - o.due_date > 90), 2),
         round(sum(o.residual), 2)
    from open_lines o
    left join contacts c on c.id = o.contact_id
    join accounts a on a.id = o.account_id
   group by o.contact_id, c.name, o.account_id, a.code
   order by c.name nulls last;
$$;

comment on function aged_balance(uuid, date, text) is
  'Open receivables (or payables) by age, from unmatched ledger lines. p_group is ''receivable'' or ''payable''.';

-- ---------------------------------------------------------------------------
-- vat_return
--
-- Aggregates whatever the tax postings wrote on the lines. No country rule
-- lives here: boxes come from the data.
--
-- This function was published with the two balance boxes of the Belgian frame
-- VI computed inline, behind a test on the company's fiscal country. That was
-- the one country rule left in the core, and it was removed from this file on
-- 12 September 2026 rather than only overridden later: no installation
-- anywhere had run it, and a country literal in a published migration is a
-- country literal in the repository. The totals now come from the declaration
-- form of the country pack, in `20260912090407_tax_report_boxes`, which
-- replaces this function.
-- ---------------------------------------------------------------------------

create or replace function vat_return(
  p_company_id uuid,
  p_from       date,
  p_to         date
)
returns table (
  box      text,
  kind     text,
  amount   numeric,
  computed boolean
)
language sql
stable
as $$
  with boxes as (
    select l.declaration_box as box,
           case when l.tax_line then 'tax' else 'base' end as kind,
           round(sum(l.box_amount), 2) as amount
      from entry_lines l
      join entries e on e.id = l.entry_id
     where l.company_id = p_company_id
       and e.state = 'posted'
       and e.entry_date between p_from and p_to
       and l.declaration_box is not null
     group by 1, 2
    having round(sum(l.box_amount), 2) <> 0
  )
  select b.box, b.kind, b.amount, false from boxes b
   order by 1, 2;
$$;

comment on function vat_return(uuid, date, date) is
  'VAT return boxes for a period, summed from the declaration boxes written on the ledger lines.';
