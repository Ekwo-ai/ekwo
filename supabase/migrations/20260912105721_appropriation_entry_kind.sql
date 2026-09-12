-- Ekwo OS — the appropriation entry says where the result went.
--
-- The value was added in the migration before this one; this file is what uses
-- it. Three functions change and nothing else:
--
--   `close_fiscal_year()`        marks the appropriation entry `appropriation`.
--                                The closing entry keeps `closing`.
--   `reopen_fiscal_year()`       undoes both kinds, as it undid one.
--   `statement_account_matches()` leaves `closing` out of an income statement
--                                and out of an allocation section, and keeps
--                                `appropriation` in both.
--
-- What that buys: after a Belgian year-end, `financial_statement(...,
-- 'BE-BNB-ABBR-AF', ...)` reads the result on the line the scheme prints it
-- on, instead of the nil two entries that cancel each other produce. The
-- income statement is unchanged — it was already right, because 693 and 793
-- reach no line of it — and so is every balance sheet.
--
-- The guard on `entries.kind` needs nothing: it already admits any value under
-- the session flag the three year-end functions set, and refuses every value
-- but `normal` outside it.

-- ---------------------------------------------------------------------------
-- close_fiscal_year — the appropriation entry, by its own name
-- ---------------------------------------------------------------------------

create or replace function close_fiscal_year(p_fiscal_year_id uuid)
returns jsonb
language plpgsql
as $$
declare
  v_year        fiscal_years%rowtype;
  v_company     companies%rowtype;
  v_defaults    country_defaults%rowtype;
  v_journal     uuid;
  v_result      numeric(16, 2);
  v_profit      boolean;
  v_kind        text;
  v_cyr         uuid;          -- current-year result account, the side that applies
  v_retained    uuid;          -- retained earnings, the side that applies
  v_carries     boolean;
  v_appropriate uuid;
  v_closing     uuid;
  v_entry       entries%rowtype;
  v_lines       integer;
  v_debits      numeric(16, 2);
  v_credits     numeric(16, 2);
begin
  select * into v_year from fiscal_years where id = p_fiscal_year_id for update;
  if not found then
    raise exception 'unknown_fiscal_year: fiscal year % does not exist', p_fiscal_year_id;
  end if;
  if v_year.is_closed then
    raise exception 'fiscal_year_already_closed: % was closed on %', v_year.name, v_year.closed_at;
  end if;

  select * into v_company from companies where id = v_year.company_id;

  -- 1. What has to be true before a year can be closed.

  if exists (
    select 1 from entries e
     where e.company_id = v_year.company_id
       and e.entry_date between v_year.start_date and v_year.end_date
       and e.state = 'draft'
  ) then
    raise exception 'fiscal_year_has_drafts: % still holds draft entries; post or cancel them first', v_year.name;
  end if;

  if exists (
    select 1 from fiscal_years f
     where f.company_id = v_year.company_id
       and f.start_date < v_year.start_date
       and not f.is_closed
       and exists (select 1 from entries e where e.fiscal_year_id = f.id and e.state = 'posted')
  ) then
    raise exception 'earlier_fiscal_year_open: a year before % holds posted entries and is not closed', v_year.name;
  end if;

  if exists (
    select 1 from fiscal_years f
     where f.company_id = v_year.company_id
       and f.start_date > v_year.start_date
       and f.is_closed
  ) then
    raise exception 'later_fiscal_year_closed: a year after % is already closed; re-open it first', v_year.name;
  end if;

  -- 2. The accounts the result travels through, from the country model.

  select * into v_defaults from country_defaults where country = v_company.country;
  if not found then
    raise exception 'unknown_country_template: no country model for %; close_fiscal_year reads its accounts from the pack',
      v_company.country;
  end if;

  if v_defaults.closing_style is null then
    raise exception 'no_closing_defaults: the pack of this company says nothing about how a year is closed. Set defaults.closing_style, and the account roles it needs, in the pack.'
      using errcode = '55006';
  end if;

  v_journal := opening_journal_id(v_year.company_id);
  if v_journal is null then
    raise exception 'no_opening_journal: the pack of this company names no journal of type opening. Set defaults.journal_roles.opening in the pack, which fills country_defaults.opening_journal_code.'
      using errcode = '55006';
  end if;

  -- The result of the year: income less expense, over the accounts that do
  -- not carry forward. A credit balance is a profit.
  select coalesce(-sum(l.balance), 0) into v_result
    from entry_lines l
    join entries e on e.id = l.entry_id and e.state = 'posted'
    join accounts a on a.id = l.account_id
   where l.company_id = v_year.company_id
     and e.entry_date between v_year.start_date and v_year.end_date
     and not a.carries_forward;

  v_profit := v_result >= 0;
  v_kind := case when v_result > 0 then 'profit'
                 when v_result < 0 then 'loss'
                 else 'nil' end;

  v_retained := coalesce(
    case when v_profit then v_company.retained_earnings_account_id end,
    account_id_by_code(v_year.company_id,
      case when v_profit then v_defaults.retained_earnings_code
           else coalesce(v_defaults.retained_earnings_loss_code, v_defaults.retained_earnings_code) end));

  v_cyr := account_id_by_code(v_year.company_id,
    case when v_profit then v_defaults.current_year_result_profit_code
         else v_defaults.current_year_result_loss_code end);

  if v_defaults.closing_style = 'retained_earnings' then
    if v_retained is null then
      raise exception 'no_retained_earnings_account: the country model of % names none, and the company has none',
        v_company.country;
    end if;
    v_cyr := v_retained;
  else
    if v_cyr is null then
      raise exception 'no_current_year_result_account: the country model of % names no account for a %',
        v_company.country, v_kind;
    end if;
  end if;

  -- A style is a promise about where the result sits at the end. Assert it
  -- rather than trust it: a pack that names an income account where the
  -- balance sheet is expected would carry nothing forward, silently.
  select a.carries_forward into v_carries from accounts a where a.id = v_cyr;
  if v_defaults.closing_style = 'appropriation_accounts' and v_carries then
    raise exception 'closing_style_mismatch: % expects an appropriation account inside the income statement, and % carries forward',
      v_defaults.closing_style, v_cyr;
  end if;
  if v_defaults.closing_style <> 'appropriation_accounts' and not v_carries then
    raise exception 'closing_style_mismatch: % expects an account on the balance sheet, and % does not carry forward',
      v_defaults.closing_style, v_cyr;
  end if;

  -- 3. The appropriation entry: the result leaves the income statement
  --    through an account that is itself part of it, and lands on retained
  --    earnings. Only the third style has one, and only when there is a
  --    result to move.

  if v_defaults.closing_style = 'appropriation_accounts' and v_result <> 0 then
    if v_retained is null then
      raise exception 'no_retained_earnings_account: the country model of % names none, and the company has none',
        v_company.country;
    end if;

    perform set_config('ekwo.year_end_entry', 'on', true);
    insert into entries (company_id, journal_id, fiscal_year_id, entry_date,
                         description, state, kind)
    values (v_year.company_id, v_journal, v_year.id, v_year.end_date,
            'Result of the year', 'draft', 'appropriation')
    returning * into v_entry;
    perform set_config('ekwo.year_end_entry', 'off', true);
    v_appropriate := v_entry.id;

    insert into entry_lines (entry_id, company_id, account_id, sequence, name, debit, credit)
    values (v_appropriate, v_year.company_id, v_cyr, 10, 'Result of the year',
            case when v_profit then abs(v_result) else 0 end,
            case when v_profit then 0 else abs(v_result) end),
           (v_appropriate, v_year.company_id, v_retained, 20, 'Result of the year',
            case when v_profit then 0 else abs(v_result) end,
            case when v_profit then abs(v_result) else 0 end);

    perform post_entry(v_appropriate);
  end if;

  -- 4. The closing entry: every income and expense account back to zero.
  --    In the first two styles the difference is the result and goes to the
  --    account chosen above; in the third the accounts already net to zero,
  --    because the appropriation entry put the result among them.

  perform set_config('ekwo.year_end_entry', 'on', true);
  insert into entries (company_id, journal_id, fiscal_year_id, entry_date,
                       description, state, kind)
  values (v_year.company_id, v_journal, v_year.id, v_year.end_date,
          'Closing entry', 'draft', 'closing')
  returning * into v_entry;
  perform set_config('ekwo.year_end_entry', 'off', true);
  v_closing := v_entry.id;

  insert into entry_lines (entry_id, company_id, account_id, sequence, name, debit, credit)
  select v_closing, v_year.company_id, s.account_id,
         row_number() over (order by s.code) * 10,
         'Closing entry',
         case when s.balance < 0 then -s.balance else 0 end,
         case when s.balance > 0 then s.balance else 0 end
    from (
      select a.id as account_id, a.code,
             round(sum(l.balance), 2) as balance
        from entry_lines l
        join entries e on e.id = l.entry_id and e.state = 'posted'
        join accounts a on a.id = l.account_id
       where l.company_id = v_year.company_id
         and e.entry_date between v_year.start_date and v_year.end_date
         and not a.carries_forward
       group by a.id, a.code
      having round(sum(l.balance), 2) <> 0
    ) s;

  select count(*) into v_lines from entry_lines where entry_id = v_closing;

  if v_lines = 0 then
    delete from entries where id = v_closing;
    v_closing := null;
  else
    if v_defaults.closing_style <> 'appropriation_accounts' and v_result <> 0 then
      insert into entry_lines (entry_id, company_id, account_id, sequence, name, debit, credit)
      values (v_closing, v_year.company_id, v_cyr, 1000000, 'Result of the year',
              case when v_profit then 0 else abs(v_result) end,
              case when v_profit then abs(v_result) else 0 end);
    end if;

    select total_debit, total_credit into v_debits, v_credits from entries where id = v_closing;
    if v_debits <> v_credits then
      raise exception 'closing_unbalanced: the closing entry has debit % and credit %. The income statement of % does not net to its result.',
        v_debits, v_credits, v_year.name;
    end if;

    perform post_entry(v_closing);
  end if;

  -- 5. The year is closed, and only from here.

  perform set_config('ekwo.closing_fiscal_year', 'on', true);
  update fiscal_years
     set is_closed = true,
         closed_at = now()
   where id = p_fiscal_year_id;
  perform set_config('ekwo.closing_fiscal_year', 'off', true);

  return jsonb_build_object(
    'fiscal_year_id', p_fiscal_year_id,
    'closing_style', v_defaults.closing_style,
    'result', to_char(v_result, 'FM9999999999999990.00'),
    'result_kind', v_kind,
    'appropriation_entry_id', v_appropriate,
    'closing_entry_id', v_closing
  );
end;
$$;

comment on function close_fiscal_year(uuid) is
  'Closes a fiscal year: the result leaves the income statement the way the country model says, and every income and expense account goes back to zero. The entry that moves the result is `appropriation`, the one that empties the income statement is `closing`. The balance sheet needs no entry — the reports read the ledger from the beginning. The allocation decided by a meeting is never part of it.';

-- ---------------------------------------------------------------------------
-- reopen_fiscal_year — undoes both of them
-- ---------------------------------------------------------------------------

create or replace function reopen_fiscal_year(p_fiscal_year_id uuid)
returns jsonb
language plpgsql
as $$
declare
  v_year      fiscal_years%rowtype;
  v_original  entries%rowtype;
  v_reversal  entries%rowtype;
  v_reversed  uuid[] := '{}';
begin
  select * into v_year from fiscal_years where id = p_fiscal_year_id for update;
  if not found then
    raise exception 'unknown_fiscal_year: fiscal year % does not exist', p_fiscal_year_id;
  end if;
  if not v_year.is_closed then
    raise exception 'fiscal_year_not_closed: % is already open', v_year.name;
  end if;

  -- Re-opening a year changes its result, and the result stands on the
  -- balance sheet every later year reads. So a year that has been built on is
  -- not a year that can be quietly restated.
  if exists (
    select 1 from fiscal_years f
     where f.company_id = v_year.company_id
       and f.start_date > v_year.end_date
       and (f.is_closed or exists (
         select 1 from entries e where e.fiscal_year_id = f.id and e.state = 'posted'))
  ) then
    raise exception 'next_fiscal_year_in_use: a year after % is closed or already holds posted entries', v_year.name;
  end if;

  -- The flag first: the reversals are dated inside the year being re-opened,
  -- and the period guard would refuse them while it is closed.
  perform set_config('ekwo.closing_fiscal_year', 'on', true);
  update fiscal_years
     set is_closed = false,
         closed_at = null
   where id = p_fiscal_year_id;
  perform set_config('ekwo.closing_fiscal_year', 'off', true);

  for v_original in
    select e.*
      from entries e
     where e.company_id = v_year.company_id
       and e.state = 'posted'
       and e.kind in ('closing', 'appropriation')
       and e.fiscal_year_id = p_fiscal_year_id
       and e.reversed_entry_id is null
       and not exists (
         select 1 from entries r where r.reversed_entry_id = e.id and r.state = 'posted'
       )
     order by e.entry_date, e.number
  loop
    -- A reversal carries the kind of what it undoes: it belongs to the same
    -- report exclusion, and a closing entry undone by a `normal` one would
    -- reappear in the income statement on its own.
    perform set_config('ekwo.year_end_entry', 'on', true);
    insert into entries (company_id, journal_id, fiscal_year_id, entry_date,
                         description, state, reversed_entry_id, currency_code, kind)
    values (v_original.company_id, v_original.journal_id, v_original.fiscal_year_id,
            v_original.entry_date, 'Reversal of ' || v_original.number, 'draft',
            v_original.id, v_original.currency_code, v_original.kind)
    returning * into v_reversal;
    perform set_config('ekwo.year_end_entry', 'off', true);

    insert into entry_lines (entry_id, company_id, account_id, sequence, name,
                             debit, credit, contact_id, date_maturity, currency_code)
    select v_reversal.id, l.company_id, l.account_id, l.sequence, l.name,
           l.credit, l.debit, l.contact_id, l.date_maturity, l.currency_code
      from entry_lines l
     where l.entry_id = v_original.id
     order by l.sequence;

    perform post_entry(v_reversal.id);
    v_reversed := v_reversed || v_reversal.id;
  end loop;

  return jsonb_build_object(
    'fiscal_year_id', p_fiscal_year_id,
    'reversal_entry_ids', to_jsonb(v_reversed)
  );
end;
$$;

comment on function reopen_fiscal_year(uuid) is
  'Undoes a close: reverses the appropriation and closing entries it wrote and clears is_closed. Refused once a later year is closed or holds entries of its own.';

-- ---------------------------------------------------------------------------
-- statement_account_matches — which entries a statement is answerable for
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
       -- closed year reads as a result of zero. An allocation section leaves
       -- it out for the same reason and keeps the appropriation entry, which
       -- is the movement it exists to show. A balance sheet keeps both, and
       -- must: together they are what puts the result on the line it shows.
       and (st.kind not in ('income_statement', 'allocation') or e.kind <> 'closing')
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
  'Every account of a company with a balance in the period, and the statement line it falls on — null when no rule catches it. An income statement and an allocation section leave the closing entry out; a balance sheet keeps it. The single decision financial_statement() and unmapped_accounts() both read.';

-- Rule 6 of supabase/migrations/README.md.
revoke execute on all functions in schema public from public;
