/**
 * The working chart of a company, and the code that stops moving.
 *
 * Two questions that turned out to be one. `accounts_in_use()` answers "which
 * of these three hundred accounts is this company actually working with" by
 * reading what the company points at; the guard on `accounts.code` answers
 * "what happens when somebody renumbers one of them" with a refusal, because
 * the statements and the declaration boxes map by code while every reference
 * inside the company is by id.
 */

import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, expectError, freshDatabase, one, rows } from './helpers/db.js';
import { newCompany, newContact, newDocument, newUser } from './helpers/factory.js';

let db: PGlite;

beforeAll(async () => {
  db = await freshDatabase();
}, 120_000);

afterAll(async () => {
  await db.close();
});

/**
 * Every chart the seeds of this checkout carry, of every country.
 *
 * Not the default chart of each country but all of them, because a country
 * with two charts installs two different sets of accounts and the wiring is
 * what is being asserted. A pack added tomorrow is covered the day its seed
 * lands, which is the point of reading this from the database.
 */
async function seededPacks(): Promise<{ country: string; chart: string }[]> {
  return rows<{ country: string; chart: string }>(
    db,
    `select country, code as chart from chart_templates order by country, code`,
  );
}

/**
 * What the pack of a country says its model points at, read from the template
 * tables rather than from the company the installer wired.
 *
 * This is the independent half of the assertion below: `pin_referenced_accounts`
 * reads the company, this reads the pack, and the two have to agree. A literal
 * count here would only say that the function did what it did.
 */
async function referencedByPack(country: string, chart: string): Promise<string[]> {
  const found = await rows<{ code: string }>(
    db,
    `with named as (
       select unnest(array[d.receivable_code, d.payable_code, d.suspense_code,
                           d.rounding_code, d.retained_earnings_code,
                           d.sales_account_code, d.purchase_account_code,
                           d.bank_account_code, d.cash_account_code]) as code
         from country_defaults d where d.country = $1
       union
       select tp.account_code
         from tax_posting_templates tp
         join tax_templates t on t.id = tp.tax_template_id
        where t.country = $1
       union
       select t.cash_basis_transition_account_code
         from tax_templates t where t.country = $1
     )
     select distinct n.code
       from named n
       join account_templates a
         on a.country = $1 and a.chart_code = $2 and a.code = n.code
      order by 1`,
    [country, chart],
  );
  return found.map((row) => row.code);
}

/**
 * A postable expense account of this company that nothing points at.
 *
 * Picked from the chart rather than written down, because a code is a country
 * literal: `613000` is an expense in Belgium and something else elsewhere, and
 * a test that names one only works on the pack it was written against.
 */
async function spareExpenseAccount(companyId: string, skip: string[] = []): Promise<{ id: string; code: string }> {
  return one<{ id: string; code: string }>(
    db,
    `select a.id, a.code
       from accounts a
      where a.company_id = $1
        and a.account_type = 'expense'
        and not a.pinned
        and not a.deprecated
        and not (a.code = any ($2::text[]))
        and not exists (select 1 from accounts child where child.parent_id = a.id)
        and not exists (select 1 from entry_lines l where l.account_id = a.id)
      order by a.code
      limit 1`,
    [companyId, skip],
  );
}

describe('what an installation pins', () => {
  it('is exactly the set the pack of that country points at, on every pack seeded here', async () => {
    for (const { country, chart } of await seededPacks()) {
      const { companyId } = await newCompany(db, { country, chart });
      const pinned = (
        await rows<{ code: string }>(
          db,
          `select code from accounts where company_id = $1 and pinned order by code`,
          [companyId],
        )
      ).map((row) => row.code);

      expect(pinned, `the pinned chart of ${country}/${chart}`).toEqual(
        await referencedByPack(country, chart),
      );
    }
  });

  it('is a small fraction of the chart, on a chart of a hundred accounts as on one of a thousand', async () => {
    for (const { country, chart } of await seededPacks()) {
      const { companyId } = await newCompany(db, { country, chart });
      const counted = await one<{ pinned: number; total: number }>(
        db,
        `select count(*) filter (where pinned)::int as pinned, count(*)::int as total
           from accounts where company_id = $1`,
        [companyId],
      );
      // A country model wires a dozen-odd accounts whatever the size of the
      // chart: the roles, the two financial accounts and the handful the taxes
      // post to, which overlap heavily. The charts themselves range from a
      // hundred accounts to a thousand, so the assertion is the ratio and a
      // floor, never a number that would have to be edited for the next pack.
      expect(counted.pinned).toBeGreaterThanOrEqual(5);
      expect(counted.pinned).toBeLessThanOrEqual(counted.total / 4);
    }
  });

  it('leaves an account a company already chose for a role alone, and pins it all the same', async () => {
    const { companyId } = await newCompany(db);
    const pinned = await one<{ n: number }>(
      db,
      `select count(*)::int as n from accounts where company_id = $1 and pinned`,
      [companyId],
    );
    // A second call adds nothing: the set is what the company points at, and
    // nothing has moved.
    const after = await one<{ n: number }>(db, `select pin_referenced_accounts($1) as n`, [companyId]);
    expect(after.n).toBe(pinned.n);
  });
});

describe('accounts_in_use', () => {
  it('opens on the pinned set and nothing else, before anything is booked', async () => {
    const { companyId } = await newCompany(db);
    const inUse = await rows<{ code: string }>(
      db,
      `select a.code from accounts_in_use($1) u join accounts a on a.id = u order by a.code`,
      [companyId],
    );
    const pinned = await rows<{ code: string }>(
      db,
      `select code from accounts where company_id = $1 and pinned order by code`,
      [companyId],
    );
    expect(inUse).toEqual(pinned);
  });

  it('adds an account the moment a posted entry touches it, and not before', async () => {
    const { companyId } = await newCompany(db);
    // An expense account no role and no tax points at.
    const { id: account, code } = await spareExpenseAccount(companyId);

    const before = await rows<{ id: string }>(
      db,
      `select u as id from accounts_in_use($1) u where u = $2`,
      [companyId, account],
    );
    expect(before).toEqual([]);

    const contact = await newContact(db, companyId, { type: 'supplier' });
    const document = await newDocument(db, companyId, {
      docType: 'purchase_invoice',
      number: 'PI-1',
      contactId: contact,
      date: '2026-06-15',
      lines: [{ unitPrice: 100, accountCode: code, taxCode: null }],
    });
    await db.query(`select post_document($1)`, [document]);

    const after = await rows<{ id: string }>(
      db,
      `select u as id from accounts_in_use($1) u where u = $2`,
      [companyId, account],
    );
    expect(after).toHaveLength(1);
  });

  it('narrows the movements to the period, and never the references', async () => {
    const { companyId } = await newCompany(db);
    const { id: account, code } = await spareExpenseAccount(companyId);

    const contact = await newContact(db, companyId, { type: 'supplier' });
    const document = await newDocument(db, companyId, {
      docType: 'purchase_invoice',
      number: 'PI-2',
      contactId: contact,
      date: '2026-06-15',
      lines: [{ unitPrice: 100, accountCode: code, taxCode: null }],
    });
    await db.query(`select post_document($1)`, [document]);

    const inJune = await rows(db, `select u from accounts_in_use($1, $2, $3) u where u = $4`, [
      companyId,
      '2026-06-01',
      '2026-06-30',
      account,
    ]);
    expect(inJune).toHaveLength(1);

    const inJuly = await rows(db, `select u from accounts_in_use($1, $2, $3) u where u = $4`, [
      companyId,
      '2026-07-01',
      '2026-07-31',
      account,
    ]);
    expect(inJuly).toEqual([]);

    // The payable account is a role of the company, so a period never takes it
    // out: a reference is a fact about the chart, not about a month.
    const payable = await one<{ id: string }>(
      db,
      `select payable_account_id as id from companies where id = $1`,
      [companyId],
    );
    const roleInJuly = await rows(db, `select u from accounts_in_use($1, $2, $3) u where u = $4`, [
      companyId,
      '2026-07-01',
      '2026-07-31',
      payable.id,
    ]);
    expect(roleInJuly).toHaveLength(1);
  });

  it('leaves a deprecated account out, pinned or moved', async () => {
    const { companyId } = await newCompany(db);
    const payable = await one<{ id: string }>(
      db,
      `select payable_account_id as id from companies where id = $1`,
      [companyId],
    );
    await db.query(`update accounts set deprecated = true where id = $1`, [payable.id]);
    const found = await rows(db, `select u from accounts_in_use($1) u where u = $2`, [
      companyId,
      payable.id,
    ]);
    expect(found).toEqual([]);
    await db.query(`update accounts set deprecated = false where id = $1`, [payable.id]);
  });

  it('counts what a module the company has enabled points at, and nothing of a module it has not', async () => {
    const { companyId, ownerId } = await newCompany(db);
    const { id: account } = await spareExpenseAccount(companyId);

    await asUser(db, ownerId, async () => {
      await db.query(`select enable_module($1, 'budgets')`, [companyId]);
      const budget = await one<{ id: string }>(
        db,
        `insert into budgets.budgets (company_id, code, name)
         values ($1, 'B2026', 'Budget 2026') returning id`,
        [companyId],
      );
      await db.query(
        `insert into budgets.lines (budget_id, company_id, account_id, period_start, period_end, amount)
         values ($1, $2, $3, '2026-01-01', '2026-12-31', 1000)`,
        [budget.id, companyId, account],
      );
    });

    const withModule = await rows(db, `select u from accounts_in_use($1) u where u = $2`, [
      companyId,
      account,
    ]);
    expect(withModule).toHaveLength(1);

    // The same budget line, on a company that never enabled the module, is not
    // reachable at all — but the point here is the other company's set is its
    // own.
    const other = await newCompany(db);
    const elsewhere = await rows(db, `select u from accounts_in_use($1) u`, [other.companyId]);
    expect(elsewhere.length).toBeGreaterThan(0);
    expect(elsewhere).not.toContainEqual({ u: account });
  });

  it('answers a member of the company and shows a stranger nothing', async () => {
    const { companyId, ownerId } = await newCompany(db);
    await db.query(`insert into auth.users (id, email) values ($1, $2) on conflict do nothing`, [
      ownerId,
      `${ownerId}@example.test`,
    ]);

    const mine = await asUser(db, ownerId, async () =>
      rows(db, `select u from accounts_in_use($1) u`, [companyId]),
    );
    expect(mine.length).toBeGreaterThan(10);

    const stranger = await newUser(db);
    const theirs = await asUser(db, stranger, async () =>
      rows(db, `select u from accounts_in_use($1) u`, [companyId]),
    );
    expect(theirs).toEqual([]);
  });
});

describe('pinning', () => {
  it('is an ordinary update a member with write may make, and a stranger may not', async () => {
    const { companyId, ownerId } = await newCompany(db);
    await db.query(`insert into auth.users (id, email) values ($1, $2) on conflict do nothing`, [
      ownerId,
      `${ownerId}@example.test`,
    ]);
    const { id: account } = await spareExpenseAccount(companyId);

    await asUser(db, ownerId, async () => {
      await db.query(`update accounts set pinned = true where id = $1`, [account]);
    });
    const pinned = await one<{ pinned: boolean }>(db, `select pinned from accounts where id = $1`, [
      account,
    ]);
    expect(pinned.pinned).toBe(true);

    const stranger = await newUser(db);
    await asUser(db, stranger, async () => {
      const result = await db.query(`update accounts set pinned = false where id = $1`, [account]);
      expect(result.affectedRows ?? 0).toBe(0);
    });
    const still = await one<{ pinned: boolean }>(db, `select pinned from accounts where id = $1`, [
      account,
    ]);
    expect(still.pinned).toBe(true);
  });

  it('restricts nothing: an unpinned account still takes a document line', async () => {
    const { companyId } = await newCompany(db);
    const { code } = await spareExpenseAccount(companyId);
    const contact = await newContact(db, companyId, { type: 'supplier' });
    const document = await newDocument(db, companyId, {
      docType: 'purchase_invoice',
      number: 'PI-3',
      contactId: contact,
      date: '2026-06-15',
      lines: [{ unitPrice: 50, accountCode: code, taxCode: null }],
    });
    await db.query(`select post_document($1)`, [document]);
    const entry = await one<{ n: number }>(
      db,
      `select count(*)::int as n from entry_lines l
         join accounts a on a.id = l.account_id
        where a.company_id = $1 and a.code = $2`,
      [companyId, code],
    );
    expect(entry.n).toBe(1);
  });
});

describe('the code of an account', () => {
  it('stops moving once a line of the ledger carries it', async () => {
    const { companyId } = await newCompany(db);
    const { code } = await spareExpenseAccount(companyId);
    const contact = await newContact(db, companyId, { type: 'supplier' });
    const document = await newDocument(db, companyId, {
      docType: 'purchase_invoice',
      number: 'PI-4',
      contactId: contact,
      date: '2026-06-15',
      lines: [{ unitPrice: 75, accountCode: code, taxCode: null }],
    });
    await db.query(`select post_document($1)`, [document]);

    const message = await expectError(
      db,
      `update accounts set code = code || '9' where company_id = $1 and code = $2`,
      [companyId, code],
    );
    expect(message).toContain('account_code_frozen');
  });

  it('stops moving on an account a tax posts to, before anything is booked', async () => {
    const { companyId } = await newCompany(db);
    const posted = await one<{ code: string }>(
      db,
      `select a.code from tax_postings tp join accounts a on a.id = tp.account_id
        where tp.company_id = $1 limit 1`,
      [companyId],
    );
    const message = await expectError(
      db,
      `update accounts set code = code || '9' where company_id = $1 and code = $2`,
      [companyId, posted.code],
    );
    expect(message).toContain('account_code_frozen');
  });

  it('stops moving on an account playing a role of the company', async () => {
    const { companyId } = await newCompany(db);
    const message = await expectError(
      db,
      `update accounts set code = code || '9'
        where id = (select receivable_account_id from companies where id = $1)`,
      [companyId],
    );
    expect(message).toContain('account_code_frozen');
  });

  it('still moves on an account nothing has touched', async () => {
    const { companyId } = await newCompany(db);
    const { id, code } = await spareExpenseAccount(companyId);
    await db.query(`update accounts set code = $2 where id = $1`, [id, `${code}-moved`]);
    const moved = await one<{ code: string }>(db, `select code from accounts where id = $1`, [id]);
    expect(moved.code).toBe(`${code}-moved`);
  });

  it('leaves the label, the notes, the parent and the flags free on a used account', async () => {
    const { companyId } = await newCompany(db);
    const { code } = await spareExpenseAccount(companyId);
    const contact = await newContact(db, companyId, { type: 'supplier' });
    const document = await newDocument(db, companyId, {
      docType: 'purchase_invoice',
      number: 'PI-5',
      contactId: contact,
      date: '2026-06-15',
      lines: [{ unitPrice: 20, accountCode: code, taxCode: null }],
    });
    await db.query(`select post_document($1)`, [document]);

    await db.query(
      `update accounts
          set name = 'A better label', notes = 'why it is used', reconcilable = false,
              pinned = true, deprecated = false
        where company_id = $1 and code = $2`,
      [companyId, code],
    );
    const renamed = await one<{ name: string; pinned: boolean }>(
      db,
      `select name, pinned from accounts where company_id = $1 and code = $2`,
      [companyId, code],
    );
    expect(renamed.name).toBe('A better label');
    expect(renamed.pinned).toBe(true);
  });
});

describe('the type of an account', () => {
  it('stops moving once the account is in use, because it is what places it on a statement', async () => {
    const { companyId } = await newCompany(db);
    const { code } = await spareExpenseAccount(companyId);
    const contact = await newContact(db, companyId, { type: 'supplier' });
    const document = await newDocument(db, companyId, {
      docType: 'purchase_invoice',
      number: 'PI-6',
      contactId: contact,
      date: '2026-06-15',
      lines: [{ unitPrice: 30, accountCode: code, taxCode: null }],
    });
    await db.query(`select post_document($1)`, [document]);

    const message = await expectError(
      db,
      `update accounts set account_type = 'asset_current' where company_id = $1 and code = $2`,
      [companyId, code],
    );
    expect(message).toContain('account_type_frozen');
  });

  it('still moves on an account nothing has touched', async () => {
    const { companyId } = await newCompany(db);
    const { id } = await spareExpenseAccount(companyId);
    await db.query(`update accounts set account_type = 'expense_direct_cost' where id = $1`, [id]);
    const moved = await one<{ account_type: string }>(
      db,
      `select account_type from accounts where id = $1`,
      [id],
    );
    expect(moved.account_type).toBe('expense_direct_cost');
  });
});
