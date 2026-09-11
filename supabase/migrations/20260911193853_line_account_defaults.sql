-- Ekwo OS — the account a document line falls back to.
--
-- `country_defaults` shipped with three columns nothing ever read:
-- `sales_account_code`, `purchase_account_code` and `currency_code`. Keeping
-- a column "in case" is the state the naming policy forbids, so the choice
-- was between deleting them and giving them a reader. They get a reader,
-- because the thing they describe is real: every chart of accounts has one
-- account a sale lands on by default and one a purchase lands on, and
-- somebody has to suggest it. `currency_code` gets its reader in the CLI —
-- `ekwo init` offers it as the currency of the company, before the insert,
-- because `companies.currency_code` is `not null default 'EUR'` and is
-- therefore never empty by the time `install_country_template` runs.
--
-- The order of resolution for the account of a document line, from the most
-- specific to the least:
--
--   1. the line itself — `document_lines.account_id`;
--   2. the product, once `products` exists (added by a later migration, which
--      replaces the trigger body to consult it);
--   3. the company default — `companies.default_sales_account_id` /
--      `default_purchase_account_id`, new here;
--   4. the country model — `country_defaults.sales_account_code` /
--      `purchase_account_code`, resolved against the company's own chart.
--
-- Nothing is guessed from a code prefix, which is the rule the rest of the
-- schema already keeps: `411` is *customers* on the French chart and
-- *recoverable VAT* on the Belgian one.
--
-- The resolution runs in a trigger rather than in each client. Lines are
-- created by whoever holds a token — the MCP server, PostgREST, psql — and
-- `document_lines_product_has_account` refuses a product line with no
-- account, so a null account can only ever mean "resolve it". A null *tax*
-- is a different matter: it means no tax at all, which is a real answer, so
-- nothing here fills it in.

alter table companies
  add column if not exists default_sales_account_id    uuid,
  add column if not exists default_purchase_account_id uuid;

alter table companies
  add constraint companies_default_sales_account_fkey
    foreign key (default_sales_account_id) references accounts(id) on delete set null,
  add constraint companies_default_purchase_account_fkey
    foreign key (default_purchase_account_id) references accounts(id) on delete set null;

comment on column companies.default_sales_account_id is
  'Income account a sales line falls back to when it names none. Wired from country_defaults.sales_account_code at install.';
comment on column companies.default_purchase_account_id is
  'Expense account a purchase line falls back to when it names none. Wired from country_defaults.purchase_account_code at install.';

-- ---------------------------------------------------------------------------
-- resolve_line_account
--
-- `stable` and not `security definer`: it reads `companies` and
-- `country_defaults`, both of which the caller may read anyway — a member of
-- the company for the first, anyone signed in for the second. A definer here
-- would widen nothing and hide the policy that already decides.
-- ---------------------------------------------------------------------------

create or replace function resolve_line_account(
  p_company_id uuid,
  p_doc_type   doc_type,
  p_account_id uuid
)
returns uuid
language plpgsql
stable
as $$
declare
  v_is_sale boolean;
  v_account uuid;
  v_country char(2);
  v_code    text;
begin
  if p_account_id is not null then
    return p_account_id;
  end if;

  v_is_sale := p_doc_type in ('sale_invoice', 'sale_credit_note', 'sale_quote');

  select case when v_is_sale then c.default_sales_account_id
              else c.default_purchase_account_id end,
         c.country
    into v_account, v_country
    from companies c
   where c.id = p_company_id;

  if v_account is not null then
    return v_account;
  end if;

  select case when v_is_sale then d.sales_account_code else d.purchase_account_code end
    into v_code
    from country_defaults d
   where d.country = v_country;

  if v_code is null then
    return null;
  end if;

  return account_id_by_code(p_company_id, v_code);
end;
$$;

comment on function resolve_line_account(uuid, doc_type, uuid) is
  'Account of a document line: the line, then the company default, then the country model. Never a code prefix.';

-- ---------------------------------------------------------------------------
-- The trigger
--
-- One path for every client. A line that names its account keeps it; a line
-- that names none gets the default, and when there is no default anywhere the
-- existing check constraint raises, which is the honest outcome.
-- ---------------------------------------------------------------------------

create or replace function document_lines_resolve_account()
returns trigger
language plpgsql
as $$
declare
  v_doc_type doc_type;
begin
  if new.line_type <> 'product' or new.account_id is not null then
    return new;
  end if;

  select d.doc_type into v_doc_type from documents d where d.id = new.document_id;
  if v_doc_type is null then
    return new;
  end if;

  new.account_id := resolve_line_account(new.company_id, v_doc_type, null);
  return new;
end;
$$;

create trigger document_lines_resolve_account
  before insert or update on document_lines
  for each row execute function document_lines_resolve_account();

-- ---------------------------------------------------------------------------
-- The country model now wires the two company defaults as well.
--
-- Only step 5 changes; the rest of the function is the one migration
-- `…183000` published, repeated because Postgres replaces a function whole.
-- A company that already chose an account keeps it, as everywhere else here.
-- ---------------------------------------------------------------------------

create or replace function install_country_template(
  p_company_id uuid,
  p_country    char(2)
)
returns void
language plpgsql
as $$
declare
  v_defaults country_defaults%rowtype;
  r          record;
  v_tax_id   uuid;
begin
  if not exists (select 1 from companies where id = p_company_id) then
    raise exception 'unknown_company: %', p_company_id;
  end if;
  if not exists (select 1 from account_templates where country = p_country) then
    raise exception 'unknown_country_template: no chart of accounts seeded for %', p_country;
  end if;

  -- 1. Accounts, without the hierarchy.
  insert into accounts (company_id, code, name, account_type, reconcilable)
  select p_company_id, t.code, t.name, t.account_type, t.reconcilable
    from account_templates t
   where t.country = p_country
  on conflict (company_id, code) do nothing;

  -- 2. Hierarchy, now that every code exists.
  update accounts a
     set parent_id = p.id
    from account_templates t
    join accounts p on p.company_id = p_company_id and p.code = t.parent_code
   where a.company_id = p_company_id
     and a.code = t.code
     and t.country = p_country
     and t.parent_code is not null
     and a.parent_id is null;

  -- 3. Journals.
  insert into journals (company_id, code, name, journal_type)
  select p_company_id, t.code, t.name, t.journal_type
    from journal_templates t
   where t.country = p_country
  on conflict (company_id, code) do nothing;

  -- 4. Taxes and their postings.
  for r in
    select * from tax_templates where country = p_country order by sequence, code
  loop
    v_tax_id := null;
    insert into taxes (company_id, code, name, description, amount_type, amount,
                       applies_to, treatment, country, valid_from, valid_to,
                       legal_reference, vat_category, exemption_code, sequence)
    values (p_company_id, r.code, r.name, r.description, r.amount_type, r.amount,
            r.applies_to, r.treatment, p_country, r.valid_from, r.valid_to,
            r.legal_reference, r.vat_category, r.exemption_code, r.sequence)
    on conflict (company_id, code) do nothing
    returning id into v_tax_id;

    if v_tax_id is null then
      continue;
    end if;

    insert into tax_postings (tax_id, company_id, document_kind, posting_type,
                              factor_percent, account_id, declaration_box,
                              box_factor_percent, sequence)
    select v_tax_id, p_company_id, tp.document_kind, tp.posting_type,
           tp.factor_percent, account_id_by_code(p_company_id, tp.account_code),
           tp.declaration_box, tp.box_factor_percent, tp.sequence
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

    -- 6. The financial journals point at their account, so money booked
    --    through them lands somewhere without the operator wiring it first.
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
end;
$$;

comment on function install_country_template(uuid, char) is
  'Copies a country chart of accounts, journals and taxes into a company, wires the default roles — third parties, sales and purchase imputation, financial journals.';

-- Backfill for a company installed before this migration: it already has the
-- chart, so the two defaults can be filled from its own country model.
update companies c
   set default_sales_account_id = account_id_by_code(c.id, d.sales_account_code)
  from country_defaults d
 where d.country = c.country
   and c.default_sales_account_id is null
   and d.sales_account_code is not null;

update companies c
   set default_purchase_account_id = account_id_by_code(c.id, d.purchase_account_code)
  from country_defaults d
 where d.country = c.country
   and c.default_purchase_account_id is null
   and d.purchase_account_code is not null;
