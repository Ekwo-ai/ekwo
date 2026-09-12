-- Ekwo OS — which declaration a box belongs to, and which province a party is in.
--
-- Two columns the Canadian pack will need and that cost nothing to add now.
-- Both are phase-0 additions on purpose: adding them with the pack would mean
-- migrating `tax_postings` and `entry_lines` twice, and the second time they
-- would already hold years of postings.
--
-- **`report_code`.** `declaration_box` is a box number, and a box number is
-- only unique inside one form. Belgium and France each file one periodic
-- return, so '59' has never been ambiguous. A Canadian company files two at
-- once — the GST/HST return to the CRA and, in Québec, the combined return to
-- Revenu Québec — and line '101' of one is not line '101' of the other.
-- `report_code` says which form. Null keeps today's meaning: the periodic
-- return of the company's `fiscal_country`.
--
-- **`region`.** Canadian tax follows the *buyer's* province, not the seller's
-- (place of supply). The core deliberately chooses no tax for anyone; it can
-- only ever suggest one, and to suggest it has to know where the parties are.
-- ISO 3166-2 without the country prefix — `QC`, `BC`, `ON` — because the
-- country is already on the row next to it. The declarative rules that turn a
-- region into a suggested tax (`tax_rule_templates`, `suggest_tax()`) are
-- phase 1, with the pack that needs them; nothing reads `region` yet, and
-- that is the one deviation from "no column without a reader" this schema
-- makes, taken knowingly and written down here.
--
-- Additive: four `add column if not exists`, a backfill of the rows that
-- exist, and `install_country_template` replaced so it carries the new column
-- into a company.

-- ---------------------------------------------------------------------------
-- report_code
-- ---------------------------------------------------------------------------

alter table tax_posting_templates add column if not exists report_code text;
alter table tax_postings          add column if not exists report_code text;

comment on column tax_posting_templates.report_code is
  'Declaration form the box belongs to (BE-VAT-PERIODIC, FR-CA3, CA-GST34…). Null means the periodic return of the country.';
comment on column tax_postings.report_code is
  'Declaration form the box belongs to. Copied from the template; read by vat_return(company, from, to, report_code) from P0-3.';

-- Nothing is backfilled here, and that is the whole point of the column being
-- nullable. On the template side the packs carry the code and the compiled
-- seeds upsert it, so re-applying the seeds names every template posting. On
-- the company side a null keeps its documented meaning — the periodic return
-- of the company's country — and `vat_return()` reads it exactly that way, so
-- a posting an older installation holds lands on the right form without
-- anything being rewritten. A backfill would have had to name a country and
-- the code of its form, which is the thing this schema refuses to do.

-- ---------------------------------------------------------------------------
-- region
-- ---------------------------------------------------------------------------

alter table companies add column if not exists region text;
alter table contacts  add column if not exists region text;

comment on column companies.region is
  'Province or state, ISO 3166-2 without the country prefix: QC, BC, CA. Null in a country that taxes uniformly.';
comment on column contacts.region is
  'Province or state of the party, ISO 3166-2 without the country prefix. Canadian tax follows the buyer''s province, not the seller''s.';

-- ---------------------------------------------------------------------------
-- install_country_template carries report_code into the company
-- ---------------------------------------------------------------------------

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

  -- 4. Taxes and their postings, each posting keeping the form its box is on.
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

  -- 6. What was copied, and from which version.
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

-- The rule of `20260911210131`, which its own default privileges cannot keep:
-- a function created now comes out executable by PUBLIC unless this runs.
-- From PUBLIC only — `anon` holds explicit grants on the policy helpers.
revoke execute on all functions in schema public from public;
