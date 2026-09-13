-- Ekwo OS — "there is no session" was never a synonym for "this is the installer".
--
-- Eleven functions and triggers were written in this shape:
--
--   if auth.uid() is not null and not has_capability(…) then raise …
--
-- It reads as "a signed-in caller is checked". What it *means* is "a caller
-- with no session is not checked at all", and that was fine for exactly as
-- long as the only caller with no session was `ekwo migrate`.
--
-- Then `20260913085932` added machine keys. A key is deliberately not a
-- session: `use_api_key()` puts its fingerprint in `ekwo.api_key` and
-- `auth.uid()` stays null, which is the whole design — a key is answered for
-- by `has_capability()` and by nothing else. Except here. Every one of these
-- guards read the null and stood aside, so a key issued with
-- `["entries.read"]` could post an entry, book a document, close a financial
-- year, draw a number, match, invite a member, revoke somebody else's
-- invitation, create a company, take over a numbered book — and issue itself
-- a second key carrying every capability of the installation. The narrowest
-- caller in the schema was the widest.
--
-- The exemption is real and has to stay: the migration runner, the seeds and
-- the CLI hold a database connection and no session, and a guard that asks
-- for a capability would refuse the installation itself. So it is *named*
-- instead of inferred. `is_installer()` (20260913101536) is true only when
-- the runner set `ekwo.installing` on its own connection, and it is false
-- outright when there is a session or when a key is presenting itself. A
-- caller that reaches the database through PostgREST cannot set a GUC, and a
-- caller holding a key has `ekwo.api_key` set for the length of its
-- transaction — so neither can ever be the installer, whatever they do.
--
-- `has_capability()` is now the only authority over both people and machines,
-- which is what ST13 said it was.
--
-- `post_entry()` is the one member of the family that was *not* a hole, and
-- it changes for the other reason. Its test reads
-- `auth.uid() is not null and has_capability(…, 'entries.import')` as a
-- requirement rather than as an exemption, so a key was already refused — but
-- so was a key that legitimately held `entries.import`. It now asks for the
-- capability and nothing else, which admits the key and keeps the installer
-- bound by a rule that is a law and not a permission.
--
-- Every function below is republished whole, with its body unchanged but for
-- that one line. They come from `20260913083216` (the three triggers and the
-- two counters), `20260913085436` (the counter that reads the pack),
-- `20260913085932`, `20260913083901`, `20260913090216` and `20260913092527`.

create or replace function assert_may_post_entry()
returns trigger
language plpgsql
as $$
begin
  if not is_installer() and not has_capability(new.company_id, 'entries.post') then
    raise exception 'not_allowed: posting an entry in this company needs entries.post'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function assert_may_post_document()
returns trigger
language plpgsql
as $$
begin
  if not is_installer() and not has_capability(new.company_id, 'documents.post') then
    raise exception 'not_allowed: booking a document in this company needs documents.post'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function assert_may_close_year()
returns trigger
language plpgsql
as $$
begin
  if not is_installer() and not has_capability(new.company_id, 'year_end.close') then
    raise exception 'not_allowed: closing or re-opening a financial year needs year_end.close'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function next_matching_number(p_company_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_number integer;
begin
  if not is_installer() and not has_capability(p_company_id, 'reconcile.write') then
    raise exception 'not_allowed: matching in this company needs reconcile.write'
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

  if not is_installer() and not has_capability(v_company, 'entries.post') then
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

create or replace function create_api_key(
  p_company_id   uuid,
  p_name         text,
  p_capabilities jsonb,
  p_expires_at   timestamptz default null
)
returns table (api_key_id uuid, secret text, prefix text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caps   text[] := coalesce(
    (select array_agg(value) from jsonb_array_elements_text(coalesce(p_capabilities, '[]'::jsonb)) as value),
    '{}');
  v_prefix text := left(replace(gen_random_uuid()::text, '-', ''), 12);
  v_secret text;
  v_cap    text;
  v_row    api_keys%rowtype;
begin
  if not is_installer() and not has_capability(p_company_id, 'members.manage') then
    raise exception 'not_allowed: issuing a key for this company needs members.manage'
      using errcode = '42501';
  end if;

  if cardinality(v_caps) = 0 then
    raise exception 'api_key_without_capability: name what this key may do; a key that may do nothing is a secret to look after for no reason';
  end if;

  foreach v_cap in array v_caps loop
    if v_cap not in (select code from capabilities) then
      raise exception 'unknown_capability: % is not a capability of this installation', v_cap;
    end if;
    -- Nobody mints a key stronger than they are. An owner issuing a key is
    -- bounded by their own capabilities, which is also what makes revoking a
    -- person's capability revoke the keys they left behind.
    if not is_installer() and not has_capability(p_company_id, v_cap) then
      raise exception 'not_allowed: you do not hold % yourself, so you cannot put it on a key', v_cap
        using errcode = '42501';
    end if;
  end loop;

  v_secret := 'ekwo_' || v_prefix || '_' ||
              replace(gen_random_uuid()::text, '-', '') ||
              replace(gen_random_uuid()::text, '-', '');

  insert into api_keys (company_id, name, prefix, key_hash, capabilities, created_by, expires_at)
  values (p_company_id, p_name, v_prefix,
          encode(sha256(convert_to(v_secret, 'UTF8')), 'hex'),
          v_caps, auth.uid(), p_expires_at)
  returning * into v_row;

  return query select v_row.id, v_secret, v_row.prefix, v_row.expires_at;
end;
$$;

create or replace function revoke_api_key(p_api_key_id uuid)
returns api_keys
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row api_keys%rowtype;
begin
  select * into v_row from api_keys where id = p_api_key_id;
  if v_row.id is null then
    raise exception 'unknown_api_key: no key with that id';
  end if;
  if not is_installer() and not has_capability(v_row.company_id, 'members.manage') then
    raise exception 'not_allowed: withdrawing a key needs members.manage'
      using errcode = '42501';
  end if;

  update api_keys set revoked_at = coalesce(revoked_at, now())
   where id = p_api_key_id
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function invite_member(
  p_company_id   uuid,
  p_email        text,
  p_role         member_role default 'viewer',
  -- A list crosses as JSON, the way `opening_balance` takes its lines: over
  -- PostgREST an argument is a JSON body, and a Postgres driver handed a
  -- JavaScript array builds an array literal instead. One spelling that both
  -- routes read the same way.
  p_capabilities jsonb default '[]'::jsonb,
  p_valid_for    interval default interval '14 days'
)
returns table (invitation_id uuid, token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email   text := lower(trim(p_email));
  v_token   text;
  v_unknown text;
  v_caps    text[] := coalesce(
    (select array_agg(value) from jsonb_array_elements_text(coalesce(p_capabilities, '[]'::jsonb)) as value),
    '{}');
  v_row     company_invitations%rowtype;
begin
  if not is_installer() and not has_capability(p_company_id, 'members.manage')
     and not is_instance_admin() then
    raise exception 'not_allowed: inviting somebody into this company needs members.manage'
      using errcode = '42501';
  end if;

  if v_email is null or v_email not like '%_@_%' then
    raise exception 'bad_email: % is not an address an invitation can be sent to', p_email;
  end if;

  select c into v_unknown
    from unnest(v_caps) as c
   where c not in (select code from capabilities)
   limit 1;
  if v_unknown is not null then
    raise exception 'unknown_capability: % is not a capability of this installation', v_unknown;
  end if;

  -- Re-inviting the same address replaces the pending invitation rather than
  -- leaving two tokens alive for one seat.
  update company_invitations
     set revoked_at = now()
   where company_id = p_company_id
     and email = v_email
     and accepted_at is null
     and revoked_at is null;

  v_token := replace(gen_random_uuid()::text, '-', '') ||
             replace(gen_random_uuid()::text, '-', '');

  insert into company_invitations (company_id, email, role, capabilities_granted,
                                   token_hash, invited_by, expires_at)
  values (p_company_id, v_email, p_role, v_caps,
          encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), auth.uid(), now() + p_valid_for)
  returning * into v_row;

  return query select v_row.id, v_token, v_row.expires_at;
end;
$$;

create or replace function revoke_invitation(p_invitation_id uuid)
returns company_invitations
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row company_invitations%rowtype;
begin
  select * into v_row from company_invitations where id = p_invitation_id;
  if v_row.id is null then
    raise exception 'unknown_invitation: no invitation with that id';
  end if;

  if not is_installer() and not has_capability(v_row.company_id, 'members.manage')
     and not is_instance_admin() then
    raise exception 'not_allowed: withdrawing an invitation needs members.manage'
      using errcode = '42501';
  end if;

  if v_row.accepted_at is not null then
    raise exception 'invitation_already_accepted: it became a membership on %; remove the member instead',
      v_row.accepted_at;
  end if;

  update company_invitations set revoked_at = coalesce(revoked_at, now())
   where id = p_invitation_id
  returning * into v_row;

  return v_row;
end;
$$;

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
  if not is_installer() and not is_instance_admin() then
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
    if v_gapless and not has_capability(v_entry.company_id, 'entries.import') then
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

revoke execute on all functions in schema public from public;
