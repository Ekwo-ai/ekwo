-- Ekwo OS — where `foreign_services_received` lands among the legal mentions.
--
-- `document_legal_mentions` resolves nine conditions, six of them from the
-- treatments of the taxes a document's lines carry. A treatment the `case`
-- does not name falls through every branch and produces no sentence at all,
-- which is what `import` does and is right for it: goods declared to customs
-- put nothing on an invoice the company writes.
--
-- A service received from a supplier who is not established here is the other
-- shape. The tax on it is accounted for by the recipient under articles 44
-- and 196 of Directive 2006/112/EC, and the sentence that says so is the
-- reverse-charge one — the same mechanism, and the same wording in all four
-- packs of this repository. So the value joins `reverse_charge` rather than
-- `intra_eu_services`, which is about a supply between two Member States and
-- says the wrong thing about a supplier outside one.
--
-- It joins it beside `domestic_reverse_charge`, and the two stay distinct
-- values because they are two different articles and two different boxes of a
-- return; what they share is the sentence.
--
-- Nothing else in the view changes. `create or replace view` keeps the grant
-- and the policy of the object it replaces, and the columns are the same
-- columns in the same order, which is what `create or replace` requires.

create or replace view document_legal_mentions
  with (security_invoker = true) as
  with document_taxes as (
    select d.id             as document_id,
           d.company_id,
           c.fiscal_country as country,
           d.document_date,
           d.doc_type,
           coalesce(
             array_agg(distinct t.treatment::text) filter (where t.treatment is not null),
             array[]::text[]
           )                                 as treatments,
           coalesce(bool_or(t.cash_basis), false) as on_cash_basis
      from documents d
      join companies c           on c.id = d.company_id
      left join document_lines l on l.document_id = d.id
      left join taxes t          on t.id = l.tax_id
     group by d.id, d.company_id, c.fiscal_country, d.document_date, d.doc_type
  )
  select dt.document_id,
         dt.company_id,
         m.country,
         m.code,
         m.applies_when,
         m.text,
         m.text_i18n,
         m.sequence,
         m.legal_reference
    from document_taxes dt
    join legal_mention_templates m
      on m.country = dt.country
     and m.valid_from <= dt.document_date
     and (m.valid_to is null or m.valid_to >= dt.document_date)
   where case m.applies_when
           when 'always'            then true
           when 'reverse_charge'    then dt.treatments
                                         && array['domestic_reverse_charge', 'foreign_services_received']
           when 'intra_eu_goods'    then dt.treatments && array['intracom_goods', 'intracom_acquisition_goods']
           when 'intra_eu_services' then dt.treatments && array['intracom_services', 'intracom_acquisition_services']
           when 'export'            then dt.treatments && array['export']
           when 'exempt'            then dt.treatments && array['exempt']
           when 'cash_basis'        then dt.on_cash_basis
           when 'late_payment'      then dt.doc_type in ('sale_invoice', 'sale_credit_note')
           else false
         end;

comment on view document_legal_mentions is
  'The legal mentions that apply to a document: its country, the validity of the mention on its date, and the treatments of the taxes its lines carry. A reverse-charge mention comes out for a domestic reverse charge and for a service received from a supplier who is not established here, which is the same mechanism under a different article. A small_business mention never comes out, because no column records the regime.';
