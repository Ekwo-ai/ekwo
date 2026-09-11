-- Ekwo OS — the instance itself.
--
-- One installation belongs to one customer, so the installation is a fact
-- worth recording: who it belongs to, which country's rules it was set up
-- for, which edition it runs, and which schema version it was installed at.
-- Exactly one row, forever. There is no `tenant_id` anywhere in this schema
-- and this table is the reason: the instance IS the tenant.
--
-- Registration with Ekwo is an opt-in. `contact_email` and `registered_at`
-- are empty on a fresh install, nothing writes them without the operator
-- asking, and nothing in the software checks them. Community works
-- unregistered, forever.

-- The instance-level role. A new enum value cannot be used in the same
-- transaction that adds it, so the table that constrains it lives in the
-- next migration.
alter type member_role add value if not exists 'instance_admin';

create type instance_edition as enum ('community', 'cloud');

-- The schema version this release ships. Bumped by a migration at each
-- release; `ekwo migrate` writes it back onto the instance row.
create or replace function ekwo_schema_version()
returns text
language sql
immutable
as $$
  select '0.1.0'::text;
$$;

comment on function ekwo_schema_version() is
  'Schema version of the installed release. Bumped by a migration, never by hand.';

create table instance (
  -- Singleton. The primary key and the check together make a second row
  -- impossible, rather than merely unusual.
  id                smallint primary key default 1,
  instance_id       uuid not null unique default gen_random_uuid(),
  organization_name text not null,
  country           char(2) not null,
  edition           instance_edition not null default 'community',
  schema_version    text not null default ekwo_schema_version(),
  installed_at      timestamptz not null default now(),
  -- Opt-in registration with Ekwo. Empty by default, never a condition of
  -- use, never checked by anything in this repository.
  contact_email     text,
  registered_at     timestamptz,
  updated_at        timestamptz not null default now(),
  constraint instance_singleton check (id = 1),
  constraint instance_country_format check (country ~ '^[A-Z]{2}$'),
  constraint instance_registration_needs_an_address check (
    registered_at is null or contact_email is not null
  )
);

comment on table instance is
  'The installation itself. Exactly one row. Registration with Ekwo is optional and empty by default.';
comment on column instance.instance_id is
  'Stable identifier of this installation, generated locally. Never a licence key.';
comment on column instance.edition is
  'community when you run it yourself, cloud when Ekwo operates it. Gates nothing in this repository.';
comment on column instance.schema_version is
  'Version of the schema at install, updated by migrations.';
comment on column instance.contact_email is
  'Opt-in only: an address to reach the operator. Empty unless they asked to register.';
comment on column instance.registered_at is
  'Opt-in only: when the operator registered with Ekwo. Empty means not registered, which is a supported state.';

create trigger instance_set_updated_at
  before update on instance
  for each row execute function set_updated_at();

alter table instance enable row level security;

-- Anyone signed into this installation may see which installation it is.
create policy instance_select on instance
  for select using (auth.uid() is not null);
