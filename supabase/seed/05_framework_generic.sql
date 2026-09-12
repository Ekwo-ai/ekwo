-- Ekwo OS — Generic framework: financial statements by account type, for any chart of any country.
--
-- Generated from packs/generic at version 1.1.0, do not edit.
-- Change the pack and run `ekwo pack build generic`; `ekwo pack check --all`
-- refuses a seed that is not the exact output of its pack, and the CI runs it.
--
-- Maintained by Ekwo — not yet reviewed by an accountant.
-- Written from:
--   IFRS for SMEs Accounting Standard (2015), section 4 — Statement of Financial Position
--   IFRS for SMEs Accounting Standard (2015), section 5 — Statement of Comprehensive Income
--
-- Reference data with no country and no chart: `financial_statement()` reads it
-- directly, and nothing here is copied into a company.

insert into statement_templates
  (code, country, chart_code, name, kind, framework, valid_from, valid_to, legal_reference)
values
  ('IFRS-SME-BS', null, null, 'Statement of financial position', 'balance_sheet', 'IFRS-SME', date '1970-01-01', null, 'IFRS for SMEs, section 4'),
  ('IFRS-SME-IS', null, null, 'Income statement', 'income_statement', 'IFRS-SME', date '1970-01-01', null, 'IFRS for SMEs, section 5')
on conflict (code) do update set
  country         = excluded.country,
  chart_code      = excluded.chart_code,
  name            = excluded.name,
  kind            = excluded.kind,
  framework       = excluded.framework,
  valid_from      = excluded.valid_from,
  valid_to        = excluded.valid_to,
  legal_reference = excluded.legal_reference;

insert into statement_line_templates
  (statement_code, code, parent_code, name, name_i18n, sequence, sign, is_total,
   plus_lines, minus_lines, xbrl_element, legal_reference)
values
  ('IFRS-SME-BS', 'A-NC-FIX', 'A-NC', 'Property, plant, equipment and intangible assets', '{}'::jsonb, 10, 1, false, '{}'::text[], '{}'::text[], null, null),
  ('IFRS-SME-BS', 'A-NC-OTH', 'A-NC', 'Other non-current assets', '{}'::jsonb, 20, 1, false, '{}'::text[], '{}'::text[], null, null),
  ('IFRS-SME-BS', 'A-NC', null, 'Non-current assets', '{}'::jsonb, 30, 1, true, array['A-NC-FIX', 'A-NC-OTH']::text[], '{}'::text[], null, null),
  ('IFRS-SME-BS', 'A-C-REC', 'A-C', 'Trade and other receivables', '{}'::jsonb, 40, 1, false, '{}'::text[], '{}'::text[], null, null),
  ('IFRS-SME-BS', 'A-C-OTH', 'A-C', 'Inventories, prepayments and other current assets', '{}'::jsonb, 50, 1, false, '{}'::text[], '{}'::text[], null, null),
  ('IFRS-SME-BS', 'A-C-CASH', 'A-C', 'Cash and cash equivalents', '{}'::jsonb, 60, 1, false, '{}'::text[], '{}'::text[], null, null),
  ('IFRS-SME-BS', 'A-C', null, 'Current assets', '{}'::jsonb, 70, 1, true, array['A-C-REC', 'A-C-OTH', 'A-C-CASH']::text[], '{}'::text[], null, null),
  ('IFRS-SME-BS', 'A-TOT', null, 'Total assets', '{}'::jsonb, 80, 1, true, array['A-NC', 'A-C']::text[], '{}'::text[], null, null),
  ('IFRS-SME-BS', 'E-CAP', 'E-TOT', 'Capital and reserves', '{}'::jsonb, 90, -1, false, '{}'::text[], '{}'::text[], null, null),
  ('IFRS-SME-BS', 'E-RET', 'E-TOT', 'Retained earnings', '{}'::jsonb, 100, -1, false, '{}'::text[], '{}'::text[], null, null),
  ('IFRS-SME-BS', 'E-RESULT', 'E-TOT', 'Result for the period, not yet allocated', '{}'::jsonb, 105, -1, false, '{}'::text[], '{}'::text[], null, null),
  ('IFRS-SME-BS', 'E-TOT', null, 'Total equity', '{}'::jsonb, 110, 1, true, array['E-CAP', 'E-RET', 'E-RESULT']::text[], '{}'::text[], null, null),
  ('IFRS-SME-BS', 'L-NC', 'L-TOT', 'Non-current liabilities', '{}'::jsonb, 120, -1, false, '{}'::text[], '{}'::text[], null, null),
  ('IFRS-SME-BS', 'L-C-PAY', 'L-C', 'Trade and other payables', '{}'::jsonb, 130, -1, false, '{}'::text[], '{}'::text[], null, null),
  ('IFRS-SME-BS', 'L-C-OTH', 'L-C', 'Other current liabilities', '{}'::jsonb, 140, -1, false, '{}'::text[], '{}'::text[], null, null),
  ('IFRS-SME-BS', 'L-C', null, 'Current liabilities', '{}'::jsonb, 150, 1, true, array['L-C-PAY', 'L-C-OTH']::text[], '{}'::text[], null, null),
  ('IFRS-SME-BS', 'L-TOT', null, 'Total liabilities', '{}'::jsonb, 160, 1, true, array['L-NC', 'L-C']::text[], '{}'::text[], null, null),
  ('IFRS-SME-BS', 'EL-TOT', null, 'Total equity and liabilities', '{}'::jsonb, 170, 1, true, array['E-TOT', 'L-TOT']::text[], '{}'::text[], null, null),
  ('IFRS-SME-IS', 'REV', null, 'Revenue', '{}'::jsonb, 10, -1, false, '{}'::text[], '{}'::text[], null, null),
  ('IFRS-SME-IS', 'COST', null, 'Cost of sales', '{}'::jsonb, 20, 1, false, '{}'::text[], '{}'::text[], null, null),
  ('IFRS-SME-IS', 'GROSS', null, 'Gross profit', '{}'::jsonb, 30, 1, true, array['REV']::text[], array['COST']::text[], null, null),
  ('IFRS-SME-IS', 'OTH-INC', null, 'Other income', '{}'::jsonb, 40, -1, false, '{}'::text[], '{}'::text[], null, null),
  ('IFRS-SME-IS', 'OPEX', null, 'Operating expenses', '{}'::jsonb, 50, 1, false, '{}'::text[], '{}'::text[], null, null),
  ('IFRS-SME-IS', 'DEPR', null, 'Depreciation and amortisation', '{}'::jsonb, 60, 1, false, '{}'::text[], '{}'::text[], null, null),
  ('IFRS-SME-IS', 'PROFIT', null, 'Profit (loss) for the period', '{}'::jsonb, 70, 1, true, array['GROSS', 'OTH-INC']::text[], array['OPEX', 'DEPR']::text[], null, null)
on conflict (statement_code, code) do update set
  parent_code     = excluded.parent_code,
  name            = excluded.name,
  name_i18n       = excluded.name_i18n,
  sequence        = excluded.sequence,
  sign            = excluded.sign,
  is_total        = excluded.is_total,
  plus_lines      = excluded.plus_lines,
  minus_lines     = excluded.minus_lines,
  xbrl_element    = excluded.xbrl_element,
  legal_reference = excluded.legal_reference;

insert into statement_line_rules
  (statement_code, line_code, sequence, rule_kind, code_from, code_to,
   account_type, balance_side)
select v.statement_code, v.line_code, v.sequence, v.rule_kind, v.code_from,
       v.code_to, v.account_type::account_type, v.balance_side
  from (values
    ('IFRS-SME-BS', 'A-NC-FIX', 10, 'account_type', null, null, 'asset_fixed', 'any'),
    ('IFRS-SME-BS', 'A-NC-OTH', 10, 'account_type', null, null, 'asset_non_current', 'any'),
    ('IFRS-SME-BS', 'A-C-REC', 10, 'account_type', null, null, 'asset_receivable', 'any'),
    ('IFRS-SME-BS', 'A-C-OTH', 10, 'account_type', null, null, 'asset_current', 'any'),
    ('IFRS-SME-BS', 'A-C-OTH', 20, 'account_type', null, null, 'asset_prepayments', 'any'),
    ('IFRS-SME-BS', 'A-C-CASH', 10, 'account_type', null, null, 'asset_cash', 'any'),
    ('IFRS-SME-BS', 'E-CAP', 10, 'account_type', null, null, 'equity', 'any'),
    ('IFRS-SME-BS', 'E-RET', 10, 'account_type', null, null, 'equity_retained', 'any'),
    ('IFRS-SME-BS', 'E-RESULT', 10, 'account_type', null, null, 'income', 'any'),
    ('IFRS-SME-BS', 'E-RESULT', 20, 'account_type', null, null, 'income_other', 'any'),
    ('IFRS-SME-BS', 'E-RESULT', 30, 'account_type', null, null, 'expense', 'any'),
    ('IFRS-SME-BS', 'E-RESULT', 40, 'account_type', null, null, 'expense_direct_cost', 'any'),
    ('IFRS-SME-BS', 'E-RESULT', 50, 'account_type', null, null, 'expense_depreciation', 'any'),
    ('IFRS-SME-BS', 'L-NC', 10, 'account_type', null, null, 'liability_non_current', 'any'),
    ('IFRS-SME-BS', 'L-C-PAY', 10, 'account_type', null, null, 'liability_payable', 'any'),
    ('IFRS-SME-BS', 'L-C-OTH', 10, 'account_type', null, null, 'liability_current', 'any'),
    ('IFRS-SME-BS', 'L-C-OTH', 20, 'account_type', null, null, 'liability_credit_card', 'any'),
    ('IFRS-SME-IS', 'REV', 10, 'account_type', null, null, 'income', 'any'),
    ('IFRS-SME-IS', 'COST', 10, 'account_type', null, null, 'expense_direct_cost', 'any'),
    ('IFRS-SME-IS', 'OTH-INC', 10, 'account_type', null, null, 'income_other', 'any'),
    ('IFRS-SME-IS', 'OPEX', 10, 'account_type', null, null, 'expense', 'any'),
    ('IFRS-SME-IS', 'DEPR', 10, 'account_type', null, null, 'expense_depreciation', 'any')
  ) as v (statement_code, line_code, sequence, rule_kind, code_from, code_to,
          account_type, balance_side)
on conflict (statement_code, line_code, sequence) do update set
  rule_kind    = excluded.rule_kind,
  code_from    = excluded.code_from,
  code_to      = excluded.code_to,
  account_type = excluded.account_type,
  balance_side = excluded.balance_side;

