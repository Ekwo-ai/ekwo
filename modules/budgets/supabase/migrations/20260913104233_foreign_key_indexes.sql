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
-- 3 indexes: every foreign key of the `budgets` module that had none, and the
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


-- budgets.budgets
create index if not exists budgets_fiscal_year_idx on budgets.budgets (fiscal_year_id);

-- budgets.lines
create index if not exists lines_account_company_idx on budgets.lines (account_id, company_id);
create index if not exists lines_budget_company_idx on budgets.lines (budget_id, company_id);
