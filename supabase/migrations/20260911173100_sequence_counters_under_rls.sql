-- Ekwo OS — the counters have to work for the person doing the booking.
--
-- `journal_sequences` and `matching_sequences` carry a select policy and no
-- other, which is right: nobody should be able to write a counter by hand.
-- But `next_entry_number()` and `next_matching_number()` write them, and they
-- ran as the caller — so posting an entry or drawing a matching letter
-- succeeded for the table owner and failed for every signed-in user with
-- "new row violates row-level security policy for table journal_sequences".
--
-- It went unnoticed because the tests exercised the schema as the owner, the
-- installer holds an owner connection, and until now nothing else wrote to
-- this database. The first client that signs in as a user — the MCP server —
-- hits it on the first invoice.
--
-- The counters are infrastructure, not user data: they exist so two
-- concurrent bookings do not draw the same number. So both functions become
-- SECURITY DEFINER, and each one checks first that the caller may write the
-- company it is counting for. A definer function that skipped that check
-- would be a way to burn numbers in somebody else's journal.

create or replace function next_entry_number(p_journal_id uuid, p_date date)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_code    text;
  v_company uuid;
  v_year    smallint := extract(year from p_date)::smallint;
  v_number  integer;
begin
  select j.code, j.company_id into v_code, v_company from journals j where j.id = p_journal_id;
  if v_code is null then
    raise exception 'unknown_journal: journal % does not exist', p_journal_id;
  end if;

  -- The caller is about to write an entry in this company; they have to be
  -- allowed to. auth.uid() is null on an owner connection, where row level
  -- security is bypassed anyway and the installer is the caller.
  if auth.uid() is not null and not can_write_company(v_company) then
    raise exception 'not_allowed: you may not book in this company'
      using errcode = '42501';
  end if;

  insert into journal_sequences (journal_id, year, last_number)
  values (p_journal_id, v_year, 1)
  on conflict (journal_id, year)
    do update set last_number = journal_sequences.last_number + 1
  returning last_number into v_number;

  return v_code || '/' || v_year::text || '/' || lpad(v_number::text, 4, '0');
end;
$$;

comment on function next_entry_number(uuid, date) is
  'Next number for a journal and year, as CODE/YYYY/NNNN. Atomic: the counter row is locked, not the journal. Definer, because the counter is infrastructure and nobody writes it by hand.';

create or replace function next_matching_number(p_company_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_number integer;
begin
  if auth.uid() is not null and not can_write_company(p_company_id) then
    raise exception 'not_allowed: you may not match in this company'
      using errcode = '42501';
  end if;

  insert into matching_sequences (company_id, last_number)
  values (p_company_id, 1)
  on conflict (company_id)
    do update set last_number = matching_sequences.last_number + 1
  returning last_number into v_number;

  return 'A' || lpad(v_number::text, 4, '0');
end;
$$;

comment on function next_matching_number(uuid) is
  'Next reconciliation letter for a company, as A0001. Definer, for the same reason as next_entry_number.';
