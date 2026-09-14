-- Ekwo OS (assets) — a depreciation is written at the decimals of the
-- company's currency, like every other amount.
--
-- The module rounded to the cent in nine places: the cost and the residual
-- value of an asset, the annuity of both methods, the declining cap, the
-- monthly share of a yearly annuity, the proceeds of a disposal, and the two
-- readings. Two decimals is what the euro has; a company keeping its books in
-- yen would have had a schedule that never summed to the cost, because the
-- last line takes the remainder and the remainder was in a decimal the
-- currency does not have.
--
-- Every one of them now asks `public.rounding_of(company)` once and passes the
-- answer to `public.round_amount`. The rule that made the schedule tie out is
-- unchanged — everything is rounded as it goes and the last line takes what is
-- left — it simply ties out in the currency's own unit now.


create or replace function assets.create_asset(
  p_company_id       uuid,
  p_code             text,
  p_name             text,
  p_acquisition_date date,
  p_cost             numeric,
  p_asset_account    text,
  p_depreciation_account text,
  p_expense_account  text,
  p_category_code    text default null,
  p_duration_months  integer default null,
  p_method           assets.depreciation_method default null,
  p_coefficient      numeric default null,
  p_residual_value   numeric default 0,
  p_in_service_date  date default null,
  p_document_line_id uuid default null,
  p_contact_id       uuid default null,
  p_description      text default null
)
returns uuid
language plpgsql
as $$
declare
  v_country  char(2);
  v_category assets.category_templates%rowtype;
  v_method   assets.depreciation_method;
  v_duration integer;
  v_coef     numeric(7, 3);
  v_id       uuid;
  v_asset    uuid;
  v_deprec   uuid;
  v_round    public.money_rounding;
  v_expense  uuid;
begin
  if not public.module_is_enabled(p_company_id, 'assets') then
    raise exception 'module_not_enabled: assets is not enabled on this company'
      using errcode = '55006';
  end if;

  select country into v_country from public.companies where id = p_company_id;
  if v_country is null then
    raise exception 'unknown_company: %', p_company_id;
  end if;

  if p_category_code is not null then
    select * into v_category
      from assets.category_templates
     where country = v_country and code = p_category_code;
    if not found then
      raise exception 'unknown_asset_category: % is not a category of the % pack', p_category_code, v_country;
    end if;
  end if;

  -- The category is a suggestion, so anything the caller gave wins over it.
  -- Same rule as a product pre-filling a document line.
  v_method   := coalesce(p_method, v_category.method, 'straight_line');
  v_duration := coalesce(p_duration_months, v_category.duration_months);
  v_coef     := coalesce(p_coefficient, v_category.coefficient);

  if v_duration is null then
    raise exception 'no_duration: name a duration in months, or a category of the % pack that carries one', v_country;
  end if;

  v_round   := public.rounding_of(p_company_id);
  v_asset   := public.account_id_by_code(p_company_id, p_asset_account);
  v_deprec  := public.account_id_by_code(p_company_id, p_depreciation_account);
  v_expense := public.account_id_by_code(p_company_id, p_expense_account);
  if v_asset is null then
    raise exception 'unknown_account: % is not an account of this company', p_asset_account;
  end if;
  if v_deprec is null then
    raise exception 'unknown_account: % is not an account of this company', p_depreciation_account;
  end if;
  if v_expense is null then
    raise exception 'unknown_account: % is not an account of this company', p_expense_account;
  end if;

  insert into assets.assets (
    company_id, code, name, description, category_code, document_line_id, contact_id,
    acquisition_date, in_service_date, cost, residual_value, method, duration_months,
    coefficient, prorata, asset_account_id, depreciation_account_id, expense_account_id, state
  )
  values (
    p_company_id, p_code, p_name, p_description, p_category_code, p_document_line_id, p_contact_id,
    p_acquisition_date, p_in_service_date,
    public.round_amount(p_cost, v_round),
    public.round_amount(coalesce(p_residual_value, 0), v_round),
    v_method, v_duration, v_coef, v_category.prorata, v_asset, v_deprec, v_expense, 'active'
  )
  returning id into v_id;

  perform assets.generate_schedule(v_id);
  return v_id;
end;
$$;

create or replace function assets.generate_schedule(p_asset_id uuid)
returns integer
language plpgsql
as $$
declare
  v_asset    assets.assets%rowtype;
  v_rules    assets.country_rules%rowtype;
  v_prorata  assets.prorata_rule;
  v_start    date;
  v_year     public.fiscal_years%rowtype;
  v_base     numeric;
  v_rate     numeric;
  v_period_start date;
  v_period_end   date;
  v_fraction numeric;
  v_amount   numeric;
  v_linear   numeric;
  v_cap      numeric;
  v_accum    numeric := 0;
  -- A schedule is a ledger figure, so each annuity is written at the decimals
  -- of the currency the company keeps its books in.
  v_round    public.money_rounding;
  v_sequence integer := 0;
  v_periods  integer;
  v_left     integer;
  v_guard    integer := 0;
begin
  select * into v_asset from assets.assets where id = p_asset_id;
  if not found then
    raise exception 'unknown_asset: %', p_asset_id;
  end if;
  if v_asset.state = 'disposed' then
    raise exception 'asset_disposed: % has left the books', v_asset.code;
  end if;
  if v_asset.method = 'units_of_production' then
    raise exception 'units_of_production_unsupported: a schedule by output needs the units of each period, which this module does not record. Name a duration and a straight line, or keep the schedule outside Ekwo.';
  end if;

  -- A schedule is generated once. Once a line has been booked, the schedule is
  -- what the ledger says happened, and regenerating it would leave the two
  -- disagreeing without anything looking wrong — which is the failure the
  -- column `posted_at` exists to make visible.
  if exists (select 1 from assets.depreciation_lines l
              where l.asset_id = p_asset_id and l.posted_at is not null) then
    raise exception 'schedule_already_posted: % has depreciation already booked; a schedule is not rewritten under the ledger', v_asset.code
      using errcode = '55006';
  end if;
  delete from assets.depreciation_lines where asset_id = p_asset_id;

  v_round := public.rounding_of(v_asset.company_id);
  v_start := coalesce(v_asset.in_service_date, v_asset.acquisition_date);
  v_base  := v_asset.cost - v_asset.residual_value;

  v_rules := assets.rules(v_asset.company_id);
  v_prorata := coalesce(
    v_asset.prorata,
    case when v_asset.method = 'declining_balance' then v_rules.prorata_declining
         else v_rules.prorata_straight_line end);
  if v_prorata is null then
    raise exception 'no_assets_country_rules: the pack of this company''s country says nothing about how a first period is prorated. Add an assets section to the pack, or set assets.prorata on this asset.'
      using errcode = '55006';
  end if;

  select * into v_year
    from public.fiscal_years f
   where f.company_id = v_asset.company_id
     and v_start between f.start_date and f.end_date
   limit 1;
  if not found then
    raise exception 'no_fiscal_year: % entered service on %, which falls in no financial year of this company', v_asset.code, v_start;
  end if;

  v_period_start := v_year.start_date;
  v_rate := 12::numeric / v_asset.duration_months;
  -- How many annuities the duration is worth. A declining balance measures
  -- what is left to run in periods and not in days, because that is what the
  -- rule it comes from says: at the start of the second year of a five-year
  -- asset, four annuities remain, whatever day of the first year it was
  -- bought on.
  v_periods := ceil(v_asset.duration_months / 12.0)::integer;
  if v_rules.declining_cap_percent is not null then
    v_cap := public.round_amount(v_asset.cost * v_rules.declining_cap_percent / 100, v_round);
  end if;

  while v_accum < v_base loop
    v_guard := v_guard + 1;
    if v_guard > 1200 then
      raise exception 'schedule_runaway: % produced more than 1200 periods; check its duration and its coefficient', v_asset.code;
    end if;

    v_period_end := assets.period_end_for(v_asset.company_id, v_period_start);
    v_fraction := assets.prorata_fraction(v_prorata, v_rules.day_count, v_start, v_period_start, v_period_end);

    if v_asset.method = 'declining_balance' then
      v_amount := public.round_amount(
        (v_base - v_accum) * v_rate * v_asset.coefficient * v_fraction, v_round);
      if v_cap is not null then
        v_amount := least(v_amount, public.round_amount(v_cap * v_fraction, v_round));
      end if;
      -- The straight line over what is left to run. A declining balance is a
      -- front-loaded schedule that never reaches zero on its own, and the
      -- switch is what makes it end on the last period rather than never.
      -- The last period is `v_left = 1`, where the straight line is the whole
      -- remaining value.
      v_left := greatest(1, v_periods - v_sequence);
      if coalesce(v_rules.declining_switch_to_linear, true) then
        v_linear := public.round_amount((v_base - v_accum) / v_left * v_fraction, v_round);
        v_amount := greatest(v_amount, v_linear);
      end if;
    else
      v_amount := public.round_amount(v_base * v_rate * v_fraction, v_round);
    end if;

    if v_amount <= 0 then
      v_amount := v_base - v_accum;
    end if;
    -- The last period takes the remainder, whatever the rounding did on the
    -- way. This is the line that makes the schedule sum to the cent.
    if v_accum + v_amount > v_base then
      v_amount := v_base - v_accum;
    end if;

    v_accum := v_accum + v_amount;
    v_sequence := v_sequence + 1;

    insert into assets.depreciation_lines
      (asset_id, company_id, sequence, period_start, period_end, amount, accumulated, net_book_value)
    values (p_asset_id, v_asset.company_id, v_sequence, v_period_start, v_period_end,
            v_amount, v_accum, v_asset.cost - v_accum);

    v_period_start := v_period_end + 1;
  end loop;

  if assets.period_is_monthly(v_asset.company_id) then
    perform assets.split_into_months(p_asset_id);
  end if;

  update assets.assets
     set state = case when state = 'draft' then 'active' else state end
   where id = p_asset_id;

  return (select count(*)::integer from assets.depreciation_lines where asset_id = p_asset_id);
end;
$$;

create or replace function assets.split_into_months(p_asset_id uuid)
returns integer
language plpgsql
as $$
declare
  v_line     assets.depreciation_lines%rowtype;
  v_asset    assets.assets%rowtype;
  v_months   integer;
  v_start    date;
  v_end      date;
  v_share    numeric;
  v_done     numeric;
  v_accum    numeric := 0;
  v_round    public.money_rounding;
  v_sequence integer := 0;
  v_index    integer;
  v_new      jsonb := '[]'::jsonb;
begin
  select * into v_asset from assets.assets where id = p_asset_id;
  v_round := public.rounding_of(v_asset.company_id);

  for v_line in
    select * from assets.depreciation_lines where asset_id = p_asset_id order by sequence
  loop
    v_months := assets.months_inclusive(v_line.period_start, v_line.period_end);
    v_done := 0;
    for v_index in 1 .. v_months loop
      v_start := (date_trunc('month', v_line.period_start) + make_interval(months => v_index - 1))::date;
      v_end := (date_trunc('month', v_start) + interval '1 month' - interval '1 day')::date;
      if v_index = 1 then v_start := v_line.period_start; end if;
      if v_index = v_months then v_end := v_line.period_end; end if;

      v_share := case when v_index = v_months
                      then v_line.amount - v_done
                      else public.round_amount(v_line.amount / v_months, v_round) end;
      v_done := v_done + v_share;
      if v_share = 0 then continue; end if;

      v_accum := v_accum + v_share;
      v_sequence := v_sequence + 1;
      v_new := v_new || jsonb_build_object(
        'sequence', v_sequence, 'period_start', v_start, 'period_end', v_end,
        'amount', v_share, 'accumulated', v_accum,
        'net_book_value', v_asset.cost - v_accum);
    end loop;
  end loop;

  delete from assets.depreciation_lines where asset_id = p_asset_id;
  insert into assets.depreciation_lines
    (asset_id, company_id, sequence, period_start, period_end, amount, accumulated, net_book_value)
  select p_asset_id, v_asset.company_id,
         (row ->> 'sequence')::integer, (row ->> 'period_start')::date, (row ->> 'period_end')::date,
         (row ->> 'amount')::numeric, (row ->> 'accumulated')::numeric, (row ->> 'net_book_value')::numeric
    from jsonb_array_elements(v_new) as row;

  return v_sequence;
end;
$$;

create or replace function assets.dispose_asset(
  p_asset_id     uuid,
  p_date         date,
  p_proceeds     numeric default 0,
  p_counterpart_account text default null,
  p_contact_id   uuid default null
)
returns uuid
language plpgsql
as $$
declare
  v_asset     assets.assets%rowtype;
  v_rules     assets.country_rules%rowtype;
  v_defaults  public.country_defaults%rowtype;
  v_country   char(2);
  v_accum     numeric;
  v_nbv       numeric;
  v_result    numeric;
  v_round     public.money_rounding;
  v_proceeds  numeric;
  v_counter   uuid;
  v_account   uuid;
  v_lines     jsonb := '[]'::jsonb;
  v_entry     uuid;
begin
  select * into v_asset from assets.assets where id = p_asset_id for update;
  if not found then
    raise exception 'unknown_asset: %', p_asset_id;
  end if;
  if v_asset.state = 'disposed' then
    raise exception 'asset_disposed: % has already left the books', v_asset.code;
  end if;
  if p_date < coalesce(v_asset.in_service_date, v_asset.acquisition_date) then
    raise exception 'disposal_before_service: % cannot leave the books before it entered them', v_asset.code;
  end if;

  -- Everything the schedule planned for a period that has already ended has to
  -- be booked before the asset goes: a disposal reads the accumulated
  -- depreciation off the ledger, and a period left unbooked would make it read
  -- a figure the accounts do not carry.
  if exists (select 1 from assets.depreciation_lines l
              where l.asset_id = p_asset_id and l.posted_at is null and l.period_end < p_date) then
    raise exception 'depreciation_pending: run assets.run_depreciation(company, %) before disposing of %',
      p_date, v_asset.code
      using errcode = '55006';
  end if;

  select country into v_country from public.companies where id = v_asset.company_id;
  v_round    := public.rounding_of(v_asset.company_id);
  v_proceeds := public.round_amount(coalesce(p_proceeds, 0), v_round);
  v_rules := assets.rules(v_asset.company_id);
  if v_rules.disposal_style is null then
    raise exception 'no_disposal_style: the pack of % says nothing about how an asset leaves the books. Set assets.disposal, and the roles it needs, in the pack.', v_country
      using errcode = '55006';
  end if;
  select * into v_defaults from public.country_defaults where country = v_country;

  select coalesce(sum(l.amount), 0) into v_accum
    from assets.depreciation_lines l
   where l.asset_id = p_asset_id and l.posted_at is not null;
  v_nbv := v_asset.cost - v_accum;
  v_result := v_proceeds - v_nbv;

  -- What the schedule still planned never happened. Deleting only the unposted
  -- lines keeps everything the ledger knows about.
  delete from assets.depreciation_lines
   where asset_id = p_asset_id and posted_at is null;

  -- 1. The asset leaves, and its accumulated depreciation with it.
  if v_accum > 0 then
    v_lines := v_lines || jsonb_build_object(
      'account_id', v_asset.depreciation_account_id,
      'label', v_asset.code || ' — accumulated depreciation', 'debit', v_accum);
  end if;
  v_lines := v_lines || jsonb_build_object(
    'account_id', v_asset.asset_account_id,
    'label', v_asset.code || ' — ' || v_asset.name, 'credit', v_asset.cost);

  -- 2. What the buyer owes, if anything.
  if v_proceeds > 0 then
    v_counter := case
      when p_counterpart_account is not null
        then public.account_id_by_code(v_asset.company_id, p_counterpart_account)
      else (select receivable_account_id from public.companies where id = v_asset.company_id)
    end;
    if v_counter is null then
      raise exception 'no_counterpart_account: name the account the proceeds of % land on', v_asset.code;
    end if;
    v_lines := v_lines || jsonb_build_object(
      'account_id', v_counter, 'label', v_asset.code || ' — proceeds',
      'debit', v_proceeds, 'contact_id', p_contact_id);
  end if;

  -- 3. The result, the way the country presents it.
  if v_rules.disposal_style = 'gross' then
    -- The net book value is a charge and the proceeds an income, both in full.
    -- The two lines above already cleared the asset and its depreciation, so
    -- what is left to write is the charge; the proceeds line of the income
    -- account replaces nothing, it is the other half of the same presentation.
    v_account := public.account_id_by_code(v_asset.company_id, v_defaults.asset_disposal_value_code);
    if v_account is null then
      raise exception 'no_asset_disposal_value_account: % files a gross disposal and its pack names no account for the value of what was sold', v_country;
    end if;
    if v_nbv > 0 then
      v_lines := v_lines || jsonb_build_object(
        'account_id', v_account, 'label', v_asset.code || ' — net book value sold',
        'debit', v_nbv);
    end if;
    if v_proceeds > 0 then
      v_account := public.account_id_by_code(v_asset.company_id, v_defaults.asset_disposal_proceeds_code);
      if v_account is null then
        raise exception 'no_asset_disposal_proceeds_account: % files a gross disposal and its pack names no account for the proceeds', v_country;
      end if;
      v_lines := v_lines || jsonb_build_object(
        'account_id', v_account, 'label', v_asset.code || ' — proceeds of disposal',
        'credit', v_proceeds);
    end if;
    -- The two proceeds lines are the two halves of one movement and not a
    -- double count: the buyer is debited above, the income account is credited
    -- here. What the gross style adds to the net-result one is the charge, and
    -- an income statement that prints both is what France asks for.
  elsif v_result <> 0 then
    v_account := public.account_id_by_code(
      v_asset.company_id,
      case when v_result > 0 then v_defaults.asset_disposal_gain_code
           else coalesce(v_defaults.asset_disposal_loss_code, v_defaults.asset_disposal_gain_code) end);
    if v_account is null then
      raise exception 'no_asset_disposal_account: the pack of % names no account for a % on the disposal of a fixed asset',
        v_country, case when v_result > 0 then 'gain' else 'loss' end;
    end if;
    v_lines := v_lines || jsonb_build_object(
      'account_id', v_account,
      'label', v_asset.code || ' — ' || case when v_result > 0 then 'gain' else 'loss' end || ' on disposal',
      'debit', case when v_result < 0 then -v_result else 0 end,
      'credit', case when v_result > 0 then v_result else 0 end);
  end if;

  v_entry := public.post_module_entry(
    v_asset.company_id, 'assets', 'disposal:' || v_asset.code, p_date,
    'Disposal of ' || v_asset.code || ' — ' || v_asset.name, v_lines);

  insert into assets.disposals
    (asset_id, company_id, disposal_date, proceeds, counterpart_account_id, contact_id,
     cost, accumulated, net_book_value, result, entry_id)
  values (p_asset_id, v_asset.company_id, p_date, v_proceeds, v_counter, p_contact_id,
          v_asset.cost, v_accum, v_nbv, v_result, v_entry);

  update assets.assets set state = 'disposed' where id = p_asset_id;
  return v_entry;
end;
$$;

create or replace function assets.register(p_company_id uuid, p_at date)
returns table (
  code            text,
  name            text,
  category_code   text,
  acquisition_date date,
  cost            numeric,
  accumulated     numeric,
  net_book_value  numeric,
  state           text
)
language sql
stable
as $$
  select a.code,
         a.name,
         a.category_code,
         a.acquisition_date,
         a.cost,
         public.round_amount(coalesce(d.accumulated, 0), public.rounding_of(p_company_id)),
         public.round_amount(a.cost - coalesce(d.accumulated, 0), public.rounding_of(p_company_id)),
         a.state::text
    from assets.assets a
    left join lateral (
      select coalesce(sum(l.amount), 0) as accumulated
        from assets.depreciation_lines l
       where l.asset_id = a.id and l.posted_at is not null and l.period_end <= p_at
    ) d on true
   where a.company_id = p_company_id
     and a.acquisition_date <= p_at
     and not exists (
       select 1 from assets.disposals x
        where x.asset_id = a.id and x.disposal_date <= p_at
     )
   order by a.code;
$$;

create or replace function assets.movements(p_company_id uuid, p_from date, p_to date)
returns table (
  code                text,
  name                text,
  opening_cost        numeric,
  additions           numeric,
  disposals_cost      numeric,
  closing_cost        numeric,
  opening_accumulated numeric,
  depreciation        numeric,
  disposals_accumulated numeric,
  closing_accumulated numeric,
  net_book_value      numeric
)
language sql
stable
as $$
  with movement as (
    select a.id, a.code, a.name, a.cost,
           a.acquisition_date < p_from as held_before,
           a.acquisition_date between p_from and p_to as added,
           x.disposal_date, x.accumulated as disposed_accumulated,
           coalesce((select sum(l.amount) from assets.depreciation_lines l
                      where l.asset_id = a.id and l.posted_at is not null
                        and l.period_end < p_from), 0) as accum_before,
           coalesce((select sum(l.amount) from assets.depreciation_lines l
                      where l.asset_id = a.id and l.posted_at is not null
                        and l.period_end between p_from and p_to), 0) as accum_period
      from assets.assets a
      left join assets.disposals x on x.asset_id = a.id
     where a.company_id = p_company_id
       and a.acquisition_date <= p_to
  )
  select m.code, m.name,
         public.round_amount(case when m.held_before then m.cost else 0 end, r.rounding),
         public.round_amount(case when m.added then m.cost else 0 end, r.rounding),
         public.round_amount(case when m.disposal_date between p_from and p_to
                                  then m.cost else 0 end, r.rounding),
         public.round_amount(case when m.disposal_date is not null and m.disposal_date <= p_to
                                  then 0 else m.cost end, r.rounding),
         public.round_amount(m.accum_before, r.rounding),
         public.round_amount(m.accum_period, r.rounding),
         public.round_amount(case when m.disposal_date between p_from and p_to
                                  then coalesce(m.disposed_accumulated, 0) else 0 end, r.rounding),
         public.round_amount(case when m.disposal_date is not null and m.disposal_date <= p_to
                                  then 0 else m.accum_before + m.accum_period end, r.rounding),
         public.round_amount(case when m.disposal_date is not null and m.disposal_date <= p_to
                                  then 0 else m.cost - m.accum_before - m.accum_period end, r.rounding)
    from movement m
    cross join (select public.rounding_of(p_company_id) as rounding) r
   order by m.code;
$$;

comment on function assets.generate_schedule(uuid) is
  'Writes the depreciation schedule of an asset, period by period, rounded at the decimals of the company''s currency with the last line taking the remainder. Refuses to rewrite a schedule whose lines are already booked.';


revoke execute on all functions in schema assets from public;
