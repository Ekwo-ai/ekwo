-- Ekwo OS — the part of the chart a company actually works with.
--
-- A country pack is a transcription: Belgium ships 353 accounts, France 394,
-- Luxembourg 1 026, and that is deliberate — an abridged chart would be this
-- repository's opinion of which accounts matter, sitting in a file that claims
-- to be the regulation. Nothing here takes that back. Two production companies
-- measured on their 2025 books used 60 accounts out of roughly 300 and 126 out
-- of roughly 300. The chart is right; a list of three hundred lines offered to
-- somebody looking for the account a purchase invoice goes on is not.
--
-- So the chart stays whole and a second question is added beside it: which of
-- these accounts is this company working with? It is answered by reading what
-- the company already points at, and it needs no maintenance:
--
--   moved      the account carries a line of a posted entry. With a period,
--              a line dated inside it; without one, ever.
--   referenced the configuration of the company names the account by foreign
--              key — a role default, a contact override, a journal, a tax
--              posting, the cash-basis transition account of a tax, a bank
--              account, a product. A reference is not dated: an account a
--              product posts to is in use before anything is booked on it, and
--              stays in use in a period nothing was booked in.
--   a module   a module the company has enabled names it. Asked of the module
--              rather than read from here, see below.
--   pinned     somebody said so. `accounts.pinned` is the one column an
--              operator edits to add an account the rules above cannot know
--              about, and to keep one that has stopped being referenced.
--
-- minus `deprecated`, which is already how a chart retires an account and is
-- already what the MCP server hides.
--
-- **The installation pins what it wires.** `install_country_template()` ends
-- by pinning every account it referenced — the roles, the journals' accounts,
-- the tax postings, the cash-basis transitions — around thirty on the packs
-- this release carries. The union above would find most of them anyway; what
-- pinning adds is that the set is written down. A company that later points a
-- role at a different account keeps the first one in its working chart rather
-- than watching it disappear, which is the behaviour an operator expects of a
-- list they have been reading for a year.
--
-- **The socle still ignores its modules.** `accounts_in_use` does not name
-- `assets` or `budgets`: it asks each module the company has enabled for the
-- accounts it holds, by the convention `disable_module()` already uses —
-- `<schema>.accounts_in_use(uuid)`, looked up with `to_regprocedure`, absent
-- on a module that references no account. The dependency keeps pointing one
-- way.
--
-- **Nothing is restricted by any of this.** A document line may name any
-- account of the chart that is not deprecated, exactly as before. This is a
-- reading, and the only thing it changes is what is offered first.

-- ---------------------------------------------------------------------------
-- The column
-- ---------------------------------------------------------------------------

alter table accounts
  add column if not exists pinned boolean not null default false;

comment on column accounts.pinned is
  'Whether this account belongs to the working chart of the company whatever the ledger says. Set by install_country_template() on everything it wires, and by an operator afterwards. Display only: pinning restricts nothing.';

-- The index the function's `pinned` branch reads, and the one a client asking
-- for the pinned set alone reads. Partial, because the pinned accounts are the
-- few and the rest of the chart is the many.
create index accounts_pinned_idx on accounts (company_id) where pinned;

-- ---------------------------------------------------------------------------
-- accounts_in_use
--
-- Security invoker: row level security decides which company the caller may
-- read, exactly as it does for a select on `accounts`. A stranger gets an
-- empty set rather than a refusal, which is the answer the policy already
-- gives them on the table.
-- ---------------------------------------------------------------------------

create or replace function accounts_in_use(
  p_company_id uuid,
  p_from       date default null,
  p_to         date default null
)
returns setof uuid
language plpgsql
stable
as $$
declare
  v_module     record;
  v_function   regprocedure;
  v_from_module uuid[];
  v_modules    uuid[] := '{}'::uuid[];
begin
  -- What the modules of this company hold. A module that names no account
  -- writes no function, and `to_regprocedure` answers null rather than
  -- raising — the same convention `disable_module()` reads for
  -- `<schema>.can_disable(uuid)`.
  for v_module in
    select m.schema_name
      from company_modules cm
      join modules m on m.code = cm.module_code
     where cm.company_id = p_company_id
  loop
    v_function := to_regprocedure(format('%I.accounts_in_use(uuid)', v_module.schema_name));
    if v_function is not null then
      execute format(
        'select coalesce(array_agg(t), ''{}''::uuid[]) from %I.accounts_in_use($1) as t',
        v_module.schema_name
      ) into v_from_module using p_company_id;
      v_modules := v_modules || v_from_module;
    end if;
  end loop;

  return query
    select a.id
      from accounts a
     where a.company_id = p_company_id
       and not a.deprecated
       and (
         a.pinned
         or a.id = any (v_modules)
         -- Moved, in the period when there is one.
         or exists (
           select 1
             from entry_lines l
             join entries e on e.id = l.entry_id
            where l.account_id = a.id
              and e.state = 'posted'
              and (p_from is null or e.entry_date >= p_from)
              and (p_to is null or e.entry_date <= p_to)
         )
         -- The roles the company keeps.
         or exists (
           select 1 from companies c
            where c.id = p_company_id
              and a.id in (c.receivable_account_id, c.payable_account_id,
                           c.suspense_account_id, c.rounding_account_id,
                           c.retained_earnings_account_id,
                           c.default_sales_account_id, c.default_purchase_account_id)
         )
         -- What a contact overrides those roles with.
         or exists (
           select 1 from contacts ct
            where ct.company_id = p_company_id
              and a.id in (ct.receivable_account_id, ct.payable_account_id)
         )
         -- What a journal posts to, and where its unallocated lines land.
         or exists (
           select 1 from journals j
            where j.company_id = p_company_id
              and a.id in (j.default_account_id, j.suspense_account_id)
         )
         -- Where a tax books, and where a cash-basis tax waits.
         or exists (
           select 1 from tax_postings tp
            where tp.company_id = p_company_id and tp.account_id = a.id
         )
         or exists (
           select 1 from taxes t
            where t.company_id = p_company_id and t.cash_basis_transition_account_id = a.id
         )
         -- The ledger account behind a bank account.
         or exists (
           select 1 from bank_accounts b
            where b.company_id = p_company_id and b.account_id = a.id
         )
         -- What the catalogue sells and buys on.
         or exists (
           select 1 from products p
            where p.company_id = p_company_id
              and a.id in (p.sale_account_id, p.purchase_account_id)
         )
       )
     order by a.code;
end;
$$;

comment on function accounts_in_use(uuid, date, date) is
  'The accounts of a company that are in use: moved by a posted entry in the period — ever, when no period is given — or referenced by the configuration of the company — a role default, a contact override, a journal, a tax posting, a cash-basis transition, a bank account, a product — or held by a module the company has enabled, or pinned. Deprecated accounts are left out. A configuration reference is not dated; only the movement is. This is a reading: nothing here restricts what may be booked.';

revoke execute on function accounts_in_use(uuid, date, date) from public, anon;
grant execute on function accounts_in_use(uuid, date, date) to authenticated, service_role;

revoke execute on all functions in schema public from public;

-- ---------------------------------------------------------------------------
-- What an installation pins
--
-- The set every company gets wired to whatever its chart is: the roles of the
-- country model, the accounts its journals post to, the accounts its taxes
-- book on, and the transition account of a cash-basis tax. It is worked out
-- from what the company already points at rather than from the pack, so it
-- says the same thing after an upgrade adds a tax as it said at installation,
-- and so a chart nobody here has seen needs no case of its own.
-- ---------------------------------------------------------------------------

create or replace function pin_referenced_accounts(p_company_id uuid)
returns integer
language plpgsql
as $$
declare
  v_pinned integer;
begin
  with referenced as (
    select unnest(array[c.receivable_account_id, c.payable_account_id,
                        c.suspense_account_id, c.rounding_account_id,
                        c.retained_earnings_account_id,
                        c.default_sales_account_id, c.default_purchase_account_id]) as id
      from companies c where c.id = p_company_id
    union
    select unnest(array[j.default_account_id, j.suspense_account_id])
      from journals j where j.company_id = p_company_id
    union
    select tp.account_id from tax_postings tp where tp.company_id = p_company_id
    union
    select t.cash_basis_transition_account_id from taxes t where t.company_id = p_company_id
  )
  update accounts a
     set pinned = true
    from referenced r
   where a.id = r.id
     and a.company_id = p_company_id
     and not a.pinned;

  select count(*) into v_pinned
    from accounts a where a.company_id = p_company_id and a.pinned;

  return v_pinned;
end;
$$;

comment on function pin_referenced_accounts(uuid) is
  'Pins every account this company points at by a role, a journal, a tax posting or a cash-basis transition, and returns how many accounts are pinned afterwards. Called by install_country_template(); callable again after an upgrade added a tax.';

revoke execute on function pin_referenced_accounts(uuid) from public, anon;
grant execute on function pin_referenced_accounts(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- install_country_template, pinning what it wired
--
-- The function is recreated whole rather than edited, because every file that
-- defined it shipped in v0.2.0 and a published migration is never touched. The
-- body below is its latest definition — `20260913111407`, which made the
-- journals and the taxes copy in the company's language — with one step added
-- at the end. Step 8 is the only line that is new.
-- ---------------------------------------------------------------------------

create or replace function install_country_template(
  p_company_id uuid,
  p_country    char(2),
  p_language   char(2) default null,
  p_chart_code text default null
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
  v_chart    text;
  v_charts   text;
begin
  if not exists (select 1 from companies where id = p_company_id) then
    raise exception 'unknown_company: %', p_company_id;
  end if;

  -- Which chart. The caller names one, or the pack's default stands. A named
  -- chart that does not exist is an error that lists what does: guessing here
  -- would install the wrong plan of accounts and nobody would notice for a
  -- year.
  if p_chart_code is null then
    select c.code into v_chart
      from chart_templates c
     where c.country = p_country and c.is_default;
    if v_chart is null then
      -- No pack for this country, or a pack that names no default chart.
      raise exception 'unknown_country_template: no chart of accounts seeded for %', p_country;
    end if;
  else
    select c.code into v_chart
      from chart_templates c
     where c.country = p_country and c.code = p_chart_code;
    if v_chart is null then
      select string_agg(c.code, ', ' order by c.code) into v_charts
        from chart_templates c where c.country = p_country;
      raise exception 'unknown_chart: % has no chart %. It has: %',
        p_country, p_chart_code, coalesce(v_charts, 'none');
    end if;
  end if;

  if not exists (
    select 1 from account_templates
     where country = p_country and chart_code = v_chart
  ) then
    raise exception 'unknown_country_template: chart % of % holds no account', v_chart, p_country;
  end if;

  -- The language of the copy: what the caller asked for, else what the
  -- company keeps its books in.
  select coalesce(p_language, c.language) into v_language
    from companies c where c.id = p_company_id;

  -- 1. Accounts, without the hierarchy.
  insert into accounts (company_id, code, name, name_i18n, statement_hint,
                        account_type, reconcilable)
  select p_company_id, t.code,
         label_for(t.name, t.name_i18n, array[v_language]),
         t.name_i18n, t.statement_hint, t.account_type, t.reconcilable
    from account_templates t
   where t.country = p_country
     and t.chart_code = v_chart
  on conflict (company_id, code) do nothing;

  -- 2. Hierarchy, now that every code exists.
  update accounts a
     set parent_id = p.id
    from account_templates t
    join accounts p on p.company_id = p_company_id and p.code = t.parent_code
   where a.company_id = p_company_id
     and a.code = t.code
     and t.country = p_country
     and t.chart_code = v_chart
     and t.parent_code is not null
     and a.parent_id is null;

  -- 3. Journals. Common to every chart of the country.
  insert into journals (company_id, code, name, name_i18n, journal_type)
  select p_company_id, t.code,
         label_for(t.name, t.name_i18n, array[v_language]),
         t.name_i18n, t.journal_type
    from journal_templates t
   where t.country = p_country
  on conflict (company_id, code) do nothing;

  -- 4. Taxes and their postings. Also common: a chart changes how a company
  --    presents itself, not what it owes.
  for r in
    select * from tax_templates where country = p_country order by sequence, code
  loop
    v_tax_id := null;
    insert into taxes (company_id, code, name, name_i18n, description, amount_type, amount,
                       applies_to, treatment, country, valid_from, valid_to,
                       legal_reference, vat_category, exemption_code, sequence,
                       tax_kind, recoverable, jurisdiction, price_include,
                       cash_basis, cash_basis_transition_account_id)
    values (p_company_id, r.code,
            label_for(r.name, r.name_i18n, array[v_language]),
            r.name_i18n, r.description, r.amount_type, r.amount,
            r.applies_to, r.treatment, p_country, r.valid_from, r.valid_to,
            r.legal_reference, r.vat_category, r.exemption_code, r.sequence,
            r.tax_kind, r.recoverable, r.jurisdiction, r.price_include,
            r.cash_basis, account_id_by_code(p_company_id, r.cash_basis_transition_account_code))
    on conflict (company_id, code) do nothing
    returning id into v_tax_id;

    if v_tax_id is null then
      continue;
    end if;

    insert into tax_postings (tax_id, company_id, document_kind, posting_type,
                              factor_percent, account_id, declaration_box,
                              box_factor_percent, report_code, sequence)
    select v_tax_id, p_company_id, tp.document_kind, tp.posting_type,
           tp.factor_percent, account_id_by_code(p_company_id, tp.account_code),
           tp.declaration_box, tp.box_factor_percent, tp.report_code, tp.sequence
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

  -- 7. What was copied, from which version, and on which chart.
  v_version := coalesce((select version from country_packs where country = p_country), '1.0.0');

  insert into company_packs (company_id, country, version, chart_code)
  values (p_company_id, p_country, v_version, v_chart)
  on conflict (company_id, country) do update
     set version = excluded.version,
         chart_code = excluded.chart_code,
         upgraded_at = now()
   where company_packs.version is distinct from excluded.version
      or company_packs.chart_code is distinct from excluded.chart_code;

  -- 8. The working chart. Everything wired above is pinned, so a company opens
  --    on the accounts its country model actually points at rather than on the
  --    whole transcription.
  perform pin_referenced_accounts(p_company_id);
end;
$$;

comment on function install_country_template(uuid, char, char, text) is
  'Copies one chart of a country pack into a company in one language, with the country''s journals and taxes, wires the default roles, pins the accounts it wired, and records the pack version and the chart in company_packs.';

revoke execute on function install_country_template(uuid, char, char, text) from public, anon;
grant execute on function install_country_template(uuid, char, char, text) to authenticated, service_role;

revoke execute on all functions in schema public from public;
