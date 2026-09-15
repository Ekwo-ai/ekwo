-- Ekwo OS — the article behind what a country puts on an invoice.
--
-- `20260912111751_document_rules.sql` moved the document rules of a country
-- into the pack: whether the numbering may skip, what a number looks like,
-- the payment term the law sets, when the tax falls due, the structured
-- invoice the country expects. Every one of them arrived as a word — a
-- `gapless_per_year`, a `30`, an `invoice_date`, a `peppol-bis-3` — and not
-- one of them arrived with the article that says so.
--
-- That is a narrower gap than it looks. Two places in this schema already
-- refuse a rule nobody can trace: `legal_mention_templates.legal_reference`
-- says which article requires a sentence, and `tax_templates.source_key` and
-- `tax_report_box_templates.source_key`, added the day the register landed,
-- say which text that article is read in. A rate cites a decree and a grid
-- cites a form, while the rule that decides how every invoice of the country
-- is numbered cited nothing — and a word looks exactly the same whether
-- somebody read the decree or guessed.
--
-- Eight columns, four pairs, one per rule:
--
--   numbering       the article requiring a sequential, uniquely identifying
--                   number, and the shape of that number where a country
--                   prescribes one — `numbering_gapless` and `number_format`
--                   answer the same article, so they share one citation
--   payment_terms   the article setting `legal_payment_days` in the absence
--                   of an agreement. Not the interest and the recovery
--                   indemnity, which are `late_payment_reference`: that one
--                   is a sentence a renderer prints, this one is a citation
--   tax_point       the article fixing `tax_point_rule`
--   einvoice        the text making `einvoice_profile` obligatory from
--                   `einvoice_mandatory_from`. The pack format has carried
--                   `einvoicing.legal_reference` since the section existed
--                   and all four packs write it; the compiler dropped it on
--                   the floor, which is what this column ends
--
-- Four pairs and not one citation for the whole section, because they are
-- four articles of three or four different texts in every country the packs
-- cover: Belgium numbers an invoice under a royal decree of 1992, counts a
-- payment term under a law of 2002, dates its tax under the VAT code and owes
-- its e-invoice to a law of 2024. One column would have held all four in one
-- string, and then no rule would have had a citation of its own.
--
-- **Additive, and nullable without a default**, for the reason that migration
-- gave for the rules themselves: an article invented for a country that has
-- not spoken is one country's law written on another's invoice. A pack that
-- cites nothing leaves null, and `ekwo pack check` is where that is answered
-- for — it refuses a declared rule with no article on a `reviewed` pack and
-- warns about one on any other, before a seed is ever written.
--
-- `source_key` is not a foreign key, for the reason `20260915161842` gave:
-- the register lives in a jsonb column of `country_packs`, a pack is upserted
-- one statement at a time, and a constraint between the two would fail on the
-- order the seed happens to write them in. `ekwo pack check` refuses a key the
-- register does not carry, which is where that check belongs.

alter table country_defaults
  add column if not exists numbering_legal_reference     text,
  add column if not exists numbering_source_key          text,
  add column if not exists payment_terms_legal_reference text,
  add column if not exists payment_terms_source_key      text,
  add column if not exists tax_point_legal_reference     text,
  add column if not exists tax_point_source_key          text,
  add column if not exists einvoice_legal_reference      text,
  add column if not exists einvoice_source_key           text;

comment on column country_defaults.numbering_legal_reference is
  'The article requiring a sequential, uniquely identifying invoice number, and the shape of that number where the country prescribes one. Covers numbering_gapless and number_format together: both answer the same article.';
comment on column country_defaults.numbering_source_key is
  'Key of the entry in country_packs.sources where numbering_legal_reference can be read. Null where the pack names none.';
comment on column country_defaults.payment_terms_legal_reference is
  'The article setting legal_payment_days in the absence of an agreement. Distinct from late_payment_reference, which says where the interest and the recovery indemnity come from and is written to be printed.';
comment on column country_defaults.payment_terms_source_key is
  'Key of the entry in country_packs.sources where payment_terms_legal_reference can be read. Null where the pack names none.';
comment on column country_defaults.tax_point_legal_reference is
  'The article fixing tax_point_rule. Where the value is a derogation rather than the country''s principle, the reference says which, so a reader is not left believing the pack read the wrong article.';
comment on column country_defaults.tax_point_source_key is
  'Key of the entry in country_packs.sources where tax_point_legal_reference can be read. Null where the pack names none.';
comment on column country_defaults.einvoice_legal_reference is
  'The text making einvoice_profile obligatory from einvoice_mandatory_from. Where reception and emission start on different days, the emission calendar is written out here; where a country has several registration identifiers, this is where the ones party_scheme could not hold are named.';
comment on column country_defaults.einvoice_source_key is
  'Key of the entry in country_packs.sources where einvoice_legal_reference can be read. Null where the pack names none.';

-- No object is created and no function is added, so there is nothing to grant
-- and nothing to revoke: a column added to a table is reachable by whoever
-- could already select that table, under the policies it already has.
