-- Ekwo OS — one tax engine, several kinds.
--
-- The core knew one tax: European VAT, fully deductible, computed on a price
-- that excludes it, rounded to the cent. Everything else a country does was
-- unsayable, and the pack format already had words for it: `kind`,
-- `recoverable`, `price_include`, `jurisdiction`, `cash_basis`,
-- `rounding_method` and `cash_rounding_unit` are in `packs/schema/pack.1.json`
-- today, marked *deferred*, and the compiler drops them on the floor. This
-- migration gives them a column, so the pack stops promising what the schema
-- cannot hold.
--
-- What each one is for, and what it is *not*:
--
--   `tax_kind`     vat | gst | sales_tax | withholding | other. A **label that
--                  drives the reports**, never the calculation. GST is
--                  computed exactly like VAT; a report that lists "the VAT" of
--                  a Canadian company needs to know which of two taxes it is
--                  looking at, and guessing from the code is how a localisation
--                  ends up in application code. Default `vat`, which is what
--                  every tax of Belgium and France is.
--   `recoverable`  false for an American sales tax and for a Canadian PST: the
--                  buyer never gets it back. Documentation and a report filter;
--                  the *ledger* consequence of non-recoverability is the
--                  `tax_on_base` posting below, which says where the money
--                  goes rather than merely that it is lost.
--   `price_include` the unit price already holds the tax (UK and Australian
--                  retail). `taxes` had it since day one and `tax_templates`
--                  did not, so a pack could not express it — a column missing
--                  on one side of a copy. Added here, nothing reads it yet;
--                  the gross-to-net computation belongs with the country that
--                  needs it.
--   `jurisdiction` ISO 3166-2 *with* the country prefix — `CA-QC`, `US-CA` —
--                  because a sales tax is levied by a state, not by a country.
--                  Null in Europe. Distinct from `companies.region`, which is
--                  where a *party* sits and carries no prefix.
--   `cash_basis`   and `cash_basis_transition_account_*`: **columns only, and
--                  deliberately unread**. The tax falls due when the invoice
--                  is paid — French VAT on services, the British cash
--                  accounting scheme — and the amount waits on a transition
--                  account until then. P0-6 implements the behaviour; putting
--                  the columns here means `taxes` and `tax_postings` migrate
--                  once rather than twice, which is the same argument
--                  `20260912080311` made for `report_code`.
--
-- And on the country model, two columns the manifest already declares:
--
--   `rounding_method`     half_up | half_even | down | up. Belgium and France
--                  both round half away from zero, per tax group, which is
--                  what `round()` on a numeric does and what `post_document`
--                  has always done — so `half_up` is today's behaviour written
--                  down, not a change. Half-even is the Anglo-Saxon banker's
--                  rounding.
--   `cash_rounding_unit`  the smallest coin, when it is not the cent: 0.05 in
--                  Switzerland, where an invoice total is rounded to the
--                  nearest five centimes and the difference goes to the
--                  rounding account. 0 means the cent is the unit, which is
--                  every country of phase 0.
--
-- These two, like `cash_basis`, have no reader yet. That is the third and
-- last time this schema takes that liberty (`region` was the first), and for
-- the reason `20260912080311` set out: the alternative is migrating a table
-- of tax rows twice. `post_document` is unchanged for every tax that exists
-- today, and the tests that prove it are untouched.
--
-- ---------------------------------------------------------------------------
-- The one behaviour this migration does add: `tax_on_base`
-- ---------------------------------------------------------------------------
--
-- Non-deductible VAT is not a claim on the State, so it cannot sit on a VAT
-- account. It is a cost, and it follows the account of the thing that was
-- bought. A Belgian company car, 1 000 € at 21 %, deduction capped at 50 % by
-- art. 45 § 2 CTVA:
--
--   242000  Matériel roulant          debit  1 000.00   box 83  1 000.00
--   411000  TVA déductible            debit    105.00   box 59    105.00
--   242000  TVA non déductible        debit    105.00   box 83    105.00
--   440000  Fournisseur               credit 1 210.00
--
-- The supplier is owed the full 1 210 €; half the VAT is recovered and half
-- is part of what the car cost. Grid 83 comes out at 1 105 €, because the
-- Belgian return asks for the base *plus* the non-deductible VAT — the form
-- says « montant (TVA déductible non comprise) », which excludes the
-- deductible VAT and not all of it. That falls out of `box_factor_percent`
-- being independent from `factor_percent`, with no new column: the base
-- posting reports 100 % of the base in box 83 and the `tax_on_base` posting
-- reports 50 % of the tax in the same box.
--
-- Three rules the posting keeps:
--
--   * **It carries no account**, exactly like `base`, and for the same
--     reason: the account is the one the document line names. The check
--     constraint says so.
--   * **It is split across the accounts of the lines it taxes**, in
--     proportion to their base, with the last share carrying the rounding
--     difference. An invoice with a car and its insurance on two accounts
--     gets the non-deductible VAT on both, and the entry still balances to
--     the cent because the shares sum to an amount that was rounded **once**,
--     on the tax group (EN 16931 BR-CO-14, unchanged).
--   * **`tax_line` stays false.** The amount lands on a base account and
--     belongs to the base side of the grid — which is precisely why Belgium
--     puts it in 82/83. Marking it as a tax line would split grid 83 into two
--     rows in `vat_return()` and would tell every reader that filters on
--     `tax_line` to go looking for it among the VAT accounts, where it is not.
--
-- A fully non-deductible tax is the same thing at 100 %: one `tax_on_base`
-- posting, no `tax` posting, and `recoverable = false` to say it in one word.

-- ---------------------------------------------------------------------------
-- tax_kind
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'tax_kind') then
    create type tax_kind as enum ('vat', 'gst', 'sales_tax', 'withholding', 'other');
  end if;
end;
$$;

comment on type tax_kind is
  'What kind of tax this is. Drives the reports and nothing else: a GST is computed exactly like a VAT.';

-- ---------------------------------------------------------------------------
-- rounding_method
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'rounding_method') then
    create type rounding_method as enum ('half_up', 'half_even', 'down', 'up');
  end if;
end;
$$;

comment on type rounding_method is
  'How a country rounds a tax amount. half_up is half away from zero, which is what Postgres round() does and what every posting has always used.';

-- ---------------------------------------------------------------------------
-- The reference taxes
-- ---------------------------------------------------------------------------

alter table tax_templates
  add column if not exists tax_kind                           tax_kind not null default 'vat',
  add column if not exists recoverable                        boolean  not null default true,
  add column if not exists jurisdiction                       text,
  add column if not exists price_include                      boolean  not null default false,
  add column if not exists cash_basis                         boolean  not null default false,
  add column if not exists cash_basis_transition_account_code text;

comment on column tax_templates.tax_kind is
  'vat, gst, sales_tax, withholding, other. A label for the reports, never an input to the calculation.';
comment on column tax_templates.recoverable is
  'False when the buyer never gets the tax back: American sales tax, Canadian PST. Where it lands is said by a tax_on_base posting.';
comment on column tax_templates.jurisdiction is
  'ISO 3166-2 with the country prefix — CA-QC, US-CA — for a tax levied by a state. Null in Europe.';
comment on column tax_templates.price_include is
  'The unit price already holds the tax (UK and Australian retail). `taxes` carried this from the start and the template did not.';
comment on column tax_templates.cash_basis is
  'The tax falls due when the invoice is paid. Column only: P0-6 implements the behaviour, this migration just stops the pack from losing the value.';
comment on column tax_templates.cash_basis_transition_account_code is
  'Account the tax waits on until the invoice is paid. Column only, read by P0-6.';

alter table taxes
  add column if not exists tax_kind                         tax_kind not null default 'vat',
  add column if not exists recoverable                      boolean  not null default true,
  add column if not exists jurisdiction                     text,
  add column if not exists cash_basis                       boolean  not null default false,
  add column if not exists cash_basis_transition_account_id uuid references accounts(id) on delete restrict;

comment on column taxes.tax_kind is
  'vat, gst, sales_tax, withholding, other. A label for the reports, never an input to the calculation.';
comment on column taxes.recoverable is
  'False when the buyer never gets the tax back. The ledger consequence is a tax_on_base posting, not this column.';
comment on column taxes.jurisdiction is
  'ISO 3166-2 with the country prefix, for a tax levied by a state. Null in Europe.';
comment on column taxes.cash_basis is
  'The tax falls due when the invoice is paid. Column only until P0-6.';
comment on column taxes.cash_basis_transition_account_id is
  'Account the tax waits on until the invoice is paid. Column only until P0-6.';

-- A tax belongs to a company and so does the account it points at; the
-- composite key is how every other reference in this schema says it.
alter table taxes
  add constraint taxes_cash_basis_account_company
  foreign key (cash_basis_transition_account_id, company_id) references accounts(id, company_id);

-- ---------------------------------------------------------------------------
-- Which posting type carries an account
--
-- Two constraints said it before, one per type, and neither had an opinion
-- about a type that did not exist. `tax_on_base` must carry no account — the
-- account is the line's — so the rule is now stated once, for every value of
-- the enum, and a value added later has to come back here rather than slip
-- through. This is the promised replacement of `tax_has_account`: a `tax`
-- still needs an account, and `tax_on_base` is exempt.
-- ---------------------------------------------------------------------------

alter table tax_postings
  drop constraint if exists tax_postings_base_has_no_account,
  drop constraint if exists tax_postings_tax_has_account;

alter table tax_postings
  add constraint tax_postings_account_by_type check (
    case posting_type when 'tax' then account_id is not null else account_id is null end
  );

alter table tax_posting_templates
  drop constraint if exists tax_posting_templates_base_has_no_account,
  drop constraint if exists tax_posting_templates_tax_has_account;

alter table tax_posting_templates
  add constraint tax_posting_templates_account_by_type check (
    case posting_type when 'tax' then account_code is not null else account_code is null end
  );

-- ---------------------------------------------------------------------------
-- The country model
-- ---------------------------------------------------------------------------

alter table country_defaults
  add column if not exists rounding_method    rounding_method not null default 'half_up',
  add column if not exists cash_rounding_unit numeric(8, 4)   not null default 0;

comment on column country_defaults.rounding_method is
  'How this country rounds a tax amount. half_up is what post_document does today, in every country, so the default changes nothing.';
comment on column country_defaults.cash_rounding_unit is
  'Smallest coin when it is not the cent: 0.05 in Switzerland. 0 means the cent, which is every country of phase 0.';

alter table country_defaults
  add constraint country_defaults_cash_rounding_unit_positive check (cash_rounding_unit >= 0);

-- ---------------------------------------------------------------------------
-- document_tax_summary — what the other party actually pays
--
-- `tax_charged` sums the accounting factors of the *tax* postings, so a tax
-- whose postings net to zero adds nothing to the document total. That is what
-- makes a self-assessed purchase come out at the net amount. A `tax_on_base`
-- posting is money that leaves the company exactly like a `tax` posting — the
-- supplier of a company car is owed 1 210 € and not 1 105 € — so it counts
-- here too. Without this line the document total would be short by the
-- non-deductible half and `post_document` would refuse the document with
-- `document_total_mismatch`, which is at least an honest failure.
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
                  and tp.posting_type in ('tax', 'tax_on_base')
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

-- ---------------------------------------------------------------------------
-- post_document — the same function, plus one posting type
--
-- Everything about an existing tax is byte for byte what it was: the base
-- loop, the counterpart, the rounding, the refusals. The tax loop now also
-- reads `tax_on_base` postings, and for those it writes the amount on the
-- accounts of the lines instead of on an account of its own.
-- ---------------------------------------------------------------------------

create or replace function post_document(p_document_id uuid)
returns entries
language plpgsql
as $$
declare
  v_doc        documents%rowtype;
  v_entry      entries%rowtype;
  v_journal    uuid;
  v_date       date;
  v_is_sale    boolean;
  v_is_credit  boolean;
  v_kind       tax_document_kind;
  v_base_credit boolean;
  v_seq        integer := 0;
  v_contact    uuid;
  v_maturity   date;
  v_terms      smallint;
  v_counterpart uuid;
  v_diff       numeric(16, 2);
  v_amount     numeric(16, 2);
  v_box_amount numeric(16, 2);
  v_share      numeric(16, 2);
  v_share_box  numeric(16, 2);
  v_left       numeric(16, 2);
  v_left_box   numeric(16, 2);
  v_side_left     numeric(16, 2);
  v_side_left_neg numeric(16, 2);
  v_side_credit boolean;
  v_label      text;
  r            record;
  p            record;
  g            record;
begin
  select * into v_doc from documents where id = p_document_id for update;
  if not found then
    raise exception 'unknown_document: document % does not exist', p_document_id;
  end if;
  if v_doc.state = 'posted' then
    raise exception 'document_already_posted: document % is already posted', p_document_id;
  end if;
  if v_doc.state = 'cancelled' then
    raise exception 'document_cancelled: document % cannot be posted', p_document_id;
  end if;
  if v_doc.entry_id is not null then
    raise exception 'document_already_booked: document % already points at entry %',
      p_document_id, v_doc.entry_id;
  end if;

  if v_doc.doc_type in ('sale_quote', 'purchase_order') then
    raise exception 'document_not_accountable: a % is not booked', v_doc.doc_type;
  end if;

  v_is_sale   := v_doc.doc_type in ('sale_invoice', 'sale_credit_note');
  v_is_credit := v_doc.doc_type in ('sale_credit_note', 'purchase_credit_note');
  v_kind      := case when v_is_credit then 'credit_note' else 'invoice' end::tax_document_kind;
  -- Sale invoice and purchase credit note credit the base; the other two debit it.
  v_base_credit := (v_is_sale <> v_is_credit);

  v_date := coalesce(v_doc.accounting_date, v_doc.document_date);

  if not exists (
    select 1 from document_lines
     where document_id = p_document_id and line_type = 'product' and amount_untaxed <> 0
  ) then
    raise exception 'document_empty: document % has no billable line', p_document_id;
  end if;

  -- A fixed-amount tax has no basis to spread over lines; refuse rather than
  -- guess.
  if exists (
    select 1 from document_lines l join taxes t on t.id = l.tax_id
     where l.document_id = p_document_id and t.amount_type <> 'percent'
  ) then
    raise exception 'unsupported_tax_amount_type: only percentage taxes can be posted';
  end if;

  -- Every tax used must be in force on the accounting date.
  for r in
    select distinct t.id, t.code, t.valid_from, t.valid_to
      from document_lines l join taxes t on t.id = l.tax_id
     where l.document_id = p_document_id
  loop
    if v_date < r.valid_from or (r.valid_to is not null and v_date > r.valid_to) then
      raise exception 'tax_not_in_force: tax % is not applicable on %', r.code, v_date;
    end if;
  end loop;

  -- Totals are derived; make sure they reflect the lines as they stand now.
  perform documents_refresh_totals(p_document_id);
  select * into v_doc from documents where id = p_document_id;

  v_journal := coalesce(
    v_doc.journal_id,
    case when v_is_sale
      then (select sales_journal_id from companies where id = v_doc.company_id)
      else (select purchase_journal_id from companies where id = v_doc.company_id)
    end
  );
  if v_journal is null then
    raise exception 'no_journal: set journal_id on the document or a default journal on the company';
  end if;

  perform assert_period_open(v_doc.company_id, v_date, true);

  v_label := coalesce(v_doc.number, v_doc.supplier_reference, 'document');

  insert into entries (company_id, journal_id, fiscal_year_id, entry_date, reference,
                       description, state, document_id, currency_code)
  values (v_doc.company_id, v_journal, fiscal_year_at(v_doc.company_id, v_date), v_date,
          coalesce(v_doc.number, v_doc.supplier_reference),
          v_label || case when v_doc.supplier_reference is not null and v_doc.number is not null
                          then ' / ' || v_doc.supplier_reference else '' end,
          'draft', p_document_id, v_doc.currency_code)
  returning * into v_entry;

  -- ------------------------------------------------------------------ bases
  for r in
    select l.account_id,
           l.tax_id,
           sum(l.amount_untaxed) as base_amount,
           min(l.sequence)       as seq,
           string_agg(distinct l.name, ', ') as label
      from document_lines l
     where l.document_id = p_document_id
       and l.line_type = 'product'
     group by l.account_id, l.tax_id
    having sum(l.amount_untaxed) <> 0
     order by 4
  loop
    select tp.declaration_box, tp.factor_percent, tp.box_factor_percent
      into p
      from tax_postings tp
     where tp.tax_id = r.tax_id
       and tp.document_kind = v_kind
       and tp.posting_type = 'base'
     limit 1;

    v_amount := round(r.base_amount * coalesce(p.factor_percent, 100) / 100, 2);
    v_seq := v_seq + 10;

    insert into entry_lines (entry_id, company_id, account_id, sequence, name,
                             debit, credit, tax_id, tax_line,
                             declaration_box, box_amount, currency_code)
    values (v_entry.id, v_doc.company_id, r.account_id, v_seq, left(r.label, 200),
            case when v_base_credit then 0 else v_amount end,
            case when v_base_credit then v_amount else 0 end,
            r.tax_id, false,
            p.declaration_box,
            case when p.declaration_box is null then null
                 else round(r.base_amount * coalesce(p.box_factor_percent, 100) / 100, 2) end,
            v_doc.currency_code);
  end loop;

  -- ------------------------------------------------------------------ taxes
  for r in
    select s.tax_id, s.tax_code, s.tax_name, s.tax_amount
      from document_tax_summary s
     where s.document_id = p_document_id
       and s.tax_id is not null
       and s.tax_amount <> 0
     order by s.tax_code
  loop
    -- The postings of one side share out the tax of the group; the last of
    -- each side takes what is left. Until `tax_on_base` there was never more
    -- than one posting per side, so this changes no existing tax by a cent —
    -- and it is what keeps a 50/50 split honest: 0.63 becomes 0.32 and 0.31,
    -- where rounding each half on its own would book 0.64 against a document
    -- that totals 0.63.
    v_side_left     := null;
    v_side_left_neg := null;

    for p in
      select tp.posting_type, tp.factor_percent, tp.account_id,
             tp.declaration_box, tp.box_factor_percent,
             case when tp.factor_percent >= 0 then 1 else -1 end as side,
             sum(abs(tp.factor_percent))
               over (partition by case when tp.factor_percent >= 0 then 1 else -1 end)
               as side_factor,
             row_number() over (
               partition by case when tp.factor_percent >= 0 then 1 else -1 end
               order by tp.sequence, tp.id)
             = count(*) over (
               partition by case when tp.factor_percent >= 0 then 1 else -1 end)
               as is_last_of_side
        from tax_postings tp
       where tp.tax_id = r.tax_id
         and tp.document_kind = v_kind
         and tp.posting_type in ('tax', 'tax_on_base')
       order by tp.sequence, tp.id
    loop
      -- The tax of the group was rounded once, in the view. Every posting is
      -- a share of that one figure, never of a re-derived one.
      if p.side >= 0 then
        if v_side_left is null then
          v_side_left := round(r.tax_amount * p.side_factor / 100, 2);
        end if;
        if p.is_last_of_side then
          v_amount := v_side_left;
        else
          v_amount    := round(r.tax_amount * abs(p.factor_percent) / 100, 2);
          v_side_left := v_side_left - v_amount;
        end if;
      else
        if v_side_left_neg is null then
          v_side_left_neg := round(r.tax_amount * p.side_factor / 100, 2);
        end if;
        if p.is_last_of_side then
          v_amount := v_side_left_neg;
        else
          v_amount        := round(r.tax_amount * abs(p.factor_percent) / 100, 2);
          v_side_left_neg := v_side_left_neg - v_amount;
        end if;
      end if;

      if v_amount = 0 then
        continue;
      end if;
      -- A positive factor keeps the side of the base, a negative one flips it.
      v_side_credit := case when p.factor_percent >= 0 then v_base_credit else not v_base_credit end;
      -- The box keeps its own rounding: `box_factor_percent` was always
      -- independent from `factor_percent`, because a declaration figure is
      -- not a ledger figure and only the ledger has to balance.
      v_box_amount := case when p.declaration_box is null then null
                           else round(r.tax_amount * p.box_factor_percent / 100, 2) end;

      if p.posting_type = 'tax' then
        v_seq := v_seq + 10;

        insert into entry_lines (entry_id, company_id, account_id, sequence, name,
                                 debit, credit, tax_id, tax_line,
                                 declaration_box, box_amount, currency_code)
        values (v_entry.id, v_doc.company_id, p.account_id, v_seq, r.tax_name,
                case when v_side_credit then 0 else v_amount end,
                case when v_side_credit then v_amount else 0 end,
                r.tax_id, true,
                p.declaration_box, v_box_amount, v_doc.currency_code);
        continue;
      end if;

      -- `tax_on_base`: the tax is a cost, so it lands on the accounts of the
      -- lines it taxes, split in proportion to their base. The last share
      -- takes whatever is left, so the shares add up to the amount that was
      -- rounded once on the group and the entry still balances to the cent.
      v_left     := v_amount;
      v_left_box := v_box_amount;

      for g in
        select account_id,
               base_amount,
               seq,
               sum(base_amount) over ()                                   as total_base,
               row_number() over (order by seq) = count(*) over ()         as is_last
          from (
            select l.account_id,
                   sum(l.amount_untaxed) as base_amount,
                   min(l.sequence)       as seq
              from document_lines l
             where l.document_id = p_document_id
               and l.line_type = 'product'
               and l.tax_id = r.tax_id
             group by l.account_id
            having sum(l.amount_untaxed) <> 0
          ) as groups
         order by seq
      loop
        if g.is_last then
          v_share     := v_left;
          v_share_box := v_left_box;
        else
          v_share     := round(v_amount * g.base_amount / g.total_base, 2);
          v_share_box := case when v_box_amount is null then null
                              else round(v_box_amount * g.base_amount / g.total_base, 2) end;
          v_left      := v_left - v_share;
          v_left_box  := v_left_box - v_share_box;
        end if;

        if v_share = 0 then
          continue;
        end if;

        v_seq := v_seq + 10;

        -- `tax_line` stays false: the amount is on a base account and belongs
        -- to the base side of the declaration, which is why the Belgian grids
        -- 82 and 83 report it together with the base.
        insert into entry_lines (entry_id, company_id, account_id, sequence, name,
                                 debit, credit, tax_id, tax_line,
                                 declaration_box, box_amount, currency_code)
        values (v_entry.id, v_doc.company_id, g.account_id, v_seq, r.tax_name,
                case when v_side_credit then 0 else v_share end,
                case when v_side_credit then v_share else 0 end,
                r.tax_id, false,
                p.declaration_box, v_share_box, v_doc.currency_code);
      end loop;
    end loop;
  end loop;

  -- ------------------------------------------------------------ counterpart
  select total_debit - total_credit into v_diff from entries where id = v_entry.id;

  if v_diff = 0 then
    raise exception 'document_counterpart_zero: document % produced a nil counterpart', p_document_id;
  end if;

  v_contact := commercial_entity(v_doc.contact_id);
  v_counterpart := resolve_counterpart_account(v_doc.company_id, v_contact, v_is_sale);

  select payment_terms_days into v_terms from contacts where id = v_contact;
  v_maturity := coalesce(v_doc.due_date, v_doc.document_date + coalesce(v_terms, 30));

  v_amount := abs(v_diff);
  v_seq := v_seq + 10;

  insert into entry_lines (entry_id, company_id, account_id, sequence, name,
                           debit, credit, contact_id, date_maturity, currency_code)
  values (v_entry.id, v_doc.company_id, v_counterpart, v_seq, v_label,
          case when v_diff > 0 then 0 else v_amount end,
          case when v_diff > 0 then v_amount else 0 end,
          v_contact, v_maturity, v_doc.currency_code);

  -- The ledger is right by construction. If the header disagrees, the header
  -- is what is wrong, and we say so instead of quietly patching a line.
  if abs(v_amount - abs(v_doc.amount_total)) > 0.005 then
    raise exception 'document_total_mismatch: document % totals % but its lines book %',
      p_document_id, v_doc.amount_total, v_amount;
  end if;

  -- --------------------------------------------------------------- posting
  v_entry := post_entry(v_entry.id);

  update documents
     set state  = 'posted',
         number = coalesce(number, v_entry.number),
         entry_id = v_entry.id,
         accounting_date = v_date
   where id = p_document_id;

  return v_entry;
end;
$$;

comment on function post_document(uuid) is
  'Books a document: base lines, tax lines from tax_postings — including the non-deductible share, which lands on the accounts of the lines — and a counterpart that balances by construction.';

-- ---------------------------------------------------------------------------
-- install_country_template carries the new columns into a company
-- ---------------------------------------------------------------------------

create or replace function install_country_template(
  p_company_id uuid,
  p_country    char(2),
  p_language   char(2) default null
)
returns void
language plpgsql
as $$
declare
  v_defaults country_defaults%rowtype;
  r          record;
  v_tax_id   uuid;
  v_language char(2);
  v_version  text;
begin
  if not exists (select 1 from companies where id = p_company_id) then
    raise exception 'unknown_company: %', p_company_id;
  end if;
  if not exists (select 1 from account_templates where country = p_country) then
    raise exception 'unknown_country_template: no chart of accounts seeded for %', p_country;
  end if;

  select coalesce(p_language, c.language) into v_language
    from companies c where c.id = p_company_id;

  -- 1. Accounts, without the hierarchy.
  insert into accounts (company_id, code, name, name_i18n, statement_hint,
                        account_type, reconcilable)
  select p_company_id, t.code,
         coalesce(nullif(t.name_i18n ->> v_language, ''), t.name),
         t.name_i18n, t.statement_hint, t.account_type, t.reconcilable
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

  -- 4. Taxes and their postings, each posting keeping the form its box is on.
  for r in
    select * from tax_templates where country = p_country order by sequence, code
  loop
    v_tax_id := null;
    insert into taxes (company_id, code, name, description, amount_type, amount,
                       applies_to, treatment, country, valid_from, valid_to,
                       legal_reference, vat_category, exemption_code, sequence,
                       tax_kind, recoverable, jurisdiction, price_include,
                       cash_basis, cash_basis_transition_account_id)
    values (p_company_id, r.code, r.name, r.description, r.amount_type, r.amount,
            r.applies_to, r.treatment, p_country, r.valid_from, r.valid_to,
            r.legal_reference, r.vat_category, r.exemption_code, r.sequence,
            r.tax_kind, r.recoverable, r.jurisdiction, r.price_include,
            r.cash_basis, account_id_by_code(p_company_id, r.cash_basis_transition_account_code))
    on conflict (company_id, code) do nothing
    returning id into v_tax_id;

    if v_tax_id is null then
      continue;
    end if;

    insert into tax_postings (tax_id, company_id, document_kind, posting_type,
                              factor_percent, account_id, declaration_box,
                              box_factor_percent, report_code, sequence)
    select v_tax_id, p_company_id, tp.document_kind, tp.posting_type,
           tp.factor_percent, account_id_by_code(p_company_id, tp.account_code),
           tp.declaration_box, tp.box_factor_percent, tp.report_code, tp.sequence
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

  -- 6. What was copied, and from which version.
  v_version := coalesce((select version from country_packs where country = p_country), '1.0.0');

  insert into company_packs (company_id, country, version)
  values (p_company_id, p_country, v_version)
  on conflict (company_id, country) do update
     set version = excluded.version,
         upgraded_at = now()
   where company_packs.version is distinct from excluded.version;
end;
$$;

comment on function install_country_template(uuid, char, char) is
  'Copies a country pack into a company in one language, wires the default roles and the financial journals, and records the pack version in company_packs.';

-- A function created now comes out executable by PUBLIC unless this runs, and
-- on Supabase that is an anonymous RPC endpoint. From PUBLIC only — `anon`
-- holds explicit grants on the policy helpers. Rule 6 of the README.
revoke execute on all functions in schema public from public;
