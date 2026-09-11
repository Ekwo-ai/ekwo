-- Ekwo OS — journal entries and their lines, numbering, period locks.

create type entry_state as enum ('draft', 'posted', 'cancelled');

create table entries (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id) on delete cascade,
  journal_id        uuid not null references journals(id) on delete restrict,
  fiscal_year_id    uuid references fiscal_years(id) on delete restrict,
  -- Assigned when the entry is posted. A draft burns no number.
  number            text,
  entry_date        date not null,
  reference         text,
  description       text,
  state             entry_state not null default 'draft',
  -- Set by post_document(); a document owns at most one entry.
  document_id       uuid,
  reversed_entry_id uuid references entries(id) on delete set null,
  currency_code     char(3) references currencies(code),
  -- Maintained from entry_lines. Never written by hand.
  total_debit       numeric(16, 2) not null default 0,
  total_credit      numeric(16, 2) not null default 0,
  is_balanced       boolean generated always as (total_debit = total_credit) stored,
  posted_at         timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint entries_posted_is_balanced check (state <> 'posted' or total_debit = total_credit),
  constraint entries_posted_has_number check (state <> 'posted' or number is not null),
  foreign key (journal_id, company_id) references journals(id, company_id)
);

comment on table entries is 'Journal entries. A document and its entry are two layers joined by a foreign key.';
comment on column entries.number is 'CODE/YYYY/NNNN, assigned at posting.';
comment on column entries.total_debit is 'Derived from entry_lines by trigger; the lines are authoritative.';

create unique index entries_company_number_idx on entries (company_id, number) where number is not null;
create unique index entries_id_company_idx on entries (id, company_id);
create index entries_company_date_idx on entries (company_id, entry_date);
create index entries_journal_idx on entries (journal_id, entry_date);
create index entries_fiscal_year_idx on entries (fiscal_year_id);
create index entries_document_idx on entries (document_id);

create trigger entries_set_updated_at
  before update on entries
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- entry_lines
-- ---------------------------------------------------------------------------

create table entry_lines (
  id             uuid primary key default gen_random_uuid(),
  entry_id       uuid not null references entries(id) on delete cascade,
  company_id     uuid not null references companies(id) on delete cascade,
  account_id     uuid not null references accounts(id) on delete restrict,
  sequence       integer not null default 10,
  name           text,
  debit          numeric(16, 2) not null default 0,
  credit         numeric(16, 2) not null default 0,
  -- Authoritative signed amount; debit and credit are its projection.
  balance        numeric(16, 2) generated always as (debit - credit) stored,
  currency_code  char(3) references currencies(code),
  amount_currency numeric(16, 2),
  contact_id     uuid references contacts(id) on delete set null,
  -- Due date of this line. Feeds the aged balance straight from the ledger.
  date_maturity  date,
  tax_id         uuid references taxes(id) on delete set null,
  -- True when this line IS the tax amount, false when it is a taxed base.
  tax_line       boolean not null default false,
  declaration_box text,
  box_amount     numeric(16, 2),
  -- Matching. `matching_number` is the human-readable letter, `matched_amount`
  -- the part of this line already reconciled.
  matching_number text,
  matched_amount numeric(16, 2) not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint entry_lines_amounts_positive check (debit >= 0 and credit >= 0),
  constraint entry_lines_one_side check (debit = 0 or credit = 0),
  constraint entry_lines_matched_within check (matched_amount >= 0 and matched_amount <= abs(debit - credit)),
  foreign key (entry_id, company_id) references entries(id, company_id) on delete cascade,
  foreign key (account_id, company_id) references accounts(id, company_id),
  foreign key (contact_id, company_id) references contacts(id, company_id),
  foreign key (tax_id, company_id) references taxes(id, company_id)
);

comment on table entry_lines is 'Ledger lines. Amounts are always positive; a reversal flips the side, it never negates.';
comment on column entry_lines.declaration_box is 'VAT-return box this line feeds, copied from the tax posting that produced it.';
comment on column entry_lines.box_amount is 'Amount to report in that box, in the sign the form expects.';
comment on column entry_lines.matching_number is 'Reconciliation letter shared by matched lines. Exported as EcritureLet in the FEC.';

create unique index entry_lines_id_company_idx on entry_lines (id, company_id);
create index entry_lines_entry_idx on entry_lines (entry_id, sequence);
create index entry_lines_account_idx on entry_lines (account_id);
create index entry_lines_contact_idx on entry_lines (contact_id);
create index entry_lines_maturity_idx on entry_lines (company_id, date_maturity);
create index entry_lines_matching_idx on entry_lines (company_id, matching_number) where matching_number is not null;
create index entry_lines_box_idx on entry_lines (company_id, declaration_box) where declaration_box is not null;

create trigger entry_lines_set_updated_at
  before update on entry_lines
  for each row execute function set_updated_at();

-- Keep the entry totals in step with its lines.
create or replace function entries_refresh_totals()
returns trigger
language plpgsql
as $$
declare
  v_entry_id uuid := coalesce(new.entry_id, old.entry_id);
begin
  update entries e
     set total_debit  = coalesce(s.debit, 0),
         total_credit = coalesce(s.credit, 0)
    from (
      select sum(l.debit) as debit, sum(l.credit) as credit
        from entry_lines l
       where l.entry_id = v_entry_id
    ) s
   where e.id = v_entry_id;
  return null;
end;
$$;

create trigger entry_lines_refresh_totals
  after insert or update of debit, credit, entry_id or delete on entry_lines
  for each row execute function entries_refresh_totals();

-- ---------------------------------------------------------------------------
-- Numbering
-- ---------------------------------------------------------------------------

create or replace function next_entry_number(p_journal_id uuid, p_date date)
returns text
language plpgsql
as $$
declare
  v_code   text;
  v_year   smallint := extract(year from p_date)::smallint;
  v_number integer;
begin
  select j.code into v_code from journals j where j.id = p_journal_id;
  if v_code is null then
    raise exception 'unknown_journal: journal % does not exist', p_journal_id;
  end if;

  insert into journal_sequences (journal_id, year, last_number)
  values (p_journal_id, v_year, 1)
  on conflict (journal_id, year)
    do update set last_number = journal_sequences.last_number + 1
  returning last_number into v_number;

  return v_code || '/' || v_year::text || '/' || lpad(v_number::text, 4, '0');
end;
$$;

comment on function next_entry_number(uuid, date) is
  'Next number for a journal and year, as CODE/YYYY/NNNN. Atomic: the counter row is locked, not the journal.';

-- ---------------------------------------------------------------------------
-- Period locks
-- ---------------------------------------------------------------------------

create or replace function assert_period_open(
  p_company_id uuid,
  p_date       date,
  p_is_tax     boolean default false
)
returns void
language plpgsql
stable
as $$
declare
  v_lock     date;
  v_tax_lock date;
  v_closed   boolean;
begin
  select lock_date, tax_lock_date into v_lock, v_tax_lock
    from companies where id = p_company_id;

  if v_lock is not null and p_date <= v_lock then
    raise exception 'period_locked: % is on or before the accounting lock date %', p_date, v_lock
      using errcode = '55006';
  end if;

  if p_is_tax and v_tax_lock is not null and p_date <= v_tax_lock then
    raise exception 'tax_period_locked: % is on or before the tax lock date %', p_date, v_tax_lock
      using errcode = '55006';
  end if;

  select f.is_closed into v_closed
    from fiscal_years f
   where f.company_id = p_company_id
     and p_date between f.start_date and f.end_date;

  if v_closed then
    raise exception 'fiscal_year_closed: % falls in a closed fiscal year', p_date
      using errcode = '55006';
  end if;
end;
$$;

comment on function assert_period_open(uuid, date, boolean) is
  'Raises when a date is protected by a lock date or a closed fiscal year.';

create or replace function entries_guard_period()
returns trigger
language plpgsql
as $$
declare
  v_is_tax boolean;
begin
  if tg_op = 'DELETE' then
    perform assert_period_open(old.company_id, old.entry_date,
      exists (select 1 from entry_lines l where l.entry_id = old.id and l.declaration_box is not null));
    return old;
  end if;

  v_is_tax := exists (select 1 from entry_lines l where l.entry_id = new.id and l.declaration_box is not null);
  perform assert_period_open(new.company_id, new.entry_date, v_is_tax);

  if tg_op = 'UPDATE' and old.entry_date <> new.entry_date then
    perform assert_period_open(old.company_id, old.entry_date, v_is_tax);
  end if;

  return new;
end;
$$;

create trigger entries_guard_period
  before insert or update or delete on entries
  for each row execute function entries_guard_period();

create or replace function entry_lines_guard_period()
returns trigger
language plpgsql
as $$
declare
  v_row     entries%rowtype;
  v_entry   uuid := coalesce(new.entry_id, old.entry_id);
  v_is_tax  boolean := coalesce(new.declaration_box, old.declaration_box) is not null;
begin
  -- Matching is not a change to the accounts, so it stays possible after a
  -- period is locked. Everything else is guarded.
  if tg_op = 'UPDATE'
     and new.debit = old.debit
     and new.credit = old.credit
     and new.account_id = old.account_id
     and new.entry_id = old.entry_id
     and coalesce(new.declaration_box, '') = coalesce(old.declaration_box, '')
     and coalesce(new.box_amount, 0) = coalesce(old.box_amount, 0)
  then
    return new;
  end if;

  select * into v_row from entries where id = v_entry;
  if found then
    perform assert_period_open(v_row.company_id, v_row.entry_date, v_is_tax);
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger entry_lines_guard_period
  before insert or update or delete on entry_lines
  for each row execute function entry_lines_guard_period();

-- ---------------------------------------------------------------------------
-- Posting an entry
-- ---------------------------------------------------------------------------

create or replace function post_entry(p_entry_id uuid)
returns entries
language plpgsql
as $$
declare
  v_entry entries%rowtype;
  v_lines integer;
begin
  select * into v_entry from entries where id = p_entry_id for update;
  if not found then
    raise exception 'unknown_entry: entry % does not exist', p_entry_id;
  end if;
  if v_entry.state = 'posted' then
    return v_entry;
  end if;
  if v_entry.state = 'cancelled' then
    raise exception 'entry_cancelled: entry % cannot be posted', p_entry_id;
  end if;

  select count(*) into v_lines from entry_lines where entry_id = p_entry_id;
  if v_lines = 0 then
    raise exception 'entry_empty: entry % has no lines', p_entry_id;
  end if;

  -- Re-read the totals maintained by the line trigger.
  select * into v_entry from entries where id = p_entry_id;
  if v_entry.total_debit <> v_entry.total_credit then
    raise exception 'entry_unbalanced: entry % has debit % and credit %',
      p_entry_id, v_entry.total_debit, v_entry.total_credit;
  end if;

  perform assert_period_open(v_entry.company_id, v_entry.entry_date, true);

  update entries
     set number = coalesce(number, next_entry_number(journal_id, entry_date)),
         fiscal_year_id = coalesce(fiscal_year_id, fiscal_year_at(company_id, entry_date)),
         state = 'posted',
         posted_at = now()
   where id = p_entry_id
  returning * into v_entry;

  return v_entry;
end;
$$;

comment on function post_entry(uuid) is
  'Validates, numbers and posts an entry. Raises rather than warning: a swallowed error is a missing entry.';

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table entries     enable row level security;
alter table entry_lines enable row level security;

create policy entries_select on entries
  for select using (is_company_member(company_id));
create policy entries_write on entries
  for all using (can_write_company(company_id)) with check (can_write_company(company_id));

create policy entry_lines_select on entry_lines
  for select using (is_company_member(company_id));
create policy entry_lines_write on entry_lines
  for all using (can_write_company(company_id)) with check (can_write_company(company_id));
