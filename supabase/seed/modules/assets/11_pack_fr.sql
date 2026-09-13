-- Ekwo OS — France: how this country depreciates and derecognises a fixed asset.
--
-- Generated from packs/fr/assets.json at version 1.6.0, do not edit.
-- Change the pack and run `ekwo pack build fr`; `ekwo pack check --all`
-- refuses a seed that is not the exact output of its pack, and the CI runs it.
--
-- Applied by the module migration runner — `ekwo migrate`, or `ekwo module
-- migrate` — and never by the socle seed step: these tables exist only on an
-- installation that carries the `assets` module.
--
-- The accounts a disposal lands on are not here. They are roles of the chart,
-- in `country_defaults`, written by the pack seed beside every other role.

insert into assets.country_rules
  (country, prorata_straight_line, prorata_declining, day_count,
   declining_cap_percent, declining_switch_to_linear, disposal_style, legal_reference)
values
  ('FR', 'days', 'months', 'thirty_360', null, true, 'gross', 'Règlement ANC 2014-03 (plan comptable général), art. 214-1 et suivants — l''amortissement commence à la date de mise en service ; l''annuité linéaire de l''exercice de mise en service est réduite prorata temporis, comptée en jours sur une année commerciale de trois cent soixante jours et des mois de trente jours. Code général des impôts, art. 39 A — amortissement dégressif : l''annuité de l''exercice d''acquisition court du premier jour du mois d''acquisition, et le régime est abandonné pour le linéaire dès que celui-ci donne une annuité supérieure.')
on conflict (country) do update set
  prorata_straight_line      = excluded.prorata_straight_line,
  prorata_declining          = excluded.prorata_declining,
  day_count                  = excluded.day_count,
  declining_cap_percent      = excluded.declining_cap_percent,
  declining_switch_to_linear = excluded.declining_switch_to_linear,
  disposal_style             = excluded.disposal_style,
  legal_reference            = excluded.legal_reference;

insert into assets.category_templates
  (country, code, name, name_i18n, method, duration_months, coefficient,
   prorata, account_type, sequence, legal_reference)
select v.country::char(2), v.code, v.name, v.name_i18n::jsonb,
       v.method::assets.depreciation_method, v.duration_months::integer,
       v.coefficient::numeric, v.prorata::assets.prorata_rule,
       v.account_type::account_type, v.sequence::integer, v.legal_reference
  from (values
    ('FR', 'software', 'Logiciels', '{"en":"Software"}'::jsonb, 'straight_line', 36, null, null, 'asset_fixed', 10, 'Durée d''usage de trois ans (BOI-BIC-AMT-10-40-10). L''amortissement exceptionnel sur douze mois des logiciels acquis est une option fiscale distincte, art. 236, II du code général des impôts.'),
    ('FR', 'building-commercial', 'Constructions à usage commercial', '{"en":"Commercial buildings"}'::jsonb, 'straight_line', 240, null, null, 'asset_fixed', 20, 'Durée d''usage des constructions : vingt à cinquante ans selon la nature du bâtiment (BOI-BIC-AMT-10-40-10). Vingt ans est la borne basse ; la durée retenue se justifie par l''utilisation attendue du bien (règlement ANC 2014-03, art. 214-1).'),
    ('FR', 'fixtures', 'Installations générales et agencements', '{"en":"General installations and fittings"}'::jsonb, 'straight_line', 120, null, null, 'asset_fixed', 30, 'Durée d''usage de dix ans pour les agencements et installations (BOI-BIC-AMT-10-40-10).'),
    ('FR', 'machinery', 'Matériel industriel', '{"en":"Industrial plant"}'::jsonb, 'straight_line', 120, null, null, 'asset_fixed', 40, 'Durée d''usage du matériel et de l''outillage : six ans et huit mois à dix ans (BOI-BIC-AMT-10-40-10). Dix ans est retenu ici.'),
    ('FR', 'machinery-declining', 'Matériel industriel — régime dégressif', '{"en":"Industrial plant — declining balance"}'::jsonb, 'declining_balance', 120, 2.25, null, 'asset_fixed', 50, 'Code général des impôts, art. 39 A, 1 — coefficient de 2,25 pour une durée normale d''utilisation supérieure à six ans, pour les biens acquis à compter du 1er janvier 2001. Le régime est réservé aux biens d''équipement énumérés par le texte.'),
    ('FR', 'furniture', 'Mobilier de bureau', '{"en":"Office furniture"}'::jsonb, 'straight_line', 120, null, null, 'asset_fixed', 60, 'Durée d''usage de dix ans pour le mobilier de bureau (BOI-BIC-AMT-10-40-10).'),
    ('FR', 'it-equipment', 'Matériel de bureau et matériel informatique', '{"en":"Office and computer equipment"}'::jsonb, 'straight_line', 36, null, null, 'asset_fixed', 70, 'Durée d''usage de trois ans pour le matériel informatique (BOI-BIC-AMT-10-40-10).'),
    ('FR', 'it-equipment-declining', 'Matériel informatique — régime dégressif', '{"en":"Computer equipment — declining balance"}'::jsonb, 'declining_balance', 36, 1.25, null, 'asset_fixed', 80, 'Code général des impôts, art. 39 A, 1 — coefficient de 1,25 pour une durée normale d''utilisation de trois ou quatre ans, pour les biens acquis à compter du 1er janvier 2001.'),
    ('FR', 'vehicle', 'Matériel de transport', '{"en":"Vehicles"}'::jsonb, 'straight_line', 60, null, null, 'asset_fixed', 90, 'Durée d''usage de quatre à cinq ans pour le matériel de transport (BOI-BIC-AMT-10-40-10) ; cinq ans est retenu. Les véhicules de tourisme sont exclus de l''amortissement dégressif (code général des impôts, art. 39 A) et leur base amortissable est plafonnée (art. 39, 4).')
  ) as v (country, code, name, name_i18n, method, duration_months, coefficient,
          prorata, account_type, sequence, legal_reference)
on conflict (country, code) do update set
  name            = excluded.name,
  name_i18n       = excluded.name_i18n,
  method          = excluded.method,
  duration_months = excluded.duration_months,
  coefficient     = excluded.coefficient,
  prorata         = excluded.prorata,
  account_type    = excluded.account_type,
  sequence        = excluded.sequence,
  legal_reference = excluded.legal_reference;

