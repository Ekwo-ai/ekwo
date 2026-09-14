-- Ekwo OS — moving a company from one version of a country pack to the next.
--
-- A pack is versioned and a company records the version it copied, but until
-- now nothing could say what separated the two. `ekwo status` printed the
-- warning — "this company copied BE 1.0.0, this installation holds 1.4.0" —
-- and stopped there, because a chart of accounts is not a file to overwrite:
-- the company has been booking on those accounts for a year.
--
-- The difference is computed by natural key — an account code, a journal
-- code, a tax code — and every difference falls into one of three rules:
--
--   addition  the pack has something the company does not. Copied in. A new
--             account or a new tax takes nothing away and breaks nothing.
--   closure   the pack has closed the validity of a tax the company still
--             holds open. Applied. A rate that changes is a new tax plus a
--             `valid_to` on the old one, never an edit, so this is how a rate
--             change reaches a company: the old one stops, the new one is an
--             addition.
--   review    everything else — a label that differs, a rate that differs on
--             the same code, a posting that books somewhere else, a row the
--             company holds and the pack does not. Listed, never applied
--             without the caller saying so.
--
-- The third rule is the point of the whole thing. Silently overwriting a
-- company's chart of accounts from a pack is how an upgrade destroys a year
-- of bookkeeping, and there is no way to be sure from here which of the two is
-- right: an operator may have renamed an account deliberately. So it is shown
-- and it waits.
--
-- One row the caller never gets applied whatever they ask: a row the company
-- holds and the pack does not. Nothing is deleted from a company's books by an
-- upgrade — an account may carry entries, a tax may be on a posted document —
-- and a pack that retires a code retires it, which is a `valid_to`, not a
-- deletion.

create type pack_change_rule as enum ('addition', 'closure', 'review');

comment on type pack_change_rule is
  'What an upgrade does with a difference: copy it in, close a validity, or show it and wait.';

-- ---------------------------------------------------------------------------
-- The difference
-- ---------------------------------------------------------------------------

create or replace function pack_upgrade_diff(
  p_company_id uuid,
  p_country    char(2) default null
)
returns table (
  object text,
  key    text,
  change text,
  rule   pack_change_rule,
  detail jsonb
)
language plpgsql
stable
as $$
declare
  v_country char(2);
  v_chart   text;
begin
  select coalesce(p_country, c.country) into v_country
    from companies c where c.id = p_company_id;
  if v_country is null then
    raise exception 'unknown_company: %', p_company_id;
  end if;

  select cp.chart_code into v_chart
    from company_packs cp
   where cp.company_id = p_company_id and cp.country = v_country;
  if v_chart is null then
    raise exception 'no_pack_installed: company % holds no % pack, so there is nothing to upgrade from', p_company_id, v_country;
  end if;

  -- Accounts -----------------------------------------------------------------
  return query
  select 'account', t.code, 'missing', 'addition'::pack_change_rule,
         jsonb_build_object('pack', jsonb_build_object('name', t.name, 'account_type', t.account_type))
    from account_templates t
   where t.country = v_country and t.chart_code = v_chart
     and not exists (select 1 from accounts a where a.company_id = p_company_id and a.code = t.code);

  return query
  select 'account', a.code, 'differs', 'review'::pack_change_rule,
         jsonb_build_object(
           'pack', jsonb_build_object('name', t.name, 'account_type', t.account_type),
           'company', jsonb_build_object('name', a.name, 'account_type', a.account_type))
    from accounts a
    join account_templates t
      on t.country = v_country and t.chart_code = v_chart and t.code = a.code
   where a.company_id = p_company_id
     and (label_for(t.name, t.name_i18n, preferred_languages(p_company_id)) is distinct from a.name
          or t.account_type is distinct from a.account_type);

  return query
  select 'account', a.code, 'company_only', 'review'::pack_change_rule,
         jsonb_build_object('company', jsonb_build_object('name', a.name, 'account_type', a.account_type))
    from accounts a
   where a.company_id = p_company_id
     and not exists (select 1 from account_templates t
                      where t.country = v_country and t.chart_code = v_chart and t.code = a.code);

  -- Journals -----------------------------------------------------------------
  return query
  select 'journal', t.code, 'missing', 'addition'::pack_change_rule,
         jsonb_build_object('pack', jsonb_build_object('name', t.name, 'journal_type', t.journal_type))
    from journal_templates t
   where t.country = v_country
     and not exists (select 1 from journals j where j.company_id = p_company_id and j.code = t.code);

  return query
  select 'journal', j.code, 'differs', 'review'::pack_change_rule,
         jsonb_build_object(
           'pack', jsonb_build_object('name', t.name, 'journal_type', t.journal_type),
           'company', jsonb_build_object('name', j.name, 'journal_type', j.journal_type))
    from journals j
    join journal_templates t on t.country = v_country and t.code = j.code
   where j.company_id = p_company_id
     and (t.name is distinct from j.name or t.journal_type is distinct from j.journal_type);

  -- Taxes --------------------------------------------------------------------
  return query
  select 'tax', t.code, 'missing', 'addition'::pack_change_rule,
         jsonb_build_object('pack', jsonb_build_object(
           'name', t.name, 'amount', t.amount, 'amount_type', t.amount_type,
           'valid_from', t.valid_from, 'valid_to', t.valid_to))
    from tax_templates t
   where t.country = v_country
     and not exists (select 1 from taxes x where x.company_id = p_company_id and x.code = t.code);

  -- A validity the pack has closed and the company still holds open, or holds
  -- open longer. This is a rate change arriving: the old tax stops on the day
  -- the pack says, and the new rate is an addition above.
  return query
  select 'tax', x.code, 'valid_to', 'closure'::pack_change_rule,
         jsonb_build_object('pack', jsonb_build_object('valid_to', t.valid_to),
                            'company', jsonb_build_object('valid_to', x.valid_to))
    from taxes x
    join tax_templates t on t.country = v_country and t.code = x.code
   where x.company_id = p_company_id
     and t.valid_to is not null
     and (x.valid_to is null or x.valid_to > t.valid_to);

  return query
  select 'tax', x.code, 'differs', 'review'::pack_change_rule,
         jsonb_build_object(
           'pack', jsonb_build_object('name', t.name, 'amount', t.amount,
                                      'amount_type', t.amount_type, 'treatment', t.treatment,
                                      'applies_to', t.applies_to, 'tax_kind', t.tax_kind,
                                      'recoverable', t.recoverable, 'valid_from', t.valid_from),
           'company', jsonb_build_object('name', x.name, 'amount', x.amount,
                                         'amount_type', x.amount_type, 'treatment', x.treatment,
                                         'applies_to', x.applies_to, 'tax_kind', x.tax_kind,
                                         'recoverable', x.recoverable, 'valid_from', x.valid_from))
    from taxes x
    join tax_templates t on t.country = v_country and t.code = x.code
   where x.company_id = p_company_id
     and (label_for(t.name, null, preferred_languages(p_company_id)) is distinct from x.name
          or t.amount is distinct from x.amount
          or t.amount_type is distinct from x.amount_type
          or t.treatment is distinct from x.treatment
          or t.applies_to is distinct from x.applies_to
          or t.tax_kind is distinct from x.tax_kind
          or t.recoverable is distinct from x.recoverable
          or t.valid_from is distinct from x.valid_from);

  return query
  select 'tax', x.code, 'company_only', 'review'::pack_change_rule,
         jsonb_build_object('company', jsonb_build_object('name', x.name, 'amount', x.amount))
    from taxes x
   where x.company_id = p_company_id
     and x.country = v_country
     and not exists (select 1 from tax_templates t where t.country = v_country and t.code = x.code);

  -- What a tax books. Compared as a whole per tax rather than line by line: a
  -- posting has no identity of its own, and "this tax now books its
  -- non-deductible share somewhere else" is one fact, not four.
  return query
  with pack as (
    select t.code,
           jsonb_agg(jsonb_build_object('document_kind', tp.document_kind,
                                        'posting_type', tp.posting_type,
                                        'factor_percent', tp.factor_percent,
                                        'account_code', tp.account_code,
                                        'declaration_box', tp.declaration_box,
                                        'box_factor_percent', tp.box_factor_percent,
                                        'report_code', tp.report_code)
                     order by tp.document_kind, tp.posting_type, tp.sequence) as postings
      from tax_templates t
      join tax_posting_templates tp on tp.tax_template_id = t.id
     where t.country = v_country
     group by t.code
  ), held as (
    select x.code,
           jsonb_agg(jsonb_build_object('document_kind', p.document_kind,
                                        'posting_type', p.posting_type,
                                        'factor_percent', p.factor_percent,
                                        'account_code', a.code,
                                        'declaration_box', p.declaration_box,
                                        'box_factor_percent', p.box_factor_percent,
                                        'report_code', p.report_code)
                     order by p.document_kind, p.posting_type, p.sequence) as postings
      from taxes x
      join tax_postings p on p.tax_id = x.id
      left join accounts a on a.id = p.account_id
     where x.company_id = p_company_id
     group by x.code
  )
  select 'tax_posting', pack.code, 'differs', 'review'::pack_change_rule,
         jsonb_build_object('pack', pack.postings, 'company', held.postings)
    from pack
    join held on held.code = pack.code
   where pack.postings is distinct from held.postings;
end;
$$;

comment on function pack_upgrade_diff(uuid, char) is
  'What separates a company from the country pack this installation now holds, by natural key, each difference carrying the rule that decides what an upgrade does with it.';

-- ---------------------------------------------------------------------------
-- The upgrade
-- ---------------------------------------------------------------------------

create or replace function pack_upgrade(
  p_company_id uuid,
  p_country    char(2) default null,
  p_apply      boolean default false
)
returns jsonb
language plpgsql
as $$
declare
  v_country   char(2);
  v_chart     text;
  v_from      text;
  v_to        text;
  v_applied   jsonb := '[]'::jsonb;
  v_listed    jsonb := '[]'::jsonb;
  v_refused   jsonb := '[]'::jsonb;
  d           record;
  v_tax_id    uuid;
  v_template  tax_templates%rowtype;
begin
  select coalesce(p_country, c.country) into v_country
    from companies c where c.id = p_company_id;
  if v_country is null then
    raise exception 'unknown_company: %', p_company_id;
  end if;

  if auth.uid() is not null and not has_capability(p_company_id, 'company.write') then
    raise exception 'not_allowed: upgrading a country pack needs company.write';
  end if;

  select cp.version, cp.chart_code into v_from, v_chart
    from company_packs cp
   where cp.company_id = p_company_id and cp.country = v_country;
  if v_chart is null then
    raise exception 'no_pack_installed: company % holds no % pack, so there is nothing to upgrade from', p_company_id, v_country;
  end if;

  select version into v_to from country_packs where country = v_country;
  if v_to is null then
    raise exception 'no_pack_loaded: this installation holds no % pack. Apply the seeds of this release first.', v_country;
  end if;

  for d in select * from pack_upgrade_diff(p_company_id, v_country) loop
    -- Never, whatever the caller asked. An upgrade adds and closes; it does
    -- not take a row out of a company's books.
    if d.change = 'company_only' then
      v_refused := v_refused || jsonb_build_object('object', d.object, 'key', d.key,
                                                   'change', d.change, 'rule', d.rule,
                                                   'detail', d.detail);
      continue;
    end if;

    if d.rule = 'review' and not p_apply then
      v_listed := v_listed || jsonb_build_object('object', d.object, 'key', d.key,
                                                 'change', d.change, 'rule', d.rule,
                                                 'detail', d.detail);
      continue;
    end if;

    if d.object = 'account' and d.change = 'missing' then
      insert into accounts (company_id, code, name, name_i18n, statement_hint, account_type, reconcilable)
      select p_company_id, t.code, label_for(t.name, t.name_i18n, preferred_languages(p_company_id)),
             t.name_i18n, t.statement_hint, t.account_type, t.reconcilable
        from account_templates t
       where t.country = v_country and t.chart_code = v_chart and t.code = d.key
      on conflict (company_id, code) do nothing;

    elsif d.object = 'account' and d.change = 'differs' then
      update accounts a
         set name = label_for(t.name, t.name_i18n, preferred_languages(p_company_id)),
             name_i18n = t.name_i18n,
             account_type = t.account_type
        from account_templates t
       where t.country = v_country and t.chart_code = v_chart and t.code = a.code
         and a.company_id = p_company_id and a.code = d.key;

    elsif d.object = 'journal' and d.change = 'missing' then
      insert into journals (company_id, code, name, journal_type)
      select p_company_id, t.code, t.name, t.journal_type
        from journal_templates t
       where t.country = v_country and t.code = d.key
      on conflict (company_id, code) do nothing;

    elsif d.object = 'journal' and d.change = 'differs' then
      update journals j
         set name = t.name, journal_type = t.journal_type
        from journal_templates t
       where t.country = v_country and t.code = j.code
         and j.company_id = p_company_id and j.code = d.key;

    elsif d.object = 'tax' and d.change = 'missing' then
      select * into v_template from tax_templates where country = v_country and code = d.key;
      insert into taxes (company_id, code, name, description, amount_type, amount,
                         applies_to, treatment, country, valid_from, valid_to,
                         legal_reference, vat_category, exemption_code, sequence,
                         tax_kind, recoverable, jurisdiction, price_include,
                         cash_basis, cash_basis_transition_account_id)
      values (p_company_id, v_template.code, v_template.name, v_template.description,
              v_template.amount_type, v_template.amount, v_template.applies_to,
              v_template.treatment, v_country, v_template.valid_from, v_template.valid_to,
              v_template.legal_reference, v_template.vat_category, v_template.exemption_code,
              v_template.sequence, v_template.tax_kind, v_template.recoverable,
              v_template.jurisdiction, v_template.price_include, v_template.cash_basis,
              account_id_by_code(p_company_id, v_template.cash_basis_transition_account_code))
      on conflict (company_id, code) do nothing
      returning id into v_tax_id;

      if v_tax_id is not null then
        insert into tax_postings (tax_id, company_id, document_kind, posting_type,
                                  factor_percent, account_id, declaration_box,
                                  box_factor_percent, report_code, sequence)
        select v_tax_id, p_company_id, tp.document_kind, tp.posting_type,
               tp.factor_percent, account_id_by_code(p_company_id, tp.account_code),
               tp.declaration_box, tp.box_factor_percent, tp.report_code, tp.sequence
          from tax_posting_templates tp
         where tp.tax_template_id = v_template.id
         order by tp.sequence;
      end if;

    elsif d.object = 'tax' and d.change = 'valid_to' then
      update taxes x
         set valid_to = t.valid_to
        from tax_templates t
       where t.country = v_country and t.code = x.code
         and x.company_id = p_company_id and x.code = d.key;

    elsif d.object = 'tax' and d.change = 'differs' then
      update taxes x
         set name = t.name, description = t.description, amount = t.amount,
             amount_type = t.amount_type, applies_to = t.applies_to,
             treatment = t.treatment, valid_from = t.valid_from,
             legal_reference = t.legal_reference, vat_category = t.vat_category,
             exemption_code = t.exemption_code, tax_kind = t.tax_kind,
             recoverable = t.recoverable, jurisdiction = t.jurisdiction,
             price_include = t.price_include, cash_basis = t.cash_basis
        from tax_templates t
       where t.country = v_country and t.code = x.code
         and x.company_id = p_company_id and x.code = d.key;

    elsif d.object = 'tax_posting' and d.change = 'differs' then
      select id into v_tax_id from taxes where company_id = p_company_id and code = d.key;
      delete from tax_postings where tax_id = v_tax_id;
      insert into tax_postings (tax_id, company_id, document_kind, posting_type,
                                factor_percent, account_id, declaration_box,
                                box_factor_percent, report_code, sequence)
      select v_tax_id, p_company_id, tp.document_kind, tp.posting_type,
             tp.factor_percent, account_id_by_code(p_company_id, tp.account_code),
             tp.declaration_box, tp.box_factor_percent, tp.report_code, tp.sequence
        from tax_posting_templates tp
        join tax_templates t on t.id = tp.tax_template_id
       where t.country = v_country and t.code = d.key
       order by tp.sequence;

    else
      -- A difference this function does not know how to apply is listed
      -- rather than guessed at. Raising here would make a new kind of
      -- difference break every upgrade.
      v_listed := v_listed || jsonb_build_object('object', d.object, 'key', d.key,
                                                 'change', d.change, 'rule', d.rule,
                                                 'detail', d.detail);
      continue;
    end if;

    v_applied := v_applied || jsonb_build_object('object', d.object, 'key', d.key,
                                                 'change', d.change, 'rule', d.rule,
                                                 'detail', d.detail);
  end loop;

  -- The version moves only when nothing is left waiting. A company that still
  -- holds a difference it has not decided on has not finished upgrading, and
  -- saying otherwise would hide the difference at the next run.
  if jsonb_array_length(v_listed) = 0 then
    update company_packs
       set version = v_to, upgraded_at = now()
     where company_id = p_company_id and country = v_country;
  end if;

  perform audit_record(
    p_company_id, 'company_packs', null, v_country, 'update', 'pack_upgraded',
    jsonb_build_object('version', v_from),
    jsonb_build_object('version', case when jsonb_array_length(v_listed) = 0 then v_to else v_from end,
                       'pack_version', v_to,
                       'chart_code', v_chart,
                       'applied', v_applied,
                       'listed', v_listed,
                       'never_applied', v_refused));

  return jsonb_build_object(
    'company_id', p_company_id,
    'country', v_country,
    'chart_code', v_chart,
    'from_version', v_from,
    'to_version', v_to,
    'version_moved', jsonb_array_length(v_listed) = 0,
    'applied', v_applied,
    'listed', v_listed,
    'never_applied', v_refused);
end;
$$;

comment on function pack_upgrade(uuid, char, boolean) is
  'Moves a company to the country pack version this installation holds: additions copied in, closed validities applied, everything else listed and left alone unless the caller asks for it. Records what it did in the audit trail. The recorded version moves only when nothing is left waiting.';

revoke execute on all functions in schema public from public;
