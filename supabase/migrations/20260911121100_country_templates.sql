-- Ekwo OS — country templates.
--
-- The chart of accounts, the journals and the taxes of a country are
-- reference data, not code. `install_country_template()` copies them into a
-- company. Seeds fill the templates; nothing here is country specific.

create table account_templates (
  id           uuid primary key default gen_random_uuid(),
  country      char(2) not null,
  code         text not null,
  name         text not null,
  account_type account_type not null,
  reconcilable boolean not null default false,
  parent_code  text,
  sequence     integer not null default 10,
  unique (country, code),
  constraint account_templates_country_format check (country ~ '^[A-Z]{2}$'),
  constraint account_templates_third_party_reconcilable check (
    account_type not in ('asset_receivable', 'liability_payable') or reconcilable
  )
);

comment on table account_templates is 'Reference charts of accounts, one set per country.';

create table journal_templates (
  id           uuid primary key default gen_random_uuid(),
  country      char(2) not null,
  code         text not null,
  name         text not null,
  journal_type journal_type not null,
  sequence     integer not null default 10,
  unique (country, code)
);

create table tax_templates (
  id              uuid primary key default gen_random_uuid(),
  country         char(2) not null,
  code            text not null,
  name            text not null,
  description     text,
  amount_type     tax_amount_type not null default 'percent',
  amount          numeric(12, 4) not null default 0,
  applies_to      tax_scope not null default 'both',
  treatment       tax_treatment not null default 'domestic',
  valid_from      date not null default date '1970-01-01',
  valid_to        date,
  legal_reference text,
  vat_category    char(2),
  exemption_code  text,
  sequence        integer not null default 10,
  unique (country, code)
);

comment on table tax_templates is 'Reference taxes per country, with their period of validity.';

create table tax_posting_templates (
  id                 uuid primary key default gen_random_uuid(),
  tax_template_id    uuid not null references tax_templates(id) on delete cascade,
  document_kind      tax_document_kind not null default 'invoice',
  posting_type       tax_posting_type not null,
  factor_percent     numeric(7, 3) not null default 100,
  account_code       text,
  declaration_box    text,
  box_factor_percent numeric(7, 3) not null default 100,
  sequence           integer not null default 10,
  constraint tax_posting_templates_base_has_no_account check (
    posting_type <> 'base' or account_code is null
  ),
  constraint tax_posting_templates_tax_has_account check (
    posting_type <> 'tax' or account_code is not null
  )
);

create unique index tax_posting_templates_one_base_idx
  on tax_posting_templates (tax_template_id, document_kind) where posting_type = 'base';

create table country_defaults (
  country                 char(2) primary key,
  name                    text not null,
  currency_code           char(3) not null default 'EUR',
  receivable_code         text not null,
  payable_code            text not null,
  suspense_code           text,
  rounding_code           text,
  retained_earnings_code  text,
  sales_account_code      text,
  purchase_account_code   text,
  bank_account_code       text,
  sales_journal_code      text not null default 'SAL',
  purchase_journal_code   text not null default 'PUR',
  misc_journal_code       text not null default 'MISC'
);

comment on table country_defaults is 'Which template account plays which role, per country.';

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function account_id_by_code(p_company_id uuid, p_code text)
returns uuid
language sql
stable
as $$
  select id from accounts where company_id = p_company_id and code = p_code;
$$;

comment on function account_id_by_code(uuid, text) is 'Account of a company by its code, or NULL.';

-- ---------------------------------------------------------------------------
-- install_country_template
-- ---------------------------------------------------------------------------

create or replace function install_country_template(
  p_company_id uuid,
  p_country    char(2)
)
returns void
language plpgsql
as $$
declare
  v_defaults country_defaults%rowtype;
  r          record;
  v_tax_id   uuid;
begin
  if not exists (select 1 from companies where id = p_company_id) then
    raise exception 'unknown_company: %', p_company_id;
  end if;
  if not exists (select 1 from account_templates where country = p_country) then
    raise exception 'unknown_country_template: no chart of accounts seeded for %', p_country;
  end if;

  -- 1. Accounts, without the hierarchy.
  insert into accounts (company_id, code, name, account_type, reconcilable)
  select p_company_id, t.code, t.name, t.account_type, t.reconcilable
    from account_templates t
   where t.country = p_country
  on conflict (company_id, code) do nothing;

  -- 2. Hierarchy, now that every code exists.
  update accounts a
     set parent_id = p.id
    from account_templates t
    join accounts p on p.company_id = p_company_id and p.code = t.parent_code
   where a.company_id = p_company_id
     and a.code = t.code
     and t.country = p_country
     and t.parent_code is not null
     and a.parent_id is null;

  -- 3. Journals.
  insert into journals (company_id, code, name, journal_type)
  select p_company_id, t.code, t.name, t.journal_type
    from journal_templates t
   where t.country = p_country
  on conflict (company_id, code) do nothing;

  -- 4. Taxes and their postings.
  for r in
    select * from tax_templates where country = p_country order by sequence, code
  loop
    v_tax_id := null;
    insert into taxes (company_id, code, name, description, amount_type, amount,
                       applies_to, treatment, country, valid_from, valid_to,
                       legal_reference, vat_category, exemption_code, sequence)
    values (p_company_id, r.code, r.name, r.description, r.amount_type, r.amount,
            r.applies_to, r.treatment, p_country, r.valid_from, r.valid_to,
            r.legal_reference, r.vat_category, r.exemption_code, r.sequence)
    on conflict (company_id, code) do nothing
    returning id into v_tax_id;

    if v_tax_id is null then
      continue;
    end if;

    insert into tax_postings (tax_id, company_id, document_kind, posting_type,
                              factor_percent, account_id, declaration_box,
                              box_factor_percent, sequence)
    select v_tax_id, p_company_id, tp.document_kind, tp.posting_type,
           tp.factor_percent, account_id_by_code(p_company_id, tp.account_code),
           tp.declaration_box, tp.box_factor_percent, tp.sequence
      from tax_posting_templates tp
     where tp.tax_template_id = r.id
     order by tp.sequence;
  end loop;

  -- 5. Roles.
  select * into v_defaults from country_defaults where country = p_country;
  if found then
    update companies c
       set receivable_account_id       = coalesce(c.receivable_account_id, account_id_by_code(p_company_id, v_defaults.receivable_code)),
           payable_account_id          = coalesce(c.payable_account_id, account_id_by_code(p_company_id, v_defaults.payable_code)),
           suspense_account_id         = coalesce(c.suspense_account_id, account_id_by_code(p_company_id, v_defaults.suspense_code)),
           rounding_account_id         = coalesce(c.rounding_account_id, account_id_by_code(p_company_id, v_defaults.rounding_code)),
           retained_earnings_account_id = coalesce(c.retained_earnings_account_id, account_id_by_code(p_company_id, v_defaults.retained_earnings_code)),
           sales_journal_id            = coalesce(c.sales_journal_id, (select id from journals where company_id = p_company_id and code = v_defaults.sales_journal_code)),
           purchase_journal_id         = coalesce(c.purchase_journal_id, (select id from journals where company_id = p_company_id and code = v_defaults.purchase_journal_code)),
           miscellaneous_journal_id    = coalesce(c.miscellaneous_journal_id, (select id from journals where company_id = p_company_id and code = v_defaults.misc_journal_code))
     where c.id = p_company_id;
  end if;
end;
$$;

comment on function install_country_template(uuid, char) is
  'Copies a country chart of accounts, journals and taxes into a company and wires the default roles.';

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table account_templates      enable row level security;
alter table journal_templates      enable row level security;
alter table tax_templates          enable row level security;
alter table tax_posting_templates  enable row level security;
alter table country_defaults       enable row level security;

create policy account_templates_select on account_templates
  for select using (auth.uid() is not null);
create policy journal_templates_select on journal_templates
  for select using (auth.uid() is not null);
create policy tax_templates_select on tax_templates
  for select using (auth.uid() is not null);
create policy tax_posting_templates_select on tax_posting_templates
  for select using (auth.uid() is not null);
create policy country_defaults_select on country_defaults
  for select using (auth.uid() is not null);
