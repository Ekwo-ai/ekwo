-- Ekwo OS — modules: one Postgres schema each, the ledger only through a function.
--
-- The socle is `public` and knows nothing about what is built beside it. A
-- module is a schema of its own — `assets`, `budgets`, `carbon` — with its own
-- migrations, its own row level security and its own tests. It depends on the
-- socle by foreign key (`public.companies`, `public.accounts`,
-- `public.contacts`, `public.products`, `public.fiscal_years`) and it never
-- writes the ledger by hand.
--
-- Three things live here, and nothing else:
--
--   1. **The registry is a table, not code.** `modules` is one row per module
--      this installation carries, written by the module's own first migration.
--      There is deliberately no plugin registry in TypeScript: a module that
--      is installed is a schema that exists and a row that says so, and one
--      query answers "what is here" for the CLI, the MCP server and a human.
--
--   2. **A module is enabled per company.** `company_modules` is that, and it
--      is written only by `enable_module()` and `disable_module()` — there is
--      no write policy on the table at all, so the guard inside the function
--      is the only way in rather than the polite way in. Same reason
--      `fiscal_years.is_closed` stopped being an ordinary column.
--
--   3. **A module posts through `post_module_entry()`.** It assembles nothing:
--      it hands over a company, a date, a journal, a tag and a list of lines,
--      and the function builds the draft and calls `post_entry()` — which
--      stays the one place an entry is validated, numbered and locked against
--      a closed period. So a module never names `entries` or `entry_lines` in
--      a statement of its own, and a test over `modules/**` proves it.
--
-- **What the tag buys.** `entries.module_code` and `entries.module_ref` say
-- which module wrote an entry and what for, and a unique index on the three
-- makes a second posting of the same thing impossible rather than merely
-- discouraged. `assets.run_depreciation` is idempotent because the database
-- refuses the duplicate, not because the module remembered to look. Tagging by
-- `(module_code, ref)` is also why `entry_kind` gains no value per module: a
-- depreciation entry is a normal entry that a report may leave in.
--
-- **What the socle does not gain.** No hook, no callback, no way for a module
-- to change what posting means. The dependency points one way: a module reads
-- and calls the socle, the socle ignores its modules. The single exception is
-- `disable_module()`, which asks a module whether it still holds posted data —
-- by looking for `<schema>.can_disable(uuid)` and running it if it is there.
-- That is a convention rather than a column, so a module that holds nothing
-- writes nothing.

-- ---------------------------------------------------------------------------
-- The registry
-- ---------------------------------------------------------------------------

create type module_status as enum ('draft', 'available', 'deprecated');

comment on type module_status is
  'Whether a module may be enabled on a company: draft is not ready, available is, deprecated keeps the companies that already have it and refuses new ones.';

create table modules (
  code               text primary key,
  name               text not null,
  description        text,
  -- The Postgres schema the module lives in. Unique, because two modules in
  -- one schema is two sets of tables nobody can tell apart.
  schema_name        text not null unique,
  version            text not null,
  status             module_status not null default 'draft',
  -- The oldest socle migration this module needs, as its timestamp version —
  -- the same shape `country_packs.schema_min` uses. Read by `ekwo module
  -- enable`, which holds the migration history and can compare; the function
  -- below does not, because the history table is the CLI's business and a
  -- database restored from a dump may not carry it.
  requires_socle_min text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint modules_code_format check (code ~ '^[a-z][a-z0-9_]{1,30}$'),
  constraint modules_schema_format check (schema_name ~ '^[a-z][a-z0-9_]{1,30}$'),
  constraint modules_schema_not_public check (schema_name <> 'public')
);

comment on table modules is
  'One row per module this installation carries, written by the module''s own first migration. The registry is a table, not code.';
comment on column modules.schema_name is
  'The Postgres schema the module lives in. PostgREST only exposes it once it is listed in the API settings, which no migration can do — `ekwo module enable` prints the line to add.';
comment on column modules.requires_socle_min is
  'Oldest socle migration version this module needs. Read by `ekwo module enable` against the migration history.';

create trigger modules_set_updated_at
  before update on modules
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Which company holds which module
-- ---------------------------------------------------------------------------

create table company_modules (
  company_id  uuid not null references companies(id) on delete cascade,
  module_code text not null references modules(code) on delete restrict,
  enabled_at  timestamptz not null default now(),
  enabled_by  uuid,
  settings    jsonb not null default '{}'::jsonb,
  primary key (company_id, module_code)
);

comment on table company_modules is
  'Modules enabled on a company, and the settings that company keeps for each. Written by enable_module() and disable_module() and by nothing else: there is no write policy.';
comment on column company_modules.settings is
  'Per-company settings of the module, in its own vocabulary. The socle never reads inside this object.';

create index company_modules_module_idx on company_modules (module_code);

-- ---------------------------------------------------------------------------
-- The two questions a module asks
--
-- `module_is_enabled` is the bare fact and answers for anybody. `module_enabled`
-- is the one a row level security policy calls: it is the fact **and** the
-- membership, so a module policy is one call and a stranger gets the same word
-- `is_company_member` already gives them — no. That is why it can be granted to
-- `anon` alongside the eight helpers: without the grant an anonymous select on
-- a module table would raise "permission denied for function" instead of
-- returning nothing, and an error is a louder answer than an empty set.
-- ---------------------------------------------------------------------------

create or replace function module_is_enabled(p_company_id uuid, p_code text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from company_modules m
     where m.company_id = p_company_id and m.module_code = p_code
  );
$$;

comment on function module_is_enabled(uuid, text) is
  'Whether a module is enabled on a company, regardless of who is asking. Definer so a policy on company_modules cannot recurse into it.';

create or replace function module_enabled(p_company_id uuid, p_code text)
returns boolean
language sql
stable
as $$
  select is_company_member(p_company_id) and module_is_enabled(p_company_id, p_code);
$$;

comment on function module_enabled(uuid, text) is
  'The helper a module''s row level security policies call: this module is enabled on this company and the caller is a member of it. One call, and the answer to a stranger is no.';

create or replace function module_settings(p_company_id uuid, p_code text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select m.settings
    from company_modules m
   where m.company_id = p_company_id and m.module_code = p_code;
$$;

comment on function module_settings(uuid, text) is
  'The settings a company keeps for one of its modules, or null when the module is not enabled. The socle never looks inside the object.';

-- ---------------------------------------------------------------------------
-- Enabling and disabling
--
-- Both are definer with the guard written inside, because `company_modules`
-- has no write policy: the function is the only way in, and the rule applies
-- to psql and PostgREST alike. `register_instance()` is the same shape.
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
  if not is_company_owner(p_company_id) then
    raise exception 'not_company_owner: enabling a module on a company is the owner''s decision'
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
  'Enables a module on a company, and updates its settings when it is already enabled. The owner''s decision, checked here because the table has no write policy.';

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
  if not is_company_owner(p_company_id) then
    raise exception 'not_company_owner: disabling a module on a company is the owner''s decision'
      using errcode = '42501';
  end if;

  select * into v_module from modules where code = p_code;
  if not found then
    raise exception 'unknown_module: % is not installed on this instance', p_code;
  end if;

  if not module_is_enabled(p_company_id, p_code) then
    return;
  end if;

  -- A module says for itself whether it still holds something a company would
  -- lose. The convention is one function, `<schema>.can_disable(uuid)`,
  -- returning null when there is nothing in the way and a sentence when there
  -- is. A module that holds no posted data writes none, and `to_regprocedure`
  -- answers null rather than raising.
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
  'Disables a module on a company, unless the module says it still holds data — `<schema>.can_disable(company)` returning a sentence refuses, returning null allows. Nothing the module wrote is deleted.';

-- ---------------------------------------------------------------------------
-- The tag an entry carries when a module wrote it
-- ---------------------------------------------------------------------------

alter table entries
  add column if not exists module_code text references modules(code) on delete restrict,
  add column if not exists module_ref  text;

comment on column entries.module_code is
  'Which module wrote this entry, or null for an entry of the socle. Set by post_module_entry().';
comment on column entries.module_ref is
  'What the entry is for, in the module''s own words — `depreciation:2026-03` , `disposal:<uuid>`. Unique per company and module, which is what makes a module''s posting idempotent.';

-- The idempotence of every module that posts, in one index. A second call that
-- would book the same period twice fails on the key rather than on a check the
-- module remembered to write.
create unique index entries_module_ref_idx
  on entries (company_id, module_code, module_ref)
  where module_code is not null and module_ref is not null;

create index entries_module_idx on entries (company_id, module_code)
  where module_code is not null;

-- A tag is a fact about who wrote an entry, so it is written once and never
-- moved, and it may only name a module the company actually holds. An entry
-- carrying one is also never born posted: `post_module_entry` builds a draft
-- and lets `post_entry` do the posting, which is where the period lock, the
-- balance check and the numbering live.
create or replace function entries_guard_module()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.module_code is not null then
      if not module_is_enabled(new.company_id, new.module_code) then
        raise exception 'module_not_enabled: % is not enabled on this company', new.module_code
          using errcode = '55006';
      end if;
      if new.state = 'posted' then
        raise exception 'module_entry_not_posted_by_hand: a module entry is built as a draft and posted by post_entry()'
          using errcode = '55006';
      end if;
    end if;
    return new;
  end if;

  if new.module_code is distinct from old.module_code
     or new.module_ref is distinct from old.module_ref then
    raise exception 'module_tag_immutable: which module wrote an entry, and what for, is written once'
      using errcode = '55006';
  end if;

  return new;
end;
$$;

comment on function entries_guard_module() is
  'Keeps the module tag of an entry honest: a module the company holds, never posted on insert, never moved afterwards.';

create trigger entries_guard_module
  before insert or update on entries
  for each row execute function entries_guard_module();

-- ---------------------------------------------------------------------------
-- post_module_entry
--
-- The one way a module reaches the ledger. It takes the lines as data — the
-- same shape `opening_balance()` takes a trial balance in, because that is the
-- shape this schema has already chosen for "here are some ledger lines" — and
-- it does exactly what `post_document` and `post_payment` do with them: build
-- a draft, then `post_entry()`. Nothing about sides, rounding, numbering or
-- period locks moves into a module, which is the whole reason this function
-- exists rather than a grant on `entries`.
-- ---------------------------------------------------------------------------

create or replace function post_module_entry(
  p_company_id  uuid,
  p_module_code text,
  p_ref         text,
  p_date        date,
  p_description text,
  p_lines       jsonb,
  p_journal_id  uuid default null
)
returns uuid
language plpgsql
as $$
declare
  v_company  companies%rowtype;
  v_journal  uuid;
  v_entry    entries%rowtype;
  v_line     jsonb;
  v_account  uuid;
  v_code     text;
  v_debit    numeric(16, 2);
  v_credit   numeric(16, 2);
  v_sequence integer := 0;
  v_debits   numeric(16, 2) := 0;
  v_credits  numeric(16, 2) := 0;
begin
  select * into v_company from companies where id = p_company_id;
  if not found then
    raise exception 'unknown_company: %', p_company_id;
  end if;

  if not module_is_enabled(p_company_id, p_module_code) then
    raise exception 'module_not_enabled: % is not enabled on this company', p_module_code
      using errcode = '55006';
  end if;

  if p_ref is null or p_ref = '' then
    raise exception 'module_entry_without_ref: an entry written by a module says what it is for, so a second one cannot repeat it';
  end if;

  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'module_entry_empty: post_module_entry takes a non-empty array of lines';
  end if;

  -- The miscellaneous journal unless the caller names one. A module booking is
  -- not a movement of money and not a document, so it has no business on a
  -- bank or a sales journal — the same reasoning that put the exchange
  -- difference and the cash-basis transfer there.
  v_journal := coalesce(p_journal_id, v_company.miscellaneous_journal_id);
  if v_journal is null then
    raise exception 'no_miscellaneous_journal: this company has no journal for an entry that is neither a document nor a payment';
  end if;

  insert into entries (company_id, journal_id, fiscal_year_id, entry_date,
                       description, state, module_code, module_ref)
  values (p_company_id, v_journal, fiscal_year_at(p_company_id, p_date), p_date,
          p_description, 'draft', p_module_code, p_ref)
  returning * into v_entry;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_sequence := v_sequence + 10;
    v_code := v_line ->> 'account_code';
    v_account := (v_line ->> 'account_id')::uuid;
    if v_account is null then
      if v_code is null then
        raise exception 'module_line_without_account: line % names neither account_id nor account_code', v_sequence / 10;
      end if;
      v_account := account_id_by_code(p_company_id, v_code);
      if v_account is null then
        raise exception 'unknown_account: % is not an account of this company', v_code;
      end if;
    end if;

    v_debit  := round(coalesce((v_line ->> 'debit')::numeric, 0), 2);
    v_credit := round(coalesce((v_line ->> 'credit')::numeric, 0), 2);
    if v_debit < 0 or v_credit < 0 then
      raise exception 'module_line_negative: a line chooses a side, never a sign';
    end if;
    if v_debit <> 0 and v_credit <> 0 then
      raise exception 'module_line_two_sides: a line carries a debit or a credit, not both';
    end if;
    if v_debit = 0 and v_credit = 0 then
      raise exception 'module_line_no_amount: a line with neither a debit nor a credit says nothing';
    end if;

    insert into entry_lines (entry_id, company_id, account_id, sequence, name,
                             debit, credit, contact_id, date_maturity)
    values (v_entry.id, p_company_id, v_account, v_sequence,
            coalesce(v_line ->> 'label', p_description),
            v_debit, v_credit,
            (v_line ->> 'contact_id')::uuid,
            (v_line ->> 'date_maturity')::date);

    v_debits  := v_debits + v_debit;
    v_credits := v_credits + v_credit;
  end loop;

  if v_debits <> v_credits then
    raise exception 'entry_unbalanced: the lines of % have debit % and credit %', p_ref, v_debits, v_credits;
  end if;

  v_entry := post_entry(v_entry.id);
  return v_entry.id;
end;
$$;

comment on function post_module_entry(uuid, text, text, date, text, jsonb, uuid) is
  'The only way a module reaches the ledger: it hands over lines as data and this builds the draft and calls post_entry(). The tag (module_code, ref) is unique per company, so posting the same thing twice is refused by the database.';

create or replace function module_entry_id(p_company_id uuid, p_module_code text, p_ref text)
returns uuid
language sql
stable
as $$
  select e.id
    from entries e
   where e.company_id = p_company_id
     and e.module_code = p_module_code
     and e.module_ref = p_ref
     and e.state = 'posted'
   limit 1;
$$;

comment on function module_entry_id(uuid, text, text) is
  'The entry a module already posted under a reference, or null. What a module reads before deciding it has work to do.';

-- ---------------------------------------------------------------------------
-- Row level security
--
-- `modules` is reference data about the installation, like `country_defaults`:
-- readable by anyone signed in, written by a migration. `company_modules` is
-- readable by the members of its company and written by the two functions
-- above, which is why it has no write policy at all.
-- ---------------------------------------------------------------------------

alter table modules         enable row level security;
alter table company_modules enable row level security;

create policy modules_select on modules
  for select using (auth.uid() is not null);

create policy company_modules_select on company_modules
  for select using (is_company_member(company_id));

comment on policy company_modules_select on company_modules is
  'Members read. Nobody writes: enable_module() and disable_module() are the way in, and they check the owner themselves.';

-- The helper a module's policies call, for the same reason the eight policy
-- helpers of 20260911210131 keep theirs: without it an anonymous select on a
-- module table raises instead of returning nothing.
grant execute on function module_enabled(uuid, text) to anon;

-- A migration that adds a function ends with this line, from PUBLIC and never
-- from `anon`.
revoke execute on all functions in schema public from public;
