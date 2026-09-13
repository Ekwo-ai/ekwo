-- Ekwo — the `budgets` module: what a company planned, against what it booked.
--
-- The second module, and the one that proves the mechanism holds for a module
-- that is not like the first. It has **no country data at all** — a budget is a
-- decision a business takes, not a rule a country writes — and it **never
-- writes to the ledger**: it reads `public.entry_lines` and compares. So there
-- is no pack section, no seed, no call to `post_module_entry()`, and
-- `module.json` says `"posts": false`, which a test holds it to.
--
-- It also deliberately writes **no `budgets.can_disable()`**. The convention
-- `disable_module()` follows is to look for that function and allow the
-- disable when there is none, and this is the module that exercises the
-- absence: turning budgets off takes nothing away, because the rows stay where
-- they are and come back the moment it is turned on again. Row level security
-- is what hides them in between, which is the whole meaning of
-- `module_enabled()` sitting in every policy.
--
-- **The sign.** A budget is stated the way a business says it out loud: an
-- income of 100 000 and a cost of 60 000 are both positive numbers. The ledger
-- does not work that way — an income account carries a credit balance — so the
-- comparison multiplies the ledger balance by −1 on an income account and by
-- +1 everywhere else. That is one rule, it comes from `accounts.internal_group`
-- rather than from a column somebody fills in, and it is what the eighteen
-- account types are for.
--
-- **What counts as actual.** Posted entries, and only the ones that are
-- `kind = 'normal'`. A closing entry is the mirror image of the year and an
-- appropriation entry moves its result; neither is something a budget planned,
-- and leaving them in would make a closed year read as a variance of exactly
-- minus the budget. That is the same exclusion `financial_statement()` makes on
-- an income statement, for the same reason.

create schema budgets;

comment on schema budgets is
  'Ekwo module `budgets`: what a company planned, per account and period, against what its ledger holds. Reads the socle, writes nothing to it.';

create type budgets.budget_state as enum ('draft', 'approved', 'closed');

comment on type budgets.budget_state is
  'draft while it is being written, approved once it is the plan, closed when the period it covers is behind. It gates nothing in this module: a variance is a reading, and reading a draft is useful.';

create table budgets.budgets (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id) on delete cascade,
  fiscal_year_id uuid references public.fiscal_years(id) on delete restrict,
  code           text not null,
  name           text not null,
  state          budgets.budget_state not null default 'draft',
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (company_id, code),
  foreign key (fiscal_year_id) references public.fiscal_years(id)
);

comment on table budgets.budgets is
  'One budget of one company, usually for one financial year. A company may hold several — a plan and a revision are two budgets and not two columns.';
comment on column budgets.budgets.fiscal_year_id is
  'The year this budget is for, where it is for one. Null on a rolling budget, whose lines carry their own periods anyway.';

create unique index budgets_id_company_idx on budgets.budgets (id, company_id);

create trigger budgets_set_updated_at
  before update on budgets.budgets
  for each row execute function public.set_updated_at();

create table budgets.lines (
  id           uuid primary key default gen_random_uuid(),
  budget_id    uuid not null references budgets.budgets(id) on delete cascade,
  company_id   uuid not null references public.companies(id) on delete cascade,
  account_id   uuid not null references public.accounts(id) on delete restrict,
  period_start date not null,
  period_end   date not null,
  amount       numeric(16, 2) not null,
  note         text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- One line per account and period. A second figure for the same month on the
  -- same account is a revision, and a revision is a budget of its own.
  unique (budget_id, account_id, period_start, period_end),
  constraint budgets_lines_period check (period_end >= period_start),
  foreign key (budget_id, company_id) references budgets.budgets(id, company_id) on delete cascade,
  foreign key (account_id, company_id) references public.accounts(id, company_id)
);

comment on table budgets.lines is
  'What one account is expected to carry over one period, in the sign a business says it: an income and a cost are both positive.';

create index budgets_lines_account_idx on budgets.lines (company_id, account_id, period_start);

create trigger budgets_lines_set_updated_at
  before update on budgets.lines
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- The reading
-- ---------------------------------------------------------------------------

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
         coalesce(p.amount, 0)::numeric(16, 2),
         coalesce(b.amount, 0)::numeric(16, 2),
         (coalesce(b.amount, 0) - coalesce(p.amount, 0))::numeric(16, 2)
    from planned p
    join public.accounts a on a.id = p.account_id
    left join booked b on b.account_id = p.account_id
   order by a.code;
$$;

comment on function budgets.variance(uuid, uuid, date, date) is
  'Budget against ledger, per account, over a period. Both figures are in the sign a business states them in — an income account''s credit balance is flipped — and the variance is the actual less the plan. Reads posted entries of kind `normal` only: a closing or appropriation entry is not what a period earned.';

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table budgets.budgets enable row level security;
alter table budgets.lines   enable row level security;

create policy budgets_select on budgets.budgets
  for select using (public.module_enabled(company_id, 'budgets'));
create policy budgets_write on budgets.budgets
  for all using (public.module_enabled(company_id, 'budgets') and public.can_write_company(company_id))
  with check (public.module_enabled(company_id, 'budgets') and public.can_write_company(company_id));

create policy budgets_lines_select on budgets.lines
  for select using (public.module_enabled(company_id, 'budgets'));
create policy budgets_lines_write on budgets.lines
  for all using (public.module_enabled(company_id, 'budgets') and public.can_write_company(company_id))
  with check (public.module_enabled(company_id, 'budgets') and public.can_write_company(company_id));

-- ---------------------------------------------------------------------------
-- Privileges — a module schema does its own, because `public` gets them from
-- Supabase's default privileges and a schema a migration created gets nothing.
-- ---------------------------------------------------------------------------

grant usage on schema budgets to anon, authenticated, service_role;

grant select on all tables in schema budgets to anon;
grant select, insert, update, delete on all tables in schema budgets to authenticated, service_role;
grant execute on all functions in schema budgets to authenticated, service_role;

alter default privileges in schema budgets grant select on tables to anon;
alter default privileges in schema budgets
  grant select, insert, update, delete on tables to authenticated, service_role;
alter default privileges in schema budgets revoke execute on functions from public, anon;
alter default privileges in schema budgets grant execute on functions to authenticated, service_role;

revoke execute on all functions in schema budgets from public;

-- ---------------------------------------------------------------------------
-- The registry row
-- ---------------------------------------------------------------------------

insert into public.modules (code, name, description, schema_name, version, status, requires_socle_min)
values (
  'budgets',
  'Budgets',
  'A budget per financial year, its lines per account and period, and the variance against what the ledger actually holds. No country data, and nothing written to the ledger.',
  'budgets',
  '1.0.0',
  'available',
  '20260913074512'
)
on conflict (code) do update set
  name               = excluded.name,
  description        = excluded.description,
  schema_name        = excluded.schema_name,
  version            = excluded.version,
  status             = excluded.status,
  requires_socle_min = excluded.requires_socle_min;
