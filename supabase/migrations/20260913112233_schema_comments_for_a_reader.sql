-- Ekwo OS — schema comments that a reader outside the project can read.
--
-- `comment on` is the schema's documentation: it is what `docs/schema.md` is
-- generated from and what an assistant reads over the API. Five of those
-- comments named a milestone of the project's own plan — "column only until
-- P0-6" — which tells somebody reading the schema for the first time nothing
-- at all, and which two of them had also outlived: cash-basis VAT has been
-- implemented since, so a comment saying a column had no reader was simply
-- false.
--
-- Nothing changes in the schema itself. A comment is replaced, not added, so
-- this migration is safe to apply to an installation of any age.

comment on column tax_postings.report_code is
  'Declaration form the box belongs to. Copied from the template, and read by vat_return(company, from, to, report_code) to pick out the boxes of one form where a country files more than one.';

comment on column tax_templates.cash_basis is
  'The tax falls due when the invoice is paid rather than when it is issued, which is how France taxes services. post_document() books it on the transition account below and on no declaration box; reconcile() moves the settled share to the account and the box it is declared on.';

comment on column tax_templates.cash_basis_transition_account_code is
  'Account the tax waits on between the invoice and its payment, by code in the chart of this country. Only read when cash_basis is true.';

comment on column taxes.cash_basis is
  'The tax falls due when the invoice is paid rather than when it is issued. The share that has been settled is what reaches the declaration.';

comment on column taxes.cash_basis_transition_account_id is
  'Account the tax waits on between the invoice and its payment. Only read when cash_basis is true.';
