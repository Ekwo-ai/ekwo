-- Ekwo OS — the recapitulative statement stops guessing at the Union.
--
-- `20260915160000` wrote `ec_sales_list()` with two holes it could not fill,
-- and `docs/international.md` recorded both. `territories` fills them, and this
-- migration is the function reading it. Nothing else about the statement
-- changes: the same columns in the same order, the same aggregation, the same
-- reconciliation with the return. What changes is what goes in two of the
-- columns and what comes back in a third.
--
-- **A customer's VAT country is the prefix their numbers carry, not their ISO
-- code.** Greece identifies under `EL` and Northern Ireland under `XI`, and
-- neither is an ISO 3166-1 code. The old function took the two letters off the
-- number when there were two, and the contact's ISO country when there were
-- not — so a Greek customer recorded as `GR` with an unprefixed number was
-- listed under `GR`, which every one of the four administrations refuses. Both
-- paths now go through `vat_prefix_of()`, so a number typed `GR...` is
-- corrected as readily as a number typed with no prefix at all, and a
-- territory the table does not carry keeps its own two letters.
--
-- **The company's own country is compared through the same function.** It was
-- compared raw, which is a defect nobody could see from Belgium or France: a
-- Greek company's `fiscal_country` is `GR` and its own customers' numbers say
-- `EL`, so `vat_country_is_the_company_country` would never have fired there
-- and a domestic supply would have been listed as an intra-Community one. Two
-- prefixes are now compared with two prefixes.
--
-- **A supply to a territory the common system does not cover comes back as an
-- issue.** This is the check the function could not make at all — it could
-- only say that the customer was not in the company's own country — and it is
-- the one that matters most, because a tax treated `intracom_goods` on a
-- customer in a third country is a pack or a book-keeping mistake that
-- produces a file an administration rejects. Two reasons, because there are
-- two different things to fix:
--
--   * `vat_country_outside_the_union` — the common system did not reach that
--     territory on the day of the supply. A third country; a Member State
--     before it acceded; the United Kingdom from 1 January 2021.
--   * `vat_country_outside_the_union_for_this_supply` — the territory is
--     inside the system for part of what it covers and not for this. Northern
--     Ireland is the only such territory and services are the only such
--     supply: the Protocol keeps the Union's rules on goods and not its rules
--     on services, so a supply of goods to an `XI` customer belongs on the
--     statement and a supply of services to the same customer does not.
--
-- **The date of the supply decides, not today.** `eu_vat_scope_of()` takes a
-- date and the function passes the entry date of the line, so a statement for
-- a period in 2020 still reports supplies to the United Kingdom and a
-- statement for 2021 does not. A statement reprinted years later has to give
-- the same answer it gave when it was filed, which is the same rule the packs
-- follow with `valid_from` on every tax.
--
-- **The row shape does not move, and the format bricks do not change.** They
-- receive a prefix already resolved and an `issue` they put in `violations[]`
-- whatever it says, which is the contract they were written to. Nothing under
-- `packages/formats/` imports anything from the core, and nothing there had to
-- learn what a Member State is.
--
-- **A database without the rows says so.** `territories` is seeded, like the
-- currencies, and an installation that applied the migration and not the seed
-- would have the table, no rows, and a statement in which every single
-- customer came back as outside the Union. So the function refuses first, by
-- name — `no_territories` — which is the answer `rounding_of()` gives for a
-- currency it does not know and the rule `CONTRIBUTING.md` states as *raise,
-- do not warn*.
--
-- One thing this still does not read: which supplies a *triangular*
-- arrangement makes. The nature comes off the treatment as it always did, so
-- `intracom_triangular` — added two migrations further on — arrives here as
-- `triangular` with nothing in this file changing.

create or replace function ec_sales_list(
  p_company_id uuid,
  p_from       date,
  p_to         date
)
returns table (
  vat_country   char(2),
  vat_number    text,
  nature        text,
  amount        numeric,
  currency_code char(3),
  documents     integer,
  contact_ids   uuid[],
  contact_names text[],
  issue         text
)
language plpgsql
stable
as $$
declare
  v_country  char(2);
  v_prefix   char(2);
  v_currency char(3);
  v_round    money_rounding;
begin
  select c.fiscal_country, c.currency_code into v_country, v_currency
    from companies c where c.id = p_company_id;
  if not found then
    raise exception 'unknown_company: %', p_company_id;
  end if;
  -- The rows of `territories` are a seed, and a database that has the table
  -- and not the rows would answer that no customer anywhere is in the Union —
  -- a statement full of violations and a total of nothing, with no sign that
  -- anything was missing. Raise, do not warn.
  if not exists (select 1 from territories) then
    raise exception 'no_territories: apply supabase/seed/00_territories.sql';
  end if;

  v_prefix := vat_prefix_of(v_country);
  v_round  := rounding_of(p_company_id);

  return query
  -- 1. The supplies themselves: the base lines of every tax treated as an
  --    intra-Community supply, on posted entries of the period.
  --
  --    `credit - debit` is the amount with the sign the statement wants: a
  --    sale credits the revenue account and a credit note debits it, so a
  --    credit note is deducted from the customer's line without this having
  --    to know what a credit note is. It is also why no total here can be
  --    read off one box of the return: Belgium reports its credit notes in a
  --    box of their own, France nets them into the box they came from.
  --
  --    The entry date travels with the line because the territory question is
  --    asked as at the day of the supply and not as at today.
  with supply as (
    select d.contact_id,
           ct.name                                              as contact_name,
           regexp_replace(t.treatment::text, '^intracom_', '')   as nature,
           -- The number as somebody typed it, reduced to what an
           -- administration compares: upper case, letters and digits.
           upper(regexp_replace(coalesce(ct.vat_number, ''), '[^A-Za-z0-9]', '', 'g')) as vat_raw,
           ct.country                                           as contact_country,
           e.entry_date,
           e.document_id,
           l.credit - l.debit                                   as amount
      from entry_lines l
      join entries  e  on e.id = l.entry_id
      join taxes    t  on t.id = l.tax_id
      left join documents d on d.id = e.document_id
      left join contacts  ct on ct.id = d.contact_id
     where l.company_id = p_company_id
       and e.state = 'posted'
       and e.entry_date between p_from and p_to
       and not l.tax_line
       and t.treatment::text like 'intracom!_%' escape '!'
       and t.treatment::text not like 'intracom!_acquisition!_%' escape '!'
  ),
  -- 2. The identifier the statement is keyed on. A VAT number carries its own
  --    country when it was recorded with one; where it was not, the country of
  --    the contact answers. Either way the two letters go through
  --    `vat_prefix_of()`, which is the only place in this repository that
  --    knows a Greek number says `EL`.
  keyed as (
    select s.*,
           vat_prefix_of(
             case when s.vat_raw ~ '^[A-Z]{2}' then substring(s.vat_raw from 1 for 2)
                  when s.vat_raw = ''          then null
                  else s.contact_country
             end
           ) as vat_country,
           case when s.vat_raw = ''          then null
                when s.vat_raw ~ '^[A-Z]{2}' then substring(s.vat_raw from 3)
                else s.vat_raw
           end as vat_number
      from supply s
  ),
  -- 3. How much of the common system reached that territory on the day of the
  --    supply. Asked of the table and of nothing else: no code in this
  --    function names a State, and the day one accedes or leaves is a row.
  scoped as (
    select k.*, eu_vat_scope_of(k.vat_country, k.entry_date) as scope
      from keyed k
  ),
  -- 4. Why a line cannot be declared, or null when it can. Ordered from the
  --    most missing to the most contradictory, so a row carries the first
  --    thing somebody has to fix.
  judged as (
    select s.*,
           case
             when s.contact_id is null                        then 'no_customer'
             when s.vat_number is null or s.vat_number = ''   then 'no_vat_number'
             when s.vat_country is null                       then 'no_vat_country'
             when s.vat_country = v_prefix                    then 'vat_country_is_the_company_country'
             when s.scope = 'none'                            then 'vat_country_outside_the_union'
             -- A scope narrower than the whole system covers goods and not
             -- services, which is the one distinction the Protocol on
             -- Ireland/Northern Ireland draws. `services` is the only nature
             -- this function derives that is not a supply of goods: the
             -- others — `goods`, and `triangular` when the vocabulary gains
             -- it — are.
             when s.scope <> 'full' and s.nature = 'services'
                                                              then 'vat_country_outside_the_union_for_this_supply'
           end as issue
      from scoped s
  )
  select j.vat_country::char(2),
         j.vat_number,
         j.nature,
         round_amount(sum(j.amount), v_round),
         v_currency,
         count(distinct j.document_id)::integer,
         array_agg(distinct j.contact_id)   filter (where j.contact_id is not null),
         array_agg(distinct j.contact_name) filter (where j.contact_name is not null),
         j.issue
    from judged j
   -- A declarable line is keyed on the VAT number, so two contacts sharing one
   -- — a site and the entity that is invoiced — become the single line the
   -- form wants. A line that cannot be declared is keyed on the contact
   -- instead, because the number is what is missing or wrong and the contact
   -- is what somebody has to open.
   group by j.vat_country, j.vat_number, j.nature, j.issue,
            case when j.issue is not null then j.contact_id end
  having round_amount(sum(j.amount), v_round) <> 0
   order by (j.issue is not null), j.vat_country, j.vat_number, j.nature;
end;
$$;

comment on function ec_sales_list(uuid, date, date) is
  'The recapitulative statement of intra-Community supplies for a period: one line per customer VAT identification number and per nature — goods, services, and whatever the treatment vocabulary gains next — summed from the posted ledger in the company''s currency, credit notes deducted. The country of a line is the prefix the customer''s numbers carry, read from `territories`, so a Greek customer is listed under EL. A supply that cannot be declared comes back with the reason in `issue` rather than being left out, including a supply to a territory the common system of VAT did not cover on the day it was made. No country rule lives in this function, and it refuses no period: how often a statement is filed is not what companies.vat_period records.';

revoke execute on function ec_sales_list(uuid, date, date) from public, anon;
grant  execute on function ec_sales_list(uuid, date, date) to authenticated, service_role;
