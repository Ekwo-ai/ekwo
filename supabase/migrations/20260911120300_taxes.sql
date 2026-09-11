-- Ekwo OS — taxes and their postings.
--
-- A tax says how much. `tax_postings` say where it lands in the ledger and in
-- which box of the VAT return. That indirection is what keeps country rules
-- out of application code.

create type tax_amount_type   as enum ('percent', 'fixed');
create type tax_scope         as enum ('sale', 'purchase', 'both');
create type tax_document_kind as enum ('invoice', 'credit_note');
create type tax_posting_type  as enum ('base', 'tax');

-- How an operation is treated for the return. Drives nothing on its own; it
-- documents the tax and lets an application group taxes sensibly.
create type tax_treatment as enum (
  'domestic',
  'domestic_reverse_charge',
  'intracom_goods',
  'intracom_services',
  'intracom_acquisition_goods',
  'intracom_acquisition_services',
  'export',
  'import',
  'exempt',
  'not_subject'
);

create table taxes (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id) on delete cascade,
  code            text not null,
  name            text not null,
  description     text,
  amount_type     tax_amount_type not null default 'percent',
  -- Percentage when amount_type = 'percent', absolute amount when 'fixed'.
  amount          numeric(12, 4) not null default 0,
  applies_to      tax_scope not null default 'both',
  treatment       tax_treatment not null default 'domestic',
  country         char(2),
  -- Temporal validity. A rate change is a new period, not a new tax.
  valid_from      date not null default date '1970-01-01',
  valid_to        date,
  legal_reference text,
  -- EN 16931 BT-118 category code: S, Z, E, AE, K, G, O, L, M.
  vat_category    char(2),
  exemption_code  text,
  price_include   boolean not null default false,
  sequence        integer not null default 10,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (company_id, code),
  constraint taxes_validity check (valid_to is null or valid_to >= valid_from),
  constraint taxes_country_format check (country is null or country ~ '^[A-Z]{2}$')
);

comment on table taxes is 'VAT and similar taxes, with temporal validity and a legal reference.';
comment on column taxes.amount is 'Percentage (21.0000) or fixed amount, per amount_type.';
comment on column taxes.vat_category is 'EN 16931 BT-118 / BT-151 category code.';

create index taxes_company_active_idx on taxes (company_id, active);
create unique index taxes_id_company_idx on taxes (id, company_id);

create trigger taxes_set_updated_at
  before update on taxes
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- tax_postings
-- ---------------------------------------------------------------------------

create table tax_postings (
  id                  uuid primary key default gen_random_uuid(),
  tax_id              uuid not null references taxes(id) on delete cascade,
  company_id          uuid not null references companies(id) on delete cascade,
  document_kind       tax_document_kind not null default 'invoice',
  posting_type        tax_posting_type not null,
  -- Share of the amount carried by this posting. Positive keeps the side of
  -- the base line, negative flips it: that is how a self-assessed tax books
  -- +100 on the deductible account and -100 on the payable one.
  factor_percent      numeric(7, 3) not null default 100,
  -- NULL on a base posting: the base keeps the account of the document line.
  account_id          uuid references accounts(id) on delete restrict,
  -- Box of the national VAT return this posting feeds, e.g. '03', '59', 'B1'.
  declaration_box     text,
  -- Share reported in that box. Independent from factor_percent, because a
  -- box is always filled with the sign the form expects.
  box_factor_percent  numeric(7, 3) not null default 100,
  sequence            integer not null default 10,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint tax_postings_base_has_no_account check (
    posting_type <> 'base' or account_id is null
  ),
  constraint tax_postings_tax_has_account check (
    posting_type <> 'tax' or account_id is not null
  ),
  foreign key (tax_id, company_id) references taxes(id, company_id) on delete cascade,
  foreign key (account_id, company_id) references accounts(id, company_id)
);

comment on table tax_postings is
  'Where a tax lands: ledger account and VAT-return box, per tax and per document kind.';
comment on column tax_postings.factor_percent is
  'Accounting share. Positive keeps the base side, negative flips it (self-assessment).';
comment on column tax_postings.box_factor_percent is
  'Declaration share. Separate from factor_percent so a box always gets the sign the form expects.';

create index tax_postings_tax_idx on tax_postings (tax_id, document_kind, posting_type, sequence);
-- A tax describes one basis, so it has at most one base posting per document
-- kind. Several would silently double the reported base.
create unique index tax_postings_one_base_idx
  on tax_postings (tax_id, document_kind) where posting_type = 'base';
create index tax_postings_box_idx on tax_postings (company_id, declaration_box);

create trigger tax_postings_set_updated_at
  before update on tax_postings
  for each row execute function set_updated_at();

-- Resolve the rate of a tax at a given date; NULL when it is not in force.
create or replace function tax_rate_at(p_tax_id uuid, p_date date)
returns numeric
language sql
stable
as $$
  select t.amount
    from taxes t
   where t.id = p_tax_id
     and t.amount_type = 'percent'
     and p_date >= t.valid_from
     and (t.valid_to is null or p_date <= t.valid_to);
$$;

comment on function tax_rate_at(uuid, date) is 'Percentage in force at a date, NULL when the tax does not apply then.';

alter table taxes        enable row level security;
alter table tax_postings enable row level security;

create policy taxes_select on taxes
  for select using (is_company_member(company_id));
create policy taxes_write on taxes
  for all using (can_write_company(company_id)) with check (can_write_company(company_id));

create policy tax_postings_select on tax_postings
  for select using (is_company_member(company_id));
create policy tax_postings_write on tax_postings
  for all using (can_write_company(company_id)) with check (can_write_company(company_id));
