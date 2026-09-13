-- Ekwo OS — a guard that answers NULL is a guard that never fires.
--
-- `company_role()` returns NULL for somebody who is not a member of the
-- company, which is the honest answer to "which preset are they on". Two
-- helpers were built straight on top of it and inherited the NULL:
--
--   is_company_owner(c)  =  company_role(c) = 'owner'
--   can_write_company(c) =  company_role(c) in ('owner', 'accountant')
--
-- Inside a policy that is harmless — `USING (NULL)` admits nothing. Inside a
-- procedural guard it is the opposite of harmless:
--
--   if not is_company_owner(p_company_id) then raise …
--
-- `not NULL` is NULL, `if NULL then` does not branch, and the stranger walks
-- past the exception into the body of a SECURITY DEFINER function. That is
-- exactly what `enable_module()` and `disable_module()` did, on a table —
-- `company_modules` — that has no write policy at all, so the function was
-- the only door and the door was open.
--
-- Two changes, because either alone would leave the trap in place for the
-- next function:
--
--   1. the two helpers answer `false` where they answered NULL, so the shape
--      `if not <helper>(…)` is safe wherever somebody writes it next;
--   2. the two module functions stop asking about a *role* and ask about the
--      capability the act needs — `company.write`, which the owner preset
--      holds and the accountant preset does not, so who is refused today is
--      exactly who was refused before the bug.
--
-- `has_capability()` has always coalesced to false, which is why every guard
-- written on it was sound. A test in `hardening.test.ts` now refuses any
-- function body that tests a helper which can answer NULL.
--
-- ---------------------------------------------------------------------------
-- The installer, named rather than inferred
--
-- A guard that asks for a capability has to let the installation itself
-- through: `ekwo migrate`, the seeds and `ekwo module enable` hold a database
-- connection and no session, so `auth.uid()` is null and `has_capability()`
-- says no to everything. Until now the schema wrote that exemption as
-- `auth.uid() is not null and not has_capability(…)`, which reads as "a
-- signed-in caller is checked" and means "an unsigned caller is not".
--
-- `is_installer()` states it instead, and states it narrowly: the runner sets
-- `ekwo.installing` on the connection it opened, nothing else sets it, and it
-- is refused outright when a machine key is presenting itself or when there is
-- a session. A caller that reaches the database through PostgREST cannot set
-- a GUC, and a caller holding a key has `ekwo.api_key` set by `use_api_key()`
-- for the length of its transaction. The next migration moves the whole
-- `auth.uid() is not null` family onto it.
-- ---------------------------------------------------------------------------

create or replace function is_installer()
returns boolean
language sql
stable
as $$
  select auth.uid() is null
     and nullif(current_setting('ekwo.api_key', true), '') is null
     and current_setting('ekwo.installing', true) = 'on';
$$;

comment on function is_installer() is
  'Whether the caller is the installation itself — the migration runner, the seeds, the CLI — rather than a person or a machine key. Set by the runner on its own connection; a session or a key can never be it.';

-- ---------------------------------------------------------------------------
-- The two helpers that could answer NULL
-- ---------------------------------------------------------------------------

create or replace function is_company_owner(p_company_id uuid)
returns boolean
language sql
stable
as $$
  select coalesce(company_role(p_company_id) = 'owner', false);
$$;

comment on function is_company_owner(uuid) is
  'Whether the current user is on the owner preset of a company. False, never NULL, for somebody who is not a member — a guard written as `if not is_company_owner(…)` has to fire for a stranger.';

create or replace function can_write_company(p_company_id uuid)
returns boolean
language sql
stable
as $$
  select coalesce(has_capability(p_company_id, 'entries.write'), false);
$$;

comment on function can_write_company(uuid) is
  'Whether the current caller may write the books of a company. One capability, not a role, and false rather than NULL for a stranger.';

-- ---------------------------------------------------------------------------
-- Enabling and disabling a module
--
-- Republished whole: the body is the one from 20260913074512 with the guard
-- rewritten. `company_modules` still has no write policy, so these two
-- functions are still the only way in.
-- ---------------------------------------------------------------------------

create or replace function enable_module(
  p_company_id uuid,
  p_code       text,
  p_settings   jsonb default null
)
returns company_modules
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_module modules%rowtype;
  v_row    company_modules%rowtype;
begin
  if not is_installer() and not has_capability(p_company_id, 'company.write') then
    raise exception 'not_allowed: enabling a module on this company needs company.write'
      using errcode = '42501';
  end if;

  select * into v_module from modules where code = p_code;
  if not found then
    raise exception 'unknown_module: % is not installed on this instance; apply its migrations first', p_code;
  end if;

  if v_module.status = 'draft' and not module_is_enabled(p_company_id, p_code) then
    raise exception 'module_not_available: % is still a draft on this installation', p_code;
  end if;
  if v_module.status = 'deprecated' and not module_is_enabled(p_company_id, p_code) then
    raise exception 'module_deprecated: % is deprecated and takes no new company', p_code;
  end if;

  insert into company_modules (company_id, module_code, enabled_by, settings)
  values (p_company_id, p_code, auth.uid(), coalesce(p_settings, '{}'::jsonb))
  on conflict (company_id, module_code) do update
    set settings = coalesce(p_settings, company_modules.settings)
  returning * into v_row;

  return v_row;
end;
$$;

comment on function enable_module(uuid, text, jsonb) is
  'Enables a module on a company, and updates its settings when it is already enabled. Needs company.write, checked here because the table has no write policy.';

create or replace function disable_module(p_company_id uuid, p_code text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_module modules%rowtype;
  v_check  regprocedure;
  v_reason text;
begin
  if not is_installer() and not has_capability(p_company_id, 'company.write') then
    raise exception 'not_allowed: disabling a module on this company needs company.write'
      using errcode = '42501';
  end if;

  select * into v_module from modules where code = p_code;
  if not found then
    raise exception 'unknown_module: % is not installed on this instance', p_code;
  end if;

  if not module_is_enabled(p_company_id, p_code) then
    return;
  end if;

  v_check := to_regprocedure(format('%I.can_disable(uuid)', v_module.schema_name));
  if v_check is not null then
    execute format('select %I.can_disable($1)', v_module.schema_name)
      into v_reason using p_company_id;
    if v_reason is not null then
      raise exception 'module_holds_data: % cannot be disabled on this company — %', p_code, v_reason
        using errcode = '55006';
    end if;
  end if;

  delete from company_modules
   where company_id = p_company_id and module_code = p_code;
end;
$$;

comment on function disable_module(uuid, text) is
  'Disables a module on a company, unless the module says it still holds data — `<schema>.can_disable(company)` returning a sentence refuses, returning null allows. Nothing the module wrote is deleted. Needs company.write.';

revoke execute on all functions in schema public from public;
