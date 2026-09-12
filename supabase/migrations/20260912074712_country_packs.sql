-- Ekwo OS — a country is a pack, and an installation knows which one it has.
--
-- `packs/<cc>/` became the source of a country in the previous change, and
-- the seeds are now compiled from it. What the schema still could not say is
-- *which version* of a pack an instance holds and which version a company
-- copied — so nothing could ever tell an operator that their chart of
-- accounts is a year behind the pack, and `ekwo pack upgrade` would have had
-- nothing to compare.
--
-- Two tables answer that, and nothing else changes hands:
--
--   `country_packs`  one row per pack loaded here, written by the generated
--                    seed: version, checksum, and the certification status
--                    that `ekwo init` prints, so an operator knows whether a
--                    professional has ever read the pack they installed.
--   `company_packs`  what each company copied, and when. A company can hold
--                    two packs — a foreign VAT registration is exactly that —
--                    which is why the key is (company, country).
--
-- The rest is the translated labels the pack format already carries.
-- `account_templates.name_i18n` holds every language of the pack;
-- `install_country_template` copies the one the company asked for into
-- `name` and keeps the whole object beside it, so renaming a chart into
-- another language is a data change and never an import. Translations live in
-- `jsonb` rather than in a table, which is where Odoo landed in v16 for the
-- same reason: a table would cost a join per label on six tables.
--
-- Additive throughout: new tables, `add column if not exists`, and one
-- function replaced. `install_country_template` gains a third argument, so
-- the two-argument version is dropped first — an overload with a default
-- would make a two-argument `install_country_template` call ambiguous, and
-- Postgres would refuse the call that works today.

-- ---------------------------------------------------------------------------
-- country_packs — what this instance holds
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'pack_certification') then
    create type pack_certification as enum ('community', 'reviewed', 'ekwo');
  end if;
end;
$$;

comment on type pack_certification is
  'How much a pack has been read: contributed, read by a named professional, or maintained by Ekwo.';

create table if not exists country_packs (
  country               char(2) primary key,
  name                  text not null,
  version               text not null,
  released_at           date,
  schema_min            text,
  certification_status  pack_certification not null default 'community',
  certified_by          text,
  certified_at          date,
  checksum              text,
  installed_at          timestamptz not null default now(),
  constraint country_packs_country_format check (country ~ '^[A-Z]{2}$'),
  constraint country_packs_version_semver check (version ~ '^[0-9]+\.[0-9]+\.[0-9]+$')
);

comment on table country_packs is 'Country packs loaded in this installation, with their version and certification.';
comment on column country_packs.checksum is 'sha256 of the pack files, so a changed pack is visible without a diff.';
comment on column country_packs.certification_status is 'Printed by `ekwo init`: a community pack has not been read by an accountant.';

-- ---------------------------------------------------------------------------
-- company_packs — what each company copied
-- ---------------------------------------------------------------------------

create table if not exists company_packs (
  company_id   uuid not null references companies(id) on delete cascade,
  country      char(2) not null,
  version      text not null,
  installed_at timestamptz not null default now(),
  upgraded_at  timestamptz,
  primary key (company_id, country),
  constraint company_packs_country_format check (country ~ '^[A-Z]{2}$'),
  constraint company_packs_version_semver check (version ~ '^[0-9]+\.[0-9]+\.[0-9]+$')
);

comment on table company_packs is 'Which version of which country pack a company copied. A company may hold two: a foreign VAT registration is one.';
comment on column company_packs.upgraded_at is 'Last time `install_country_template` or `ekwo pack upgrade` moved this company to another version.';

create index if not exists company_packs_country_idx on company_packs (country);

-- ---------------------------------------------------------------------------
-- Translated labels, and the line an account reports on
-- ---------------------------------------------------------------------------

alter table account_templates
  add column if not exists name_i18n      jsonb not null default '{}'::jsonb,
  add column if not exists statement_hint text;

alter table accounts
  add column if not exists name_i18n      jsonb not null default '{}'::jsonb,
  add column if not exists statement_hint text;

comment on column account_templates.name_i18n is 'Label by language, from packs/<cc>/i18n/. The pack''s own language stays in `name`.';
comment on column accounts.name_i18n is 'Label by language, copied from the template at install. `name` holds the language the company chose.';
comment on column account_templates.statement_hint is 'Statement line this account falls under when no rule catches it. Read by financial_statement() (P0-4).';
comment on column accounts.statement_hint is 'Statement line this account falls under when no rule catches it. Read by financial_statement() (P0-4).';

alter table companies
  add column if not exists language char(2) not null default 'fr';

comment on column companies.language is
  'Language this company keeps its books in. Chosen at install; decides which label of name_i18n lands in accounts.name.';

alter table country_defaults
  add column if not exists language_default char(2);

comment on column country_defaults.language_default is
  'Language `ekwo init` offers for a company of this country, before the company row exists — like currency_code, and for the same reason.';

-- No backfill here. A pack fills this column, and the compiled seed of every
-- country upserts `country_defaults`, so re-applying the seeds is what gives
-- an existing installation the value. Naming a language for a country in a
-- migration would put a country back into the core.

-- ---------------------------------------------------------------------------
-- install_country_template, in a language, recording what it copied
-- ---------------------------------------------------------------------------

drop function if exists install_country_template(uuid, char);

create or replace function install_country_template(
  p_company_id uuid,
  p_country    char(2),
  p_language   char(2) default null
)
returns void
language plpgsql
as $$
declare
  v_defaults country_defaults%rowtype;
  r          record;
  v_tax_id   uuid;
  v_language char(2);
  v_version  text;
begin
  if not exists (select 1 from companies where id = p_company_id) then
    raise exception 'unknown_company: %', p_company_id;
  end if;
  if not exists (select 1 from account_templates where country = p_country) then
    raise exception 'unknown_country_template: no chart of accounts seeded for %', p_country;
  end if;

  -- The language of the copy: what the caller asked for, else what the
  -- company keeps its books in. `companies.language` is never null, so there
  -- is always an answer, and a label missing from a pack falls back to the
  -- pack's own language rather than to nothing.
  select coalesce(p_language, c.language) into v_language
    from companies c where c.id = p_company_id;

  -- 1. Accounts, without the hierarchy.
  insert into accounts (company_id, code, name, name_i18n, statement_hint,
                        account_type, reconcilable)
  select p_company_id, t.code,
         coalesce(nullif(t.name_i18n ->> v_language, ''), t.name),
         t.name_i18n, t.statement_hint, t.account_type, t.reconcilable
    from account_templates t
   where t.country = p_country
  on conflict (company_id, code) do nothing;

  -- 2. Hierarchy, now that every code exists.
  update accounts a
     set parent_id = p.id
    from account_templates t
    join accounts p on p.company_id = p_company_id and p.code = t.parent_code
   where a.company_id = p_company_id
     and a.code = t.code
     and t.country = p_country
     and t.parent_code is not null
     and a.parent_id is null;

  -- 3. Journals.
  insert into journals (company_id, code, name, journal_type)
  select p_company_id, t.code, t.name, t.journal_type
    from journal_templates t
   where t.country = p_country
  on conflict (company_id, code) do nothing;

  -- 4. Taxes and their postings.
  for r in
    select * from tax_templates where country = p_country order by sequence, code
  loop
    v_tax_id := null;
    insert into taxes (company_id, code, name, description, amount_type, amount,
                       applies_to, treatment, country, valid_from, valid_to,
                       legal_reference, vat_category, exemption_code, sequence)
    values (p_company_id, r.code, r.name, r.description, r.amount_type, r.amount,
            r.applies_to, r.treatment, p_country, r.valid_from, r.valid_to,
            r.legal_reference, r.vat_category, r.exemption_code, r.sequence)
    on conflict (company_id, code) do nothing
    returning id into v_tax_id;

    if v_tax_id is null then
      continue;
    end if;

    insert into tax_postings (tax_id, company_id, document_kind, posting_type,
                              factor_percent, account_id, declaration_box,
                              box_factor_percent, sequence)
    select v_tax_id, p_company_id, tp.document_kind, tp.posting_type,
           tp.factor_percent, account_id_by_code(p_company_id, tp.account_code),
           tp.declaration_box, tp.box_factor_percent, tp.sequence
      from tax_posting_templates tp
     where tp.tax_template_id = r.id
     order by tp.sequence;
  end loop;

  -- 5. Roles.
  select * into v_defaults from country_defaults where country = p_country;
  if found then
    update companies c
       set receivable_account_id       = coalesce(c.receivable_account_id, account_id_by_code(p_company_id, v_defaults.receivable_code)),
           payable_account_id          = coalesce(c.payable_account_id, account_id_by_code(p_company_id, v_defaults.payable_code)),
           suspense_account_id         = coalesce(c.suspense_account_id, account_id_by_code(p_company_id, v_defaults.suspense_code)),
           rounding_account_id         = coalesce(c.rounding_account_id, account_id_by_code(p_company_id, v_defaults.rounding_code)),
           retained_earnings_account_id = coalesce(c.retained_earnings_account_id, account_id_by_code(p_company_id, v_defaults.retained_earnings_code)),
           default_sales_account_id    = coalesce(c.default_sales_account_id, account_id_by_code(p_company_id, v_defaults.sales_account_code)),
           default_purchase_account_id = coalesce(c.default_purchase_account_id, account_id_by_code(p_company_id, v_defaults.purchase_account_code)),
           sales_journal_id            = coalesce(c.sales_journal_id, (select id from journals where company_id = p_company_id and code = v_defaults.sales_journal_code)),
           purchase_journal_id         = coalesce(c.purchase_journal_id, (select id from journals where company_id = p_company_id and code = v_defaults.purchase_journal_code)),
           miscellaneous_journal_id    = coalesce(c.miscellaneous_journal_id, (select id from journals where company_id = p_company_id and code = v_defaults.misc_journal_code))
     where c.id = p_company_id;

    -- 6. The financial journals point at their account.
    update journals j
       set default_account_id = account_id_by_code(p_company_id, v_defaults.bank_account_code)
     where j.company_id = p_company_id
       and j.journal_type = 'bank'
       and j.default_account_id is null
       and v_defaults.bank_account_code is not null;

    update journals j
       set default_account_id = account_id_by_code(p_company_id, v_defaults.cash_account_code)
     where j.company_id = p_company_id
       and j.journal_type = 'cash'
       and j.default_account_id is null
       and v_defaults.cash_account_code is not null;
  end if;

  -- 7. What was copied, and from which version. A pack that has not declared
  --    itself — an instance seeded before this migration — counts as 1.0.0,
  --    which is what every pack of this release is.
  v_version := coalesce((select version from country_packs where country = p_country), '1.0.0');

  insert into company_packs (company_id, country, version)
  values (p_company_id, p_country, v_version)
  on conflict (company_id, country) do update
     set version = excluded.version,
         upgraded_at = now()
   where company_packs.version is distinct from excluded.version;
end;
$$;

comment on function install_country_template(uuid, char, char) is
  'Copies a country pack into a company in one language, wires the default roles and the financial journals, and records the pack version in company_packs.';

-- A function created today is *not* closed, and migration `20260911210131`
-- promised it would be. `alter default privileges ... revoke execute on
-- functions from public` does not delete the built-in world default on
-- PostgreSQL 15: `get_user_default_acl` merges the stored default with it, so
-- a function created afterwards still comes out with `=X` — EXECUTE for
-- PUBLIC, which on Supabase means an anonymous RPC endpoint. This migration
-- is the first to create a function since that one, and
-- `install_country_template` came out open; row level security would have
-- refused every write it attempts, but the surface should be closed and not
-- merely empty.
--
-- So the revoke is repeated here, and from PUBLIC only: `anon` holds explicit
-- grants on the eight policy helpers, and revoking from `anon` would take
-- those away and break every anonymous SELECT the policies evaluate. Any
-- migration that adds a function has to end with this line — the rule is in
-- `supabase/migrations/README.md`.

revoke execute on all functions in schema public from public;

-- ---------------------------------------------------------------------------
-- Companies installed before this migration
--
-- They hold a chart, so they hold a pack; only its version was never written
-- down. Every pack of this release is 1.0.0, so that is what they copied.
-- ---------------------------------------------------------------------------

insert into company_packs (company_id, country, version, installed_at)
select c.id, c.country, '1.0.0', c.created_at
  from companies c
 where exists (select 1 from accounts a where a.company_id = c.id)
on conflict (company_id, country) do nothing;

-- ---------------------------------------------------------------------------
-- Row level security
--
-- `country_packs` is reference data about the installation, not about a
-- company: a member of any company may read it, an administrator may read it
-- before any company exists. `company_packs` follows its company, and the
-- right to write it is the right that installs a chart of accounts in the
-- first place. Neither table has a policy that lets a signed-in stranger see
-- anything.
-- ---------------------------------------------------------------------------

alter table country_packs enable row level security;
alter table company_packs enable row level security;

create policy country_packs_select on country_packs
  for select using (is_any_company_member() or is_instance_admin());

create policy company_packs_select on company_packs
  for select using (is_company_member(company_id));
create policy company_packs_write on company_packs
  for all using (can_write_company(company_id)) with check (can_write_company(company_id));

comment on policy country_packs_select on country_packs is
  'Members of any company and instance administrators. Written by the generated seed, which runs as the owner.';
