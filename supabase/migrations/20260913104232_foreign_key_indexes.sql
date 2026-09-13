-- Ekwo OS — a foreign key without an index is a sequential scan waiting for
-- a big enough table.
--
-- Postgres indexes the *referenced* side of a foreign key, because that side
-- is a primary key. It indexes nothing on the referencing side. Two things
-- then read the whole table:
--
--   * every delete or key update of the parent, which has to prove no child
--     points at the row — deleting one contact scans `entry_lines`;
--   * every join written the natural way, which for an accounting core is
--     most of them: a document to its lines, an entry to its lines, a line to
--     its account, its tax, its contact.
--
-- On the demo company nothing is slow, which is exactly why this survived 49
-- migrations. On a company with four years of books it is the difference
-- between a report and a timeout.
--
-- 71 indexes: every foreign key of the socle that had none, and the
-- `company_id` of the tables that had none either — which the sweep covers,
-- because `company_id` is itself a foreign key everywhere it appears.
--
-- Where a table has both a single-column key and a composite one leading with
-- the same column — `(account_id)` and `(account_id, company_id)`, the shape
-- this schema uses to keep a child in its parent's company — one index on the
-- composite serves both, and that is the one created.
--
-- The list is not maintained by hand. `tests/schema.test.ts` asks the
-- catalogue the same question and fails when the answer is not empty, so a
-- foreign key added later arrives with its index or the build says so.


-- public.accounts
create index if not exists accounts_currency_idx on accounts (currency_code);

-- public.analytic_values
create index if not exists analytic_values_axis_company_idx on analytic_values (axis_id, company_id);
create index if not exists analytic_values_company_idx on analytic_values (company_id);

-- public.bank_accounts
create index if not exists bank_accounts_account_company_idx on bank_accounts (account_id, company_id);
create index if not exists bank_accounts_currency_idx on bank_accounts (currency_code);
create index if not exists bank_accounts_journal_company_idx on bank_accounts (journal_id, company_id);

-- public.bank_statements
create index if not exists bank_statements_bank_account_company_idx on bank_statements (bank_account_id, company_id);
create index if not exists bank_statements_company_idx on bank_statements (company_id);

-- public.bank_transactions
create index if not exists bank_transactions_bank_account_company_idx on bank_transactions (bank_account_id, company_id);
create index if not exists bank_transactions_contact_company_idx on bank_transactions (contact_id, company_id);
create index if not exists bank_transactions_currency_idx on bank_transactions (currency_code);
create index if not exists bank_transactions_entry_company_idx on bank_transactions (entry_id, company_id);
create index if not exists bank_transactions_statement_company_idx on bank_transactions (statement_id, company_id);

-- public.companies
create index if not exists companies_default_bank_account_idx on companies (default_bank_account_id);
create index if not exists companies_default_purchase_account_idx on companies (default_purchase_account_id);
create index if not exists companies_default_sales_account_idx on companies (default_sales_account_id);
create index if not exists companies_miscellaneous_journal_idx on companies (miscellaneous_journal_id);
create index if not exists companies_payable_account_idx on companies (payable_account_id);
create index if not exists companies_purchase_journal_idx on companies (purchase_journal_id);
create index if not exists companies_receivable_account_idx on companies (receivable_account_id);
create index if not exists companies_retained_earnings_account_idx on companies (retained_earnings_account_id);
create index if not exists companies_rounding_account_idx on companies (rounding_account_id);
create index if not exists companies_sales_journal_idx on companies (sales_journal_id);
create index if not exists companies_share_capital_currency_idx on companies (share_capital_currency);
create index if not exists companies_suspense_account_idx on companies (suspense_account_id);

-- public.contacts
create index if not exists contacts_currency_idx on contacts (currency_code);
create index if not exists contacts_payable_account_idx on contacts (payable_account_id);
create index if not exists contacts_receivable_account_idx on contacts (receivable_account_id);

-- public.document_lines
create index if not exists document_lines_account_company_idx on document_lines (account_id, company_id);
create index if not exists document_lines_company_idx on document_lines (company_id);
create index if not exists document_lines_document_company_idx on document_lines (document_id, company_id);
create index if not exists document_lines_product_company_idx on document_lines (product_id, company_id);
create index if not exists document_lines_tax_company_idx on document_lines (tax_id, company_id);

-- public.documents
create index if not exists documents_contact_company_idx on documents (contact_id, company_id);
create index if not exists documents_currency_idx on documents (currency_code);
create index if not exists documents_entry_company_idx on documents (entry_id, company_id);
create index if not exists documents_journal_company_idx on documents (journal_id, company_id);
create index if not exists documents_reversed_document_idx on documents (reversed_document_id);

-- public.entries
create index if not exists entries_currency_idx on entries (currency_code);
create index if not exists entries_journal_company_idx on entries (journal_id, company_id);
-- `entries_module_idx` is taken, by `(company_id, module_code)` — which does
-- not lead with `module_code`, so it does not serve the foreign key to
-- `modules`.
create index if not exists entries_module_code_idx on entries (module_code);
create index if not exists entries_reversed_entry_idx on entries (reversed_entry_id);

-- public.entry_line_analytics
create index if not exists entry_line_analytics_analytic_value_company_idx on entry_line_analytics (analytic_value_id, company_id);
create index if not exists entry_line_analytics_company_idx on entry_line_analytics (company_id);
create index if not exists entry_line_analytics_entry_line_company_idx on entry_line_analytics (entry_line_id, company_id);

-- public.entry_lines
create index if not exists entry_lines_account_company_idx on entry_lines (account_id, company_id);
create index if not exists entry_lines_contact_company_idx on entry_lines (contact_id, company_id);
create index if not exists entry_lines_currency_idx on entry_lines (currency_code);
create index if not exists entry_lines_entry_company_idx on entry_lines (entry_id, company_id);
create index if not exists entry_lines_tax_company_idx on entry_lines (tax_id, company_id);

-- public.journals
create index if not exists journals_bank_account_idx on journals (bank_account_id);
create index if not exists journals_currency_idx on journals (currency_code);
create index if not exists journals_default_account_idx on journals (default_account_id);
create index if not exists journals_suspense_account_idx on journals (suspense_account_id);

-- public.payments
create index if not exists payments_bank_account_idx on payments (bank_account_id);
create index if not exists payments_contact_company_idx on payments (contact_id, company_id);
create index if not exists payments_currency_idx on payments (currency_code);
create index if not exists payments_entry_company_idx on payments (entry_id, company_id);
create index if not exists payments_journal_company_idx on payments (journal_id, company_id);

-- public.products
create index if not exists products_currency_idx on products (currency_code);
create index if not exists products_purchase_account_company_idx on products (purchase_account_id, company_id);
create index if not exists products_purchase_tax_company_idx on products (purchase_tax_id, company_id);
create index if not exists products_sale_account_company_idx on products (sale_account_id, company_id);
create index if not exists products_sale_tax_company_idx on products (sale_tax_id, company_id);

-- public.reconciliations
create index if not exists reconciliations_credit_line_company_idx on reconciliations (credit_line_id, company_id);
create index if not exists reconciliations_debit_line_company_idx on reconciliations (debit_line_id, company_id);

-- public.role_capabilities
create index if not exists role_capabilities_capability_idx on role_capabilities (capability);

-- public.tax_postings
create index if not exists tax_postings_account_company_idx on tax_postings (account_id, company_id);
create index if not exists tax_postings_tax_company_idx on tax_postings (tax_id, company_id);

-- public.taxes
create index if not exists taxes_cash_basis_transition_account_company_idx on taxes (cash_basis_transition_account_id, company_id);

-- public.user_preferences
create index if not exists user_preferences_preferred_company_idx on user_preferences (preferred_company_id);
