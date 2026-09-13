-- Ekwo OS — five columns a pack fills and nothing reads yet, said out loud.
--
-- Each was added deliberately, with the same argument: the alternative is
-- migrating a table of years of rows a second time. That argument is sound and
-- none of them is removed here. What was missing is the sentence that tells a
-- reader of `docs/schema.md` which of them are load-bearing today and which
-- are a promise — because a column with a plausible name and no reader is read
-- as behaviour by whoever meets it next, and a pack author fills it expecting
-- something to happen.
--
-- Nothing changes but the comments, and `docs/schema.md` is generated from
-- them, so the doc says it too.
--
-- The one that has to become behaviour rather than stay documented is
-- `currencies.decimal_places`: "at the currency's decimals" is the rounding
-- rule this repository now states in `docs/decisions.md`, and every rounding
-- in the schema and in the three JavaScript copies is at two. That is right
-- for every currency the packs carry and wrong for the yen and the dinar. It
-- is its own sub-task and it is not this migration.

comment on column country_defaults.rounding_method is
  'How a country rounds a tax amount, from the pack. **Declared, no reader yet**: every rounding in the schema is round(x, 2), which is half_up, which is what both packs declare — so the column is recorded and not consulted. It becomes behaviour with the sub-task that makes rounding read the currency''s decimals.';

comment on column country_defaults.cash_rounding_unit is
  'The smallest coin a cash total is rounded to when it is not the cent — 0.05 in Switzerland, 0.05 in the Netherlands for cash. **Declared, no reader yet**: no cash-payment path exists in the socle, so nothing rounds a total to it. Zero means the cent, which is what both packs declare.';

comment on column country_defaults.bank_statement_formats is
  'Statement formats a bank of this country sends — coda, camt.053, cfonb120 — from the pack. **Declared, no reader yet**: the socle has no statement importer; this is what one will dispatch on. A client that offers an import today reads it to know what to offer.';

comment on column country_defaults.payment_formats is
  'Payment file formats a bank of this country accepts — pain.001, cfonb160 — from the pack. **Declared, no reader yet**: the socle writes no payment file. Same shape as bank_statement_formats, and it will be read by the same phase.';

comment on column currencies.decimal_places is
  'Decimals this currency is written with: 2 for the euro, 0 for the yen, 3 for the dinar. **Declared, no reader yet**: every rounding in the schema and in the format packages is at two decimals, which is right for every currency the packs carry. Making the rounding rule read this column is a sub-task of its own; until it lands, a zero-decimal currency is held correctly and rounded as if it had two.';

-- These two are the opposite case and are recorded here so that nobody
-- mistakes them for the list above: `reconcile()` writes them, `unreconcile()`
-- reads `fx_entry_id` to reverse the entry it points at, and the MCP server
-- returns both on a matching. They are read.
comment on column reconciliations.fx_entry_id is
  'The entry that booked the realised exchange difference this matching revealed, or null. Written by reconcile() and read by unreconcile(), which reverses it.';
