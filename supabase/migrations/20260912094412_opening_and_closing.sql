-- Ekwo OS — opening balances and a year-end close that is parameterised.
--
-- The first release said, in `docs/decisions.md`: "No fiscal year closing
-- function yet. Carrying balances forward and merging the result into
-- retained earnings is a real piece of work with several national variants."
-- This migration is that work, and the finding of the pack analysis is that
-- the national variants are smaller than they look.
--
-- In Belgium, in France, in the United Kingdom and in the United States the
-- mechanism is the same two steps:
--
--   1. move the result of the year out of the income statement,
--   2. zero every income and expense account, and close the year.
--
-- What differs is *which account the result travels through*, and that is a
-- value, not a branch. Three styles cover the four countries above, and they
-- are named after the mechanism rather than after a country:
--
--   `retained_earnings`       the result is closed straight into retained
--                             earnings (United Kingdom, United States).
--   `result_accounts`         it is closed into a current-year result account
--                             that sits on the balance sheet, where it waits
--                             for the meeting that allocates it (France:
--                             120 for a profit, 129 for a loss).
--   `appropriation_accounts`  it first travels through an appropriation
--                             account that is itself part of the income
--                             statement, and from there to retained earnings
--                             (Belgium: 693 to 140 for a profit, 793 to 141
--                             for a loss). Those two accounts have to carry a
--                             movement of their own, because the statutory
--                             income statement ends on them.
--
-- So `close_fiscal_year` posts up to two entries. The **appropriation entry**
-- comes first and only exists in the third style: it is the one that puts 693
-- or 793 on the income statement. The **closing entry** then zeroes every
-- income and expense account, and needs a counterpart only in the first two
-- styles — in the third the accounts net to zero on their own, which the
-- function asserts rather than assumes.
--
-- **There is no entry that carries the balance sheet into the next year**,
-- and that is a deliberate departure from the way a Belgian or French package
-- prints an *à-nouveaux*. Every report in this schema reads the ledger from
-- the beginning: `trial_balance` computes the opening balance of a period as
-- the sum of everything booked before it, so a balance-sheet account already
-- stands on 1 January at exactly the figure it carried on 31 December. An
-- opening entry on top of that does not carry the balance forward, it counts
-- it twice — the first version of this function did, and a test now forbids
-- it. What the opening journal carries is the *first* opening of a set of
-- books, which is `opening_balance` below, and the year-end entries, which
-- are the ones dated on the last day of a year. The day a per-exercise
-- balance is wanted instead, the reports change first and the à-nouveaux
-- follows; doing it the other way round makes every carried balance double.
--
-- One consequence to know: after a year is closed, its income statement read
-- from the *movements* of that year is zero, because the closing entry is one
-- of them. That is what a post-closing trial balance is, and it is true of
-- every system that closes the income statement at all. The statements of
-- P0-4 read a closed year by leaving out the entries of the opening journal
-- dated on its last day.
--
-- What is deliberately *not* here: the allocation decided by a general
-- meeting. Dividends, the legal reserve, the transfer of a French 120 to 110
-- or 106 — all of that is a later entry taken by people, and a close that
-- guessed at it would be writing a decision nobody made.
--
-- `fiscal_years.is_closed` stops being an ordinary column: a trigger refuses
-- to let anyone set it, and the two functions below set a transaction-local
-- setting that the trigger recognises. The flag decides whether a whole year
-- accepts entries, and a column that any client may flip is not a lock.

-- ---------------------------------------------------------------------------
-- The parameter, as data
-- ---------------------------------------------------------------------------

create type closing_style as enum (
  'retained_earnings',
  'result_accounts',
  'appropriation_accounts'
);

comment on type closing_style is
  'How the year-end close moves the result: straight to retained earnings, through a balance-sheet result account, or through an appropriation account of the income statement.';

-- **No column here carries a default**, and that is the point. A default
-- closing style would be one country's mechanism applied to every country
-- that has not said otherwise, and `'OPN'` is the journal code Belgium and
-- France happen to use. A pack that says nothing gets a refusal naming the
-- field it is missing, never somebody else's answer: `close_fiscal_year`
-- raises `no_closing_defaults` and `no_opening_journal`, and `ekwo pack
-- check` catches both before a seed is ever written.
alter table country_defaults
  add column if not exists closing_style                   closing_style,
  add column if not exists current_year_result_profit_code text,
  add column if not exists current_year_result_loss_code   text,
  add column if not exists retained_earnings_loss_code     text,
  add column if not exists opening_journal_code            text;

comment on column country_defaults.closing_style is
  'Which of the three mechanisms close_fiscal_year() follows for a company of this country. Null until the pack says; there is no default, because a default would be one country''s answer given to every other.';
comment on column country_defaults.current_year_result_profit_code is
  'Account the result of the year lands on when the year is profitable. Belgium 693, France 120. Null where the result goes straight to retained earnings.';
comment on column country_defaults.current_year_result_loss_code is
  'Same, for a loss. Belgium 793, France 129. Both countries keep a profit and a loss apart, so this is a pair and not one account.';
comment on column country_defaults.retained_earnings_loss_code is
  'Retained earnings account for an accumulated loss, where the chart keeps one apart from the profit account. Belgium 141, France 119. Null falls back to retained_earnings_code.';
comment on column country_defaults.opening_journal_code is
  'Code of the journal the opening and the year-end entries are booked on, from the pack. Null until the pack names one, and then nothing opens or closes: there is no code written into the schema to fall back on.';

-- ---------------------------------------------------------------------------
-- What an entry is for
--
-- A closing entry is not an ordinary one: it exists to take the income
-- statement back to zero, so a report that shows the income statement of a
-- closed year has to leave it out. Until this column, the only way to know
-- was a heuristic — a journal of type `opening`, dated on the first or the
-- last day of a fiscal year — and a statement built on a heuristic is a
-- statement that goes wrong the first time somebody books something by hand
-- on that journal.
--
-- `normal` is every entry a business writes. `opening` is the one entry that
-- opens a set of books. `closing` is what `close_fiscal_year` writes, the
-- appropriation entry included, and so are the reversals `reopen_fiscal_year`
-- posts against them — a reversal belongs to the same report exclusion as
-- what it undoes.
--
-- The column is **not writable by hand**, for the same reason `is_closed` is
-- not: a label a client may set is a label a report cannot be built on, and
-- an ordinary purchase invoice quietly marked `closing` would disappear from
-- an income statement without anything looking wrong. The three functions
-- below set `ekwo.year_end_entry` while they write; nothing else may move the
-- column off `normal`.
-- ---------------------------------------------------------------------------

create type entry_kind as enum ('normal', 'opening', 'closing');

comment on type entry_kind is
  'What an entry is for. A report of a closed year leaves out what is not normal.';

alter table entries
  add column if not exists kind entry_kind not null default 'normal';

comment on column entries.kind is
  'normal, opening or closing. Written by opening_balance(), close_fiscal_year() and reopen_fiscal_year(), and by nothing else.';

create index if not exists entries_kind_idx on entries (company_id, kind) where kind <> 'normal';

-- An installation that already booked its opening by hand keeps it: the
-- heuristic this column replaces runs once, here, and never again.
update entries e
   set kind = case when e.entry_date = f.start_date then 'opening'::entry_kind
                   else 'closing'::entry_kind end
  from fiscal_years f
  join companies c on c.id = f.company_id
 where f.id = e.fiscal_year_id
   and e.journal_id in (select j.id from journals j
                         where j.company_id = e.company_id and j.journal_type = 'opening')
   and e.entry_date in (f.start_date, f.end_date);

create or replace function entries_guard_kind()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('ekwo.year_end_entry', true), '') = 'on' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.kind <> 'normal' then
      raise exception 'entry_kind_not_a_column: an opening or closing entry is written by opening_balance() and close_fiscal_year(), not by hand'
        using errcode = '55006';
    end if;
    return new;
  end if;

  if new.kind is distinct from old.kind then
    raise exception 'entry_kind_not_a_column: kind is written by opening_balance() and close_fiscal_year(), not by hand'
      using errcode = '55006';
  end if;

  return new;
end;
$$;

comment on function entries_guard_kind() is
  'Keeps entries.kind on `normal` outside the three functions that open and close a year. A label any client may set is a label a statement cannot be built on.';

create trigger entries_guard_kind
  before insert or update on entries
  for each row execute function entries_guard_kind();

-- ---------------------------------------------------------------------------
-- Closing a year is an act, not a column
--
-- `is_closed` decides whether a whole period accepts entries, and until now
-- any client that could write a fiscal year could flip it — which is the same
-- as having no lock. A trigger refuses the *transition*: an update that
-- changes `is_closed` or `closed_at` raises unless
-- `ekwo.closing_fiscal_year` is set, and the only two things that set it are
-- `close_fiscal_year()` and `reopen_fiscal_year()`. The setting is
-- transaction-local — `set_config(..., true)` — so it is gone when the
-- function returns, and a client that guesses the name still has to be inside
-- a transaction it does not control.
--
-- Creating a year that is *already* closed stays allowed, because it is not
-- the same act: it describes a year that happened in whatever kept the books
-- before, it computes nothing and it writes no entry. That is how a company
-- arrives with three closed years and one open one, next to the opening
-- balance that carries their result. What it cannot do is re-open them: the
-- transition is guarded in both directions.
-- ---------------------------------------------------------------------------

create or replace function fiscal_years_guard_closed()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('ekwo.closing_fiscal_year', true), '') = 'on' then
    return new;
  end if;

  if new.is_closed is distinct from old.is_closed
     or new.closed_at is distinct from old.closed_at then
    raise exception 'fiscal_year_close_not_a_column: is_closed is set by close_fiscal_year() and cleared by reopen_fiscal_year()'
      using errcode = '55006';
  end if;

  return new;
end;
$$;

comment on function fiscal_years_guard_closed() is
  'Refuses a hand-written change to is_closed. A column any client may flip is not a lock.';

create trigger fiscal_years_guard_closed
  before update on fiscal_years
  for each row execute function fiscal_years_guard_closed();

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function opening_journal_id(p_company_id uuid)
returns uuid
language sql
stable
as $$
  select j.id
    from companies c
    join country_defaults d on d.country = c.country
    join journals j on j.company_id = c.id
                   and j.code = d.opening_journal_code
                   and j.journal_type = 'opening'
                   and j.active
   where c.id = p_company_id
   limit 1;
$$;

comment on function opening_journal_id(uuid) is
  'The journal the opening and year-end entries go on, named by the pack of this company''s country. Null when the pack names none, and the callers refuse rather than guessing at a code.';

-- An entry that has been reversed, and a reversal itself, cancel out. So
-- "does this year already hold an opening entry" is a question about the ones
-- that are still standing, otherwise a year that was closed, re-opened and
-- closed again could never be closed a third time.
create or replace function has_opening_entry(p_fiscal_year_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
      from entries e
     where e.fiscal_year_id = p_fiscal_year_id
       and e.state = 'posted'
       and e.kind = 'opening'
       and e.reversed_entry_id is null
       and not exists (
         select 1 from entries r
          where r.reversed_entry_id = e.id and r.state = 'posted'
       )
  );
$$;

comment on function has_opening_entry(uuid) is
  'Whether a fiscal year already carries an opening entry that still stands — an imported balance or the re-opening of the year before.';

-- ---------------------------------------------------------------------------
-- opening_balance
--
-- The natural import format from whatever kept the books until now: a trial
-- balance, one row per account, a debit or a credit. It becomes one entry on
-- the opening journal, dated on the first day of the year.
--
-- Income and expense accounts are refused unless the caller says otherwise.
-- A year that starts with a profit already on it is the commonest way an
-- import goes wrong, and the balance sheet is what an opening balance is made
-- of. `p_allow_result_accounts` exists for the one case where it is right:
-- taking the books over in the middle of a year that has already run, where
-- the movements of the months before have to arrive somehow.
-- ---------------------------------------------------------------------------

create or replace function opening_balance(
  p_company_id            uuid,
  p_fiscal_year_id        uuid,
  p_lines                 jsonb,
  p_allow_result_accounts boolean default false
)
returns uuid
language plpgsql
as $$
declare
  v_year     fiscal_years%rowtype;
  v_journal  uuid;
  v_entry    entries%rowtype;
  v_line     jsonb;
  v_account  uuid;
  v_code     text;
  v_debit    numeric(16, 2);
  v_credit   numeric(16, 2);
  v_carries  boolean;
  v_sequence integer := 0;
  v_debits   numeric(16, 2) := 0;
  v_credits  numeric(16, 2) := 0;
begin
  select * into v_year from fiscal_years where id = p_fiscal_year_id;
  if not found then
    raise exception 'unknown_fiscal_year: fiscal year % does not exist', p_fiscal_year_id;
  end if;
  if v_year.company_id <> p_company_id then
    raise exception 'fiscal_year_other_company: fiscal year % does not belong to company %',
      p_fiscal_year_id, p_company_id;
  end if;
  if v_year.is_closed then
    raise exception 'fiscal_year_closed: % is closed', v_year.name
      using errcode = '55006';
  end if;
  if has_opening_entry(p_fiscal_year_id) then
    raise exception 'opening_entry_exists: % already has an opening entry', v_year.name;
  end if;

  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'opening_empty: opening_balance takes a non-empty array of lines';
  end if;

  v_journal := opening_journal_id(p_company_id);
  if v_journal is null then
    raise exception 'no_opening_journal: the pack of this company names no journal of type opening. Set defaults.journal_roles.opening in the pack, which fills country_defaults.opening_journal_code.'
      using errcode = '55006';
  end if;

  perform set_config('ekwo.year_end_entry', 'on', true);
  insert into entries (company_id, journal_id, fiscal_year_id, entry_date,
                       description, state, kind)
  values (p_company_id, v_journal, p_fiscal_year_id, v_year.start_date,
          'Opening balance', 'draft', 'opening')
  returning * into v_entry;
  perform set_config('ekwo.year_end_entry', 'off', true);

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_sequence := v_sequence + 10;
    v_code := v_line ->> 'account_code';
    if v_code is null then
      raise exception 'opening_line_without_account: line % names no account_code', v_sequence / 10;
    end if;

    select a.id, a.carries_forward into v_account, v_carries
      from accounts a
     where a.company_id = p_company_id and a.code = v_code;
    if v_account is null then
      raise exception 'unknown_account: % is not an account of this company', v_code;
    end if;
    if not v_carries and not p_allow_result_accounts then
      raise exception 'opening_result_account: % is an income or expense account; an opening balance is made of the balance sheet. Pass p_allow_result_accounts when taking over books mid-year.',
        v_code;
    end if;

    v_debit  := round(coalesce((v_line ->> 'debit')::numeric, 0), 2);
    v_credit := round(coalesce((v_line ->> 'credit')::numeric, 0), 2);
    if v_debit < 0 or v_credit < 0 then
      raise exception 'opening_negative_amount: % has a negative amount; a side is chosen, never a sign', v_code;
    end if;
    if v_debit <> 0 and v_credit <> 0 then
      raise exception 'opening_two_sides: % carries both a debit and a credit', v_code;
    end if;
    if v_debit = 0 and v_credit = 0 then
      raise exception 'opening_no_amount: % carries neither a debit nor a credit', v_code;
    end if;

    insert into entry_lines (entry_id, company_id, account_id, sequence, name,
                             debit, credit, contact_id)
    values (v_entry.id, p_company_id, v_account, v_sequence,
            coalesce(v_line ->> 'label', 'Opening balance'),
            v_debit, v_credit, (v_line ->> 'contact_id')::uuid);

    v_debits  := v_debits + v_debit;
    v_credits := v_credits + v_credit;
  end loop;

  if v_debits <> v_credits then
    raise exception 'opening_unbalanced: the opening balance has debit % and credit %',
      v_debits, v_credits;
  end if;

  v_entry := post_entry(v_entry.id);
  return v_entry.id;
end;
$$;

comment on function opening_balance(uuid, uuid, jsonb, boolean) is
  'Posts a trial balance from a previous system as the opening entry of a fiscal year. Balance-sheet accounts only, unless the caller allows the others.';

-- ---------------------------------------------------------------------------
-- close_fiscal_year
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
            'Result of the year', 'draft', 'closing')
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
  'Closes a fiscal year: the result leaves the income statement the way the country model says, and every income and expense account goes back to zero. The balance sheet needs no entry — the reports read the ledger from the beginning. The allocation decided by a meeting is never part of it.';

-- ---------------------------------------------------------------------------
-- reopen_fiscal_year
--
-- A close that was run a day too early. The entries it wrote are posted, and
-- a posted entry is never deleted here: they are reversed, and the flag goes
-- back. It is refused the moment a later year has been closed or booked into
-- — at that point re-opening would silently restate a result that later years
-- already stand on.
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
       and e.kind = 'closing'
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
  'Undoes a close: reverses the entries it wrote and clears is_closed. Refused once a later year is closed or holds entries of its own.';

-- A migration that adds a function ends with this line, from PUBLIC and never
-- from `anon`: `alter default privileges ... revoke execute on functions from
-- public` does not close a function created later.
revoke execute on all functions in schema public from public;
