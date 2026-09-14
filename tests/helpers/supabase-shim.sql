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

-- Usage on `auth`, which is Supabase's schema and not Ekwo's to grant. Its
-- helpers are what every policy of the schema calls.
grant usage on schema auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;

-- And that is all this shim gives.
--
-- It used to end with the default privileges a Supabase project carries on
-- `public` — `grant all on tables`, `on sequences`, `on functions`, to the
-- three API roles — so that every table the migrations created came out
-- readable and writable without a single `grant` in the migrations
-- themselves. That made the whole suite pass against privileges no
-- installation was guaranteed to have: drop and recreate `public` on a real
-- project and the first read answers "permission denied for table companies",
-- which is what the end-to-end run of 14 September 2026 found.
--
-- Since `20260914151207` the schema grants its own rights, by name, so the
-- shim stops providing them. What the roles can reach in these tests is now
-- exactly what a migration granted them, and `tests/grants.test.ts` replays
-- the whole thing on a database where the roles start with nothing at all.
