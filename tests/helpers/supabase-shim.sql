-- Test-only shim. Supabase provides the `auth` schema; a bare Postgres (or
-- PGlite) does not, and the migrations reference auth.uid() from their row
-- level security policies. This file is applied BEFORE the migrations in the
-- test harness and is never shipped.

create schema if not exists auth;

-- Supabase's own user table, reduced to what the schema references. On a real
-- project GoTrue owns the full table; here we only need `id` to exist so the
-- foreign key from instance_admins resolves.
create table if not exists auth.users (
  id    uuid primary key,
  email text
);

create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), ''),
    '{}'
  )::jsonb;
$$;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid;
$$;

-- GoTrue always puts the address in the JWT, so `auth.email()` reads the claim
-- on a real project. Here it falls back to the row, so a test does not have to
-- mint a token to be recognised by the address it signed up with.
create or replace function auth.email()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(auth.jwt() ->> 'email', ''),
    (select u.email from auth.users u where u.id = auth.uid())
  );
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(auth.jwt() ->> 'role', current_setting('role', true));
$$;

-- Supabase's API roles, so `set role authenticated` works in the RLS tests.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;

alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public
  grant select on tables to anon;
alter default privileges in schema public
  grant execute on functions to anon, authenticated, service_role;
alter default privileges in schema public
  grant usage, select on sequences to anon, authenticated, service_role;
