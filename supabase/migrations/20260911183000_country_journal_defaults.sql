-- Ekwo OS — a country template that wires the financial journals too.
--
-- `country_defaults.bank_account_code` was declared from the first release and
-- read by nothing: `install_country_template` wired the receivable, payable,
-- suspense, rounding and retained-earnings accounts and the three journals of
-- the company, and left `journals.default_account_id` null on every one of
-- them. A country model whose financial journal points at no account is not a
-- model — the demo seed had to wire it by hand, which was the symptom.
--
-- It surfaced on the first payment booked through a client: `post_payment()`
-- looks for the bank side on the payment's bank account, then on the default
-- account of its journal, and found neither on a freshly installed company.
-- The refusal, `no_bank_account`, was correct and the configuration was what
-- was wrong.
--
-- So the bank journal and the cash journal get their account from the country
-- model, like everything else. `cash_account_code` is added because the cash
-- journal needs its own — `570000` in the PCMN, `530000` in the PCG — and
-- these two codes do not derive from one another any more than `550000` and
-- `512000` do.
--
-- Only new columns and a `create or replace`: nothing already published is
-- edited, and a company that already has a default account keeps it.

alter table country_defaults add column if not exists cash_account_code text;

comment on column country_defaults.cash_account_code is
  'Ledger account behind the cash journal of this country, from the pack of that country.';

-- No backfill here. The value of this column is pack data, and the compiled
-- seed of every country upserts `country_defaults` — so re-applying the seeds
-- fills it, on a fresh install and on an existing one alike. A migration that
-- wrote it would have to name a country and a code, and a country is data.

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
           sales_journal_id            = coalesce(c.sales_journal_id, (select id from journals where company_id = p_company_id and code = v_defaults.sales_journal_code)),
           purchase_journal_id         = coalesce(c.purchase_journal_id, (select id from journals where company_id = p_company_id and code = v_defaults.purchase_journal_code)),
           miscellaneous_journal_id    = coalesce(c.miscellaneous_journal_id, (select id from journals where company_id = p_company_id and code = v_defaults.misc_journal_code))
     where c.id = p_company_id;

    -- 6. The financial journals point at their account, so money booked
    --    through them lands somewhere without the operator wiring it first.
    --    `default_account_id is null` keeps a company that already chose one.
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
  'Copies a country chart of accounts, journals and taxes into a company, wires the default roles and points the financial journals at their account.';
