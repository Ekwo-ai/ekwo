-- Ekwo OS — one evaluator, called by both reports.
--
-- A declaration form and a financial statement derive their totals the same
-- way: a list of lines to add, a list to subtract, and a floor at zero on the
-- pairs that split a balance. `20260912090407` wrote that evaluation inside
-- `vat_return()`, and `20260912100412` was about to write it a second time
-- inside `financial_statement()`. One calculation, two places, is the rule
-- this repository is built against.
--
-- The two differences between the callers are parameters, not engines:
--
--   `p_keep_zero`  a return omits a box that comes to nothing; a statement
--                  prints its whole frame, zeros and all.
--   `factor`       a statement multiplies a line by the sign the scheme reads
--                  it with; a declaration has no sign, so it passes nothing.
--
-- `evaluate_totals()` is created in `20260912100412`, where
-- `financial_statement()` already calls it. This file is separate for the one
-- reason that matters: `vat_return()` was published before, so it is replaced
-- in a file of its own rather than by editing the one that shipped it.
--
-- Two things the rewrite gives `vat_return()` beyond having one evaluator.
-- Its totals are now worked out **in the order they depend on each other**
-- rather than in the order the form declares them, which is a superset of what
-- it did — a forward reference used to read a silent zero, and
-- `ekwo pack check` refuses one anyway. And two totals that depend only on
-- each other now raise `formula_cycle` instead of both reading zero.

drop function if exists vat_return(uuid, date, date, text);

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
  r          record;
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

    v_totals := evaluate_totals(v_values, v_formulas, false);

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
  'Declaration boxes for a period: summed from the ledger, then the totals of the country''s form worked out by evaluate_totals(), the same evaluator financial_statement() uses. No country rule lives in this function.';

-- Rule 6 of supabase/migrations/README.md: a function created here comes out
-- executable by PUBLIC otherwise.
revoke execute on all functions in schema public from public;

-- And the evaluator by name, from `anon` too. The blanket revoke above is
-- never aimed at `anon`, which holds explicit grants on the eight policy
-- helpers and would lose them; naming one function takes nothing else away.
revoke execute on function evaluate_totals(jsonb, jsonb, boolean) from public, anon;
