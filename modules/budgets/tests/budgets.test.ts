import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, expectError, freshDatabase, one, rows } from '../../../tests/helpers/db.js';
import { newCompany, newContact, newDocument } from '../../../tests/helpers/factory.js';

// `budgets` is the module that proves the mechanism holds for something that
// is not `assets`: no country data, no pack section, no seed, and not one line
// written to the ledger. What it needs from the socle is a read and a row level
// security helper, and what it needs from the module framework is the registry
// row and `module_enabled()`.

let db: PGlite;
let companyId: string;
let ownerId: string;
let budgetId: string;

beforeAll(async () => {
  db = await freshDatabase();
  const fixture = await newCompany(db, { country: 'BE', name: 'Budget SRL' });
  companyId = fixture.companyId;
  ownerId = fixture.ownerId;

  await asUser(db, ownerId, async () => {
    await db.query(`select enable_module($1, 'budgets')`, [companyId]);
  });

  // 1 000 of revenue and 400 of cost, both posted inside 2026.
  const customer = await newContact(db, companyId, { name: 'Cliente' });
  const supplier = await newContact(db, companyId, { name: 'Fournisseur', type: 'supplier' });
  const sale = await newDocument(db, companyId, {
    docType: 'sale_invoice',
    number: 'FAC-2026-0001',
    contactId: customer,
    date: '2026-03-10',
    lines: [{ unitPrice: 1000, taxCode: 'BE-S-21', accountCode: '704000' }],
  });
  const purchase = await newDocument(db, companyId, {
    docType: 'purchase_invoice',
    number: 'ACH-2026-0001',
    contactId: supplier,
    date: '2026-04-10',
    lines: [{ unitPrice: 400, taxCode: 'BE-P-21-G', accountCode: '610000' }],
  });
  await db.query(`select post_document($1)`, [sale]);
  await db.query(`select post_document($1)`, [purchase]);

  const budget = await one<{ id: string }>(
    db,
    `insert into budgets.budgets (company_id, fiscal_year_id, code, name, state)
     values ($1, (select id from fiscal_years where company_id = $1 limit 1),
             'B2026', 'Budget 2026', 'approved')
     returning id`,
    [companyId],
  );
  budgetId = budget.id;

  await db.query(
    `insert into budgets.lines (budget_id, company_id, account_id, period_start, period_end, amount)
     values ($1, $2, account_id_by_code($2, '704000'), date '2026-01-01', date '2026-12-31', 1200),
            ($1, $2, account_id_by_code($2, '610000'), date '2026-01-01', date '2026-12-31', 500)`,
    [budgetId, companyId],
  );
});

afterAll(async () => {
  await db.close();
});

describe('the variance', () => {
  it('compares the plan to the ledger, to the cent, in the sign a business states it', async () => {
    // An income account carries a credit balance; a budget says "1 200 of
    // revenue". So the ledger figure is flipped on income and left alone
    // everywhere else, and both come out positive.
    const variance = await rows<Record<string, string>>(
      db,
      `select account_code, budget, actual, variance
         from budgets.variance($1, $2, date '2026-01-01', date '2026-12-31')`,
      [companyId, budgetId],
    );
    expect(variance).toEqual([
      { account_code: '610000', budget: '500.00', actual: '400.00', variance: '-100.00' },
      { account_code: '704000', budget: '1200.00', actual: '1000.00', variance: '-200.00' },
    ]);
  });

  it('takes a budget line whole or not at all', async () => {
    // A line is a figure for a period, so a window that does not contain the
    // whole of it selects nothing. Splitting one would mean inventing how a
    // year is spread over two months, which is a decision the person writing
    // the budget makes by writing monthly lines.
    const variance = await rows(
      db,
      `select account_code from budgets.variance($1, $2, date '2026-01-01', date '2026-02-28')`,
      [companyId, budgetId],
    );
    expect(variance).toEqual([]);
  });

  it('reads a monthly budget month by month', async () => {
    const monthly = await one<{ id: string }>(
      db,
      `insert into budgets.budgets (company_id, code, name) values ($1, 'B2026-M', 'Budget mensuel 2026')
       returning id`,
      [companyId],
    );
    await db.query(
      `insert into budgets.lines (budget_id, company_id, account_id, period_start, period_end, amount)
       select $1, $2, account_id_by_code($2, '704000'),
              make_date(2026, m, 1),
              (make_date(2026, m, 1) + interval '1 month' - interval '1 day')::date,
              100
         from generate_series(1, 12) as m`,
      [monthly.id, companyId],
    );

    const march = await rows<Record<string, string>>(
      db,
      `select account_code, budget, actual, variance
         from budgets.variance($1, $2, date '2026-03-01', date '2026-03-31')`,
      [companyId, monthly.id],
    );
    expect(march).toEqual([
      { account_code: '704000', budget: '100.00', actual: '1000.00', variance: '900.00' },
    ]);

    const year = await one<Record<string, string>>(
      db,
      `select budget, actual from budgets.variance($1, $2, date '2026-01-01', date '2026-12-31')`,
      [companyId, monthly.id],
    );
    expect(year).toEqual({ budget: '1200.00', actual: '1000.00' });
  });

  it('is unchanged by closing the year, because a closing entry is not what a period earned', async () => {
    const before = await rows<{ actual: string }>(
      db,
      `select actual from budgets.variance($1, $2, date '2026-01-01', date '2026-12-31')`,
      [companyId, budgetId],
    );
    await db.query(
      `select close_fiscal_year(id) from fiscal_years where company_id = $1 and start_date = date '2026-01-01'`,
      [companyId],
    );
    const after = await rows<{ actual: string }>(
      db,
      `select actual from budgets.variance($1, $2, date '2026-01-01', date '2026-12-31')`,
      [companyId, budgetId],
    );
    expect(after).toEqual(before);
    expect(after.map((v) => v.actual)).toEqual(['400.00', '1000.00']);

    await db.query(
      `select reopen_fiscal_year(id) from fiscal_years where company_id = $1 and start_date = date '2026-01-01'`,
      [companyId],
    );
  });
});

describe('the module writes nothing to the ledger', () => {
  it('leaves no entry of its own anywhere', async () => {
    const entries = await rows(
      db,
      `select id from entries where module_code = 'budgets'`,
    );
    expect(entries).toEqual([]);
  });

  it('says so in its registry row and in its manifest', async () => {
    const module = await one<{ schema_name: string; status: string }>(
      db,
      `select schema_name, status::text from modules where code = 'budgets'`,
    );
    expect(module).toEqual({ schema_name: 'budgets', status: 'available' });
  });
});

describe('row level security', () => {
  it('shows a member of another company nothing', async () => {
    const stranger = await newCompany(db, { country: 'BE', name: 'Voisine SRL' });
    const seen = await asUser(db, stranger.ownerId, () =>
      rows(db, `select id from budgets.budgets`),
    );
    expect(seen).toEqual([]);
  });

  it('shows a member their own budget', async () => {
    const seen = await asUser(db, ownerId, () =>
      rows<{ code: string }>(db, `select code from budgets.budgets order by code`),
    );
    expect(seen.map((r) => r.code)).toEqual(['B2026', 'B2026-M']);
  });

  it('refuses a line written by a viewer', async () => {
    const viewer = crypto.randomUUID();
    await db.query(
      `insert into company_members (company_id, user_id, role) values ($1, $2, 'viewer')`,
      [companyId, viewer],
    );
    const message = await asUser(db, viewer, () =>
      expectError(
        db,
        `insert into budgets.lines (budget_id, company_id, account_id, period_start, period_end, amount)
         values ($1, $2, account_id_by_code($2, '610000'), date '2027-01-01', date '2027-12-31', 1)`,
        [budgetId, companyId],
      ),
    );
    expect(message).toMatch(/row-level security|violates/i);
  });
});

describe('disabling it', () => {
  it('is allowed even with rows in it, because the module writes no can_disable', async () => {
    // The other half of the convention `disable_module()` follows: `assets`
    // answers with a sentence and is refused, `budgets` answers nothing at all
    // because there is nothing to lose — the rows stay where they are.
    await asUser(db, ownerId, async () => {
      await db.query(`select disable_module($1, 'budgets')`, [companyId]);
    });

    const hidden = await asUser(db, ownerId, () => rows(db, `select id from budgets.budgets`));
    expect(hidden).toEqual([]);

    const kept = await one<{ n: number }>(
      db,
      `select count(*)::int as n from budgets.budgets where company_id = $1`,
      [companyId],
    );
    expect(kept.n).toBe(2);
  });

  it('gives them back when the module is enabled again', async () => {
    await asUser(db, ownerId, async () => {
      await db.query(`select enable_module($1, 'budgets')`, [companyId]);
    });
    const seen = await asUser(db, ownerId, () =>
      rows<{ code: string }>(db, `select code from budgets.budgets order by code`),
    );
    expect(seen.map((r) => r.code)).toEqual(['B2026', 'B2026-M']);
  });
});
