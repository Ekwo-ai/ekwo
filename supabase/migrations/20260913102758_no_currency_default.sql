-- Ekwo OS — a euro written into the schema is a country written into the core.
--
-- Seven columns were declared `char(3) not null default 'EUR'` and one
-- `char(2) not null default 'fr'`. They date from before "a country is data"
-- was a rule, and they are the same mistake the country literals were: a
-- Canadian installation that forgets to name a currency does not get an
-- error, it gets euros — in its documents, its payments, its catalogue, its
-- bank accounts and its statements — and finds out at the first report.
--
-- The defaults go. What replaces them is not another default but the answer
-- that was always the right one, taken from the row above:
--
--   * a company's currency and language come from **the pack of its fiscal
--     country** or from whoever creates it. `create_company()` already
--     refuses both by name when the pack is silent (`no_currency`,
--     `no_language`) and `ekwo init` asks; for every other writer a trigger
--     reads `country_defaults`, so a silent pack leaves the column null and
--     the NOT NULL refuses the insert. Silence is an error again, where it
--     used to be euros;
--   * a document, a payment, a catalogue item and a bank account take the
--     currency of **their company**, and a statement line takes the currency
--     of **its bank account**, which is a stronger answer than the company's
--     and falls back to it. One trigger, one place, no literal;
--   * `country_defaults.currency_code` is pack data and the compiled seed of
--     every country fills it. A default there would have meant a pack that
--     says nothing about its own currency silently claims the euro.
--
-- The trigger fills only what the caller left empty, so a foreign-currency
-- document still says so and nothing that used to work stops working. What
-- changes is what happens when *nobody* answers: it used to be euros, and it
-- is now the company, which is an answer the installation actually chose.

alter table companies         alter column currency_code drop default;
alter table companies         alter column language      drop default;
alter table country_defaults  alter column currency_code drop default;
alter table documents         alter column currency_code drop default;
alter table payments          alter column currency_code drop default;
alter table products          alter column currency_code drop default;
alter table bank_accounts     alter column currency_code drop default;
alter table bank_transactions alter column currency_code drop default;

-- ---------------------------------------------------------------------------
-- Where a currency comes from when the caller names none
--
-- A BEFORE INSERT trigger rather than a column default, because a default can
-- only be a constant and the answer is a lookup. It runs before the NOT NULL
-- is checked, which is what lets the column stay NOT NULL with no default at
-- all: leave it out and the company answers; leave the company out and the
-- insert is refused by the foreign key, as it already was.
-- ---------------------------------------------------------------------------

create or replace function currency_of_company()
returns trigger
language plpgsql
as $$
begin
  if new.currency_code is null then
    select c.currency_code into new.currency_code
      from companies c where c.id = new.company_id;
  end if;
  return new;
end;
$$;

comment on function currency_of_company() is
  'Fills currency_code from the company when the caller named none. The one place the question is answered for a table that belongs to a company.';

-- A company has no company above it: its answer is its country's pack. A
-- pack that names neither leaves the column null, and NOT NULL refuses the
-- row — which is the whole point of dropping the default.
create or replace function locale_of_country_pack()
returns trigger
language plpgsql
as $$
declare
  v_defaults country_defaults%rowtype;
begin
  if new.currency_code is null or new.language is null then
    select * into v_defaults
      from country_defaults
     where country = coalesce(new.fiscal_country, new.country);
    new.currency_code := coalesce(new.currency_code, v_defaults.currency_code);
    new.language      := coalesce(new.language, v_defaults.language_default);
  end if;
  return new;
end;
$$;

comment on function locale_of_country_pack() is
  'Fills a company''s currency and language from the pack of its fiscal country when the caller named neither. A pack that says nothing leaves them null, and NOT NULL refuses the row.';

create trigger companies_locale_of_country_pack
  before insert on companies
  for each row execute function locale_of_country_pack();

create trigger documents_currency_of_company
  before insert on documents
  for each row execute function currency_of_company();

create trigger payments_currency_of_company
  before insert on payments
  for each row execute function currency_of_company();

create trigger products_currency_of_company
  before insert on products
  for each row execute function currency_of_company();

create trigger bank_accounts_currency_of_company
  before insert on bank_accounts
  for each row execute function currency_of_company();

-- A statement line is in the currency of the account it came off, which is
-- not always the company's. The account answers first, the company after.
create or replace function currency_of_bank_account()
returns trigger
language plpgsql
as $$
begin
  if new.currency_code is null then
    select b.currency_code into new.currency_code
      from bank_accounts b where b.id = new.bank_account_id;
  end if;
  if new.currency_code is null then
    select c.currency_code into new.currency_code
      from companies c where c.id = new.company_id;
  end if;
  return new;
end;
$$;

comment on function currency_of_bank_account() is
  'Fills a statement line''s currency_code from its bank account, and from the company as a last resort.';

create trigger bank_transactions_currency_of_bank_account
  before insert on bank_transactions
  for each row execute function currency_of_bank_account();

revoke execute on all functions in schema public from public;
