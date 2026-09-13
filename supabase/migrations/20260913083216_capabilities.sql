-- Ekwo OS — a role is a preset, a capability is what a policy tests.
--
-- `company_members.role` carried three values and every policy in the schema
-- read one of them, through `is_company_member`, `can_write_company` and
-- `is_company_owner`. That is a permission model with three positions: a
-- bookkeeper who may post invoices and must never move a period lock has no
-- row to sit on, and the answer in every product that meets the case is a
-- fourth role, then a fifth.
--
-- So the role stays, as a **preset**, and what a policy tests becomes a
-- **capability**: a code from a fixed vocabulary, seeded by this migration,
-- that names one thing a person may do. `role_capabilities` says what each
-- preset holds. `company_members.capabilities_granted` and
-- `capabilities_revoked` adjust one member on top of their preset, in both
-- directions, and a revoke wins over a grant — including on an owner, because
-- a company that wants its owner unable to close a year is describing its own
-- separation of duties and not a mistake.
--
-- **One source of truth.** Every policy that read a role now calls
-- `has_capability()`, and the three published helpers are rewritten on top of
-- it rather than left beside it: `can_write_company()` is the answer to
-- `entries.write` and nothing else. A role is never tested by a policy again.
--
-- **What this migration does not do.** It does not consider an instance
-- administrator. Administering an installation is not being on the books of a
-- company — `docs/decisions.md` says so and a test asserts it — so the
-- policies that already admit an administrator keep saying it themselves,
-- beside the capability, and `has_capability()` answers about membership only.
--
-- **The door left open.** A module adds its own codes to `capabilities` with
-- `area` set to the module's code, and its own rows to `role_capabilities`.
-- Nothing here enumerates the areas, and nothing refuses a code it has not
-- seen.

-- ---------------------------------------------------------------------------
-- The vocabulary
-- ---------------------------------------------------------------------------

create table capabilities (
  code        text primary key,
  area        text not null,
  description text not null,
  constraint capabilities_code_shape check (code ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$')
);

comment on table capabilities is
  'Everything a member may be allowed to do, one row per code. Seeded by this migration for the core; a module adds its own with `area` set to the module code.';
comment on column capabilities.area is
  'What the code belongs to — a table family of the core, or the code of a module.';

-- Twenty codes, and every one of them is read by a policy or by a guard in
-- this file. Two that an earlier sketch carried are deliberately absent.
-- `reports.read` would have guarded `trial_balance()` and the statements,
-- which sum ledger lines row level security has already filtered: a member
-- without `entries.read` gets an empty report today, and a second lock on the
-- same door is a lock nobody turns. `exports.run` is the same argument about
-- the FEC. Neither is a capability until something can genuinely refuse on
-- it.
insert into capabilities (code, area, description) values
  ('documents.read',  'documents', 'Read invoices, credit notes, quotes and their lines.'),
  ('documents.write', 'documents', 'Create and change draft documents, their lines and their attachments.'),
  ('documents.post',  'documents', 'Book a document to the ledger. Cannot be undone.'),
  ('entries.read',    'entries',   'Read the ledger: entries, lines, matchings and the counters behind the numbering.'),
  ('entries.write',   'entries',   'Create and change draft entries and their lines.'),
  ('entries.post',    'entries',   'Post an entry, which draws its number. Cannot be undone.'),
  ('payments.read',   'payments',  'Read payments in and out.'),
  ('payments.write',  'payments',  'Record a payment and book it.'),
  ('reconcile.write', 'reconcile', 'Match a debit against a credit, and undo a matching.'),
  ('bank.read',       'bank',      'Read bank accounts, statements and statement lines.'),
  ('bank.write',      'bank',      'Add bank accounts and statement lines.'),
  ('contacts.read',   'contacts',  'Read customers, suppliers and other third parties.'),
  ('contacts.write',  'contacts',  'Create and change contacts.'),
  ('products.read',   'products',  'Read the catalogue.'),
  ('products.write',  'products',  'Create, change and retire catalogue items.'),
  ('settings.read',   'settings',  'Read the chart of accounts, the journals, the taxes, the analytic plan and the financial years.'),
  ('settings.write',  'settings',  'Change the chart of accounts, the journals, the taxes, the analytic plan and the financial years.'),
  ('company.write',   'company',   'Change the company itself: its profile, its default accounts and its period locks.'),
  ('members.manage',  'members',   'Invite, change and remove members, and issue machine access keys.'),
  ('year_end.close',  'year_end',  'Close and re-open a financial year.');

-- ---------------------------------------------------------------------------
-- The presets
--
-- The three roles keep exactly what they could do the day before this
-- migration, expressed in the new vocabulary: a viewer reads, an accountant
-- keeps the books, an owner also administers the company and its members.
--
-- There is no fourth role. `admin` was considered and left out: the existing
-- helpers drew one line — write the books, or administer the company — and
-- `owner` is already the second half of it, so a role between them would have
-- been a name with no work to do. A member who needs exactly that is an
-- accountant with `members.manage` granted, which is what the grant column is
-- for.
-- ---------------------------------------------------------------------------

create table role_capabilities (
  role       member_role not null,
  capability text not null references capabilities(code) on delete cascade,
  primary key (role, capability)
);

comment on table role_capabilities is
  'What each preset holds. A role is never tested by a policy; it is resolved here into capabilities.';

insert into role_capabilities (role, capability)
select 'viewer'::member_role, code from capabilities where code like '%.read';

insert into role_capabilities (role, capability)
select 'accountant'::member_role, code
  from capabilities
 where code like '%.read'
    or code in ('documents.write', 'documents.post', 'entries.write', 'entries.post',
                'payments.write', 'reconcile.write', 'bank.write', 'contacts.write',
                'products.write', 'settings.write', 'year_end.close');

insert into role_capabilities (role, capability)
select 'owner'::member_role, code from capabilities;

-- ---------------------------------------------------------------------------
-- The adjustments, per member
-- ---------------------------------------------------------------------------

alter table company_members
  add column if not exists capabilities_granted text[] not null default '{}',
  add column if not exists capabilities_revoked text[] not null default '{}';

comment on column company_members.capabilities_granted is
  'Capabilities this member holds beyond their preset.';
comment on column company_members.capabilities_revoked is
  'Capabilities this member does not hold whatever their preset says. A revoke wins over a grant and over a role.';

-- A code that is not in `capabilities` is a typo, and a typo in a permission
-- column is a permission nobody notices is missing. A foreign key cannot
-- reach inside an array, so this is a trigger — and it reads the table, so a
-- module's codes are accepted the moment the module's migration adds them.
create or replace function company_members_capabilities_known()
returns trigger
language plpgsql
as $$
declare
  v_unknown text;
begin
  select c into v_unknown
    from unnest(new.capabilities_granted || new.capabilities_revoked) as c
   where c not in (select code from capabilities)
   limit 1;

  if v_unknown is not null then
    raise exception 'unknown_capability: % is not a capability of this installation', v_unknown
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger company_members_capabilities_known
  before insert or update of capabilities_granted, capabilities_revoked on company_members
  for each row execute function company_members_capabilities_known();

-- ---------------------------------------------------------------------------
-- The one question every policy asks
--
-- SECURITY DEFINER for the reason `company_role()` is: the policy on
-- `company_members` must not recurse into the table it protects. It answers
-- about `auth.uid()` and about membership only — an instance administrator is
-- not a member, and the policies that admit one say so themselves.
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
    false);
$$;

comment on function has_capability(uuid, text) is
  'Whether the current user may do one named thing in one company. Revoked beats granted, granted beats the preset, and a non-member holds nothing.';

-- What a member may do, for an interface that has to draw it — and, when the
-- caller may manage members, what somebody else may do.
create or replace function member_capabilities(p_company_id uuid, p_user_id uuid default null)
returns setof text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := coalesce(p_user_id, auth.uid());
begin
  if v_user is distinct from auth.uid() and not has_capability(p_company_id, 'members.manage') then
    raise exception 'not_allowed: reading what another member may do needs members.manage'
      using errcode = '42501';
  end if;

  return query
    select c.code
      from capabilities c
      join company_members m
        on m.company_id = p_company_id and m.user_id = v_user
     where not (c.code = any (m.capabilities_revoked))
       and (c.code = any (m.capabilities_granted)
            or exists (select 1 from role_capabilities rc
                        where rc.role = m.role and rc.capability = c.code))
     order by c.code;
end;
$$;

comment on function member_capabilities(uuid, uuid) is
  'The capabilities one member effectively holds on one company, preset and adjustments resolved. Reading another member''s needs members.manage.';

-- ---------------------------------------------------------------------------
-- The published helpers, rewritten on top of the one question
--
-- They keep their names and their meaning, and they stop being a second place
-- where a permission is decided. `is_company_member` stays a membership test:
-- belonging to a company is not a capability, it is what makes capabilities
-- possible. `is_company_owner` stays the literal role, for a caller that wants
-- to know which preset somebody is on — no policy tests it any more.
-- ---------------------------------------------------------------------------

create or replace function can_write_company(p_company_id uuid)
returns boolean
language sql
stable
as $$
  select has_capability(p_company_id, 'entries.write');
$$;

comment on function can_write_company(uuid) is
  'Whether the current user may write the books of a company. Kept for callers that have it; it is now one capability and not a role.';

-- ---------------------------------------------------------------------------
-- Every policy that tested a role now tests a capability
-- ---------------------------------------------------------------------------

-- The company itself, its members and its financial years.
drop policy companies_update on companies;
create policy companies_update on companies
  for update using (has_capability(id, 'company.write') or is_instance_admin())
  with check (has_capability(id, 'company.write') or is_instance_admin());

drop policy companies_delete on companies;
create policy companies_delete on companies
  for delete using (has_capability(id, 'company.write'));

drop policy company_members_insert on company_members;
create policy company_members_insert on company_members
  for insert with check (
    has_capability(company_id, 'members.manage')
    or is_instance_admin()
    or company_has_no_member(company_id)
  );

drop policy company_members_update on company_members;
create policy company_members_update on company_members
  for update using (has_capability(company_id, 'members.manage'))
  with check (has_capability(company_id, 'members.manage'));

drop policy company_members_delete on company_members;
create policy company_members_delete on company_members
  for delete using (has_capability(company_id, 'members.manage'));

drop policy fiscal_years_select on fiscal_years;
create policy fiscal_years_select on fiscal_years
  for select using (has_capability(company_id, 'settings.read'));
drop policy fiscal_years_write on fiscal_years;
create policy fiscal_years_write on fiscal_years
  for all using (has_capability(company_id, 'settings.write'))
  with check (has_capability(company_id, 'settings.write'));

-- The chart, the journals, the taxes, the analytic plan and what the company
-- copied from a pack: one family, `settings`.
drop policy accounts_select on accounts;
create policy accounts_select on accounts
  for select using (has_capability(company_id, 'settings.read'));
drop policy accounts_write on accounts;
create policy accounts_write on accounts
  for all using (has_capability(company_id, 'settings.write'))
  with check (has_capability(company_id, 'settings.write'));

drop policy journals_select on journals;
create policy journals_select on journals
  for select using (has_capability(company_id, 'settings.read'));
drop policy journals_write on journals;
create policy journals_write on journals
  for all using (has_capability(company_id, 'settings.write'))
  with check (has_capability(company_id, 'settings.write'));

drop policy taxes_select on taxes;
create policy taxes_select on taxes
  for select using (has_capability(company_id, 'settings.read'));
drop policy taxes_write on taxes;
create policy taxes_write on taxes
  for all using (has_capability(company_id, 'settings.write'))
  with check (has_capability(company_id, 'settings.write'));

drop policy tax_postings_select on tax_postings;
create policy tax_postings_select on tax_postings
  for select using (has_capability(company_id, 'settings.read'));
drop policy tax_postings_write on tax_postings;
create policy tax_postings_write on tax_postings
  for all using (has_capability(company_id, 'settings.write'))
  with check (has_capability(company_id, 'settings.write'));

drop policy analytic_axes_select on analytic_axes;
create policy analytic_axes_select on analytic_axes
  for select using (has_capability(company_id, 'settings.read'));
drop policy analytic_axes_write on analytic_axes;
create policy analytic_axes_write on analytic_axes
  for all using (has_capability(company_id, 'settings.write'))
  with check (has_capability(company_id, 'settings.write'));

drop policy analytic_values_select on analytic_values;
create policy analytic_values_select on analytic_values
  for select using (has_capability(company_id, 'settings.read'));
drop policy analytic_values_write on analytic_values;
create policy analytic_values_write on analytic_values
  for all using (has_capability(company_id, 'settings.write'))
  with check (has_capability(company_id, 'settings.write'));

drop policy company_packs_select on company_packs;
create policy company_packs_select on company_packs
  for select using (has_capability(company_id, 'settings.read'));
drop policy company_packs_write on company_packs;
create policy company_packs_write on company_packs
  for all using (has_capability(company_id, 'settings.write'))
  with check (has_capability(company_id, 'settings.write'));

-- Contacts and the catalogue.
drop policy contacts_select on contacts;
create policy contacts_select on contacts
  for select using (has_capability(company_id, 'contacts.read'));
drop policy contacts_write on contacts;
create policy contacts_write on contacts
  for all using (has_capability(company_id, 'contacts.write'))
  with check (has_capability(company_id, 'contacts.write'));

drop policy products_select on products;
create policy products_select on products
  for select using (has_capability(company_id, 'products.read'));
drop policy products_write on products;
create policy products_write on products
  for all using (has_capability(company_id, 'products.write'))
  with check (has_capability(company_id, 'products.write'));

-- Documents, their lines and what is filed with them.
drop policy documents_select on documents;
create policy documents_select on documents
  for select using (has_capability(company_id, 'documents.read'));
drop policy documents_write on documents;
create policy documents_write on documents
  for all using (has_capability(company_id, 'documents.write'))
  with check (has_capability(company_id, 'documents.write'));

drop policy document_lines_select on document_lines;
create policy document_lines_select on document_lines
  for select using (has_capability(company_id, 'documents.read'));
drop policy document_lines_write on document_lines;
create policy document_lines_write on document_lines
  for all using (has_capability(company_id, 'documents.write'))
  with check (has_capability(company_id, 'documents.write'));

drop policy attachments_select on attachments;
create policy attachments_select on attachments
  for select using (has_capability(company_id, 'documents.read'));
drop policy attachments_write on attachments;
create policy attachments_write on attachments
  for all using (has_capability(company_id, 'documents.write'))
  with check (has_capability(company_id, 'documents.write'));

-- The ledger, its analytics and the counters behind its numbering.
drop policy entries_select on entries;
create policy entries_select on entries
  for select using (has_capability(company_id, 'entries.read'));
drop policy entries_write on entries;
create policy entries_write on entries
  for all using (has_capability(company_id, 'entries.write'))
  with check (has_capability(company_id, 'entries.write'));

drop policy entry_lines_select on entry_lines;
create policy entry_lines_select on entry_lines
  for select using (has_capability(company_id, 'entries.read'));
drop policy entry_lines_write on entry_lines;
create policy entry_lines_write on entry_lines
  for all using (has_capability(company_id, 'entries.write'))
  with check (has_capability(company_id, 'entries.write'));

drop policy entry_line_analytics_select on entry_line_analytics;
create policy entry_line_analytics_select on entry_line_analytics
  for select using (has_capability(company_id, 'entries.read'));
drop policy entry_line_analytics_write on entry_line_analytics;
create policy entry_line_analytics_write on entry_line_analytics
  for all using (has_capability(company_id, 'entries.write'))
  with check (has_capability(company_id, 'entries.write'));

drop policy journal_sequences_select on journal_sequences;
create policy journal_sequences_select on journal_sequences
  for select using (
    exists (select 1 from journals j
             where j.id = journal_id and has_capability(j.company_id, 'entries.read'))
  );

drop policy matching_sequences_select on matching_sequences;
create policy matching_sequences_select on matching_sequences
  for select using (has_capability(company_id, 'entries.read'));

-- Money, and what it settles.
drop policy payments_select on payments;
create policy payments_select on payments
  for select using (has_capability(company_id, 'payments.read'));
drop policy payments_write on payments;
create policy payments_write on payments
  for all using (has_capability(company_id, 'payments.write'))
  with check (has_capability(company_id, 'payments.write'));

drop policy reconciliations_select on reconciliations;
create policy reconciliations_select on reconciliations
  for select using (has_capability(company_id, 'entries.read'));
drop policy reconciliations_write on reconciliations;
create policy reconciliations_write on reconciliations
  for all using (has_capability(company_id, 'reconcile.write'))
  with check (has_capability(company_id, 'reconcile.write'));

drop policy bank_accounts_select on bank_accounts;
create policy bank_accounts_select on bank_accounts
  for select using (has_capability(company_id, 'bank.read'));
drop policy bank_accounts_write on bank_accounts;
create policy bank_accounts_write on bank_accounts
  for all using (has_capability(company_id, 'bank.write'))
  with check (has_capability(company_id, 'bank.write'));

drop policy bank_statements_select on bank_statements;
create policy bank_statements_select on bank_statements
  for select using (has_capability(company_id, 'bank.read'));
drop policy bank_statements_write on bank_statements;
create policy bank_statements_write on bank_statements
  for all using (has_capability(company_id, 'bank.write'))
  with check (has_capability(company_id, 'bank.write'));

drop policy bank_transactions_select on bank_transactions;
create policy bank_transactions_select on bank_transactions
  for select using (has_capability(company_id, 'bank.read'));
drop policy bank_transactions_write on bank_transactions;
create policy bank_transactions_write on bank_transactions
  for all using (has_capability(company_id, 'bank.write'))
  with check (has_capability(company_id, 'bank.write'));

-- ---------------------------------------------------------------------------
-- Posting and closing are acts, not rows
--
-- `documents.post`, `entries.post` and `year_end.close` name three things a
-- policy on a table cannot express: what changes is a state, and the row is
-- one the member may already write. They are guarded by triggers on the
-- transition rather than inside `post_document()`, `post_entry()` and
-- `close_fiscal_year()` — a guard on the transition holds for every path into
-- it, including a client that updates the column itself, and it does not
-- require republishing a function that carries a thousand lines of accounting
-- for four lines of permission.
--
-- `auth.uid() is null` is the installer and the migrations, where row level
-- security is bypassed rather than satisfied; the same exemption
-- `next_entry_number()` makes.
-- ---------------------------------------------------------------------------

create or replace function assert_may_post_entry()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is not null and not has_capability(new.company_id, 'entries.post') then
    raise exception 'not_allowed: posting an entry in this company needs entries.post'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Two triggers rather than one: the WHEN clause of an INSERT trigger cannot
-- read OLD, so the transition and the arrival are written separately.
create trigger entries_assert_may_post_on_insert
  before insert on entries
  for each row when (new.state = 'posted')
  execute function assert_may_post_entry();

create trigger entries_assert_may_post
  before update of state on entries
  for each row when (new.state = 'posted' and old.state is distinct from 'posted')
  execute function assert_may_post_entry();

create or replace function assert_may_post_document()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is not null and not has_capability(new.company_id, 'documents.post') then
    raise exception 'not_allowed: booking a document in this company needs documents.post'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger documents_assert_may_post_on_insert
  before insert on documents
  for each row when (new.state = 'posted')
  execute function assert_may_post_document();

create trigger documents_assert_may_post
  before update of state on documents
  for each row when (new.state = 'posted' and old.state is distinct from 'posted')
  execute function assert_may_post_document();

create or replace function assert_may_close_year()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is not null and not has_capability(new.company_id, 'year_end.close') then
    raise exception 'not_allowed: closing or re-opening a financial year needs year_end.close'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger fiscal_years_assert_may_close
  before update of is_closed on fiscal_years
  for each row
  when (new.is_closed is distinct from old.is_closed)
  execute function assert_may_close_year();

-- ---------------------------------------------------------------------------
-- What the counters ask before they hand out a number
-- ---------------------------------------------------------------------------

create or replace function next_entry_number(p_journal_id uuid, p_date date)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_code    text;
  v_company uuid;
  v_year    smallint := extract(year from p_date)::smallint;
  v_number  integer;
begin
  select j.code, j.company_id into v_code, v_company from journals j where j.id = p_journal_id;
  if v_code is null then
    raise exception 'unknown_journal: journal % does not exist', p_journal_id;
  end if;

  if auth.uid() is not null and not has_capability(v_company, 'entries.post') then
    raise exception 'not_allowed: drawing a number in this company needs entries.post'
      using errcode = '42501';
  end if;

  insert into journal_sequences (journal_id, year, last_number)
  values (p_journal_id, v_year, 1)
  on conflict (journal_id, year)
    do update set last_number = journal_sequences.last_number + 1
  returning last_number into v_number;

  return v_code || '/' || v_year::text || '/' || lpad(v_number::text, 4, '0');
end;
$$;

create or replace function next_matching_number(p_company_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_number integer;
begin
  if auth.uid() is not null and not has_capability(p_company_id, 'reconcile.write') then
    raise exception 'not_allowed: matching in this company needs reconcile.write'
      using errcode = '42501';
  end if;

  insert into matching_sequences (company_id, last_number)
  values (p_company_id, 1)
  on conflict (company_id)
    do update set last_number = matching_sequences.last_number + 1
  returning last_number into v_number;

  return 'A' || lpad(v_number::text, 4, '0');
end;
$$;

-- ---------------------------------------------------------------------------
-- Row level security on the two new tables
--
-- The vocabulary and the presets are reference data: anyone signed in reads
-- them — an interface has to draw the list — and nobody writes them through
-- the API. A migration is the only thing that fills them.
-- ---------------------------------------------------------------------------

alter table capabilities      enable row level security;
alter table role_capabilities enable row level security;

create policy capabilities_select on capabilities
  for select using (auth.uid() is not null);
create policy role_capabilities_select on role_capabilities
  for select using (auth.uid() is not null);

-- ---------------------------------------------------------------------------
-- Grants
--
-- `has_capability` is called by policies, so `anon` needs EXECUTE on it for
-- the same reason as the eight helpers before it: without it an anonymous
-- SELECT raises "permission denied for function" instead of returning
-- nothing. It answers about `auth.uid()`, which is null for `anon`, so what
-- it gives away is the word no. `member_capabilities` is not a policy helper
-- and stays closed.
-- ---------------------------------------------------------------------------

revoke execute on all functions in schema public from public;
grant execute on function has_capability(uuid, text) to anon;
