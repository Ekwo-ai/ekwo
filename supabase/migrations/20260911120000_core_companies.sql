-- Ekwo OS — core: companies, membership, fiscal years.
--
-- One Ekwo instance belongs to one customer, so there is no `tenant_id`.
-- Isolation inside an instance is carried by `company_id` plus row level
-- security driven by `company_members`.

-- gen_random_uuid() is in core Postgres since 13; no extension is needed.

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function set_updated_at() is
  'Generic BEFORE UPDATE trigger keeping updated_at honest.';

-- ---------------------------------------------------------------------------
-- Enumerations
-- ---------------------------------------------------------------------------

create type member_role as enum ('owner', 'accountant', 'viewer');

-- ---------------------------------------------------------------------------
-- companies
-- ---------------------------------------------------------------------------

create table companies (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  legal_name          text,
  legal_form          text,
  country             char(2) not null,
  fiscal_country      char(2) not null,
  vat_number          text,
  registration_number text,
  address_line1       text,
  address_line2       text,
  postal_code         text,
  city                text,
  email               text,
  phone               text,
  website             text,
  currency_code       char(3) not null default 'EUR',
  -- Period locks. No entry may be created, changed or deleted on or before
  -- these dates. `tax_lock_date` additionally freezes anything carrying a
  -- VAT declaration box.
  lock_date           date,
  tax_lock_date       date,
  -- Default accounts, resolved by ROLE and never by code prefix.
  -- Foreign keys are added once `accounts` exists.
  receivable_account_id       uuid,
  payable_account_id          uuid,
  suspense_account_id         uuid,
  rounding_account_id         uuid,
  retained_earnings_account_id uuid,
  sales_journal_id            uuid,
  purchase_journal_id         uuid,
  miscellaneous_journal_id    uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint companies_country_format check (country ~ '^[A-Z]{2}$'),
  constraint companies_fiscal_country_format check (fiscal_country ~ '^[A-Z]{2}$'),
  constraint companies_currency_format check (currency_code ~ '^[A-Z]{3}$')
);

comment on table companies is 'Legal entities kept in this instance. One instance may hold several.';
comment on column companies.fiscal_country is 'Country whose VAT rules apply; differs from `country` for a foreign VAT registration.';
comment on column companies.lock_date is 'Accounting lock: nothing may be booked on or before this date.';

create trigger companies_set_updated_at
  before update on companies
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- company_members
-- ---------------------------------------------------------------------------

create table company_members (
  company_id uuid not null references companies(id) on delete cascade,
  user_id    uuid not null,
  role       member_role not null default 'viewer',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (company_id, user_id)
);

comment on table company_members is 'Who may read or write a company. `owner` administers, `accountant` books, `viewer` reads.';

create index company_members_user_id_idx on company_members (user_id);

create trigger company_members_set_updated_at
  before update on company_members
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Access helpers
--
-- SECURITY DEFINER so that the policy on `company_members` itself does not
-- recurse into the table it protects.
-- ---------------------------------------------------------------------------

create or replace function company_role(p_company_id uuid)
returns member_role
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select m.role
    from company_members m
   where m.company_id = p_company_id
     and m.user_id = auth.uid();
$$;

create or replace function is_company_member(p_company_id uuid)
returns boolean
language sql
stable
as $$
  select company_role(p_company_id) is not null;
$$;

create or replace function can_write_company(p_company_id uuid)
returns boolean
language sql
stable
as $$
  select company_role(p_company_id) in ('owner', 'accountant');
$$;

create or replace function is_company_owner(p_company_id uuid)
returns boolean
language sql
stable
as $$
  select company_role(p_company_id) = 'owner';
$$;

comment on function company_role(uuid) is 'Role of the current user on a company, or NULL when they are not a member.';

-- Bootstrap helper: the first member of a fresh company claims it. SECURITY
-- DEFINER so the policy on company_members does not recurse into itself.
create or replace function company_has_no_member(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select not exists (select 1 from company_members m where m.company_id = p_company_id);
$$;

-- ---------------------------------------------------------------------------
-- fiscal_years
-- ---------------------------------------------------------------------------

create table fiscal_years (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id) on delete cascade,
  name         text not null,
  start_date   date not null,
  end_date     date not null,
  is_closed    boolean not null default false,
  closed_at    timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint fiscal_years_dates check (end_date > start_date),
  unique (company_id, start_date)
);

comment on table fiscal_years is 'Accounting periods. An exercise is an object, not two integers on the company.';

create index fiscal_years_company_range_idx on fiscal_years (company_id, start_date, end_date);

create trigger fiscal_years_set_updated_at
  before update on fiscal_years
  for each row execute function set_updated_at();

-- Overlap guard. An exclusion constraint would need btree_gist, which is not
-- available on every Postgres build (PGlite included), so this is a trigger.
create or replace function fiscal_years_no_overlap()
returns trigger
language plpgsql
as $$
begin
  if exists (
    select 1
      from fiscal_years f
     where f.company_id = new.company_id
       and f.id <> new.id
       and f.start_date <= new.end_date
       and f.end_date >= new.start_date
  ) then
    raise exception 'fiscal_year_overlap: % .. % overlaps an existing fiscal year of this company',
      new.start_date, new.end_date
      using errcode = '23505';
  end if;
  return new;
end;
$$;

create trigger fiscal_years_no_overlap
  before insert or update of start_date, end_date, company_id on fiscal_years
  for each row execute function fiscal_years_no_overlap();

create or replace function fiscal_year_at(p_company_id uuid, p_date date)
returns uuid
language sql
stable
as $$
  select f.id
    from fiscal_years f
   where f.company_id = p_company_id
     and p_date between f.start_date and f.end_date
   limit 1;
$$;

comment on function fiscal_year_at(uuid, date) is 'Fiscal year covering a date, or NULL.';

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table companies       enable row level security;
alter table company_members enable row level security;
alter table fiscal_years    enable row level security;

create policy companies_select on companies
  for select using (is_company_member(id));
create policy companies_insert on companies
  for insert with check (auth.uid() is not null);
create policy companies_update on companies
  for update using (is_company_owner(id)) with check (is_company_owner(id));
create policy companies_delete on companies
  for delete using (is_company_owner(id));

create policy company_members_select on company_members
  for select using (user_id = auth.uid() or is_company_member(company_id));
create policy company_members_insert on company_members
  for insert with check (
    is_company_owner(company_id) or company_has_no_member(company_id)
  );
create policy company_members_update on company_members
  for update using (is_company_owner(company_id)) with check (is_company_owner(company_id));
create policy company_members_delete on company_members
  for delete using (is_company_owner(company_id));

create policy fiscal_years_select on fiscal_years
  for select using (is_company_member(company_id));
create policy fiscal_years_write on fiscal_years
  for all using (can_write_company(company_id)) with check (can_write_company(company_id));
