-- Ekwo OS — United Kingdom: how this country depreciates and derecognises a fixed asset.
--
-- Generated from packs/gb/assets.json at version 0.2.0, do not edit.
-- Change the pack and run `ekwo pack build gb`; `ekwo pack check --all`
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
  ('GB', 'months', 'months', 'actual', null, true, 'net_result', 'FRS 102 The Financial Reporting Standard applicable in the UK and Republic of Ireland, Section 17 Property, Plant and Equipment — depreciation begins when the asset is available for use, so a charge is taken from the month the asset is brought into use rather than for the whole of the first year; the standard prescribes no method, and the straight line and the reducing balance are both named among those an entity may select. Nothing in British law caps an annuity, which is why no cap is declared here.')
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
    ('GB', 'goodwill', 'Goodwill', '{}'::jsonb, 'straight_line', 120, null, null, 'asset_fixed', 10, 'FRS 102, Section 19 — goodwill is amortised over its useful life, and where that cannot be reliably estimated the life shall not exceed ten years. Ten years is therefore the ceiling this category starts from and not a life anybody estimated. There is no legal or fiscal table of useful lives in the United Kingdom. FRS 102, Section 17, paragraphs 17.16 to 17.21 require the depreciable amount of an item of property, plant and equipment to be allocated on a systematic basis over its useful life, which the entity reviews and estimates for itself; capital allowances under the capital allowances legislation are a tax computation and are never the accounting charge. The duration below is therefore common British practice and not a rule, and an asset that depreciates differently says so in its own columns.'),
    ('GB', 'intangibles', 'Other intangible assets, patents and licences', '{}'::jsonb, 'straight_line', 60, null, null, 'asset_fixed', 20, 'FRS 102, Section 18 — an intangible asset with a finite useful life is amortised over it, with the same ten-year ceiling where the life cannot be estimated. There is no legal or fiscal table of useful lives in the United Kingdom. FRS 102, Section 17, paragraphs 17.16 to 17.21 require the depreciable amount of an item of property, plant and equipment to be allocated on a systematic basis over its useful life, which the entity reviews and estimates for itself; capital allowances under the capital allowances legislation are a tax computation and are never the accounting charge. The duration below is therefore common British practice and not a rule, and an asset that depreciates differently says so in its own columns.'),
    ('GB', 'freehold-buildings', 'Freehold buildings', '{}'::jsonb, 'straight_line', 600, null, null, 'asset_fixed', 30, 'Land is not depreciated and the building on it is, so a freehold property is split before this category is applied to the part that has a life. There is no legal or fiscal table of useful lives in the United Kingdom. FRS 102, Section 17, paragraphs 17.16 to 17.21 require the depreciable amount of an item of property, plant and equipment to be allocated on a systematic basis over its useful life, which the entity reviews and estimates for itself; capital allowances under the capital allowances legislation are a tax computation and are never the accounting charge. The duration below is therefore common British practice and not a rule, and an asset that depreciates differently says so in its own columns.'),
    ('GB', 'leasehold-improvements', 'Leasehold property and improvements', '{}'::jsonb, 'straight_line', 120, null, null, 'asset_fixed', 40, 'Common practice depreciates a leasehold improvement over the shorter of its own life and the remaining term of the lease, which is a fact about the lease and not about the category. There is no legal or fiscal table of useful lives in the United Kingdom. FRS 102, Section 17, paragraphs 17.16 to 17.21 require the depreciable amount of an item of property, plant and equipment to be allocated on a systematic basis over its useful life, which the entity reviews and estimates for itself; capital allowances under the capital allowances legislation are a tax computation and are never the accounting charge. The duration below is therefore common British practice and not a rule, and an asset that depreciates differently says so in its own columns.'),
    ('GB', 'plant-and-machinery', 'Plant and machinery', '{}'::jsonb, 'straight_line', 120, null, null, 'asset_fixed', 50, 'There is no legal or fiscal table of useful lives in the United Kingdom. FRS 102, Section 17, paragraphs 17.16 to 17.21 require the depreciable amount of an item of property, plant and equipment to be allocated on a systematic basis over its useful life, which the entity reviews and estimates for itself; capital allowances under the capital allowances legislation are a tax computation and are never the accounting charge. The duration below is therefore common British practice and not a rule, and an asset that depreciates differently says so in its own columns.'),
    ('GB', 'fixtures-and-fittings', 'Fixtures and fittings', '{}'::jsonb, 'straight_line', 120, null, null, 'asset_fixed', 60, 'There is no legal or fiscal table of useful lives in the United Kingdom. FRS 102, Section 17, paragraphs 17.16 to 17.21 require the depreciable amount of an item of property, plant and equipment to be allocated on a systematic basis over its useful life, which the entity reviews and estimates for itself; capital allowances under the capital allowances legislation are a tax computation and are never the accounting charge. The duration below is therefore common British practice and not a rule, and an asset that depreciates differently says so in its own columns.'),
    ('GB', 'office-equipment', 'Office equipment', '{}'::jsonb, 'straight_line', 60, null, null, 'asset_fixed', 70, 'There is no legal or fiscal table of useful lives in the United Kingdom. FRS 102, Section 17, paragraphs 17.16 to 17.21 require the depreciable amount of an item of property, plant and equipment to be allocated on a systematic basis over its useful life, which the entity reviews and estimates for itself; capital allowances under the capital allowances legislation are a tax computation and are never the accounting charge. The duration below is therefore common British practice and not a rule, and an asset that depreciates differently says so in its own columns.'),
    ('GB', 'computer-equipment', 'Computer equipment', '{}'::jsonb, 'straight_line', 36, null, null, 'asset_fixed', 80, 'There is no legal or fiscal table of useful lives in the United Kingdom. FRS 102, Section 17, paragraphs 17.16 to 17.21 require the depreciable amount of an item of property, plant and equipment to be allocated on a systematic basis over its useful life, which the entity reviews and estimates for itself; capital allowances under the capital allowances legislation are a tax computation and are never the accounting charge. The duration below is therefore common British practice and not a rule, and an asset that depreciates differently says so in its own columns.'),
    ('GB', 'motor-vehicles', 'Motor vehicles, straight line', '{}'::jsonb, 'straight_line', 48, null, null, 'asset_fixed', 90, 'There is no legal or fiscal table of useful lives in the United Kingdom. FRS 102, Section 17, paragraphs 17.16 to 17.21 require the depreciable amount of an item of property, plant and equipment to be allocated on a systematic basis over its useful life, which the entity reviews and estimates for itself; capital allowances under the capital allowances legislation are a tax computation and are never the accounting charge. The duration below is therefore common British practice and not a rule, and an asset that depreciates differently says so in its own columns.'),
    ('GB', 'motor-vehicles-reducing', 'Motor vehicles, reducing balance at 25 %', '{}'::jsonb, 'declining_balance', 96, 2, null, 'asset_fixed', 100, 'Twice the straight-line rate of an eight-year life is 25 per cent a year, which is the reducing-balance rate British practice applies to a car most often. There is no legal or fiscal table of useful lives in the United Kingdom. FRS 102, Section 17, paragraphs 17.16 to 17.21 require the depreciable amount of an item of property, plant and equipment to be allocated on a systematic basis over its useful life, which the entity reviews and estimates for itself; capital allowances under the capital allowances legislation are a tax computation and are never the accounting charge. The duration below is therefore common British practice and not a rule, and an asset that depreciates differently says so in its own columns.')
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

