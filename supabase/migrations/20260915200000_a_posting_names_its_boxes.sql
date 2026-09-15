-- Ekwo OS — one posting, printed in as many boxes as the form asks for.
--
-- A tax carries one `base` posting per kind of document. That rule is right
-- and it stays: a taxable amount has one definition, and every further place
-- the form shows it is a `total` adding the boxes the postings already wrote.
-- What the rule could not express is a form that prints one amount in boxes
-- **no total can derive from one another**, and two of the packs in this
-- repository meet it:
--
--   Form KMD (Estonia) reports an intra-Community acquisition of goods in box
--       6.1, in box 6 around it and in box 1 around that. Box 6 is not the sum
--       of the boxes printed under it — the form prints only 6.1, and the rest
--       of 6 is services received, which the form never prints on its own — so
--       the pack had to invent a leaf box for the part nobody prints and total
--       the two. Six such boxes on a form of thirty.
--   The VAT Return (United Kingdom) asks for the value of a service received
--       from a supplier established abroad in box 6, which is outputs, and in
--       box 7, which is inputs. Neither box contains the other, and the pack
--       had to invent three leaf boxes on a form of nine.
--
-- Both are the same gap, recorded in `docs/international.md` under two names,
-- and both are closed here: a posting names **a list** of boxes, and
-- `vat_return()` sums it into each one.
--
-- **The shape is an array, not a table of its own.** `declaration_boxes
-- text[]` beside `declaration_box`, on the template and on the company's copy,
-- with the first of the list equal to the column. Three reasons, and
-- `docs/decisions.md` carries them at length: the return reads the list with
-- one `unnest` where a junction is a join and a second order to keep; a
-- posting has no identity of its own — `pack upgrade` already replaces every
-- posting of a tax as one fact — so the rows of a junction would carry a key
-- nothing names; and a junction is a table, which is a policy, a grant and an
-- inventory entry for a list that is almost always one element long.
--
-- **`declaration_box` stays and stays first.** It is what a posting is known
-- by, what `vat_return()` reads a line back on, and what every reader that
-- knows nothing of this change still sees. A check constraint holds the two
-- in step, and a trigger fills the list from the column for a writer that
-- knows only the column — so nothing that writes a posting today has to
-- change, and a pack that names one box compiles to exactly what it did.
--
-- **What does not change**: `evaluate_totals()`, which never knew a box from
-- a statement line; `post_document()`, because a posting still writes one
-- ledger line and that line still carries one box — the expansion belongs to
-- the return, not to the ledger; and `ec_sales_list()`, which reads treatments
-- and never a declaration box.

-- ---------------------------------------------------------------------------
-- The column, on the template and on the company's copy
-- ---------------------------------------------------------------------------

alter table tax_posting_templates
  add column if not exists declaration_boxes text[];

alter table tax_postings
  add column if not exists declaration_boxes text[];

update tax_posting_templates
   set declaration_boxes = array[declaration_box]
 where declaration_box is not null
   and declaration_boxes is null;

update tax_postings
   set declaration_boxes = array[declaration_box]
 where declaration_box is not null
   and declaration_boxes is null;

comment on column tax_posting_templates.declaration_boxes is
  'Every box this one amount is printed in, from packs/<cc>/taxes.json. Almost always the single box declaration_box names, which is the first of the list; several where the form prints one figure in boxes that are not sums of one another. A box that is a sum stays a total and is never named here.';

comment on column tax_postings.declaration_boxes is
  'Every box this one amount is printed in, copied from the template. The first is declaration_box, which is what the posting is known by; vat_return() sums the line into each box of the list.';

-- The two are one fact written twice, so they are held in step. The list may
-- not be empty, it starts at the box the posting is known by, and it is null
-- exactly where that box is — a posting that reports nowhere reports nowhere
-- in every column.
--
-- Duplicates inside the list are not refused here. `array[..] = array[..]`
-- cannot say it without a subquery, which a check constraint may not hold,
-- and a duplicate changes no figure — `unnest` would sum the same line into
-- the same box twice, which is a defect in the pack rather than in a row.
-- `ekwo pack check` refuses it at the one moment it is worth saying, which is
-- when somebody is writing the pack.

alter table tax_posting_templates
  add constraint tax_posting_templates_boxes_start_at_the_box check (
    case when declaration_box is null
         then declaration_boxes is null
         else declaration_boxes is not null
              and cardinality(declaration_boxes) >= 1
              and declaration_boxes[1] = declaration_box
    end
  );

alter table tax_postings
  add constraint tax_postings_boxes_start_at_the_box check (
    case when declaration_box is null
         then declaration_boxes is null
         else declaration_boxes is not null
              and cardinality(declaration_boxes) >= 1
              and declaration_boxes[1] = declaration_box
    end
  );

-- ---------------------------------------------------------------------------
-- A writer that knows one column is handed the other
-- ---------------------------------------------------------------------------
--
-- Everything that wrote a posting before this migration names `declaration_box`
-- and nothing else: the seeds of an older release, a company's own tax typed
-- into the application, a test fixture. Rather than make every one of them
-- learn a second column, the row fills the half it was not given.
--
-- "Not given" is read from what moved, never from what is null, and that is
-- the whole subtlety here. A writer that clears the box means the posting
-- reports nowhere, and a trigger that read `declaration_box is null` as "say
-- nothing" would put the box straight back from the list — which is a write
-- that does not take, the worst kind. So: the box moved and the list did not,
-- the list follows; the list moved and the box did not, the box follows; both
-- moved, the writer knows what it is doing and the check constraint judges it.

create or replace function tax_posting_boxes_agree()
returns trigger
language plpgsql
as $$
declare
  -- An insert is an update from a row where both were null, which is the same
  -- rule written once instead of twice.
  v_was_box    text   := case when tg_op = 'UPDATE' then old.declaration_box else null end;
  v_was_boxes  text[] := case when tg_op = 'UPDATE' then old.declaration_boxes else null end;
  v_box_moved  boolean := new.declaration_box is distinct from v_was_box;
  v_list_moved boolean := new.declaration_boxes is distinct from v_was_boxes;
begin
  if v_box_moved and not v_list_moved then
    new.declaration_boxes := case when new.declaration_box is null
                                  then null
                                  else array[new.declaration_box] end;
  elsif v_list_moved and not v_box_moved then
    new.declaration_box := case when new.declaration_boxes is null
                                  or cardinality(new.declaration_boxes) = 0
                                 then null
                                 else new.declaration_boxes[1] end;
  end if;
  return new;
end;
$$;

comment on function tax_posting_boxes_agree() is
  'Keeps declaration_box and declaration_boxes in step on a tax posting: a writer that moves one is handed the other. A writer that moves both is left alone and judged by the check constraint, and a writer that clears the box clears the list with it.';

create trigger tax_posting_templates_boxes_agree
  before insert or update on tax_posting_templates
  for each row execute function tax_posting_boxes_agree();

create trigger tax_postings_boxes_agree
  before insert or update on tax_postings
  for each row execute function tax_posting_boxes_agree();

-- A trigger function runs as the statement that fired it and is called by
-- nobody directly, so it is open to nobody.
revoke execute on function tax_posting_boxes_agree() from public, anon;

-- ---------------------------------------------------------------------------
-- Installing a pack copies the list
-- ---------------------------------------------------------------------------
--
-- Replaced whole rather than patched, because a function is replaced whole in
-- PostgreSQL. Everything but the insert into `tax_postings` is `20260914143915`
-- unchanged.

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
                              declaration_boxes, box_factor_percent, report_code,
                              sequence)
    select v_tax_id, p_company_id, tp.document_kind, tp.posting_type,
           tp.factor_percent, account_id_by_code(p_company_id, tp.account_code),
           tp.declaration_box, tp.declaration_boxes, tp.box_factor_percent,
           tp.report_code, tp.sequence
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
  'Copies one chart of a country pack into a company in one language, with the country''s journals and taxes, wires the default roles, pins the accounts it wired, and records the pack version and the chart in company_packs. A tax posting is copied with every declaration box it prints in.';

revoke execute on function install_country_template(uuid, char, char, text) from public, anon;
grant execute on function install_country_template(uuid, char, char, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The upgrade compares the list and carries it
-- ---------------------------------------------------------------------------
--
-- A tax that starts printing its base in a second box is a difference like any
-- other, and one a company has to be told about: without the list in the diff,
-- an upgrade would report "nothing to do" and the return would stay short by a
-- box. The postings of a tax are compared as one fact, so the list joins the
-- object the diff already builds. Everything else in both functions is
-- `20260914111907` and `20260914152840` unchanged.


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
                                        'declaration_boxes', to_jsonb(tp.declaration_boxes),
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
                                        'declaration_boxes', to_jsonb(p.declaration_boxes),
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
  'What separates a company from the country pack this installation now holds, by natural key, each difference carrying the rule that decides what an upgrade does with it. What a tax books is compared as one object, every declaration box of every posting included.';

revoke execute on function pack_upgrade_diff(uuid, char) from public, anon;
grant execute on function pack_upgrade_diff(uuid, char) to authenticated, service_role;


create or replace function pack_upgrade(
  p_company_id uuid,
  p_country    char(2) default null,
  p_apply      boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
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
                                  declaration_boxes, box_factor_percent, report_code,
                                  sequence)
        select v_tax_id, p_company_id, tp.document_kind, tp.posting_type,
               tp.factor_percent, account_id_by_code(p_company_id, tp.account_code),
               tp.declaration_box, tp.declaration_boxes, tp.box_factor_percent,
               tp.report_code, tp.sequence
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
                                declaration_boxes, box_factor_percent, report_code,
                                sequence)
      select v_tax_id, p_company_id, tp.document_kind, tp.posting_type,
             tp.factor_percent, account_id_by_code(p_company_id, tp.account_code),
             tp.declaration_box, tp.declaration_boxes, tp.box_factor_percent,
             tp.report_code, tp.sequence
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


revoke execute on function pack_upgrade(uuid, char, boolean) from public, anon;
grant execute on function pack_upgrade(uuid, char, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The return sums a line into every box its posting names
-- ---------------------------------------------------------------------------
--
-- One `unnest`, and the rest of `20260914163943` unchanged. The amount is the
-- same in each box: `box_factor_percent` is the share of the amount the form
-- expects, and a form that prints one figure in three places prints the same
-- figure in all three. A form that wants a fraction of it in one of them is
-- printing a different figure, which is a second posting or a total.
--
-- A parent that *is* a sum stays a total and is untouched: a posting that
-- named both a box and the total above it would be counted twice, which is
-- why `ekwo pack check` refuses a posting that names a total at all.


create or replace function vat_return(
  p_company_id  uuid,
  p_from        date,
  p_to          date,
  p_report_code text default null
)
returns table (
  box         text,
  kind        text,
  amount      numeric,
  computed    boolean,
  name        text,
  sequence    integer,
  hidden      boolean,
  report_code text
)
language plpgsql
stable
as $$
declare
  -- 'box|kind' -> amount, for every box summed from the ledger, then the
  -- totals `evaluate_totals()` derives from them. The key carries the kind
  -- because the French CA3 puts a base and a tax on line 08 and a formula has
  -- to be able to name one of them.
  v_values   jsonb := '{}'::jsonb;
  v_formulas jsonb := '[]'::jsonb;
  v_totals   jsonb := '{}'::jsonb;
  v_rows     jsonb := '[]'::jsonb;
  v_country  char(2);
  v_report   text;
  v_in       char(2);
  v_count    integer;
  v_codes    text;
  -- How often this company files, what the form accepts, and what the two
  -- dates asked for actually are.
  v_files    declaration_period;
  v_accepts  declaration_period[];
  v_asked    declaration_period;
  -- A declaration figure is not a ledger figure, but it is written in the
  -- same currency and with the same decimals.
  v_round    money_rounding;
  r          record;
begin
  select c.fiscal_country, c.vat_period into v_country, v_files
    from companies c where c.id = p_company_id;
  if not found then
    raise exception 'unknown_company: %', p_company_id;
  end if;
  v_round := rounding_of(p_company_id);

  -- Which form. The caller names one, or the country files exactly one on
  -- that date. Two and no name is a question only the caller can answer — a
  -- Canadian company files the federal return and the Québec one at once — so
  -- this asks instead of guessing.
  if p_report_code is not null then
    select t.country, t.code into v_in, v_report
      from tax_report_templates t
     where t.code = p_report_code
       and t.valid_from <= p_to
       and (t.valid_to is null or t.valid_to >= p_to)
     order by t.country
     limit 1;
    if v_report is null then
      raise exception 'unknown_tax_report: % is not a declaration form in force on %',
        p_report_code, p_to;
    end if;
  else
    select count(*), min(t.code), string_agg(t.code, ', ' order by t.code)
      into v_count, v_report, v_codes
      from tax_report_templates t
     where t.country = v_country
       and t.is_periodic_return
       and t.valid_from <= p_to
       and (t.valid_to is null or t.valid_to >= p_to);
    if v_count > 1 then
      raise exception 'ambiguous_tax_report: % files several declarations on % (%); name one',
        v_country, p_to, v_codes;
    end if;
    v_in := v_country;
    if v_count = 0 then
      v_report := null;  -- no pack for this country: the ledger boxes, and no total.
    end if;
  end if;

  -- The period asked for against the one this company files on. Four things
  -- have to hold before this refuses, and the fourth is what keeps it out of
  -- everybody's way: the company has recorded a cadence, the form is one it
  -- files on that cadence, the dates are themselves a whole cadence of that
  -- form, and the two are not the same. A fortnight, a half-year, the annual
  -- recapitulative form a quarterly filer also files — none of those is a
  -- filing on the wrong cadence, and none of them is refused.
  if v_files is not null and v_report is not null then
    select t.periods into v_accepts
      from tax_report_templates t
     where t.country = v_in and t.code = v_report;
    v_asked := declaration_period_of(p_from, p_to);
    if v_asked is not null
       and v_files = any(v_accepts)
       and v_asked = any(v_accepts)
       and v_asked <> v_files then
      raise exception
        'wrong_declaration_period: this company files % returns on %; % to % is a %',
        v_files, v_report, p_from, p_to, v_asked;
    end if;
  end if;

  -- 1. What the tax postings wrote on the ledger, in every box each of them
  --    names. A line carries the box it is known by; the posting behind it
  --    carries the whole list, which is one box for all but the handful of
  --    forms that print a figure twice. No country rule here either: the
  --    expansion is `unnest`, and which boxes there are is the pack's answer.
  for r in
    with lines as (
      select l.declaration_box as lbox,
             case when l.tax_line then 'tax' else 'base' end as lkind,
             l.tax_id as ltax,
             l.box_amount as lamount
        from entry_lines l
        join entries e on e.id = l.entry_id
       where l.company_id = p_company_id
         and e.state = 'posted'
         and e.entry_date between p_from and p_to
         and l.declaration_box is not null
    ),
    -- The posting that wrote the line: which form it is on, and every box it
    -- prints in. A line with no posting behind it — an entry keyed by hand,
    -- a tax a company wrote itself — is on this form and in the one box it
    -- names, which is what the left join leaves.
    sourced as (
      select ln.lbox, ln.lkind, ln.lamount,
             coalesce(p.boxes, array[ln.lbox]) as lboxes
        from lines ln
        left join lateral (
          select min(tp.report_code) as report_code,
                 array_agg(distinct b.box) as boxes
            from tax_postings tp
            cross join lateral unnest(tp.declaration_boxes) as b(box)
           where tp.tax_id = ln.ltax
             and tp.declaration_box = ln.lbox
             and tp.posting_type = ln.lkind::tax_posting_type
        ) p on true
       -- A box number belongs to one form. A line whose posting names
       -- another form is not on this declaration; one that names none is
       -- the single-return case every European company is in.
       where v_report is null or coalesce(p.report_code, v_report) = v_report
    ),
    ledger as (
      select x.box as lbox, s.lkind,
             round_amount(sum(s.lamount), v_round) as lamount
        from sourced s
        cross join lateral unnest(s.lboxes) as x(box)
       group by 1, 2
      having round_amount(sum(s.lamount), v_round) <> 0
    )
    select g.lbox, g.lkind, g.lamount, b.name as lname,
           b.sequence as lsequence, coalesce(b.hidden, false) as lhidden
      from ledger g
      left join tax_report_box_templates b
        on b.country = v_in and b.report_code = v_report
       and b.box = g.lbox and b.kind = g.lkind
     order by coalesce(b.sequence, 2147483647), g.lbox, g.lkind
  loop
    v_values := v_values || jsonb_build_object(r.lbox || '|' || r.lkind, r.lamount);
    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'box', r.lbox, 'kind', r.lkind, 'amount', r.lamount, 'computed', false,
      'name', r.lname, 'sequence', r.lsequence, 'hidden', r.lhidden,
      'report_code', v_report));
  end loop;

  -- 2. The totals of the form, through the evaluator the statements use. A
  --    return prints what it has, so a nil total is left out of the answer —
  --    and kept in the working set, so a later total that names it reads a
  --    zero rather than a gap.
  if v_report is not null then
    select coalesce(jsonb_agg(jsonb_build_object(
             'key', b.box || '|total', 'plus', to_jsonb(b.plus_boxes),
             'minus', to_jsonb(b.minus_boxes), 'floor_zero', b.floor_zero,
             'sequence', b.sequence
           ) order by b.sequence, b.box), '[]'::jsonb)
      into v_formulas
      from tax_report_box_templates b
     where b.country = v_in
       and b.report_code = v_report
       and b.kind = 'total'
       and (b.valid_from is null or b.valid_from <= p_to)
       and (b.valid_to is null or b.valid_to >= p_to);

    v_totals := evaluate_totals(v_values, v_formulas, v_round, false);

    for r in
      select b.box as tbox, b.name as tname, b.sequence as tsequence, b.hidden as thidden
        from tax_report_box_templates b
       where b.country = v_in
         and b.report_code = v_report
         and b.kind = 'total'
         and (b.valid_from is null or b.valid_from <= p_to)
         and (b.valid_to is null or b.valid_to >= p_to)
         and v_totals ? (b.box || '|total')
       order by b.sequence, b.box
    loop
      v_rows := v_rows || jsonb_build_array(jsonb_build_object(
        'box', r.tbox, 'kind', 'total',
        'amount', (v_totals ->> (r.tbox || '|total'))::numeric, 'computed', true,
        'name', r.tname, 'sequence', r.tsequence, 'hidden', r.thidden,
        'report_code', v_report));
    end loop;
  end if;

  return query
  select (x ->> 'box')::text,
         (x ->> 'kind')::text,
         (x ->> 'amount')::numeric,
         (x ->> 'computed')::boolean,
         (x ->> 'name')::text,
         (x ->> 'sequence')::integer,
         (x ->> 'hidden')::boolean,
         (x ->> 'report_code')::text
    from jsonb_array_elements(v_rows) as x;
end;
$$;


comment on function vat_return(uuid, date, date, text) is
  'Declaration boxes for a period: summed from the ledger into every box the posting behind each line names, then the totals of the country''s form worked out by evaluate_totals(), the same evaluator financial_statement() uses. Refuses a period the company does not file on, when it has recorded one. No country rule lives in this function.';

revoke execute on function vat_return(uuid, date, date, text) from public, anon;
grant execute on function vat_return(uuid, date, date, text) to authenticated, service_role;
