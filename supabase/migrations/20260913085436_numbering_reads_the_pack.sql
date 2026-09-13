-- Ekwo OS — the number a country asked for, instead of the one we built.
--
-- P0-7 put `number_format` and `numbering_gapless` on the country model and
-- said, in as many words, that `next_entry_number()` did not read them: "a
-- numbering engine that consumes a format is its own piece of work, and both
-- packs declare exactly the pattern the engine already produces, so nothing
-- moves under anybody's feet the day it lands." This is that piece of work.
--
-- **The grammar is the one already published**, in the comment on the column
-- and in `packs/schema/pack.1.json`, and it is not reinvented here:
--
--   {CODE}   the journal code
--   {YYYY}   the year, four digits — {YY} for two
--   {MM}     the month, two digits
--   {NNNN}   the counter, padded to as many N as are written
--
-- **There is no fallback.** A pack that declares no format gets
-- `no_number_format`, naming `documents.number_format` — the field it has to
-- fill — rather than `CODE/YYYY/NNNN`, which is Belgium's and France's answer
-- handed to a country that has not spoken. It is the same rule `closing_style`
-- and `fiscal_year_default` already keep, and the reason is the one P0-8 gave:
-- a default is one country's law given to every country that has not said.
--
-- **The counter follows the pattern.** A pattern that carries the year
-- restarts with it, which is what the four numbering styles of the pack
-- format compile to; a pattern that carries none counts on for the life of
-- the journal, and that series is kept under year 0 in `journal_sequences` —
-- the counter is keyed by journal and period, and 0 is the period that is not
-- a year. A `{MM}` in the pattern **prints** the month and does not restart
-- the counter: a monthly series is a fifth style, no pack declares one, and
-- inventing the behaviour before a pack asks for it is how a guess becomes a
-- rule.
--
-- **`numbering_gapless` gets its reader too**, and it is `post_entry()`: where
-- the law forbids a hole in the sequence, an entry may not be posted with a
-- number chosen by hand, because a number that skips the counter is exactly
-- how a hole appears. The core has no path that imports entries under their
-- old numbers — an opening balance is a trial balance, not a journal — so
-- nothing that exists is refused by this. The day such an import is written,
-- this is the rule it will have to argue with.

-- ---------------------------------------------------------------------------
-- One reader for both columns
-- ---------------------------------------------------------------------------

create or replace function numbering_rules(
  p_company_id uuid,
  out number_format text,
  out numbering_gapless boolean
)
language sql
stable
as $$
  select d.number_format, coalesce(d.numbering_gapless, false)
    from companies c
    left join country_defaults d on d.country = c.fiscal_country
   where c.id = p_company_id;
$$;

comment on function numbering_rules(uuid) is
  'What the country of a company says about its document numbers: the pattern, and whether the law forbids a hole. The only function that reads either column.';

-- ---------------------------------------------------------------------------
-- Rendering one number
--
-- Separate from `next_entry_number()` so that the pattern can be tested
-- without burning a counter, and so a document series of its own — which is
-- not in this release — has the same renderer rather than a second one.
-- ---------------------------------------------------------------------------

create or replace function format_number(p_format text, p_code text, p_date date, p_number integer)
returns text
language plpgsql
immutable
as $$
declare
  v_out   text := p_format;
  v_token text;
  v_width integer;
  v_digits text := p_number::text;
  v_left  text;
begin
  if p_format is null or p_format = '' then
    raise exception 'no_number_format: this country declares no documents.number_format, and there is no default to fall back on';
  end if;

  v_out := replace(v_out, '{CODE}', coalesce(p_code, ''));
  v_out := replace(v_out, '{YYYY}', to_char(p_date, 'YYYY'));
  v_out := replace(v_out, '{YY}',   to_char(p_date, 'YY'));
  v_out := replace(v_out, '{MM}',   to_char(p_date, 'MM'));

  v_token := (regexp_match(v_out, '\{N+\}'))[1];
  if v_token is null then
    raise exception 'number_format_without_counter: % carries no {N...} counter, so every document would be numbered the same', p_format;
  end if;

  -- Padded to the width the pattern asks for, and never truncated to it: a
  -- counter that has outgrown its padding is a longer number, not a wrong one.
  v_width := length(v_token) - 2;
  v_out := replace(v_out, v_token,
                   case when length(v_digits) >= v_width then v_digits
                        else lpad(v_digits, v_width, '0') end);

  v_left := (regexp_match(v_out, '\{[^}]*\}'))[1];
  if v_left is not null then
    raise exception 'unknown_number_token: % is not a token of the number format grammar ({CODE}, {YYYY}, {YY}, {MM}, {N...})', v_left;
  end if;

  return v_out;
end;
$$;

comment on function format_number(text, text, date, integer) is
  'One document number, rendered from the pattern the country pack declares. Raises rather than guessing at a token it does not know.';

-- ---------------------------------------------------------------------------
-- next_entry_number, on the pattern
-- ---------------------------------------------------------------------------

create or replace function next_entry_number(p_journal_id uuid, p_date date)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_code    text;
  v_company uuid;
  v_format  text;
  v_period  smallint;
  v_number  integer;
begin
  select j.code, j.company_id into v_code, v_company from journals j where j.id = p_journal_id;
  if v_code is null then
    raise exception 'unknown_journal: journal % does not exist', p_journal_id;
  end if;

  if auth.uid() is not null and not has_capability(v_company, 'entries.post') then
    raise exception 'not_allowed: drawing a number in this company needs entries.post'
      using errcode = '42501';
  end if;

  select number_format into v_format from numbering_rules(v_company);
  if v_format is null or v_format = '' then
    raise exception 'no_number_format: the country pack of this company declares no documents.number_format, and there is no default to fall back on';
  end if;

  -- A pattern that carries the year restarts with it; one that does not is a
  -- single series, kept under the period that is not a year.
  v_period := case when v_format ~ '\{(YYYY|YY)\}'
                   then extract(year from p_date)::smallint
                   else 0::smallint end;

  insert into journal_sequences (journal_id, year, last_number)
  values (p_journal_id, v_period, 1)
  on conflict (journal_id, year)
    do update set last_number = journal_sequences.last_number + 1
  returning last_number into v_number;

  return format_number(v_format, v_code, p_date, v_number);
end;
$$;

comment on function next_entry_number(uuid, date) is
  'Next number for a journal, on the pattern the country pack declares. Atomic: the counter row is locked, not the journal. Definer, because the counter is infrastructure and nobody writes it by hand.';

comment on column journal_sequences.year is
  'The period the counter belongs to: the year where the pattern carries one, and 0 where it does not and the series runs on.';

-- ---------------------------------------------------------------------------
-- post_entry, reading numbering_gapless
--
-- Unchanged but for the guard: everything else is the function as published.
-- ---------------------------------------------------------------------------

create or replace function post_entry(p_entry_id uuid)
returns entries
language plpgsql
as $$
declare
  v_entry   entries%rowtype;
  v_lines   integer;
  v_gapless boolean;
begin
  select * into v_entry from entries where id = p_entry_id for update;
  if not found then
    raise exception 'unknown_entry: entry % does not exist', p_entry_id;
  end if;
  if v_entry.state = 'posted' then
    return v_entry;
  end if;
  if v_entry.state = 'cancelled' then
    raise exception 'entry_cancelled: entry % cannot be posted', p_entry_id;
  end if;

  select count(*) into v_lines from entry_lines where entry_id = p_entry_id;
  if v_lines = 0 then
    raise exception 'entry_empty: entry % has no lines', p_entry_id;
  end if;

  -- Re-read the totals maintained by the line trigger.
  select * into v_entry from entries where id = p_entry_id;
  if v_entry.total_debit <> v_entry.total_credit then
    raise exception 'entry_unbalanced: entry % has debit % and credit %',
      p_entry_id, v_entry.total_debit, v_entry.total_credit;
  end if;

  -- Where the law forbids a hole, the number comes from the counter and from
  -- nowhere else. A number chosen by hand is how a sequence acquires one.
  if v_entry.number is not null then
    select numbering_gapless into v_gapless from numbering_rules(v_entry.company_id);
    if v_gapless then
      raise exception 'numbering_gapless: this country forbids a hole in the sequence, so entry % may not be posted under a number chosen by hand. Leave entries.number empty and the journal counter draws it',
        p_entry_id;
    end if;
  end if;

  perform assert_period_open(v_entry.company_id, v_entry.entry_date, true);

  update entries
     set number = coalesce(number, next_entry_number(journal_id, entry_date)),
         fiscal_year_id = coalesce(fiscal_year_id, fiscal_year_at(company_id, entry_date)),
         state = 'posted',
         posted_at = now()
   where id = p_entry_id
  returning * into v_entry;

  return v_entry;
end;
$$;

comment on function post_entry(uuid) is
  'Validates, numbers and posts an entry. Raises rather than warning: a swallowed error is a missing entry. Where the country forbids a hole in the sequence, it refuses a number chosen by hand.';

revoke execute on all functions in schema public from public;
