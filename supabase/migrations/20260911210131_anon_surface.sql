-- Ekwo OS — a smaller surface for the anonymous role and for strangers.
--
-- Two findings of the security audit of 11 September 2026, both about what
-- someone who is *not* a member of any company can reach.
--
-- 1. Every function in `public` was executable by `anon`, because Postgres
--    grants EXECUTE to PUBLIC on creation and Supabase exposes `public`
--    functions as RPC. Row level security made every call return nothing,
--    but nothing is not the same as no. `anon` keeps EXECUTE on the eight
--    helpers that row level security policies call — they answer about
--    `auth.uid()` only, and without them an anonymous SELECT would error
--    instead of returning an empty set — and loses it on everything else.
--    The default privileges are changed too, so a function added tomorrow
--    starts closed.
--
-- 2. `instance_admins` was readable by any signed-in user, member or not.
--    Supabase projects accept self sign-up by default, so "signed in" is a
--    weaker claim than it sounds. Administrators are now visible to members
--    of at least one company, to administrators, and to oneself.
--
-- Nothing already published is edited: revokes, grants and one policy.

-- 1. Functions ------------------------------------------------------------

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated, service_role;

-- The helpers a policy may evaluate on behalf of an anonymous request.
grant execute on function company_role(uuid)          to anon;
grant execute on function is_company_member(uuid)     to anon;
grant execute on function can_write_company(uuid)     to anon;
grant execute on function is_company_owner(uuid)      to anon;
grant execute on function is_instance_admin()         to anon;
grant execute on function is_any_company_member()     to anon;
grant execute on function company_has_no_member(uuid) to anon;
grant execute on function instance_has_no_admin()     to anon;

alter default privileges in schema public revoke execute on functions from public, anon;
alter default privileges in schema public grant execute on functions to authenticated, service_role;

-- 2. Who may see the administrators ---------------------------------------

drop policy if exists instance_admins_select on instance_admins;
create policy instance_admins_select on instance_admins
  for select
  using (user_id = auth.uid() or is_any_company_member() or is_instance_admin());

comment on policy instance_admins_select on instance_admins is
  'Members, administrators, and oneself. A signed-in stranger sees no one.';

-- 3. The claim keeps its clear refusal ------------------------------------
--
-- `claim_instance_admin` used to learn whether the seat was taken by reading
-- `instance_admins` as the caller. A stranger can no longer read it, so the
-- same call would have fallen through to the policy and answered with a bare
-- row-level-security error. `instance_has_no_admin()` is the definer helper
-- made for exactly this question, and it answers it for everyone.

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

  if not instance_has_no_admin() and not is_instance_admin() then
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
