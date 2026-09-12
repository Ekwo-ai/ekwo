-- Ekwo OS — the boxes of a declaration, and the formulas that add them up.
--
-- `vat_return()` summed whatever the tax postings wrote on the ledger lines,
-- which is country-free, and then hard-coded the Belgian frame VI: boxes 71
-- and 72, their two lists of boxes, and a test on the company's fiscal
-- country. It was the last country rule left in the core. A French company
-- got no total at all, and a British one never would have.
--
-- A form is now data, like a chart of accounts and a tax:
--
--   `tax_report_templates`      one row per declaration form of a country.
--   `tax_report_box_templates`  one row per box, with the formula of a total.
--
-- **No expression language.** A total carries a list of boxes to add, a list
-- to subtract, and a floor at zero. That covers the Belgian 71/72, the French
-- 16, 23, 25 and 28, and the British box 5, and it is readable by the
-- accountant who wrote the pack. The day a country needs a real expression,
-- that is a discussion about the core, not a field added to a pack.
--
-- **A reference resolves to a box and a kind.** `"54"` names one box; the
-- French CA3 carries a base and a tax on the same line, so it writes
-- `"08:base"` and `"08:tax"`. `ekwo pack check` refuses a bare reference that
-- would match both, so the two spellings can never disagree.
--
-- **These tables are not copied into a company.** A chart of accounts is
-- customisable and a form is not: an operator does not get to redefine box 59.
-- They stay reference data, read straight by `vat_return()`.
--
-- A new version of a form is a **new code** with its own validity, the way a
-- new VAT rate is a new tax code: `(country, code)` is the key, `valid_from`
-- and `valid_to` say which one is in force, and the return of a past period
-- keeps giving the same answer.

-- ---------------------------------------------------------------------------
-- The forms
-- ---------------------------------------------------------------------------

create table if not exists tax_report_templates (
  country            char(2) not null,
  code               text not null,
  name               text not null,
  name_i18n          jsonb not null default '{}'::jsonb,
  period             text not null default 'month_or_quarter',
  valid_from         date not null default date '1970-01-01',
  valid_to           date,
  legal_reference    text,
  is_periodic_return boolean not null default true,
  primary key (country, code),
  constraint tax_report_templates_country_format check (country ~ '^[A-Z]{2}$'),
  constraint tax_report_templates_period check (
    period in ('month', 'quarter', 'month_or_quarter', 'year')
  ),
  constraint tax_report_templates_validity check (valid_to is null or valid_to >= valid_from)
);

comment on table tax_report_templates is
  'Declaration forms per country, from packs/<cc>/tax_report.json. Reference data: a form is not customisable, so it is never copied into a company.';
comment on column tax_report_templates.code is
  'BE-VAT-PERIODIC, FR-CA3. Immutable once published; a new version of a form is a new code with its own validity.';
comment on column tax_report_templates.is_periodic_return is
  'True for the return a company files every month or quarter. vat_return() falls back to the one of the company''s fiscal country.';
comment on column tax_report_templates.name_i18n is
  'Label by language. The pack format has no key for it yet, so it stays empty until i18n/ carries one.';

-- ---------------------------------------------------------------------------
-- The boxes
-- ---------------------------------------------------------------------------

create table if not exists tax_report_box_templates (
  country         char(2) not null,
  report_code     text not null,
  box             text not null,
  kind            text not null,
  name            text not null,
  name_i18n       jsonb not null default '{}'::jsonb,
  sequence        integer not null default 10,
  plus_boxes      text[] not null default '{}'::text[],
  minus_boxes     text[] not null default '{}'::text[],
  floor_zero      boolean not null default false,
  hidden          boolean not null default false,
  xml_element     text,
  legal_reference text,
  valid_from      date,
  valid_to        date,
  primary key (country, report_code, box, kind),
  foreign key (country, report_code) references tax_report_templates (country, code) on delete cascade,
  constraint tax_report_box_templates_kind check (kind in ('base', 'tax', 'total')),
  -- A base or a tax box is summed from the ledger; only a total has a formula.
  constraint tax_report_box_templates_formula_is_a_total check (
    kind = 'total' or (plus_boxes = '{}'::text[] and minus_boxes = '{}'::text[])
  ),
  constraint tax_report_box_templates_validity check (valid_to is null or valid_to >= valid_from)
);

comment on table tax_report_box_templates is
  'The boxes of a declaration form, and the plus/minus lists a total is computed from. Read by vat_return().';
comment on column tax_report_box_templates.kind is
  'base, tax or total. Not an enum: vat_return() has always answered in text, and a form that invents a fourth kind is a core change either way.';
comment on column tax_report_box_templates.plus_boxes is
  'Boxes added into this total. A bare code names the box whatever its kind, "08:tax" names one kind — the French CA3 carries both on one line.';
comment on column tax_report_box_templates.floor_zero is
  'A negative total is reported as zero, the other side of the pair carrying it: Belgian 71/72, French 25/28.';
comment on column tax_report_box_templates.hidden is
  'An intermediate total the form does not print. vat_return() returns it with this flag rather than dropping it, so a caller can check a total it cannot see.';
comment on column tax_report_box_templates.valid_from is
  'Null means the validity of the form itself. Filled only when a box appears or disappears inside one version of a form.';

create index if not exists tax_report_box_templates_report_idx
  on tax_report_box_templates (country, report_code, sequence, box);

-- ---------------------------------------------------------------------------
-- vat_return, with no country in it
--
-- The three-argument signature is dropped first: an overload with a default
-- would make `vat_return(company, from, to)` ambiguous, and Postgres would
-- refuse the call every client makes today. The default parameter keeps that
-- call working.
-- ---------------------------------------------------------------------------

drop function if exists vat_return(uuid, date, date);

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
  -- 'box|kind' -> amount, for every box known so far. The totals are
  -- evaluated in sequence order, so a total may name one computed before it.
  v_values  jsonb := '{}'::jsonb;
  v_rows    jsonb := '[]'::jsonb;
  v_country char(2);
  v_report  text;
  v_in      char(2);
  v_count   integer;
  v_codes   text;
  v_amount  numeric;
  v_part    numeric;
  v_ref     text;
  r         record;
begin
  select c.fiscal_country into v_country from companies c where c.id = p_company_id;
  if not found then
    raise exception 'unknown_company: %', p_company_id;
  end if;

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

  -- 1. What the tax postings wrote on the ledger. Unchanged: this half never
  --    knew a country.
  for r in
    with ledger as (
      select l.declaration_box as lbox,
             case when l.tax_line then 'tax' else 'base' end as lkind,
             round(sum(l.box_amount), 2) as lamount
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
      having round(sum(l.box_amount), 2) <> 0
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

  -- 2. The totals of the form, in the order the form declares them.
  if v_report is not null then
    for r in
      select b.box as tbox, b.name as tname, b.sequence as tsequence,
             b.hidden as thidden, b.floor_zero as tfloor,
             b.plus_boxes as tplus, b.minus_boxes as tminus
        from tax_report_box_templates b
       where b.country = v_in
         and b.report_code = v_report
         and b.kind = 'total'
         and (b.valid_from is null or b.valid_from <= p_to)
         and (b.valid_to is null or b.valid_to >= p_to)
       order by b.sequence, b.box
    loop
      v_amount := 0;
      -- A qualified reference names one kind; a bare one takes every kind
      -- recorded in that box, which `pack check` has made unambiguous.
      foreach v_ref in array r.tplus loop
        select coalesce(sum(e.ref_value::numeric), 0) into v_part
          from jsonb_each_text(v_values) as e(ref_key, ref_value)
         where case when strpos(v_ref, ':') > 0
                    then e.ref_key = replace(v_ref, ':', '|')
                    else split_part(e.ref_key, '|', 1) = v_ref
               end;
        v_amount := v_amount + v_part;
      end loop;
      foreach v_ref in array r.tminus loop
        select coalesce(sum(e.ref_value::numeric), 0) into v_part
          from jsonb_each_text(v_values) as e(ref_key, ref_value)
         where case when strpos(v_ref, ':') > 0
                    then e.ref_key = replace(v_ref, ':', '|')
                    else split_part(e.ref_key, '|', 1) = v_ref
               end;
        v_amount := v_amount - v_part;
      end loop;

      if r.tfloor then
        v_amount := greatest(v_amount, 0);
      end if;

      -- A total is known to the boxes after it even when it is nil.
      v_values := v_values || jsonb_build_object(r.tbox || '|total', v_amount);

      -- Nil boxes are left out, as they always have been for the ledger ones:
      -- a return prints what it has.
      if v_amount <> 0 then
        v_rows := v_rows || jsonb_build_array(jsonb_build_object(
          'box', r.tbox, 'kind', 'total', 'amount', v_amount, 'computed', true,
          'name', r.tname, 'sequence', r.tsequence, 'hidden', r.thidden,
          'report_code', v_report));
      end if;
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
  'Declaration boxes for a period: summed from the ledger, then the totals of the country''s form evaluated in sequence order. No country rule lives in this function.';

-- ---------------------------------------------------------------------------
-- Row level security
--
-- A form is reference data, like a chart of accounts: any signed-in user may
-- read it, and nobody writes it but the generated seed, which runs as the
-- owner. Same policy as `account_templates` and `tax_posting_templates`, and
-- no write policy at all — deliberately.
-- ---------------------------------------------------------------------------

alter table tax_report_templates     enable row level security;
alter table tax_report_box_templates enable row level security;

create policy tax_report_templates_select on tax_report_templates
  for select using (auth.uid() is not null);
create policy tax_report_box_templates_select on tax_report_box_templates
  for select using (auth.uid() is not null);

comment on policy tax_report_templates_select on tax_report_templates is
  'Reference data, readable by any signed-in user. No write policy: a form comes from a pack.';

-- The rule of `20260911210131`, which its own default privileges cannot keep:
-- a function created now comes out executable by PUBLIC unless this runs.
revoke execute on all functions in schema public from public;
