-- Ekwo OS — a financial statement is data, and one of them fits any chart.
--
-- The schema could produce a trial balance and a ledger, and nothing that an
-- accountant files. A balance sheet was a query somebody would have written
-- in the application, once per country, which is how a country gets back into
-- the core through the front door.
--
-- Three tables and one function, filled by a pack:
--
--   `statement_templates`      one statement of one framework — the Belgian
--                              abbreviated scheme, the French liasse, the
--                              generic one by account type.
--   `statement_line_templates` one line of it, with the plus/minus lists a
--                              total is computed from.
--   `statement_line_rules`     how accounts reach a line: by code range, by
--                              code prefix, by account type, or one code.
--
-- **Mapping by code range is presentation, and presentation is allowed.** The
-- rule that forbids choosing an account *to post to* by prefix is about
-- posting. The NBB scheme, the liasse and every XBRL taxonomy map by ranges of
-- the legal chart — in Belgium the rubric code *is* the range, `40/41` being
-- accounts 40 and 41 — and refusing that would mean hand-listing four hundred
-- codes per country.
--
-- **The generic framework is what the eighteen account types buy.** A
-- statement whose `country` is null and whose rules are all `account_type`
-- gives a readable balance sheet on any chart, including the code-less charts
-- of the United Kingdom and the United States, and it is the fallback for a
-- company whose chart declares no statement of its own.
--
-- **`country` is nullable, so the key is the code alone.** A nullable column
-- cannot carry a primary key, and a statement code is unique across packs the
-- way a declaration form code is unique inside a country — `BE-BNB-ABBR-BS`,
-- `FR-2050`, `IFRS-SME-BS`. `chart_code` null means every chart of the
-- country; a statement that only fits one chart names it.
--
-- **A closing entry is not what a period earned.** `close_fiscal_year()` books
-- the mirror image of every income and expense account so the next year starts
-- at nil, and marks the entry `kind = 'closing'`. An income statement leaves
-- those out — a closed year would otherwise read as a result of zero — and a
-- balance sheet keeps them, because that entry is what carries the result onto
-- the line the balance sheet shows it on. An allocation section keeps them
-- too, and there is a limit there worth knowing: the appropriation entry and
-- the entry that zeroes the appropriation accounts are both `closing`, so the
-- two net out and a Belgian allocation section reads nil after a close. Making
-- it readable needs a kind that tells them apart, which is a change to
-- `close_fiscal_year()`, not to this file.
--
-- **Not copied into a company**, for the reason a declaration form is not: an
-- operator does not get to redefine what the Banque nationale prints. They are
-- reference data `financial_statement()` reads directly, which is also why
-- they carry no `company_id`.
--
-- **One evaluator, called twice.** A declaration form and a financial statement
-- derive their totals the same way — a list to add, a list to subtract — and
-- the two differences between them are parameters, not engines: a return omits
-- a box that comes to nothing where a statement prints its whole frame
-- (`p_keep_zero`), and a statement multiplies a line by the sign the scheme
-- reads it with (`factor`). `evaluate_totals()` below is that engine;
-- `vat_return()` is rewritten onto it in the migration that follows this one,
-- its own file because it was published before this.

-- ---------------------------------------------------------------------------
-- The statements
-- ---------------------------------------------------------------------------

create table if not exists statement_templates (
  code            text primary key,
  country         char(2),
  chart_code      text,
  name            text not null,
  name_i18n       jsonb not null default '{}'::jsonb,
  kind            text not null,
  framework       text,
  valid_from      date not null default date '1970-01-01',
  valid_to        date,
  legal_reference text,
  constraint statement_templates_country_format check (country is null or country ~ '^[A-Z]{2}$'),
  constraint statement_templates_kind check (
    kind in ('balance_sheet', 'income_statement', 'cash_flow', 'allocation')
  ),
  constraint statement_templates_chart_needs_country check (chart_code is null or country is not null),
  constraint statement_templates_validity check (valid_to is null or valid_to >= valid_from)
);

comment on table statement_templates is
  'Financial statements per framework, from packs/<cc>/statements.json and packs/generic/. Reference data: never copied into a company.';
comment on column statement_templates.country is
  'Null on the generic framework, which reports by account type and fits any chart of any country.';
comment on column statement_templates.chart_code is
  'Null means every chart of the country. Filled when a statement only makes sense on one — a nonprofit scheme on a nonprofit chart.';
comment on column statement_templates.kind is
  'balance_sheet reads balances cumulative to the end of the period; income_statement and allocation read the movements of the period; cash_flow is declared and not yet produced.';
comment on column statement_templates.code is
  'Immutable once published. A new version of a scheme is a new code with its own validity, the way a new VAT rate is a new tax code.';

create index if not exists statement_templates_country_idx
  on statement_templates (country, chart_code, kind);

-- ---------------------------------------------------------------------------
-- The lines
-- ---------------------------------------------------------------------------

create table if not exists statement_line_templates (
  statement_code text not null references statement_templates(code) on delete cascade,
  code           text not null,
  parent_code    text,
  name           text not null,
  name_i18n      jsonb not null default '{}'::jsonb,
  sequence       integer not null default 10,
  sign           smallint not null default 1,
  is_total       boolean not null default false,
  plus_lines     text[] not null default '{}'::text[],
  minus_lines    text[] not null default '{}'::text[],
  xbrl_element   text,
  legal_reference text,
  primary key (statement_code, code),
  constraint statement_line_templates_sign check (sign in (1, -1)),
  -- A line is summed from the ledger or computed from other lines, never both.
  constraint statement_line_templates_formula_is_a_total check (
    is_total or (plus_lines = '{}'::text[] and minus_lines = '{}'::text[])
  )
);

comment on table statement_line_templates is
  'The lines of a statement, in the order it prints them, and the plus/minus lists a total is computed from.';
comment on column statement_line_templates.sign is
  'Multiplies the debit-minus-credit balance so the line reads the way the scheme prints it: 1 on an asset or an expense, -1 on a liability, equity or income line.';
comment on column statement_line_templates.plus_lines is
  'Lines added into this total, by their code. Evaluated in `sequence` order, so a total may only name one computed before it.';
comment on column statement_line_templates.xbrl_element is
  'What an XBRL filing writes for this line. The NBB CBSO taxonomy is dimensional, so the value is a fact key — a metric and its dimension members, `met:am1|bas:m2` — and not an element name. Null where nothing is verified.';
comment on column statement_line_templates.parent_code is
  'The line this one details, for a renderer that indents. Structure only: a parent that is a total says so with its plus list.';

-- ---------------------------------------------------------------------------
-- The rules that bring accounts to a line
-- ---------------------------------------------------------------------------

create table if not exists statement_line_rules (
  statement_code text not null,
  line_code      text not null,
  sequence       integer not null default 10,
  rule_kind      text not null,
  code_from      text,
  code_to        text,
  account_type   account_type,
  balance_side   text not null default 'any',
  primary key (statement_code, line_code, sequence),
  foreign key (statement_code, line_code)
    references statement_line_templates (statement_code, code) on delete cascade,
  constraint statement_line_rules_kind check (
    rule_kind in ('account_code', 'code_range', 'code_prefix', 'account_type')
  ),
  constraint statement_line_rules_side check (balance_side in ('debit', 'credit', 'any')),
  constraint statement_line_rules_arguments check (
    case rule_kind
      when 'account_type' then account_type is not null and code_from is null and code_to is null
      when 'code_range'   then code_from is not null and code_to is not null and account_type is null
      else                     code_from is not null and code_to is null and account_type is null
    end
  )
);

comment on table statement_line_rules is
  'How an account of a company reaches a line. Presentation maps by range of the legal chart; choosing an account to post to by prefix stays forbidden, and is a different question.';
comment on column statement_line_rules.rule_kind is
  'account_code names one code; code_range and code_prefix compare the head of the code, so `40`..`41` takes 400000 and 411000 and stops at 42; account_type is what the generic framework is made of.';
comment on column statement_line_rules.balance_side is
  'Which side of the account this line takes. `any` takes it whatever it holds; `debit` and `credit` split one account between two lines — a suspense account is a receivable when it is in debit and a payable when it is in credit.';
comment on column statement_line_rules.sequence is
  'Order inside the line, and part of the key. Between two rules that both catch an account, the narrower one wins first, then this.';

create index if not exists statement_line_rules_line_idx
  on statement_line_rules (statement_code, line_code);

-- ---------------------------------------------------------------------------
-- statement_account_matches — which line each account of a company falls on
--
-- One place decides it, so `financial_statement()` and `unmapped_accounts()`
-- can never disagree about what is on the statement and what is missing from
-- it. Priority: an exact code beats a range or a prefix, which beat an account
-- type; between two ranges the narrower head wins.
-- ---------------------------------------------------------------------------

create or replace function statement_account_matches(
  p_company_id     uuid,
  p_statement_code text,
  p_from           date,
  p_to             date
)
returns table (
  account_id   uuid,
  account_code text,
  account_name text,
  account_type account_type,
  balance      numeric,
  line_code    text
)
language sql
stable
as $$
  with statement as (
    select s.code, s.kind from statement_templates s where s.code = p_statement_code
  ),
  balances as (
    select a.id, a.code, a.name, a.account_type,
           round(coalesce(sum(l.balance), 0), 2) as balance
      from accounts a
      join entry_lines l on l.account_id = a.id
      join entries e on e.id = l.entry_id
      cross join statement st
     where a.company_id = p_company_id
       and e.state = 'posted'
       and case when st.kind = 'balance_sheet'
                then e.entry_date <= p_to
                else e.entry_date between p_from and p_to
           end
       -- An income statement is what the period earned, and the entry that
       -- closes a year is not that: it books the mirror image of every income
       -- and expense account so they start the next year at nil. Left in, a
       -- closed year reads as a result of zero. A balance sheet keeps it, and
       -- must: that entry is what moves the result out of the income
       -- statement and onto the line the balance sheet shows it on.
       and (st.kind <> 'income_statement' or e.kind <> 'closing')
     group by a.id, a.code, a.name, a.account_type
  ),
  ranked as (
    select b.id, b.code, b.name, b.account_type, b.balance, r.line_code,
           row_number() over (
             partition by b.id
             order by case r.rule_kind
                        when 'account_code' then 1
                        when 'code_range'   then 2
                        when 'code_prefix'  then 2
                        else                     3
                      end,
                      length(coalesce(r.code_from, '')) desc,
                      r.sequence, r.line_code
           ) as rank
      from balances b
      join statement_line_rules r on r.statement_code = p_statement_code
     where case r.rule_kind
             when 'account_code' then b.code = r.code_from
             when 'code_prefix'  then left(b.code, length(r.code_from)) = r.code_from
             when 'code_range'   then left(b.code, length(r.code_from)) >= r.code_from
                                  and left(b.code, length(r.code_to))   <= r.code_to
             else                     b.account_type = r.account_type
           end
       and case r.balance_side
             when 'debit'  then b.balance > 0
             when 'credit' then b.balance < 0
             else               true
           end
  )
  select b.id, b.code, b.name, b.account_type, b.balance, r.line_code
    from balances b
    left join ranked r on r.id = b.id and r.rank = 1
   order by b.code;
$$;

comment on function statement_account_matches(uuid, text, date, date) is
  'Every account of a company with a balance in the period, and the statement line it falls on — null when no rule catches it. The single decision financial_statement() and unmapped_accounts() both read.';

-- ---------------------------------------------------------------------------
-- evaluate_totals — the one place a plus/minus formula is worked out
--
-- `p_values`   what is already known, as `{ "<key>": <amount> }`.
-- `p_formulas` the totals to derive, as an array of
--              `{ key, plus[], minus[], floor_zero, factor, sequence }`.
-- `p_keep_zero` whether a total that comes to nothing is in the answer. It is
--              always in the working set either way, so a later total that
--              names it reads a zero and not a gap.
--
-- **A reference is resolved the way a declaration form needs it**, which costs
-- a statement nothing: `08:tax` names one key exactly, a bare `08` sums every
-- key whose head is `08` — the French CA3 carries a base and a tax on one
-- line, and a statement whose keys hold no separator gets a plain equality out
-- of the same rule.
--
-- **The totals are evaluated in the order they depend on each other**, not the
-- order they are declared: a balance sheet prints a subtotal above the lines it
-- adds up, and a declaration names a total computed before it. A reference that
-- names no formula is a value — present or nil, it is known already — so a
-- total over ledger boxes is ready on the first pass. A pass that settles
-- nothing is a cycle, and says which totals are in it.
-- ---------------------------------------------------------------------------

create or replace function evaluate_totals(
  p_values    jsonb,
  p_formulas  jsonb,
  p_keep_zero boolean default false
)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_values  jsonb := coalesce(p_values, '{}'::jsonb);
  v_out     jsonb := '{}'::jsonb;
  v_done    jsonb := '{}'::jsonb;
  v_all     jsonb := coalesce(p_formulas, '[]'::jsonb);
  v_left    integer;
  v_settled integer;
  v_ready   boolean;
  v_amount  numeric;
  v_part    numeric;
  v_refs    text[];
  v_ref     text;
  v_key     text;
  v_stuck   text;
  f         jsonb;
begin
  select count(*) into v_left from jsonb_array_elements(v_all);

  while v_left > 0 loop
    v_settled := 0;

    for f in
      select t.x from jsonb_array_elements(v_all) with ordinality as t(x, ord)
       order by coalesce((t.x ->> 'sequence')::integer, 0), t.ord
    loop
      v_key := f ->> 'key';
      if v_done ? v_key then
        continue;
      end if;

      select coalesce(array_agg(e.value), '{}'::text[]) into v_refs
        from (
          select jsonb_array_elements_text(coalesce(f -> 'plus', '[]'::jsonb)) as value
          union all
          select jsonb_array_elements_text(coalesce(f -> 'minus', '[]'::jsonb))
        ) as e;

      -- Ready when every reference that names another formula has been worked
      -- out already.
      v_ready := true;
      foreach v_ref in array v_refs loop
        if exists (
          select 1 from jsonb_array_elements(v_all) as g(x)
           where (g.x ->> 'key') <> v_key
             and not (v_done ? (g.x ->> 'key'))
             and case when strpos(v_ref, ':') > 0
                      then (g.x ->> 'key') = replace(v_ref, ':', '|')
                      else split_part((g.x ->> 'key'), '|', 1) = v_ref
                 end
        ) then
          v_ready := false;
        end if;
      end loop;
      if not v_ready then
        continue;
      end if;

      v_amount := 0;
      for v_ref in
        select jsonb_array_elements_text(coalesce(f -> 'plus', '[]'::jsonb))
      loop
        select coalesce(sum(e.value::numeric), 0) into v_part
          from jsonb_each_text(v_values) as e(key, value)
         where case when strpos(v_ref, ':') > 0
                    then e.key = replace(v_ref, ':', '|')
                    else split_part(e.key, '|', 1) = v_ref
               end;
        v_amount := v_amount + v_part;
      end loop;
      for v_ref in
        select jsonb_array_elements_text(coalesce(f -> 'minus', '[]'::jsonb))
      loop
        select coalesce(sum(e.value::numeric), 0) into v_part
          from jsonb_each_text(v_values) as e(key, value)
         where case when strpos(v_ref, ':') > 0
                    then e.key = replace(v_ref, ':', '|')
                    else split_part(e.key, '|', 1) = v_ref
               end;
        v_amount := v_amount - v_part;
      end loop;

      -- The floor belongs to the pair it splits — the Belgian 71 and 72, the
      -- French 25 and 28 — so it applies before the sign the caller reads the
      -- line with.
      if coalesce((f ->> 'floor_zero')::boolean, false) then
        v_amount := greatest(v_amount, 0);
      end if;
      v_amount := round(v_amount * coalesce((f ->> 'factor')::numeric, 1), 2);

      v_values := v_values || jsonb_build_object(v_key, v_amount);
      v_done   := v_done   || jsonb_build_object(v_key, true);
      if p_keep_zero or v_amount <> 0 then
        v_out := v_out || jsonb_build_object(v_key, v_amount);
      end if;
      v_settled := v_settled + 1;
      v_left := v_left - 1;
    end loop;

    if v_settled = 0 then
      select string_agg(t.x ->> 'key', ', ' order by t.x ->> 'key') into v_stuck
        from jsonb_array_elements(v_all) as t(x)
       where not (v_done ? (t.x ->> 'key'));
      raise exception 'formula_cycle: these totals depend on each other and on nothing else: %', v_stuck;
    end if;
  end loop;

  return v_out;
end;
$$;

comment on function evaluate_totals(jsonb, jsonb, boolean) is
  'Works out the plus/minus totals of a declaration form or of a financial statement, in the order they depend on each other. The one place that calculation lives: vat_return() and financial_statement() both call it.';

-- ---------------------------------------------------------------------------
-- financial_statement
-- ---------------------------------------------------------------------------

create or replace function financial_statement(
  p_company_id     uuid,
  p_statement_code text,
  p_from           date,
  p_to             date
)
returns table (
  line_code    text,
  parent_code  text,
  name         text,
  sequence     integer,
  is_total     boolean,
  amount       numeric,
  xbrl_element text
)
language plpgsql
stable
as $$
declare
  -- line code -> amount: the lines summed from the ledger, then the totals
  -- `evaluate_totals()` derives from them.
  v_values   jsonb := '{}'::jsonb;
  v_formulas jsonb := '[]'::jsonb;
  v_rows     jsonb := '[]'::jsonb;
  r          record;
begin
  if not exists (select 1 from companies c where c.id = p_company_id) then
    raise exception 'unknown_company: %', p_company_id;
  end if;
  if not exists (select 1 from statement_templates s where s.code = p_statement_code) then
    raise exception 'unknown_statement: % is not a statement of this installation', p_statement_code;
  end if;

  -- 1. The lines summed from the ledger. All of them first, whatever their
  --    place in the scheme: a scheme prints a subtotal above the lines it adds
  --    up — every balance sheet does — and only a total that names another
  --    total depends on an order, which the evaluator keeps.
  select coalesce(jsonb_object_agg(l.code, round(coalesce(s.balance, 0) * l.sign, 2)), '{}'::jsonb)
    into v_values
    from statement_line_templates l
    left join (
      select m.line_code, round(sum(m.balance), 2) as balance
        from statement_account_matches(p_company_id, p_statement_code, p_from, p_to) m
       where m.line_code is not null
       group by m.line_code
    ) s on s.line_code = l.code
   where l.statement_code = p_statement_code
     and not l.is_total;

  -- 2. The totals, worked out by the one evaluator the declaration forms use.
  --    A statement prints its whole frame, so every total comes back, and the
  --    sign it reads the line with is the factor.
  select coalesce(jsonb_agg(jsonb_build_object(
           'key', l.code, 'plus', to_jsonb(l.plus_lines), 'minus', to_jsonb(l.minus_lines),
           'factor', l.sign, 'sequence', l.sequence
         ) order by l.sequence, l.code), '[]'::jsonb)
    into v_formulas
    from statement_line_templates l
   where l.statement_code = p_statement_code
     and l.is_total;

  v_values := v_values || evaluate_totals(v_values, v_formulas, true);

  -- 3. The frame, in the order it is printed. Every line is returned, nil
  --    included: a statement is read top to bottom and tied out, where a
  --    declaration prints what it has — which is why `vat_return()` drops a
  --    nil box and this does not.
  for r in
    select l.code, l.parent_code, l.name, l.sequence, l.is_total, l.xbrl_element
      from statement_line_templates l
     where l.statement_code = p_statement_code
     order by l.sequence, l.code
  loop
    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'line_code', r.code, 'parent_code', r.parent_code, 'name', r.name,
      'sequence', r.sequence, 'is_total', r.is_total,
      'amount', coalesce((v_values ->> r.code)::numeric, 0),
      'xbrl_element', r.xbrl_element));
  end loop;

  return query
  select (x ->> 'line_code')::text,
         (x ->> 'parent_code')::text,
         (x ->> 'name')::text,
         (x ->> 'sequence')::integer,
         (x ->> 'is_total')::boolean,
         (x ->> 'amount')::numeric,
         (x ->> 'xbrl_element')::text
    from jsonb_array_elements(v_rows) as x;
end;
$$;

comment on function financial_statement(uuid, text, date, date) is
  'One financial statement of a company for a period: each line summed from the accounts its rules catch, then the totals evaluated in the order the scheme declares them. No country rule lives in this function.';

-- ---------------------------------------------------------------------------
-- unmapped_accounts — what the statement would silently leave out
-- ---------------------------------------------------------------------------

create or replace function unmapped_accounts(
  p_company_id     uuid,
  p_statement_code text,
  p_from           date,
  p_to             date
)
returns table (
  account_id   uuid,
  account_code text,
  account_name text,
  account_type account_type,
  balance      numeric
)
language sql
stable
as $$
  select m.account_id, m.account_code, m.account_name, m.account_type, m.balance
    from statement_account_matches(p_company_id, p_statement_code, p_from, p_to) m
    join accounts a on a.id = m.account_id
   cross join (select s.kind from statement_templates s where s.code = p_statement_code) st
   where m.line_code is null
     and m.balance <> 0
     -- Only what this statement is answerable for. A revenue account is not
     -- missing from a balance sheet, and a statement that claims no
     -- completeness — an allocation section, a cash flow — reports nothing.
     and case st.kind
           when 'balance_sheet'    then a.internal_group in ('asset', 'liability', 'equity')
           when 'income_statement' then a.internal_group in ('income', 'expense')
           else false
         end
   order by m.account_code;
$$;

comment on function unmapped_accounts(uuid, text, date, date) is
  'Accounts this statement is answerable for that carry a balance and that no rule of it catches. Empty is what makes the statement tie out; a row is an account somebody opened outside the pack.';

-- ---------------------------------------------------------------------------
-- available_statements — what a company can ask for
-- ---------------------------------------------------------------------------

create or replace function available_statements(p_company_id uuid, p_at date default null)
returns table (
  code       text,
  name       text,
  kind       text,
  framework  text,
  country    char(2),
  chart_code text,
  is_default boolean
)
language sql
stable
as $$
  with company as (
    select c.id, c.fiscal_country,
           coalesce(
             (select p.chart_code from company_packs p
               where p.company_id = c.id and p.country = c.fiscal_country),
             (select ch.code from chart_templates ch
               where ch.country = c.fiscal_country and ch.is_default)
           ) as chart_code
      from companies c where c.id = p_company_id
  )
  select s.code, s.name, s.kind, s.framework, s.country, s.chart_code,
         coalesce(s.code = any (ch.statements), false)
    from statement_templates s
    cross join company co
    left join chart_templates ch
      on ch.country = co.fiscal_country and ch.code = co.chart_code
   where (s.country is null or s.country = co.fiscal_country)
     and (s.chart_code is null or s.chart_code = co.chart_code)
     and s.valid_from <= coalesce(p_at, current_date)
     and (s.valid_to is null or s.valid_to >= coalesce(p_at, current_date))
   order by s.country nulls last, s.kind, s.code;
$$;

comment on function available_statements(uuid, date) is
  'Statements a company may ask for: those of its country and chart, plus the generic framework. `is_default` marks the ones its chart declares.';

-- ---------------------------------------------------------------------------
-- Row level security
--
-- A scheme is reference data, like a chart of accounts and a declaration
-- form: any signed-in user may read it, and nobody writes it but the
-- generated seed, which runs as the owner. No write policy at all.
-- ---------------------------------------------------------------------------

alter table statement_templates      enable row level security;
alter table statement_line_templates enable row level security;
alter table statement_line_rules     enable row level security;

create policy statement_templates_select on statement_templates
  for select using (auth.uid() is not null);
create policy statement_line_templates_select on statement_line_templates
  for select using (auth.uid() is not null);
create policy statement_line_rules_select on statement_line_rules
  for select using (auth.uid() is not null);

comment on policy statement_templates_select on statement_templates is
  'Reference data, readable by any signed-in user. No write policy: a statement comes from a pack.';

-- ---------------------------------------------------------------------------
-- One comment corrected
--
-- `20260912074712` said `statement_hint` would be "read by
-- financial_statement() (P0-4)". It is not: the rules of a statement decide
-- which line an account falls on, which is a property of the scheme and not of
-- the account, and a hint on the account would be a second place to keep in
-- step. The column stays — a chart may carry the intent, and a contributor
-- writing a pack has somewhere to put it — and its comment now says so.
-- ---------------------------------------------------------------------------

comment on column account_templates.statement_hint is
  'Free note: the statement line this account is meant for. Read by nothing — the rules of a statement decide — and kept so a chart can carry the intent.';
comment on column accounts.statement_hint is
  'Free note: the statement line this account is meant for. Read by nothing — the rules of a statement decide — and kept so a chart can carry the intent.';

-- Rule 6 of supabase/migrations/README.md.
revoke execute on all functions in schema public from public;
