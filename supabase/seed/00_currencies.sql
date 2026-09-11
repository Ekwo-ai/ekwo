-- Ekwo OS — currencies. ISO 4217, the handful a European ledger meets.

insert into currencies (code, name, symbol, decimal_places) values
  ('EUR', 'Euro',                 E'€', 2),
  ('USD', 'US dollar',            '$',       2),
  ('GBP', 'Pound sterling',       E'£', 2),
  ('CHF', 'Swiss franc',          'CHF',     2),
  ('SEK', 'Swedish krona',        'kr',      2),
  ('DKK', 'Danish krone',         'kr',      2),
  ('NOK', 'Norwegian krone',      'kr',      2),
  ('PLN', 'Polish zloty',         E'z\u0142', 2),
  ('CZK', 'Czech koruna',         E'Kč', 2),
  ('CAD', 'Canadian dollar',      '$',       2),
  ('JPY', 'Japanese yen',         E'¥', 0)
on conflict (code) do nothing;
