-- Ekwo OS — payments and bilateral matching.

create type payment_direction as enum ('inbound', 'outbound');
create type payment_state_t   as enum ('draft', 'posted', 'cancelled');

create table payments (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id) on delete cascade,
  direction       payment_direction not null,
  payment_date    date not null,
  amount          numeric(16, 2) not null,
  currency_code   char(3) not null default 'EUR' references currencies(code),
  contact_id      uuid references contacts(id) on delete set null,
  journal_id      uuid not null references journals(id) on delete restrict,
  bank_account_id uuid,
  entry_id        uuid references entries(id) on delete set null,
  reference       text,
  memo            text,
  state           payment_state_t not null default 'draft',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint payments_amount_positive check (amount > 0),
  foreign key (contact_id, company_id) references contacts(id, company_id),
  foreign key (journal_id, company_id) references journals(id, company_id),
  foreign key (entry_id, company_id) references entries(id, company_id)
);

comment on table payments is 'Money in and out. Amounts are positive; `direction` carries the sign.';

create unique index payments_id_company_idx on payments (id, company_id);
create index payments_company_date_idx on payments (company_id, payment_date);
create index payments_contact_idx on payments (contact_id);

create trigger payments_set_updated_at
  before update on payments
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- reconciliations
--
-- Matching is bilateral and by amount: each pairing of a debit with a credit
-- is a row. The FEC needs the letter, the aged balance needs the residual.
-- ---------------------------------------------------------------------------

create table reconciliations (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id) on delete cascade,
  debit_line_id   uuid not null references entry_lines(id) on delete cascade,
  credit_line_id  uuid not null references entry_lines(id) on delete cascade,
  amount          numeric(16, 2) not null,
  matching_number text not null,
  matched_at      date not null default current_date,
  created_at      timestamptz not null default now(),
  constraint reconciliations_amount_positive check (amount > 0),
  constraint reconciliations_distinct_lines check (debit_line_id <> credit_line_id),
  unique (debit_line_id, credit_line_id),
  foreign key (debit_line_id, company_id) references entry_lines(id, company_id) on delete cascade,
  foreign key (credit_line_id, company_id) references entry_lines(id, company_id) on delete cascade
);

comment on table reconciliations is 'One row per pairing of a debit with a credit. Full matching is the sum of partials.';

create index reconciliations_debit_idx on reconciliations (debit_line_id);
create index reconciliations_credit_idx on reconciliations (credit_line_id);
create index reconciliations_number_idx on reconciliations (company_id, matching_number);

-- Company-wide letter counter: A0001, A0002, ...
create table matching_sequences (
  company_id  uuid primary key references companies(id) on delete cascade,
  last_number integer not null default 0
);

create or replace function next_matching_number(p_company_id uuid)
returns text
language plpgsql
as $$
declare
  v_number integer;
begin
  insert into matching_sequences (company_id, last_number)
  values (p_company_id, 1)
  on conflict (company_id)
    do update set last_number = matching_sequences.last_number + 1
  returning last_number into v_number;
  return 'A' || lpad(v_number::text, 4, '0');
end;
$$;

comment on function next_matching_number(uuid) is 'Next reconciliation letter for a company, as A0001.';

-- Keep entry_lines.matched_amount and matching_number in step.
create or replace function reconciliations_refresh_lines()
returns trigger
language plpgsql
as $$
declare
  v_ids uuid[];
  v_id  uuid;
begin
  v_ids := array_remove(array[
    coalesce(new.debit_line_id, old.debit_line_id),
    coalesce(new.credit_line_id, old.credit_line_id)
  ], null);

  foreach v_id in array v_ids loop
    update entry_lines l
       set matched_amount = coalesce((
             select sum(r.amount) from reconciliations r
              where r.debit_line_id = l.id or r.credit_line_id = l.id
           ), 0),
           matching_number = (
             select r.matching_number from reconciliations r
              where r.debit_line_id = l.id or r.credit_line_id = l.id
              order by r.created_at
              limit 1
           )
     where l.id = v_id;
  end loop;

  return null;
end;
$$;

create trigger reconciliations_refresh_lines
  after insert or update or delete on reconciliations
  for each row execute function reconciliations_refresh_lines();

-- ---------------------------------------------------------------------------
-- reconcile / unreconcile
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

  v_amount := coalesce(
    p_amount,
    least(
      abs(v_debit.debit - v_debit.credit) - v_debit.matched_amount,
      abs(v_credit.debit - v_credit.credit) - v_credit.matched_amount
    )
  );

  if v_amount is null or v_amount <= 0 then
    raise exception 'reconcile_nothing_left: no open amount to match';
  end if;
  if v_amount > abs(v_debit.debit - v_debit.credit) - v_debit.matched_amount + 0.001 then
    raise exception 'reconcile_over_debit: % exceeds the open amount of the debit line', v_amount;
  end if;
  if v_amount > abs(v_credit.debit - v_credit.credit) - v_credit.matched_amount + 0.001 then
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

  insert into reconciliations (company_id, debit_line_id, credit_line_id, amount, matching_number)
  values (v_debit.company_id, v_debit.id, v_credit.id, v_amount, v_letter)
  returning * into v_result;

  return v_result;
end;
$$;

comment on function reconcile(uuid, uuid, numeric) is
  'Matches a debit line against a credit line for an amount, defaulting to the smaller open amount.';

create or replace function unreconcile(p_reconciliation_id uuid)
returns void
language plpgsql
as $$
begin
  delete from reconciliations where id = p_reconciliation_id;
  if not found then
    raise exception 'unknown_reconciliation: %', p_reconciliation_id;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table payments           enable row level security;
alter table reconciliations    enable row level security;
alter table matching_sequences enable row level security;

create policy payments_select on payments
  for select using (is_company_member(company_id));
create policy payments_write on payments
  for all using (can_write_company(company_id)) with check (can_write_company(company_id));

create policy reconciliations_select on reconciliations
  for select using (is_company_member(company_id));
create policy reconciliations_write on reconciliations
  for all using (can_write_company(company_id)) with check (can_write_company(company_id));

create policy matching_sequences_select on matching_sequences
  for select using (is_company_member(company_id));
