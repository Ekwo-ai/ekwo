-- Ekwo OS — one natural key for tax posting templates.
--
-- `tax_posting_templates` had a surrogate primary key and a partial unique
-- index on the base line only, so re-applying a seed inserted every tax line
-- a second time and then failed on the base. Found on the first real
-- installation, when `ekwo init` was run twice on the same project.
--
-- A posting template is identified by the tax, the kind of document, the
-- posting type and its sequence. Making that a unique index gives the seeds a
-- conflict target and makes them idempotent, which `supabase/seed/README.md`
-- had promised all along.

create unique index tax_posting_templates_natural_key_idx
  on tax_posting_templates (tax_template_id, document_kind, posting_type, sequence);

comment on index tax_posting_templates_natural_key_idx is
  'The natural key of a posting template; the conflict target of the seeds.';
