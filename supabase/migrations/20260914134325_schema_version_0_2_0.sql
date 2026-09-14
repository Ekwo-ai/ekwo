-- Ekwo OS — the schema this release defines is 0.2.0.
--
-- `ekwo_schema_version()` is the one place the number lives, and a migration
-- is the only thing that moves it. A database then answers for the files it
-- has actually run rather than for what somebody believed it had run: the
-- column default and `init_instance()` both call this function, so a fresh
-- install records the new number without a second edit, and `ekwo migrate`
-- reads it back onto `instance.schema_version` for a database that was
-- installed at an older one.
--
-- 0.1.0 was the first schema of this repository and was never tagged. Between
-- it and here came the installer, the MCP server, country packs, capabilities
-- and machine keys, modules, the audit trail, the generalised tax engine,
-- financial statements, languages and currency-aware rounding. The packages
-- of this release read `audit_log`, the rounding functions and `company_packs`
-- — none of which a 0.1.0 database has — so they declare 0.2.0 as their floor
-- and refuse an older database by name, rather than improvising over a column
-- that is not there.

create or replace function ekwo_schema_version()
returns text
language sql
immutable
as $$
  select '0.2.0'::text;
$$;

comment on function ekwo_schema_version() is
  'Schema version of the installed release. Bumped by a migration, never by hand.';

-- `create or replace` keeps the privileges the function already had, and the
-- revoke is what every migration of this directory ends with: a function that
-- comes out with the built-in default is published by Supabase as an
-- anonymous RPC endpoint.
revoke execute on all functions in schema public from public;
grant execute on function ekwo_schema_version() to authenticated, service_role;
