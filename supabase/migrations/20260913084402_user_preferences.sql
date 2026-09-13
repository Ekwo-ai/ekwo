-- Ekwo OS — what a person prefers, and the one way a label is chosen.
--
-- Two things that turned out to be the same thing.
--
-- **A preference belongs to a person, not to a company.** Which company they
-- work in by default, the language they read in, their timezone, how they
-- like a date and a number written. None of it has a default in the schema,
-- for the reason P0-7 and P0-8 gave before: a default language is one
-- country's answer handed to everybody who has not spoken, and null means
-- "ask the company, then the pack, then the client" rather than "English".
--
-- **A label is chosen in one place.** `name_i18n` and `text_i18n` sit on the
-- chart, the journals, the declaration boxes, the statement lines and the
-- legal mentions, and the way to read one was written out as
-- `coalesce(nullif(x.name_i18n ->> lang, ''), x.name)` wherever it was
-- needed. That is a formula, and a formula written twice is a formula that
-- will one day disagree with itself. `label_for(name, name_i18n, languages)`
-- is now the only spelling of it, it takes a **list** of languages rather
-- than one, and `preferred_languages(company)` builds that list: the user's
-- own, then the company's, then the pack's.
--
-- `install_country_template()` is republished on top of it. It keeps passing
-- one language and the company's, deliberately: a chart of accounts is copied
-- in the language the books are kept in, not in the language of whoever
-- happened to run the installer.

-- ---------------------------------------------------------------------------
-- label_for — the one way a translated label is picked
-- ---------------------------------------------------------------------------

create or replace function label_for(p_name text, p_i18n jsonb, p_languages text[])
returns text
language sql
immutable
as $$
  select coalesce(
    (select nullif(p_i18n ->> lang, '')
       from unnest(coalesce(p_languages, '{}')) with ordinality as l(lang, ord)
      where nullif(p_i18n ->> lang, '') is not null
      order by l.ord
      limit 1),
    p_name);
$$;

comment on function label_for(text, jsonb, text[]) is
  'The label in the first language of the list that has one, and the row''s own name when none of them does. The only place a translated label is chosen.';

-- ---------------------------------------------------------------------------
-- user_preferences
-- ---------------------------------------------------------------------------

create table user_preferences (
  user_id              uuid primary key references auth.users(id) on delete cascade,
  preferred_company_id uuid references companies(id) on delete set null,
  language             text,
  timezone             text,
  -- `*_display_format` and not `date_format` / `number_format`: the second of
  -- those is already a column of `country_defaults`, where it is the pattern
  -- a document number is built from. Two questions that have nothing to do
  -- with each other should not answer to one name — a reader meeting both
  -- would have to know which table they were in to know what they had.
  date_display_format   text,
  number_display_format text,
  theme                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint user_preferences_language_shape
    check (language is null or language ~ '^[a-z]{2}(-[A-Za-z0-9]{2,8})?$')
);

comment on table user_preferences is
  'What one person prefers, across every company they are a member of. Every column is nullable and none has a default: null means "take the company''s answer, then the pack''s".';
comment on column user_preferences.preferred_company_id is
  'The company an interface opens on. Cleared rather than kept when that company is deleted.';
comment on column user_preferences.language is
  'Language this person reads labels in. First in the list preferred_languages() builds.';
comment on column user_preferences.theme is
  'A client''s business. The core stores it and interprets nothing.';

create trigger user_preferences_set_updated_at
  before update on user_preferences
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- preferred_languages — the chain a reader follows
-- ---------------------------------------------------------------------------

create or replace function preferred_languages(p_company_id uuid default null)
returns text[]
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select array_remove(array[
    (select p.language from user_preferences p where p.user_id = auth.uid()),
    (select c.language from companies c where c.id = p_company_id),
    (select d.language_default
       from companies c join country_defaults d on d.country = c.country
      where c.id = p_company_id)
  ], null);
$$;

comment on function preferred_languages(uuid) is
  'The languages to try, in order: the user''s own, then the company''s, then the one the country pack declares. Feed it to label_for().';

-- ---------------------------------------------------------------------------
-- install_country_template, republished on label_for
--
-- Unchanged but for one expression: the chart is copied under
-- `label_for(t.name, t.name_i18n, array[v_language])` instead of the coalesce
-- that was written out here. Same answer, one formula.
-- ---------------------------------------------------------------------------

create or replace function install_country_template(
  p_company_id uuid,
  p_country    char(2),
  p_language   char(2) default null,
  p_chart_code text default null
)
returns void
language plpgsql
as $$
declare
  v_defaults country_defaults%rowtype;
  r          record;
  v_tax_id   uuid;
  v_language char(2);
  v_version  text;
  v_chart    text;
  v_charts   text;
begin
  if not exists (select 1 from companies where id = p_company_id) then
    raise exception 'unknown_company: %', p_company_id;
  end if;

  -- Which chart. The caller names one, or the pack's default stands. A named
  -- chart that does not exist is an error that lists what does: guessing here
  -- would install the wrong plan of accounts and nobody would notice for a
  -- year.
  if p_chart_code is null then
    select c.code into v_chart
      from chart_templates c
     where c.country = p_country and c.is_default;
    if v_chart is null then
      -- No pack for this country, or a pack that names no default chart.
      raise exception 'unknown_country_template: no chart of accounts seeded for %', p_country;
    end if;
  else
    select c.code into v_chart
      from chart_templates c
     where c.country = p_country and c.code = p_chart_code;
    if v_chart is null then
      select string_agg(c.code, ', ' order by c.code) into v_charts
        from chart_templates c where c.country = p_country;
      raise exception 'unknown_chart: % has no chart %. It has: %',
        p_country, p_chart_code, coalesce(v_charts, 'none');
    end if;
  end if;

  if not exists (
    select 1 from account_templates
     where country = p_country and chart_code = v_chart
  ) then
    raise exception 'unknown_country_template: chart % of % holds no account', v_chart, p_country;
  end if;

  -- The language of the copy: what the caller asked for, else what the
  -- company keeps its books in.
  select coalesce(p_language, c.language) into v_language
    from companies c where c.id = p_company_id;

  -- 1. Accounts, without the hierarchy.
  insert into accounts (company_id, code, name, name_i18n, statement_hint,
                        account_type, reconcilable)
  select p_company_id, t.code,
         label_for(t.name, t.name_i18n, array[v_language]),
         t.name_i18n, t.statement_hint, t.account_type, t.reconcilable
    from account_templates t
   where t.country = p_country
     and t.chart_code = v_chart
  on conflict (company_id, code) do nothing;

  -- 2. Hierarchy, now that every code exists.
  update accounts a
     set parent_id = p.id
    from account_templates t
    join accounts p on p.company_id = p_company_id and p.code = t.parent_code
   where a.company_id = p_company_id
     and a.code = t.code
     and t.country = p_country
     and t.chart_code = v_chart
     and t.parent_code is not null
     and a.parent_id is null;

  -- 3. Journals. Common to every chart of the country.
  insert into journals (company_id, code, name, journal_type)
  select p_company_id, t.code, t.name, t.journal_type
    from journal_templates t
   where t.country = p_country
  on conflict (company_id, code) do nothing;

  -- 4. Taxes and their postings. Also common: a chart changes how a company
  --    presents itself, not what it owes.
  for r in
    select * from tax_templates where country = p_country order by sequence, code
  loop
    v_tax_id := null;
    insert into taxes (company_id, code, name, description, amount_type, amount,
                       applies_to, treatment, country, valid_from, valid_to,
                       legal_reference, vat_category, exemption_code, sequence,
                       tax_kind, recoverable, jurisdiction, price_include,
                       cash_basis, cash_basis_transition_account_id)
    values (p_company_id, r.code, r.name, r.description, r.amount_type, r.amount,
            r.applies_to, r.treatment, p_country, r.valid_from, r.valid_to,
            r.legal_reference, r.vat_category, r.exemption_code, r.sequence,
            r.tax_kind, r.recoverable, r.jurisdiction, r.price_include,
            r.cash_basis, account_id_by_code(p_company_id, r.cash_basis_transition_account_code))
    on conflict (company_id, code) do nothing
    returning id into v_tax_id;

    if v_tax_id is null then
      continue;
    end if;

    insert into tax_postings (tax_id, company_id, document_kind, posting_type,
                              factor_percent, account_id, declaration_box,
                              box_factor_percent, report_code, sequence)
    select v_tax_id, p_company_id, tp.document_kind, tp.posting_type,
           tp.factor_percent, account_id_by_code(p_company_id, tp.account_code),
           tp.declaration_box, tp.box_factor_percent, tp.report_code, tp.sequence
      from tax_posting_templates tp
     where tp.tax_template_id = r.id
     order by tp.sequence;
  end loop;

  -- 5. Roles.
  select * into v_defaults from country_defaults where country = p_country;
  if found then
    update companies c
       set receivable_account_id       = coalesce(c.receivable_account_id, account_id_by_code(p_company_id, v_defaults.receivable_code)),
           payable_account_id          = coalesce(c.payable_account_id, account_id_by_code(p_company_id, v_defaults.payable_code)),
           suspense_account_id         = coalesce(c.suspense_account_id, account_id_by_code(p_company_id, v_defaults.suspense_code)),
           rounding_account_id         = coalesce(c.rounding_account_id, account_id_by_code(p_company_id, v_defaults.rounding_code)),
           retained_earnings_account_id = coalesce(c.retained_earnings_account_id, account_id_by_code(p_company_id, v_defaults.retained_earnings_code)),
           default_sales_account_id    = coalesce(c.default_sales_account_id, account_id_by_code(p_company_id, v_defaults.sales_account_code)),
           default_purchase_account_id = coalesce(c.default_purchase_account_id, account_id_by_code(p_company_id, v_defaults.purchase_account_code)),
           sales_journal_id            = coalesce(c.sales_journal_id, (select id from journals where company_id = p_company_id and code = v_defaults.sales_journal_code)),
           purchase_journal_id         = coalesce(c.purchase_journal_id, (select id from journals where company_id = p_company_id and code = v_defaults.purchase_journal_code)),
           miscellaneous_journal_id    = coalesce(c.miscellaneous_journal_id, (select id from journals where company_id = p_company_id and code = v_defaults.misc_journal_code))
     where c.id = p_company_id;

    -- 6. The financial journals point at their account.
    update journals j
       set default_account_id = account_id_by_code(p_company_id, v_defaults.bank_account_code)
     where j.company_id = p_company_id
       and j.journal_type = 'bank'
       and j.default_account_id is null
       and v_defaults.bank_account_code is not null;

    update journals j
       set default_account_id = account_id_by_code(p_company_id, v_defaults.cash_account_code)
     where j.company_id = p_company_id
       and j.journal_type = 'cash'
       and j.default_account_id is null
       and v_defaults.cash_account_code is not null;
  end if;

  -- 7. What was copied, from which version, and on which chart.
  v_version := coalesce((select version from country_packs where country = p_country), '1.0.0');

  insert into company_packs (company_id, country, version, chart_code)
  values (p_company_id, p_country, v_version, v_chart)
  on conflict (company_id, country) do update
     set version = excluded.version,
         chart_code = excluded.chart_code,
         upgraded_at = now()
   where company_packs.version is distinct from excluded.version
      or company_packs.chart_code is distinct from excluded.chart_code;
end;
$$;

-- ---------------------------------------------------------------------------
-- Writing them
--
-- A patch rather than a row, and jsonb rather than seven arguments, for one
-- reason: with arguments there is no way to tell "leave the timezone alone"
-- from "clear the timezone". A key that is present is written — null
-- included, which is how a preference is cleared — and a key that is absent
-- is untouched. A key nobody declared is refused rather than dropped on the
-- floor, because a preference that silently did not save is worse than an
-- error.
--
-- It writes the caller's own row and no other: `auth.uid()` is the key, and
-- it is not an argument.
-- ---------------------------------------------------------------------------

create or replace function set_preferences(p_patch jsonb)
returns user_preferences
language plpgsql
as $$
declare
  v_known text[] := array['preferred_company_id', 'language', 'timezone',
                          'date_display_format', 'number_display_format', 'theme'];
  v_unknown text;
  v_row user_preferences%rowtype;
begin
  if auth.uid() is null then
    raise exception 'no_user: preferences belong to a signed-in user';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'bad_patch: set_preferences takes an object of the preferences to change';
  end if;

  select k into v_unknown
    from jsonb_object_keys(p_patch) as k
   where k <> all (v_known)
   limit 1;
  if v_unknown is not null then
    raise exception 'unknown_preference: % is not a preference this installation keeps (%)',
      v_unknown, array_to_string(v_known, ', ');
  end if;

  insert into user_preferences (user_id, preferred_company_id, language, timezone,
                                date_display_format, number_display_format, theme)
  values (auth.uid(),
          nullif(p_patch ->> 'preferred_company_id', '')::uuid,
          nullif(p_patch ->> 'language', ''),
          nullif(p_patch ->> 'timezone', ''),
          nullif(p_patch ->> 'date_display_format', ''),
          nullif(p_patch ->> 'number_display_format', ''),
          nullif(p_patch ->> 'theme', ''))
  on conflict (user_id) do update set
    preferred_company_id = case when p_patch ? 'preferred_company_id'
                                then nullif(p_patch ->> 'preferred_company_id', '')::uuid
                                else user_preferences.preferred_company_id end,
    language             = case when p_patch ? 'language'
                                then nullif(p_patch ->> 'language', '')
                                else user_preferences.language end,
    timezone             = case when p_patch ? 'timezone'
                                then nullif(p_patch ->> 'timezone', '')
                                else user_preferences.timezone end,
    date_display_format   = case when p_patch ? 'date_display_format'
                                 then nullif(p_patch ->> 'date_display_format', '')
                                 else user_preferences.date_display_format end,
    number_display_format = case when p_patch ? 'number_display_format'
                                 then nullif(p_patch ->> 'number_display_format', '')
                                 else user_preferences.number_display_format end,
    theme                = case when p_patch ? 'theme'
                                then nullif(p_patch ->> 'theme', '')
                                else user_preferences.theme end
  returning * into v_row;

  return v_row;
end;
$$;

comment on function set_preferences(jsonb) is
  'Writes the signed-in user''s preferences. A key that is present is written, null included; a key that is absent is left alone; a key nobody declared is refused.';

-- ---------------------------------------------------------------------------
-- Row level security
--
-- A preference is nobody else's business — not another member's, not an
-- instance administrator's. One policy, own row, both ways.
-- ---------------------------------------------------------------------------

alter table user_preferences enable row level security;

create policy user_preferences_own on user_preferences
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

comment on policy user_preferences_own on user_preferences is
  'Yours and nobody else''s, including an administrator''s.';

revoke execute on all functions in schema public from public;
