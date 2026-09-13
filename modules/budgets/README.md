# `budgets` — what was planned, against what was booked

One Postgres schema, `budgets`. It is the module that proves the mechanism
holds for something that is not `assets`: **no country data at all** and **not
one line written to the ledger**.

| Object | What it is |
|---|---|
| `budgets.budgets` | One budget of one company, usually for one financial year. |
| `budgets.lines` | What one account is expected to carry over one period. |
| `budgets.variance(company, budget, from, to)` | The plan against the ledger, per account. |

```sql
insert into budgets.budgets (company_id, fiscal_year_id, code, name)
values (:company, :year, 'B2026', 'Budget 2026');

insert into budgets.lines (budget_id, company_id, account_id, period_start, period_end, amount)
values (:budget, :company, account_id_by_code(:company, '704000'),
        date '2026-01-01', date '2026-12-31', 1200);

select * from budgets.variance(:company, :budget, date '2026-01-01', date '2026-12-31');
```

## Three decisions worth knowing

**The sign is the one a business says out loud.** An income of 100 000 and a
cost of 60 000 are both positive numbers. The ledger does not work that way — an
income account carries a credit balance — so the comparison multiplies the
ledger balance by −1 on an income account and by +1 everywhere else. The rule
comes from `accounts.internal_group`, which is derived from the account type,
so there is nothing to fill in and nothing to get wrong.

**A budget line is taken whole or not at all.** A line is a figure for a
period, so a window that does not contain the whole of it selects nothing.
Splitting one would mean inventing how a year is spread over two months, which
is a decision the person writing the budget makes — by writing monthly lines.

**Actual is posted entries of kind `normal`.** A closing entry is the mirror
image of the year and an appropriation entry moves its result; neither is
something a budget planned, and leaving them in would make a closed year read
as a variance of exactly minus the budget. It is the same exclusion
`financial_statement()` makes on an income statement.

## It writes no `can_disable`

That is deliberate, and it is the other half of the convention
`disable_module()` follows. `assets.can_disable()` answers with a sentence
while depreciation has been booked, and the disable is refused. `budgets` has
no such function at all, so disabling it is allowed whatever it holds: the rows
stay where they are, row level security hides them, and enabling the module
again gives them back. A module that holds nothing a company would lose writes
nothing.

## Enabling it

```sh
ekwo module migrate budgets
ekwo module enable budgets --company "…"
```

Then add `budgets` to the project's exposed schemas.
