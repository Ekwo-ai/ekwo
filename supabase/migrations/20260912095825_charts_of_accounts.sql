-- Ekwo OS — a country has charts of accounts, not one chart.
--
-- `account_templates` was keyed on `(country, code)`, which says a country
-- has exactly one chart. That is false in both countries this release ships:
-- a Belgian ASBL keeps its books on the PCMN adapted by the royal decree of
-- 2019, a French association on the plan comptable of ANC 2018-06, and both
-- differ from the chart a company uses while sharing its taxes and its VAT
-- return. It is false again in Germany (SKR03 and SKR04) and wherever a
-- profession has its own chart.
--
-- So a chart becomes a dimension:
--
--   `chart_templates`             the charts a country offers, one of them its
--                                 default, each naming the statements it
--                                 reports on and the audience it is for.
--   `account_templates.chart_code` which chart a template account belongs to;
--                                 the natural key becomes
--                                 `(country, chart_code, code)`.
--   `company_packs.chart_code`     which chart a company copied.
--
-- `default` is the value every existing row is backfilled with. It is a
-- mechanism word, not a country and not a chart name: the pack says the chart
-- is called PCMN or PCG, in its own data, where a name belongs.
--
-- **Journals do not get a chart.** A country's journals, its taxes and its
-- declaration form are common to its charts: an association buys, sells and
-- banks through the same journals as a company, and files the same VAT
-- return. Only the accounts differ, and the statements that present them.
-- The day a chart genuinely needs its own journal, `journal_templates` takes
-- the same column; nothing here forecloses it.
--
-- **The roles stay on `country_defaults`.** Which account is receivable,
-- payable or suspense is declared once per country, and `ekwo pack check`
-- refuses a pack whose role codes — and whose tax posting accounts — are not
-- in *every* chart it ships. That is the constraint that lets one set of
-- taxes install on any chart of the country, and it is checked where it can
-- be read, in the pack, rather than discovered at install time.

-- ---------------------------------------------------------------------------
-- chart_templates
-- ---------------------------------------------------------------------------

create table if not exists chart_templates (
  country              char(2) not null,
  code                 text not null,
  name                 text not null,
  name_i18n            jsonb not null default '{}'::jsonb,
  is_default           boolean not null default false,
  audience             text,
  statements           text[] not null default '{}'::text[],
  certification_status pack_certification,
  legal_reference      text,
  primary key (country, code),
  constraint chart_templates_country_format check (country ~ '^[A-Z]{2}$')
);

comment on table chart_templates is
  'Charts of accounts a country offers, from the `charts` list of packs/<cc>/pack.json. One of them is the default `ekwo init` installs when nobody names one.';
comment on column chart_templates.code is
  'Immutable once published. `default` on the chart a country shipped before this table existed.';
comment on column chart_templates.audience is
  'Who keeps books on this chart — companies, nonprofits, a profession. Free text from the pack: the core does nothing with it, an installer shows it.';
comment on column chart_templates.statements is
  'Codes of the financial statements this chart reports on. Empty means the generic framework by account type is all there is.';
comment on column chart_templates.certification_status is
  'How much this chart in particular has been read, when it differs from the pack as a whole. Null means the pack''s own status stands.';

-- One default per country, and a country with charts has one.
create unique index if not exists chart_templates_one_default_idx
  on chart_templates (country) where is_default;

-- ---------------------------------------------------------------------------
-- account_templates gains its chart
--
-- The column lands with a default so every published row is `default`, then
-- the unique key is widened. The old key has to go: `(country, code)` would
-- refuse the second chart's 400000 outright.
-- ---------------------------------------------------------------------------

alter table account_templates
  add column if not exists chart_code text not null default 'default';

comment on column account_templates.chart_code is
  'Which chart of the country this account belongs to. Part of the natural key: two charts of one country may carry the same code with different meanings.';

do $$
begin
  if exists (
    select 1 from pg_constraint
     where conname = 'account_templates_country_code_key'
       and conrelid = 'account_templates'::regclass
  ) then
    alter table account_templates drop constraint account_templates_country_code_key;
  end if;
end;
$$;

create unique index if not exists account_templates_chart_code_idx
  on account_templates (country, chart_code, code);

-- Every country that already holds a chart holds one called `default`. The
-- name is the code until a pack says better — and the compiled seed of every
-- pack says better on the next `psql -f`.
insert into chart_templates (country, code, name, is_default)
select distinct t.country, t.chart_code, t.chart_code, true
  from account_templates t
on conflict (country, code) do nothing;

alter table account_templates
  drop constraint if exists account_templates_chart_fk;
alter table account_templates
  add constraint account_templates_chart_fk
  foreign key (country, chart_code) references chart_templates (country, code);

-- ---------------------------------------------------------------------------
-- company_packs remembers which chart
-- ---------------------------------------------------------------------------

alter table company_packs
  add column if not exists chart_code text not null default 'default';

comment on column company_packs.chart_code is
  'Chart of the pack this company copied. `ekwo status` prints it, and `ekwo pack upgrade` compares against the same chart.';

-- ---------------------------------------------------------------------------
-- install_country_template, on a chart
--
-- Four arguments now, so the three-argument version is dropped first: an
-- overload with a default would make the existing three-argument call
-- ambiguous and PostgreSQL would refuse it.
-- ---------------------------------------------------------------------------

drop function if exists install_country_template(uuid, char, char);

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
         coalesce(nullif(t.name_i18n ->> v_language, ''), t.name),
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
  insert into journals (company_id, code, name, journal_type)
  select p_company_id, t.code, t.name, t.journal_type
    from journal_templates t
   where t.country = p_country
  on conflict (company_id, code) do nothing;

  -- 4. Taxes and their postings. Also common: a chart changes how a company
  --    presents itself, not what it owes.
  for r in
    select * from tax_templates where country = p_country order by sequence, code
  loop
    v_tax_id := null;
    insert into taxes (company_id, code, name, description, amount_type, amount,
                       applies_to, treatment, country, valid_from, valid_to,
                       legal_reference, vat_category, exemption_code, sequence,
                       tax_kind, recoverable, jurisdiction, price_include,
                       cash_basis, cash_basis_transition_account_id)
    values (p_company_id, r.code, r.name, r.description, r.amount_type, r.amount,
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
end;
$$;

comment on function install_country_template(uuid, char, char, text) is
  'Copies one chart of a country pack into a company in one language, with the country''s journals and taxes, wires the default roles, and records the pack version and the chart in company_packs.';

-- Companies installed before this migration copied the chart that was the
-- only one: `default`, which their `company_packs` row now carries by the
-- column's own default.

-- ---------------------------------------------------------------------------
-- Row level security
--
-- A chart is reference data, like the accounts it holds: any signed-in user
-- may read it, and nothing but the generated seed writes it.
-- ---------------------------------------------------------------------------

alter table chart_templates enable row level security;

create policy chart_templates_select on chart_templates
  for select using (auth.uid() is not null);

comment on policy chart_templates_select on chart_templates is
  'Reference data, readable by any signed-in user. No write policy: a chart comes from a pack.';

-- Rule 6 of supabase/migrations/README.md.
revoke execute on all functions in schema public from public;
