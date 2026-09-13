-- Ekwo OS — every label a user reads is translatable, and a pack says which
-- languages it publishes.
--
-- The chart of accounts, the declaration boxes, the financial statements, the
-- legal mentions of an invoice and the fixed-asset categories already carried
-- `name_i18n` / `text_i18n`. Journals and taxes did not, so a company keeping
-- its books in Dutch read "Journal des ventes" and "TVA 21 %" next to a chart
-- of accounts in Dutch. A label without a translation column is a label that
-- can only ever be shown in the language whoever wrote the pack happened to
-- speak, so the two that were missing get theirs here, and the country's own
-- name gets one too.
--
-- The shape is the one the rest of the schema already uses: `name` holds the
-- label in the language of the pack, `name_i18n` is an object keyed by
-- language code, and `label_for(name, name_i18n, preferred_languages(company))`
-- is the only way either is read.

-- ---------------------------------------------------------------------------
-- The columns
-- ---------------------------------------------------------------------------

alter table journal_templates add column if not exists name_i18n jsonb not null default '{}'::jsonb;
alter table journals          add column if not exists name_i18n jsonb not null default '{}'::jsonb;
alter table tax_templates     add column if not exists name_i18n jsonb not null default '{}'::jsonb;
alter table taxes             add column if not exists name_i18n jsonb not null default '{}'::jsonb;
alter table country_defaults  add column if not exists name_i18n jsonb not null default '{}'::jsonb;
alter table country_defaults  add column if not exists languages text[] not null default '{}'::text[];

comment on column journal_templates.name_i18n is
  'Label by language, from packs/<cc>/i18n/. The language the pack itself is written in stays in `name`.';
comment on column journals.name_i18n is
  'Label by language, copied from the template at install. `name` holds the language the company chose, and a company may rename a journal without losing the other languages.';
comment on column tax_templates.name_i18n is
  'Label by language, from packs/<cc>/i18n/. A translation of the same tax, never a different rate or a different rule.';
comment on column taxes.name_i18n is
  'Label by language, copied from the template at install. `name` holds the language the company chose.';
comment on column country_defaults.name_i18n is
  'The country''s own name by language, from packs/<cc>/i18n/. `name` holds it in English, which is what a country pack manifest is written in.';
comment on column country_defaults.languages is
  'Languages this country pack publishes every label in, the language of the pack itself first. An installer offers them; nothing in the schema restricts a company to them.';

-- ---------------------------------------------------------------------------
-- install_country_template, republished
--
-- Two statements change. Journals and taxes now copy `name_i18n` and pick the
-- language the company keeps its books in through `label_for()`, exactly as
-- the accounts above them already did. Everything else is the function as it
-- stood.
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
end;
$$;

revoke execute on all functions in schema public from public;
