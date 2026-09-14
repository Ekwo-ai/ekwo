-- Ekwo OS — how often a company files, written down instead of asked every time.
--
-- `vat_return()` takes two dates and works out the boxes between them, which is
-- right: a return is a period, and the caller knows which one. What nothing
-- held was **how often this company files at all**. Luxembourg sets the cadence
-- by turnover — annual up to 112 000 euros, quarterly to 620 000, monthly above
-- — and the pack could not say so; a Belgian company on quarterly returns and
-- one on monthly returns were the same row. So `ekwo status`, a reminder, and
-- any client offering "file the current period" had to ask a human every time,
-- and nothing stopped a quarterly filer from being handed a July return.
--
-- Three pieces, and each one is in the place that owns the answer.
--
--   `tax_report_templates.periods`  what the **form** accepts. A list, because
--       a country may file one set of boxes on more than one cadence: the
--       column held a single value with `month_or_quarter` bolted on as a
--       fourth word, which cannot say "month, quarter or year" and is not a
--       cadence anybody files on. The list can.
--   `companies.vat_period`          what **this company** files. Nullable, and
--       with no default: a company that has not said keeps its books exactly as
--       before, and nothing here guesses. A guess would be a missed deadline.
--   `country_defaults.vat_period_default`  what the **pack proposes**, when the
--       law of that country gives one answer that does not depend on a fact
--       about the company. Null everywhere it does depend on one, which is
--       three of the four packs here today — see the note on the column.
--
-- **The vocabulary is the one already published**: `month`, `quarter`, `year`,
-- now an enum rather than three spellings agreed by convention. A second
-- spelling — `monthly`, `quarterly` — would be the same fact written twice.
-- `month_or_quarter` becomes the two cadences it always meant.
--
-- **What the return does with it.** It refuses a period the company does not
-- file on, by name, and only when the refusal is certain: the company has
-- recorded a cadence, the form offers that cadence, the dates asked for are
-- themselves a whole cadence the form offers, and the two differ. Anything
-- else is an analysis and not a filing — a fortnight, a half-year, the annual
-- recapitulative form a quarterly filer also files — and it goes through.

-- ---------------------------------------------------------------------------
-- The vocabulary
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'declaration_period') then
    create type declaration_period as enum ('month', 'quarter', 'year');
  end if;
end;
$$;

comment on type declaration_period is
  'How often a declaration is filed: month, quarter, year. The three cadences every European periodic return is filed on; a country that files on another adds a value here rather than a word of its own somewhere else.';

-- ---------------------------------------------------------------------------
-- What a form accepts
-- ---------------------------------------------------------------------------
--
-- `period` was `text not null default 'month_or_quarter'`, and that default is
-- the reason this column could not be trusted: a pack that said nothing about
-- its cadence got Belgium's and France's answer, silently. There is no default
-- now. A form says what it accepts, or `ekwo pack check` refuses the pack.
--
-- Duplicates in the list are not refused by a constraint. `= any(periods)`
-- reads `{month,month}` exactly as it reads `{month}`, so a duplicate changes
-- no behaviour; `ekwo pack check` says so at the one moment it is worth saying,
-- which is when somebody is writing the pack.

alter table tax_report_templates drop constraint if exists tax_report_templates_period;
alter table tax_report_templates alter column period drop default;

alter table tax_report_templates
  alter column period type declaration_period[]
  using (
    case period
      when 'month_or_quarter' then array['month', 'quarter']
      else array[period]
    end
  )::declaration_period[];

alter table tax_report_templates rename column period to periods;

alter table tax_report_templates
  add constraint tax_report_templates_periods_not_empty check (cardinality(periods) >= 1);

comment on column tax_report_templates.periods is
  'Cadences this form is filed on, from packs/<cc>/tax_report.json. A list because one set of boxes may be filed monthly, quarterly or annually depending on turnover. No default: a pack that names none is refused by `ekwo pack check`.';

-- ---------------------------------------------------------------------------
-- What a company files, and what a pack proposes
-- ---------------------------------------------------------------------------

alter table companies
  add column if not exists vat_period declaration_period;

comment on column companies.vat_period is
  'How often this company files its periodic return. Null means it has not been recorded, which is not an error and not a cadence: the books are kept the same either way, vat_return() imposes nothing, and `ekwo status` says "not recorded" rather than naming a cadence nobody chose.';

alter table country_defaults
  add column if not exists vat_period_default declaration_period;

comment on column country_defaults.vat_period_default is
  'Cadence a company of this country files on unless it says otherwise, from the pack. Null wherever the law makes the cadence depend on a fact about the company — turnover in Belgium, France and Luxembourg — because a pack proposing one of two lawful answers there would be choosing a filing deadline for somebody it knows nothing about. Set where the law gives one answer for everybody, as in Estonia. Read at install; never read by the return.';

-- ---------------------------------------------------------------------------
-- Which cadence a pair of dates is
-- ---------------------------------------------------------------------------
--
-- A whole calendar month, quarter or year, and null for anything else. Null is
-- the useful half of the answer: it is what tells the return that it is being
-- asked for an analysis rather than for a filing, and an analysis is refused
-- for nothing.

create or replace function declaration_period_of(p_from date, p_to date)
returns declaration_period
language sql
immutable
as $$
  select case
    when p_from = date_trunc('month', p_from)::date
     and p_to = (date_trunc('month', p_from) + interval '1 month' - interval '1 day')::date
      then 'month'::declaration_period
    when p_from = date_trunc('quarter', p_from)::date
     and p_to = (date_trunc('quarter', p_from) + interval '3 months' - interval '1 day')::date
      then 'quarter'::declaration_period
    when p_from = date_trunc('year', p_from)::date
     and p_to = (date_trunc('year', p_from) + interval '1 year' - interval '1 day')::date
      then 'year'::declaration_period
    else null
  end;
$$;

comment on function declaration_period_of(date, date) is
  'The cadence a pair of dates is a whole one of — month, quarter, year — or null when the two dates are not a filing period at all.';

revoke execute on function declaration_period_of(date, date) from public, anon;
grant execute on function declaration_period_of(date, date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The return reads it
-- ---------------------------------------------------------------------------
--
-- Replaced whole rather than patched, because a function is replaced whole in
-- PostgreSQL. Everything below the guard is `20260914121200` unchanged.

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

  -- 1. What the tax postings wrote on the ledger. Unchanged: this half never
  --    knew a country.
  for r in
    with ledger as (
      select l.declaration_box as lbox,
             case when l.tax_line then 'tax' else 'base' end as lkind,
             round_amount(sum(l.box_amount), v_round) as lamount
        from entry_lines l
        join entries e on e.id = l.entry_id
       where l.company_id = p_company_id
         and e.state = 'posted'
         and e.entry_date between p_from and p_to
         and l.declaration_box is not null
         -- A box number belongs to one form. A line whose posting names
         -- another form is not on this declaration; one that names none is
         -- the single-return case every European company is in.
         and (v_report is null or coalesce((
               select min(tp.report_code)
                 from tax_postings tp
                where tp.tax_id = l.tax_id
                  and tp.declaration_box = l.declaration_box
                  and tp.posting_type =
                      (case when l.tax_line then 'tax' else 'base' end)::tax_posting_type
             ), v_report) = v_report)
       group by 1, 2
      having round_amount(sum(l.box_amount), v_round) <> 0
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
  'Declaration boxes for a period: summed from the ledger, then the totals of the country''s form worked out by evaluate_totals(), the same evaluator financial_statement() uses. Refuses a period the company does not file on, when it has recorded one. No country rule lives in this function.';

revoke execute on function vat_return(uuid, date, date, text) from public, anon;
grant execute on function vat_return(uuid, date, date, text) to authenticated, service_role;
