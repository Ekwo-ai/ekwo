-- Ekwo OS — whether a territory is inside the common system of VAT, as data.
--
-- `ec_sales_list()` was written with a hole in it, and the hole is written up
-- in `docs/international.md`: the core cannot say whether a country is a
-- Member State, and it cannot say that a Greek customer identifies under `EL`
-- and not under `GR`. Both questions are asked of every supply the
-- recapitulative statement carries, and neither has an answer anywhere in this
-- repository. So a supply to a customer in a third country is listed as an
-- intra-Community supply, and a Greek customer recorded without a prefix is
-- listed under a code every one of the four administrations refuses.
--
-- Neither can be fixed where the question is asked.
--
--   * **A list of Member States in a function is a country literal**, which is
--     the second invariant of `CONTRIBUTING.md` and the thing the whole pack
--     format exists to avoid: a `case` naming twenty-seven codes is twenty-seven
--     rules of law compiled into the core, and the day Croatia acceded it would
--     have been a release.
--   * **A list of Member States in a pack would be wrong.** Membership is the
--     Union's law, not any one country's. Every pack would carry the same
--     twenty-seven rows, four copies that can disagree, and a country that has
--     no pack here would have no answer at all.
--
-- So it is framework data, beside `currencies`: a small reference table the
-- release fills, that no company owns, that no pack writes, and that every
-- reader of it reads the same way.
--
-- **The table is here and the rows are in `supabase/seed/00_territories.sql`,
-- beside the currencies.** That is the division the repository already draws
-- and it draws it for a reason: a migration is the shape of the database and a
-- seed is the reference data in it, and re-applying a seed is how a correction
-- reaches an installation that already exists. Membership of the Union changes
-- — an accession, a withdrawal, a territory moved from one article of the
-- Directive to another — and every one of those changes is a row somebody has
-- to be able to send to a running installation without a schema change. The
-- seed upserts on the code, so re-applying it corrects a row instead of
-- skipping it, which is what the country packs already do and what the
-- currencies, whose list nobody corrects, do not need to.
--
-- It also keeps the guard that reads these files honest. `tests/tax_report.test.ts`
-- refuses a country code in any migration, and the guard is right: a migration
-- is the core. The seeds are where a country is allowed to be named, because
-- naming countries is what a seed is for.
--
-- One consequence had to be handled rather than hoped away. A database with
-- the table and without the rows would answer that nothing is in the Union,
-- and would go on writing recapitulative statements in which every customer is
-- a violation. `ec_sales_list()` therefore raises `no_territories` when the
-- table is empty, by name, in the migration that teaches it to read this one —
-- the same answer `rounding_of()` gives for a currency it does not know, and
-- the rule `CONTRIBUTING.md` states as *raise, do not warn*.
--
-- ---------------------------------------------------------------------------
-- Why this is not the country literal the invariant forbids
-- ---------------------------------------------------------------------------
--
-- The invariant is about a *rule* only one country can justify: `if country =
-- 'BE' then`, a default of `'EUR'`, an account code in a function. Nothing
-- here is one. Every row of this table says the same kind of thing about its
-- territory, no row is privileged, no function below branches on a code, and
-- adding a Member State is an insert in a seed. `00_currencies.sql` holds
-- `'EUR'` for the same reason and breaks nothing: it is data about the world,
-- read by name, never compiled into a decision.
--
-- ---------------------------------------------------------------------------
-- What is in the table, and what is not
-- ---------------------------------------------------------------------------
--
-- One rule decides membership, so that the next person adding a row knows
-- whether it belongs: **the table holds the territories Directive 2006/112/EC
-- names, the States that have been bound by it, and Northern Ireland.** That
-- is the twenty-seven Member States; the United Kingdom, which was one; the
-- territories articles 6 and 7 take out of the common system or put into it;
-- and Northern Ireland, which article 6 never heard of and which the
-- Withdrawal Agreement put inside the system for goods alone.
--
-- It is therefore **not a country list**. Switzerland is not here, and the
-- answer for Switzerland is the answer for every territory the table does not
-- carry: the common system of VAT does not apply there. A row is only needed
-- where the plain reading of the customer's ISO country would be wrong.
--
-- Three exclusions are knowingly absent, and each for a stated reason:
--
--   * **The Sovereign Base Areas of Akrotiri and Dhekelia**, which article
--     7(1) treats as part of Cyprus. No register gives them a code and no VAT
--     number carries one, so a row would have a key nobody could look up with.
--   * **The overseas countries and territories** of annex II to the TFEU —
--     Saint-Barthélemy, Greenland, Aruba and the rest. They are outside the
--     common system under article 355(2) of the Treaty and not under article 6,
--     so the rule above puts them out of this table; the general answer covers
--     them.
--   * **Rates, thresholds and registration.** This table says where the system
--     applies. It says nothing about what it charges, which is a pack's
--     business — and for the One-Stop Shop is the open question
--     `docs/international.md` ends on.
--
-- ---------------------------------------------------------------------------
-- Sources
-- ---------------------------------------------------------------------------
--
-- * **Council Directive 2006/112/EC of 28 November 2006 on the common system
--   of value added tax**, articles 5, 6 and 7 — what the territory of the
--   Union is, which territories are taken out of it, and which non-Union
--   territories are treated as part of it. Article 6 as amended by Directive
--   (EU) 2019/475, which moved Campione d'Italia and the Italian waters of
--   Lake Lugano from paragraph 2 to paragraph 1 on 1 January 2020 — into the
--   customs territory, and outside the VAT one either way.
--   https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A02006L0112-20240101
-- * **Agreement on the withdrawal of the United Kingdom**, articles 126 and
--   127 (the transition period) and the Protocol on Ireland/Northern Ireland,
--   article 8 and annex 3 (VAT on goods), as amended by the Windsor Framework.
--   https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A12019W/TXT%2802%29
-- * **The VIES list of VAT identification numbers by Member State**, which is
--   where `EL` for Greece and `XI` for Northern Ireland are published as the
--   prefixes their numbers carry.
--   https://ec.europa.eu/taxation_customs/vies/#/vat-validation
-- * **The accession treaties**, for the day each State became bound. Cited on
--   the row itself, because a date nobody can trace is a date nobody can
--   check.
--
-- Nothing here quotes a word of those texts. A quotation ages without anybody
-- noticing, which is the rule the packs already follow.

-- ---------------------------------------------------------------------------
-- Two vocabularies
-- ---------------------------------------------------------------------------

-- How much of the common system of VAT reaches a territory. Three values,
-- because the Withdrawal Agreement invented the middle one and nothing else
-- in European law has needed it: Northern Ireland is inside the system for
-- supplies of goods and outside it for supplies of services.
create type eu_vat_scope as enum ('full', 'goods', 'none');

comment on type eu_vat_scope is
  'How much of the common system of VAT applies to a territory: the whole of it, supplies of goods only (Northern Ireland, under the Protocol on Ireland/Northern Ireland), or none of it.';

-- Where a territory's code comes from. A key is only useful if a reader knows
-- which register to look it up in, and these rows are not all in one: a
-- Member State has an ISO 3166-1 alpha-2 code, an excluded region usually has
-- an ISO 3166-2 one, Northern Ireland has a code the Union's own systems use
-- and ISO does not, and five territories of article 6 are named by the
-- Directive and coded by nobody.
create type territory_code_source as enum ('iso_3166_1', 'iso_3166_2', 'eu', 'named');

comment on type territory_code_source is
  'Which register a territory''s code comes from: ISO 3166-1 alpha-2, ISO 3166-2, the Union''s own VAT and customs systems (XI), or none at all — in which case the code is a name of this table and says so.';

-- ---------------------------------------------------------------------------
-- The table
-- ---------------------------------------------------------------------------

create table territories (
  code            text primary key,
  code_source     territory_code_source not null,
  -- English, and the name the source uses. The labels a user reads are a
  -- different question and are not answered here: this is a reference table,
  -- not a catalogue, and nothing in the schema prints from it.
  name            text not null,
  -- The Member State this territory hangs off: the one it is part of, the one
  -- it is excluded from, or the one it is treated as part of. Null on a State
  -- itself.
  parent_code     text references territories(code),
  -- How much of the common system applied here, *during the window below*.
  eu_vat_scope    eu_vat_scope not null,
  -- The window. `eu_vat_from` is the first day the common system reached the
  -- territory and `eu_vat_to` the last; both null where it never did.
  --
  -- They are named for VAT and not for membership on purpose, and the United
  -- Kingdom is why. It ceased to be a Member State on 31 January 2020 and
  -- went on being inside the common system of VAT until 31 December 2020,
  -- because articles 126 and 127 of the Withdrawal Agreement kept Union law
  -- applying through the transition. A column called `eu_member_to` holding
  -- 2020-12-31 would be false, and one holding 2020-01-31 would make
  -- `ec_sales_list()` refuse a recapitulative statement that was lawfully
  -- filed for every month of 2020. The reader of this table is VAT code, so
  -- the column records the VAT date and the row's `legal_reference` records
  -- the other one.
  eu_vat_from     date,
  eu_vat_to       date,
  -- The prefix this territory's VAT identification numbers carry, when it is
  -- not the code itself. Greece identifies under `EL`, Monaco under `FR`, the
  -- Isle of Man under `GB`. Null everywhere else, so that the column holds a
  -- difference and never a copy: `vat_prefix_of()` falls back to the code.
  vat_prefix      char(2),
  -- The text that puts this territory where it is. Required, for the reason
  -- `legal_reference` is required on every tax and every box of a pack: a rule
  -- nobody can trace to a source is a rule nobody can review.
  legal_reference text not null,
  -- ISO 3166-1 is two letters; ISO 3166-2 and the names of article 6 are a
  -- country and a subdivision.
  constraint territories_code_format
    check (code ~ '^[A-Z]{2}(-[A-Z0-9]{1,12})?$'),
  constraint territories_prefix_format
    check (vat_prefix is null or vat_prefix ~ '^[A-Z]{2}$'),
  constraint territories_not_its_own_parent
    check (parent_code is null or parent_code <> code),
  -- A window that is closed before it opens, and a window with an end and no
  -- beginning, are both a row somebody mistyped.
  constraint territories_window_ordered
    check (eu_vat_to is null or (eu_vat_from is not null and eu_vat_from <= eu_vat_to)),
  -- The scope and the window say one thing between them: a territory the
  -- system never reached has no window, and a territory with a window says how
  -- much of the system it got.
  constraint territories_scope_matches_window
    check ((eu_vat_scope = 'none') = (eu_vat_from is null))
);

comment on table territories is
  'The territories of the common system of value added tax: the Member States with the day each became bound, the United Kingdom with the day it stopped being, Northern Ireland, and the territories articles 6 and 7 of Directive 2006/112/EC take out of the system or put into it. Framework data filled by the release, like currencies — no company owns a row and no country pack writes one. A territory this table does not carry is outside the common system, which is the answer for every third country.';

comment on column territories.code is
  'ISO 3166-1 alpha-2 where the territory has one, ISO 3166-2 where only a subdivision code exists, XI for Northern Ireland, and a name of this table for the five territories of article 6 that no register codes. code_source says which.';
comment on column territories.parent_code is
  'The Member State this territory hangs off: the one it is part of, excluded from, or treated as part of.';
comment on column territories.eu_vat_scope is
  'How much of the common system applied during the window below: all of it, supplies of goods only, or none.';
comment on column territories.eu_vat_from is
  'First day the common system of VAT reached this territory. Null where it never did.';
comment on column territories.eu_vat_to is
  'Last day it did. Null while it still does. A VAT date, not a membership one: the United Kingdom left the Union on 31 January 2020 and left the common system on 31 December 2020.';
comment on column territories.vat_prefix is
  'The prefix this territory''s VAT identification numbers carry, when it differs from the code: EL for Greece, FR for Monaco, GB for the Isle of Man. Null when the two are the same.';
comment on column territories.legal_reference is
  'The text that puts this territory where it is — an accession treaty, an article of Directive 2006/112/EC, the Withdrawal Agreement.';

create index territories_parent_code_idx on territories (parent_code);
create index territories_vat_prefix_idx  on territories (vat_prefix);

-- ---------------------------------------------------------------------------
-- Reading it
--
-- Three functions, and the first is the only one that touches the table.
--
-- `territory_of()` resolves what a caller actually holds, which is two letters
-- off a VAT number or out of `contacts.country` — so it matches a code *or* a
-- prefix. A code wins when both match, which is what makes `FR` the French row
-- and not the Monegasque one that borrows its prefix.
--
-- They are `stable` and not `immutable`: they read a table. A migration that
-- corrects a row has to change what they answer, which is the whole reason the
-- rows are not in a function.
-- ---------------------------------------------------------------------------

create or replace function territory_of(p_code text)
returns territories
language sql
stable
as $$
  select t.*
    from territories t
   where t.code = upper(btrim(p_code))
      or t.vat_prefix = upper(btrim(p_code))
   order by (t.code = upper(btrim(p_code))) desc
   limit 1;
$$;

comment on function territory_of(text) is
  'The territory a code or a VAT prefix names, or null when this table carries none. A code wins over a prefix, so FR is France and not the Monaco row that identifies under it.';

create or replace function eu_vat_scope_of(p_code text, p_on date default current_date)
returns eu_vat_scope
language sql
stable
as $$
  select coalesce(
    (select case
              when t.eu_vat_from is null                          then 'none'::eu_vat_scope
              when p_on < t.eu_vat_from                           then 'none'::eu_vat_scope
              when t.eu_vat_to is not null and p_on > t.eu_vat_to then 'none'::eu_vat_scope
              else t.eu_vat_scope
            end
       from territory_of(p_code) t
      where t.code is not null),
    'none'::eu_vat_scope);
$$;

comment on function eu_vat_scope_of(text, date) is
  'How much of the common system of VAT applied to a territory on a day: all of it, supplies of goods only, or none. A territory this table does not carry answers none, which is the right answer for every third country.';

create or replace function is_eu_member(p_code text, p_on date default current_date)
returns boolean
language sql
stable
as $$
  select eu_vat_scope_of(p_code, p_on) = 'full';
$$;

comment on function is_eu_member(text, date) is
  'True when the whole of the common system of VAT applied to the territory on that day: every Member State, and Monaco, whose transactions article 7(1) treats as French. False for Northern Ireland, which is inside the system for goods alone, and false for a State from the day it left.';

create or replace function vat_prefix_of(p_code text)
returns char(2)
language sql
stable
as $$
  select case when resolved.prefix ~ '^[A-Z]{2}$' then resolved.prefix::char(2) end
    from (
      select coalesce(
               (select coalesce(t.vat_prefix::text, t.code)
                  from territory_of(p_code) t
                 where t.code is not null),
               upper(btrim(p_code))
             ) as prefix
    ) resolved;
$$;

comment on function vat_prefix_of(text) is
  'The two letters a territory''s VAT identification numbers carry: EL for Greece, FR for Monaco, GB for the Isle of Man, and the code itself everywhere else — including for a territory this table does not carry, whose own two letters come back unchanged. Null when what it resolves to is not two letters, which is a territory that identifies under nobody.';

-- ---------------------------------------------------------------------------
-- Who may read it
--
-- Reference data, like the currencies: a select policy for anyone signed in,
-- and no policy that writes. The rows are the law and the writer is a
-- migration running on the owner's connection.
--
-- `anon` gets nothing, and the question was asked rather than assumed: the one
-- reader of this installation who has no session is somebody following a
-- document share link, and nothing that renders a shared document reads this
-- table — the legal mentions of an invoice come from the pack of its company.
-- The day a renderer needs to name a territory, the honest answer is a column
-- on the document, snapshotted like `vat_category` already is, and not a
-- reference table opened to the world.
-- ---------------------------------------------------------------------------

alter table territories enable row level security;

create policy territories_select on territories
  for select using (auth.uid() is not null);

revoke all on table territories from public, anon;
grant select on table territories to authenticated, service_role;

revoke execute on function territory_of(text)               from public, anon;
revoke execute on function eu_vat_scope_of(text, date)      from public, anon;
revoke execute on function is_eu_member(text, date)         from public, anon;
revoke execute on function vat_prefix_of(text)              from public, anon;

grant execute on function territory_of(text)               to authenticated, service_role;
grant execute on function eu_vat_scope_of(text, date)      to authenticated, service_role;
grant execute on function is_eu_member(text, date)         to authenticated, service_role;
grant execute on function vat_prefix_of(text)              to authenticated, service_role;
