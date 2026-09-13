-- Ekwo OS — taking over books that already have numbers.
--
-- ST13 gave `country_defaults.numbering_gapless` a reader: `post_entry()`
-- refuses a number chosen by hand where the law forbids a hole in the
-- sequence, because a number that skips the counter is exactly how a hole
-- appears. That entry also wrote down what it would cost — "the day an import
-- of somebody's old entries under their old numbers is written, this is the
-- rule it will have to argue with" — and the argument arrived immediately: a
-- company moving from another system arrives with three years of entries that
-- already carry numbers, and those numbers are the ones its VAT returns, its
-- filings and its auditor already know.
--
-- So the rule stands and gains an exception that has a name.
--
-- **`entries.import` is a capability, and it is in no preset.** Not a flag on
-- the call, not a session setting, not an argument somebody can pass by
-- accident: the one thing that lets an explicit number through is a
-- capability an owner has to grant, on purpose, to the person doing the
-- import — and take back afterwards. It is in `capabilities` so it can be
-- granted and revoked like every other, and out of `role_capabilities` so
-- that no role carries it by default. Importing is not something an
-- accountant does on a Tuesday.
--
-- **What it does not relax.** A duplicate is still refused, by the unique
-- index `entries_company_number_idx` that has been there since the first
-- release — `(company_id, number)`, which is stricter than per journal and
-- was already the right key. And an explicit number on a normal entry, from
-- somebody without the capability, is refused exactly as it was yesterday.
--
-- **It applies to everybody, including the installer.** A gapless sequence is
-- a rule about the books and not a permission, so this guard does not carry
-- the `auth.uid() is null` exemption the permission checks do: a superuser
-- connection is refused like anybody else. An importer running over such a
-- connection sets the request claim for the user it is acting for — which is
-- what `ekwo demo` already does to satisfy `claim_instance_admin()` — and
-- that user holds `entries.import`.
--
-- **The counter catches up.** An imported number that is written in the
-- country's own pattern advances `journal_sequences` to it, so the first
-- entry booked after the import continues the series instead of restarting
-- at one and colliding. A number that does not parse against the pattern —
-- a series from another system, in another shape — leaves the counter alone,
-- because there is nothing in it the counter could learn.

insert into capabilities (code, area, description) values
  ('entries.import', 'entries',
   'Post an entry under a number chosen by hand, where the country forbids a hole in the sequence. For taking over books that already have numbers. In no preset: it is granted for an import and taken back after it.');

-- ---------------------------------------------------------------------------
-- Reading a counter back out of a number
--
-- The pattern is the pack's, so the way to read a number is the pattern read
-- backwards: the literal text of the format is literal, `{CODE}`, `{YYYY}`,
-- `{YY}` and `{MM}` are what they are, and the `{N…}` token is the number we
-- are after. Anything that does not match returns null, which is an answer.
-- ---------------------------------------------------------------------------

create or replace function number_counter(p_format text, p_number text)
returns integer
language plpgsql
immutable
as $$
declare
  v_pattern text;
  v_found   text;
begin
  if p_format is null or p_number is null then
    return null;
  end if;

  -- Everything that is not a token becomes literal; the tokens become what
  -- they can match. `regexp_replace` with the `g` flag walks the format once.
  v_pattern := regexp_replace(p_format, '([.^$*+?()\[\]{}|\\])', '\\\1', 'g');
  -- The escaping above also escaped the braces of the tokens, so the tokens
  -- are matched in their escaped shape.
  v_pattern := replace(v_pattern, '\{CODE\}', '.+');
  v_pattern := replace(v_pattern, '\{YYYY\}', '[0-9]{4}');
  v_pattern := replace(v_pattern, '\{YY\}',   '[0-9]{2}');
  v_pattern := replace(v_pattern, '\{MM\}',   '[0-9]{2}');
  v_pattern := regexp_replace(v_pattern, '\\\{N+\\\}', '([0-9]+)');

  if v_pattern !~ '\(\[0-9\]\+\)' then
    return null;
  end if;

  v_found := (regexp_match(p_number, '^' || v_pattern || '$'))[1];
  if v_found is null then
    return null;
  end if;
  return v_found::integer;
exception
  when others then
    return null;
end;
$$;

comment on function number_counter(text, text) is
  'The counter inside a number, read back through the pattern it was written with, or null when the number does not follow that pattern. What lets an import advance the sequence it interrupted.';

-- ---------------------------------------------------------------------------
-- Catching the counter up
--
-- Definer for the reason the counters are definer: `journal_sequences` has a
-- select policy and no other, and nobody writes it by hand. The caller has
-- already been checked by `post_entry()`.
-- ---------------------------------------------------------------------------

create or replace function catch_up_journal_sequence(p_journal_id uuid, p_date date, p_number text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company uuid;
  v_format  text;
  v_period  smallint;
  v_counter integer;
begin
  select j.company_id into v_company from journals j where j.id = p_journal_id;
  if v_company is null then
    return;
  end if;

  select number_format into v_format from numbering_rules(v_company);
  v_counter := number_counter(v_format, p_number);
  if v_counter is null then
    return;
  end if;

  v_period := case when v_format ~ '\{(YYYY|YY)\}'
                   then extract(year from p_date)::smallint
                   else 0::smallint end;

  insert into journal_sequences (journal_id, year, last_number)
  values (p_journal_id, v_period, v_counter)
  on conflict (journal_id, year)
    do update set last_number = greatest(journal_sequences.last_number, excluded.last_number);
end;
$$;

comment on function catch_up_journal_sequence(uuid, date, text) is
  'Advances a journal counter to an imported number, so the next automatic one continues the series rather than colliding with it. Does nothing for a number that does not follow the country''s pattern.';

-- ---------------------------------------------------------------------------
-- post_entry, with the exception that has a name
--
-- Unchanged but for the guard and the catching-up: everything else is the
-- function as published.
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
  -- nowhere else — unless the caller holds `entries.import`, which is how a
  -- set of books that already has numbers is taken over. A duplicate is
  -- refused either way, by `entries_company_number_idx`.
  if v_entry.number is not null then
    select numbering_gapless into v_gapless from numbering_rules(v_entry.company_id);
    if v_gapless and not (auth.uid() is not null
                          and has_capability(v_entry.company_id, 'entries.import')) then
      raise exception 'numbering_gapless: this country forbids a hole in the sequence, so entry % may not be posted under a number chosen by hand. Leave entries.number empty and the journal counter draws it, or hold entries.import to bring in books that already have numbers',
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

  -- An imported number advances the counter it interrupted, so the next
  -- automatic one continues the series. A number drawn from the counter is
  -- already at it and this is a no-op.
  perform catch_up_journal_sequence(v_entry.journal_id, v_entry.entry_date, v_entry.number);

  return v_entry;
end;
$$;

comment on function post_entry(uuid) is
  'Validates, numbers and posts an entry. Raises rather than warning: a swallowed error is a missing entry. Where the country forbids a hole in the sequence it refuses a number chosen by hand, unless the caller holds entries.import — and then the counter catches up to it.';

revoke execute on all functions in schema public from public;
