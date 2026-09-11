-- Ekwo OS — contacts (customers, suppliers, employees).

create type contact_type as enum ('customer', 'supplier', 'both', 'employee', 'other');

create table contacts (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references companies(id) on delete cascade,
  name                 text not null,
  contact_type         contact_type not null default 'customer',
  is_company           boolean not null default true,
  -- The entity actually invoiced, when this contact is a site or a person of
  -- a larger group. Postings use the root of the chain.
  parent_id            uuid references contacts(id) on delete set null,
  vat_number           text,
  registration_number  text,
  -- Sub-ledger code. This is `CompAuxNum` of the French FEC.
  auxiliary_code       text,
  email                text,
  phone                text,
  address_line1        text,
  address_line2        text,
  postal_code          text,
  city                 text,
  country              char(2),
  language             char(2),
  currency_code        char(3) references currencies(code),
  payment_terms_days   smallint not null default 30,
  receivable_account_id uuid references accounts(id) on delete set null,
  payable_account_id    uuid references accounts(id) on delete set null,
  iban                 text,
  bic                  text,
  -- Peppol participant identifier, e.g. scheme 0208 + Belgian enterprise number.
  peppol_scheme        text,
  peppol_identifier    text,
  active               boolean not null default true,
  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint contacts_country_format check (country is null or country ~ '^[A-Z]{2}$'),
  constraint contacts_payment_terms check (payment_terms_days >= 0),
  constraint contacts_not_own_parent check (parent_id is null or parent_id <> id)
);

comment on table contacts is 'Third parties. `contact_type` is explicit rather than two hidden counters.';
comment on column contacts.auxiliary_code is 'Sub-ledger code, exported as CompAuxNum in the FEC.';
comment on column contacts.parent_id is 'Billing parent; commercial_entity() walks to the root.';

create unique index contacts_company_auxiliary_code_idx
  on contacts (company_id, auxiliary_code)
  where auxiliary_code is not null;
create index contacts_company_name_idx on contacts (company_id, name);
create index contacts_parent_idx on contacts (parent_id);
create unique index contacts_id_company_idx on contacts (id, company_id);

create trigger contacts_set_updated_at
  before update on contacts
  for each row execute function set_updated_at();

-- The billable entity: the root of the parent chain.
create or replace function commercial_entity(p_contact_id uuid)
returns uuid
language plpgsql
stable
as $$
declare
  v_id     uuid := p_contact_id;
  v_parent uuid;
  v_guard  int := 0;
begin
  loop
    select parent_id into v_parent from contacts where id = v_id;
    exit when v_parent is null;
    v_id := v_parent;
    v_guard := v_guard + 1;
    if v_guard > 32 then
      raise exception 'contact_parent_cycle: contact % has a cyclic or too deep parent chain', p_contact_id;
    end if;
  end loop;
  return v_id;
end;
$$;

comment on function commercial_entity(uuid) is 'Root of the contact parent chain; the entity a document is booked against.';

alter table contacts enable row level security;

create policy contacts_select on contacts
  for select using (is_company_member(company_id));
create policy contacts_write on contacts
  for all using (can_write_company(company_id)) with check (can_write_company(company_id));
