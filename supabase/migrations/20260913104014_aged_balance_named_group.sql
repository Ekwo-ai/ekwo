-- Ekwo OS — "not payable" is not the same as "receivable".
--
-- `aged_balance(company, at, group)` tested the group twice, both times as
-- `case when p_group = 'payable' then … else …`. So every value that is not
-- exactly `'payable'` was silently the receivable ageing: `'supplier'`,
-- `'creditors'`, `'Payable'`, a typo, a column name passed by mistake. The
-- caller gets a full, plausible, wrong report — the one failure mode a report
-- must never have, because nothing about it looks like an error.
--
-- Two named groups, and anything else is refused by name. The body is
-- unchanged; it moves to plpgsql only so that it can raise.

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
begin
  if p_group is null or p_group not in ('receivable', 'payable') then
    raise exception 'invalid_group: % is not an ageing group; it is receivable or payable', coalesce(p_group, 'null');
  end if;

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
end;
$$;

comment on function aged_balance(uuid, date, text) is
  'Ageing of what is still open, read from the ledger and from the matching. Two groups, receivable and payable; anything else is refused by name rather than reported as receivable.';

revoke execute on all functions in schema public from public;
