-- Ekwo OS — an append-only record of what was changed, by whom, and when.
--
-- Everything the ledger does is already immutable: an entry is posted once and
-- corrected by a reversal, never edited. What sat outside that guarantee is
-- everything *around* the ledger — the chart of accounts, the journals, the
-- taxes and the accounts they post to, the bank accounts, the contacts, the
-- products, the financial years, who is a member of a company and with which
-- role, which pack version the company holds. Those decide how every future
-- entry is booked, and until this migration nothing recorded that one of them
-- had moved. An auditor asking "who changed the VAT account on this tax, and
-- when" had no answer, and neither did the operator.
--
-- This is one table, one trigger function and a handful of triggers. It is
-- deliberately not `pgaudit`: that extension is unavailable under PGlite, so
-- none of this could be tested here, and its output goes to the Postgres log
-- — a file an application cannot query and a self-hosted operator often
-- cannot reach. An audit trail nobody can read is a promise, not a control.
--
-- Four decisions are worth stating.
--
-- **Append-only is enforced by a trigger, not only by row level security.**
-- Policies do not apply to the table owner, and on Supabase `service_role`
-- carries BYPASSRLS. A `before update or delete` trigger that raises holds for
-- everyone, owner included; the dated purge function lifts it for the duration
-- of its own transaction and for nothing else.
--
-- **`company_id` carries no foreign key.** The audit trail outlives the rows
-- it describes: a cascade from `companies` would delete the record of the
-- company's own deletion. It is indexed, and row level security reads it.
--
-- **The ledger is not audited.** `entries` and `entry_lines` are immutable
-- once posted and are corrected by a reversal, which is already a visible
-- act. What is recorded here is the *act* of posting, cancelling or reversing
-- — never the content of the entry, which the ledger itself holds.
--
-- **The installer's own bulk copy is not audited row by row.** Installing a
-- country pack copies a thousand accounts into a company; a thousand rows
-- saying "account created" carry no information the single `company_packs`
-- row does not. `is_installer()` is already the schema's name for the
-- migration runner, the seeds and `ekwo init`, so the trigger stands down for
-- it and for nothing else. A person, a machine key, or anyone connecting with
-- `psql` is audited.

-- ---------------------------------------------------------------------------
-- The table
-- ---------------------------------------------------------------------------

create type audit_operation as enum ('insert', 'update', 'delete');

comment on type audit_operation is
  'What happened to the row. The business act, when there is one, is named in audit_log.action.';

create table audit_log (
  id           bigint generated always as identity primary key,
  occurred_at  timestamptz not null default now(),
  -- Who. `auth.uid()` for a person; a machine key answers with its own id and
  -- no user, which is exactly the distinction an auditor needs.
  actor_id     uuid,
  api_key_id   uuid,
  -- Which company the change belongs to. Null for the reference data of the
  -- installation itself — the packs it holds, its administrators.
  company_id   uuid,
  -- What.
  table_name   text not null,
  record_id    uuid,
  record_key   text not null,
  operation    audit_operation not null,
  -- The business act, where the row change is one: `document_posted`,
  -- `fiscal_year_closed`, `pack_upgraded`. Null for an ordinary edit.
  action       text,
  old_values   jsonb,
  new_values   jsonb,
  constraint audit_log_has_a_subject check (length(table_name) > 0 and length(record_key) > 0)
);

comment on table audit_log is
  'Append-only record of every change to the configuration and reference data of a company, and of the acts that change the state of a document, a payment, a financial year or a pack. Written by trigger, never by a client; no update and no delete, for anyone.';
comment on column audit_log.actor_id is 'auth.uid() at the time of the change. Null when the change came from a machine key or from a direct connection.';
comment on column audit_log.api_key_id is 'The machine key presented in the transaction, when one was.';
comment on column audit_log.company_id is 'The company the change belongs to, and what row level security reads. No foreign key: the trail outlives the row it describes.';
comment on column audit_log.record_key is 'The natural key of the row — an account code, a country, a user id — so a deleted row is still identifiable.';
comment on column audit_log.action is 'The business act this change is, when it is one. Null for an ordinary edit.';
comment on column audit_log.old_values is 'The row before, as jsonb. Null on an insert. Secrets are replaced by null, never stored twice.';
comment on column audit_log.new_values is 'The row after, as jsonb. Null on a delete.';

create index audit_log_company_idx on audit_log (company_id, occurred_at desc);
create index audit_log_table_idx on audit_log (table_name, occurred_at desc);
create index audit_log_actor_idx on audit_log (actor_id, occurred_at desc);
create index audit_log_record_idx on audit_log (table_name, record_id);

-- ---------------------------------------------------------------------------
-- Append-only, for everyone
-- ---------------------------------------------------------------------------

create or replace function audit_log_is_append_only()
returns trigger
language plpgsql
as $$
begin
  if current_setting('ekwo.audit_purge', true) = 'on' and tg_op = 'DELETE' then
    return old;
  end if;
  raise exception 'audit_log_append_only: the audit trail is written once. % is refused; rows leave it only through purge_audit_log(date).', lower(tg_op);
end;
$$;

comment on function audit_log_is_append_only() is
  'Refuses every update and every delete on audit_log, table owner included. purge_audit_log() sets ekwo.audit_purge for its own transaction, which is the one exception.';

create trigger audit_log_append_only
  before update or delete on audit_log
  for each row execute function audit_log_is_append_only();

-- ---------------------------------------------------------------------------
-- Writing a row
--
-- One function, `security definer`, so the triggers insert regardless of the
-- policies of the table they hang on and regardless of the fact that
-- `audit_log` has no insert policy at all. Nothing else may call it: the
-- grants at the end of this file close it to everyone but the owner.
-- ---------------------------------------------------------------------------

create or replace function audit_record(
  p_company_id uuid,
  p_table      text,
  p_record_id  uuid,
  p_record_key text,
  p_operation  audit_operation,
  p_action     text default null,
  p_old        jsonb default null,
  p_new        jsonb default null
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id bigint;
begin
  insert into audit_log (actor_id, api_key_id, company_id, table_name, record_id,
                         record_key, operation, action, old_values, new_values)
  values (auth.uid(), (select id from current_api_key()), p_company_id, p_table,
          p_record_id, p_record_key, p_operation, p_action, p_old, p_new)
  returning id into v_id;
  return v_id;
end;
$$;

comment on function audit_record(uuid, text, uuid, text, audit_operation, text, jsonb, jsonb) is
  'Writes one row of the audit trail. Called by the triggers of this schema and by the functions that perform an act; never by a client.';

-- ---------------------------------------------------------------------------
-- The generic trigger
--
-- Configured by one jsonb argument rather than by a row of positional ones,
-- because a trigger declaration is read far more often than it is written:
--
--   company  the column holding the company, or absent for reference data of
--            the installation itself
--   key      the columns that make the natural key, joined by `/`
--   redact   columns whose value is replaced by null — a secret is stored
--            once, in the table that owns it, and never a second time here
--   action_insert / action_delete
--            the name of the act, where an insert or a delete *is* one
-- ---------------------------------------------------------------------------

create or replace function audit_changes()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_config  jsonb := coalesce(tg_argv[0], '{}')::jsonb;
  v_old     jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  v_new     jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  v_subject jsonb := coalesce(v_new, v_old);
  v_company uuid;
  v_column  text;
  v_key     text := '';
  v_action  text;
begin
  -- The installation setting itself up. See the head of this file.
  if is_installer() then
    return null;
  end if;

  -- `updated_at` is the clock, not a change: `occurred_at` on the audit row
  -- already says when. It is dropped from both sides so that an update which
  -- moved nothing else compares equal.
  v_old := v_old - 'updated_at';
  v_new := v_new - 'updated_at';

  -- An update that changed nothing is not a change. Re-applying an idempotent
  -- seed upserts every row of the reference data; without this, `ekwo migrate`
  -- would write a page of audit rows saying that nothing happened.
  if tg_op = 'UPDATE' and v_old = v_new then
    return null;
  end if;

  if v_config ? 'company' then
    v_company := nullif(v_subject ->> (v_config ->> 'company'), '')::uuid;
  end if;

  for v_column in select jsonb_array_elements_text(coalesce(v_config -> 'key', '["id"]'::jsonb)) loop
    v_key := case when v_key = '' then '' else v_key || '/' end
             || coalesce(v_subject ->> v_column, '');
  end loop;
  -- A draft carries no number yet, and a row identified by nothing is a row
  -- nobody can find again.
  if v_key = '' or v_key = '/' then
    v_key := coalesce(v_subject ->> 'id', '(unkeyed)');
  end if;

  for v_column in select jsonb_array_elements_text(coalesce(v_config -> 'redact', '[]'::jsonb)) loop
    if v_old is not null and v_old ? v_column then v_old := jsonb_set(v_old, array[v_column], 'null'::jsonb); end if;
    if v_new is not null and v_new ? v_column then v_new := jsonb_set(v_new, array[v_column], 'null'::jsonb); end if;
  end loop;

  v_action := case tg_op
                when 'INSERT' then v_config ->> 'action_insert'
                when 'DELETE' then v_config ->> 'action_delete'
                else null
              end;

  perform audit_record(
    v_company,
    tg_table_name,
    case when v_subject ? 'id' and (v_subject ->> 'id') ~ '^[0-9a-f]{8}-' then (v_subject ->> 'id')::uuid end,
    v_key,
    lower(tg_op)::audit_operation,
    v_action,
    v_old,
    v_new
  );
  return null;
end;
$$;

comment on function audit_changes() is
  'The generic audit trigger. One jsonb argument names the company column, the natural key, the columns to redact and the acts an insert or a delete stands for.';

-- ---------------------------------------------------------------------------
-- The state-change trigger
--
-- The act, not the content. A document that is posted, a payment that is
-- booked, a financial year that closes: what is recorded is the transition and
-- the few fields that identify the row, never the whole of it.
--
--   watch    the column whose change is the act
--   prefix   the act is `<prefix>_<new value>`: document_posted, payment_cancelled
--   true / false
--            for a boolean column, the name of each direction
--   fields   the columns copied into the payload beside the watched one
-- ---------------------------------------------------------------------------

create or replace function audit_state_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_config jsonb := coalesce(tg_argv[0], '{}')::jsonb;
  v_watch  text  := v_config ->> 'watch';
  v_old    jsonb := to_jsonb(old);
  v_new    jsonb := to_jsonb(new);
  v_before text  := v_old ->> v_watch;
  v_after  text  := v_new ->> v_watch;
  v_action text;
  v_column text;
  v_payload jsonb := '{}'::jsonb;
begin
  if v_before is not distinct from v_after then
    return null;
  end if;

  if v_config ? 'true' then
    v_action := case when v_after = 'true' then v_config ->> 'true' else v_config ->> 'false' end;
  else
    v_action := (v_config ->> 'prefix') || '_' || v_after;
  end if;

  for v_column in select jsonb_array_elements_text(coalesce(v_config -> 'fields', '[]'::jsonb)) loop
    v_payload := v_payload || jsonb_build_object(v_column, v_new -> v_column);
  end loop;

  perform audit_record(
    nullif(v_new ->> coalesce(v_config ->> 'company', 'company_id'), '')::uuid,
    tg_table_name,
    (v_new ->> 'id')::uuid,
    coalesce(nullif(v_new ->> coalesce(v_config ->> 'key', 'id'), ''), v_new ->> 'id', '(unkeyed)'),
    'update',
    v_action,
    jsonb_build_object(v_watch, v_before),
    v_payload || jsonb_build_object(v_watch, v_after)
  );
  return null;
end;
$$;

comment on function audit_state_change() is
  'Records the act a state column stands for — a document posted, a payment booked, a year closed — with the fields that identify the row and never the whole of it.';

-- ---------------------------------------------------------------------------
-- Posting an entry, and reversing one
--
-- `entries` gets its own function because the ledger has a second act the
-- others do not: a reversal is an entry that points at the one it undoes, and
-- calling that "posted" would lose the only word an auditor is looking for.
-- ---------------------------------------------------------------------------

create or replace function audit_entry_posting()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.state is not distinct from new.state then
    return null;
  end if;

  perform audit_record(
    new.company_id,
    'entries',
    new.id,
    coalesce(new.number, new.id::text),
    'update',
    case
      when new.state = 'posted' and new.reversed_entry_id is not null then 'entry_reversed'
      else 'entry_' || new.state::text
    end,
    jsonb_build_object('state', old.state),
    jsonb_build_object('state', new.state, 'number', new.number,
                       'entry_date', new.entry_date, 'kind', new.kind,
                       'reversed_entry_id', new.reversed_entry_id)
  );
  return null;
end;
$$;

comment on function audit_entry_posting() is
  'Records that an entry was posted, cancelled, or posted as the reversal of another. The lines themselves are not audited: a posted entry is immutable and is corrected by a reversal.';

-- ---------------------------------------------------------------------------
-- What is covered
--
-- Everything that decides how a future entry is booked, plus who may book it.
-- ---------------------------------------------------------------------------

create trigger accounts_audit after insert or update or delete on accounts
  for each row execute function audit_changes('{"company":"company_id","key":["code"]}');

create trigger journals_audit after insert or update or delete on journals
  for each row execute function audit_changes('{"company":"company_id","key":["code"]}');

create trigger taxes_audit after insert or update or delete on taxes
  for each row execute function audit_changes('{"company":"company_id","key":["code"]}');

create trigger tax_postings_audit after insert or update or delete on tax_postings
  for each row execute function audit_changes('{"company":"company_id","key":["id"]}');

create trigger bank_accounts_audit after insert or update or delete on bank_accounts
  for each row execute function audit_changes('{"company":"company_id","key":["id"]}');

create trigger contacts_audit after insert or update or delete on contacts
  for each row execute function audit_changes('{"company":"company_id","key":["id"]}');

create trigger products_audit after insert or update or delete on products
  for each row execute function audit_changes('{"company":"company_id","key":["code"]}');

create trigger companies_audit after insert or update or delete on companies
  for each row execute function audit_changes('{"company":"id","key":["id"]}');

create trigger fiscal_years_audit after insert or delete on fiscal_years
  for each row execute function audit_changes('{"company":"company_id","key":["name"]}');

create trigger company_members_audit after insert or update or delete on company_members
  for each row execute function audit_changes('{"company":"company_id","key":["user_id"]}');

create trigger company_packs_audit after insert or update or delete on company_packs
  for each row execute function audit_changes('{"company":"company_id","key":["country"]}');

-- The two tables that hold a secret. Only its hash is stored there, and not
-- even that is copied here: a hash is a credential that can be attacked
-- offline, and the audit trail is read by more people than the table is.
create trigger api_keys_audit after insert or update or delete on api_keys
  for each row execute function audit_changes('{"company":"company_id","key":["prefix"],"redact":["key_hash"]}');

create trigger company_invitations_audit after insert or update or delete on company_invitations
  for each row execute function audit_changes('{"company":"company_id","key":["email"],"redact":["token_hash"]}');

-- Reference data of the installation: no company, so only an instance
-- administrator reads these rows back.
create trigger instance_admins_audit after insert or update or delete on instance_admins
  for each row execute function audit_changes('{"key":["user_id"]}');

create trigger country_packs_audit after insert or update or delete on country_packs
  for each row execute function audit_changes('{"key":["country"]}');

create trigger country_defaults_audit after insert or update or delete on country_defaults
  for each row execute function audit_changes('{"key":["country"]}');

-- ---------------------------------------------------------------------------
-- The acts
-- ---------------------------------------------------------------------------

create trigger documents_audit_state after update on documents
  for each row execute function audit_state_change(
    '{"watch":"state","prefix":"document","key":"number","fields":["doc_type","document_date","amount_total","entry_id","contact_id"]}');

create trigger payments_audit_state after update on payments
  for each row execute function audit_state_change(
    '{"watch":"state","prefix":"payment","fields":["payment_date","amount","entry_id","contact_id"]}');

create trigger fiscal_years_audit_close after update on fiscal_years
  for each row execute function audit_state_change(
    '{"watch":"is_closed","true":"fiscal_year_closed","false":"fiscal_year_reopened","key":"name","fields":["start_date","end_date"]}');

create trigger entries_audit_posting after update on entries
  for each row execute function audit_entry_posting();

-- Matching and unmatching a payment: an insert and a delete that are each an
-- act, so the generic trigger names them.
create trigger reconciliations_audit after insert or delete on reconciliations
  for each row execute function audit_changes(
    '{"company":"company_id","key":["id"],"action_insert":"payment_reconciled","action_delete":"payment_unreconciled"}');

-- ---------------------------------------------------------------------------
-- The purge
--
-- A retention policy is a legal decision, not a default: nothing in this
-- schema deletes an audit row on its own. `purge_audit_log` takes the cutoff
-- it is asked for, deletes what is strictly older, and is reachable only by
-- `service_role` — the operator of the installation, never a signed-in user
-- and never a machine key.
-- ---------------------------------------------------------------------------

create or replace function purge_audit_log(p_before date)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deleted bigint;
begin
  if p_before is null then
    raise exception 'audit_purge_needs_a_date: name the date before which rows are dropped. There is no default retention.';
  end if;
  if p_before > current_date then
    raise exception 'audit_purge_in_the_future: % is not in the past, so this would empty the trail.', p_before;
  end if;

  perform set_config('ekwo.audit_purge', 'on', true);
  delete from audit_log where occurred_at < p_before::timestamptz;
  get diagnostics v_deleted = row_count;
  perform set_config('ekwo.audit_purge', '', true);

  perform audit_record(null, 'audit_log', null, p_before::text, 'delete', 'audit_log_purged',
                       null, jsonb_build_object('before', p_before, 'rows', v_deleted));
  return v_deleted;
end;
$$;

comment on function purge_audit_log(date) is
  'Drops audit rows older than a date the caller names, and records that it did. service_role only: retention is the operator''s decision and no signed-in user may make it.';

-- ---------------------------------------------------------------------------
-- Row level security
--
-- Select only, and there is no other policy on purpose: the trail is written
-- by `security definer` triggers that run as the owner, so a client has no
-- reason to hold an insert policy and every reason not to.
-- ---------------------------------------------------------------------------

alter table audit_log enable row level security;

create policy audit_log_select on audit_log
  for select using (
    case when company_id is null then is_instance_admin()
         else is_company_member(company_id) or is_instance_admin()
    end
  );

comment on policy audit_log_select on audit_log is
  'Members of the company read its trail; an instance administrator reads that and the rows of the installation itself. Nobody writes, updates or deletes: there is no policy for it, and a trigger refuses it to the owner too.';

-- ---------------------------------------------------------------------------
-- Grants
--
-- The rule of `supabase/migrations/README.md`: a migration that adds a
-- function closes the schema behind it, from PUBLIC and never from `anon`.
-- Then the two functions that are not the triggers' own get their audience.
-- ---------------------------------------------------------------------------

revoke execute on all functions in schema public from public;

revoke execute on function audit_record(uuid, text, uuid, text, audit_operation, text, jsonb, jsonb)
  from public, anon, authenticated;
revoke execute on function audit_changes() from public, anon, authenticated;
revoke execute on function audit_state_change() from public, anon, authenticated;
revoke execute on function audit_entry_posting() from public, anon, authenticated;
revoke execute on function audit_log_is_append_only() from public, anon, authenticated;

revoke execute on function purge_audit_log(date) from public, anon, authenticated;
grant execute on function purge_audit_log(date) to service_role;
