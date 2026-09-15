-- Ekwo OS — the schema this release defines is 0.3.0.
--
-- `ekwo_schema_version()` is the one place the number lives, and a migration
-- is the only thing that moves it. A database then answers for the files it
-- has actually run rather than for what somebody believed it had run: the
-- column default and `init_instance()` both call this function, so a fresh
-- install records the new number without a second edit, and `ekwo migrate`
-- reads it back onto `instance.schema_version` for a database that was
-- installed at an older one.
--
-- Between 0.2.0 and here the schema gained what a company works on rather
-- than what a country prescribes, and a second reader of the books beside
-- the return. The packages of this release read all of it, and a 0.2.0
-- database has none of it: `document_shares` with `share_document()`,
-- `revoke_share()` and `shared_document()`, and `instance.public_base_url`
-- the returned link is built on; `ec_sales_list()`, the recapitulative
-- statement of intra-Community supplies; `country_packs.sources` with
-- `tax_templates.source_key` and `tax_report_box_templates.source_key`, the
-- register a pack cites its law from; `accounts.pinned` and
-- `accounts_in_use()`, the part of a chart a company actually works with;
-- `companies.vat_period` beside `tax_report_templates.periods` and
-- `country_defaults.vat_period_default`, how often a return is filed; and the
-- `foreign_services_received` value of `tax_treatment`, the general
-- business-to-business rule for a service bought from a supplier who is not
-- established here. So the packages declare 0.3.0 as their floor and refuse
-- an older database by name, rather than improvising over a column that is
-- not there.

create or replace function ekwo_schema_version()
returns text
language sql
immutable
as $$
  select '0.3.0'::text;
$$;

comment on function ekwo_schema_version() is
  'Schema version of the installed release. Bumped by a migration, never by hand.';

-- `create or replace` keeps the privileges the function already had, and the
-- revoke is what every migration of this directory ends with: a function that
-- comes out with the built-in default is published by Supabase as an
-- anonymous RPC endpoint.
revoke execute on all functions in schema public from public;
grant execute on function ekwo_schema_version() to authenticated, service_role;
