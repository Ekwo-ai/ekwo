-- Ekwo OS (budgets) — a plan and what was booked against it are written at
-- the decimals of the company's currency.
--
-- `budgets.variance()` cast its three figures to `numeric(16, 2)`, which is a
-- rounding to two decimals wearing the clothes of a type. A plan stated in a
-- currency with no decimals came back with two of them, and the variance
-- between a plan and a ledger that both hold whole units read as a fraction.
--
-- The three casts become `public.round_amount`, which asks the company what
-- its currency is. Nothing else about the reading changes: the sign a business
-- states a figure in, and the closing entries left out of it, are as they were.

create or replace function budgets.variance(
  p_company_id uuid,
  p_budget_id  uuid,
  p_from       date,
  p_to         date
)
returns table (
  account_code text,
  account_name text,
  budget       numeric,
  actual       numeric,
  variance     numeric
)
language sql
stable
as $$
  with planned as (
    select l.account_id, sum(l.amount) as amount
      from budgets.lines l
     where l.budget_id = p_budget_id
       and l.company_id = p_company_id
       and l.period_start >= p_from
       and l.period_end <= p_to
     group by l.account_id
  ),
  booked as (
    select l.account_id,
           sum((l.debit - l.credit) * case when a.internal_group = 'income' then -1 else 1 end) as amount
      from public.entry_lines l
      join public.entries e on e.id = l.entry_id
      join public.accounts a on a.id = l.account_id
     where l.company_id = p_company_id
       and e.state = 'posted'
       and e.kind = 'normal'
       and e.entry_date between p_from and p_to
       and l.account_id in (select account_id from planned)
     group by l.account_id
  )
  select a.code,
         a.name,
         public.round_amount(coalesce(p.amount, 0), r.rounding),
         public.round_amount(coalesce(b.amount, 0), r.rounding),
         public.round_amount(coalesce(b.amount, 0) - coalesce(p.amount, 0), r.rounding)
    from planned p
    join public.accounts a on a.id = p.account_id
    left join booked b on b.account_id = p.account_id
    cross join (select public.rounding_of(p_company_id) as rounding) r
   order by a.code;
$$;


comment on function budgets.variance(uuid, uuid, date, date) is
  'Budget against ledger, per account, over a period, at the decimals of the company''s currency. Both figures are in the sign a business states them in — an income account''s credit balance is flipped — and the variance is the actual less the plan. Reads posted entries of kind `normal` only: a closing or appropriation entry is not what a period earned.';


revoke execute on all functions in schema budgets from public;
