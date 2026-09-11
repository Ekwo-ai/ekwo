-- Ekwo OS — products, in the core rather than in a module beside it.
--
-- A product here is what a line is filled in from: a code, a name, a
-- description, a unit, a price, the account it books to and the tax it
-- carries. It is deliberately not an article of stock — no quantity on hand,
-- no valuation, no movements — because that is a different piece of software
-- and merging the two is how a catalogue ends up owning the ledger.
--
-- Two rules it keeps, and they are the whole design:
--
--   * **A product pre-fills a line; it never constrains one.** The line keeps
--     its own text, its own price and its own account, and anything typed
--     over the product's suggestion stays. An invoice is a statement about
--     what was sold on that day, and a catalogue edited next month must not
--     be able to change it.
--   * **A line with no product is still a line.** `product_id` is nullable
--     and always will be. Free text is how most invoices are written, and a
--     schema that forces a catalogue row for every line forces the operator
--     to invent one.
--
-- The unit lives where it already lived: `document_lines.unit_code`, UN/ECE
-- recommendation 20, present since the first release and mapped to BT-130. A
-- second `unit` column next to it would be two answers to one question, so
-- the product carries `unit_code` too and fills that one in.

create type product_kind as enum ('service', 'goods');

comment on type product_kind is
  'What is being sold. Services and goods differ in VAT treatment, in the declaration boxes they feed and in the account they book to.';

create table products (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,
  -- BT-155, the seller's own identifier for the item.
  code                text not null,
  -- BT-153 when the line takes it.
  name                text not null,
  -- BT-154.
  description         text,
  kind                product_kind not null default 'service',
  -- UN/ECE recommendation 20, BT-130. `C62` is "one", `HUR` an hour, `DAY` a
  -- day, `KGM` a kilogram, `LTR` a litre, `MTR` a metre. The check is on the
  -- shape only: the recommendation has some eighteen hundred codes and a
  -- short list in the database would refuse legitimate ones.
  unit_code           text not null default 'C62',
  currency_code       char(3) not null default 'EUR' references currencies(code),
  -- Six decimals, like `document_lines.unit_price`: a unit price is not an
  -- amount of money, it is what an amount is computed from.
  sale_price          numeric(16, 6),
  purchase_price      numeric(16, 6),
  sale_account_id     uuid references accounts(id) on delete restrict,
  purchase_account_id uuid references accounts(id) on delete restrict,
  sale_tax_id         uuid references taxes(id) on delete restrict,
  purchase_tax_id     uuid references taxes(id) on delete restrict,
  active              boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (company_id, code),
  constraint products_code_not_blank check (length(btrim(code)) > 0),
  constraint products_unit_code_format check (unit_code ~ '^[A-Z0-9]{1,3}$'),
  constraint products_sale_price_positive check (sale_price is null or sale_price >= 0),
  constraint products_purchase_price_positive check (purchase_price is null or purchase_price >= 0),
  foreign key (sale_account_id, company_id) references accounts(id, company_id),
  foreign key (purchase_account_id, company_id) references accounts(id, company_id),
  foreign key (sale_tax_id, company_id) references taxes(id, company_id),
  foreign key (purchase_tax_id, company_id) references taxes(id, company_id)
);

comment on table products is
  'What a document line is filled in from: code, name, unit, price, account and tax. Not stock: no quantity on hand and no valuation.';
comment on column products.code is 'The seller''s own item identifier, EN 16931 BT-155. Unique in the company.';
comment on column products.name is 'Item name, EN 16931 BT-153, copied onto the line it fills in.';
comment on column products.description is 'Item description, EN 16931 BT-154.';
comment on column products.unit_code is 'Unit of measure, UN/ECE recommendation 20 (BT-130). C62 is "one".';
comment on column products.sale_price is 'Suggested net unit price on a sale. A line may carry another.';

create unique index products_id_company_idx on products (id, company_id);
create index products_company_active_idx on products (company_id, active);
create index products_company_name_idx on products (company_id, lower(name));

create trigger products_set_updated_at
  before update on products
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- The line points at the product, and keeps everything it was given.
-- ---------------------------------------------------------------------------

alter table document_lines
  add column if not exists product_id  uuid,
  add column if not exists description text;

alter table document_lines
  add constraint document_lines_product_fkey
    foreign key (product_id) references products(id) on delete restrict,
  add constraint document_lines_product_company_fkey
    foreign key (product_id, company_id) references products(id, company_id);

comment on column document_lines.product_id is
  'The catalogue row this line was filled in from, when there was one. Nullable for ever: free text is how most invoices are written.';
comment on column document_lines.description is
  'Item description, EN 16931 BT-154. `name` is BT-153.';

create index document_lines_product_idx on document_lines (product_id);

-- `on delete restrict` rather than `set null`: a product referenced by a
-- posted invoice is part of what that invoice said, and deleting it out from
-- under the line would quietly rewrite a document. Retiring one is `active`.

-- ---------------------------------------------------------------------------
-- Row level security, in the same migration as the table.
-- ---------------------------------------------------------------------------

alter table products enable row level security;

create policy products_select on products
  for select using (is_company_member(company_id));
create policy products_write on products
  for all using (can_write_company(company_id)) with check (can_write_company(company_id));

-- ---------------------------------------------------------------------------
-- The product joins the resolution of the line's account.
--
-- Order, most specific first: the line, the product, the company default, the
-- country model. The three-argument form published in `…193853` is kept and
-- called by this one, so there is one place where the last two steps live.
-- ---------------------------------------------------------------------------

create or replace function resolve_line_account(
  p_company_id uuid,
  p_doc_type   doc_type,
  p_product_id uuid,
  p_account_id uuid
)
returns uuid
language plpgsql
stable
as $$
declare
  v_is_sale boolean;
  v_account uuid;
begin
  if p_account_id is not null then
    return p_account_id;
  end if;

  if p_product_id is not null then
    v_is_sale := p_doc_type in ('sale_invoice', 'sale_credit_note', 'sale_quote');
    select case when v_is_sale then p.sale_account_id else p.purchase_account_id end
      into v_account
      from products p
     where p.id = p_product_id;
    if v_account is not null then
      return v_account;
    end if;
  end if;

  return resolve_line_account(p_company_id, p_doc_type, null::uuid);
end;
$$;

comment on function resolve_line_account(uuid, doc_type, uuid, uuid) is
  'Account of a document line: the line, the product, the company default, the country model. Never a code prefix.';

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

  new.account_id := resolve_line_account(new.company_id, v_doc_type, new.product_id, null::uuid);
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- The invoice line as EN 16931 describes it.
--
-- BT-153 is the item name, BT-154 its description, BT-155 the seller's own
-- identifier — which is `products.code` and lives nowhere else, so a line
-- that names no product has none, and that is the correct answer rather than
-- a gap. `security_invoker` so the view is read under the policies of
-- `document_lines`, exactly like `document_tax_summary`.
-- ---------------------------------------------------------------------------

create or replace view document_line_items
  with (security_invoker = true) as
  select l.id                          as document_line_id,
         l.document_id,
         l.company_id,
         l.sequence,
         l.line_type,
         l.name                        as item_name,               -- BT-153
         l.description                 as item_description,        -- BT-154
         p.code                        as seller_item_identifier,  -- BT-155
         l.product_id,
         p.kind                        as product_kind,
         l.quantity,                                               -- BT-129
         l.unit_code,                                              -- BT-130
         l.unit_price,                                             -- BT-146
         l.discount_percent,
         l.amount_untaxed,                                         -- BT-131
         l.tax_id,
         l.vat_category,                                           -- BT-151
         l.vat_rate,                                               -- BT-152
         l.account_id
    from document_lines l
    left join products p on p.id = l.product_id;

comment on view document_line_items is
  'Document lines with the EN 16931 item terms: BT-153 name, BT-154 description, BT-155 the seller identifier, which is the product code.';
