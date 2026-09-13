-- Ekwo OS — a key for a machine, and what it is deliberately not.
--
-- Everything in this schema answers to `auth.uid()`, which comes from a JWT
-- the customer's own GoTrue issued. That is right for a person and impossible
-- for a script: a nightly import, a till, a bank feed has no browser to sign
-- in with, and the two usual answers are both wrong. Handing it the
-- `service_role` key gives it every company of the installation and every
-- table in it. Creating a fake user for it puts a password in a crontab and
-- makes the audit trail say a person did it.
--
-- So a key is a **third kind of caller**, and it is narrower than both by
-- construction:
--
--   * it belongs to one company and can never reach another;
--   * it carries an explicit list of capabilities, which the person who
--     issued it must hold themselves — nobody mints a key stronger than they
--     are;
--   * it expires when it is told to, and it is withdrawn by one update;
--   * it is stored as a sha256 and shown once, like an invitation token.
--
-- **How a key authenticates, and why it is this way.** A holder calls
-- `use_api_key(secret)` at the start of a transaction. That function checks
-- the hash, refuses a withdrawn or expired key, records the use, and puts the
-- key's fingerprint in `ekwo.api_key` — transaction-locally, so it is gone
-- when the transaction ends. `has_capability()` then answers for the key as
-- well as for the user, and every policy in the schema follows without being
-- rewritten.
--
-- The alternative considered was exchanging a key for a GoTrue session. It
-- needs GoTrue to know about our keys, which means either a fake user per key
-- — the thing this is here to avoid — or a service that mints tokens, which
-- is a second secret to hold. The setting is simpler and its blast radius is
-- one transaction.
--
-- **What it cannot do, stated rather than discovered.** A key is not a
-- session. `auth.uid()` stays null, so the policies that ask for a signed-in
-- user rather than for a capability — the reference tables, the company row
-- itself — stay closed to it. And because PostgREST runs each request in its
-- own transaction, `use_api_key()` cannot be a separate request over that
-- route: a key is for a client that holds a connection and opens a
-- transaction, which is the self-hosted route the MCP server already has.
--
-- **The setting cannot be forged into a privilege.** What goes into
-- `ekwo.api_key` is the hash, not the id, and the hash is only readable by
-- somebody who already holds `members.manage` on that company — who can
-- simply issue a key. There is nothing to escalate to.

create table api_keys (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id) on delete cascade,
  name         text not null,
  -- The visible half, so a list of keys can be read by a human and a leaked
  -- secret can be matched to the row it belongs to.
  prefix       text not null,
  key_hash     text not null unique,
  capabilities text[] not null,
  created_by   uuid,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz,
  last_used_at timestamptz,
  revoked_at   timestamptz,
  constraint api_keys_has_capability check (cardinality(capabilities) > 0),
  constraint api_keys_expiry check (expires_at is null or expires_at > created_at)
);

comment on table api_keys is
  'Machine access to one company. Hashed at rest, scoped to an explicit list of capabilities, and never wider than the person who issued it.';
comment on column api_keys.prefix is
  'The readable head of the secret. It identifies a key without being one.';
comment on column api_keys.capabilities is
  'Exactly what this key may do. Not a role: a machine has a job, not a job title.';
comment on column api_keys.created_by is
  'auth.users.id of whoever issued it. No foreign key, for the same reason company_members has none.';

create index api_keys_company_idx on api_keys (company_id, created_at desc);
create index api_keys_prefix_idx on api_keys (prefix);

-- ---------------------------------------------------------------------------
-- Issuing one
-- ---------------------------------------------------------------------------

create or replace function create_api_key(
  p_company_id   uuid,
  p_name         text,
  p_capabilities jsonb,
  p_expires_at   timestamptz default null
)
returns table (api_key_id uuid, secret text, prefix text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caps   text[] := coalesce(
    (select array_agg(value) from jsonb_array_elements_text(coalesce(p_capabilities, '[]'::jsonb)) as value),
    '{}');
  v_prefix text := left(replace(gen_random_uuid()::text, '-', ''), 12);
  v_secret text;
  v_cap    text;
  v_row    api_keys%rowtype;
begin
  if auth.uid() is not null and not has_capability(p_company_id, 'members.manage') then
    raise exception 'not_allowed: issuing a key for this company needs members.manage'
      using errcode = '42501';
  end if;

  if cardinality(v_caps) = 0 then
    raise exception 'api_key_without_capability: name what this key may do; a key that may do nothing is a secret to look after for no reason';
  end if;

  foreach v_cap in array v_caps loop
    if v_cap not in (select code from capabilities) then
      raise exception 'unknown_capability: % is not a capability of this installation', v_cap;
    end if;
    -- Nobody mints a key stronger than they are. An owner issuing a key is
    -- bounded by their own capabilities, which is also what makes revoking a
    -- person's capability revoke the keys they left behind.
    if auth.uid() is not null and not has_capability(p_company_id, v_cap) then
      raise exception 'not_allowed: you do not hold % yourself, so you cannot put it on a key', v_cap
        using errcode = '42501';
    end if;
  end loop;

  v_secret := 'ekwo_' || v_prefix || '_' ||
              replace(gen_random_uuid()::text, '-', '') ||
              replace(gen_random_uuid()::text, '-', '');

  insert into api_keys (company_id, name, prefix, key_hash, capabilities, created_by, expires_at)
  values (p_company_id, p_name, v_prefix,
          encode(sha256(convert_to(v_secret, 'UTF8')), 'hex'),
          v_caps, auth.uid(), p_expires_at)
  returning * into v_row;

  return query select v_row.id, v_secret, v_row.prefix, v_row.expires_at;
end;
$$;

comment on function create_api_key(uuid, text, jsonb, timestamptz) is
  'Issues a machine key on one company and returns the secret once. Only the hash is stored, and no capability can be put on a key that the person issuing it does not hold.';

-- ---------------------------------------------------------------------------
-- Recording that a key was used
--
-- Its own function because it is its own act: `use_api_key()` calls it, and a
-- caller that wants to record a use it made through another path can too.
-- Definer and unconditional — a key that is in use records it whether or not
-- the call it is about to make succeeds.
-- ---------------------------------------------------------------------------

create or replace function touch_api_key(p_api_key_id uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update api_keys set last_used_at = now() where id = p_api_key_id;
$$;

comment on function touch_api_key(uuid) is
  'Records that a key was used just now. A key that has never been used, and one that has not been used for a year, are both things an operator should be able to see.';

-- ---------------------------------------------------------------------------
-- Presenting one
-- ---------------------------------------------------------------------------

create or replace function use_api_key(p_secret text)
returns api_keys
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row api_keys%rowtype;
begin
  select * into v_row
    from api_keys
   where key_hash = encode(sha256(convert_to(coalesce(p_secret, ''), 'UTF8')), 'hex');

  if v_row.id is null then
    raise exception 'unknown_api_key: that is not a key of this installation'
      using errcode = '42501';
  end if;
  if v_row.revoked_at is not null then
    raise exception 'api_key_revoked: that key was withdrawn on %', v_row.revoked_at
      using errcode = '42501';
  end if;
  if v_row.expires_at is not null and v_row.expires_at <= now() then
    raise exception 'api_key_expired: that key expired on %', v_row.expires_at
      using errcode = '42501';
  end if;

  -- Transaction-local: the key is presented for the work at hand and not for
  -- the life of a connection somebody else may inherit from a pool.
  perform set_config('ekwo.api_key', v_row.key_hash, true);
  perform touch_api_key(v_row.id);

  return v_row;
end;
$$;

comment on function use_api_key(text) is
  'Presents a machine key for the current transaction: has_capability() answers for it until the transaction ends. Refuses a key that is unknown, withdrawn or expired.';

create or replace function current_api_key()
returns api_keys
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select k.* from api_keys k
   where k.key_hash = nullif(current_setting('ekwo.api_key', true), '')
     and k.revoked_at is null
     and (k.expires_at is null or k.expires_at > now());
$$;

comment on function current_api_key() is
  'The key presented in this transaction, or nothing. What a client reads back to know what it may do.';

create or replace function revoke_api_key(p_api_key_id uuid)
returns api_keys
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row api_keys%rowtype;
begin
  select * into v_row from api_keys where id = p_api_key_id;
  if v_row.id is null then
    raise exception 'unknown_api_key: no key with that id';
  end if;
  if auth.uid() is not null and not has_capability(v_row.company_id, 'members.manage') then
    raise exception 'not_allowed: withdrawing a key needs members.manage'
      using errcode = '42501';
  end if;

  update api_keys set revoked_at = coalesce(revoked_at, now())
   where id = p_api_key_id
  returning * into v_row;

  return v_row;
end;
$$;

comment on function revoke_api_key(uuid) is
  'Withdraws a key. There is no un-withdraw: a secret that has been out of the building is issued again, not brought back.';

-- ---------------------------------------------------------------------------
-- has_capability, which now answers for a key as well as for a user
--
-- The member answer first, because that is the common case and it is the one
-- a policy on a table of a company is written for. A key is consulted only
-- when there is no member answer, so presenting a key can never take away
-- what the signed-in person already had.
-- ---------------------------------------------------------------------------

create or replace function has_capability(p_company_id uuid, p_capability text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select case
              when p_capability = any (m.capabilities_revoked) then false
              when p_capability = any (m.capabilities_granted) then true
              else exists (
                select 1 from role_capabilities rc
                 where rc.role = m.role and rc.capability = p_capability
              )
            end
       from company_members m
      where m.company_id = p_company_id
        and m.user_id = auth.uid()),
    (select p_capability = any (k.capabilities)
       from api_keys k
      where k.key_hash = nullif(current_setting('ekwo.api_key', true), '')
        and k.company_id = p_company_id
        and k.revoked_at is null
        and (k.expires_at is null or k.expires_at > now())),
    false);
$$;

comment on function has_capability(uuid, text) is
  'Whether the current caller may do one named thing in one company — a signed-in member by their preset and their adjustments, or a machine key by its own list. Revoked beats granted, and a non-member holding no key holds nothing.';

-- ---------------------------------------------------------------------------
-- Row level security
--
-- Reading the keys of a company is administering its members, and nothing
-- writes the table through the API: the four functions above are the way in.
-- ---------------------------------------------------------------------------

alter table api_keys enable row level security;

create policy api_keys_select on api_keys
  for select using (
    has_capability(company_id, 'members.manage') or is_instance_admin()
  );

revoke execute on all functions in schema public from public;
