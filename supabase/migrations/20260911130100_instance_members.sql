-- Ekwo OS — the instance-level role.
--
-- `member_role` is now one vocabulary for the whole installation:
-- `instance_admin` at instance level, `owner` / `accountant` / `viewer` per
-- company. The storage is split because the keys differ — a company role is
-- keyed by (company, user), an instance role by user alone — and a nullable
-- company in `company_members` would break its primary key and its meaning.
-- Two check constraints keep each table to the roles it may carry.
--
-- Users live in the customer's own Supabase Auth. `user_id` holds an
-- `auth.users.id` from their project; Ekwo never holds an account.

create table instance_members (
  user_id    uuid primary key,
  role       member_role not null default 'instance_admin',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- The only instance-level role today. Widening this is a deliberate act.
  constraint instance_members_role_is_instance_level check (role = 'instance_admin')
);

comment on table instance_members is
  'Instance administrators: they create companies and invite members. user_id is an auth.users id from the customer''s own Supabase project.';
comment on column instance_members.user_id is
  'An auth.users.id in the customer''s Supabase Auth. No foreign key, so the schema installs on a plain Postgres and seeds never write into auth.';

create trigger instance_members_set_updated_at
  before update on instance_members
  for each row execute function set_updated_at();

-- A company role is a company role.
alter table company_members
  add constraint company_members_role_is_company_level check (role <> 'instance_admin');

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- SECURITY DEFINER so the policy on instance_members does not recurse into
-- the table it protects.
create or replace function is_instance_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from instance_members m
     where m.user_id = auth.uid() and m.role = 'instance_admin'
  );
$$;

comment on function is_instance_admin() is
  'Whether the current user administers this installation.';

create or replace function instance_has_no_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select not exists (select 1 from instance_members);
$$;

-- ---------------------------------------------------------------------------
-- Installation
-- ---------------------------------------------------------------------------

create or replace function init_instance(
  p_organization_name text,
  p_country           char(2),
  p_edition           instance_edition default 'community'
)
returns instance
language plpgsql
as $$
declare
  v_row instance%rowtype;
begin
  if exists (select 1 from instance) then
    raise exception 'instance_already_initialised: this installation is already set up';
  end if;

  insert into instance (id, organization_name, country, edition, schema_version)
  values (1, p_organization_name, upper(p_country), p_edition, ekwo_schema_version())
  returning * into v_row;

  return v_row;
end;
$$;

comment on function init_instance(text, char, instance_edition) is
  'Records the installation. Called once, by the installer. Leaves the registration fields empty.';

-- The first user to ask takes the instance. After that, only an existing
-- administrator can appoint another.
create or replace function claim_instance_admin(p_user_id uuid default auth.uid())
returns instance_members
language plpgsql
as $$
declare
  v_row instance_members%rowtype;
begin
  if p_user_id is null then
    raise exception 'no_user: claim_instance_admin needs a signed-in user or an explicit id';
  end if;

  if exists (select 1 from instance_members) and not is_instance_admin() then
    raise exception 'instance_already_claimed: only an instance administrator can appoint another';
  end if;

  insert into instance_members (user_id, role)
  values (p_user_id, 'instance_admin')
  on conflict (user_id) do update set role = 'instance_admin'
  returning * into v_row;

  return v_row;
end;
$$;

comment on function claim_instance_admin(uuid) is
  'Makes a user an instance administrator. The first claim is open; afterwards only an administrator may appoint one.';

-- Opt-in registration with Ekwo. Nothing calls this on its own.
create or replace function register_instance(p_contact_email text)
returns instance
language plpgsql
as $$
declare
  v_row instance%rowtype;
begin
  if not is_instance_admin() then
    raise exception 'not_instance_admin: only an instance administrator can register this installation';
  end if;

  update instance
     set contact_email = p_contact_email,
         registered_at = now()
   where id = 1
  returning * into v_row;

  if not found then
    raise exception 'instance_not_initialised: call init_instance() first';
  end if;

  return v_row;
end;
$$;

comment on function register_instance(text) is
  'Opt-in: records an address and a date so Ekwo can reach the operator. Never required, and reversible with unregister_instance().';

create or replace function unregister_instance()
returns instance
language plpgsql
as $$
declare
  v_row instance%rowtype;
begin
  if not is_instance_admin() then
    raise exception 'not_instance_admin: only an instance administrator can unregister this installation';
  end if;

  update instance set contact_email = null, registered_at = null where id = 1
  returning * into v_row;

  return v_row;
end;
$$;

comment on function unregister_instance() is
  'Undoes register_instance(). Opting in is reversible, or it is not a choice.';

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table instance_members enable row level security;

create policy instance_members_select on instance_members
  for select using (auth.uid() is not null);
create policy instance_members_insert on instance_members
  for insert with check (is_instance_admin() or instance_has_no_admin());
create policy instance_members_update on instance_members
  for update using (is_instance_admin()) with check (is_instance_admin());
create policy instance_members_delete on instance_members
  for delete using (is_instance_admin());

create policy instance_write on instance
  for all using (is_instance_admin()) with check (is_instance_admin());

-- Creating a company is an instance-level act. The select policy has to
-- follow: `insert ... returning` is checked against it too, so without this
-- an administrator would create a company and still get an error back.
drop policy companies_insert on companies;
create policy companies_insert on companies
  for insert with check (is_instance_admin());

drop policy companies_select on companies;
create policy companies_select on companies
  for select using (is_company_member(id) or is_instance_admin());

-- An instance administrator may invite members into any company.
drop policy company_members_insert on company_members;
create policy company_members_insert on company_members
  for insert with check (
    is_company_owner(company_id)
    or is_instance_admin()
    or company_has_no_member(company_id)
  );

drop policy company_members_select on company_members;
create policy company_members_select on company_members
  for select using (
    user_id = auth.uid() or is_company_member(company_id) or is_instance_admin()
  );

-- ... and an instance administrator may administer a company they are not in.
drop policy companies_update on companies;
create policy companies_update on companies
  for update using (is_company_owner(id) or is_instance_admin())
  with check (is_company_owner(id) or is_instance_admin());
