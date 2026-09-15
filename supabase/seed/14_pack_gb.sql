-- Ekwo OS — United Kingdom: chart of accounts, journals, taxes and defaults.
--
-- Generated from packs/gb at version 0.1.1, do not edit.
-- Change the pack and run `ekwo pack build gb`; `ekwo pack check --all`
-- refuses a seed that is not the exact output of its pack, and the CI runs it.
--
-- Community pack — not reviewed.
-- Written from:
--   Value Added Tax Act 1994 (The National Archives — legislation.gov.uk)
--     https://www.legislation.gov.uk/ukpga/1994/23/contents
--   The Value Added Tax Regulations 1995 (S.I. 1995/2518) (The National Archives — legislation.gov.uk)
--     https://www.legislation.gov.uk/uksi/1995/2518/contents
--   The Value Added Tax (Input Tax) Order 1992 (S.I. 1992/3222) (The National Archives — legislation.gov.uk)
--     https://www.legislation.gov.uk/uksi/1992/3222/contents/made
--   The Value Added Tax (Section 55A) (Specified Services and Excepted Supplies) Order 2019 (S.I. 2019/892) (The National Archives — legislation.gov.uk)
--     https://www.legislation.gov.uk/uksi/2019/892/contents/made
--   The Value Added Tax (Change of Rate) Order 2008 (S.I. 2008/3020) (The National Archives — legislation.gov.uk)
--     https://www.legislation.gov.uk/uksi/2008/3020/made
--   Finance Act 2009, section 9 — Value added tax: change of rate (The National Archives — legislation.gov.uk)
--     https://www.legislation.gov.uk/ukpga/2009/10/section/9
--   Finance (No. 2) Act 2010, section 3 — Rate of value added tax (The National Archives — legislation.gov.uk)
--     https://www.legislation.gov.uk/ukpga/2010/31/section/3
--   The Value Added Tax (Reduced Rate) (Hospitality and Tourism) (Coronavirus) Order 2020 (S.I. 2020/728) (The National Archives — legislation.gov.uk)
--     https://www.legislation.gov.uk/uksi/2020/728/made
--   Finance Act 2021, section 92 — Extension of temporary 5% reduced rate for hospitality and tourism sectors (The National Archives — legislation.gov.uk)
--     https://www.legislation.gov.uk/ukpga/2021/26/section/92
--   Finance Act 2021, section 93 — Temporary 12.5% reduced rate for hospitality and tourism sectors (The National Archives — legislation.gov.uk)
--     https://www.legislation.gov.uk/ukpga/2021/26/section/93
--   Late Payment of Commercial Debts (Interest) Act 1998 (The National Archives — legislation.gov.uk)
--     https://www.legislation.gov.uk/ukpga/1998/20/contents
--   Companies Act 2006 (The National Archives — legislation.gov.uk)
--     https://www.legislation.gov.uk/ukpga/2006/46/contents
--   The Small Companies and Groups (Accounts and Directors' Report) Regulations 2008 (S.I. 2008/409), Schedule 1 — Companies Act individual accounts: the balance sheet and profit and loss account formats of the small companies regime (The National Archives — legislation.gov.uk)
--     https://www.legislation.gov.uk/uksi/2008/409/schedule/1
--   The Large and Medium-sized Companies and Groups (Accounts and Reports) Regulations 2008 (S.I. 2008/410), Schedule 1 — the formats a company outside the small companies regime reports on (The National Archives — legislation.gov.uk)
--     https://www.legislation.gov.uk/uksi/2008/410/schedule/1
--   VAT guide (VAT Notice 700) (HM Revenue & Customs)
--     https://www.gov.uk/guidance/vat-guide-notice-700
--   How to fill in and submit your VAT Return (VAT Notice 700/12) (HM Revenue & Customs)
--     https://www.gov.uk/guidance/how-to-fill-in-and-submit-your-vat-return-vat-notice-70012
--   Record keeping (VAT Notice 700/21) (HM Revenue & Customs)
--     https://www.gov.uk/guidance/record-keeping-for-vat-notice-70021
--   VAT Notice 700/22: Making Tax Digital for VAT (HM Revenue & Customs)
--     https://www.gov.uk/government/publications/vat-notice-70022-making-tax-digital-for-vat/vat-notice-70022-making-tax-digital-for-vat
--   Rates of VAT on different goods and services (HM Revenue & Customs)
--     https://www.gov.uk/guidance/rates-of-vat-on-different-goods-and-services
--   Complete your VAT Return to account for import VAT — postponed VAT accounting (HM Revenue & Customs)
--     https://www.gov.uk/guidance/complete-your-vat-return-to-account-for-import-vat
--   VAT domestic reverse charge for building and construction services (HM Revenue & Customs)
--     https://www.gov.uk/guidance/vat-domestic-reverse-charge-for-building-and-construction-services
--   VATREC12010 — Rounding on invoices and rounding at retailers: what is the rounding concession? (HM Revenue & Customs — VAT Trader Records manual)
--     https://www.gov.uk/hmrc-internal-manuals/vat-trader-records/vatrec12010
--   VATREC12020 — Rounding on invoices and rounding at retailers: rounding at retailers (HM Revenue & Customs — VAT Trader Records manual)
--     https://www.gov.uk/hmrc-internal-manuals/vat-trader-records/vatrec12020
--   Promoting electronic invoicing across UK businesses and the public sector — consultation response, 26 November 2025 (HM Revenue & Customs and HM Treasury)
--     https://www.gov.uk/government/consultations/promoting-electronic-invoicing-across-uk-businesses-and-the-public-sector/outcome/promoting-electronic-invoicing-across-uk-businesses-and-the-public-sector-consultation-response
--   FRS 102 The Financial Reporting Standard applicable in the UK and Republic of Ireland, September 2024 edition (Financial Reporting Council)
--     https://www.frc.org.uk/library/standards-codes-policy/accounting-and-reporting/uk-accounting-standards/frs-102/
--   FRS 105 The Financial Reporting Standard applicable to the Micro-entities Regime, September 2024 edition (Financial Reporting Council)
--     https://www.frc.org.uk/library/standards-codes-policy/accounting-and-reporting/uk-accounting-standards/frs-105/
--   Preparing and filing Companies House accounts — Life of a company, part 1: accounts (Companies House)
--     https://www.gov.uk/government/publications/life-of-a-company-annual-requirements/life-of-a-company-part-1-accounts
--   Sending a VAT Return — the VAT online account the return is filed through (HM Revenue & Customs)
--     https://www.gov.uk/submit-vat-return
--   EN 16931 compliance — the European standard on electronic invoicing under Directive 2014/55/EU (European Commission — Digital Building Blocks)
--     https://ec.europa.eu/digital-building-blocks/sites/spaces/DIGITAL/pages/467108950/EN+16931+compliance
--   UNCL5305 — the VAT category code list of EN 16931 (BT-118 and BT-151), as the OpenPEPPOL subset publishes it (OpenPEPPOL — the list itself is published by the European Commission)
--     https://docs.peppol.eu/poacc/billing/3.0/codelist/UNCL5305/
--   VATEX — the VAT exemption reason code list of EN 16931 (BT-121) (OpenPEPPOL — the list itself is published by the European Commission)
--     https://docs.peppol.eu/poacc/billing/3.0/codelist/vatex/
--   Peppol code list of electronic address schemes (ISO 6523 ICD): 0088 Global Location Number, 9932 United Kingdom VAT number (OpenPEPPOL)
--     https://docs.peppol.eu/poacc/billing/3.0/codelist/eas/
--
-- Reference data: `install_country_template()` copies it into a company,
-- nothing here belongs to a company.

insert into country_packs
  (country, name, version, released_at, schema_min, certification_status,
   certified_by, certified_at, checksum, sources)
values
  ('GB', 'United Kingdom', '0.1.1', date '2026-09-15', '20260915161842', 'community', null, null, '6b2d21de79bbc6820671c2a1d83245b441362ac853a179f09e6617d071d47530', '[{"key":"vata-1994","title":"Value Added Tax Act 1994","publisher":"The National Archives — legislation.gov.uk","url":"https://www.legislation.gov.uk/ukpga/1994/23/contents","consulted_on":"2026-09-15","kind":"law"},{"key":"vat-regs-1995","title":"The Value Added Tax Regulations 1995 (S.I. 1995/2518)","publisher":"The National Archives — legislation.gov.uk","url":"https://www.legislation.gov.uk/uksi/1995/2518/contents","consulted_on":"2026-09-15","kind":"regulation"},{"key":"input-tax-order-1992","title":"The Value Added Tax (Input Tax) Order 1992 (S.I. 1992/3222)","publisher":"The National Archives — legislation.gov.uk","url":"https://www.legislation.gov.uk/uksi/1992/3222/contents/made","consulted_on":"2026-09-15","kind":"regulation"},{"key":"drc-order-2019","title":"The Value Added Tax (Section 55A) (Specified Services and Excepted Supplies) Order 2019 (S.I. 2019/892)","publisher":"The National Archives — legislation.gov.uk","url":"https://www.legislation.gov.uk/uksi/2019/892/contents/made","consulted_on":"2026-09-15","kind":"regulation"},{"key":"rate-order-2008","title":"The Value Added Tax (Change of Rate) Order 2008 (S.I. 2008/3020)","publisher":"The National Archives — legislation.gov.uk","url":"https://www.legislation.gov.uk/uksi/2008/3020/made","consulted_on":"2026-09-15","kind":"regulation"},{"key":"fa-2009-s9","title":"Finance Act 2009, section 9 — Value added tax: change of rate","publisher":"The National Archives — legislation.gov.uk","url":"https://www.legislation.gov.uk/ukpga/2009/10/section/9","consulted_on":"2026-09-15","kind":"law"},{"key":"fa2-2010-s3","title":"Finance (No. 2) Act 2010, section 3 — Rate of value added tax","publisher":"The National Archives — legislation.gov.uk","url":"https://www.legislation.gov.uk/ukpga/2010/31/section/3","consulted_on":"2026-09-15","kind":"law"},{"key":"hospitality-order-2020","title":"The Value Added Tax (Reduced Rate) (Hospitality and Tourism) (Coronavirus) Order 2020 (S.I. 2020/728)","publisher":"The National Archives — legislation.gov.uk","url":"https://www.legislation.gov.uk/uksi/2020/728/made","consulted_on":"2026-09-15","kind":"regulation"},{"key":"fa-2021-s92","title":"Finance Act 2021, section 92 — Extension of temporary 5% reduced rate for hospitality and tourism sectors","publisher":"The National Archives — legislation.gov.uk","url":"https://www.legislation.gov.uk/ukpga/2021/26/section/92","consulted_on":"2026-09-15","kind":"law"},{"key":"fa-2021-s93","title":"Finance Act 2021, section 93 — Temporary 12.5% reduced rate for hospitality and tourism sectors","publisher":"The National Archives — legislation.gov.uk","url":"https://www.legislation.gov.uk/ukpga/2021/26/section/93","consulted_on":"2026-09-15","kind":"law"},{"key":"lpcd-1998","title":"Late Payment of Commercial Debts (Interest) Act 1998","publisher":"The National Archives — legislation.gov.uk","url":"https://www.legislation.gov.uk/ukpga/1998/20/contents","consulted_on":"2026-09-15","kind":"law"},{"key":"ca-2006","title":"Companies Act 2006","publisher":"The National Archives — legislation.gov.uk","url":"https://www.legislation.gov.uk/ukpga/2006/46/contents","consulted_on":"2026-09-15","kind":"law"},{"key":"small-companies-regs","title":"The Small Companies and Groups (Accounts and Directors'' Report) Regulations 2008 (S.I. 2008/409), Schedule 1 — Companies Act individual accounts: the balance sheet and profit and loss account formats of the small companies regime","publisher":"The National Archives — legislation.gov.uk","url":"https://www.legislation.gov.uk/uksi/2008/409/schedule/1","consulted_on":"2026-09-15","kind":"regulation"},{"key":"large-medium-regs","title":"The Large and Medium-sized Companies and Groups (Accounts and Reports) Regulations 2008 (S.I. 2008/410), Schedule 1 — the formats a company outside the small companies regime reports on","publisher":"The National Archives — legislation.gov.uk","url":"https://www.legislation.gov.uk/uksi/2008/410/schedule/1","consulted_on":"2026-09-15","kind":"regulation"},{"key":"notice-700","title":"VAT guide (VAT Notice 700)","publisher":"HM Revenue & Customs","url":"https://www.gov.uk/guidance/vat-guide-notice-700","consulted_on":"2026-09-15","kind":"guidance"},{"key":"notice-700-12","title":"How to fill in and submit your VAT Return (VAT Notice 700/12)","publisher":"HM Revenue & Customs","url":"https://www.gov.uk/guidance/how-to-fill-in-and-submit-your-vat-return-vat-notice-70012","consulted_on":"2026-09-15","kind":"form"},{"key":"notice-700-21","title":"Record keeping (VAT Notice 700/21)","publisher":"HM Revenue & Customs","url":"https://www.gov.uk/guidance/record-keeping-for-vat-notice-70021","consulted_on":"2026-09-15","kind":"guidance"},{"key":"notice-700-22","title":"VAT Notice 700/22: Making Tax Digital for VAT","publisher":"HM Revenue & Customs","url":"https://www.gov.uk/government/publications/vat-notice-70022-making-tax-digital-for-vat/vat-notice-70022-making-tax-digital-for-vat","consulted_on":"2026-09-15","kind":"guidance"},{"key":"vat-rates","title":"Rates of VAT on different goods and services","publisher":"HM Revenue & Customs","url":"https://www.gov.uk/guidance/rates-of-vat-on-different-goods-and-services","consulted_on":"2026-09-15","kind":"guidance"},{"key":"pva-guidance","title":"Complete your VAT Return to account for import VAT — postponed VAT accounting","publisher":"HM Revenue & Customs","url":"https://www.gov.uk/guidance/complete-your-vat-return-to-account-for-import-vat","consulted_on":"2026-09-15","kind":"guidance"},{"key":"drc-guidance","title":"VAT domestic reverse charge for building and construction services","publisher":"HM Revenue & Customs","url":"https://www.gov.uk/guidance/vat-domestic-reverse-charge-for-building-and-construction-services","consulted_on":"2026-09-15","kind":"guidance"},{"key":"vatrec-12010","title":"VATREC12010 — Rounding on invoices and rounding at retailers: what is the rounding concession?","publisher":"HM Revenue & Customs — VAT Trader Records manual","url":"https://www.gov.uk/hmrc-internal-manuals/vat-trader-records/vatrec12010","consulted_on":"2026-09-15","kind":"guidance"},{"key":"vatrec-12020","title":"VATREC12020 — Rounding on invoices and rounding at retailers: rounding at retailers","publisher":"HM Revenue & Customs — VAT Trader Records manual","url":"https://www.gov.uk/hmrc-internal-manuals/vat-trader-records/vatrec12020","consulted_on":"2026-09-15","kind":"guidance"},{"key":"einvoicing-response","title":"Promoting electronic invoicing across UK businesses and the public sector — consultation response, 26 November 2025","publisher":"HM Revenue & Customs and HM Treasury","url":"https://www.gov.uk/government/consultations/promoting-electronic-invoicing-across-uk-businesses-and-the-public-sector/outcome/promoting-electronic-invoicing-across-uk-businesses-and-the-public-sector-consultation-response","consulted_on":"2026-09-15","kind":"guidance"},{"key":"frs-102","title":"FRS 102 The Financial Reporting Standard applicable in the UK and Republic of Ireland, September 2024 edition","publisher":"Financial Reporting Council","url":"https://www.frc.org.uk/library/standards-codes-policy/accounting-and-reporting/uk-accounting-standards/frs-102/","consulted_on":"2026-09-15","kind":"standard"},{"key":"frs-105","title":"FRS 105 The Financial Reporting Standard applicable to the Micro-entities Regime, September 2024 edition","publisher":"Financial Reporting Council","url":"https://www.frc.org.uk/library/standards-codes-policy/accounting-and-reporting/uk-accounting-standards/frs-105/","consulted_on":"2026-09-15","kind":"standard"},{"key":"companies-house-accounts","title":"Preparing and filing Companies House accounts — Life of a company, part 1: accounts","publisher":"Companies House","url":"https://www.gov.uk/government/publications/life-of-a-company-annual-requirements/life-of-a-company-part-1-accounts","consulted_on":"2026-09-15","kind":"guidance"},{"key":"hmrc-vat-online","title":"Sending a VAT Return — the VAT online account the return is filed through","publisher":"HM Revenue & Customs","url":"https://www.gov.uk/submit-vat-return","consulted_on":"2026-09-15","kind":"portal"},{"key":"en-16931","title":"EN 16931 compliance — the European standard on electronic invoicing under Directive 2014/55/EU","publisher":"European Commission — Digital Building Blocks","url":"https://ec.europa.eu/digital-building-blocks/sites/spaces/DIGITAL/pages/467108950/EN+16931+compliance","consulted_on":"2026-09-15","kind":"standard"},{"key":"uncl5305","title":"UNCL5305 — the VAT category code list of EN 16931 (BT-118 and BT-151), as the OpenPEPPOL subset publishes it","publisher":"OpenPEPPOL — the list itself is published by the European Commission","url":"https://docs.peppol.eu/poacc/billing/3.0/codelist/UNCL5305/","consulted_on":"2026-09-15","kind":"standard"},{"key":"vatex","title":"VATEX — the VAT exemption reason code list of EN 16931 (BT-121)","publisher":"OpenPEPPOL — the list itself is published by the European Commission","url":"https://docs.peppol.eu/poacc/billing/3.0/codelist/vatex/","consulted_on":"2026-09-15","kind":"standard"},{"key":"peppol-eas","title":"Peppol code list of electronic address schemes (ISO 6523 ICD): 0088 Global Location Number, 9932 United Kingdom VAT number","publisher":"OpenPEPPOL","url":"https://docs.peppol.eu/poacc/billing/3.0/codelist/eas/","consulted_on":"2026-09-15","kind":"standard"}]'::jsonb)
on conflict (country) do update set
  name                 = excluded.name,
  version              = excluded.version,
  released_at          = excluded.released_at,
  schema_min           = excluded.schema_min,
  certification_status = excluded.certification_status,
  certified_by         = excluded.certified_by,
  certified_at         = excluded.certified_at,
  checksum             = excluded.checksum,
  sources              = excluded.sources;

insert into chart_templates
  (country, code, name, name_i18n, is_default, audience, statements,
   certification_status, legal_reference)
values
  ('GB', 'default', 'United Kingdom reference chart of accounts', '{}'::jsonb, true, 'companies', array['GB-CA-SMALL-BS', 'GB-CA-SMALL-IS']::text[], null, 'There is no legal chart of accounts in the United Kingdom. Companies Act 2006, s. 396(1) and (3) require Companies Act individual accounts to comprise a balance sheet and a profit and loss account complying with regulations as to their form and content, and s. 396(2) that they give a true and fair view; the regulations are S.I. 2008/409, Schedule 1 for a company in the small companies regime and S.I. 2008/410, Schedule 1 otherwise. Neither prescribes a nominal ledger. This chart is original: it follows the four-digit convention British practice shares, and every block of codes maps onto one item of Balance Sheet Format 1 or of Profit and Loss Account Format 1 of S.I. 2008/409, Schedule 1, so that the statements of this pack are readable straight off the chart.')
on conflict (country, code) do update set
  name                 = excluded.name,
  name_i18n            = excluded.name_i18n,
  is_default           = excluded.is_default,
  audience             = excluded.audience,
  statements           = excluded.statements,
  certification_status = excluded.certification_status,
  legal_reference      = excluded.legal_reference;

insert into account_templates
  (country, chart_code, code, name, name_i18n, account_type, reconcilable,
   parent_code, sequence)
values
  ('GB', 'default', '0000', 'Called up share capital not paid', '{}'::jsonb, 'asset_current', false, null, 10),
  ('GB', 'default', '0010', 'Goodwill', '{}'::jsonb, 'asset_fixed', false, null, 20),
  ('GB', 'default', '0011', 'Goodwill — accumulated amortisation', '{}'::jsonb, 'asset_fixed', false, null, 30),
  ('GB', 'default', '0020', 'Development costs', '{}'::jsonb, 'asset_fixed', false, null, 40),
  ('GB', 'default', '0021', 'Development costs — accumulated amortisation', '{}'::jsonb, 'asset_fixed', false, null, 50),
  ('GB', 'default', '0030', 'Patents, trade marks and licences', '{}'::jsonb, 'asset_fixed', false, null, 60),
  ('GB', 'default', '0031', 'Patents, trade marks and licences — accumulated amortisation', '{}'::jsonb, 'asset_fixed', false, null, 70),
  ('GB', 'default', '0040', 'Other intangible assets', '{}'::jsonb, 'asset_fixed', false, null, 80),
  ('GB', 'default', '0041', 'Other intangible assets — accumulated amortisation', '{}'::jsonb, 'asset_fixed', false, null, 90),
  ('GB', 'default', '0100', 'Freehold land and buildings', '{}'::jsonb, 'asset_fixed', false, null, 100),
  ('GB', 'default', '0101', 'Freehold land and buildings — accumulated depreciation', '{}'::jsonb, 'asset_fixed', false, null, 110),
  ('GB', 'default', '0110', 'Leasehold property and improvements', '{}'::jsonb, 'asset_fixed', false, null, 120),
  ('GB', 'default', '0111', 'Leasehold property and improvements — accumulated depreciation', '{}'::jsonb, 'asset_fixed', false, null, 130),
  ('GB', 'default', '0120', 'Plant and machinery', '{}'::jsonb, 'asset_fixed', false, null, 140),
  ('GB', 'default', '0121', 'Plant and machinery — accumulated depreciation', '{}'::jsonb, 'asset_fixed', false, null, 150),
  ('GB', 'default', '0130', 'Fixtures and fittings', '{}'::jsonb, 'asset_fixed', false, null, 160),
  ('GB', 'default', '0131', 'Fixtures and fittings — accumulated depreciation', '{}'::jsonb, 'asset_fixed', false, null, 170),
  ('GB', 'default', '0140', 'Office equipment', '{}'::jsonb, 'asset_fixed', false, null, 180),
  ('GB', 'default', '0141', 'Office equipment — accumulated depreciation', '{}'::jsonb, 'asset_fixed', false, null, 190),
  ('GB', 'default', '0150', 'Computer equipment', '{}'::jsonb, 'asset_fixed', false, null, 200),
  ('GB', 'default', '0151', 'Computer equipment — accumulated depreciation', '{}'::jsonb, 'asset_fixed', false, null, 210),
  ('GB', 'default', '0160', 'Motor vehicles', '{}'::jsonb, 'asset_fixed', false, null, 220),
  ('GB', 'default', '0161', 'Motor vehicles — accumulated depreciation', '{}'::jsonb, 'asset_fixed', false, null, 230),
  ('GB', 'default', '0200', 'Shares in group undertakings and participating interests', '{}'::jsonb, 'asset_non_current', false, null, 240),
  ('GB', 'default', '0210', 'Loans to group undertakings and undertakings in which the company has a participating interest', '{}'::jsonb, 'asset_non_current', false, null, 250),
  ('GB', 'default', '0220', 'Other investments other than loans', '{}'::jsonb, 'asset_non_current', false, null, 260),
  ('GB', 'default', '0230', 'Other investments', '{}'::jsonb, 'asset_non_current', false, null, 270),
  ('GB', 'default', '1000', 'Stock — raw materials and consumables', '{}'::jsonb, 'asset_current', false, null, 280),
  ('GB', 'default', '1010', 'Stock — work in progress', '{}'::jsonb, 'asset_current', false, null, 290),
  ('GB', 'default', '1020', 'Stock — finished goods and goods for resale', '{}'::jsonb, 'asset_current', false, null, 300),
  ('GB', 'default', '1030', 'Payments on account — stocks', '{}'::jsonb, 'asset_prepayments', false, null, 310),
  ('GB', 'default', '1100', 'Trade debtors', '{}'::jsonb, 'asset_receivable', true, null, 320),
  ('GB', 'default', '1105', 'Provision for doubtful debts', '{}'::jsonb, 'asset_current', false, null, 330),
  ('GB', 'default', '1110', 'Amounts owed by group undertakings and undertakings in which the company has a participating interest', '{}'::jsonb, 'asset_current', false, null, 340),
  ('GB', 'default', '1120', 'Other debtors', '{}'::jsonb, 'asset_current', false, null, 350),
  ('GB', 'default', '1130', 'Directors'' loan account — debit', '{}'::jsonb, 'asset_current', false, null, 360),
  ('GB', 'default', '1140', 'VAT recoverable — input tax', '{}'::jsonb, 'asset_current', false, null, 370),
  ('GB', 'default', '1150', 'Corporation tax recoverable', '{}'::jsonb, 'asset_current', false, null, 380),
  ('GB', 'default', '1160', 'Employee advances and expense claims', '{}'::jsonb, 'asset_current', false, null, 390),
  ('GB', 'default', '1200', 'Shares in group undertakings — held as a current asset', '{}'::jsonb, 'asset_current', false, null, 400),
  ('GB', 'default', '1210', 'Other investments — held as a current asset', '{}'::jsonb, 'asset_current', false, null, 410),
  ('GB', 'default', '1300', 'Bank current account', '{}'::jsonb, 'asset_cash', false, null, 420),
  ('GB', 'default', '1310', 'Bank deposit account', '{}'::jsonb, 'asset_cash', false, null, 430),
  ('GB', 'default', '1320', 'Bank account in a foreign currency', '{}'::jsonb, 'asset_cash', false, null, 440),
  ('GB', 'default', '1330', 'Petty cash', '{}'::jsonb, 'asset_cash', false, null, 450),
  ('GB', 'default', '1340', 'Cash in transit', '{}'::jsonb, 'asset_cash', false, null, 460),
  ('GB', 'default', '1350', 'Card acquirer settlement account', '{}'::jsonb, 'asset_cash', false, null, 470),
  ('GB', 'default', '1400', 'Prepayments', '{}'::jsonb, 'asset_prepayments', false, null, 480),
  ('GB', 'default', '1410', 'Accrued income', '{}'::jsonb, 'asset_prepayments', false, null, 490),
  ('GB', 'default', '1420', 'Payments on account to suppliers', '{}'::jsonb, 'asset_prepayments', false, null, 500),
  ('GB', 'default', '2000', 'Bank loans — due within one year', '{}'::jsonb, 'liability_current', false, null, 510),
  ('GB', 'default', '2010', 'Bank overdraft', '{}'::jsonb, 'liability_current', false, null, 520),
  ('GB', 'default', '2020', 'Credit card account', '{}'::jsonb, 'liability_credit_card', false, null, 530),
  ('GB', 'default', '2100', 'Trade creditors', '{}'::jsonb, 'liability_payable', true, null, 540),
  ('GB', 'default', '2110', 'Amounts owed to group undertakings and undertakings in which the company has a participating interest', '{}'::jsonb, 'liability_current', false, null, 550),
  ('GB', 'default', '2200', 'VAT payable — output tax', '{}'::jsonb, 'liability_current', false, null, 560),
  ('GB', 'default', '2210', 'VAT control account — net due to HMRC', '{}'::jsonb, 'liability_current', false, null, 570),
  ('GB', 'default', '2220', 'PAYE and National Insurance payable', '{}'::jsonb, 'liability_current', false, null, 580),
  ('GB', 'default', '2230', 'Construction Industry Scheme deductions payable', '{}'::jsonb, 'liability_current', false, null, 590),
  ('GB', 'default', '2240', 'Pension contributions payable', '{}'::jsonb, 'liability_current', false, null, 600),
  ('GB', 'default', '2250', 'Net wages payable', '{}'::jsonb, 'liability_current', false, null, 610),
  ('GB', 'default', '2260', 'Directors'' loan account — credit', '{}'::jsonb, 'liability_current', false, null, 620),
  ('GB', 'default', '2270', 'Dividends payable', '{}'::jsonb, 'liability_current', false, null, 630),
  ('GB', 'default', '2280', 'Corporation tax payable', '{}'::jsonb, 'liability_current', false, null, 640),
  ('GB', 'default', '2290', 'Other creditors', '{}'::jsonb, 'liability_current', false, null, 650),
  ('GB', 'default', '2300', 'Obligations under finance leases and hire purchase — due within one year', '{}'::jsonb, 'liability_current', false, null, 660),
  ('GB', 'default', '2400', 'Suspense account', '{}'::jsonb, 'liability_current', false, null, 670),
  ('GB', 'default', '3000', 'Bank loans — due after more than one year', '{}'::jsonb, 'liability_non_current', false, null, 680),
  ('GB', 'default', '3010', 'Other loans — due after more than one year', '{}'::jsonb, 'liability_non_current', false, null, 690),
  ('GB', 'default', '3020', 'Trade creditors — due after more than one year', '{}'::jsonb, 'liability_non_current', false, null, 700),
  ('GB', 'default', '3030', 'Amounts owed to group undertakings and undertakings in which the company has a participating interest — due after more than one year', '{}'::jsonb, 'liability_non_current', false, null, 710),
  ('GB', 'default', '3040', 'Obligations under finance leases and hire purchase — due after more than one year', '{}'::jsonb, 'liability_non_current', false, null, 720),
  ('GB', 'default', '3050', 'Other creditors — due after more than one year', '{}'::jsonb, 'liability_non_current', false, null, 730),
  ('GB', 'default', '3100', 'Provision for deferred taxation', '{}'::jsonb, 'liability_non_current', false, null, 740),
  ('GB', 'default', '3110', 'Other provisions for liabilities', '{}'::jsonb, 'liability_non_current', false, null, 750),
  ('GB', 'default', '3200', 'Accruals', '{}'::jsonb, 'liability_current', false, null, 760),
  ('GB', 'default', '3210', 'Deferred income', '{}'::jsonb, 'liability_current', false, null, 770),
  ('GB', 'default', '3300', 'Called up share capital', '{}'::jsonb, 'equity', false, null, 780),
  ('GB', 'default', '3310', 'Share premium account', '{}'::jsonb, 'equity', false, null, 790),
  ('GB', 'default', '3320', 'Revaluation reserve', '{}'::jsonb, 'equity', false, null, 800),
  ('GB', 'default', '3330', 'Capital redemption reserve', '{}'::jsonb, 'equity', false, null, 810),
  ('GB', 'default', '3340', 'Other reserves', '{}'::jsonb, 'equity', false, null, 820),
  ('GB', 'default', '3400', 'Profit and loss account', '{}'::jsonb, 'equity_retained', false, null, 830),
  ('GB', 'default', '3410', 'Dividends paid', '{}'::jsonb, 'equity_retained', false, null, 840),
  ('GB', 'default', '4000', 'Sales — goods', '{}'::jsonb, 'income', false, null, 850),
  ('GB', 'default', '4010', 'Sales — services', '{}'::jsonb, 'income', false, null, 860),
  ('GB', 'default', '4020', 'Sales — goods at the reduced rate', '{}'::jsonb, 'income', false, null, 870),
  ('GB', 'default', '4030', 'Sales — zero-rated goods', '{}'::jsonb, 'income', false, null, 880),
  ('GB', 'default', '4040', 'Sales — exempt supplies', '{}'::jsonb, 'income', false, null, 890),
  ('GB', 'default', '4050', 'Sales — exports of goods', '{}'::jsonb, 'income', false, null, 900),
  ('GB', 'default', '4060', 'Sales — construction services under the domestic reverse charge', '{}'::jsonb, 'income', false, null, 910),
  ('GB', 'default', '4070', 'Retail takings', '{}'::jsonb, 'income', false, null, 920),
  ('GB', 'default', '4100', 'Sales returns and allowances', '{}'::jsonb, 'income', false, null, 930),
  ('GB', 'default', '4110', 'Discounts allowed', '{}'::jsonb, 'income', false, null, 940),
  ('GB', 'default', '4200', 'Other operating income', '{}'::jsonb, 'income_other', false, null, 950),
  ('GB', 'default', '4210', 'Rental income', '{}'::jsonb, 'income_other', false, null, 960),
  ('GB', 'default', '4220', 'Grants receivable', '{}'::jsonb, 'income_other', false, null, 970),
  ('GB', 'default', '4230', 'Profit on disposal of fixed assets', '{}'::jsonb, 'income_other', false, null, 980),
  ('GB', 'default', '4240', 'Foreign exchange gains', '{}'::jsonb, 'income_other', false, null, 990),
  ('GB', 'default', '4300', 'Income from shares in group undertakings', '{}'::jsonb, 'income_other', false, null, 1000),
  ('GB', 'default', '4310', 'Income from participating interests', '{}'::jsonb, 'income_other', false, null, 1010),
  ('GB', 'default', '4320', 'Income from other fixed asset investments', '{}'::jsonb, 'income_other', false, null, 1020),
  ('GB', 'default', '4330', 'Other interest receivable and similar income', '{}'::jsonb, 'income_other', false, null, 1030),
  ('GB', 'default', '5000', 'Purchases — goods for resale', '{}'::jsonb, 'expense_direct_cost', false, null, 1040),
  ('GB', 'default', '5010', 'Purchases — raw materials and consumables', '{}'::jsonb, 'expense_direct_cost', false, null, 1050),
  ('GB', 'default', '5020', 'Carriage inwards', '{}'::jsonb, 'expense_direct_cost', false, null, 1060),
  ('GB', 'default', '5030', 'Import duty and freight', '{}'::jsonb, 'expense_direct_cost', false, null, 1070),
  ('GB', 'default', '5040', 'Purchase returns and allowances', '{}'::jsonb, 'expense_direct_cost', false, null, 1080),
  ('GB', 'default', '5050', 'Discounts received', '{}'::jsonb, 'expense_direct_cost', false, null, 1090),
  ('GB', 'default', '5100', 'Opening stock', '{}'::jsonb, 'expense_direct_cost', false, null, 1100),
  ('GB', 'default', '5110', 'Closing stock', '{}'::jsonb, 'expense_direct_cost', false, null, 1110),
  ('GB', 'default', '5200', 'Subcontractor costs', '{}'::jsonb, 'expense_direct_cost', false, null, 1120),
  ('GB', 'default', '5210', 'Direct labour', '{}'::jsonb, 'expense_direct_cost', false, null, 1130),
  ('GB', 'default', '5220', 'Direct expenses — plant and equipment hire', '{}'::jsonb, 'expense_direct_cost', false, null, 1140),
  ('GB', 'default', '5230', 'Direct expenses — materials', '{}'::jsonb, 'expense_direct_cost', false, null, 1150),
  ('GB', 'default', '5240', 'Direct expenses — other', '{}'::jsonb, 'expense_direct_cost', false, null, 1160),
  ('GB', 'default', '6000', 'Advertising', '{}'::jsonb, 'expense', false, null, 1170),
  ('GB', 'default', '6010', 'Marketing and promotion', '{}'::jsonb, 'expense', false, null, 1180),
  ('GB', 'default', '6020', 'Website and online advertising', '{}'::jsonb, 'expense', false, null, 1190),
  ('GB', 'default', '6100', 'Carriage outwards', '{}'::jsonb, 'expense', false, null, 1200),
  ('GB', 'default', '6110', 'Packaging', '{}'::jsonb, 'expense', false, null, 1210),
  ('GB', 'default', '6200', 'Distribution staff — wages and salaries', '{}'::jsonb, 'expense', false, null, 1220),
  ('GB', 'default', '6210', 'Distribution staff — employer''s National Insurance', '{}'::jsonb, 'expense', false, null, 1230),
  ('GB', 'default', '6220', 'Distribution staff — employer''s pension contributions', '{}'::jsonb, 'expense', false, null, 1240),
  ('GB', 'default', '6230', 'Sales commission', '{}'::jsonb, 'expense', false, null, 1250),
  ('GB', 'default', '6300', 'Delivery vehicle running costs', '{}'::jsonb, 'expense', false, null, 1260),
  ('GB', 'default', '6310', 'Travelling — distribution', '{}'::jsonb, 'expense', false, null, 1270),
  ('GB', 'default', '6400', 'Warehouse rent and business rates', '{}'::jsonb, 'expense', false, null, 1280),
  ('GB', 'default', '6410', 'Warehouse light and heat', '{}'::jsonb, 'expense', false, null, 1290),
  ('GB', 'default', '6420', 'Warehouse insurance', '{}'::jsonb, 'expense', false, null, 1300),
  ('GB', 'default', '6500', 'Depreciation — distribution assets', '{}'::jsonb, 'expense_depreciation', false, null, 1310),
  ('GB', 'default', '7000', 'Directors'' remuneration', '{}'::jsonb, 'expense', false, null, 1320),
  ('GB', 'default', '7010', 'Wages and salaries', '{}'::jsonb, 'expense', false, null, 1330),
  ('GB', 'default', '7020', 'Employer''s National Insurance', '{}'::jsonb, 'expense', false, null, 1340),
  ('GB', 'default', '7030', 'Employer''s pension contributions', '{}'::jsonb, 'expense', false, null, 1350),
  ('GB', 'default', '7040', 'Staff training', '{}'::jsonb, 'expense', false, null, 1360),
  ('GB', 'default', '7050', 'Staff welfare', '{}'::jsonb, 'expense', false, null, 1370),
  ('GB', 'default', '7060', 'Recruitment costs', '{}'::jsonb, 'expense', false, null, 1380),
  ('GB', 'default', '7070', 'Temporary and agency staff', '{}'::jsonb, 'expense', false, null, 1390),
  ('GB', 'default', '7100', 'Rent', '{}'::jsonb, 'expense', false, null, 1400),
  ('GB', 'default', '7110', 'Business rates', '{}'::jsonb, 'expense', false, null, 1410),
  ('GB', 'default', '7120', 'Light and heat', '{}'::jsonb, 'expense', false, null, 1420),
  ('GB', 'default', '7130', 'Water rates', '{}'::jsonb, 'expense', false, null, 1430),
  ('GB', 'default', '7140', 'Insurance', '{}'::jsonb, 'expense', false, null, 1440),
  ('GB', 'default', '7150', 'Repairs and maintenance', '{}'::jsonb, 'expense', false, null, 1450),
  ('GB', 'default', '7160', 'Cleaning', '{}'::jsonb, 'expense', false, null, 1460),
  ('GB', 'default', '7170', 'Security', '{}'::jsonb, 'expense', false, null, 1470),
  ('GB', 'default', '7200', 'Telephone and internet', '{}'::jsonb, 'expense', false, null, 1480),
  ('GB', 'default', '7210', 'Postage and carriage', '{}'::jsonb, 'expense', false, null, 1490),
  ('GB', 'default', '7220', 'Printing and stationery', '{}'::jsonb, 'expense', false, null, 1500),
  ('GB', 'default', '7230', 'Software and subscriptions', '{}'::jsonb, 'expense', false, null, 1510),
  ('GB', 'default', '7240', 'Computer and IT costs', '{}'::jsonb, 'expense', false, null, 1520),
  ('GB', 'default', '7250', 'Equipment hire', '{}'::jsonb, 'expense', false, null, 1530),
  ('GB', 'default', '7260', 'Sundry expenses', '{}'::jsonb, 'expense', false, null, 1540),
  ('GB', 'default', '7300', 'Motor vehicle running costs', '{}'::jsonb, 'expense', false, null, 1550),
  ('GB', 'default', '7310', 'Motor vehicle leasing and hire', '{}'::jsonb, 'expense', false, null, 1560),
  ('GB', 'default', '7320', 'Travel and subsistence', '{}'::jsonb, 'expense', false, null, 1570),
  ('GB', 'default', '7330', 'Business entertainment', '{}'::jsonb, 'expense', false, null, 1580),
  ('GB', 'default', '7400', 'Accountancy fees', '{}'::jsonb, 'expense', false, null, 1590),
  ('GB', 'default', '7410', 'Legal and professional fees', '{}'::jsonb, 'expense', false, null, 1600),
  ('GB', 'default', '7420', 'Consultancy fees', '{}'::jsonb, 'expense', false, null, 1610),
  ('GB', 'default', '7430', 'Audit fee', '{}'::jsonb, 'expense', false, null, 1620),
  ('GB', 'default', '7440', 'Bank charges', '{}'::jsonb, 'expense', false, null, 1630),
  ('GB', 'default', '7450', 'Card processing charges', '{}'::jsonb, 'expense', false, null, 1640),
  ('GB', 'default', '7460', 'Subscriptions to professional bodies', '{}'::jsonb, 'expense', false, null, 1650),
  ('GB', 'default', '7470', 'Charitable donations', '{}'::jsonb, 'expense', false, null, 1660),
  ('GB', 'default', '7500', 'Bad debts written off', '{}'::jsonb, 'expense', false, null, 1670),
  ('GB', 'default', '7510', 'Movement in the provision for doubtful debts', '{}'::jsonb, 'expense', false, null, 1680),
  ('GB', 'default', '7600', 'Depreciation — freehold land and buildings', '{}'::jsonb, 'expense_depreciation', false, null, 1690),
  ('GB', 'default', '7610', 'Depreciation — leasehold property and improvements', '{}'::jsonb, 'expense_depreciation', false, null, 1700),
  ('GB', 'default', '7620', 'Depreciation — plant and machinery', '{}'::jsonb, 'expense_depreciation', false, null, 1710),
  ('GB', 'default', '7630', 'Depreciation — fixtures and fittings', '{}'::jsonb, 'expense_depreciation', false, null, 1720),
  ('GB', 'default', '7640', 'Depreciation — office equipment', '{}'::jsonb, 'expense_depreciation', false, null, 1730),
  ('GB', 'default', '7650', 'Depreciation — computer equipment', '{}'::jsonb, 'expense_depreciation', false, null, 1740),
  ('GB', 'default', '7660', 'Depreciation — motor vehicles', '{}'::jsonb, 'expense_depreciation', false, null, 1750),
  ('GB', 'default', '7670', 'Amortisation of goodwill', '{}'::jsonb, 'expense_depreciation', false, null, 1760),
  ('GB', 'default', '7680', 'Amortisation of other intangible assets', '{}'::jsonb, 'expense_depreciation', false, null, 1770),
  ('GB', 'default', '7690', 'Loss on disposal of fixed assets', '{}'::jsonb, 'expense', false, null, 1780),
  ('GB', 'default', '7700', 'Foreign exchange losses', '{}'::jsonb, 'expense', false, null, 1790),
  ('GB', 'default', '7710', 'Rounding differences', '{}'::jsonb, 'expense', false, null, 1800),
  ('GB', 'default', '8000', 'Bank interest payable', '{}'::jsonb, 'expense', false, null, 1810),
  ('GB', 'default', '8010', 'Loan interest payable', '{}'::jsonb, 'expense', false, null, 1820),
  ('GB', 'default', '8020', 'Finance lease and hire purchase interest', '{}'::jsonb, 'expense', false, null, 1830),
  ('GB', 'default', '8030', 'Other interest payable and similar expenses', '{}'::jsonb, 'expense', false, null, 1840),
  ('GB', 'default', '8040', 'Statutory interest and recovery costs on late payment', '{}'::jsonb, 'expense', false, null, 1850),
  ('GB', 'default', '8100', 'Amounts written off investments', '{}'::jsonb, 'expense', false, null, 1860),
  ('GB', 'default', '8200', 'Corporation tax on profit or loss', '{}'::jsonb, 'expense', false, null, 1870),
  ('GB', 'default', '8210', 'Corporation tax — adjustment in respect of prior periods', '{}'::jsonb, 'expense', false, null, 1880),
  ('GB', 'default', '8220', 'Deferred taxation charge', '{}'::jsonb, 'expense', false, null, 1890),
  ('GB', 'default', '8300', 'Other taxes not shown under the above items', '{}'::jsonb, 'expense', false, null, 1900)
on conflict (country, chart_code, code) do update set
  name         = excluded.name,
  name_i18n    = excluded.name_i18n,
  account_type = excluded.account_type,
  reconcilable = excluded.reconcilable,
  parent_code  = excluded.parent_code,
  sequence     = excluded.sequence;

insert into journal_templates (country, code, name, name_i18n, journal_type, sequence) values
  ('GB', 'BNK', 'Bank', '{}'::jsonb, 'bank', 30),
  ('GB', 'CSH', 'Cash book', '{}'::jsonb, 'cash', 40),
  ('GB', 'GEN', 'General journal', '{}'::jsonb, 'general', 50),
  ('GB', 'OPN', 'Opening balances', '{}'::jsonb, 'opening', 60),
  ('GB', 'PUR', 'Purchase day book', '{}'::jsonb, 'purchase', 20),
  ('GB', 'SAL', 'Sales day book', '{}'::jsonb, 'sales', 10)
on conflict (country, code) do update set
  name         = excluded.name,
  name_i18n    = excluded.name_i18n,
  journal_type = excluded.journal_type,
  sequence     = excluded.sequence;

insert into tax_templates
  (country, code, name, name_i18n, description, amount_type, amount, applies_to, treatment,
   valid_from, valid_to, legal_reference, vat_category, exemption_code, sequence,
   tax_kind, recoverable, jurisdiction, price_include, cash_basis,
   cash_basis_transition_account_code, source_key)
values
  ('GB', 'GB-P-00', 'Purchase, zero-rated', '{}'::jsonb, null, 'percent', 0, 'purchase', 'domestic', date '1994-09-01', null, 'Value Added Tax Act 1994, s. 30 and Schedule 8 — no VAT is charged on the supply, so there is none to deduct; the value of the purchase is in box 7 of the return all the same.', 'Z', null, 190, 'vat', true, null, false, false, null, 'vata-1994'),
  ('GB', 'GB-P-05', 'Purchase, reduced rate 5 %', '{}'::jsonb, null, 'percent', 5, 'purchase', 'domestic', date '2001-05-11', null, 'Value Added Tax Act 1994, s. 29A(1) and Schedule 7A for the rate; ss. 24 to 26 for the deduction.', 'S', null, 180, 'vat', true, null, false, false, null, 'vata-1994'),
  ('GB', 'GB-P-05-DRC-CIS', 'Purchase of construction services, domestic reverse charge 5 %', '{}'::jsonb, null, 'percent', 5, 'purchase', 'domestic_reverse_charge', date '2021-03-01', null, 'The same charge as GB-P-20-DRC-CIS, at the reduced rate of s. 29A and Schedule 7A of the Value Added Tax Act 1994 — a qualifying conversion or renovation of a dwelling is a specified service taxed at 5 per cent, and the reverse charge applies to a reduced-rated supply as it does to a standard-rated one.', 'AE', null, 230, 'vat', true, null, false, false, null, 'drc-guidance'),
  ('GB', 'GB-P-15', 'Purchase, standard rate 15 %', '{}'::jsonb, null, 'percent', 15, 'purchase', 'domestic', date '2008-12-01', date '2009-12-31', 'The Value Added Tax (Change of Rate) Order 2008 (S.I. 2008/3020), art. 2, as closed on 1 January 2010 by the Finance Act 2009, s. 9. Deduction is ss. 24 to 26 of the Act.', 'S', null, 150, 'vat', true, null, false, false, null, 'rate-order-2008'),
  ('GB', 'GB-P-175-1994', 'Purchase, standard rate 17.5 %', '{}'::jsonb, null, 'percent', 17.5, 'purchase', 'domestic', date '1994-09-01', date '2008-11-30', 'Value Added Tax Act 1994, s. 2(1) — VAT is charged at the standard rate on the value of the supply. The rate is a code and a date in this pack, so the four standard rates the Act has carried are four codes: 17.5 % to 30 November 2008, 15 % from 1 December 2008 under S.I. 2008/3020, 17.5 % again from 1 January 2010 when the Finance Act 2009, s. 9 closed that Order, and 20 % from 4 January 2011 under the Finance (No. 2) Act 2010, s. 3. Deduction of the tax so charged is ss. 24 to 26 of the Act.', 'S', null, 140, 'vat', true, null, false, false, null, 'vata-1994'),
  ('GB', 'GB-P-175-2010', 'Purchase, standard rate 17.5 %, second period', '{}'::jsonb, null, 'percent', 17.5, 'purchase', 'domestic', date '2010-01-01', date '2011-01-03', 'Finance Act 2009, s. 9 — the rate of s. 2(1) of the Value Added Tax Act 1994 applies again from 1 January 2010. Deduction is ss. 24 to 26 of the Act.', 'S', null, 160, 'vat', true, null, false, false, null, 'fa-2009-s9'),
  ('GB', 'GB-P-20', 'Purchase, standard rate 20 %', '{}'::jsonb, null, 'percent', 20, 'purchase', 'domestic', date '2011-01-04', null, 'Finance (No. 2) Act 2010, s. 3 for the rate; Value Added Tax Act 1994, ss. 24 to 26 for the credit the buyer takes for it, and s. 25(2) for the deduction of input tax from output tax in the return for the period.', 'S', null, 170, 'vat', true, null, false, false, null, 'fa2-2010-s3'),
  ('GB', 'GB-P-20-DRC-CIS', 'Purchase of construction services, domestic reverse charge 20 %', '{}'::jsonb, 'The customer''s side: boxes 1, 4 and 7, and deliberately not box 6', 'percent', 20, 'purchase', 'domestic_reverse_charge', date '2021-03-01', null, 'Value Added Tax Act 1994, s. 55A and the Value Added Tax (Section 55A) (Specified Services and Excepted Supplies) Order 2019 (S.I. 2019/892), in force 1 March 2021 — the recipient of a specified construction service accounts for the tax as if they had made the supply. The guidance for the charge puts the tax in box 1 and, where it is deductible, in box 4, and the value of the purchase in box 7 only.', 'AE', null, 220, 'vat', true, null, false, false, null, 'drc-guidance'),
  ('GB', 'GB-P-20-ENT', 'Purchase of business entertainment, standard rate 20 % — the tax is not input tax', '{}'::jsonb, 'The VAT follows the account of the line it taxes, because none of it is recoverable', 'percent', 20, 'purchase', 'domestic', date '2011-01-04', null, 'The Value Added Tax (Input Tax) Order 1992 (S.I. 1992/3222), art. 5 — tax charged on goods or services supplied for the purpose of business entertainment is excluded from any credit under ss. 25 and 26 of the Act, except where the entertainment is of employees or, for a body corporate, of its directors, unless that is incidental to entertaining others. A share nobody gets back is part of what the thing cost, so the whole of it lands on the accounts of the lines it taxes and box 4 stays empty.', 'S', null, 210, 'vat', true, null, false, false, null, 'input-tax-order-1992'),
  ('GB', 'GB-P-20-PVA', 'Import of goods, postponed VAT accounting 20 %', '{}'::jsonb, 'The import VAT is declared on the return instead of being paid at the frontier', 'percent', 20, 'purchase', 'import', date '2021-01-01', null, 'Value Added Tax Act 1994, s. 1(1)(c) and s. 15 — VAT is charged on the importation of goods into the United Kingdom. Since 1 January 2021 a VAT-registered importer may account for that tax on their return rather than pay it on entry: the guidance puts the VAT due in box 1, the VAT reclaimed in box 4 and the total value of the imported goods in box 7. The return carries no box for the customs value on its own, so the value here is the one on the supplier''s invoice and not the one on the import declaration.', null, null, 240, 'vat', true, null, false, false, null, 'pva-guidance'),
  ('GB', 'GB-P-20-RCS', 'Service received from a supplier established outside the United Kingdom, reverse charge 20 %', '{}'::jsonb, null, 'percent', 20, 'purchase', 'foreign_services_received', date '2011-01-04', null, 'Value Added Tax Act 1994, s. 8 — where a relevant service is supplied by a person who belongs in a country other than the United Kingdom to a person who belongs here for the purposes of a business, the recipient is treated as having supplied it and as having received it, and accounts for the tax. The rate is the one the recipient charges themselves, which is the standard rate of the Finance (No. 2) Act 2010, s. 3. VAT Notice 700/12 asks for the value of such a service in box 6 and in box 7 at once, which is why it posts to a box of its own that both totals read.', null, null, 250, 'vat', true, null, false, false, null, 'vata-1994'),
  ('GB', 'GB-P-EXEMPT', 'Exempt purchase', '{}'::jsonb, null, 'percent', 0, 'purchase', 'exempt', date '1994-09-01', null, 'Value Added Tax Act 1994, s. 31 and Schedule 9. No exemption reason code, for the reason given on the sale side: no published list carries one for a British exemption.', 'E', null, 200, 'vat', true, null, false, false, null, 'vata-1994'),
  ('GB', 'GB-S-00', 'Sale, zero-rated', '{}'::jsonb, 'Most food, books, children''s clothing and the rest of Schedule 8', 'percent', 0, 'sale', 'domestic', date '1994-09-01', null, 'Value Added Tax Act 1994, s. 30(1) and (2) and Schedule 8 — a supply of a description specified in Schedule 8 is zero-rated, and no VAT is charged on it although it is a taxable supply. A zero-rated supply is not an exempt one: it carries a right to deduct the input tax attributable to it, which is why this pack keeps the two codes apart although VAT Notice 700/12 puts both values in box 6.', 'Z', null, 90, 'vat', true, null, false, false, null, 'vata-1994'),
  ('GB', 'GB-S-05', 'Sale, reduced rate 5 %', '{}'::jsonb, 'Domestic fuel and power, mobility aids, children''s car seats and the rest of Schedule 7A', 'percent', 5, 'sale', 'domestic', date '2001-05-11', null, 'Value Added Tax Act 1994, s. 29A(1) — VAT on a supply of a description for the time being specified in Schedule 7A is charged at 5 per cent. Section 29A and Schedule 7A were inserted by the Finance Act 2001, s. 99(4), in force 11 May 2001; the Treasury may add to, remove from or vary Schedule 7A, and this pack carries the rate and not the list of Groups.', 'S', null, 60, 'vat', true, null, false, false, null, 'vata-1994'),
  ('GB', 'GB-S-05-HOSP', 'Sale, temporary reduced rate 5 % — hospitality, holiday accommodation and attractions', '{}'::jsonb, null, 'percent', 5, 'sale', 'domestic', date '2020-07-15', date '2021-09-30', 'The Value Added Tax (Reduced Rate) (Hospitality and Tourism) (Coronavirus) Order 2020 (S.I. 2020/728) — Groups 14 to 16 were added to Schedule 7A, so catering, holiday accommodation and admission to attractions were charged at 5 per cent from 15 July 2020. The Finance Act 2021, s. 92 substituted 30 September 2021 for the Order''s own end date.', 'S', null, 70, 'vat', true, null, false, false, null, 'hospitality-order-2020'),
  ('GB', 'GB-S-125-HOSP', 'Sale, temporary reduced rate 12.5 % — hospitality, holiday accommodation and attractions', '{}'::jsonb, null, 'percent', 12.5, 'sale', 'domestic', date '2021-10-01', date '2022-03-31', 'Finance Act 2021, s. 93 — the same supplies of Groups 14 to 16 of Schedule 7A are charged at 12.5 per cent for the period beginning with the day after the 5 per cent modifications cease and ending on 31 March 2022.', 'S', null, 80, 'vat', true, null, false, false, null, 'fa-2021-s93'),
  ('GB', 'GB-S-15', 'Sale, standard rate 15 %', '{}'::jsonb, 'The temporary standard rate of 1 December 2008 to 31 December 2009', 'percent', 15, 'sale', 'domestic', date '2008-12-01', date '2009-12-31', 'The Value Added Tax (Change of Rate) Order 2008 (S.I. 2008/3020), art. 2 — the standard rate is reduced to 15 per cent from 1 December 2008. The Order was to cease on 30 November 2009; the Finance Act 2009, s. 9 made it cease on 1 January 2010 instead, so the last supply taxed at 15 per cent is one made on 31 December 2009.', 'S', null, 20, 'vat', true, null, false, false, null, 'rate-order-2008'),
  ('GB', 'GB-S-175-1994', 'Sale, standard rate 17.5 %', '{}'::jsonb, 'The standard rate from the commencement of the Act to 30 November 2008', 'percent', 17.5, 'sale', 'domestic', date '1994-09-01', date '2008-11-30', 'Value Added Tax Act 1994, s. 2(1) — VAT is charged at the standard rate on the value of the supply. The rate is a code and a date in this pack, so the four standard rates the Act has carried are four codes: 17.5 % to 30 November 2008, 15 % from 1 December 2008 under S.I. 2008/3020, 17.5 % again from 1 January 2010 when the Finance Act 2009, s. 9 closed that Order, and 20 % from 4 January 2011 under the Finance (No. 2) Act 2010, s. 3. This code is the rate in force when the Act came into force on 1 September 1994 (s. 101(1)).', 'S', null, 10, 'vat', true, null, false, false, null, 'vata-1994'),
  ('GB', 'GB-S-175-2010', 'Sale, standard rate 17.5 %, second period', '{}'::jsonb, 'The standard rate restored from 1 January 2010 to 3 January 2011', 'percent', 17.5, 'sale', 'domestic', date '2010-01-01', date '2011-01-03', 'Finance Act 2009, s. 9 — the Value Added Tax (Change of Rate) Order 2008 ceases to be in force on 1 January 2010, so s. 2(1) of the Value Added Tax Act 1994 charges 17.5 per cent again from that day until the Finance (No. 2) Act 2010, s. 3 takes effect.', 'S', null, 30, 'vat', true, null, false, false, null, 'fa-2009-s9'),
  ('GB', 'GB-S-20', 'Sale, standard rate 20 %', '{}'::jsonb, 'The standard rate from 4 January 2011', 'percent', 20, 'sale', 'domestic', date '2011-01-04', null, 'Finance (No. 2) Act 2010, s. 3(1) and (3) — 20 per cent is substituted in s. 2(1) of the Value Added Tax Act 1994, with effect for a supply made on or after 4 January 2011.', 'S', null, 40, 'vat', true, null, false, false, null, 'fa2-2010-s3'),
  ('GB', 'GB-S-20-INC', 'Retail sale, standard rate 20 %, the price includes the VAT', '{}'::jsonb, 'For a price set with the tax already in it, as a retail price is', 'percent', 20, 'sale', 'domestic', date '2011-01-04', null, 'Finance (No. 2) Act 2010, s. 3 for the rate. A retail price in the United Kingdom is quoted with the VAT in it, and VAT Notice 700 gives the fraction that takes it back out — the rate divided by one hundred plus the rate, one sixth at 20 per cent. price_include records that the unit price of a line carrying this tax is the gross price; the core has no gross-to-net computation yet, so today it adds the tax on top of that price instead of taking it out.', 'S', null, 50, 'vat', true, null, true, false, null, 'notice-700'),
  ('GB', 'GB-S-DRC-CIS', 'Sale of construction services, domestic reverse charge', '{}'::jsonb, 'The supplier''s side: the value is invoiced and the customer accounts for the tax', 'percent', 0, 'sale', 'domestic_reverse_charge', date '2021-03-01', null, 'Value Added Tax Act 1994, s. 55A, and the Value Added Tax (Section 55A) (Specified Services and Excepted Supplies) Order 2019 (S.I. 2019/892), art. 1 as amended — in force on 1 March 2021 for supplies made on or after that day. The supplier charges no VAT; VAT Notice 700/12 puts the value of the sale in box 6 and nothing in box 1.', 'AE', null, 130, 'vat', true, null, false, false, null, 'drc-order-2019'),
  ('GB', 'GB-S-EXEMPT', 'Exempt sale', '{}'::jsonb, 'Insurance, finance, health, education, betting and the rest of Schedule 9', 'percent', 0, 'sale', 'exempt', date '1994-09-01', null, 'Value Added Tax Act 1994, s. 31(1) and Schedule 9 — a supply of a description specified in Schedule 9 is an exempt supply. The line carries no exemption reason code: BT-121 comes from the VATEX list of EN 16931, which names articles of Directive 2006/112/EC and the national codes of Member States, and the United Kingdom is neither, so what an exempt invoice states here is this article.', 'E', null, 100, 'vat', true, null, false, false, null, 'vata-1994'),
  ('GB', 'GB-S-EXPORT', 'Export of goods outside the United Kingdom', '{}'::jsonb, null, 'percent', 0, 'sale', 'export', date '2021-01-01', null, 'Value Added Tax Act 1994, s. 30(6) — a supply of goods is zero-rated where the Commissioners are satisfied that the goods have been or are to be exported, on the conditions they impose. The code is dated from 1 January 2021 because that is the day the word changed meaning: before it, an export was a supply outside the European Union; since it, it is a supply outside the United Kingdom, and a supply to a Member State is one.', 'G', null, 110, 'vat', true, null, false, false, null, 'vata-1994'),
  ('GB', 'GB-S-OUTSIDE', 'Supply outside the scope of United Kingdom VAT', '{}'::jsonb, 'A supply whose place of supply is not the United Kingdom, such as a business-to-business service to an overseas customer', 'percent', 0, 'sale', 'not_subject', date '1994-09-01', null, 'Value Added Tax Act 1994, s. 4(1) — VAT is charged on a supply of goods or services made in the United Kingdom; ss. 7 and 7A place a supply, and a supply placed elsewhere is outside the scope of the charge. VAT Notice 700/12 puts its value in box 6 all the same.', 'O', null, 120, 'vat', true, null, false, false, null, 'vata-1994')
on conflict (country, code) do update set
  name            = excluded.name,
  name_i18n       = excluded.name_i18n,
  description     = excluded.description,
  amount_type     = excluded.amount_type,
  amount          = excluded.amount,
  applies_to      = excluded.applies_to,
  treatment       = excluded.treatment,
  valid_from      = excluded.valid_from,
  valid_to        = excluded.valid_to,
  legal_reference = excluded.legal_reference,
  vat_category    = excluded.vat_category,
  exemption_code  = excluded.exemption_code,
  sequence        = excluded.sequence,
  tax_kind        = excluded.tax_kind,
  recoverable     = excluded.recoverable,
  jurisdiction    = excluded.jurisdiction,
  price_include   = excluded.price_include,
  cash_basis      = excluded.cash_basis,
  cash_basis_transition_account_code = excluded.cash_basis_transition_account_code,
  source_key      = excluded.source_key;

insert into tax_posting_templates
  (tax_template_id, document_kind, posting_type, factor_percent, account_code,
   declaration_box, box_factor_percent, report_code, sequence)
select t.id,
       v.document_kind::tax_document_kind,
       v.posting_type::tax_posting_type,
       v.factor_percent::numeric,
       v.account_code::text,
       v.declaration_box::text,
       v.box_factor_percent::numeric,
       v.report_code::text,
       v.sequence::integer
  from (values
    ('GB-P-00', 'invoice', 'base', 100, null, '7p', 100, 'GB-VAT-RETURN', 10),
    ('GB-P-00', 'credit_note', 'base', 100, null, '7p', -100, 'GB-VAT-RETURN', 10),
    ('GB-P-05', 'invoice', 'base', 100, null, '7p', 100, 'GB-VAT-RETURN', 10),
    ('GB-P-05', 'invoice', 'tax', 100, '1140', '4', 100, 'GB-VAT-RETURN', 20),
    ('GB-P-05', 'credit_note', 'base', 100, null, '7p', -100, 'GB-VAT-RETURN', 10),
    ('GB-P-05', 'credit_note', 'tax', 100, '1140', '4', -100, 'GB-VAT-RETURN', 20),
    ('GB-P-05-DRC-CIS', 'invoice', 'base', 100, null, '7p', 100, 'GB-VAT-RETURN', 10),
    ('GB-P-05-DRC-CIS', 'invoice', 'tax', 100, '1140', '4', 100, 'GB-VAT-RETURN', 20),
    ('GB-P-05-DRC-CIS', 'invoice', 'tax', -100, '2200', '1', 100, 'GB-VAT-RETURN', 30),
    ('GB-P-05-DRC-CIS', 'credit_note', 'base', 100, null, '7p', -100, 'GB-VAT-RETURN', 10),
    ('GB-P-05-DRC-CIS', 'credit_note', 'tax', 100, '1140', '4', -100, 'GB-VAT-RETURN', 20),
    ('GB-P-05-DRC-CIS', 'credit_note', 'tax', -100, '2200', '1', -100, 'GB-VAT-RETURN', 30),
    ('GB-P-15', 'invoice', 'base', 100, null, '7p', 100, 'GB-VAT-RETURN', 10),
    ('GB-P-15', 'invoice', 'tax', 100, '1140', '4', 100, 'GB-VAT-RETURN', 20),
    ('GB-P-15', 'credit_note', 'base', 100, null, '7p', -100, 'GB-VAT-RETURN', 10),
    ('GB-P-15', 'credit_note', 'tax', 100, '1140', '4', -100, 'GB-VAT-RETURN', 20),
    ('GB-P-175-1994', 'invoice', 'base', 100, null, '7p', 100, 'GB-VAT-RETURN', 10),
    ('GB-P-175-1994', 'invoice', 'tax', 100, '1140', '4', 100, 'GB-VAT-RETURN', 20),
    ('GB-P-175-1994', 'credit_note', 'base', 100, null, '7p', -100, 'GB-VAT-RETURN', 10),
    ('GB-P-175-1994', 'credit_note', 'tax', 100, '1140', '4', -100, 'GB-VAT-RETURN', 20),
    ('GB-P-175-2010', 'invoice', 'base', 100, null, '7p', 100, 'GB-VAT-RETURN', 10),
    ('GB-P-175-2010', 'invoice', 'tax', 100, '1140', '4', 100, 'GB-VAT-RETURN', 20),
    ('GB-P-175-2010', 'credit_note', 'base', 100, null, '7p', -100, 'GB-VAT-RETURN', 10),
    ('GB-P-175-2010', 'credit_note', 'tax', 100, '1140', '4', -100, 'GB-VAT-RETURN', 20),
    ('GB-P-20', 'invoice', 'base', 100, null, '7p', 100, 'GB-VAT-RETURN', 10),
    ('GB-P-20', 'invoice', 'tax', 100, '1140', '4', 100, 'GB-VAT-RETURN', 20),
    ('GB-P-20', 'credit_note', 'base', 100, null, '7p', -100, 'GB-VAT-RETURN', 10),
    ('GB-P-20', 'credit_note', 'tax', 100, '1140', '4', -100, 'GB-VAT-RETURN', 20),
    ('GB-P-20-DRC-CIS', 'invoice', 'base', 100, null, '7p', 100, 'GB-VAT-RETURN', 10),
    ('GB-P-20-DRC-CIS', 'invoice', 'tax', 100, '1140', '4', 100, 'GB-VAT-RETURN', 20),
    ('GB-P-20-DRC-CIS', 'invoice', 'tax', -100, '2200', '1', 100, 'GB-VAT-RETURN', 30),
    ('GB-P-20-DRC-CIS', 'credit_note', 'base', 100, null, '7p', -100, 'GB-VAT-RETURN', 10),
    ('GB-P-20-DRC-CIS', 'credit_note', 'tax', 100, '1140', '4', -100, 'GB-VAT-RETURN', 20),
    ('GB-P-20-DRC-CIS', 'credit_note', 'tax', -100, '2200', '1', -100, 'GB-VAT-RETURN', 30),
    ('GB-P-20-ENT', 'invoice', 'base', 100, null, '7p', 100, 'GB-VAT-RETURN', 10),
    ('GB-P-20-ENT', 'invoice', 'tax_on_base', 100, null, null, 100, null, 20),
    ('GB-P-20-ENT', 'credit_note', 'base', 100, null, '7p', -100, 'GB-VAT-RETURN', 10),
    ('GB-P-20-ENT', 'credit_note', 'tax_on_base', 100, null, null, 100, null, 20),
    ('GB-P-20-PVA', 'invoice', 'base', 100, null, '7p', 100, 'GB-VAT-RETURN', 10),
    ('GB-P-20-PVA', 'invoice', 'tax', 100, '1140', '4', 100, 'GB-VAT-RETURN', 20),
    ('GB-P-20-PVA', 'invoice', 'tax', -100, '2200', '1', 100, 'GB-VAT-RETURN', 30),
    ('GB-P-20-PVA', 'credit_note', 'base', 100, null, '7p', -100, 'GB-VAT-RETURN', 10),
    ('GB-P-20-PVA', 'credit_note', 'tax', 100, '1140', '4', -100, 'GB-VAT-RETURN', 20),
    ('GB-P-20-PVA', 'credit_note', 'tax', -100, '2200', '1', -100, 'GB-VAT-RETURN', 30),
    ('GB-P-20-RCS', 'invoice', 'base', 100, null, '67', 100, 'GB-VAT-RETURN', 10),
    ('GB-P-20-RCS', 'invoice', 'tax', 100, '1140', '4', 100, 'GB-VAT-RETURN', 20),
    ('GB-P-20-RCS', 'invoice', 'tax', -100, '2200', '1', 100, 'GB-VAT-RETURN', 30),
    ('GB-P-20-RCS', 'credit_note', 'base', 100, null, '67', -100, 'GB-VAT-RETURN', 10),
    ('GB-P-20-RCS', 'credit_note', 'tax', 100, '1140', '4', -100, 'GB-VAT-RETURN', 20),
    ('GB-P-20-RCS', 'credit_note', 'tax', -100, '2200', '1', -100, 'GB-VAT-RETURN', 30),
    ('GB-P-EXEMPT', 'invoice', 'base', 100, null, '7p', 100, 'GB-VAT-RETURN', 10),
    ('GB-P-EXEMPT', 'credit_note', 'base', 100, null, '7p', -100, 'GB-VAT-RETURN', 10),
    ('GB-S-00', 'invoice', 'base', 100, null, '6s', 100, 'GB-VAT-RETURN', 10),
    ('GB-S-00', 'credit_note', 'base', 100, null, '6s', -100, 'GB-VAT-RETURN', 10),
    ('GB-S-05', 'invoice', 'base', 100, null, '6s', 100, 'GB-VAT-RETURN', 10),
    ('GB-S-05', 'invoice', 'tax', 100, '2200', '1', 100, 'GB-VAT-RETURN', 20),
    ('GB-S-05', 'credit_note', 'base', 100, null, '6s', -100, 'GB-VAT-RETURN', 10),
    ('GB-S-05', 'credit_note', 'tax', 100, '2200', '1', -100, 'GB-VAT-RETURN', 20),
    ('GB-S-05-HOSP', 'invoice', 'base', 100, null, '6s', 100, 'GB-VAT-RETURN', 10),
    ('GB-S-05-HOSP', 'invoice', 'tax', 100, '2200', '1', 100, 'GB-VAT-RETURN', 20),
    ('GB-S-05-HOSP', 'credit_note', 'base', 100, null, '6s', -100, 'GB-VAT-RETURN', 10),
    ('GB-S-05-HOSP', 'credit_note', 'tax', 100, '2200', '1', -100, 'GB-VAT-RETURN', 20),
    ('GB-S-125-HOSP', 'invoice', 'base', 100, null, '6s', 100, 'GB-VAT-RETURN', 10),
    ('GB-S-125-HOSP', 'invoice', 'tax', 100, '2200', '1', 100, 'GB-VAT-RETURN', 20),
    ('GB-S-125-HOSP', 'credit_note', 'base', 100, null, '6s', -100, 'GB-VAT-RETURN', 10),
    ('GB-S-125-HOSP', 'credit_note', 'tax', 100, '2200', '1', -100, 'GB-VAT-RETURN', 20),
    ('GB-S-15', 'invoice', 'base', 100, null, '6s', 100, 'GB-VAT-RETURN', 10),
    ('GB-S-15', 'invoice', 'tax', 100, '2200', '1', 100, 'GB-VAT-RETURN', 20),
    ('GB-S-15', 'credit_note', 'base', 100, null, '6s', -100, 'GB-VAT-RETURN', 10),
    ('GB-S-15', 'credit_note', 'tax', 100, '2200', '1', -100, 'GB-VAT-RETURN', 20),
    ('GB-S-175-1994', 'invoice', 'base', 100, null, '6s', 100, 'GB-VAT-RETURN', 10),
    ('GB-S-175-1994', 'invoice', 'tax', 100, '2200', '1', 100, 'GB-VAT-RETURN', 20),
    ('GB-S-175-1994', 'credit_note', 'base', 100, null, '6s', -100, 'GB-VAT-RETURN', 10),
    ('GB-S-175-1994', 'credit_note', 'tax', 100, '2200', '1', -100, 'GB-VAT-RETURN', 20),
    ('GB-S-175-2010', 'invoice', 'base', 100, null, '6s', 100, 'GB-VAT-RETURN', 10),
    ('GB-S-175-2010', 'invoice', 'tax', 100, '2200', '1', 100, 'GB-VAT-RETURN', 20),
    ('GB-S-175-2010', 'credit_note', 'base', 100, null, '6s', -100, 'GB-VAT-RETURN', 10),
    ('GB-S-175-2010', 'credit_note', 'tax', 100, '2200', '1', -100, 'GB-VAT-RETURN', 20),
    ('GB-S-20', 'invoice', 'base', 100, null, '6s', 100, 'GB-VAT-RETURN', 10),
    ('GB-S-20', 'invoice', 'tax', 100, '2200', '1', 100, 'GB-VAT-RETURN', 20),
    ('GB-S-20', 'credit_note', 'base', 100, null, '6s', -100, 'GB-VAT-RETURN', 10),
    ('GB-S-20', 'credit_note', 'tax', 100, '2200', '1', -100, 'GB-VAT-RETURN', 20),
    ('GB-S-20-INC', 'invoice', 'base', 100, null, '6s', 100, 'GB-VAT-RETURN', 10),
    ('GB-S-20-INC', 'invoice', 'tax', 100, '2200', '1', 100, 'GB-VAT-RETURN', 20),
    ('GB-S-20-INC', 'credit_note', 'base', 100, null, '6s', -100, 'GB-VAT-RETURN', 10),
    ('GB-S-20-INC', 'credit_note', 'tax', 100, '2200', '1', -100, 'GB-VAT-RETURN', 20),
    ('GB-S-DRC-CIS', 'invoice', 'base', 100, null, '6s', 100, 'GB-VAT-RETURN', 10),
    ('GB-S-DRC-CIS', 'credit_note', 'base', 100, null, '6s', -100, 'GB-VAT-RETURN', 10),
    ('GB-S-EXEMPT', 'invoice', 'base', 100, null, '6s', 100, 'GB-VAT-RETURN', 10),
    ('GB-S-EXEMPT', 'credit_note', 'base', 100, null, '6s', -100, 'GB-VAT-RETURN', 10),
    ('GB-S-EXPORT', 'invoice', 'base', 100, null, '6s', 100, 'GB-VAT-RETURN', 10),
    ('GB-S-EXPORT', 'credit_note', 'base', 100, null, '6s', -100, 'GB-VAT-RETURN', 10),
    ('GB-S-OUTSIDE', 'invoice', 'base', 100, null, '6s', 100, 'GB-VAT-RETURN', 10),
    ('GB-S-OUTSIDE', 'credit_note', 'base', 100, null, '6s', -100, 'GB-VAT-RETURN', 10)
  ) as v (tax_code, document_kind, posting_type, factor_percent, account_code,
          declaration_box, box_factor_percent, report_code, sequence)
  join tax_templates t on t.country = 'GB' and t.code = v.tax_code
on conflict (tax_template_id, document_kind, posting_type, sequence) do update set
  factor_percent     = excluded.factor_percent,
  account_code       = excluded.account_code,
  declaration_box    = excluded.declaration_box,
  box_factor_percent = excluded.box_factor_percent,
  report_code        = excluded.report_code;

insert into tax_report_templates
  (country, code, name, periods, valid_from, valid_to, legal_reference, is_periodic_return)
values
  ('GB', 'GB-VAT-RETURN', 'VAT Return', array['month', 'quarter', 'year']::declaration_period[], date '2021-01-01', null, 'Value Added Tax Act 1994, Schedule 11, paragraph 2 and the Value Added Tax Regulations 1995, reg. 25(1) — every registered person makes a return for each prescribed accounting period, which is a period of three months unless the Commissioners allow or direct another; a month is allowed on application and a year under the annual accounting scheme, so the form is filed on three cadences although the law gives one default. This pack proposes none in defaults.vat_period and lets `ekwo init` ask, because the core judges a proposal by the number of cadences the form accepts and not by what the law says; the gap is written up in docs/international.md, and a company that has asked the Commissioners for nothing files quarterly. Nine boxes, numbered 1 to 9, and their contents are VAT Notice 700/12, whose wording each box below repeats. The version carried here is the one in force since 1 January 2021, when boxes 2, 8 and 9 stopped being about the United Kingdom and became about Northern Ireland alone.', true)
on conflict (country, code) do update set
  name               = excluded.name,
  periods            = excluded.periods,
  valid_from         = excluded.valid_from,
  valid_to           = excluded.valid_to,
  legal_reference    = excluded.legal_reference,
  is_periodic_return = excluded.is_periodic_return;

insert into tax_report_box_templates
  (country, report_code, box, kind, name, name_i18n, sequence,
   plus_boxes, minus_boxes, floor_zero, hidden, xml_element, legal_reference, source_key)
values
  ('GB', 'GB-VAT-RETURN', '1', 'tax', 'VAT due in the period on sales and other outputs', '{}'::jsonb, 10, '{}'::text[], '{}'::text[], false, false, null, 'VAT Notice 700/12, box 1 — the output tax of the period, and with it the tax the person charges themselves: the VAT due on imports accounted for through postponed VAT accounting, the VAT due on a supply on which s. 55A of the Value Added Tax Act 1994 moves the liability to the customer, and the VAT due under s. 8 on a service received from a supplier established outside the United Kingdom.', 'notice-700-12'),
  ('GB', 'GB-VAT-RETURN', '2', 'tax', 'VAT due in the period on acquisitions of goods made in Northern Ireland from EU member states', '{}'::jsonb, 20, '{}'::text[], '{}'::text[], false, false, null, 'VAT Notice 700/12, box 2 — the acquisition tax on goods brought into Northern Ireland from a member State of the European Union since 1 January 2021. This pack carries no tax that posts here: it is the pack of one registration covering Great Britain and Northern Ireland, and only the second of the two is inside the common system of VAT, for goods, which the core''s `territories` table records as `XI` with the article of the Windsor Framework behind it. Modelling that trade is out of this pack''s scope. The box is declared because the form has nine boxes and a return that omitted one would not be this form.', 'notice-700-12'),
  ('GB', 'GB-VAT-RETURN', '3', 'total', 'Total VAT due (the sum of boxes 1 and 2)', '{}'::jsonb, 30, array['1', '2']::text[], '{}'::text[], false, false, null, 'VAT Notice 700/12, box 3 — the total of boxes 1 and 2, which the notice states as an arithmetic and not as an amount anybody books.', 'notice-700-12'),
  ('GB', 'GB-VAT-RETURN', '4', 'tax', 'VAT reclaimed in the period on purchases and other inputs (including acquisitions in Northern Ireland from EU member states)', '{}'::jsonb, 40, '{}'::text[], '{}'::text[], false, false, null, 'VAT Notice 700/12, box 4 — the input tax the person is entitled to deduct under ss. 24 to 26 of the Value Added Tax Act 1994, including the VAT reclaimed on imports accounted for through postponed VAT accounting and the VAT self-assessed under a reverse charge. Tax the Value Added Tax (Input Tax) Order 1992 excludes from credit never reaches this box.', 'notice-700-12'),
  ('GB', 'GB-VAT-RETURN', '5', 'total', 'Net VAT to pay to HMRC or reclaim', '{}'::jsonb, 50, array['3']::text[], array['4']::text[], false, false, null, 'VAT Notice 700/12, box 5 — deduct the number in box 4 from the number in box 3 and enter the difference. The notice''s own arithmetic is a subtraction and this box is written as one, so a repayment period comes out negative here where the printed form shows a positive figure and says which way it goes.', 'notice-700-12'),
  ('GB', 'GB-VAT-RETURN', '6', 'total', 'Total value of sales and all other outputs excluding any VAT', '{}'::jsonb, 60, array['6s', '67']::text[], '{}'::text[], false, false, null, 'VAT Notice 700/12, box 6 — the value, excluding VAT, of everything supplied in the period: standard-rated, reduced-rated, zero-rated, exempt and outside the scope of United Kingdom VAT, and exports. The notice also puts the value of a service received from an overseas supplier in this box as well as in box 7, which is why this box is a total of two: the sales of the period, and that one value, which box 7 adds too.', 'notice-700-12'),
  ('GB', 'GB-VAT-RETURN', '7', 'total', 'Total value of purchases and all other inputs excluding any VAT', '{}'::jsonb, 70, array['7p', '67']::text[], '{}'::text[], false, false, null, 'VAT Notice 700/12, box 7 — the value, excluding VAT, of everything acquired in the period, including imports of goods and the value of a supply on which the customer accounts for the tax under s. 55A. The value of a service received from an overseas supplier is in this box and in box 6 at once, which is the second half of the total.', 'notice-700-12'),
  ('GB', 'GB-VAT-RETURN', '8', 'base', 'Total value of dispatches of goods and related costs (excluding VAT) from Northern Ireland to EU member states', '{}'::jsonb, 80, '{}'::text[], '{}'::text[], false, false, null, 'VAT Notice 700/12, box 8 — goods dispatched from Northern Ireland to a member State of the European Union, with the costs directly related to them. Nothing in this pack posts here, for the same reason as box 2: see `territories` for what `XI` is.', 'notice-700-12'),
  ('GB', 'GB-VAT-RETURN', '9', 'base', 'Total value of acquisitions of goods and related costs (excluding VAT) made in Northern Ireland from EU member states', '{}'::jsonb, 90, '{}'::text[], '{}'::text[], false, false, null, 'VAT Notice 700/12, box 9 — the value that box 2 is the tax on. Nothing in this pack posts here, for the same reason as box 2: see `territories` for what `XI` is.', 'notice-700-12'),
  ('GB', 'GB-VAT-RETURN', '6s', 'base', 'Value of sales and other outputs, other than the services received that boxes 6 and 7 both carry', '{}'::jsonb, 100, '{}'::text[], '{}'::text[], false, true, null, 'The part of box 6 the form does not print separately. A tax writes one taxable amount to one box, and VAT Notice 700/12 asks for the value of a reverse-charge service received in box 6 and in box 7 at the same time; this pack therefore posts every sale here and builds box 6 from this box and from the shared one.', 'notice-700-12'),
  ('GB', 'GB-VAT-RETURN', '7p', 'base', 'Value of purchases and other inputs, other than the services received that boxes 6 and 7 both carry', '{}'::jsonb, 110, '{}'::text[], '{}'::text[], false, true, null, 'The part of box 7 the form does not print separately, and the counterpart of box 6s. Every purchase of the period is posted here, including an import of goods and a purchase of construction services under the domestic reverse charge, which VAT Notice 700/12 puts in box 7 and deliberately not in box 6.', 'notice-700-12'),
  ('GB', 'GB-VAT-RETURN', '67', 'base', 'Value of services received from a supplier established outside the United Kingdom, which box 6 and box 7 both carry', '{}'::jsonb, 120, '{}'::text[], '{}'::text[], false, true, null, 'VAT Notice 700/12 — for a service on which the customer accounts for the tax under s. 8 of the Value Added Tax Act 1994, the customer completes boxes 1, 4, 6 and 7. One amount and two printed boxes: this pack defines it once here and both printed boxes add it.', 'notice-700-12')
on conflict (country, report_code, box, kind) do update set
  name            = excluded.name,
  name_i18n       = excluded.name_i18n,
  sequence        = excluded.sequence,
  plus_boxes      = excluded.plus_boxes,
  minus_boxes     = excluded.minus_boxes,
  floor_zero      = excluded.floor_zero,
  hidden          = excluded.hidden,
  xml_element     = excluded.xml_element,
  legal_reference = excluded.legal_reference,
  source_key      = excluded.source_key;

insert into statement_templates
  (code, country, chart_code, name, kind, framework, valid_from, valid_to, legal_reference)
values
  ('GB-CA-SMALL-BS', 'GB', 'default', 'Balance sheet — Companies Act 2006, small companies regime, Format 1', 'balance_sheet', 'UK-FRS102', date '1970-01-01', null, 'The Small Companies and Groups (Accounts and Directors'' Report) Regulations 2008 (S.I. 2008/409), Schedule 1, Part 1, Section B — Balance sheet Format 1. Companies Act 2006, s. 396(1)(a) and (3): the balance sheet complies with the regulations as to its form and content. Every letter and numeral below is an item of that format and the name is the format''s own wording.'),
  ('GB-CA-SMALL-IS', 'GB', 'default', 'Profit and loss account — Companies Act 2006, small companies regime, Format 1', 'income_statement', 'UK-FRS102', date '1970-01-01', null, 'The Small Companies and Groups (Accounts and Directors'' Report) Regulations 2008 (S.I. 2008/409), Schedule 1, Part 1, Section B — Profit and loss account Format 1. Items 15 to 18, the extraordinary items of the format as originally made, were removed when the formats were amended, so the numbering runs 1 to 14 and then 19 and 20; this pack keeps the numbers the format keeps rather than closing the gap.')
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
  ('GB-CA-SMALL-BS', 'A', null, 'Called up share capital not paid', '{}'::jsonb, 10, 1, false, '{}'::text[], '{}'::text[], null, null),
  ('GB-CA-SMALL-BS', 'B', null, 'Fixed assets', '{}'::jsonb, 20, 1, true, array['B.I', 'B.II', 'B.III']::text[], '{}'::text[], null, null),
  ('GB-CA-SMALL-BS', 'B.I', 'B', 'Intangible assets', '{}'::jsonb, 30, 1, true, array['B.I.1', 'B.I.2']::text[], '{}'::text[], null, null),
  ('GB-CA-SMALL-BS', 'B.I.1', 'B.I', 'Goodwill', '{}'::jsonb, 40, 1, false, '{}'::text[], '{}'::text[], null, null),
  ('GB-CA-SMALL-BS', 'B.I.2', 'B.I', 'Other intangible assets', '{}'::jsonb, 50, 1, false, '{}'::text[], '{}'::text[], null, 'Development costs and patents, trade marks and licences are other intangible assets of Format 1: the format carries two items under B.I and this pack keeps its cost and its accumulated amortisation on adjacent codes so that one range reaches the net figure.'),
  ('GB-CA-SMALL-BS', 'B.II', 'B', 'Tangible assets', '{}'::jsonb, 60, 1, true, array['B.II.1', 'B.II.2']::text[], '{}'::text[], null, null),
  ('GB-CA-SMALL-BS', 'B.II.1', 'B.II', 'Land and buildings', '{}'::jsonb, 70, 1, false, '{}'::text[], '{}'::text[], null, null),
  ('GB-CA-SMALL-BS', 'B.II.2', 'B.II', 'Plant and machinery etc.', '{}'::jsonb, 80, 1, false, '{}'::text[], '{}'::text[], null, 'Format 1 gives tangible assets two items only, so fixtures and fittings, office equipment, computer equipment and motor vehicles all report here.'),
  ('GB-CA-SMALL-BS', 'B.III', 'B', 'Investments', '{}'::jsonb, 90, 1, true, array['B.III.1', 'B.III.2', 'B.III.3', 'B.III.4']::text[], '{}'::text[], null, null),
  ('GB-CA-SMALL-BS', 'B.III.1', 'B.III', 'Shares in group undertakings and participating interests', '{}'::jsonb, 100, 1, false, '{}'::text[], '{}'::text[], null, null),
  ('GB-CA-SMALL-BS', 'B.III.2', 'B.III', 'Loans to group undertakings and undertakings in which the company has a participating interest', '{}'::jsonb, 110, 1, false, '{}'::text[], '{}'::text[], null, null),
  ('GB-CA-SMALL-BS', 'B.III.3', 'B.III', 'Other investments other than loans', '{}'::jsonb, 120, 1, false, '{}'::text[], '{}'::text[], null, null),
  ('GB-CA-SMALL-BS', 'B.III.4', 'B.III', 'Other investments', '{}'::jsonb, 130, 1, false, '{}'::text[], '{}'::text[], null, null),
  ('GB-CA-SMALL-BS', 'C', null, 'Current assets', '{}'::jsonb, 140, 1, true, array['C.I', 'C.II', 'C.III', 'C.IV']::text[], '{}'::text[], null, null),
  ('GB-CA-SMALL-BS', 'C.I', 'C', 'Stocks', '{}'::jsonb, 150, 1, true, array['C.I.1', 'C.I.2']::text[], '{}'::text[], null, null),
  ('GB-CA-SMALL-BS', 'C.I.1', 'C.I', 'Stocks', '{}'::jsonb, 160, 1, false, '{}'::text[], '{}'::text[], null, null),
  ('GB-CA-SMALL-BS', 'C.I.2', 'C.I', 'Payments on account', '{}'::jsonb, 170, 1, false, '{}'::text[], '{}'::text[], null, null),
  ('GB-CA-SMALL-BS', 'C.II', 'C', 'Debtors', '{}'::jsonb, 180, 1, true, array['C.II.1', 'C.II.2', 'C.II.3']::text[], '{}'::text[], null, null),
  ('GB-CA-SMALL-BS', 'C.II.1', 'C.II', 'Trade debtors', '{}'::jsonb, 190, 1, false, '{}'::text[], '{}'::text[], null, null),
  ('GB-CA-SMALL-BS', 'C.II.2', 'C.II', 'Amounts owed by group undertakings and undertakings in which the company has a participating interest', '{}'::jsonb, 200, 1, false, '{}'::text[], '{}'::text[], null, null),
  ('GB-CA-SMALL-BS', 'C.II.3', 'C.II', 'Other debtors', '{}'::jsonb, 210, 1, false, '{}'::text[], '{}'::text[], null, 'The suspense account reaches this line while it is in debit and item E.4 while it is in credit, which is the one way the format lets two lines share an account.'),
  ('GB-CA-SMALL-BS', 'C.III', 'C', 'Investments', '{}'::jsonb, 220, 1, true, array['C.III.1', 'C.III.2']::text[], '{}'::text[], null, null),
  ('GB-CA-SMALL-BS', 'C.III.1', 'C.III', 'Shares in group undertakings', '{}'::jsonb, 230, 1, false, '{}'::text[], '{}'::text[], null, null),
  ('GB-CA-SMALL-BS', 'C.III.2', 'C.III', 'Other investments', '{}'::jsonb, 240, 1, false, '{}'::text[], '{}'::text[], null, null),
  ('GB-CA-SMALL-BS', 'C.IV', 'C', 'Cash at bank and in hand', '{}'::jsonb, 250, 1, false, '{}'::text[], '{}'::text[], null, null),
  ('GB-CA-SMALL-BS', 'D', null, 'Prepayments and accrued income', '{}'::jsonb, 260, 1, false, '{}'::text[], '{}'::text[], null, null),
  ('GB-CA-SMALL-BS', 'E', null, 'Creditors: amounts falling due within one year', '{}'::jsonb, 270, 1, true, array['E.1', 'E.2', 'E.3', 'E.4']::text[], '{}'::text[], null, null),
  ('GB-CA-SMALL-BS', 'E.1', 'E', 'Bank loans and overdrafts', '{}'::jsonb, 280, -1, false, '{}'::text[], '{}'::text[], null, null),
  ('GB-CA-SMALL-BS', 'E.2', 'E', 'Trade creditors', '{}'::jsonb, 290, -1, false, '{}'::text[], '{}'::text[], null, null),
  ('GB-CA-SMALL-BS', 'E.3', 'E', 'Amounts owed to group undertakings and undertakings in which the company has a participating interest', '{}'::jsonb, 300, -1, false, '{}'::text[], '{}'::text[], null, null),
  ('GB-CA-SMALL-BS', 'E.4', 'E', 'Other creditors', '{}'::jsonb, 310, -1, false, '{}'::text[], '{}'::text[], null, 'Format 1 gives creditors within one year four items, so the taxes, the payroll liabilities and the finance lease obligations of this chart all report here.'),
  ('GB-CA-SMALL-BS', 'F', null, 'Net current assets (liabilities)', '{}'::jsonb, 320, 1, true, array['C', 'D']::text[], array['E', 'J']::text[], null, 'Note 5 to Section B of Schedule 1 puts the amount of accruals and deferred income falling due within one year into the computation of this item. This pack has no column that splits item J by maturity, so the whole of it is taken as current, which is how a small company''s accruals almost always are, and item J is therefore deducted here and not again below.'),
  ('GB-CA-SMALL-BS', 'G', null, 'Total assets less current liabilities', '{}'::jsonb, 330, 1, true, array['A', 'B', 'F']::text[], '{}'::text[], null, null),
  ('GB-CA-SMALL-BS', 'H', null, 'Creditors: amounts falling due after more than one year', '{}'::jsonb, 340, 1, true, array['H.1', 'H.2', 'H.3', 'H.4']::text[], '{}'::text[], null, null),
  ('GB-CA-SMALL-BS', 'H.1', 'H', 'Bank loans and overdrafts', '{}'::jsonb, 350, -1, false, '{}'::text[], '{}'::text[], null, null),
  ('GB-CA-SMALL-BS', 'H.2', 'H', 'Trade creditors', '{}'::jsonb, 360, -1, false, '{}'::text[], '{}'::text[], null, null),
  ('GB-CA-SMALL-BS', 'H.3', 'H', 'Amounts owed to group undertakings and undertakings in which the company has a participating interest', '{}'::jsonb, 370, -1, false, '{}'::text[], '{}'::text[], null, null),
  ('GB-CA-SMALL-BS', 'H.4', 'H', 'Other creditors', '{}'::jsonb, 380, -1, false, '{}'::text[], '{}'::text[], null, null),
  ('GB-CA-SMALL-BS', 'I', null, 'Provisions for liabilities', '{}'::jsonb, 390, -1, false, '{}'::text[], '{}'::text[], null, null),
  ('GB-CA-SMALL-BS', 'J', null, 'Accruals and deferred income', '{}'::jsonb, 400, -1, false, '{}'::text[], '{}'::text[], null, null),
  ('GB-CA-SMALL-BS', 'NET', null, 'Net assets (liabilities)', '{}'::jsonb, 410, 1, true, array['G']::text[], array['H', 'I']::text[], null, 'Not an item of Format 1, which ends on item K. It is the figure the items of the format produce and the one a British balance sheet prints above the capital and reserves, so that a reader can see the two agree. They agree only once the year is closed: until close_fiscal_year() carries the result into reserves, net assets exceed capital and reserves by exactly the profit of the income statement.'),
  ('GB-CA-SMALL-BS', 'K', null, 'Capital and reserves', '{}'::jsonb, 420, 1, true, array['K.I', 'K.II', 'K.III', 'K.IV', 'K.V']::text[], '{}'::text[], null, null),
  ('GB-CA-SMALL-BS', 'K.I', 'K', 'Called up share capital', '{}'::jsonb, 430, -1, false, '{}'::text[], '{}'::text[], null, null),
  ('GB-CA-SMALL-BS', 'K.II', 'K', 'Share premium account', '{}'::jsonb, 440, -1, false, '{}'::text[], '{}'::text[], null, null),
  ('GB-CA-SMALL-BS', 'K.III', 'K', 'Revaluation reserve', '{}'::jsonb, 450, -1, false, '{}'::text[], '{}'::text[], null, null),
  ('GB-CA-SMALL-BS', 'K.IV', 'K', 'Other reserves', '{}'::jsonb, 460, -1, false, '{}'::text[], '{}'::text[], null, null),
  ('GB-CA-SMALL-BS', 'K.V', 'K', 'Profit and loss account', '{}'::jsonb, 470, -1, false, '{}'::text[], '{}'::text[], null, 'The United Kingdom closes the year into reserves: there is no current-year result account on this balance sheet, which is why the manifest declares the retained_earnings closing style. A dividend is not part of a close and is booked here by hand.'),
  ('GB-CA-SMALL-IS', '1', null, 'Turnover', '{}'::jsonb, 10, -1, false, '{}'::text[], '{}'::text[], null, 'Sales returns and discounts allowed are inside turnover and reduce it, which is why they are codes of this range rather than a line of their own: Format 1 has one turnover item.'),
  ('GB-CA-SMALL-IS', '2', null, 'Cost of sales', '{}'::jsonb, 20, 1, false, '{}'::text[], '{}'::text[], null, null),
  ('GB-CA-SMALL-IS', '3', null, 'Gross profit or loss', '{}'::jsonb, 30, 1, true, array['1']::text[], array['2']::text[], null, null),
  ('GB-CA-SMALL-IS', '4', null, 'Distribution costs', '{}'::jsonb, 40, 1, false, '{}'::text[], '{}'::text[], null, null),
  ('GB-CA-SMALL-IS', '5', null, 'Administrative expenses', '{}'::jsonb, 50, 1, false, '{}'::text[], '{}'::text[], null, 'Format 1 classifies expenses by function, so the depreciation and amortisation of this chart, the exchange losses and the rounding differences all report here. A company that wants them on a line of their own reports on Format 2, which this pack does not carry.'),
  ('GB-CA-SMALL-IS', '6', null, 'Other operating income', '{}'::jsonb, 60, -1, false, '{}'::text[], '{}'::text[], null, null),
  ('GB-CA-SMALL-IS', '7', null, 'Income from shares in group undertakings', '{}'::jsonb, 70, -1, false, '{}'::text[], '{}'::text[], null, null),
  ('GB-CA-SMALL-IS', '8', null, 'Income from participating interests', '{}'::jsonb, 80, -1, false, '{}'::text[], '{}'::text[], null, null),
  ('GB-CA-SMALL-IS', '9', null, 'Income from other fixed asset investments', '{}'::jsonb, 90, -1, false, '{}'::text[], '{}'::text[], null, null),
  ('GB-CA-SMALL-IS', '10', null, 'Other interest receivable and similar income', '{}'::jsonb, 100, -1, false, '{}'::text[], '{}'::text[], null, null),
  ('GB-CA-SMALL-IS', '11', null, 'Amounts written off investments', '{}'::jsonb, 110, 1, false, '{}'::text[], '{}'::text[], null, null),
  ('GB-CA-SMALL-IS', '12', null, 'Interest payable and similar expenses', '{}'::jsonb, 120, 1, false, '{}'::text[], '{}'::text[], null, null),
  ('GB-CA-SMALL-IS', '13', null, 'Tax on profit or loss', '{}'::jsonb, 130, 1, false, '{}'::text[], '{}'::text[], null, null),
  ('GB-CA-SMALL-IS', '14', null, 'Profit or loss after taxation', '{}'::jsonb, 140, 1, true, array['3', '6', '7', '8', '9', '10']::text[], array['4', '5', '11', '12', '13']::text[], null, null),
  ('GB-CA-SMALL-IS', '19', null, 'Other taxes not shown under the above items', '{}'::jsonb, 150, 1, false, '{}'::text[], '{}'::text[], null, null),
  ('GB-CA-SMALL-IS', '20', null, 'Profit or loss for the financial year', '{}'::jsonb, 160, 1, true, array['14']::text[], array['19']::text[], null, null)
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
    ('GB-CA-SMALL-BS', 'A', 10, 'account_code', '0000', null, null, 'any'),
    ('GB-CA-SMALL-BS', 'B.I.1', 10, 'code_range', '0010', '0011', null, 'any'),
    ('GB-CA-SMALL-BS', 'B.I.2', 10, 'code_range', '0020', '0041', null, 'any'),
    ('GB-CA-SMALL-BS', 'B.II.1', 10, 'code_range', '0100', '0111', null, 'any'),
    ('GB-CA-SMALL-BS', 'B.II.2', 10, 'code_range', '0120', '0161', null, 'any'),
    ('GB-CA-SMALL-BS', 'B.III.1', 10, 'account_code', '0200', null, null, 'any'),
    ('GB-CA-SMALL-BS', 'B.III.2', 10, 'account_code', '0210', null, null, 'any'),
    ('GB-CA-SMALL-BS', 'B.III.3', 10, 'account_code', '0220', null, null, 'any'),
    ('GB-CA-SMALL-BS', 'B.III.4', 10, 'account_code', '0230', null, null, 'any'),
    ('GB-CA-SMALL-BS', 'C.I.1', 10, 'code_range', '1000', '1020', null, 'any'),
    ('GB-CA-SMALL-BS', 'C.I.2', 10, 'account_code', '1030', null, null, 'any'),
    ('GB-CA-SMALL-BS', 'C.II.1', 10, 'code_range', '1100', '1105', null, 'any'),
    ('GB-CA-SMALL-BS', 'C.II.2', 10, 'account_code', '1110', null, null, 'any'),
    ('GB-CA-SMALL-BS', 'C.II.3', 10, 'code_range', '1120', '1160', null, 'any'),
    ('GB-CA-SMALL-BS', 'C.II.3', 20, 'account_code', '2400', null, null, 'debit'),
    ('GB-CA-SMALL-BS', 'C.III.1', 10, 'account_code', '1200', null, null, 'any'),
    ('GB-CA-SMALL-BS', 'C.III.2', 10, 'account_code', '1210', null, null, 'any'),
    ('GB-CA-SMALL-BS', 'C.IV', 10, 'code_range', '1300', '1350', null, 'any'),
    ('GB-CA-SMALL-BS', 'D', 10, 'code_range', '1400', '1420', null, 'any'),
    ('GB-CA-SMALL-BS', 'E.1', 10, 'code_range', '2000', '2020', null, 'any'),
    ('GB-CA-SMALL-BS', 'E.2', 10, 'account_code', '2100', null, null, 'any'),
    ('GB-CA-SMALL-BS', 'E.3', 10, 'account_code', '2110', null, null, 'any'),
    ('GB-CA-SMALL-BS', 'E.4', 10, 'code_range', '2200', '2300', null, 'any'),
    ('GB-CA-SMALL-BS', 'E.4', 20, 'account_code', '2400', null, null, 'credit'),
    ('GB-CA-SMALL-BS', 'H.1', 10, 'code_range', '3000', '3010', null, 'any'),
    ('GB-CA-SMALL-BS', 'H.2', 10, 'account_code', '3020', null, null, 'any'),
    ('GB-CA-SMALL-BS', 'H.3', 10, 'account_code', '3030', null, null, 'any'),
    ('GB-CA-SMALL-BS', 'H.4', 10, 'code_range', '3040', '3050', null, 'any'),
    ('GB-CA-SMALL-BS', 'I', 10, 'code_range', '3100', '3110', null, 'any'),
    ('GB-CA-SMALL-BS', 'J', 10, 'code_range', '3200', '3210', null, 'any'),
    ('GB-CA-SMALL-BS', 'K.I', 10, 'account_code', '3300', null, null, 'any'),
    ('GB-CA-SMALL-BS', 'K.II', 10, 'account_code', '3310', null, null, 'any'),
    ('GB-CA-SMALL-BS', 'K.III', 10, 'account_code', '3320', null, null, 'any'),
    ('GB-CA-SMALL-BS', 'K.IV', 10, 'code_range', '3330', '3340', null, 'any'),
    ('GB-CA-SMALL-BS', 'K.V', 10, 'code_range', '3400', '3410', null, 'any'),
    ('GB-CA-SMALL-IS', '1', 10, 'code_range', '4000', '4110', null, 'any'),
    ('GB-CA-SMALL-IS', '2', 10, 'code_range', '5000', '5240', null, 'any'),
    ('GB-CA-SMALL-IS', '4', 10, 'code_range', '6000', '6500', null, 'any'),
    ('GB-CA-SMALL-IS', '5', 10, 'code_range', '7000', '7710', null, 'any'),
    ('GB-CA-SMALL-IS', '6', 10, 'code_range', '4200', '4240', null, 'any'),
    ('GB-CA-SMALL-IS', '7', 10, 'account_code', '4300', null, null, 'any'),
    ('GB-CA-SMALL-IS', '8', 10, 'account_code', '4310', null, null, 'any'),
    ('GB-CA-SMALL-IS', '9', 10, 'account_code', '4320', null, null, 'any'),
    ('GB-CA-SMALL-IS', '10', 10, 'account_code', '4330', null, null, 'any'),
    ('GB-CA-SMALL-IS', '11', 10, 'account_code', '8100', null, null, 'any'),
    ('GB-CA-SMALL-IS', '12', 10, 'code_range', '8000', '8040', null, 'any'),
    ('GB-CA-SMALL-IS', '13', 10, 'code_range', '8200', '8220', null, 'any'),
    ('GB-CA-SMALL-IS', '19', 10, 'account_code', '8300', null, null, 'any')
  ) as v (statement_code, line_code, sequence, rule_kind, code_from, code_to,
          account_type, balance_side)
on conflict (statement_code, line_code, sequence) do update set
  rule_kind    = excluded.rule_kind,
  code_from    = excluded.code_from,
  code_to      = excluded.code_to,
  account_type = excluded.account_type,
  balance_side = excluded.balance_side;

insert into country_defaults
  (country, name, name_i18n, languages, currency_code, receivable_code, payable_code, suspense_code,
   rounding_code, retained_earnings_code, sales_account_code, purchase_account_code,
   bank_account_code, cash_account_code, sales_journal_code, purchase_journal_code,
   misc_journal_code, language_default, closing_style, current_year_result_profit_code,
   current_year_result_loss_code, retained_earnings_loss_code, opening_journal_code,
   rounding_method, cash_rounding_unit, fx_gain_code, fx_loss_code,
   asset_disposal_gain_code, asset_disposal_loss_code,
   asset_disposal_proceeds_code, asset_disposal_value_code, opening_entry_label,
   vat_period_default)
values
  ('GB', 'United Kingdom', '{}'::jsonb, array['en']::text[], 'GBP', '1100', '2100', '2400', '7710', '3400', '4000', '5000', '1300', '1330', 'SAL', 'PUR', 'GEN', 'en', 'retained_earnings', null, null, null, 'OPN', 'half_up', default, '4240', '7700', '4230', '7690', null, null, null, null)
on conflict (country) do update set
  name                   = excluded.name,
  name_i18n              = excluded.name_i18n,
  languages              = excluded.languages,
  currency_code          = excluded.currency_code,
  receivable_code        = excluded.receivable_code,
  payable_code           = excluded.payable_code,
  suspense_code          = excluded.suspense_code,
  rounding_code          = excluded.rounding_code,
  retained_earnings_code = excluded.retained_earnings_code,
  sales_account_code     = excluded.sales_account_code,
  purchase_account_code  = excluded.purchase_account_code,
  bank_account_code      = excluded.bank_account_code,
  cash_account_code      = excluded.cash_account_code,
  sales_journal_code     = excluded.sales_journal_code,
  purchase_journal_code  = excluded.purchase_journal_code,
  misc_journal_code      = excluded.misc_journal_code,
  language_default       = excluded.language_default,
  closing_style          = excluded.closing_style,
  current_year_result_profit_code = excluded.current_year_result_profit_code,
  current_year_result_loss_code   = excluded.current_year_result_loss_code,
  retained_earnings_loss_code     = excluded.retained_earnings_loss_code,
  opening_journal_code            = excluded.opening_journal_code,
  rounding_method        = excluded.rounding_method,
  cash_rounding_unit     = excluded.cash_rounding_unit,
  fx_gain_code           = excluded.fx_gain_code,
  fx_loss_code           = excluded.fx_loss_code,
  asset_disposal_gain_code        = excluded.asset_disposal_gain_code,
  asset_disposal_loss_code        = excluded.asset_disposal_loss_code,
  asset_disposal_proceeds_code    = excluded.asset_disposal_proceeds_code,
  asset_disposal_value_code       = excluded.asset_disposal_value_code,
  opening_entry_label             = excluded.opening_entry_label,
  vat_period_default              = excluded.vat_period_default;

update country_defaults set
  numbering_gapless             = false,
  number_format                 = '{CODE}-{YYYY}-{NNNN}',
  legal_payment_days            = 30,
  late_payment_reference        = 'Late Payment of Commercial Debts (Interest) Act 1998, s. 4(2H) — where the parties agreed no payment day, the relevant day is the last day of the relevant 30-day period; s. 4(2E) — where the purchaser is not a public authority, an agreed payment day later than the relevant 60-day period does not stand; s. 6 — the rate of statutory interest is set by order of the Secretary of State with the consent of the Treasury; s. 5A — a fixed sum for the cost of recovering the debt, £40 below £1,000, £70 from £1,000 to £9,999.99 and £100 from £10,000, with the reasonable additional costs of recovery on top of it',
  numbering_legal_reference     = 'Value Added Tax Regulations 1995, reg. 14(1)(a) — a VAT invoice states “a sequential number based on one or more series which uniquely identifies the document”. The text imposes the sequence, the series and uniqueness, and never a shape: it does not forbid a hole, which is why `numbering` is `sequential` and not gapless, and the pattern declared in number_format is one of the series it allows rather than a form it prescribes. Regulation 16 lets a retailer issue a less detailed invoice where the consideration does not exceed £250.',
  numbering_source_key          = 'vat-regs-1995',
  payment_terms_legal_reference = 'Late Payment of Commercial Debts (Interest) Act 1998, s. 4(2H) — where the parties agreed no payment day, the relevant day is the last day of the relevant 30-day period, which begins with the later of the performance of the supplier''s obligation and the day the purchaser has notice of the amount of the debt; s. 4(2E) — where the purchaser is not a public authority, an agreed payment day falling later than the relevant 60-day period does not stand. Thirty days is therefore the term the law sets in the absence of an agreement and sixty the ceiling on what two businesses may agree.',
  payment_terms_source_key      = 'lpcd-1998',
  tax_point_rule                = 'invoice_date',
  tax_point_legal_reference     = 'Value Added Tax Act 1994, s. 6 — the basic tax point of a supply of goods is the removal or making available of the goods and of a supply of services their performance (s. 6(2) and (3)), and s. 6(4) and (5) displace it: where a VAT invoice is issued within fourteen days of the basic tax point, or a payment is received or an invoice issued before it, the supply is treated as taking place at that earlier or later date instead. `invoice_date` is the value declared because the invoice governs the ordinary business-to-business case; it is a derogation the Act grants and not the principle, and a supply invoiced outside the fourteen days falls back on the basic tax point.',
  tax_point_source_key          = 'vata-1994',
  einvoice_profile              = 'peppol-bis-3',
  einvoice_mandatory_from       = null,
  einvoice_legal_reference      = 'No United Kingdom statute obliges anybody to issue or receive an electronic invoice, and no date has been set in law. The consultation response of 26 November 2025 records the decision announced at Budget 2025 to make e-invoicing mandatory for all VAT invoices from 2029, on a decentralised four-corner model aligned with Peppol and with EN 16931 as the standard, and says an implementation roadmap will be published at Budget 2026; nothing has been legislated, so mandatory_from is empty rather than a date this pack invented. The profile declared here is what United Kingdom Peppol participants actually exchange and is not a legal requirement. The two identifiers are ISO 6523 codes of the Peppol electronic address scheme list: 0088 is the Global Location Number, under which British parties are commonly addressed, because that list carries no code for a Companies House registration number; 9932 is the United Kingdom VAT number.',
  einvoice_source_key           = 'einvoicing-response',
  party_scheme                  = '0088',
  vat_scheme                    = '9932',
  bank_statement_formats        = array['camt.053', 'ofx', 'mt940', 'csv']::text[],
  payment_formats               = array['bacs', 'pain.001', 'csv']::text[],
  fiscal_year_default           = null
 where country = 'GB';

insert into legal_mention_templates
  (country, code, applies_when, text, text_i18n, sequence, valid_from, valid_to, legal_reference)
values
  ('GB', 'reverse_charge', 'reverse_charge', 'Reverse charge: the customer is to account for the VAT to HMRC.', '{}'::jsonb, 10, date '1970-01-01', null, 'Value Added Tax Regulations 1995, reg. 14(1) — a VAT invoice states, where the supply is one on which the customer is liable to pay the tax, a reference to the reverse charge. Two United Kingdom rules put a customer in that position and this pack prints one sentence for both, because the format offers one condition: VATA 1994, s. 55A and the Value Added Tax (Section 55A) (Specified Services and Excepted Supplies) Order 2019 for construction services supplied between taxable persons here, and VATA 1994, s. 8 for a service received from a supplier who is not established here.'),
  ('GB', 'export', 'export', 'Zero-rated export of goods from the United Kingdom.', '{}'::jsonb, 20, date '1970-01-01', null, 'Value Added Tax Act 1994, s. 30(6) — a supply of goods is zero-rated where the Commissioners are satisfied that the goods have been or are to be exported; Value Added Tax Regulations 1995, reg. 14(1) requires the rate and the amount payable excluding VAT for each description of goods, which on a zero-rated line is nil.'),
  ('GB', 'exempt', 'exempt', 'Exempt supply — no VAT is chargeable.', '{}'::jsonb, 30, date '1970-01-01', null, 'Value Added Tax Act 1994, s. 31 and Schedule 9 — a supply of a description specified in Schedule 9 is an exempt supply. Regulation 13 of the Value Added Tax Regulations 1995 obliges a VAT invoice only on a taxable supply, so a wholly exempt supply carries this sentence on a commercial document rather than on a VAT invoice.'),
  ('GB', 'late_payment', 'late_payment', 'If this invoice is not paid by its due date the supplier is entitled to statutory interest and to a fixed sum for the cost of recovering the debt, under the Late Payment of Commercial Debts (Interest) Act 1998.', '{}'::jsonb, 40, date '1970-01-01', null, 'Late Payment of Commercial Debts (Interest) Act 1998, s. 1(1), s. 4 and s. 5A — an implied term of a contract for the supply of goods or services between businesses')
on conflict (country, code) do update set
  applies_when    = excluded.applies_when,
  text            = excluded.text,
  text_i18n       = excluded.text_i18n,
  sequence        = excluded.sequence,
  valid_from      = excluded.valid_from,
  valid_to        = excluded.valid_to,
  legal_reference = excluded.legal_reference;
