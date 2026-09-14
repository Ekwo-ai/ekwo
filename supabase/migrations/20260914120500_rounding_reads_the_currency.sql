-- Ekwo OS — an amount is rounded at the decimals of its currency, by the
-- method of its country.
--
-- Two columns had been filled by every pack and read by nothing:
-- `currencies.decimal_places`, which says the yen has none and the dinar has
-- three, and `country_defaults.rounding_method`, which says how a country
-- turns a half into a figure. Everything in the schema rounded with
-- `round(x, 2)` instead — fifty-one times, in eighteen functions, a view and
-- a generated column. Two decimals is right for every currency the packs
-- carry and wrong for about a quarter of the world's; and "half up" was not
-- a decision anywhere, it was what `round()` happens to do.
--
-- What a hard-coded two costs is not theoretical. A yen invoice of 1 234,5
-- would be booked at 1 234,50 and settled at 1 235, and the cent that does
-- not exist in that currency would sit on a suspense account for ever. The
-- rule is the same one the three copies of `rounding.ts` already carry: half
-- up on the absolute value, at the currency's decimals, so that a credit note
-- is its invoice with the sign flipped.
--
-- This migration adds the vocabulary; the next one makes the schema speak it.
--
--   * `money_rounding` is the pair that answers "how is this amount
--     written": the decimals of a currency and the method of a country.
--     They travel together because neither is an answer on its own.
--   * `round_amount(amount, rounding)` is the arithmetic, and the only place
--     in the whole schema where a rounding method is named. It looks nothing
--     up, which is what lets it be immutable and used in a view.
--   * `rounding_of(company, currency)` is the lookup, and the only place
--     where the two columns are read. A currency it does not know, a company
--     it does not know, a country with no model: each is refused by name.
--     None of the three is guessed, and there is no fallback currency and no
--     fallback country anywhere in it.
--   * `currency_unit(rounding)` is the smallest amount the currency has — a
--     cent in the euro, a yen in the yen. The tolerances that used to be
--     written `0.005` are half a unit, which is the thing they always meant.
--   * `amount_text_format(rounding)` is the `to_char` mask that goes with it,
--     for the two places an amount is put into a sentence.

-- ---------------------------------------------------------------------------
-- The pair
-- ---------------------------------------------------------------------------

create type money_rounding as (
  decimals smallint,
  method   rounding_method
);

comment on type money_rounding is
  'How an amount is written: the decimals of its currency and the rounding method of its country. Resolved by rounding_of(), applied by round_amount().';

-- ---------------------------------------------------------------------------
-- The arithmetic
-- ---------------------------------------------------------------------------

create or replace function round_amount(p_amount numeric, p_rounding money_rounding)
returns numeric
language plpgsql
immutable
as $$
declare
  v_decimals smallint;
  v_unit     numeric;
  v_value    numeric;
  v_floor    numeric;
  v_rest     numeric;
  v_result   numeric;
begin
  if p_amount is null then
    return null;
  end if;

  v_decimals := (p_rounding).decimals;
  if v_decimals is null then
    raise exception 'no_rounding_scale: an amount cannot be rounded without the decimals of its currency';
  end if;
  if (p_rounding).method is null then
    raise exception 'no_rounding_method: an amount cannot be rounded without the method of its country';
  end if;

  -- Everything happens on the absolute value and the sign is put back at the
  -- end, so that the rounding of -x is the rounding of x signed back. A rule
  -- that is not symmetric puts a unit between an invoice and its credit note.
  v_unit  := power(10::numeric, (-v_decimals)::numeric);
  v_value := abs(p_amount);
  v_floor := trunc(v_value, v_decimals);
  v_rest  := v_value - v_floor;

  case (p_rounding).method
    when 'half_up' then
      -- Half away from zero, which on an absolute value is half up.
      v_result := round(v_value, v_decimals);
    when 'down' then
      v_result := v_floor;
    when 'up' then
      v_result := case when v_rest = 0 then v_floor else v_floor + v_unit end;
    when 'half_even' then
      if v_rest * 2 > v_unit then
        v_result := v_floor + v_unit;
      elsif v_rest * 2 < v_unit then
        v_result := v_floor;
      else
        -- Exactly half: towards the even neighbour, which is what "banker's
        -- rounding" means and what a country that declares it is asking for.
        v_result := case when (v_floor / v_unit) % 2 = 0 then v_floor else v_floor + v_unit end;
      end if;
  end case;

  -- The scale of the answer is the currency's, whatever the arithmetic left
  -- behind: an amount in yen is written with no decimals at all.
  v_result := round(v_result, v_decimals);
  return case when p_amount < 0 then -v_result else v_result end;
end;
$$;

comment on function round_amount(numeric, money_rounding) is
  'Rounds an amount at the decimals of its currency, by the method of its country. The only function of the schema that names a rounding method; every other one asks rounding_of() and passes the answer here.';

-- The smallest amount this currency has. A cent in the euro, a yen in the
-- yen, a millime in the dinar.
create or replace function currency_unit(p_rounding money_rounding)
returns numeric
language sql
immutable
as $$
  select round(power(10::numeric, (-(p_rounding).decimals)::numeric), (p_rounding).decimals);
$$;

comment on function currency_unit(money_rounding) is
  'The smallest amount a currency has: a cent in the euro, a yen in the yen. A tolerance is written as a fraction of this rather than as a fraction of a cent.';

-- The mask `to_char` needs to write an amount of this currency. A yen result
-- reported as "1234.00" claims a precision the currency does not have.
create or replace function amount_text_format(p_rounding money_rounding)
returns text
language sql
immutable
as $$
  select 'FM9999999999999990'
      || case when (p_rounding).decimals > 0
              then '.' || repeat('0', (p_rounding).decimals)
              else '' end;
$$;

comment on function amount_text_format(money_rounding) is
  'The to_char mask an amount of this currency is written with. Two decimals for the euro, none for the yen, three for the dinar.';

-- ---------------------------------------------------------------------------
-- The lookup
-- ---------------------------------------------------------------------------

create or replace function rounding_of(p_company_id uuid, p_currency_code text default null)
returns money_rounding
language plpgsql
stable
as $$
declare
  v_currency char(3);
  v_country  char(2);
  v_out      money_rounding;
begin
  select coalesce(p_currency_code, c.currency_code), coalesce(c.fiscal_country, c.country)
    into v_currency, v_country
    from companies c
   where c.id = p_company_id;

  if not found then
    raise exception 'unknown_company: % does not exist, and an amount is rounded by the country and the currency of a company', p_company_id;
  end if;

  -- The decimals are the currency's, from the instance's own reference data.
  select cu.decimal_places into v_out.decimals
    from currencies cu where cu.code = v_currency;
  if v_out.decimals is null then
    raise exception 'unknown_currency: % is not a currency of this installation, so the decimals an amount is written with are unknown', v_currency;
  end if;

  -- The method is the country's, from the pack. A pack that says nothing
  -- about rounding got the column's own default when it was compiled, which
  -- is a decision taken once in the schema and not a country borrowed here.
  select cd.rounding_method into v_out.method
    from country_defaults cd where cd.country = v_country;
  if v_out.method is null then
    raise exception 'no_country_model: this installation carries no country model for %, so the method its amounts are rounded by is unknown', v_country;
  end if;

  return v_out;
end;
$$;

comment on function rounding_of(uuid, text) is
  'How this company writes an amount in this currency, or in its own when none is named. The only place currencies.decimal_places and country_defaults.rounding_method are read.';

-- These three are read by every posting and every report, so they are open to
-- a signed-in member and to nobody else. `anon` reads the public surface of
-- an installation and books nothing.
revoke execute on function round_amount(numeric, money_rounding) from public, anon;
revoke execute on function currency_unit(money_rounding)         from public, anon;
revoke execute on function amount_text_format(money_rounding)    from public, anon;
revoke execute on function rounding_of(uuid, text)               from public, anon;

grant execute on function round_amount(numeric, money_rounding) to authenticated, service_role;
grant execute on function currency_unit(money_rounding)         to authenticated, service_role;
grant execute on function amount_text_format(money_rounding)    to authenticated, service_role;
grant execute on function rounding_of(uuid, text)               to authenticated, service_role;

revoke execute on all functions in schema public from public;
