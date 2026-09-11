-- Ekwo OS — chart of accounts, journals, currencies.

-- ---------------------------------------------------------------------------
-- currencies (instance-wide reference data)
-- ---------------------------------------------------------------------------

create table currencies (
  code           char(3) primary key,
  name           text not null,
  symbol         text,
  decimal_places smallint not null default 2,
  active         boolean not null default true,
  constraint currencies_code_format check (code ~ '^[A-Z]{3}$'),
  constraint currencies_decimals check (decimal_places between 0 and 6)
);

comment on table currencies is 'ISO 4217 currencies known to this instance.';

create table currency_rates (
  id            uuid primary key default gen_random_uuid(),
  currency_code char(3) not null references currencies(code) on delete cascade,
  rate_date     date not null,
  -- Units of `currency_code` for one unit of the instance reference currency.
  rate          numeric(18, 8) not null,
  source        text,
  created_at    timestamptz not null default now(),
  unique (currency_code, rate_date),
  constraint currency_rates_positive check (rate > 0)
);

comment on table currency_rates is 'Dated exchange rates. A document stores the rate it used; this table is the history.';

-- ---------------------------------------------------------------------------
-- accounts
-- ---------------------------------------------------------------------------

-- Eighteen account types. The prefix before the first underscore is the
-- balance-sheet group, which is what makes the aged balance, reconcilability
-- and the statement mapping computable instead of pattern-matched on codes.
create type account_type as enum (
  'asset_receivable',
  'asset_cash',
  'asset_current',
  'asset_prepayments',
  'asset_fixed',
  'asset_non_current',
  'liability_payable',
  'liability_credit_card',
  'liability_current',
  'liability_non_current',
  'equity',
  'equity_retained',
  'income',
  'income_other',
  'expense',
  'expense_direct_cost',
  'expense_depreciation',
  'off_balance'
);

create table accounts (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references companies(id) on delete cascade,
  code           text not null,
  name           text not null,
  account_type   account_type not null,
  internal_group text generated always as (
    case
      when account_type in ('asset_receivable', 'asset_cash', 'asset_current',
                            'asset_prepayments', 'asset_fixed', 'asset_non_current')
        then 'asset'
      when account_type in ('liability_payable', 'liability_credit_card',
                            'liability_current', 'liability_non_current')
        then 'liability'
      when account_type in ('equity', 'equity_retained') then 'equity'
      when account_type in ('income', 'income_other') then 'income'
      when account_type in ('expense', 'expense_direct_cost', 'expense_depreciation')
        then 'expense'
      else 'off_balance'
    end
  ) stored,
  -- Balance-sheet accounts carry over from one fiscal year to the next.
  carries_forward boolean generated always as (
    account_type not in ('income', 'income_other', 'expense',
                         'expense_direct_cost', 'expense_depreciation')
  ) stored,
  reconcilable   boolean not null default false,
  currency_code  char(3) references currencies(code),
  parent_id      uuid references accounts(id) on delete set null,
  deprecated     boolean not null default false,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (company_id, code),
  -- A third-party account that cannot be matched makes the aged balance and
  -- the FEC letters impossible. Refuse it at the door.
  constraint accounts_third_party_reconcilable check (
    account_type not in ('asset_receivable', 'liability_payable') or reconcilable
  )
);

comment on table accounts is 'Chart of accounts, one per company.';
comment on column accounts.internal_group is 'asset | liability | equity | income | expense | off_balance, derived from account_type.';
comment on column accounts.reconcilable is 'Whether entry lines on this account may be matched against each other.';

create index accounts_company_type_idx on accounts (company_id, account_type);
create index accounts_parent_idx on accounts (parent_id);
-- Composite target so children can inherit company_id by foreign key.
create unique index accounts_id_company_idx on accounts (id, company_id);

create trigger accounts_set_updated_at
  before update on accounts
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- journals
-- ---------------------------------------------------------------------------

create type journal_type as enum ('sales', 'purchase', 'bank', 'cash', 'general', 'opening');

create table journals (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,
  code                text not null,
  name                text not null,
  journal_type        journal_type not null,
  default_account_id  uuid references accounts(id) on delete set null,
  suspense_account_id uuid references accounts(id) on delete set null,
  bank_account_id     uuid,
  currency_code       char(3) references currencies(code),
  active              boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (company_id, code),
  constraint journals_code_format check (code ~ '^[A-Z0-9]{2,8}$')
);

comment on table journals is 'Books of entry. The code is the first segment of every entry number.';
comment on column journals.suspense_account_id is 'Where a bank line lands before it is allocated.';

create unique index journals_id_company_idx on journals (id, company_id);

create trigger journals_set_updated_at
  before update on journals
  for each row execute function set_updated_at();

-- Per journal AND per year counter. A single counter per journal would make
-- the year in the number decorative; here the number means what it says.
create table journal_sequences (
  journal_id  uuid not null references journals(id) on delete cascade,
  year        smallint not null,
  last_number integer not null default 0,
  primary key (journal_id, year),
  constraint journal_sequences_positive check (last_number >= 0)
);

comment on table journal_sequences is 'Counter behind next_entry_number(). One row per journal and year.';

-- ---------------------------------------------------------------------------
-- Company default accounts and journals, now that the targets exist.
-- ---------------------------------------------------------------------------

alter table companies
  add constraint companies_receivable_account_fkey
    foreign key (receivable_account_id) references accounts(id) on delete set null,
  add constraint companies_payable_account_fkey
    foreign key (payable_account_id) references accounts(id) on delete set null,
  add constraint companies_suspense_account_fkey
    foreign key (suspense_account_id) references accounts(id) on delete set null,
  add constraint companies_rounding_account_fkey
    foreign key (rounding_account_id) references accounts(id) on delete set null,
  add constraint companies_retained_earnings_account_fkey
    foreign key (retained_earnings_account_id) references accounts(id) on delete set null,
  add constraint companies_sales_journal_fkey
    foreign key (sales_journal_id) references journals(id) on delete set null,
  add constraint companies_purchase_journal_fkey
    foreign key (purchase_journal_id) references journals(id) on delete set null,
  add constraint companies_miscellaneous_journal_fkey
    foreign key (miscellaneous_journal_id) references journals(id) on delete set null;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table currencies        enable row level security;
alter table currency_rates    enable row level security;
alter table accounts          enable row level security;
alter table journals          enable row level security;
alter table journal_sequences enable row level security;

-- Reference data: readable by anyone signed in, written by nobody through the
-- API (seeds and migrations run as the table owner and bypass RLS).
create policy currencies_select on currencies
  for select using (auth.uid() is not null);
create policy currency_rates_select on currency_rates
  for select using (auth.uid() is not null);

create policy accounts_select on accounts
  for select using (is_company_member(company_id));
create policy accounts_write on accounts
  for all using (can_write_company(company_id)) with check (can_write_company(company_id));

create policy journals_select on journals
  for select using (is_company_member(company_id));
create policy journals_write on journals
  for all using (can_write_company(company_id)) with check (can_write_company(company_id));

create policy journal_sequences_select on journal_sequences
  for select using (
    exists (select 1 from journals j where j.id = journal_id and is_company_member(j.company_id))
  );
