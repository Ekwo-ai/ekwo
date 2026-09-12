-- Ekwo OS — Belgian VAT.
--
-- Rates: Code de la TVA, art. 37 and AR n. 20 (21 % standard, 12 % and 6 %
-- reduced, 0 % for the goods of table A).
--
-- The `declaration_box` values are the boxes of the Intervat periodic return
-- (grilles 00 to 91). They are a working starting point, not a legal opinion:
-- check them against your own situation before filing, and change them here
-- rather than in application code — that is the whole point of tax_postings.
--
-- Ledger accounts used: 451000 VAT payable, 411000 VAT recoverable (PCMN).

insert into tax_templates
  (country, code, name, description, amount_type, amount, applies_to, treatment,
   valid_from, legal_reference, vat_category, exemption_code, sequence)
values
  -- Sales ------------------------------------------------------------------
  ('BE', 'BE-S-21',    'Vente 21 %',                       'Taux normal',                         'percent', 21, 'sale', 'domestic',              date '1996-01-01', 'AR n. 20, art. 1',        'S',  null, 10),
  ('BE', 'BE-S-12',    'Vente 12 %',                       'Taux reduit, tableau B',              'percent', 12, 'sale', 'domestic',              date '1996-01-01', 'AR n. 20, tableau B',     'S',  null, 20),
  ('BE', 'BE-S-06',    'Vente 6 %',                        'Taux reduit, tableau A',              'percent',  6, 'sale', 'domestic',              date '1996-01-01', 'AR n. 20, tableau A',     'S',  null, 30),
  ('BE', 'BE-S-00',    'Vente 0 %',                        'Taux zero',                           'percent',  0, 'sale', 'domestic',              date '1996-01-01', 'AR n. 20, tableau C',     'Z',  null, 40),
  ('BE', 'BE-S-CC',    'Vente cocontractant',              'TVA due par le cocontractant',        'percent',  0, 'sale', 'domestic_reverse_charge',date '1996-01-01', 'AR n. 1, art. 20',        'AE', 'VATEX-EU-AE', 50),
  ('BE', 'BE-S-ICG',   'Livraison intracommunautaire',     'Biens, exemptee',                     'percent',  0, 'sale', 'intracom_goods',        date '1993-01-01', 'Code TVA, art. 39bis',    'K',  'VATEX-EU-IC', 60),
  ('BE', 'BE-S-ICS',   'Service intracommunautaire',       'Autoliquidation par le preneur',      'percent',  0, 'sale', 'intracom_services',     date '2010-01-01', 'Code TVA, art. 21 par. 2','AE', 'VATEX-EU-AE', 70),
  ('BE', 'BE-S-EXP',   'Exportation hors UE',              'Exemptee',                            'percent',  0, 'sale', 'export',                date '1993-01-01', 'Code TVA, art. 39',       'G',  'VATEX-EU-G',  80),
  -- Purchases --------------------------------------------------------------
  ('BE', 'BE-P-21-G',  'Achat marchandises 21 %',          'Biens, grille 81',                    'percent', 21, 'purchase', 'domestic',          date '1996-01-01', 'AR n. 20, art. 1',        'S',  null, 110),
  ('BE', 'BE-P-21-S',  'Achat services 21 %',              'Services et biens divers, grille 82', 'percent', 21, 'purchase', 'domestic',          date '1996-01-01', 'AR n. 20, art. 1',        'S',  null, 120),
  ('BE', 'BE-P-21-I',  'Achat investissement 21 %',        'Biens d''investissement, grille 83',  'percent', 21, 'purchase', 'domestic',          date '1996-01-01', 'AR n. 20, art. 1',        'S',  null, 130),
  ('BE', 'BE-P-12-S',  'Achat services 12 %',              'Services et biens divers',            'percent', 12, 'purchase', 'domestic',          date '1996-01-01', 'AR n. 20, tableau B',     'S',  null, 140),
  ('BE', 'BE-P-06-G',  'Achat marchandises 6 %',           'Biens',                               'percent',  6, 'purchase', 'domestic',          date '1996-01-01', 'AR n. 20, tableau A',     'S',  null, 150),
  ('BE', 'BE-P-06-S',  'Achat services 6 %',               'Services et biens divers',            'percent',  6, 'purchase', 'domestic',          date '1996-01-01', 'AR n. 20, tableau A',     'S',  null, 160),
  ('BE', 'BE-P-00',    'Achat exonere',                    'Sans TVA',                            'percent',  0, 'purchase', 'exempt',            date '1993-01-01', 'Code TVA, art. 44',       'E',  'VATEX-EU-132', 170),
  ('BE', 'BE-P-ICG-21','Acquisition intracom. biens 21 %', 'Report de perception, grilles 86/55/59','percent',21,'purchase','intracom_acquisition_goods',   date '1993-01-01', 'Code TVA, art. 25ter', 'AE', 'VATEX-EU-AE', 180),
  ('BE', 'BE-P-ICS-21','Service intracom. recu 21 %',      'Report de perception, grilles 88/55/59','percent',21,'purchase','intracom_acquisition_services',date '2010-01-01', 'Code TVA, art. 51 par. 2','AE','VATEX-EU-AE', 190),
  ('BE', 'BE-P-CC-21', 'Achat cocontractant 21 %',         'Report de perception, grilles 87/56/59','percent',21,'purchase','domestic_reverse_charge',      date '1996-01-01', 'AR n. 1, art. 20',     'AE', 'VATEX-EU-AE', 200),
  ('BE', 'BE-P-IMP-21','Importation report de perception', 'Licence ET 14000, grilles 87/57/59',  'percent', 21, 'purchase', 'import',            date '1996-01-01', 'AR n. 7, art. 5',         'S',  null, 210)
on conflict (country, code) do nothing;


insert into tax_posting_templates
  (tax_template_id, document_kind, posting_type, factor_percent, account_code,
   declaration_box, box_factor_percent, sequence)
select t.id,
       v.document_kind::tax_document_kind,
       v.posting_type::tax_posting_type,
       v.factor_percent::numeric,
       v.account_code::text,
       v.declaration_box::text,
       v.box_factor_percent::numeric,
       v.sequence::integer
  from (values
    -- code,          kind,          type,   factor, account,  box,  box factor, seq
    -- Sales: base in 01/02/03, VAT due in 54. Credit notes: base 49, VAT 64.
    ('BE-S-21',    'invoice',     'base',  100, null,     '03', 100, 10),
    ('BE-S-21',    'invoice',     'tax',   100, '451000', '54', 100, 20),
    ('BE-S-21',    'credit_note', 'base',  100, null,     '49', 100, 10),
    ('BE-S-21',    'credit_note', 'tax',   100, '451000', '64', 100, 20),
    ('BE-S-12',    'invoice',     'base',  100, null,     '02', 100, 10),
    ('BE-S-12',    'invoice',     'tax',   100, '451000', '54', 100, 20),
    ('BE-S-12',    'credit_note', 'base',  100, null,     '49', 100, 10),
    ('BE-S-12',    'credit_note', 'tax',   100, '451000', '64', 100, 20),
    ('BE-S-06',    'invoice',     'base',  100, null,     '01', 100, 10),
    ('BE-S-06',    'invoice',     'tax',   100, '451000', '54', 100, 20),
    ('BE-S-06',    'credit_note', 'base',  100, null,     '49', 100, 10),
    ('BE-S-06',    'credit_note', 'tax',   100, '451000', '64', 100, 20),
    ('BE-S-00',    'invoice',     'base',  100, null,     '00', 100, 10),
    ('BE-S-00',    'credit_note', 'base',  100, null,     '49', 100, 10),
    ('BE-S-CC',    'invoice',     'base',  100, null,     '45', 100, 10),
    ('BE-S-CC',    'credit_note', 'base',  100, null,     '49', 100, 10),
    ('BE-S-ICG',   'invoice',     'base',  100, null,     '46', 100, 10),
    ('BE-S-ICG',   'credit_note', 'base',  100, null,     '48', 100, 10),
    ('BE-S-ICS',   'invoice',     'base',  100, null,     '44', 100, 10),
    ('BE-S-ICS',   'credit_note', 'base',  100, null,     '48', 100, 10),
    ('BE-S-EXP',   'invoice',     'base',  100, null,     '47', 100, 10),
    ('BE-S-EXP',   'credit_note', 'base',  100, null,     '49', 100, 10),

    -- Purchases: base in 81/82/83, deductible VAT in 59.
    -- Credit notes received: base 85, VAT to repay 63.
    ('BE-P-21-G',  'invoice',     'base',  100, null,     '81', 100, 10),
    ('BE-P-21-G',  'invoice',     'tax',   100, '411000', '59', 100, 20),
    ('BE-P-21-G',  'credit_note', 'base',  100, null,     '85', 100, 10),
    ('BE-P-21-G',  'credit_note', 'tax',   100, '411000', '63', 100, 20),
    ('BE-P-21-S',  'invoice',     'base',  100, null,     '82', 100, 10),
    ('BE-P-21-S',  'invoice',     'tax',   100, '411000', '59', 100, 20),
    ('BE-P-21-S',  'credit_note', 'base',  100, null,     '85', 100, 10),
    ('BE-P-21-S',  'credit_note', 'tax',   100, '411000', '63', 100, 20),
    ('BE-P-21-I',  'invoice',     'base',  100, null,     '83', 100, 10),
    ('BE-P-21-I',  'invoice',     'tax',   100, '411000', '59', 100, 20),
    ('BE-P-21-I',  'credit_note', 'base',  100, null,     '85', 100, 10),
    ('BE-P-21-I',  'credit_note', 'tax',   100, '411000', '63', 100, 20),
    ('BE-P-12-S',  'invoice',     'base',  100, null,     '82', 100, 10),
    ('BE-P-12-S',  'invoice',     'tax',   100, '411000', '59', 100, 20),
    ('BE-P-12-S',  'credit_note', 'base',  100, null,     '85', 100, 10),
    ('BE-P-12-S',  'credit_note', 'tax',   100, '411000', '63', 100, 20),
    ('BE-P-06-G',  'invoice',     'base',  100, null,     '81', 100, 10),
    ('BE-P-06-G',  'invoice',     'tax',   100, '411000', '59', 100, 20),
    ('BE-P-06-G',  'credit_note', 'base',  100, null,     '85', 100, 10),
    ('BE-P-06-G',  'credit_note', 'tax',   100, '411000', '63', 100, 20),
    ('BE-P-06-S',  'invoice',     'base',  100, null,     '82', 100, 10),
    ('BE-P-06-S',  'invoice',     'tax',   100, '411000', '59', 100, 20),
    ('BE-P-06-S',  'credit_note', 'base',  100, null,     '85', 100, 10),
    ('BE-P-06-S',  'credit_note', 'tax',   100, '411000', '63', 100, 20),
    ('BE-P-00',    'invoice',     'base',  100, null,     '82', 100, 10),
    ('BE-P-00',    'credit_note', 'base',  100, null,     '85', 100, 10),

    -- Self-assessment. The positive factor keeps the side of the base and
    -- debits the recoverable account; the negative one flips the side and
    -- credits the payable account. The two net to zero in the ledger, and
    -- both boxes are still filled: the return and the ledger agree.
    ('BE-P-ICG-21','invoice',     'base',  100, null,     '86', 100, 10),
    ('BE-P-ICG-21','invoice',     'tax',   100, '411000', '59', 100, 20),
    ('BE-P-ICG-21','invoice',     'tax',  -100, '451000', '55', 100, 30),
    ('BE-P-ICG-21','credit_note', 'base',  100, null,     '84', 100, 10),
    ('BE-P-ICG-21','credit_note', 'tax',   100, '411000', '62', 100, 20),
    ('BE-P-ICG-21','credit_note', 'tax',  -100, '451000', '63', 100, 30),
    ('BE-P-ICS-21','invoice',     'base',  100, null,     '88', 100, 10),
    ('BE-P-ICS-21','invoice',     'tax',   100, '411000', '59', 100, 20),
    ('BE-P-ICS-21','invoice',     'tax',  -100, '451000', '55', 100, 30),
    ('BE-P-ICS-21','credit_note', 'base',  100, null,     '84', 100, 10),
    ('BE-P-ICS-21','credit_note', 'tax',   100, '411000', '62', 100, 20),
    ('BE-P-ICS-21','credit_note', 'tax',  -100, '451000', '63', 100, 30),
    ('BE-P-CC-21', 'invoice',     'base',  100, null,     '87', 100, 10),
    ('BE-P-CC-21', 'invoice',     'tax',   100, '411000', '59', 100, 20),
    ('BE-P-CC-21', 'invoice',     'tax',  -100, '451000', '56', 100, 30),
    ('BE-P-CC-21', 'credit_note', 'base',  100, null,     '85', 100, 10),
    ('BE-P-CC-21', 'credit_note', 'tax',   100, '411000', '62', 100, 20),
    ('BE-P-CC-21', 'credit_note', 'tax',  -100, '451000', '63', 100, 30),
    ('BE-P-IMP-21','invoice',     'base',  100, null,     '87', 100, 10),
    ('BE-P-IMP-21','invoice',     'tax',   100, '411000', '59', 100, 20),
    ('BE-P-IMP-21','invoice',     'tax',  -100, '451000', '57', 100, 30),
    ('BE-P-IMP-21','credit_note', 'base',  100, null,     '85', 100, 10),
    ('BE-P-IMP-21','credit_note', 'tax',   100, '411000', '62', 100, 20),
    ('BE-P-IMP-21','credit_note', 'tax',  -100, '451000', '63', 100, 30)
  ) as v (tax_code, document_kind, posting_type, factor_percent, account_code,
          declaration_box, box_factor_percent, sequence)
  join tax_templates t on t.country = 'BE' and t.code = v.tax_code
on conflict (tax_template_id, document_kind, posting_type, sequence) do nothing;
