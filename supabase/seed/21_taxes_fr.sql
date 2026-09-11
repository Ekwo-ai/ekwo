-- Ekwo OS — French VAT.
--
-- Rates: CGI art. 278 (20 %), 278-0 bis and 278 bis (5,5 % and 10 %), 281
-- quater and following (2,1 %).
--
-- The `declaration_box` values are the lines of form 3310-CA3. Base postings
-- point at the rate line (08, 9B, 09, 13) or at the non-taxable line; tax
-- postings point at the line that carries the amount of tax. Line 01 (ventes
-- et prestations) is the sum of the taxable bases and is derived by the
-- consumer of vat_return(), not stored twice here.
--
-- As with Belgium: a starting point to validate, and the place to change it.
-- Ledger accounts used: 445710 VAT collected, 445660 / 445662 deductible,
-- 445200 VAT due on intra-community acquisitions (PCG).

insert into tax_templates
  (country, code, name, description, amount_type, amount, applies_to, treatment,
   valid_from, legal_reference, vat_category, exemption_code, sequence)
values
  ('FR', 'FR-S-20',   'Vente 20 %',                    'Taux normal',                        'percent', 20,  'sale', 'domestic',            date '2014-01-01', 'CGI, art. 278',           'S',  null, 10),
  ('FR', 'FR-S-10',   'Vente 10 %',                    'Taux reduit',                        'percent', 10,  'sale', 'domestic',            date '2014-01-01', 'CGI, art. 278 bis',       'S',  null, 20),
  ('FR', 'FR-S-055',  'Vente 5,5 %',                   'Taux reduit',                        'percent', 5.5, 'sale', 'domestic',            date '2014-01-01', 'CGI, art. 278-0 bis',     'S',  null, 30),
  ('FR', 'FR-S-021',  'Vente 2,1 %',                   'Taux particulier',                   'percent', 2.1, 'sale', 'domestic',            date '2014-01-01', 'CGI, art. 281 quater',    'S',  null, 40),
  ('FR', 'FR-S-AL',   'Vente autoliquidation',         'TVA due par le preneur',             'percent', 0,   'sale', 'domestic_reverse_charge', date '2014-01-01', 'CGI, art. 283-2 nonies','AE', 'VATEX-EU-AE', 50),
  ('FR', 'FR-S-ICG',  'Livraison intracommunautaire',  'Biens, exoneree',                    'percent', 0,   'sale', 'intracom_goods',      date '1993-01-01', 'CGI, art. 262 ter I',     'K',  'VATEX-EU-IC', 60),
  ('FR', 'FR-S-ICS',  'Service intracommunautaire',    'Autoliquidation par le preneur',     'percent', 0,   'sale', 'intracom_services',   date '2010-01-01', 'CGI, art. 259-1',         'AE', 'VATEX-EU-AE', 70),
  ('FR', 'FR-S-EXP',  'Exportation hors UE',           'Exoneree',                           'percent', 0,   'sale', 'export',              date '1993-01-01', 'CGI, art. 262 I',         'G',  'VATEX-EU-G',  80),
  ('FR', 'FR-P-20',   'Achat 20 %',                    'Autres biens et services',           'percent', 20,  'purchase', 'domestic',        date '2014-01-01', 'CGI, art. 278',           'S',  null, 110),
  ('FR', 'FR-P-20-I', 'Achat immobilisation 20 %',     'Immobilisations',                    'percent', 20,  'purchase', 'domestic',        date '2014-01-01', 'CGI, art. 278',           'S',  null, 120),
  ('FR', 'FR-P-10',   'Achat 10 %',                    'Autres biens et services',           'percent', 10,  'purchase', 'domestic',        date '2014-01-01', 'CGI, art. 278 bis',       'S',  null, 130),
  ('FR', 'FR-P-055',  'Achat 5,5 %',                   'Autres biens et services',           'percent', 5.5, 'purchase', 'domestic',        date '2014-01-01', 'CGI, art. 278-0 bis',     'S',  null, 140),
  ('FR', 'FR-P-00',   'Achat exonere',                 'Sans TVA',                           'percent', 0,   'purchase', 'exempt',          date '1993-01-01', 'CGI, art. 261',           'E',  'VATEX-EU-132', 150),
  ('FR', 'FR-P-ICG-20','Acquisition intracom. biens 20 %','Autoliquidation, lignes 03/08/20','percent', 20,  'purchase', 'intracom_acquisition_goods',    date '1993-01-01', 'CGI, art. 256 bis', 'AE', 'VATEX-EU-AE', 160),
  ('FR', 'FR-P-ICS-20','Service intracom. recu 20 %',  'Autoliquidation, lignes 2A/08/20',   'percent', 20,  'purchase', 'intracom_acquisition_services', date '2010-01-01', 'CGI, art. 283-2',   'AE', 'VATEX-EU-AE', 170),
  ('FR', 'FR-P-AL-20','Achat autoliquidation 20 %',    'Assujetti non etabli, lignes 3C/08/20','percent',20, 'purchase', 'domestic_reverse_charge',       date '2014-01-01', 'CGI, art. 283-1',   'AE', 'VATEX-EU-AE', 180),
  ('FR', 'FR-P-IMP-20','Importation autoliquidee 20 %','Lignes 3A/08/20',                    'percent', 20,  'purchase', 'import',          date '2022-01-01', 'CGI, art. 293 A',         'S',  null, 190)
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
    -- Sales. A credit note reduces the same line, hence box_factor -100.
    ('FR-S-20',    'invoice',     'base',  100, null,     '08', 100, 10),
    ('FR-S-20',    'invoice',     'tax',   100, '445710', '08', 100, 20),
    ('FR-S-20',    'credit_note', 'base',  100, null,     '08', -100, 10),
    ('FR-S-20',    'credit_note', 'tax',   100, '445710', '08', -100, 20),
    ('FR-S-10',    'invoice',     'base',  100, null,     '9B', 100, 10),
    ('FR-S-10',    'invoice',     'tax',   100, '445710', '9B', 100, 20),
    ('FR-S-10',    'credit_note', 'base',  100, null,     '9B', -100, 10),
    ('FR-S-10',    'credit_note', 'tax',   100, '445710', '9B', -100, 20),
    ('FR-S-055',   'invoice',     'base',  100, null,     '09', 100, 10),
    ('FR-S-055',   'invoice',     'tax',   100, '445710', '09', 100, 20),
    ('FR-S-055',   'credit_note', 'base',  100, null,     '09', -100, 10),
    ('FR-S-055',   'credit_note', 'tax',   100, '445710', '09', -100, 20),
    ('FR-S-021',   'invoice',     'base',  100, null,     '13', 100, 10),
    ('FR-S-021',   'invoice',     'tax',   100, '445710', '13', 100, 20),
    ('FR-S-021',   'credit_note', 'base',  100, null,     '13', -100, 10),
    ('FR-S-021',   'credit_note', 'tax',   100, '445710', '13', -100, 20),
    ('FR-S-AL',    'invoice',     'base',  100, null,     '05', 100, 10),
    ('FR-S-AL',    'credit_note', 'base',  100, null,     '05', -100, 10),
    ('FR-S-ICG',   'invoice',     'base',  100, null,     '06', 100, 10),
    ('FR-S-ICG',   'credit_note', 'base',  100, null,     '06', -100, 10),
    ('FR-S-ICS',   'invoice',     'base',  100, null,     '05', 100, 10),
    ('FR-S-ICS',   'credit_note', 'base',  100, null,     '05', -100, 10),
    ('FR-S-EXP',   'invoice',     'base',  100, null,     '04', 100, 10),
    ('FR-S-EXP',   'credit_note', 'base',  100, null,     '04', -100, 10),

    -- Purchases. The base of a domestic purchase is not reported on the CA3,
    -- so it carries no box; only the deductible tax does (19 or 20).
    ('FR-P-20',    'invoice',     'tax',   100, '445660', '20', 100, 20),
    ('FR-P-20',    'credit_note', 'tax',   100, '445660', '20', -100, 20),
    ('FR-P-20-I',  'invoice',     'tax',   100, '445662', '19', 100, 20),
    ('FR-P-20-I',  'credit_note', 'tax',   100, '445662', '19', -100, 20),
    ('FR-P-10',    'invoice',     'tax',   100, '445660', '20', 100, 20),
    ('FR-P-10',    'credit_note', 'tax',   100, '445660', '20', -100, 20),
    ('FR-P-055',   'invoice',     'tax',   100, '445660', '20', 100, 20),
    ('FR-P-055',   'credit_note', 'tax',   100, '445660', '20', -100, 20),

    -- Self-assessment: base on its own line, tax due on the rate line, tax
    -- deducted on line 20. Neutral in the ledger, visible on the return.
    ('FR-P-ICG-20','invoice',     'base',  100, null,     '03', 100, 10),
    ('FR-P-ICG-20','invoice',     'tax',   100, '445660', '20', 100, 20),
    ('FR-P-ICG-20','invoice',     'tax',  -100, '445200', '08', 100, 30),
    ('FR-P-ICG-20','credit_note', 'base',  100, null,     '03', -100, 10),
    ('FR-P-ICG-20','credit_note', 'tax',   100, '445660', '20', -100, 20),
    ('FR-P-ICG-20','credit_note', 'tax',  -100, '445200', '08', -100, 30),
    ('FR-P-ICS-20','invoice',     'base',  100, null,     '2A', 100, 10),
    ('FR-P-ICS-20','invoice',     'tax',   100, '445660', '20', 100, 20),
    ('FR-P-ICS-20','invoice',     'tax',  -100, '445200', '08', 100, 30),
    ('FR-P-ICS-20','credit_note', 'base',  100, null,     '2A', -100, 10),
    ('FR-P-ICS-20','credit_note', 'tax',   100, '445660', '20', -100, 20),
    ('FR-P-ICS-20','credit_note', 'tax',  -100, '445200', '08', -100, 30),
    ('FR-P-AL-20', 'invoice',     'base',  100, null,     '3C', 100, 10),
    ('FR-P-AL-20', 'invoice',     'tax',   100, '445660', '20', 100, 20),
    ('FR-P-AL-20', 'invoice',     'tax',  -100, '445200', '08', 100, 30),
    ('FR-P-AL-20', 'credit_note', 'base',  100, null,     '3C', -100, 10),
    ('FR-P-AL-20', 'credit_note', 'tax',   100, '445660', '20', -100, 20),
    ('FR-P-AL-20', 'credit_note', 'tax',  -100, '445200', '08', -100, 30),
    ('FR-P-IMP-20','invoice',     'base',  100, null,     '3A', 100, 10),
    ('FR-P-IMP-20','invoice',     'tax',   100, '445660', '20', 100, 20),
    ('FR-P-IMP-20','invoice',     'tax',  -100, '445200', '08', 100, 30),
    ('FR-P-IMP-20','credit_note', 'base',  100, null,     '3A', -100, 10),
    ('FR-P-IMP-20','credit_note', 'tax',   100, '445660', '20', -100, 20),
    ('FR-P-IMP-20','credit_note', 'tax',  -100, '445200', '08', -100, 30)
  ) as v (tax_code, document_kind, posting_type, factor_percent, account_code,
          declaration_box, box_factor_percent, sequence)
  join tax_templates t on t.country = 'FR' and t.code = v.tax_code
on conflict (tax_template_id, document_kind, posting_type, sequence) do nothing;
