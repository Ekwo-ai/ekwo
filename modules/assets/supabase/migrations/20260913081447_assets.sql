-- Ekwo — the `assets` module: fixed assets, their depreciation and their disposal.
--
-- One schema, its own row level security, and not a line of the socle changed.
-- It depends on `public` by foreign key — companies, accounts, contacts,
-- products, document lines — and it reaches the ledger only through
-- `public.post_module_entry()`, which builds the draft and calls
-- `post_entry()`. The words `entries` and `entry_lines` do not appear in a
-- statement of this file, and a test over `modules/**` proves it.
--
-- **The engine knows no country.** What a country decides is data, in
-- `packs/<cc>/assets.json`, compiled into the two reference tables below:
-- `assets.country_rules` says how that country takes a prorata, whether its
-- declining balance is capped and how it derecognises an asset;
-- `assets.category_templates` says the usual duration and coefficient of a
-- kind of asset. Neither is copied into a company — a usual duration admitted
-- by an administration is not something an operator redefines, any more than a
-- box of a VAT return is — and an asset that departs from one says so in its
-- own columns, which is what makes the templates a suggestion rather than a
-- rule.
--
-- **The accounts a disposal lands on are roles of the chart**, named by
-- `defaults.roles` in the pack and read from `public.country_defaults`. A pack
-- that has not named them makes a disposal refuse, by name.
--
-- **Rounding.** Every amount is rounded to the cent as it is computed and the
-- last line of a schedule takes the remainder, so the schedule sums to exactly
-- `cost - residual_value` whatever happened on the way. That makes the
-- country's `rounding_method` — which is about sharing out a tax — beside the
-- point here, and there is deliberately no second rounding parameter for
-- depreciation: one calculation, one rule, and the proof is a test that sums
-- every line of every golden schedule.

create schema assets;

comment on schema assets is
  'Ekwo module `assets`: fixed assets, depreciation schedules and disposals. Posts to the ledger only through public.post_module_entry().';

-- ---------------------------------------------------------------------------
-- Vocabulary
-- ---------------------------------------------------------------------------

create type assets.depreciation_method as enum (
  'straight_line',
  'declining_balance',
  'units_of_production'
);

comment on type assets.depreciation_method is
  'How an annuity is worked out. units_of_production is in the enum and refused by generate_schedule(): a schedule by output needs the units of each period, which this module does not record — refusing is what post_document does with a fixed-amount tax rather than guessing.';

create type assets.asset_state as enum ('draft', 'active', 'disposed', 'fully_depreciated');

create type assets.prorata_rule as enum ('none', 'days', 'months');

comment on type assets.prorata_rule is
  'How much of the first period an asset is depreciated over. none: the whole annuity whatever the date. days: from the day it entered service. months: from the first day of the month it entered service, which is what a French declining balance does.';

create type assets.day_count as enum ('actual', 'thirty_360');

comment on type assets.day_count is
  'Which calendar a prorata in days counts on: the real one, or the commercial year of twelve thirty-day months.';

create type assets.disposal_style as enum ('net_result', 'gross');

comment on type assets.disposal_style is
  'How a country derecognises an asset. net_result: the difference between the proceeds and the net book value lands on one account, a gain or a loss (Belgium 763/663). gross: the net book value is a charge and the proceeds an income, both in full, and the income statement prints the two (France 675/775). Named after the mechanism, never after a country.';

-- ---------------------------------------------------------------------------
-- What a country says
-- ---------------------------------------------------------------------------

create table assets.country_rules (
  country                    char(2) primary key,
  prorata_straight_line      assets.prorata_rule not null,
  prorata_declining          assets.prorata_rule not null,
  day_count                  assets.day_count not null default 'actual',
  declining_cap_percent      numeric(7, 3),
  declining_switch_to_linear boolean not null default true,
  disposal_style             assets.disposal_style,
  legal_reference            text,
  constraint assets_country_rules_country_format check (country ~ '^[A-Z]{2}$'),
  constraint assets_country_rules_cap check (
    declining_cap_percent is null or (declining_cap_percent > 0 and declining_cap_percent <= 100)
  )
);

comment on table assets.country_rules is
  'How one country depreciates and derecognises. Filled by `ekwo pack build` from packs/<cc>/assets.json, read where it stands, never copied into a company.';
comment on column assets.country_rules.declining_cap_percent is
  'Largest annuity a declining balance may take in one period, as a percentage of the acquisition value. Null where the country caps nothing.';
comment on column assets.country_rules.declining_switch_to_linear is
  'Whether the declining balance switches to the straight line over the remaining periods once that gives the larger annuity. True everywhere the declining balance is a tax incentive rather than a valuation method.';

create table assets.category_templates (
  country         char(2) not null,
  code            text not null,
  name            text not null,
  name_i18n       jsonb not null default '{}'::jsonb,
  method          assets.depreciation_method not null,
  duration_months integer not null,
  coefficient     numeric(7, 3),
  prorata         assets.prorata_rule,
  account_type    account_type,
  sequence        integer not null default 10,
  legal_reference text,
  primary key (country, code),
  constraint assets_category_duration check (duration_months > 0),
  constraint assets_category_coefficient check (
    method <> 'declining_balance' or coefficient is not null
  )
);

comment on table assets.category_templates is
  'The usual duration and method of a kind of asset in one country, with the source it comes from. A suggestion an asset may depart from, which is why it is never copied into a company.';
comment on column assets.category_templates.prorata is
  'Overrides the country rule for this category. Null is the ordinary case: the rule of the country, for the method this category uses.';
comment on column assets.category_templates.account_type is
  'Which of the eighteen account types the asset account of this category is, so a client can propose the accounts of a chart it has never seen. Advisory: nothing resolves an account from it.';

-- ---------------------------------------------------------------------------
-- The asset
-- ---------------------------------------------------------------------------

create table assets.assets (
  id                      uuid primary key default gen_random_uuid(),
  company_id              uuid not null references public.companies(id) on delete cascade,
  code                    text not null,
  name                    text not null,
  description             text,
  category_code           text,
  -- Where it came from. All three are optional: an asset taken over from a
  -- previous system has no invoice line in this database.
  document_line_id        uuid references public.document_lines(id) on delete set null,
  contact_id              uuid references public.contacts(id) on delete set null,
  product_id              uuid references public.products(id) on delete set null,
  acquisition_date        date not null,
  -- Depreciation starts when the asset is used, which is not always the day it
  -- was bought. Null means the two are the same day.
  in_service_date         date,
  cost                    numeric(16, 2) not null,
  residual_value          numeric(16, 2) not null default 0,
  method                  assets.depreciation_method not null default 'straight_line',
  duration_months         integer not null,
  coefficient             numeric(7, 3),
  prorata                 assets.prorata_rule,
  asset_account_id        uuid not null references public.accounts(id) on delete restrict,
  depreciation_account_id uuid not null references public.accounts(id) on delete restrict,
  expense_account_id      uuid not null references public.accounts(id) on delete restrict,
  state                   assets.asset_state not null default 'draft',
  notes                   text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (company_id, code),
  constraint assets_cost_positive check (cost > 0),
  constraint assets_residual_within check (residual_value >= 0 and residual_value < cost),
  constraint assets_duration_positive check (duration_months > 0),
  constraint assets_in_service_after check (in_service_date is null or in_service_date >= acquisition_date),
  constraint assets_declining_has_coefficient check (
    method <> 'declining_balance' or coefficient is not null
  ),
  -- The three accounts belong to the same company as the asset. The composite
  -- key is the socle's own pattern for this: `entry_lines(account_id,
  -- company_id)` does it for the same reason.
  foreign key (asset_account_id, company_id)        references public.accounts(id, company_id),
  foreign key (depreciation_account_id, company_id) references public.accounts(id, company_id),
  foreign key (expense_account_id, company_id)      references public.accounts(id, company_id),
  foreign key (contact_id, company_id)              references public.contacts(id, company_id)
);

comment on table assets.assets is
  'One fixed asset: what it cost, how it is depreciated, and the three accounts that carry it. The schedule is assets.depreciation_lines.';
comment on column assets.assets.prorata is
  'How much of the first period this asset takes. Null reads the country rule for its method, and an asset in a country whose pack says nothing is refused by name rather than given another country''s convention.';
comment on column assets.assets.coefficient is
  'Multiplier of the straight-line rate under a declining balance. France 1,25 / 1,75 / 2,25 by duration; Belgium doubles the rate. Required by a check constraint for that method, because a declining balance with no coefficient is a straight line nobody asked for.';

create unique index assets_id_company_idx on assets.assets (id, company_id);
create index assets_company_state_idx on assets.assets (company_id, state);
create index assets_document_line_idx on assets.assets (document_line_id) where document_line_id is not null;

create trigger assets_set_updated_at
  before update on assets.assets
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- The schedule
-- ---------------------------------------------------------------------------

create table assets.depreciation_lines (
  id             uuid primary key default gen_random_uuid(),
  asset_id       uuid not null references assets.assets(id) on delete cascade,
  company_id     uuid not null references public.companies(id) on delete cascade,
  sequence       integer not null,
  period_start   date not null,
  period_end     date not null,
  amount         numeric(16, 2) not null,
  -- After this line. Stored because a schedule is read far more often than it
  -- is written, and because an accountant reads a table of four columns.
  accumulated    numeric(16, 2) not null,
  net_book_value numeric(16, 2) not null,
  entry_id       uuid references public.entries(id) on delete set null,
  posted_at      timestamptz,
  created_at     timestamptz not null default now(),
  unique (asset_id, sequence),
  unique (asset_id, period_end),
  constraint assets_line_period check (period_end >= period_start),
  constraint assets_line_amount check (amount >= 0),
  constraint assets_line_posted_has_entry check (posted_at is null or entry_id is not null),
  foreign key (asset_id, company_id) references assets.assets(id, company_id) on delete cascade
);

comment on table assets.depreciation_lines is
  'One planned period of depreciation. `entry_id` is the entry that booked it, and is what makes running the depreciation of a period twice a no-op.';

create index assets_lines_company_period_idx
  on assets.depreciation_lines (company_id, period_end)
  where posted_at is null;
create index assets_lines_entry_idx on assets.depreciation_lines (entry_id) where entry_id is not null;

-- ---------------------------------------------------------------------------
-- The disposal
-- ---------------------------------------------------------------------------

create table assets.disposals (
  id                     uuid primary key default gen_random_uuid(),
  asset_id               uuid not null unique references assets.assets(id) on delete cascade,
  company_id             uuid not null references public.companies(id) on delete cascade,
  disposal_date          date not null,
  proceeds               numeric(16, 2) not null default 0,
  counterpart_account_id uuid references public.accounts(id) on delete restrict,
  contact_id             uuid references public.contacts(id) on delete set null,
  cost                   numeric(16, 2) not null,
  accumulated            numeric(16, 2) not null,
  net_book_value         numeric(16, 2) not null,
  -- Positive is a gain. Recorded because it is what the disposal decided, and
  -- recomputing it a year later from a chart that has moved on is how a
  -- register stops tying to the ledger.
  result                 numeric(16, 2) not null,
  entry_id               uuid references public.entries(id) on delete set null,
  created_at             timestamptz not null default now(),
  constraint assets_disposal_proceeds check (proceeds >= 0),
  foreign key (asset_id, company_id) references assets.assets(id, company_id) on delete cascade
);

comment on table assets.disposals is
  'What leaving the books cost or earned: one row per asset, written by assets.dispose_asset(). There is no undo, for the reason there is no unpost.';

-- ---------------------------------------------------------------------------
-- Counting days
--
-- Two conventions and no third. `actual` is the calendar. `thirty_360` is the
-- commercial year — twelve months of thirty days — which is what a French
-- straight-line prorata is worked out on. Both are written here so that a pack
-- names one rather than a reader assuming one.
-- ---------------------------------------------------------------------------

create or replace function assets.days360(p_from date, p_to date)
returns integer
language sql
immutable
as $$
  select ((extract(year from p_to)::int - extract(year from p_from)::int) * 360)
       + ((extract(month from p_to)::int - extract(month from p_from)::int) * 30)
       + (least(extract(day from p_to)::int, 30) - least(extract(day from p_from)::int, 30));
$$;

comment on function assets.days360(date, date) is
  'Days between two dates on a year of 360 days and months of 30, the day capped at the 30th. Half-open: days360(1 January, 1 January of the next year) is 360.';

/**
 * Whole months from the month of `p_from` to the month of `p_to`, inclusive.
 * January to January is one month, January to December is twelve.
 */
create or replace function assets.months_inclusive(p_from date, p_to date)
returns integer
language sql
immutable
as $$
  select greatest(
    0,
    (extract(year from p_to)::int - extract(year from p_from)::int) * 12
      + (extract(month from p_to)::int - extract(month from p_from)::int) + 1
  );
$$;

/**
 * The share of a period an asset is depreciated over.
 *
 * One for every period after the first, and for an asset whose country takes
 * no prorata at all. The date it counts from is the later of the day the asset
 * entered service and the first day of the period, so a full period is a full
 * annuity without the caller having to know which period it is on.
 */
create or replace function assets.prorata_fraction(
  p_rule         assets.prorata_rule,
  p_day_count    assets.day_count,
  p_start        date,
  p_period_start date,
  p_period_end   date
)
returns numeric
language plpgsql
immutable
as $$
declare
  v_from date := greatest(p_start, p_period_start);
begin
  if p_rule = 'none' or v_from <= p_period_start then
    return 1;
  end if;
  if v_from > p_period_end then
    return 0;
  end if;

  if p_rule = 'months' then
    return assets.months_inclusive(v_from, p_period_end)::numeric
         / nullif(assets.months_inclusive(p_period_start, p_period_end), 0);
  end if;

  if p_day_count = 'thirty_360' then
    return assets.days360(v_from, p_period_end + 1)::numeric
         / nullif(assets.days360(p_period_start, p_period_end + 1), 0);
  end if;

  return ((p_period_end - v_from) + 1)::numeric / nullif((p_period_end - p_period_start) + 1, 0);
end;
$$;

comment on function assets.prorata_fraction(assets.prorata_rule, assets.day_count, date, date, date) is
  'The share of a period that runs from the day an asset entered service. A prorata in days counts the day of entry into service itself, which is the convention that makes a full year come to exactly one.';

-- ---------------------------------------------------------------------------
-- What a company follows
-- ---------------------------------------------------------------------------

create or replace function assets.rules(p_company_id uuid)
returns assets.country_rules
language plpgsql
stable
as $$
declare
  v_rules assets.country_rules%rowtype;
begin
  select r.* into v_rules
    from public.companies c
    join assets.country_rules r on r.country = c.country
   where c.id = p_company_id;
  return v_rules;
end;
$$;

comment on function assets.rules(uuid) is
  'The depreciation rules of this company''s country, or an empty row when its pack says nothing. The callers name what is missing rather than borrowing another country''s answer.';

/**
 * Monthly or yearly, from the settings the company keeps for this module.
 *
 * The default is yearly, and that is a mechanism and not a country: every rule
 * a country writes about depreciation is expressed as an annuity, and a
 * monthly schedule is that annuity split. A company that wants the split asks
 * for it with `{"period": "monthly"}`.
 */
create or replace function assets.period_is_monthly(p_company_id uuid)
returns boolean
language sql
stable
as $$
  select coalesce(public.module_settings(p_company_id, 'assets') ->> 'period', 'yearly') = 'monthly';
$$;

/**
 * The twelve-month period an asset's schedule is cut into, from the financial
 * year that covers the day it entered service.
 *
 * Where the company has declared the financial year a period falls in, that
 * year's own end date is used, so a schedule follows the books. Beyond the
 * declared years it rolls twelve months at a time from the same anchor, which
 * is the only thing it can do: a building bought this year is depreciated over
 * twenty, and nineteen of those years have not been declared yet.
 */
create or replace function assets.period_end_for(p_company_id uuid, p_period_start date)
returns date
language sql
stable
as $$
  select coalesce(
    (select f.end_date
       from public.fiscal_years f
      where f.company_id = p_company_id
        and f.start_date = p_period_start
      limit 1),
    (p_period_start + interval '1 year' - interval '1 day')::date
  );
$$;

-- ---------------------------------------------------------------------------
-- create_asset
-- ---------------------------------------------------------------------------

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
    p_acquisition_date, p_in_service_date, round(p_cost, 2), round(coalesce(p_residual_value, 0), 2),
    v_method, v_duration, v_coef, v_category.prorata, v_asset, v_deprec, v_expense, 'active'
  )
  returning id into v_id;

  perform assets.generate_schedule(v_id);
  return v_id;
end;
$$;

comment on function assets.create_asset(uuid, text, text, date, numeric, text, text, text, text, integer, assets.depreciation_method, numeric, numeric, date, uuid, uuid, text) is
  'Creates an asset and its schedule in one call. A category of the country pack fills in the method, the duration and the coefficient; anything the caller passes wins over it.';

-- ---------------------------------------------------------------------------
-- generate_schedule
--
-- The one place an annuity is worked out, for both methods. Everything is
-- rounded to the cent as it goes and the last line takes what is left, so the
-- schedule sums to exactly `cost - residual_value` and a test asserts it on
-- every golden asset of both packs.
-- ---------------------------------------------------------------------------

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
  v_base     numeric(16, 2);
  v_rate     numeric;
  v_period_start date;
  v_period_end   date;
  v_fraction numeric;
  v_amount   numeric(16, 2);
  v_linear   numeric(16, 2);
  v_cap      numeric(16, 2);
  v_accum    numeric(16, 2) := 0;
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
    v_cap := round(v_asset.cost * v_rules.declining_cap_percent / 100, 2);
  end if;

  while v_accum < v_base loop
    v_guard := v_guard + 1;
    if v_guard > 1200 then
      raise exception 'schedule_runaway: % produced more than 1200 periods; check its duration and its coefficient', v_asset.code;
    end if;

    v_period_end := assets.period_end_for(v_asset.company_id, v_period_start);
    v_fraction := assets.prorata_fraction(v_prorata, v_rules.day_count, v_start, v_period_start, v_period_end);

    if v_asset.method = 'declining_balance' then
      v_amount := round((v_base - v_accum) * v_rate * v_asset.coefficient * v_fraction, 2);
      if v_cap is not null then
        v_amount := least(v_amount, round(v_cap * v_fraction, 2));
      end if;
      -- The straight line over what is left to run. A declining balance is a
      -- front-loaded schedule that never reaches zero on its own, and the
      -- switch is what makes it end on the last period rather than never.
      -- The last period is `v_left = 1`, where the straight line is the whole
      -- remaining value.
      v_left := greatest(1, v_periods - v_sequence);
      if coalesce(v_rules.declining_switch_to_linear, true) then
        v_linear := round((v_base - v_accum) / v_left * v_fraction, 2);
        v_amount := greatest(v_amount, v_linear);
      end if;
    else
      v_amount := round(v_base * v_rate * v_fraction, 2);
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

comment on function assets.generate_schedule(uuid) is
  'Writes the depreciation schedule of an asset, period by period, rounded to the cent with the last line taking the remainder. Refuses to rewrite a schedule whose lines are already booked.';

/**
 * A yearly schedule, split.
 *
 * The annuity is what a country's rule is written in, so it is computed first
 * and cut afterwards — one calculation and not two. Each period becomes as
 * many months as it holds, each month takes a twelfth rounded to the cent, and
 * the last month of each period takes the remainder, exactly as the last
 * period of a schedule takes the remainder of the whole.
 */
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
  v_share    numeric(16, 2);
  v_done     numeric(16, 2);
  v_accum    numeric(16, 2) := 0;
  v_sequence integer := 0;
  v_index    integer;
  v_new      jsonb := '[]'::jsonb;
begin
  select * into v_asset from assets.assets where id = p_asset_id;

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
                      else round(v_line.amount / v_months, 2) end;
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

-- ---------------------------------------------------------------------------
-- run_depreciation
--
-- One entry per period, through `post_module_entry()`, tagged
-- `depreciation:<period end>`. The tag is unique per company and module, so
-- running the same period twice is refused by the database rather than by a
-- flag this function remembered to check — and the flag is checked too, which
-- is why the ordinary second run is a quiet no-op and not an error.
-- ---------------------------------------------------------------------------

create or replace function assets.run_depreciation(p_company_id uuid, p_period_end date)
returns jsonb
language plpgsql
as $$
declare
  v_period   date;
  v_lines    jsonb;
  v_entry    uuid;
  v_total    numeric(16, 2);
  v_posted   jsonb := '[]'::jsonb;
begin
  if not public.module_is_enabled(p_company_id, 'assets') then
    raise exception 'module_not_enabled: assets is not enabled on this company'
      using errcode = '55006';
  end if;

  for v_period in
    select distinct l.period_end
      from assets.depreciation_lines l
      join assets.assets a on a.id = l.asset_id
     where l.company_id = p_company_id
       and l.posted_at is null
       and l.period_end <= p_period_end
       and a.state <> 'disposed'
       and l.amount > 0
     order by l.period_end
  loop
    -- One debit and one credit per asset, named by the asset. An entry that
    -- aggregates by account is shorter and tells whoever reads the ledger in
    -- three years nothing about which asset moved.
    select jsonb_agg(line order by line_order), sum(amount)
      into v_lines, v_total
      from (
        select jsonb_build_object(
                 'account_id', a.expense_account_id,
                 'label', a.code || ' — ' || a.name,
                 'debit', l.amount) as line,
               (a.code || ':1') as line_order, l.amount
          from assets.depreciation_lines l
          join assets.assets a on a.id = l.asset_id
         where l.company_id = p_company_id and l.period_end = v_period
           and l.posted_at is null and a.state <> 'disposed' and l.amount > 0
        union all
        select jsonb_build_object(
                 'account_id', a.depreciation_account_id,
                 'label', a.code || ' — ' || a.name,
                 'credit', l.amount),
               (a.code || ':2'), 0
          from assets.depreciation_lines l
          join assets.assets a on a.id = l.asset_id
         where l.company_id = p_company_id and l.period_end = v_period
           and l.posted_at is null and a.state <> 'disposed' and l.amount > 0
      ) parts;

    if v_lines is null then
      continue;
    end if;

    v_entry := public.post_module_entry(
      p_company_id, 'assets', 'depreciation:' || v_period::text, v_period,
      'Depreciation ' || v_period::text, v_lines);

    update assets.depreciation_lines l
       set entry_id = v_entry, posted_at = now()
      from assets.assets a
     where a.id = l.asset_id
       and l.company_id = p_company_id
       and l.period_end = v_period
       and l.posted_at is null
       and a.state <> 'disposed'
       and l.amount > 0;

    v_posted := v_posted || jsonb_build_object(
      'period_end', v_period,
      'entry_id', v_entry,
      'amount', to_char(v_total, 'FM9999999999999990.00'));
  end loop;

  -- An asset whose whole schedule is booked says so, so a register does not
  -- have to work it out from the lines every time it is read.
  update assets.assets a
     set state = 'fully_depreciated'
   where a.company_id = p_company_id
     and a.state = 'active'
     and not exists (select 1 from assets.depreciation_lines l
                      where l.asset_id = a.id and l.posted_at is null);

  return jsonb_build_object('company_id', p_company_id, 'entries', v_posted);
end;
$$;

comment on function assets.run_depreciation(uuid, date) is
  'Books every planned period that ends on or before a date, one entry per period, through post_module_entry(). Idempotent: a period already booked is skipped, and the unique tag on the entry refuses a second one anyway. A closed financial year refuses the posting, because post_entry() asserts the period is open.';

-- ---------------------------------------------------------------------------
-- dispose_asset
-- ---------------------------------------------------------------------------

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
  v_accum     numeric(16, 2);
  v_nbv       numeric(16, 2);
  v_result    numeric(16, 2);
  v_proceeds  numeric(16, 2) := round(coalesce(p_proceeds, 0), 2);
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

comment on function assets.dispose_asset(uuid, date, numeric, text, uuid) is
  'Takes an asset off the books on a date: clears its cost and its accumulated depreciation, books the proceeds, and presents the result the way the country''s pack says — one gain or loss line, or the value and the proceeds in full.';

-- ---------------------------------------------------------------------------
-- can_disable
--
-- The convention `disable_module()` looks for: null when there is nothing in
-- the way, a sentence when there is. A module that holds no posted data writes
-- none of this at all.
-- ---------------------------------------------------------------------------

create or replace function assets.can_disable(p_company_id uuid)
returns text
language sql
stable
as $$
  select case
    when exists (
      select 1 from assets.depreciation_lines l
       where l.company_id = p_company_id and l.posted_at is not null
    ) then 'depreciation has been booked from it; the entries stay whatever happens to the module, but the register that explains them would be gone'
    when exists (select 1 from assets.disposals d where d.company_id = p_company_id)
      then 'an asset has been disposed of through it'
    when exists (select 1 from assets.assets a where a.company_id = p_company_id)
      then 'it still holds assets; delete them first if they were a mistake'
  end;
$$;

comment on function assets.can_disable(uuid) is
  'Why this company cannot disable the assets module, or null when it can. The convention disable_module() reads.';

-- ---------------------------------------------------------------------------
-- The two readings
-- ---------------------------------------------------------------------------

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
         coalesce(d.accumulated, 0)::numeric(16, 2),
         (a.cost - coalesce(d.accumulated, 0))::numeric(16, 2),
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

comment on function assets.register(uuid, date) is
  'The table of fixed assets at a date: what each one cost, what has been written off it, and what is left. Reads what has been booked, so it ties to the ledger.';

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
         (case when m.held_before then m.cost else 0 end)::numeric(16, 2),
         (case when m.added then m.cost else 0 end)::numeric(16, 2),
         (case when m.disposal_date between p_from and p_to then m.cost else 0 end)::numeric(16, 2),
         (case when m.disposal_date is not null and m.disposal_date <= p_to then 0 else m.cost end)::numeric(16, 2),
         m.accum_before::numeric(16, 2),
         m.accum_period::numeric(16, 2),
         (case when m.disposal_date between p_from and p_to
               then coalesce(m.disposed_accumulated, 0) else 0 end)::numeric(16, 2),
         (case when m.disposal_date is not null and m.disposal_date <= p_to
               then 0 else m.accum_before + m.accum_period end)::numeric(16, 2),
         (case when m.disposal_date is not null and m.disposal_date <= p_to
               then 0 else m.cost - m.accum_before - m.accum_period end)::numeric(16, 2)
    from movement m
   order by m.code;
$$;

comment on function assets.movements(uuid, date, date) is
  'What came in, what was written off and what went out between two dates, per asset — the movement table an annual account asks for beside the register.';

-- ---------------------------------------------------------------------------
-- Row level security
--
-- Every table of a module goes through `module_enabled()`, which is the
-- membership **and** the module being on for that company. A company that
-- disables the module stops seeing its own rows, which is the point: enabled
-- is what the tables mean.
-- ---------------------------------------------------------------------------

alter table assets.country_rules       enable row level security;
alter table assets.category_templates  enable row level security;
alter table assets.assets              enable row level security;
alter table assets.depreciation_lines  enable row level security;
alter table assets.disposals           enable row level security;

-- Reference data of the installation, like `country_defaults`: readable by
-- anyone signed in, written by a seed.
create policy assets_country_rules_select on assets.country_rules
  for select using (auth.uid() is not null);
create policy assets_category_templates_select on assets.category_templates
  for select using (auth.uid() is not null);

create policy assets_select on assets.assets
  for select using (public.module_enabled(company_id, 'assets'));
create policy assets_write on assets.assets
  for all using (public.module_enabled(company_id, 'assets') and public.can_write_company(company_id))
  with check (public.module_enabled(company_id, 'assets') and public.can_write_company(company_id));

create policy assets_lines_select on assets.depreciation_lines
  for select using (public.module_enabled(company_id, 'assets'));
create policy assets_lines_write on assets.depreciation_lines
  for all using (public.module_enabled(company_id, 'assets') and public.can_write_company(company_id))
  with check (public.module_enabled(company_id, 'assets') and public.can_write_company(company_id));

create policy assets_disposals_select on assets.disposals
  for select using (public.module_enabled(company_id, 'assets'));
create policy assets_disposals_write on assets.disposals
  for all using (public.module_enabled(company_id, 'assets') and public.can_write_company(company_id))
  with check (public.module_enabled(company_id, 'assets') and public.can_write_company(company_id));

-- ---------------------------------------------------------------------------
-- Privileges
--
-- A module schema does its own grants: `public` gets them from Supabase's
-- default privileges, and a schema created by a migration gets nothing. The
-- shape is the socle's — `authenticated` reads and writes under row level
-- security, `anon` may select and sees nothing, and the functions are closed
-- to PUBLIC.
--
-- None of this puts the schema on the API. PostgREST serves what the project
-- lists under its exposed schemas, which no migration can set; `ekwo module
-- enable` prints the line to add.
-- ---------------------------------------------------------------------------

grant usage on schema assets to anon, authenticated, service_role;

grant select on all tables in schema assets to anon;
grant select, insert, update, delete on all tables in schema assets to authenticated, service_role;
grant execute on all functions in schema assets to authenticated, service_role;

alter default privileges in schema assets grant select on tables to anon;
alter default privileges in schema assets
  grant select, insert, update, delete on tables to authenticated, service_role;
alter default privileges in schema assets revoke execute on functions from public, anon;
alter default privileges in schema assets grant execute on functions to authenticated, service_role;

revoke execute on all functions in schema assets from public;

-- ---------------------------------------------------------------------------
-- The registry row
--
-- A module is installed when its schema exists and `public.modules` says so.
-- This is the row, and it is the last thing the first migration of a module
-- does — so a half-applied migration leaves nothing claiming to be here.
-- ---------------------------------------------------------------------------

insert into public.modules (code, name, description, schema_name, version, status, requires_socle_min)
values (
  'assets',
  'Fixed assets',
  'Fixed assets, their depreciation schedule and their disposal. Durations, declining coefficients and the prorata convention are country pack data.',
  'assets',
  '1.0.0',
  'available',
  '20260913075903'
)
on conflict (code) do update set
  name               = excluded.name,
  description        = excluded.description,
  schema_name        = excluded.schema_name,
  version            = excluded.version,
  status             = excluded.status,
  requires_socle_min = excluded.requires_socle_min;
