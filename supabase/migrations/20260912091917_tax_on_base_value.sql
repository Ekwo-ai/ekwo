-- Ekwo OS — a tax posting that lands on the account of the line it taxes.
--
-- `tax_posting_type` had two values: `base`, which is the line itself and
-- carries no account, and `tax`, which carries one. Neither can express the
-- most ordinary purchase invoice a Belgian or a French company receives: one
-- where part of the VAT is not deductible. A company car at 21 % gives 50 %
-- on the deductible VAT account and 50 % on the expense account, because
-- non-deductible VAT is not a receivable from the State — it is a cost, and
-- it follows the account of what was bought (CNC/CBN avis 2018/14, *accessorium
-- sequitur principale*; in France PCG art. 213-8 and BOI-BIC-CHG-20-20-10,
-- where a non-recoverable tax is part of the acquisition cost).
--
-- So a third value: `tax_on_base`. Like `base`, it carries no account, and
-- for the same reason — the account it lands on is the one the document line
-- names. Unlike `base`, its amount is a share of the *tax*, not of the base.
--
-- This is a file of its own because PostgreSQL refuses to use an enum value
-- in the transaction that added it, and the next migration writes it into a
-- check constraint. The same reason split `20260912081014` from
-- `20260912081015`; the rule is in `supabase/migrations/README.md`.

alter type tax_posting_type add value if not exists 'tax_on_base';

comment on type tax_posting_type is
  'base: the line itself, no account. tax: an amount on a tax account. tax_on_base: a share of the tax posted on the account of the line, because it is a cost and not a claim on the State.';
