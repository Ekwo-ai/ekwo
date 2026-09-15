-- Ekwo OS — what a triangular supply puts on the invoice.
--
-- `document_legal_mentions` resolves nine conditions, six of them from the
-- treatments of the taxes a document's lines carry. A treatment the `case`
-- does not name produces no sentence at all, which would leave the invoice of
-- a triangular supply saying nothing about who owes the tax — on a document
-- whose whole point is that the customer does.
--
-- It joins `reverse_charge`, and not `intra_eu_goods`, and the question was
-- worth asking rather than assuming, because the treatment starts with
-- `intracom_` and the goods do cross a border.
--
-- **The sentence under `intra_eu_goods` would be false.** It is the exemption
-- of article 138 — the packs of this repository write it *livraison
-- intracommunautaire exonérée*, *exonération de TVA — livraison
-- intracommunautaire*, one of them citing article 43 of its own law and
-- another citing article 138 of the Directive by number. B's supply to C is
-- not exempt under article 138. It takes place in C's Member State, where the
-- goods arrive; article 141 relieves B of registering there and article 197
-- puts the tax on C. An invoice claiming the wrong exemption is the kind of
-- defect nobody notices until an inspection, which is the argument this
-- repository already made when `foreign_services_received` was refused the
-- `intra_eu_services` sentence for the same reason.
--
-- **The sentence under `reverse_charge` is true and is the one the Directive
-- requires.** Article 226(11a) obliges an invoice on which the customer is
-- liable to carry the mention *Reverse charge*, and that is what all four
-- packs print under this condition: *Autoliquidation — taxe à acquitter par le
-- cocontractant*, *Autoliquidation — TVA due par le preneur*,
-- *Autoliquidation*, *Pöördmaksustamine*. Same mechanism, same wording,
-- different article — which is exactly the reasoning `20260915094500` wrote
-- down when it put `foreign_services_received` there, and the three values
-- stay distinct because they are three articles and three boxes of a return.
--
-- **What the vocabulary still cannot say, and it is a real gap.** Article
-- 226(11) also wants a reference to the provision under which the supply is
-- relieved, and several Member States ask a triangular invoice to name the
-- simplification itself — *opération triangulaire, article 141*. `applies_when`
-- is a closed vocabulary of nine conditions and there is no tenth for it, so a
-- pack that wants that sentence has today to fold it into its reverse-charge
-- wording, where it would also appear on a domestic reverse charge that has
-- nothing to do with article 141. `docs/international.md` records it beside
-- the sibling gap it already carried: a legal mention cannot tell a domestic
-- reverse charge from a foreign one.
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
                                         && array['domestic_reverse_charge',
                                                  'foreign_services_received',
                                                  'intracom_triangular']
           when 'intra_eu_goods'    then dt.treatments && array['intracom_goods', 'intracom_acquisition_goods']
           when 'intra_eu_services' then dt.treatments && array['intracom_services', 'intracom_acquisition_services']
           when 'export'            then dt.treatments && array['export']
           when 'exempt'            then dt.treatments && array['exempt']
           when 'cash_basis'        then dt.on_cash_basis
           when 'late_payment'      then dt.doc_type in ('sale_invoice', 'sale_credit_note')
           else false
         end;

comment on view document_legal_mentions is
  'The legal mentions that apply to a document: its country, the validity of the mention on its date, and the treatments of the taxes its lines carry. A reverse-charge mention comes out for a domestic reverse charge, for a service received from a supplier who is not established here, and for the middle supply of a triangular arrangement — three articles behind one sentence, which is that the customer owes the tax. A small_business mention never comes out, because no column records the regime.';
