-- Ekwo OS — Belgium: how this country depreciates and derecognises a fixed asset.
--
-- Generated from packs/be/assets.json at version 1.5.0, do not edit.
-- Change the pack and run `ekwo pack build be`; `ekwo pack check --all`
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
  ('BE', 'days', 'days', 'actual', 40, true, 'net_result', 'Code des impôts sur les revenus 1992, art. 61 — les amortissements sont admis dans la mesure où ils correspondent à une dépréciation réellement survenue ; art. 196, § 2, 1° — l''annuité de l''exercice d''acquisition est réduite au prorata de la partie de l''exercice restant à courir, pour les sociétés autres que les petites sociétés au sens de l''art. 1:24 du Code des sociétés et des associations ; art. 64 et AR/CIR 92, art. 36 à 43 — régime dégressif, annuité limitée à 40 % de la valeur d''investissement et abandon du dégressif dès que l''annuité linéaire est supérieure')
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
    ('BE', 'formation-expenses', 'Frais d''établissement', '{"de":"Gründungskosten","en":"Formation expenses","nl":"Oprichtingskosten"}'::jsonb, 'straight_line', 60, null, null, 'asset_fixed', 10, 'Code des impôts sur les revenus 1992, art. 62 — les frais d''établissement sont amortis par annuités égales, échelonnées sans interruption sur cinq ans au moins'),
    ('BE', 'intangible-rd', 'Frais de recherche et de développement', '{"de":"Forschungs- und Entwicklungskosten","en":"Research and development costs","nl":"Kosten van onderzoek en ontwikkeling"}'::jsonb, 'straight_line', 36, null, null, 'asset_fixed', 20, 'Code des impôts sur les revenus 1992, art. 63 — immobilisations incorporelles amorties par annuités fixes sur trois ans au moins pour les investissements en recherche et développement'),
    ('BE', 'software', 'Logiciels, concessions, brevets et licences', '{"de":"Software, Konzessionen, Patente und Lizenzen","en":"Software, concessions, patents and licences","nl":"Software, concessies, octrooien en licenties"}'::jsonb, 'straight_line', 60, null, null, 'asset_fixed', 30, 'Code des impôts sur les revenus 1992, art. 63 — immobilisations incorporelles autres que la recherche et le développement, amorties par annuités fixes sur cinq ans au moins'),
    ('BE', 'building-industrial', 'Bâtiments industriels', '{"de":"Industriegebäude","en":"Industrial buildings","nl":"Industriële gebouwen"}'::jsonb, 'straight_line', 240, null, null, 'asset_fixed', 40, 'Code des impôts sur les revenus 1992, art. 61 ; durée usuellement admise par l''administration pour un bâtiment industriel — vingt ans, soit 5 % l''an. Une durée usuelle est une pratique administrative et non un texte : elle se justifie par la dépréciation réelle du bien.'),
    ('BE', 'building-commercial', 'Bâtiments commerciaux et de bureaux', '{"de":"Geschäfts- und Bürogebäude","en":"Commercial and office buildings","nl":"Handels- en kantoorgebouwen"}'::jsonb, 'straight_line', 396, null, null, 'asset_fixed', 50, 'Code des impôts sur les revenus 1992, art. 61 ; durée usuellement admise par l''administration pour un bâtiment commercial ou de bureaux — trente-trois ans, soit 3 % l''an. Pratique administrative, à justifier par la dépréciation réelle du bien.'),
    ('BE', 'machinery', 'Installations, machines et outillage', '{"de":"Anlagen, Maschinen und Werkzeuge","en":"Plant, machinery and equipment","nl":"Installaties, machines en uitrusting"}'::jsonb, 'straight_line', 120, null, null, 'asset_fixed', 60, 'Code des impôts sur les revenus 1992, art. 61 ; durée usuellement admise — dix ans, soit 10 % l''an. Pratique administrative.'),
    ('BE', 'machinery-declining', 'Installations, machines et outillage — régime dégressif', '{"de":"Anlagen, Maschinen und Werkzeuge — degressive Abschreibung","en":"Plant, machinery and equipment — declining balance","nl":"Installaties, machines en uitrusting — degressief stelsel"}'::jsonb, 'declining_balance', 120, 2, null, 'asset_fixed', 70, 'Code des impôts sur les revenus 1992, art. 64 et AR/CIR 92, art. 36 à 43 — taux double du taux linéaire, annuité plafonnée à 40 % de la valeur d''investissement, retour au linéaire dès qu''il donne une annuité supérieure. Le régime est exclu pour les immobilisations incorporelles et pour les biens dont l''usage est cédé à un tiers (art. 64, al. 2).'),
    ('BE', 'furniture', 'Mobilier', '{"de":"Mobiliar","en":"Furniture","nl":"Meubilair"}'::jsonb, 'straight_line', 120, null, null, 'asset_fixed', 80, 'Code des impôts sur les revenus 1992, art. 61 ; durée usuellement admise — dix ans, soit 10 % l''an. Pratique administrative.'),
    ('BE', 'it-equipment', 'Matériel de bureau et matériel informatique', '{"de":"Büro- und EDV-Ausstattung","en":"Office and computer equipment","nl":"Kantoormaterieel en informaticamaterieel"}'::jsonb, 'straight_line', 36, null, null, 'asset_fixed', 90, 'Code des impôts sur les revenus 1992, art. 61 ; durée usuellement admise pour le matériel informatique — trois ans, soit 33 % l''an. Pratique administrative.'),
    ('BE', 'vehicle', 'Matériel roulant', '{"de":"Fuhrpark","en":"Vehicles","nl":"Rollend materieel"}'::jsonb, 'straight_line', 60, null, null, 'asset_fixed', 100, 'Code des impôts sur les revenus 1992, art. 61 ; durée usuellement admise — cinq ans, soit 20 % l''an. Pratique administrative. La déductibilité des frais de voiture est une question distincte de la durée d''amortissement (art. 66 et 198bis).')
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

