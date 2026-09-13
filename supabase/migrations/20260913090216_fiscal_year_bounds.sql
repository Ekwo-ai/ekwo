-- Ekwo OS — the first financial year is a parameter too.
--
-- `ekwo init` opened the first year on 1 January and closed it on 31
-- December, in two string literals. That is right for Belgium and for France
-- and wrong for the United Kingdom, for India, for Australia and for every
-- company whose year does not follow the calendar — and the country model has
-- carried the answer since P0-7: `country_defaults.fiscal_year_default`, one
-- of `calendar`, `april`, `july` or `october`, with no default of its own.
--
-- This is its reader. It is in the schema rather than in the CLI because
-- three callers ask the same question — `ekwo init`, the MCP server creating
-- a company, and whoever adds the year after that — and three answers to it
-- is how a company ends up with two overlapping first years.
--
-- **A day, not a duration.** The bounds are the opening day and the day
-- before the same day next year, so a year opened on 1 April closes on 31
-- March, and a leap day changes nothing. The 52/53-week year some retailers
-- keep is not this function's business: `fiscal_years` takes any two dates,
-- and a company that keeps one names them.
--
-- **No fallback.** A pack that says nothing gets `no_fiscal_year_default`,
-- naming the field it has to fill and the flag that answers for it. Opening
-- somebody's first year on a date nobody chose is the kind of wrong that is
-- found a year later, in a closing.

create or replace function fiscal_year_bounds(
  p_country    char(2),
  p_year       integer,
  p_start      date default null,
  out start_date date,
  out end_date   date
)
language plpgsql
stable
as $$
declare
  v_opening text;
  v_month   integer;
begin
  if p_start is not null then
    start_date := p_start;
  else
    select fiscal_year_default into v_opening
      from country_defaults where country = p_country;

    if v_opening is null then
      raise exception 'no_fiscal_year_default: the % pack declares no defaults.fiscal_year_default, so there is no month to open the first year on. Name the first day instead', p_country;
    end if;

    v_month := case v_opening
                 when 'calendar' then 1
                 when 'april'    then 4
                 when 'july'     then 7
                 when 'october'  then 10
               end;
    if v_month is null then
      raise exception 'unknown_fiscal_year_default: % is not one of calendar, april, july, october', v_opening;
    end if;

    start_date := make_date(p_year, v_month, 1);
  end if;

  end_date := (start_date + interval '1 year' - interval '1 day')::date;
end;
$$;

comment on function fiscal_year_bounds(char, integer, date) is
  'The first and last day of a financial year opening in a given calendar year, on the month the country pack declares — or on a day the caller names. Raises rather than assuming January.';

-- ---------------------------------------------------------------------------
-- create_company — a company, its owner, its chart and its first year
--
-- The four statements a client had to get right in the right order, with the
-- two that carry a rule delegated rather than restated:
-- `install_country_template()` copies the chart, the journals and the taxes,
-- and `fiscal_year_bounds()` decides the two dates. What is left here is the
-- sequence.
--
-- `ekwo init` keeps its own sequence, and deliberately: the installer is
-- check-then-act — it reports "already there" for every step and can be run
-- twice on a half-finished project — where this function creates or raises.
-- What they share is every rule; what differs is what they do when the thing
-- already exists.
--
-- Creating a company is an instance-level act, which is the policy on
-- `companies` and the doctrine behind it: an administrator creates companies
-- and invites members, and is not thereby on anybody's books. So the creator
-- is made the first member here, explicitly, because being able to create a
-- company is not being able to read one.
-- ---------------------------------------------------------------------------

create or replace function create_company(
  p_name              text,
  p_country           char(2),
  p_currency_code     char(3) default null,
  p_language          char(2) default null,
  p_chart_code        text    default null,
  p_fiscal_year       integer default null,
  p_fiscal_year_start date    default null,
  p_owner_user_id     uuid    default null
)
returns companies
language plpgsql
as $$
declare
  v_defaults country_defaults%rowtype;
  v_currency char(3);
  v_language char(2);
  v_owner    uuid := coalesce(p_owner_user_id, auth.uid());
  v_year     integer := coalesce(p_fiscal_year, extract(year from coalesce(p_fiscal_year_start, current_date))::integer);
  v_bounds   record;
  v_company  companies%rowtype;
begin
  if auth.uid() is not null and not is_instance_admin() then
    raise exception 'not_instance_admin: creating a company is an instance-level act'
      using errcode = '42501';
  end if;

  select * into v_defaults from country_defaults where country = p_country;

  -- The currency and the language have to be settled before the insert: both
  -- columns are not null with a default, so there is no later moment at which
  -- they are empty and the pack could fill them. The pack answers, or the
  -- caller does, and there is no third answer written here.
  v_currency := upper(coalesce(p_currency_code, v_defaults.currency_code));
  if v_currency is null then
    raise exception 'no_currency: the % pack names no currency; name one', p_country;
  end if;
  v_language := lower(coalesce(p_language, v_defaults.language_default));
  if v_language is null then
    raise exception 'no_language: the % pack names no language for its labels; name one', p_country;
  end if;

  select * into v_bounds from fiscal_year_bounds(p_country, v_year, p_fiscal_year_start);

  insert into companies (name, country, fiscal_country, currency_code, language)
  values (p_name, p_country, p_country, v_currency, v_language)
  returning * into v_company;

  if v_owner is not null then
    insert into company_members (company_id, user_id, role)
    values (v_company.id, v_owner, 'owner')
    on conflict (company_id, user_id) do nothing;
  end if;

  perform install_country_template(v_company.id, p_country, v_language, p_chart_code);

  insert into fiscal_years (company_id, name, start_date, end_date)
  values (v_company.id, 'FY' || v_year::text, v_bounds.start_date, v_bounds.end_date);

  select * into v_company from companies where id = v_company.id;
  return v_company;
end;
$$;

comment on function create_company(text, char, char, char, text, integer, date, uuid) is
  'Creates a company, makes the caller its first member, copies the country pack into it and opens its first financial year on the month that pack declares. An instance-level act, like the policy on companies.';

revoke execute on all functions in schema public from public;
