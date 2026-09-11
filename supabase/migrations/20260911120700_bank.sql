-- Ekwo OS — bank accounts, statements and transactions.

create type bank_transaction_state as enum ('pending', 'reconciled', 'ignored');
create type bank_statement_state   as enum ('draft', 'confirmed');

create table bank_accounts (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  name          text not null,
  iban          text,
  bic           text,
  bank_name     text,
  currency_code char(3) not null default 'EUR' references currencies(code),
  account_id    uuid references accounts(id) on delete set null,
  journal_id    uuid references journals(id) on delete set null,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  foreign key (account_id, company_id) references accounts(id, company_id),
  foreign key (journal_id, company_id) references journals(id, company_id)
);

comment on table bank_accounts is 'Bank and card accounts, each mapped to a ledger account and a journal.';

create unique index bank_accounts_id_company_idx on bank_accounts (id, company_id);
create unique index bank_accounts_company_iban_idx
  on bank_accounts (company_id, iban) where iban is not null;

create trigger bank_accounts_set_updated_at
  before update on bank_accounts
  for each row execute function set_updated_at();

alter table journals
  add constraint journals_bank_account_fkey
    foreign key (bank_account_id) references bank_accounts(id) on delete set null;
alter table payments
  add constraint payments_bank_account_fkey
    foreign key (bank_account_id) references bank_accounts(id) on delete set null;

-- ---------------------------------------------------------------------------
-- bank_statements
--
-- A statement exists so the balances can be checked for continuity: the
-- closing balance of one is the opening balance of the next.
-- ---------------------------------------------------------------------------

create table bank_statements (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references companies(id) on delete cascade,
  bank_account_id      uuid not null references bank_accounts(id) on delete cascade,
  name                 text,
  statement_date       date not null,
  balance_start        numeric(16, 2) not null default 0,
  balance_end_declared numeric(16, 2) not null default 0,
  balance_end_computed numeric(16, 2) not null default 0,
  is_consistent        boolean generated always as (
    balance_end_declared = balance_end_computed
  ) stored,
  state                bank_statement_state not null default 'draft',
  source               text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  foreign key (bank_account_id, company_id) references bank_accounts(id, company_id)
);

comment on table bank_statements is 'Imported statements. `is_consistent` compares the declared closing balance with the sum of the lines.';

create unique index bank_statements_id_company_idx on bank_statements (id, company_id);
create index bank_statements_account_date_idx on bank_statements (bank_account_id, statement_date);

create trigger bank_statements_set_updated_at
  before update on bank_statements
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- bank_transactions
-- ---------------------------------------------------------------------------

create table bank_transactions (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references companies(id) on delete cascade,
  statement_id         uuid references bank_statements(id) on delete set null,
  bank_account_id      uuid not null references bank_accounts(id) on delete cascade,
  sequence             integer not null default 10,
  transaction_date     date not null,
  value_date           date,
  -- Signed: positive is money in.
  amount               numeric(16, 2) not null,
  currency_code        char(3) not null default 'EUR' references currencies(code),
  description          text,
  counterpart_name     text,
  counterpart_iban     text,
  reference            text,
  -- Structured communication (BE +++000/0000/00000+++, ISO 11649 RF...).
  structured_reference text,
  contact_id           uuid references contacts(id) on delete set null,
  entry_id             uuid references entries(id) on delete set null,
  state                bank_transaction_state not null default 'pending',
  raw                  jsonb,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  foreign key (statement_id, company_id) references bank_statements(id, company_id),
  foreign key (bank_account_id, company_id) references bank_accounts(id, company_id),
  foreign key (contact_id, company_id) references contacts(id, company_id),
  foreign key (entry_id, company_id) references entries(id, company_id)
);

comment on table bank_transactions is 'Statement lines. `amount` is signed; `raw` keeps whatever the source sent.';

create index bank_transactions_statement_idx on bank_transactions (statement_id, sequence);
create index bank_transactions_account_date_idx on bank_transactions (bank_account_id, transaction_date);
create index bank_transactions_state_idx on bank_transactions (company_id, state);

create trigger bank_transactions_set_updated_at
  before update on bank_transactions
  for each row execute function set_updated_at();

create or replace function bank_statements_refresh_balance()
returns trigger
language plpgsql
as $$
declare
  v_statement uuid := coalesce(new.statement_id, old.statement_id);
begin
  if v_statement is null then
    return null;
  end if;
  update bank_statements s
     set balance_end_computed = s.balance_start + coalesce((
           select sum(t.amount) from bank_transactions t where t.statement_id = s.id
         ), 0)
   where s.id = v_statement;
  return null;
end;
$$;

create trigger bank_transactions_refresh_balance
  after insert or update of amount, statement_id or delete on bank_transactions
  for each row execute function bank_statements_refresh_balance();

create or replace function bank_statements_recompute()
returns trigger
language plpgsql
as $$
begin
  new.balance_end_computed := new.balance_start + coalesce((
    select sum(t.amount) from bank_transactions t where t.statement_id = new.id
  ), 0);
  return new;
end;
$$;

create trigger bank_statements_recompute
  before insert or update of balance_start on bank_statements
  for each row execute function bank_statements_recompute();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table bank_accounts     enable row level security;
alter table bank_statements   enable row level security;
alter table bank_transactions enable row level security;

create policy bank_accounts_select on bank_accounts
  for select using (is_company_member(company_id));
create policy bank_accounts_write on bank_accounts
  for all using (can_write_company(company_id)) with check (can_write_company(company_id));

create policy bank_statements_select on bank_statements
  for select using (is_company_member(company_id));
create policy bank_statements_write on bank_statements
  for all using (can_write_company(company_id)) with check (can_write_company(company_id));

create policy bank_transactions_select on bank_transactions
  for select using (is_company_member(company_id));
create policy bank_transactions_write on bank_transactions
  for all using (can_write_company(company_id)) with check (can_write_company(company_id));
