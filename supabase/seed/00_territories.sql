-- Ekwo OS — territories. The common system of VAT, and where it applies.
--
-- Reference data of the framework, like the currencies beside it, and read by
-- `ec_sales_list()` through `territory_of()`, `is_eu_member()`,
-- `eu_vat_scope_of()` and `vat_prefix_of()`. The table, the four functions and
-- the whole argument for why this is data and not code are in the migration
-- `20260915181000_territories.sql`; this file is the rows.
--
-- **It upserts, where the currencies do nothing.** A currency nobody corrects
-- can be inserted once and left alone. This list changes — a State accedes, a
-- State leaves, a territory moves from one paragraph of article 6 to another —
-- and re-applying this file has to be how that correction reaches an
-- installation that already exists, which is the rule the seed README states
-- for every country pack. So every column is written again on conflict.
--
-- Sources, in full, in the migration. In short: Council Directive 2006/112/EC,
-- articles 5, 6 and 7; the Withdrawal Agreement and the Protocol on
-- Ireland/Northern Ireland; the VIES register for the prefixes; the accession
-- treaties for the dates, cited on each row.

-- ---------------------------------------------------------------------------
-- The rows — the Member States
--
-- One row per State, with the day it became bound by the common system, which
-- is the day of its accession. The six founding States are dated 1 January
-- 1958, the day the Treaty of Rome entered into force: the common system
-- itself is younger — the first directives are of 1967 and the sixth of 1977 —
-- and dating them from 1958 says the same thing every reader of this column
-- needs, which is that nothing in a ledger this software will ever read falls
-- before the date.
-- ---------------------------------------------------------------------------

insert into territories (code, code_source, name, parent_code, eu_vat_scope, eu_vat_from, eu_vat_to, vat_prefix, legal_reference) values
  ('BE', 'iso_3166_1', 'Belgium',        null, 'full', date '1958-01-01', null, null, 'Treaty establishing the European Economic Community, Rome, 25 March 1957, in force 1 January 1958'),
  ('DE', 'iso_3166_1', 'Germany',        null, 'full', date '1958-01-01', null, null, 'Treaty establishing the European Economic Community, Rome, 25 March 1957, in force 1 January 1958'),
  ('FR', 'iso_3166_1', 'France',         null, 'full', date '1958-01-01', null, null, 'Treaty establishing the European Economic Community, Rome, 25 March 1957, in force 1 January 1958'),
  ('IT', 'iso_3166_1', 'Italy',          null, 'full', date '1958-01-01', null, null, 'Treaty establishing the European Economic Community, Rome, 25 March 1957, in force 1 January 1958'),
  ('LU', 'iso_3166_1', 'Luxembourg',     null, 'full', date '1958-01-01', null, null, 'Treaty establishing the European Economic Community, Rome, 25 March 1957, in force 1 January 1958'),
  ('NL', 'iso_3166_1', 'Netherlands',    null, 'full', date '1958-01-01', null, null, 'Treaty establishing the European Economic Community, Rome, 25 March 1957, in force 1 January 1958'),
  ('DK', 'iso_3166_1', 'Denmark',        null, 'full', date '1973-01-01', null, null, 'Treaty of Accession 1972, in force 1 January 1973'),
  ('IE', 'iso_3166_1', 'Ireland',        null, 'full', date '1973-01-01', null, null, 'Treaty of Accession 1972, in force 1 January 1973'),
  ('GR', 'iso_3166_1', 'Greece',         null, 'full', date '1981-01-01', null, 'EL', 'Treaty of Accession 1979, in force 1 January 1981; the prefix EL is the one the VIES register publishes for Greek VAT identification numbers'),
  ('ES', 'iso_3166_1', 'Spain',          null, 'full', date '1986-01-01', null, null, 'Treaty of Accession 1985, in force 1 January 1986'),
  ('PT', 'iso_3166_1', 'Portugal',       null, 'full', date '1986-01-01', null, null, 'Treaty of Accession 1985, in force 1 January 1986'),
  ('AT', 'iso_3166_1', 'Austria',        null, 'full', date '1995-01-01', null, null, 'Treaty of Accession 1994, in force 1 January 1995'),
  ('FI', 'iso_3166_1', 'Finland',        null, 'full', date '1995-01-01', null, null, 'Treaty of Accession 1994, in force 1 January 1995'),
  ('SE', 'iso_3166_1', 'Sweden',         null, 'full', date '1995-01-01', null, null, 'Treaty of Accession 1994, in force 1 January 1995'),
  ('CY', 'iso_3166_1', 'Cyprus',         null, 'full', date '2004-05-01', null, null, 'Treaty of Accession 2003, in force 1 May 2004'),
  ('CZ', 'iso_3166_1', 'Czechia',        null, 'full', date '2004-05-01', null, null, 'Treaty of Accession 2003, in force 1 May 2004'),
  ('EE', 'iso_3166_1', 'Estonia',        null, 'full', date '2004-05-01', null, null, 'Treaty of Accession 2003, in force 1 May 2004'),
  ('HU', 'iso_3166_1', 'Hungary',        null, 'full', date '2004-05-01', null, null, 'Treaty of Accession 2003, in force 1 May 2004'),
  ('LT', 'iso_3166_1', 'Lithuania',      null, 'full', date '2004-05-01', null, null, 'Treaty of Accession 2003, in force 1 May 2004'),
  ('LV', 'iso_3166_1', 'Latvia',         null, 'full', date '2004-05-01', null, null, 'Treaty of Accession 2003, in force 1 May 2004'),
  ('MT', 'iso_3166_1', 'Malta',          null, 'full', date '2004-05-01', null, null, 'Treaty of Accession 2003, in force 1 May 2004'),
  ('PL', 'iso_3166_1', 'Poland',         null, 'full', date '2004-05-01', null, null, 'Treaty of Accession 2003, in force 1 May 2004'),
  ('SI', 'iso_3166_1', 'Slovenia',       null, 'full', date '2004-05-01', null, null, 'Treaty of Accession 2003, in force 1 May 2004'),
  ('SK', 'iso_3166_1', 'Slovakia',       null, 'full', date '2004-05-01', null, null, 'Treaty of Accession 2003, in force 1 May 2004'),
  ('BG', 'iso_3166_1', 'Bulgaria',       null, 'full', date '2007-01-01', null, null, 'Treaty of Accession 2005, in force 1 January 2007'),
  ('RO', 'iso_3166_1', 'Romania',        null, 'full', date '2007-01-01', null, null, 'Treaty of Accession 2005, in force 1 January 2007'),
  ('HR', 'iso_3166_1', 'Croatia',        null, 'full', date '2013-07-01', null, null, 'Treaty of Accession 2011, in force 1 July 2013')
on conflict (code) do update set
  code_source     = excluded.code_source,
  name            = excluded.name,
  parent_code     = excluded.parent_code,
  eu_vat_scope    = excluded.eu_vat_scope,
  eu_vat_from     = excluded.eu_vat_from,
  eu_vat_to       = excluded.eu_vat_to,
  vat_prefix      = excluded.vat_prefix,
  legal_reference = excluded.legal_reference;

-- ---------------------------------------------------------------------------
-- The United Kingdom, and Northern Ireland
--
-- Two rows, not one, and the second is not a column on the first.
--
-- Northern Ireland is a territory of the United Kingdom, which is not a Member
-- State, and it is inside the common system of VAT for supplies of goods and
-- outside it for supplies of services. Its numbers carry `XI`, a prefix the
-- United Kingdom's own `GB` numbers do not share, and VIES validates them
-- separately. Everything a reader asks of a territory it asks of that one:
-- what its prefix is, whether a supply to it is intra-Community, which State
-- it belongs to. A boolean on the `GB` row — `vat_territory_of_eu_for_goods` —
-- would answer none of them: it would make the United Kingdom itself partly
-- inside the system, which is exactly wrong, and it would leave `XI` with
-- nothing to resolve to when it arrives in a VAT number.
--
-- So: a row, with `parent_code` saying whose territory it is, and the middle
-- value of `eu_vat_scope` saying how much of the system reaches it. The date
-- is 1 January 2021, the day after the transition ended, which is the first
-- day `XI` meant anything: before it, Northern Ireland was inside the system
-- because the whole United Kingdom was.
-- ---------------------------------------------------------------------------

insert into territories (code, code_source, name, parent_code, eu_vat_scope, eu_vat_from, eu_vat_to, vat_prefix, legal_reference) values
  ('GB', 'iso_3166_1', 'United Kingdom', null, 'full', date '1973-01-01', date '2020-12-31', null,
   'Treaty of Accession 1972, in force 1 January 1973. The United Kingdom ceased to be a Member State on 31 January 2020 and remained inside the common system of VAT until 31 December 2020, because articles 126 and 127 of the Withdrawal Agreement kept Union law applying through the transition period. This column records the VAT date.'),
  ('XI', 'eu',         'Northern Ireland', 'GB', 'goods', date '2021-01-01', null, null,
   'Protocol on Ireland/Northern Ireland to the Withdrawal Agreement, article 8 and annex 3, as amended by the Windsor Framework: the Union''s VAT rules on goods apply in Northern Ireland and its rules on services do not. The prefix XI is the one the VIES register publishes for it.')
on conflict (code) do update set
  code_source     = excluded.code_source,
  name            = excluded.name,
  parent_code     = excluded.parent_code,
  eu_vat_scope    = excluded.eu_vat_scope,
  eu_vat_from     = excluded.eu_vat_from,
  eu_vat_to       = excluded.eu_vat_to,
  vat_prefix      = excluded.vat_prefix,
  legal_reference = excluded.legal_reference;

-- ---------------------------------------------------------------------------
-- Territories article 7 puts inside the system
--
-- Two places that are not in the Union and where the Directive applies all the
-- same, because the article says a transaction with them is a transaction with
-- the State beside them. Both are worth a row for one reason: their VAT
-- numbers carry that State's prefix, so a customer recorded in Monaco is a
-- French customer to every form this software writes, and a reader that took
-- `MC` at face value would report an export.
-- ---------------------------------------------------------------------------

insert into territories (code, code_source, name, parent_code, eu_vat_scope, eu_vat_from, eu_vat_to, vat_prefix, legal_reference) values
  ('MC', 'iso_3166_1', 'Monaco',      'FR', 'full', date '1958-01-01', null,                 'FR',
   'Directive 2006/112/EC, article 7(1): transactions originating in or intended for the Principality of Monaco are treated as transactions originating in or intended for France'),
  ('IM', 'iso_3166_1', 'Isle of Man', 'GB', 'full', date '1973-01-01', date '2020-12-31', 'GB',
   'Directive 2006/112/EC, article 7(1): transactions originating in or intended for the Isle of Man were treated as transactions originating in or intended for the United Kingdom, which left the common system on 31 December 2020')
on conflict (code) do update set
  code_source     = excluded.code_source,
  name            = excluded.name,
  parent_code     = excluded.parent_code,
  eu_vat_scope    = excluded.eu_vat_scope,
  eu_vat_from     = excluded.eu_vat_from,
  eu_vat_to       = excluded.eu_vat_to,
  vat_prefix      = excluded.vat_prefix,
  legal_reference = excluded.legal_reference;

-- ---------------------------------------------------------------------------
-- Territories article 6 takes out of the system
--
-- The Directive does not apply to them, whether or not they are inside the
-- customs territory of the Union, and the distinction between its two
-- paragraphs is a customs one that changes nothing here — which is why the
-- column records the outcome and the `legal_reference` records the paragraph.
-- Campione d'Italia and the Italian waters of Lake Lugano moved from the
-- second paragraph to the first on 1 January 2020 and were outside the VAT
-- territory before and after, so the row carries both citations and no date.
--
-- None of them issues a VAT identification number, so `vat_prefix` is null on
-- every one: a business established in the Canary Islands that has to identify
-- for Union VAT does so in Spain, with a Spanish number.
-- ---------------------------------------------------------------------------

insert into territories (code, code_source, name, parent_code, eu_vat_scope, eu_vat_from, eu_vat_to, vat_prefix, legal_reference) values
  ('GR-69',         'iso_3166_2', 'Mount Athos',                    'GR', 'none', null, null, null, 'Directive 2006/112/EC, article 6(1)(a)'),
  ('ES-CN',         'iso_3166_2', 'Canary Islands',                 'ES', 'none', null, null, null, 'Directive 2006/112/EC, article 6(1)(b)'),
  ('GP',            'iso_3166_1', 'Guadeloupe',                     'FR', 'none', null, null, null, 'Directive 2006/112/EC, article 6(1)(c), which names the French territories referred to in articles 349 and 355(1) of the Treaty on the Functioning of the European Union'),
  ('GF',            'iso_3166_1', 'French Guiana',                  'FR', 'none', null, null, null, 'Directive 2006/112/EC, article 6(1)(c)'),
  ('MQ',            'iso_3166_1', 'Martinique',                     'FR', 'none', null, null, null, 'Directive 2006/112/EC, article 6(1)(c)'),
  ('RE',            'iso_3166_1', 'Réunion',                        'FR', 'none', null, null, null, 'Directive 2006/112/EC, article 6(1)(c)'),
  ('YT',            'iso_3166_1', 'Mayotte',                        'FR', 'none', null, null, null, 'Directive 2006/112/EC, article 6(1)(c)'),
  ('MF',            'iso_3166_1', 'Saint-Martin (French part)',     'FR', 'none', null, null, null, 'Directive 2006/112/EC, article 6(1)(c)'),
  ('AX',            'iso_3166_1', 'Åland Islands',                  'FI', 'none', null, null, null, 'Directive 2006/112/EC, article 6(1)(d); Act of Accession 1994, protocol no 2 on the Åland Islands'),
  ('GG',            'iso_3166_1', 'Guernsey',                       'GB', 'none', null, null, null, 'Directive 2006/112/EC, article 6(1)(e), which names the Channel Islands'),
  ('JE',            'iso_3166_1', 'Jersey',                         'GB', 'none', null, null, null, 'Directive 2006/112/EC, article 6(1)(e), which names the Channel Islands'),
  ('IT-CAMPIONE',   'named',      'Campione d''Italia',             'IT', 'none', null, null, null, 'Directive 2006/112/EC, article 6(1)(f) since 1 January 2020 and article 6(2)(f) before it, the municipality having entered the customs territory of the Union under Directive (EU) 2019/475 without entering its VAT territory'),
  ('IT-LUGANO',     'named',      'Italian waters of Lake Lugano',  'IT', 'none', null, null, null, 'Directive 2006/112/EC, article 6(1)(g) since 1 January 2020 and article 6(2)(g) before it, under Directive (EU) 2019/475'),
  ('DE-HELIGOLAND', 'named',      'Island of Heligoland',           'DE', 'none', null, null, null, 'Directive 2006/112/EC, article 6(2)(a)'),
  ('DE-BUSINGEN',   'named',      'Territory of Büsingen',          'DE', 'none', null, null, null, 'Directive 2006/112/EC, article 6(2)(b)'),
  ('ES-CE',         'iso_3166_2', 'Ceuta',                          'ES', 'none', null, null, null, 'Directive 2006/112/EC, article 6(2)(c)'),
  ('ES-ML',         'iso_3166_2', 'Melilla',                        'ES', 'none', null, null, null, 'Directive 2006/112/EC, article 6(2)(d)'),
  ('IT-LIVIGNO',    'named',      'Livigno',                        'IT', 'none', null, null, null, 'Directive 2006/112/EC, article 6(2)(e)')
on conflict (code) do update set
  code_source     = excluded.code_source,
  name            = excluded.name,
  parent_code     = excluded.parent_code,
  eu_vat_scope    = excluded.eu_vat_scope,
  eu_vat_from     = excluded.eu_vat_from,
  eu_vat_to       = excluded.eu_vat_to,
  vat_prefix      = excluded.vat_prefix,
  legal_reference = excluded.legal_reference;
