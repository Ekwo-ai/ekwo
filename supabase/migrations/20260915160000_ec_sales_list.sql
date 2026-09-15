-- Ekwo OS — the recapitulative statement of intra-Community supplies, as one
-- function of the core.
--
-- Every Member State asks the same question of a seller: to whom, in another
-- Member State, did you supply goods and services without charging VAT, and
-- for how much. The answer is a list of lines, one per customer VAT number and
-- per nature of supply, and every administration then wants it in a file of
-- its own shape. That split is the whole design here.
--
-- **The list is the engine. The file is a brick.** `ec_sales_list()` returns
-- flat rows and knows no country; `packages/formats/` turns those rows into
-- the XML Belgium, France, Luxembourg or Estonia expects, one package per
-- format. There is no `packs/eu/`, because what is European here is not data a
-- country fills in — it is the rule that reads the treatment of a tax and the
-- VAT number of a contact, and that rule is the same everywhere.
--
-- Four decisions are worth reading before the SQL.
--
-- **The nature of a supply comes from the treatment, and nothing is listed by
-- name.** A sale line whose tax is treated `intracom_goods` is goods,
-- `intracom_services` is services, and the nature is the treatment with its
-- `intracom_` prefix removed. So the day the enum gains `intracom_triangular`
-- — the third category every one of these forms already prints — this function
-- returns a `triangular` nature without a line of it changing. The acquisition
-- treatments are excluded by name for the same reason they are named that way:
-- they are the purchase side, and a recapitulative statement is about supplies.
--
-- **It reads the ledger, not the invoices.** The same posted `entry_lines`
-- that `vat_return()` sums, over the same dates, in the company's currency —
-- which is why the two agree to the cent and why a test can prove it. The base
-- lines of an intra-Community supply are the lines of its tax that are not tax
-- lines: such a supply is exempt, so its tax carries a `base` posting and
-- nothing else. A `tax_on_base` or a `cash_basis` posting on a tax treated as
-- an intra-Community supply would be a defect of the pack — there is no VAT on
-- the line to capitalise and none to defer — and `docs/international.md`
-- records the underlying gap: a ledger line does not say which posting wrote
-- it.
--
-- **It refuses no period.** `vat_return()` refuses a period the company does
-- not file its return on, because `companies.vat_period` records that. Nothing
-- records how often the *statement* is filed, and it is a different cadence in
-- every country read while writing this: Belgium files it monthly above a
-- threshold that counts goods only, whatever the return's cadence; France
-- files it monthly always; Luxembourg lets goods and services take different
-- cadences, both independent of the return; Estonia files it monthly with the
-- return. A guard borrowed from the return would refuse a lawful monthly
-- statement from a quarterly filer, which is the ordinary Belgian case. So
-- this function takes two dates and answers for them. The gap — a company
-- records one cadence and there is more than one — is written down in
-- `docs/international.md` rather than patched here.
--
-- **What cannot be declared comes back, it is not dropped.** A supply whose
-- customer has no VAT number, or a number whose country is the company's own,
-- is returned with the reason in `issue` rather than silently left out of the
-- total. A brick puts those rows in `violations[]` and the rest in the file,
-- which is the contract every format library here already has.

-- ---------------------------------------------------------------------------
-- ec_sales_list(company, from, to)
-- ---------------------------------------------------------------------------

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
  v_currency char(3);
  v_round    money_rounding;
begin
  select c.fiscal_country, c.currency_code into v_country, v_currency
    from companies c where c.id = p_company_id;
  if not found then
    raise exception 'unknown_company: %', p_company_id;
  end if;
  v_round := rounding_of(p_company_id);

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
  with supply as (
    select d.contact_id,
           ct.name                                              as contact_name,
           regexp_replace(t.treatment::text, '^intracom_', '')   as nature,
           -- The number as somebody typed it, reduced to what an
           -- administration compares: upper case, letters and digits.
           upper(regexp_replace(coalesce(ct.vat_number, ''), '[^A-Za-z0-9]', '', 'g')) as vat_raw,
           ct.country                                           as contact_country,
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
  --    the contact answers. Nothing here knows a Member State from any other
  --    country — the core holds no such list, which `docs/international.md`
  --    records — so the only country this compares against is the company's.
  keyed as (
    select s.*,
           case when s.vat_raw ~ '^[A-Z]{2}' then substring(s.vat_raw from 1 for 2)
                when s.vat_raw = ''          then null
                else s.contact_country
           end as vat_country,
           case when s.vat_raw = ''          then null
                when s.vat_raw ~ '^[A-Z]{2}' then substring(s.vat_raw from 3)
                else s.vat_raw
           end as vat_number
      from supply s
  ),
  -- 3. Why a line cannot be declared, or null when it can. Ordered from the
  --    most missing to the most contradictory, so a row carries the first
  --    thing somebody has to fix.
  judged as (
    select k.*,
           case
             when k.contact_id is null                      then 'no_customer'
             when k.vat_number is null or k.vat_number = ''  then 'no_vat_number'
             when k.vat_country is null                      then 'no_vat_country'
             when k.vat_country = v_country                  then 'vat_country_is_the_company_country'
           end as issue
      from keyed k
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
  'The recapitulative statement of intra-Community supplies for a period: one line per customer VAT number and per nature — goods, services, and whatever the treatment vocabulary gains next — summed from the posted ledger in the company''s currency, credit notes deducted. A supply that cannot be declared comes back with the reason in `issue` rather than being left out. No country rule lives in this function, and it refuses no period: how often a statement is filed is not what companies.vat_period records.';

revoke execute on function ec_sales_list(uuid, date, date) from public, anon;
grant  execute on function ec_sales_list(uuid, date, date) to authenticated, service_role;
