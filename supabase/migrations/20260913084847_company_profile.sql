-- Ekwo OS — a company has a face, and an invoice has to print it.
--
-- The core knew a company's name, its legal name, its address, its two
-- identifiers and its currency. An invoice needs more than that, and every
-- one of the missing pieces is a thing a renderer would otherwise have to be
-- configured with separately — which is the same fact written twice, in a
-- place the books cannot see.
--
-- **What is added, and why each one is a column rather than a setting.**
-- `trade_name` because a company trades under a name that is not its
-- statutory one and the invoice carries both. `logo_url` because a renderer
-- needs to find the image — a URL or a storage path, never the file: the core
-- keeps books, not binaries. `share_capital` with its own currency because
-- several European legal forms must state it on every document.
-- `activity_code` with the scheme it is written in, because NACE, APE and SIC
-- are different registers and a bare code is unreadable without the one it
-- came from. `default_bank_account_id` because an invoice without an IBAN
-- cannot be paid. `document_template` because a company that has chosen a
-- layout has chosen it once, not per invoice.
--
-- **What is deliberately not added.** No `registry_reference`:
-- `companies.registration_number` is already the number the commercial
-- register holds — a BCE number in Belgium, an RCS or SIRET in France — and a
-- second column for it would be two answers to one question, which is the one
-- thing this schema will not do.
--
-- **No literal default anywhere.** `share_capital_currency` falls back to the
-- company's own currency, in a trigger, and never to a currency written into
-- this file.

alter table companies
  add column if not exists trade_name              text,
  add column if not exists logo_url                text,
  add column if not exists share_capital           numeric(16, 2),
  add column if not exists share_capital_currency  char(3) references currencies(code),
  add column if not exists activity_code           text,
  add column if not exists activity_scheme         text,
  add column if not exists default_bank_account_id uuid,
  add column if not exists document_template       text;

comment on column companies.trade_name is
  'The name the company trades under, when it is not the statutory one. A renderer shows this and keeps legal_name for the footer.';
comment on column companies.logo_url is
  'Where the logo is, as a URL or a storage path. The core stores no file: an accounting schema that held binaries would be backing up images with the ledger.';
comment on column companies.share_capital is
  'Capital to be stated on documents where the law requires it. Null where it does not, which is not zero.';
comment on column companies.share_capital_currency is
  'Currency the capital is expressed in. Filled with the company''s own currency when it is left empty, and never with a currency written into the schema.';
comment on column companies.activity_code is
  'The company''s activity in the register of its country — NACE, APE, SIC. Text, because the registers are not numbers and not the same length.';
comment on column companies.activity_scheme is
  'Which register activity_code belongs to. A code without its scheme cannot be looked up.';
comment on column companies.default_bank_account_id is
  'The account a customer is asked to pay into. It fills documents.payee_iban (BT-84) when a sales document names none.';
comment on column companies.document_template is
  'A code the renderer interprets. The core never reads it: what a document looks like is not an accounting question.';

alter table companies
  add constraint companies_share_capital_positive
    check (share_capital is null or share_capital >= 0),
  add constraint companies_share_capital_has_currency
    check (share_capital is null or share_capital_currency is not null),
  add constraint companies_default_bank_account_fkey
    foreign key (default_bank_account_id) references bank_accounts(id) on delete set null;

-- The account also has to belong to this company, and that is a trigger
-- rather than the composite key `(default_bank_account_id, id) references
-- bank_accounts(id, company_id)` that says it in one line. The composite key
-- works and its `on delete set null` does not: PostgreSQL nulls *every*
-- referencing column, so deleting a bank account would try to null
-- `companies.id`. A plain key keeps the friendly behaviour — withdrawing an
-- account clears the default instead of refusing the delete — and the trigger
-- keeps the guarantee.

create or replace function companies_default_bank_account_is_ours()
returns trigger
language plpgsql
as $$
begin
  if new.default_bank_account_id is not null
     and not exists (select 1 from bank_accounts b
                      where b.id = new.default_bank_account_id
                        and b.company_id = new.id) then
    raise exception 'foreign_bank_account: that bank account belongs to another company'
      using errcode = '23503';
  end if;
  return new;
end;
$$;

create trigger companies_default_bank_account_is_ours
  before insert or update of default_bank_account_id on companies
  for each row execute function companies_default_bank_account_is_ours();

-- ---------------------------------------------------------------------------
-- The currency of the capital, when nobody said
-- ---------------------------------------------------------------------------

create or replace function companies_default_capital_currency()
returns trigger
language plpgsql
as $$
begin
  if new.share_capital is not null and new.share_capital_currency is null then
    new.share_capital_currency := new.currency_code;
  end if;
  return new;
end;
$$;

create trigger companies_default_capital_currency
  before insert or update of share_capital, share_capital_currency, currency_code on companies
  for each row execute function companies_default_capital_currency();

comment on function companies_default_capital_currency() is
  'A capital stated with no currency is stated in the company''s own. The alternative was a literal in the schema, which is one country''s answer given to every country.';

-- ---------------------------------------------------------------------------
-- The IBAN a sales document carries
--
-- A trigger and not a default on the column, for the reason the account of a
-- document line is resolved in a trigger: every client that inserts a
-- document has to get the same answer, and a client that did not know about
-- the company default would produce an invoice nobody can pay.
--
-- Only on what the company issues. On a purchase invoice the payee is the
-- supplier, and filling our own IBAN in there would be writing the wrong
-- fact — worse than an empty column, because it looks right.
-- ---------------------------------------------------------------------------

create or replace function documents_default_payee_iban()
returns trigger
language plpgsql
as $$
declare
  v_iban text;
begin
  if new.payee_iban is null and new.doc_type::text like 'sale%' then
    select b.iban into v_iban
      from companies c
      join bank_accounts b on b.id = c.default_bank_account_id
     where c.id = new.company_id;
    new.payee_iban := v_iban;
  end if;
  return new;
end;
$$;

create trigger documents_default_payee_iban
  before insert on documents
  for each row execute function documents_default_payee_iban();

comment on function documents_default_payee_iban() is
  'A sales document with no payee IBAN takes the company''s default bank account. A purchase document never does: the payee there is somebody else.';

-- ---------------------------------------------------------------------------
-- document_header — everything a renderer needs, in one read
--
-- The lines are `document_line_items`, the sentences are
-- `document_legal_mentions`, and the third read a renderer had to invent for
-- itself was the header: who issues, who receives, what is owed, where it is
-- paid, and what the country of the document requires of it. Three views,
-- three selects, and no client holding a copy of the company's letterhead.
--
-- `security_invoker`, like the other two: what a person may see through it is
-- what they may see under it.
-- ---------------------------------------------------------------------------

create or replace view document_header
  with (security_invoker = true) as
  select d.id                             as document_id,
         d.company_id,
         d.doc_type,
         d.state,
         d.payment_state,
         d.number,
         d.supplier_reference,
         d.document_date,
         d.accounting_date,
         d.due_date,
         d.delivery_date,
         d.currency_code,
         d.amount_untaxed,
         d.amount_tax,
         d.amount_total,
         d.amount_paid,
         d.amount_residual,
         d.payment_terms,
         d.payment_means_code,
         d.payment_reference,
         d.buyer_reference,
         d.order_reference,
         d.contract_reference,
         d.project_reference,
         d.note,
         -- BT-84: what the document says, else what the company's default
         -- bank account says. The trigger fills it on the way in, so the
         -- coalesce is what keeps a document written before this migration
         -- true as well.
         coalesce(d.payee_iban, seller_bank.iban) as payee_iban,
         seller_bank.bic                          as payee_bic,

         -- The seller: this company.
         coalesce(c.trade_name, c.name)   as seller_name,
         c.legal_name                     as seller_legal_name,
         c.legal_form                     as seller_legal_form,
         c.vat_number                     as seller_vat_number,
         c.registration_number            as seller_registration_number,
         c.address_line1                  as seller_address_line1,
         c.address_line2                  as seller_address_line2,
         c.postal_code                    as seller_postal_code,
         c.city                           as seller_city,
         c.country                        as seller_country,
         c.region                         as seller_region,
         c.email                          as seller_email,
         c.phone                          as seller_phone,
         c.website                        as seller_website,
         c.logo_url                       as seller_logo_url,
         c.share_capital                  as seller_share_capital,
         c.share_capital_currency         as seller_share_capital_currency,
         c.activity_code                  as seller_activity_code,
         c.activity_scheme                as seller_activity_scheme,
         c.document_template,

         -- The buyer: the contact the document is written against.
         ct.id                            as buyer_id,
         ct.name                          as buyer_name,
         ct.vat_number                    as buyer_vat_number,
         ct.registration_number           as buyer_registration_number,
         ct.address_line1                 as buyer_address_line1,
         ct.address_line2                 as buyer_address_line2,
         ct.postal_code                   as buyer_postal_code,
         ct.city                          as buyer_city,
         ct.country                       as buyer_country,
         ct.region                        as buyer_region,
         ct.email                         as buyer_email,

         -- What the country of the document requires. Its country is the
         -- company's fiscal_country — the country whose VAT rules apply — and
         -- not its address, which is the same distinction
         -- document_legal_mentions makes.
         c.fiscal_country                 as country,
         cd.number_format,
         cd.numbering_gapless,
         cd.legal_payment_days,
         cd.late_payment_reference,
         cd.tax_point_rule,
         cd.einvoice_profile,
         cd.einvoice_mandatory_from,
         cd.party_scheme,
         cd.vat_scheme
    from documents d
    join companies c                on c.id = d.company_id
    join contacts ct                on ct.id = d.contact_id
    left join bank_accounts seller_bank on seller_bank.id = c.default_bank_account_id
    left join country_defaults cd   on cd.country = c.fiscal_country;

comment on view document_header is
  'One document with everything printed above its lines: the seller, the buyer, the amounts, where it is paid and what its country requires. The lines are document_line_items and the sentences are document_legal_mentions.';

revoke execute on all functions in schema public from public;
