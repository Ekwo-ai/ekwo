-- Ekwo OS — the schema grants its own rights.
--
-- Until this file, nothing in `supabase/migrations` gave `anon` or
-- `authenticated` a single privilege on a single table. The schema worked
-- anyway, because a Supabase project carries default privileges on `public`
-- that hand `all` on every new table, sequence and function to `anon`,
-- `authenticated` and `service_role`. Row level security then decided who saw
-- what, and the arrangement looked sound.
--
-- Two things were wrong with it.
--
-- The first is a hole. Those defaults give `anon` — the role behind the
-- publishable key that any visitor holds — INSERT, UPDATE and DELETE on every
-- table of the ledger. Only row level security stands between an anonymous
-- request and the books. That is one layer where the doctrine of this project
-- says there are two: `anon` reaches the eight policy helpers and nothing
-- else (`20260911210131`), and "nothing else" has to include the tables.
--
-- The second is a dependency nobody declared. The first real end-to-end run,
-- on 14 September 2026, dropped and recreated `public` on a throwaway
-- project. The migrations replayed, `ekwo doctor` reported a healthy
-- installation, and the first read through PostgREST answered "permission
-- denied for table companies" — because the default privileges live in
-- `pg_default_acl`, keyed by the schema, and had gone with it. An
-- installation whose access rights come from something the installer never
-- wrote is an installation that cannot be reproduced.
--
-- So the privileges are declared here, by name, table by table and view by
-- view. `grant all on all tables` is not used anywhere: a wildcard is how a
-- table added next year silently becomes writable by a role nobody thought
-- about. From this migration on, a migration that creates a table, a view or
-- a function grants it in the same file, beside the `revoke execute ... from
-- public` that is already compulsory. `tests/grants.test.ts` compares the
-- catalogue to the inventory generated from the migrations and fails when the
-- two disagree, and `ekwo doctor` asks the same question of a live database.
--
-- What is deliberately *not* decided here: which companies a role may see.
-- That is row level security, and every policy of this schema is unchanged.
-- A grant says which verbs a role may attempt; a policy says on which rows
-- they succeed. This file is only the first half, and it is the half that was
-- being borrowed.

-- ---------------------------------------------------------------------------
-- 1. The schema itself
--
-- A Supabase project already grants this. Saying it again costs nothing and
-- is what makes a bare Postgres — the reset above, a self-hosted instance, the
-- test harness — reach the same state from the migrations alone.
-- ---------------------------------------------------------------------------

grant usage on schema public to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Everything the project's defaults handed out goes back
--
-- `revoke all on all tables` is the safe direction of a wildcard: it can only
-- close. It takes back the blanket privileges an existing installation
-- received at creation, including the write access `anon` was never meant to
-- have, and the grants below then re-open exactly what is needed.
--
-- The `alter default privileges` lines stop the same thing happening to the
-- next table. They are scoped to the role running the migration, which on a
-- Supabase project is `postgres` — the role that owns the entries. A default
-- privilege set by another role is not reachable from here and would show up
-- as an extra grant on the first table created after it, which is what the
-- invariant test and the doctor are for.
--
-- The function line closes Ekwo's own backstop, not Supabase's:
-- `20260911210131` granted EXECUTE on future functions to `authenticated` and
-- `service_role` by default privilege, and that is the same hidden mechanism
-- one level down. Functions created before today keep the grants they were
-- given — a privilege already in `proacl` is not touched by a change of
-- default — so nothing that works stops working. A function created after
-- today is granted in its own migration or it is reachable by nobody.
--
-- The `revoke execute on functions from public, anon` default of that same
-- migration stays exactly as it is. It closes rather than opens, and it is
-- the reason a new function is not published as an anonymous RPC endpoint.
-- ---------------------------------------------------------------------------

revoke all on all tables    in schema public from anon, authenticated, service_role;
revoke all on all sequences in schema public from anon, authenticated, service_role;

alter default privileges in schema public revoke all on tables    from anon, authenticated, service_role;
alter default privileges in schema public revoke all on sequences from anon, authenticated, service_role;
alter default privileges in schema public revoke execute on functions from authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. The tables a signed-in user writes
--
-- These twenty-six are the ones whose policies allow more than reading: each
-- carries a policy `for all` — or, for `companies`, `company_members` and
-- `instance_admins`, one policy per command — so the four verbs are the ones
-- row level security is already prepared to judge. The grant and the policy
-- say the same thing about the same table, which is the property the
-- invariant test checks.
--
-- DELETE is granted on `entries`, `entry_lines`, `documents`,
-- `document_lines`, `payments` and `reconciliations` on purpose. Deleting a
-- *draft* is an ordinary act of bookkeeping; deleting a posted entry is
-- refused by `entries_guard_period` and by the period lock, not by a missing
-- privilege. Taking DELETE away here would break the draft and leave the
-- posted entry exactly as protected as it already is.
--
-- `service_role` gets the same set. It is the backend key: it bypasses row
-- level security, so its table rights are the only limit it has, and there is
-- no reason for that limit to be wider than a person's.
-- ---------------------------------------------------------------------------

grant select, insert, update, delete on table
  accounts,
  analytic_axes,
  analytic_values,
  attachments,
  bank_accounts,
  bank_statements,
  bank_transactions,
  companies,
  company_members,
  company_packs,
  contacts,
  document_lines,
  documents,
  entries,
  entry_line_analytics,
  entry_lines,
  fiscal_years,
  instance,
  instance_admins,
  journals,
  payments,
  products,
  reconciliations,
  tax_postings,
  taxes,
  user_preferences
to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. The reference tables, which a client reads and an installation writes
--
-- Eighteen tables a country pack and a release fill: the chart templates, the
-- taxes and their postings, the declaration boxes, the statement schemes, the
-- currencies and their rates, the capabilities and the modules this release
-- carries. Their policies allow SELECT and nothing else, and the writer is
-- `ekwo migrate` on the owner's connection or `install_country_template()`
-- running as definer. No INSERT, no UPDATE, no DELETE: a client that could
-- edit the chart of accounts of a country could edit it for every company of
-- the installation at once.
-- ---------------------------------------------------------------------------

grant select on table
  account_templates,
  capabilities,
  chart_templates,
  country_defaults,
  country_packs,
  currencies,
  currency_rates,
  journal_templates,
  legal_mention_templates,
  modules,
  role_capabilities,
  statement_line_rules,
  statement_line_templates,
  statement_templates,
  tax_posting_templates,
  tax_report_box_templates,
  tax_report_templates,
  tax_templates
to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. The tables only a function writes
--
-- Five tables whose rows exist because a `security definer` function made
-- them, and which no client may write directly. `api_keys` holds a sha256 and
-- is issued by `create_api_key()`; `company_invitations` by `invite_member()`
-- and consumed by `accept_invitation()`; `company_modules` by
-- `enable_module()`; and the two counters are advanced by
-- `next_entry_number()` and `next_matching_number()`, which is the whole
-- reason those two became definer in `20260911173100`. A client with UPDATE
-- on `journal_sequences` could rewind the numbering of a journal, which in
-- several countries is the offence the numbering rule exists to prevent.
-- ---------------------------------------------------------------------------

grant select on table
  api_keys,
  company_invitations,
  company_modules,
  journal_sequences,
  matching_sequences
to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. The audit trail: SELECT, and nothing else, for anyone
--
-- `audit_log` is append-only by trigger for every role including its owner,
-- and its only policy is a SELECT. UPDATE and DELETE are therefore refused
-- twice over, which is the point: the trigger is the guarantee and the
-- missing privilege is the statement of intent. INSERT is not granted either
-- — the rows are written by `audit_record()`, a definer function the triggers
-- call, and a client that could insert its own could write a history that
-- never happened.
-- ---------------------------------------------------------------------------

grant select on table audit_log to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. The views
--
-- All four are `security_invoker`, so a reader needs SELECT on the view *and*
-- on the tables under it, and row level security is judged on the reader
-- rather than on the owner. The grants above give the second half; this gives
-- the first.
-- ---------------------------------------------------------------------------

grant select on table
  document_header,
  document_legal_mentions,
  document_line_items,
  document_tax_summary
to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. Sequences: none, and on purpose
--
-- The schema has one, `audit_log_id_seq`, and it belongs to an identity
-- column of a table nobody but a definer function inserts into. An identity
-- column takes its next value without asking for USAGE on the sequence, so
-- there is nothing to grant and nothing that breaks by not granting it. A
-- migration that adds a `serial` or an identity column to a table a client
-- inserts into will need `grant usage on sequence …` in its own file.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 9. Functions: the trigger bodies stop being callable
--
-- The eighty-two functions a client may call already hold nominative grants,
-- given by the migration that created each of them. What was left over is the
-- twenty-nine whose return type is `trigger`. A trigger function is invoked
-- by the table it is attached to, not by a caller: PostgreSQL checks EXECUTE
-- when the trigger is *created*, never when it fires, so revoking it changes
-- nothing about the schema's behaviour and removes twenty-nine RPC endpoints
-- that answer "trigger functions can only be called as triggers" to anyone who
-- finds them. Four of them were already closed to `anon` and `authenticated`
-- by `20260914103412`; this completes the set and adds `service_role`.
-- ---------------------------------------------------------------------------

revoke execute on function
  assert_may_close_year(),
  assert_may_post_document(),
  assert_may_post_entry(),
  audit_changes(),
  audit_entry_posting(),
  audit_log_is_append_only(),
  audit_state_change(),
  bank_statements_recompute(),
  bank_statements_refresh_balance(),
  companies_default_bank_account_is_ours(),
  companies_default_capital_currency(),
  company_members_capabilities_known(),
  currency_of_bank_account(),
  currency_of_company(),
  document_lines_amount_untaxed(),
  document_lines_refresh_totals(),
  document_lines_resolve_account(),
  documents_default_payee_iban(),
  documents_refresh_payment_state(),
  entries_guard_kind(),
  entries_guard_module(),
  entries_guard_period(),
  entries_refresh_totals(),
  entry_lines_guard_period(),
  fiscal_years_guard_closed(),
  fiscal_years_no_overlap(),
  locale_of_country_pack(),
  reconciliations_refresh_lines(),
  set_updated_at()
from public, anon, authenticated, service_role;

-- The rule of `supabase/migrations/README.md`, which this file obeys like any
-- other even though it creates no function.
revoke execute on all functions in schema public from public;
