-- Ekwo OS — what a country requires on a document, as data.
--
-- An invoice is the one object where a country speaks loudest, and until this
-- migration the core answered for it: a number built as CODE/YYYY/NNNN, no
-- idea what the legal payment term was, no e-invoicing profile, no bank
-- format, and the legal mentions nowhere at all — a renderer either hard-coded
-- "Autoliquidation" or printed nothing. Three groups of columns and one table
-- move all of it into the pack.
--
-- **Nothing here is executable.** No function is added, no default is written
-- into the schema. Two views read the data so a renderer or the e-invoice
-- brick can print it, and that is the whole of the behaviour.
--
-- **No column carries a default**, for the reason P0-8 gave when it landed
-- the closing style: a default legal payment term is one country's law given
-- to every country that has not spoken. A silent pack gets null, and a reader
-- that needs the value raises by name rather than quietly printing Belgium's
-- answer on a Chilean invoice.

-- ---------------------------------------------------------------------------
-- The country model gains the document rules
--
-- `numbering_gapless` and `number_format` describe the number, and they are
-- two questions rather than one. Whether a number may skip is the law — most
-- of Europe forbids a hole, some countries only ask for an order. What the
-- number *looks like* is a pattern, and whether it restarts each year is
-- readable in the pattern itself, because a pattern that carries the year
-- restarts with it.
--
-- The grammar of `number_format` is four tokens and literal text around them:
--
--   {CODE}   the journal or document-series code
--   {YYYY}   the year of the document, four digits — {YY} for two
--   {MM}     the month, two digits
--   {NNNN}   the counter, zero-padded to as many N as are written
--
-- `next_entry_number()` builds `CODE/YYYY/NNNN` today and does not read this
-- column: a numbering engine that consumes a pattern is its own change, and
-- the two packs that exist declare exactly the pattern the engine produces, so
-- nothing moves under anybody's feet when it does.
--
-- `tax_point_rule` is the country's general rule, and the exception lives on
-- the tax: France taxes goods on delivery and services on collection, and the
-- second is `taxes.cash_basis`, not a second country column.
alter table country_defaults
  add column if not exists numbering_gapless      boolean,
  add column if not exists number_format          text,
  add column if not exists legal_payment_days     integer,
  add column if not exists late_payment_reference text,
  add column if not exists tax_point_rule         text,
  add column if not exists einvoice_profile       text,
  add column if not exists einvoice_mandatory_from date,
  add column if not exists party_scheme           text,
  add column if not exists vat_scheme             text,
  add column if not exists bank_statement_formats text[],
  add column if not exists payment_formats        text[],
  add column if not exists fiscal_year_default    text;

comment on column country_defaults.numbering_gapless is
  'True where the law forbids a hole in the sequence of invoice numbers. Null until the pack says so.';
comment on column country_defaults.number_format is
  'Pattern of a document number: {CODE}, {YYYY} or {YY}, {MM}, {NNNN} zero-padded to as many N as are written, with literal text between them. Read by nothing yet; next_entry_number() produces CODE/YYYY/NNNN.';
comment on column country_defaults.legal_payment_days is
  'Payment term the law sets in the absence of an agreement, in days. Not a company''s own terms, which are documents.payment_terms.';
comment on column country_defaults.late_payment_reference is
  'Where the interest rate and the recovery indemnity for a late payment come from, in one sentence a renderer can print or an accountant can follow.';
comment on column country_defaults.tax_point_rule is
  'When the tax becomes chargeable under this country''s general rule. A tax that departs from it says so itself, with cash_basis.';
comment on column country_defaults.einvoice_profile is
  'The structured invoice this country expects: peppol-bis-3, factur-x-en16931, xrechnung, a PINT profile. Null where electronic invoicing is not a thing.';
comment on column country_defaults.einvoice_mandatory_from is
  'The day the obligation starts. Where reception and emission start on different days, this is reception, which is what binds every company at once.';
comment on column country_defaults.party_scheme is
  'ISO 6523 ICD of the identifier a party is addressed by on the network, four digits. The pack carries the value; the core never guesses one.';
comment on column country_defaults.vat_scheme is
  'ISO 6523 ICD of the VAT identifier, four digits. Distinct from party_scheme: a company is addressed by its registration number and taxed on its VAT number, and they are not the same identifier.';
comment on column country_defaults.bank_statement_formats is
  'Statement formats a bank of this country delivers, most usual first. A list, because a country rarely has one.';
comment on column country_defaults.payment_formats is
  'Payment initiation formats a bank of this country accepts, most usual first.';
comment on column country_defaults.fiscal_year_default is
  'Month the financial year usually opens on: calendar, april, july, october. A default offered, never imposed — fiscal_years holds what a company actually keeps.';

alter table country_defaults
  add constraint country_defaults_legal_payment_days_positive
    check (legal_payment_days is null or legal_payment_days >= 0),
  add constraint country_defaults_tax_point_rule_known
    check (tax_point_rule is null or tax_point_rule in ('invoice_date', 'delivery_date', 'payment_date')),
  add constraint country_defaults_party_scheme_format
    check (party_scheme is null or party_scheme ~ '^[0-9]{4}$'),
  add constraint country_defaults_vat_scheme_format
    check (vat_scheme is null or vat_scheme ~ '^[0-9]{4}$'),
  add constraint country_defaults_fiscal_year_default_known
    check (fiscal_year_default is null or fiscal_year_default in ('calendar', 'april', 'july', 'october'));

-- ---------------------------------------------------------------------------
-- legal_mention_templates — the sentences a country requires on an invoice
--
-- `applies_when` is a **closed vocabulary**, not an expression language, for
-- the same reason a declaration total is a plus list and a minus list: an
-- accountant reads `reverse_charge` and knows what it means, and a pack that
-- could write a condition would be a pack that executes. Nine values cover
-- the European invoice; the day a country needs a tenth it is a discussion
-- about the core, not a field a pack may fill with anything.
--
--   always            printed on every document of the country
--   reverse_charge    the buyer accounts for the tax, domestically
--   intra_eu_goods    an exempt supply of goods inside the Union
--   intra_eu_services a service taxed where the customer is
--   export            a supply outside the Union
--   exempt            an exemption that is not one of the three above
--   small_business    the seller is under a franchise regime
--   late_payment      interest and recovery costs, on what the seller issues
--   cash_basis        the tax falls due when the invoice is paid
--
-- Like a declaration form, these are **not copied into a company**: an
-- operator does not get to rewrite the sentence the law demands. They are
-- reference data with a validity, and a wording that changes is a new row
-- with a `valid_from`, never an edit to the old one.
create table legal_mention_templates (
  id              uuid primary key default gen_random_uuid(),
  country         char(2) not null,
  code            text not null,
  applies_when    text not null,
  text            text not null,
  text_i18n       jsonb not null default '{}'::jsonb,
  sequence        integer not null default 10,
  valid_from      date not null default date '1970-01-01',
  valid_to        date,
  legal_reference text,
  unique (country, code),
  constraint legal_mention_templates_country_format check (country ~ '^[A-Z]{2}$'),
  constraint legal_mention_templates_validity check (valid_to is null or valid_to >= valid_from),
  constraint legal_mention_templates_applies_when_known check (
    applies_when in (
      'always', 'reverse_charge', 'intra_eu_goods', 'intra_eu_services',
      'export', 'exempt', 'small_business', 'late_payment', 'cash_basis'
    )
  )
);

comment on table legal_mention_templates is
  'The sentences a country requires on an invoice, and the closed condition that says when each applies. Reference data filled by a pack, never copied into a company.';
comment on column legal_mention_templates.applies_when is
  'One of nine conditions. A closed vocabulary and not an expression: a pack that could write a condition would be a pack that executes.';
comment on column legal_mention_templates.text is
  'The mention in the pack''s own language. Other languages are in text_i18n, by language code.';
comment on column legal_mention_templates.sequence is
  'Order the mentions are printed in.';
comment on column legal_mention_templates.legal_reference is
  'The article that requires this sentence. A mention without a source cannot be reviewed.';

create index legal_mention_templates_country_idx
  on legal_mention_templates (country, sequence, code);

-- ---------------------------------------------------------------------------
-- document_legal_mentions — which of them apply to one document
--
-- A view, so it is a query and never a rule somebody can forget to call. The
-- join is deliberately small, and it decides on three things only:
--
--   1. the country of the document, which is the company's `fiscal_country` —
--      the country whose VAT rules apply, not the company's address;
--   2. the validity of the mention on the document's own date, so a reprint
--      of an old invoice carries the wording of its own year;
--   3. the condition, resolved from the **treatments of the taxes the lines
--      carry** — which is where the reverse charge, the intra-EU exemption
--      and the export already live, so nothing new has to be recorded on a
--      document for its mentions to come out right.
--
-- Two conditions are not about a tax. `late_payment` is about the direction:
-- interest and recovery costs belong on what the seller issues, never on a
-- purchase invoice somebody else wrote. `small_business` is about a regime
-- the core does not record — there is no franchise flag on a company — so the
-- view **never selects it**, and says so here rather than pretending: the row
-- exists so a renderer that knows the regime can fetch the sentence by its
-- code, and the day the regime becomes a column this view gains one branch.
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
           when 'reverse_charge'    then dt.treatments && array['domestic_reverse_charge']
           when 'intra_eu_goods'    then dt.treatments && array['intracom_goods', 'intracom_acquisition_goods']
           when 'intra_eu_services' then dt.treatments && array['intracom_services', 'intracom_acquisition_services']
           when 'export'            then dt.treatments && array['export']
           when 'exempt'            then dt.treatments && array['exempt']
           when 'cash_basis'        then dt.on_cash_basis
           when 'late_payment'      then dt.doc_type in ('sale_invoice', 'sale_credit_note')
           else false
         end;

comment on view document_legal_mentions is
  'The legal mentions that apply to a document: its country, the validity of the mention on its date, and the treatments of the taxes its lines carry. A small_business mention never comes out, because no column records the regime.';

-- ---------------------------------------------------------------------------
-- document_line_items gains what decides a mention on the line
--
-- The document-level sentence is the view above; what a line contributes to it
-- is its tax treatment, and EN 16931 asks for the exemption reason code beside
-- it (BT-121). Both were one join away and nobody had it, so a renderer that
-- wanted to say *why* a line carries no VAT had to go back to `taxes`.
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
-- Row level security
--
-- Read by anyone signed in, written by nobody: the sentence the law demands is
-- not something an operator edits, exactly like a box of a declaration form.
-- No policy for insert, update or delete, so the seed — which runs as the
-- owner — is the only thing that fills the table.
alter table legal_mention_templates enable row level security;

create policy legal_mention_templates_select on legal_mention_templates
  for select using (auth.uid() is not null);
