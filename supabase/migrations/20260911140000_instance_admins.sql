-- Ekwo OS — instance administrators, final shape.
--
-- Three changes on top of the previous migration, additive as always:
--
--   1. `instance_members` becomes `instance_admins`. The table name carries
--      the role, so the `role` column carried nothing.
--   2. `user_id` gets a real foreign key to `auth.users`. An administrator is
--      necessarily a signed-in user, so there is no invite-before-signup case
--      to accommodate here. `company_members` deliberately keeps no such key:
--      inviting someone into a company before they have an account is a
--      normal thing to want.
--   3. Reading the instance row is for people who are actually on this
--      installation — a member of at least one company, or an administrator —
--      rather than anyone holding a token.

alter table instance_members rename to instance_admins;

alter policy instance_members_select on instance_admins rename to instance_admins_select;
alter policy instance_members_insert on instance_admins rename to instance_admins_insert;
alter policy instance_members_update on instance_admins rename to instance_admins_update;
alter policy instance_members_delete on instance_admins rename to instance_admins_delete;

alter table instance_admins drop constraint instance_members_role_is_instance_level;
alter table instance_admins drop column role;

alter table instance_admins
  add constraint instance_admins_user_fkey
    foreign key (user_id) references auth.users(id) on delete cascade;

comment on table instance_admins is
  'Instance administrators: they create companies and invite members. One row per user, keyed on auth.users of the customer''s own Supabase project.';
comment on column instance_admins.user_id is
  'An auth.users.id in the customer''s Supabase Auth. Ekwo holds no account and no directory.';

-- ---------------------------------------------------------------------------
-- Helpers, against the renamed table
-- ---------------------------------------------------------------------------

create or replace function is_instance_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from instance_admins a where a.user_id = auth.uid());
$$;

create or replace function instance_has_no_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select not exists (select 1 from instance_admins);
$$;

-- Whether the current user is on the books of at least one company here.
create or replace function is_any_company_member()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from company_members m where m.user_id = auth.uid());
$$;

comment on function is_any_company_member() is
  'Whether the current user belongs to at least one company of this installation.';

drop function if exists claim_instance_admin(uuid);

create or replace function claim_instance_admin(p_user_id uuid default auth.uid())
returns instance_admins
language plpgsql
as $$
declare
  v_row instance_admins%rowtype;
begin
  if p_user_id is null then
    raise exception 'no_user: claim_instance_admin needs a signed-in user or an explicit id';
  end if;

  if exists (select 1 from instance_admins) and not is_instance_admin() then
    raise exception 'instance_already_claimed: only an instance administrator can appoint another';
  end if;

  insert into instance_admins (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing
  returning * into v_row;

  if v_row.user_id is null then
    select * into v_row from instance_admins where user_id = p_user_id;
  end if;

  return v_row;
end;
$$;

comment on function claim_instance_admin(uuid) is
  'Makes a user an instance administrator. The first claim is open; afterwards only an administrator may appoint one.';

-- ---------------------------------------------------------------------------
-- Reading the instance row
-- ---------------------------------------------------------------------------

drop policy instance_select on instance;
create policy instance_select on instance
  for select using (is_any_company_member() or is_instance_admin());
