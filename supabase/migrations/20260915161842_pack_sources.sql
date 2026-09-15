-- Ekwo OS — where a country's rules come from, in the database that applies them.
--
-- `legal_reference` has been required on every tax and every box of every
-- declaration form since country packs existed, and `certification.sources`
-- listed the texts a pack as a whole was built from. Between them they said
-- which article a rule claims and which laws somebody read. What neither said
-- is where any of it can be opened: the manifest held titles and no link, the
-- rules held articles and no link, and an application that wanted to answer
-- "where do these rules come from" had a citation and a search engine.
--
-- `packs/<cc>/pack.json` now carries a register — a key, a title, the official
-- publisher, an absolute https URL and the day somebody opened it, per text —
-- and every tax and every box names a key of it beside the article it already
-- carried. Three columns bring that here:
--
--   `country_packs.sources`              the register itself, in the order the
--                                        pack declares it. What an application
--                                        shows beside a chart of accounts.
--   `tax_templates.source_key`           which text of that register the tax's
--                                        legal reference is in.
--   `tax_report_box_templates.source_key`  the same, per box of the form.
--
-- Additive: three nullable columns, no constraint, no backfill. The value is
-- the pack's, and the compiled seed of every country upserts these tables, so
-- re-applying the seeds is what fills them on an installation that already
-- exists. Writing a URL for a country in a migration would put a country back
-- into the core, which is the one thing the pack format exists to prevent.
--
-- The key is deliberately *not* a foreign key onto anything. The register
-- lives in a jsonb column of another table and a pack is upserted one
-- statement at a time; a constraint between the two would fail on the order
-- the seed happens to write them in, and would say nothing an inconsistent
-- pack does not already say. `ekwo pack check` refuses a key the register does
-- not carry, which is where that check belongs: before the seed is written.

alter table country_packs
  add column if not exists sources jsonb not null default '[]'::jsonb;

comment on column country_packs.sources is
  'Register of the texts this pack was built from, in the pack''s own order: [{key, title, publisher, url, consulted_on, kind}]. `kind` is one of law, regulation, form, standard, portal, guidance. Written by the generated seed; never a copy of the text itself.';

alter table tax_templates
  add column if not exists source_key text;

comment on column tax_templates.source_key is
  'Key of the entry in country_packs.sources where this tax''s legal_reference can be read. Null where the pack names none.';

alter table tax_report_box_templates
  add column if not exists source_key text;

comment on column tax_report_box_templates.source_key is
  'Key of the entry in country_packs.sources where this box''s legal_reference can be read. Null where the pack names none.';

-- No object is created and no function is added, so there is nothing to grant
-- and nothing to revoke: a column added to a table is reachable by whoever
-- could already select that table, under the policies it already has.
