-- Ekwo OS — where the disposal of a fixed asset lands, per country.
--
-- Four nullable columns on `country_defaults`, for the `assets` module to
-- read. They are in the socle and not in the module's own schema on purpose: a
-- role is the answer to "which account of this chart plays this part", and
-- `country_defaults` is the one place a pack answers it. A second roles table
-- per module would be a second source of truth for the same question — and
-- `ekwo pack check`, which already refuses a pack whose role codes are not in
-- *every* chart it ships, would not be checking the second one.
--
-- **There are four and not two, because two countries derecognise an asset
-- differently and neither is a variant of the other.**
--
--   `net_result`  the asset and its accumulated depreciation are cleared, the
--                 proceeds are booked, and the difference lands on one account
--                 — a gain or a loss. Belgium: 763 and 663, which is how the
--                 statutory income statement presents a *plus-value* or a
--                 *moins-value de réalisation*.
--   `gross`       the net book value is booked as a charge and the proceeds as
--                 an income, both in full, and the result is the difference
--                 between two lines the income statement prints separately.
--                 France: 675 *valeurs comptables des éléments d'actif cédés*
--                 and 775 *produits des cessions d'éléments d'actif*.
--
-- Which of the two a country follows is not a role, it is a mechanism, and it
-- lives with the rest of the module's country model in
-- `assets.country_rules` — the same division `closing_style` made between the
-- style and the accounts that style needs.
--
-- **None of the four carries a default.** A pack that says nothing about
-- disposals leaves them null and `assets.dispose_asset` refuses by name,
-- rather than booking a gain on the account another country happens to use.

alter table country_defaults
  add column if not exists asset_disposal_gain_code     text,
  add column if not exists asset_disposal_loss_code     text,
  add column if not exists asset_disposal_proceeds_code text,
  add column if not exists asset_disposal_value_code    text;

comment on column country_defaults.asset_disposal_gain_code is
  'Net-result disposal: the account a gain on the disposal of a fixed asset lands on (Belgium 763). Null under the gross style, and null until a pack names one.';
comment on column country_defaults.asset_disposal_loss_code is
  'Net-result disposal: the account a loss lands on (Belgium 663). Left empty where the chart keeps one account for both signs, and then the gain account answers for both.';
comment on column country_defaults.asset_disposal_proceeds_code is
  'Gross disposal: the income account the proceeds of a sale are booked on in full (France 775). Null under the net-result style.';
comment on column country_defaults.asset_disposal_value_code is
  'Gross disposal: the charge account the net book value of the asset sold is booked on in full (France 675). Null under the net-result style.';
