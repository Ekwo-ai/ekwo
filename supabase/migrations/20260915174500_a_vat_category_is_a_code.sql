-- Ekwo OS — a VAT category is a code, not a two-character box.
--
-- `taxes.vat_category`, `tax_templates.vat_category` and
-- `document_lines.vat_category` have been `char(2)` since the day they were
-- created, and `char(n)` in Postgres pads to width on write. Every category of
-- EN 16931 but `AE` is one character, so the database answered `S `, `K `,
-- `E `, `G `, `Z `, `O ` — and `document_line_items` and `document_tax_summary`
-- published that as BT-151. `S ` is not a code of UNCL5305: a renderer writing
-- it straight into an invoice emits one that fails validation, a reader
-- comparing it to `'S'` finds nothing, and since `shared_document()` reads both
-- views the padded value reached whoever held the link to an invoice.
--
-- Nothing here noticed, because the only test that compared the column compared
-- two databases that pad identically, and `tests/packs.test.ts` trimmed before
-- it looked. That is written up in `docs/international.md`, where this note is
-- now closed.
--
-- The three columns become `text`. The cast is written out rather than left
-- implicit: `char` to `text` does drop the trailing blanks, but the rule that
-- makes it do so is not what anybody reading this file should have to know, and
-- `nullif` turns a column that held nothing but padding into the null it always
-- meant. The check constraint is the width made explicit — one or two capital
-- letters, which is the shape of every UNCL5305 category and of nothing else —
-- so the column now refuses what it used to manufacture.
--
-- `exemption_code` is already `text` on both tables and needs nothing. The
-- other `char(2)` columns of the schema are ISO 3166 country codes and ISO 639
-- languages, which are two characters by definition; they stay as they are.
--
-- A type change is refused while a view selects the column, so the two views
-- that publish BT-151 are dropped and recreated below, unchanged but for
-- existing: same columns in the same order, same `security_invoker`, same
-- comments, same grants. `shared_document()`, `documents_refresh_totals()` and
-- `post_document()` read them by name and are untouched — a function does not
-- record a dependency on a view, so dropping one does not drop them. No trigger
-- on `document_lines` guards a column, so nothing fires on the rewrite; the
-- snapshot the line holds keeps the value it was given, minus the space the
-- column added to it.

-- ---------------------------------------------------------------------------
-- 1. The views that select the column step aside
-- ---------------------------------------------------------------------------

drop view if exists document_line_items;
drop view if exists document_tax_summary;

-- ---------------------------------------------------------------------------
-- 2. The three columns become codes
-- ---------------------------------------------------------------------------

alter table taxes
  alter column vat_category type text using nullif(rtrim(vat_category), '');

alter table taxes
  add constraint taxes_vat_category_format
  check (vat_category is null or vat_category ~ '^[A-Z]{1,2}$');

comment on column taxes.vat_category is
  'EN 16931 BT-118 / BT-151 category code, as UNCL5305 writes it: S, Z, E, AE, K, G, O, L, M. One or two capitals, never padded.';

alter table tax_templates
  alter column vat_category type text using nullif(rtrim(vat_category), '');

alter table tax_templates
  add constraint tax_templates_vat_category_format
  check (vat_category is null or vat_category ~ '^[A-Z]{1,2}$');

comment on column tax_templates.vat_category is
  'EN 16931 BT-118 / BT-151 category code the pack declares for this tax, as UNCL5305 writes it.';

alter table document_lines
  alter column vat_category type text using nullif(rtrim(vat_category), '');

alter table document_lines
  add constraint document_lines_vat_category_format
  check (vat_category is null or vat_category ~ '^[A-Z]{1,2}$');

comment on column document_lines.vat_category is
  'EN 16931 BT-151 as the line carries it, snapshotted from the tax when the line was written so a later rate change cannot rewrite history.';

-- ---------------------------------------------------------------------------
-- 3. The views come back
--
-- Recreated from their last published definitions — `document_line_items` from
-- `20260912111751`, `document_tax_summary` from `20260914121200` — with
-- nothing changed but the type they now hand back for BT-151.
-- ---------------------------------------------------------------------------

create view document_tax_summary
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
         round_amount(sum(l.amount_untaxed) * coalesce(t.amount, 0) / 100,
                      rounding_of(l.company_id, d.currency_code)) as tax_amount,
         -- Charged tax: what the other party actually pays. Zero when the tax
         -- postings net out, which is exactly what self-assessment means.
         round_amount(
           sum(l.amount_untaxed) * coalesce(t.amount, 0) / 100
           * coalesce((
               select sum(tp.factor_percent)
                 from tax_postings tp
                where tp.tax_id = t.id
                  and tp.posting_type in ('tax', 'tax_on_base')
                  and tp.document_kind = case
                        when d.doc_type in ('sale_credit_note', 'purchase_credit_note')
                          then 'credit_note'::tax_document_kind
                        else 'invoice'::tax_document_kind
                      end
             ), 100) / 100,
           rounding_of(l.company_id, d.currency_code)) as tax_charged
    from document_lines l
    join documents d on d.id = l.document_id
    left join taxes t on t.id = l.tax_id
   where l.line_type = 'product'
   group by l.document_id, l.company_id, d.doc_type, d.currency_code, l.tax_id,
            t.id, t.code, t.name, t.vat_category, t.amount;

comment on view document_tax_summary is
  'VAT breakdown of a document, one row per tax, rounded on the group basis (EN 16931 BR-CO-14).';

create view document_line_items
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
         l.account_id,
         t.treatment                   as tax_treatment,
         t.exemption_code              as tax_exemption_code,      -- BT-121
         t.cash_basis                  as tax_cash_basis
    from document_lines l
    left join products p on p.id = l.product_id
    left join taxes t    on t.id = l.tax_id;

comment on view document_line_items is
  'Document lines with the EN 16931 item terms — BT-153 name, BT-154 description, BT-155 the seller identifier — and what decides a legal mention on the line: the treatment of its tax, its exemption reason (BT-121) and whether the tax falls due on collection.';

-- ---------------------------------------------------------------------------
-- 4. The grants the drop took away
--
-- A dropped view takes its privileges with it, so both are granted again by
-- name, to exactly who held them before: `authenticated` and `service_role`
-- select, `anon` nothing. Both are `security_invoker`, so the grant is only
-- half of what a reader needs — the tables below still judge them under their
-- own policies. The anonymous reader of a shared invoice never touches either:
-- `shared_document()` is `security definer` and reads them as its owner.
-- ---------------------------------------------------------------------------

revoke all on table document_tax_summary from public, anon;
revoke all on table document_line_items from public, anon;

grant select on table
  document_tax_summary,
  document_line_items
to authenticated, service_role;
