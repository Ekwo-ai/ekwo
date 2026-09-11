-- Ekwo OS — documents (sales and purchase invoices, credit notes, quotes)
-- and their lines.
--
-- One table, one `doc_type`: matching, attachments, bank reconciliation and
-- Peppol are then written once instead of once per document family.
-- A document is NOT the entry. post_document() joins them by foreign key.

create type doc_type as enum (
  'sale_invoice',
  'sale_credit_note',
  'sale_quote',
  'purchase_invoice',
  'purchase_credit_note',
  'purchase_order'
);

-- Lifecycle of the document itself. Whether it was e-mailed is `sent_at`,
-- whether it was paid is `payment_state`: three different questions.
create type doc_state as enum ('draft', 'posted', 'cancelled');

create type payment_state as enum ('not_paid', 'partially_paid', 'paid', 'overpaid', 'reversed');

create type document_line_type as enum ('product', 'section', 'note');

create table documents (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,
  doc_type            doc_type not null,
  state               doc_state not null default 'draft',
  payment_state       payment_state not null default 'not_paid',
  -- Our own number. On a purchase this is the internal reference; the
  -- supplier's number lives in `supplier_reference`.
  number              text,
  supplier_reference  text,
  contact_id          uuid not null references contacts(id) on delete restrict,
  journal_id          uuid references journals(id) on delete restrict,
  -- Date of the document, and the date it is booked on. They differ when a
  -- December invoice is recorded in January.
  document_date       date not null,
  accounting_date     date,
  due_date            date,
  currency_code       char(3) not null default 'EUR' references currencies(code),
  exchange_rate       numeric(18, 8) not null default 1,

  -- EN 16931 fields, as columns rather than a JSON blob.
  buyer_reference     text,                       -- BT-10
  project_reference   text,                       -- BT-11
  contract_reference  text,                       -- BT-12
  order_reference     text,                       -- BT-13
  delivery_date       date,                       -- BT-72
  delivery_address_line1 text,                    -- BG-15
  delivery_postal_code   text,
  delivery_city          text,
  delivery_country       char(2),
  payment_terms       text,                       -- BT-20
  payment_means_code  text,                       -- BT-81
  payment_reference   text,                       -- BT-83
  payee_iban          text,                       -- BT-84
  note                text,                       -- BT-22
  currency_code_tax   char(3),                    -- BT-6 VAT accounting currency

  -- Totals, derived from the lines. Never keyed in.
  amount_untaxed      numeric(16, 2) not null default 0,
  amount_tax          numeric(16, 2) not null default 0,
  amount_total        numeric(16, 2) not null default 0,
  amount_paid         numeric(16, 2) not null default 0,
  amount_residual     numeric(16, 2) generated always as (amount_total - amount_paid) stored,

  reversed_document_id uuid references documents(id) on delete set null,
  entry_id            uuid references entries(id) on delete set null,
  sent_at             timestamptz,
  peppol_status       text,
  peppol_message_id   text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint documents_posted_has_number check (state <> 'posted' or number is not null),
  constraint documents_rate_positive check (exchange_rate > 0),
  foreign key (contact_id, company_id) references contacts(id, company_id),
  foreign key (journal_id, company_id) references journals(id, company_id),
  foreign key (entry_id, company_id) references entries(id, company_id)
);

comment on table documents is
  'Sales and purchase invoices, credit notes, quotes and orders. `state` is the document, `payment_state` the settlement.';
comment on column documents.accounting_date is 'Date the entry is booked on; defaults to document_date.';
comment on column documents.supplier_reference is 'The supplier''s own invoice number on a purchase.';

create unique index documents_company_number_idx
  on documents (company_id, doc_type, number) where number is not null;
create unique index documents_id_company_idx on documents (id, company_id);
create unique index documents_entry_idx on documents (entry_id) where entry_id is not null;
create index documents_company_type_state_idx on documents (company_id, doc_type, state);
create index documents_contact_idx on documents (contact_id);
create index documents_date_idx on documents (company_id, document_date);

create trigger documents_set_updated_at
  before update on documents
  for each row execute function set_updated_at();

-- Close the loop: an entry knows which document produced it.
alter table entries
  add constraint entries_document_fkey
    foreign key (document_id) references documents(id) on delete set null;

-- ---------------------------------------------------------------------------
-- document_lines
-- ---------------------------------------------------------------------------

create table document_lines (
  id              uuid primary key default gen_random_uuid(),
  document_id     uuid not null references documents(id) on delete cascade,
  company_id      uuid not null references companies(id) on delete cascade,
  sequence        integer not null default 10,
  line_type       document_line_type not null default 'product',
  name            text not null,
  quantity        numeric(16, 4) not null default 1,
  -- UN/ECE Recommendation 20 code, BT-130.
  unit_code       text not null default 'C62',
  unit_price      numeric(16, 6) not null default 0,
  -- One discount semantics in the whole system: a percentage off the line.
  discount_percent numeric(7, 4) not null default 0,
  tax_id          uuid references taxes(id) on delete restrict,
  account_id      uuid references accounts(id) on delete restrict,
  -- EN 16931 BT-151 / BT-152, snapshotted so a later rate change cannot
  -- rewrite history.
  vat_category    char(2),
  vat_rate        numeric(7, 4),
  amount_untaxed  numeric(16, 2) generated always as (
    case when line_type = 'product'
      then round(quantity * unit_price * (1 - discount_percent / 100), 2)
      else 0
    end
  ) stored,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint document_lines_discount_range check (discount_percent >= 0 and discount_percent < 100),
  constraint document_lines_product_has_account check (
    line_type <> 'product' or account_id is not null
  ),
  foreign key (document_id, company_id) references documents(id, company_id) on delete cascade,
  foreign key (tax_id, company_id) references taxes(id, company_id),
  foreign key (account_id, company_id) references accounts(id, company_id)
);

comment on table document_lines is 'Document lines in a table, not JSON: EN 16931 needs a VAT category per line and the FEC needs the detail.';
comment on column document_lines.amount_untaxed is 'quantity x unit_price less the discount, rounded to two decimals once.';

create index document_lines_document_idx on document_lines (document_id, sequence);
create index document_lines_tax_idx on document_lines (tax_id);
create unique index document_lines_id_company_idx on document_lines (id, company_id);

create trigger document_lines_set_updated_at
  before update on document_lines
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Totals
--
-- VAT is computed per tax group on the rounded basis, which is the EN 16931
-- rule (BR-CO-14) and what every validator checks. Not per line, not on the
-- document total.
-- ---------------------------------------------------------------------------

create or replace view document_tax_summary
  with (security_invoker = true) as
  select l.document_id,
         l.company_id,
         d.doc_type,
         l.tax_id,
         t.code    as tax_code,
         t.name    as tax_name,
         t.vat_category,
         t.amount  as tax_rate,
         sum(l.amount_untaxed) as base_amount,
         -- Gross tax: what the VAT return reports.
         round(sum(l.amount_untaxed) * coalesce(t.amount, 0) / 100, 2) as tax_amount,
         -- Charged tax: what the other party actually pays. Zero when the tax
         -- postings net out, which is exactly what self-assessment means.
         round(
           sum(l.amount_untaxed) * coalesce(t.amount, 0) / 100
           * coalesce((
               select sum(tp.factor_percent)
                 from tax_postings tp
                where tp.tax_id = t.id
                  and tp.posting_type = 'tax'
                  and tp.document_kind = case
                        when d.doc_type in ('sale_credit_note', 'purchase_credit_note')
                          then 'credit_note'::tax_document_kind
                        else 'invoice'::tax_document_kind
                      end
             ), 100) / 100,
           2) as tax_charged
    from document_lines l
    join documents d on d.id = l.document_id
    left join taxes t on t.id = l.tax_id
   where l.line_type = 'product'
   group by l.document_id, l.company_id, d.doc_type, l.tax_id,
            t.id, t.code, t.name, t.vat_category, t.amount;

comment on view document_tax_summary is
  'VAT breakdown of a document, one row per tax, rounded on the group basis (EN 16931 BR-CO-14).';

create or replace function documents_refresh_totals(p_document_id uuid)
returns void
language plpgsql
as $$
declare
  v_untaxed numeric(16, 2);
  v_tax     numeric(16, 2);
begin
  select coalesce(sum(base_amount), 0), coalesce(sum(tax_charged), 0)
    into v_untaxed, v_tax
    from document_tax_summary
   where document_id = p_document_id;

  update documents
     set amount_untaxed = v_untaxed,
         amount_tax     = v_tax,
         amount_total   = v_untaxed + v_tax
   where id = p_document_id;
end;
$$;

create or replace function document_lines_refresh_totals()
returns trigger
language plpgsql
as $$
begin
  perform documents_refresh_totals(coalesce(new.document_id, old.document_id));
  return null;
end;
$$;

create trigger document_lines_refresh_totals
  after insert or update or delete on document_lines
  for each row execute function document_lines_refresh_totals();

-- Payment state follows the residual, never the other way round.
create or replace function documents_refresh_payment_state()
returns trigger
language plpgsql
as $$
begin
  if new.amount_total = 0 then
    new.payment_state := case when new.amount_paid <> 0 then 'overpaid' else 'not_paid' end;
  elsif new.amount_paid = 0 then
    new.payment_state := 'not_paid';
  elsif abs(new.amount_paid) >= abs(new.amount_total) then
    new.payment_state := case
      when abs(new.amount_paid) > abs(new.amount_total) then 'overpaid'
      else 'paid'
    end;
  else
    new.payment_state := 'partially_paid';
  end if;
  return new;
end;
$$;

create trigger documents_refresh_payment_state
  before insert or update of amount_total, amount_paid on documents
  for each row execute function documents_refresh_payment_state();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table documents      enable row level security;
alter table document_lines enable row level security;

create policy documents_select on documents
  for select using (is_company_member(company_id));
create policy documents_write on documents
  for all using (can_write_company(company_id)) with check (can_write_company(company_id));

create policy document_lines_select on document_lines
  for select using (is_company_member(company_id));
create policy document_lines_write on document_lines
  for all using (can_write_company(company_id)) with check (can_write_company(company_id));
