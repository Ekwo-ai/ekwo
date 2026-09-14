/**
 * Opening balances and the year-end close.
 *
 * The point of this file is that the close is *parameterised*, not written
 * once per country: the same three functions run the Belgian mechanism and
 * the French one, and what differs between the two runs is a row of
 * `country_defaults` that came out of a pack. So the Belgian cycle and the
 * French cycle are the same test twice, asserting different account codes.
 *
 * Everything a person can call is called as a signed-in user under the
 * `authenticated` role, because a write that only works as the owner of the
 * database is a write nobody can make.
 */

import { readFile, writeFile, mkdir, rm, cp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readPack } from '../packages/cli/src/index.js';
import { asUser, expectError, freshDatabase, one, repoRoot, rows } from './helpers/db.js';
import { allPacks, packWhere, roleOf } from './helpers/packs.js';
import {
  newCompany,
  newContact,
  newDocument,
  numberShape,
  type Fixture,
} from './helpers/factory.js';

let db: PGlite;

beforeEach(async () => {
  db = await freshDatabase();
});

afterEach(async () => {
  await db.close();
});

/** A company with the year being closed and the one that follows it. */
async function companyWithTwoYears(country: 'BE' | 'FR'): Promise<Fixture> {
  const fx = await newCompany(db, { country, name: `Close ${country}` });
  await db.query(
    `insert into fiscal_years (company_id, name, start_date, end_date)
     values ($1, 'Exercice 2027', date '2027-01-01', date '2027-12-31')`,
    [fx.companyId],
  );
  return fx;
}

async function fiscalYear(companyId: string, name: string): Promise<string> {
  const row = await one<{ id: string }>(
    db,
    `select id from fiscal_years where company_id = $1 and name = $2`,
    [companyId, name],
  );
  return row.id;
}

/**
 * A sale and a purchase, both posted, so the year has an income statement.
 * `sale` and `purchase` are amounts excluding tax; the result is their
 * difference.
 */
async function tradingYear(
  fx: Fixture,
  country: 'BE' | 'FR',
  sale: number,
  purchase: number,
): Promise<void> {
  const codes =
    country === 'BE'
      ? { sale: '700000', purchase: '610000', saleTax: 'BE-S-21', purchaseTax: 'BE-P-21' }
      : { sale: '706000', purchase: '611000', saleTax: 'FR-S-20', purchaseTax: 'FR-P-20' };

  const customer = await newContact(db, fx.companyId, { type: 'customer', country });
  const supplier = await newContact(db, fx.companyId, { type: 'supplier', country });

  const invoice = await newDocument(db, fx.companyId, {
    docType: 'sale_invoice',
    contactId: customer,
    date: '2026-06-15',
    lines: [{ unitPrice: sale, taxCode: codes.saleTax, accountCode: codes.sale }],
  });
  const bill = await newDocument(db, fx.companyId, {
    docType: 'purchase_invoice',
    contactId: supplier,
    date: '2026-06-20',
    lines: [{ unitPrice: purchase, taxCode: codes.purchaseTax, accountCode: codes.purchase }],
  });

  await asUser(db, fx.ownerId, async () => {
    await db.query(`select post_document($1)`, [invoice]);
    await db.query(`select post_document($1)`, [bill]);
  });
}

interface Balance {
  code: string;
  closing_balance: string;
}

async function balancesAt(companyId: string, from: string, to: string): Promise<Balance[]> {
  return rows<Balance>(
    db,
    `select account_code as code, closing_balance::text
       from trial_balance($1, $2::date, $3::date)
      where closing_balance <> 0
      order by account_code`,
    [companyId, from, to],
  );
}

async function linesOf(entryId: string): Promise<{ code: string; debit: string; credit: string }[]> {
  return rows(
    db,
    `select a.code, l.debit::text as debit, l.credit::text as credit
       from entry_lines l join accounts a on a.id = l.account_id
      where l.entry_id = $1 order by a.code`,
    [entryId],
  );
}

interface CloseResult {
  closing_entry_id: string;
  appropriation_entry_id: string | null;
  result: string;
  result_kind: string;
  closing_style: string;
}

async function close(fx: Fixture, fiscalYearId: string): Promise<CloseResult> {
  const row = await asUser(db, fx.ownerId, () =>
    one<{ close_fiscal_year: CloseResult }>(db, `select close_fiscal_year($1)`, [fiscalYearId]),
  );
  return row.close_fiscal_year;
}

// ---------------------------------------------------------------------------
// opening_balance
// ---------------------------------------------------------------------------

describe('an opening balance imported from whatever kept the books before', () => {
  it('posts one entry on the opening journal, on the first day of the year', async () => {
    const fx = await companyWithTwoYears('BE');
    const year = await fiscalYear(fx.companyId, 'Exercice 2026');

    const entryId = await asUser(db, fx.ownerId, async () => {
      const row = await one<{ opening_balance: string }>(
        db,
        `select opening_balance($1, $2, $3::jsonb)`,
        [
          fx.companyId,
          year,
          JSON.stringify([
            { account_code: '550000', debit: '12000.00', credit: '0' },
            { account_code: '400000', debit: '3630.00', credit: '0', label: 'Clients' },
            { account_code: '100000', debit: '0', credit: '15630.00' },
          ]),
        ],
      );
      return row.opening_balance;
    });

    const entry = await one<{
      number: string;
      entry_date: string;
      state: string;
      journal_type: string;
    }>(
      db,
      `select e.number, e.entry_date::text as entry_date, e.state::text as state,
              j.journal_type::text as journal_type
         from entries e join journals j on j.id = e.journal_id where e.id = $1`,
      [entryId],
    );
    expect(entry.journal_type).toBe('opening');
    expect(entry.entry_date).toBe('2026-01-01');
    expect(entry.state).toBe('posted');
    expect(entry.number).toMatch(await numberShape(db, fx.companyId, 'OPN', '2026-01-01'));

    expect(await balancesAt(fx.companyId, '2026-01-01', '2026-12-31')).toEqual([
      { code: '100000', closing_balance: '-15630.00' },
      { code: '400000', closing_balance: '3630.00' },
      { code: '550000', closing_balance: '12000.00' },
    ]);
  });

  it('refuses a trial balance that does not balance', async () => {
    const fx = await companyWithTwoYears('BE');
    const year = await fiscalYear(fx.companyId, 'Exercice 2026');
    const message = await asUser(db, fx.ownerId, () =>
      expectError(db, `select opening_balance($1, $2, $3::jsonb)`, [
        fx.companyId,
        year,
        JSON.stringify([
          { account_code: '550000', debit: '12000.00', credit: '0' },
          { account_code: '100000', debit: '0', credit: '11000.00' },
        ]),
      ]),
    );
    expect(message).toMatch(/opening_unbalanced: .*12000.00.*11000.00/);
  });

  it('refuses a second one, because a year has one opening', async () => {
    const fx = await companyWithTwoYears('BE');
    const year = await fiscalYear(fx.companyId, 'Exercice 2026');
    const lines = JSON.stringify([
      { account_code: '550000', debit: '100.00', credit: '0' },
      { account_code: '100000', debit: '0', credit: '100.00' },
    ]);
    await asUser(db, fx.ownerId, () =>
      db.query(`select opening_balance($1, $2, $3::jsonb)`, [fx.companyId, year, lines]),
    );
    const message = await asUser(db, fx.ownerId, () =>
      expectError(db, `select opening_balance($1, $2, $3::jsonb)`, [fx.companyId, year, lines]),
    );
    expect(message).toMatch(/opening_entry_exists/);
  });

  it('refuses an income or expense account, and takes one when it is asked to', async () => {
    const fx = await companyWithTwoYears('BE');
    const year = await fiscalYear(fx.companyId, 'Exercice 2026');
    const lines = JSON.stringify([
      { account_code: '550000', debit: '100.00', credit: '0' },
      { account_code: '700000', debit: '0', credit: '100.00' },
    ]);

    const message = await asUser(db, fx.ownerId, () =>
      expectError(db, `select opening_balance($1, $2, $3::jsonb)`, [fx.companyId, year, lines]),
    );
    expect(message).toMatch(/opening_result_account: 700000/);

    // Taking the books over halfway through a year that has already run.
    const entryId = await asUser(db, fx.ownerId, async () =>
      (
        await one<{ opening_balance: string }>(
          db,
          `select opening_balance($1, $2, $3::jsonb, true)`,
          [fx.companyId, year, lines],
        )
      ).opening_balance,
    );
    expect(await linesOf(entryId)).toHaveLength(2);
  });

  it('names the account it does not know', async () => {
    const fx = await companyWithTwoYears('BE');
    const year = await fiscalYear(fx.companyId, 'Exercice 2026');
    const message = await asUser(db, fx.ownerId, () =>
      expectError(db, `select opening_balance($1, $2, $3::jsonb)`, [
        fx.companyId,
        year,
        JSON.stringify([{ account_code: '999999', debit: '1.00', credit: '0' }]),
      ]),
    );
    expect(message).toMatch(/unknown_account: 999999/);
  });

  it('refuses a line carrying both sides, and one carrying neither', async () => {
    const fx = await companyWithTwoYears('BE');
    const year = await fiscalYear(fx.companyId, 'Exercice 2026');
    const both = await asUser(db, fx.ownerId, () =>
      expectError(db, `select opening_balance($1, $2, $3::jsonb)`, [
        fx.companyId,
        year,
        JSON.stringify([{ account_code: '550000', debit: '1.00', credit: '1.00' }]),
      ]),
    );
    expect(both).toMatch(/opening_two_sides/);

    const neither = await asUser(db, fx.ownerId, () =>
      expectError(db, `select opening_balance($1, $2, $3::jsonb)`, [
        fx.companyId,
        year,
        JSON.stringify([{ account_code: '550000', debit: '0', credit: '0' }]),
      ]),
    );
    expect(neither).toMatch(/opening_no_amount/);
  });
});

// ---------------------------------------------------------------------------
// The cycle, twice, on two packs
// ---------------------------------------------------------------------------

describe('closing a profitable year in Belgium', () => {
  it('runs the result through the appropriation accounts and on to 140', async () => {
    const fx = await companyWithTwoYears('BE');
    await tradingYear(fx, 'BE', 10000, 4000);
    const year = await fiscalYear(fx.companyId, 'Exercice 2026');

    const result = await close(fx, year);

    expect(result.closing_style).toBe('appropriation_accounts');
    expect(result.result).toBe('6000.00');
    expect(result.result_kind).toBe('profit');
    expect(result.appropriation_entry_id).not.toBeNull();

    // 693 "Bénéfice à reporter" is debited, 140 "Bénéfice reporté" credited.
    expect(await linesOf(result.appropriation_entry_id as string)).toEqual([
      { code: '140000', debit: '0.00', credit: '6000.00' },
      { code: '693000', debit: '6000.00', credit: '0.00' },
    ]);

    // The closing entry takes every income and expense account, 693 included,
    // back to zero, and needs no counterpart of its own.
    expect(await linesOf(result.closing_entry_id)).toEqual([
      { code: '610000', debit: '0.00', credit: '4000.00' },
      { code: '693000', debit: '0.00', credit: '6000.00' },
      { code: '700000', debit: '10000.00', credit: '0.00' },
    ]);

    const closed = await balancesAt(fx.companyId, '2026-01-01', '2026-12-31');
    expect(closed.map((b) => b.code)).not.toContain('700000');
    expect(closed.map((b) => b.code)).not.toContain('610000');
    expect(closed.map((b) => b.code)).not.toContain('693000');
    expect(closed).toContainEqual({ code: '140000', closing_balance: '-6000.00' });
  });
});

describe('closing a profitable year in France', () => {
  it('closes straight into 120, and posts no appropriation entry', async () => {
    const fx = await companyWithTwoYears('FR');
    await tradingYear(fx, 'FR', 10000, 4000);
    const year = await fiscalYear(fx.companyId, 'Exercice 2026');

    const result = await close(fx, year);

    expect(result.closing_style).toBe('result_accounts');
    expect(result.result).toBe('6000.00');
    expect(result.appropriation_entry_id).toBeNull();

    expect(await linesOf(result.closing_entry_id)).toEqual([
      { code: '120000', debit: '0.00', credit: '6000.00' },
      { code: '611000', debit: '0.00', credit: '4000.00' },
      { code: '706000', debit: '10000.00', credit: '0.00' },
    ]);

    const closed = await balancesAt(fx.companyId, '2026-01-01', '2026-12-31');
    expect(closed).toContainEqual({ code: '120000', closing_balance: '-6000.00' });
    // 110 is where the meeting will move it, and the close never touches it.
    expect(closed.map((b) => b.code)).not.toContain('110000');
  });
});

describe('a loss', () => {
  it('goes to 793 and 141 in Belgium', async () => {
    const fx = await companyWithTwoYears('BE');
    await tradingYear(fx, 'BE', 4000, 10000);
    const year = await fiscalYear(fx.companyId, 'Exercice 2026');

    const result = await close(fx, year);
    expect(result.result).toBe('-6000.00');
    expect(result.result_kind).toBe('loss');
    expect(await linesOf(result.appropriation_entry_id as string)).toEqual([
      { code: '141000', debit: '6000.00', credit: '0.00' },
      { code: '793000', debit: '0.00', credit: '6000.00' },
    ]);
    expect(await balancesAt(fx.companyId, '2026-01-01', '2026-12-31')).toContainEqual({
      code: '141000',
      closing_balance: '6000.00',
    });
  });

  it('goes to 129 in France', async () => {
    const fx = await companyWithTwoYears('FR');
    await tradingYear(fx, 'FR', 4000, 10000);
    const year = await fiscalYear(fx.companyId, 'Exercice 2026');

    const result = await close(fx, year);
    expect(result.result).toBe('-6000.00');
    expect(await linesOf(result.closing_entry_id)).toContainEqual({
      code: '129000',
      debit: '6000.00',
      credit: '0.00',
    });
  });
});

describe('the year that follows', () => {
  it('starts with an income statement at zero and the result on the balance sheet', async () => {
    const fx = await companyWithTwoYears('BE');
    await tradingYear(fx, 'BE', 10000, 4000);
    const year = await fiscalYear(fx.companyId, 'Exercice 2026');
    await close(fx, year);

    // The reports read the ledger from the beginning, so 2027 opens on
    // exactly what 2026 closed on — without an entry that would count it
    // twice.
    const opening = await rows<{ code: string; opening_balance: string }>(
      db,
      `select account_code as code, opening_balance::text
         from trial_balance($1, date '2027-01-01', date '2027-12-31')
        where opening_balance <> 0
        order by account_code`,
      [fx.companyId],
    );
    expect(opening).toEqual([
      { code: '140000', opening_balance: '-6000.00' },
      { code: '400000', opening_balance: '12100.00' },
      { code: '440000', opening_balance: '-4000.00' },
      { code: '451000', opening_balance: '-2100.00' },
    ]);
    expect(opening.map((b) => b.code)).not.toContain('700000');
    expect(opening.map((b) => b.code)).not.toContain('610000');
  });

  it('carries no second copy of the balance sheet into the opening journal', async () => {
    const fx = await companyWithTwoYears('BE');
    await tradingYear(fx, 'BE', 10000, 4000);
    const year = await fiscalYear(fx.companyId, 'Exercice 2026');
    await close(fx, year);

    const opened = await rows<{ count: string }>(
      db,
      `select count(*)::text as count
         from entries e join journals j on j.id = e.journal_id
        where e.company_id = $1 and j.journal_type = 'opening'
          and e.entry_date = date '2027-01-01'`,
      [fx.companyId],
    );
    expect(opened[0]?.count).toBe('0');
  });

  it('keeps the aged balance of the customer that has not paid', async () => {
    const fx = await companyWithTwoYears('BE');
    await tradingYear(fx, 'BE', 10000, 4000);
    const year = await fiscalYear(fx.companyId, 'Exercice 2026');
    await close(fx, year);

    const aged = await rows<{ total: string }>(
      db,
      `select sum(total)::text as total from aged_balance($1, date '2027-01-01', 'receivable')`,
      [fx.companyId],
    );
    expect(Number(aged[0]?.total ?? 0)).toBeCloseTo(12100, 2);
  });
});

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

describe('what a close refuses', () => {
  it('a year that still holds a draft entry', async () => {
    const fx = await companyWithTwoYears('BE');
    const customer = await newContact(db, fx.companyId);
    await newDocument(db, fx.companyId, {
      docType: 'sale_invoice',
      contactId: customer,
      lines: [{ unitPrice: 100, taxCode: 'BE-S-21', accountCode: '700000' }],
    });
    const misc = await one<{ id: string }>(
      db,
      `select id from journals where company_id = $1 and code = 'MISC'`,
      [fx.companyId],
    );
    await db.query(
      `insert into entries (company_id, journal_id, entry_date, description, state)
       values ($1, $2, date '2026-05-05', 'Brouillon', 'draft')`,
      [fx.companyId, misc.id],
    );

    const year = await fiscalYear(fx.companyId, 'Exercice 2026');
    const message = await asUser(db, fx.ownerId, () =>
      expectError(db, `select close_fiscal_year($1)`, [year]),
    );
    expect(message).toMatch(/fiscal_year_has_drafts/);
  });

  it('a year that is already closed', async () => {
    const fx = await companyWithTwoYears('BE');
    await tradingYear(fx, 'BE', 10000, 4000);
    const year = await fiscalYear(fx.companyId, 'Exercice 2026');
    await close(fx, year);
    const message = await asUser(db, fx.ownerId, () =>
      expectError(db, `select close_fiscal_year($1)`, [year]),
    );
    expect(message).toMatch(/fiscal_year_already_closed/);
  });

  it('nothing, when the year that follows has not been created yet', async () => {
    // A close writes nothing into the next year, so it does not need one.
    // December is closed long before anyone opens the next exercise.
    const fx = await newCompany(db, { country: 'BE', name: 'Lonely' });
    await tradingYear(fx, 'BE', 1000, 400);
    const year = await fiscalYear(fx.companyId, 'Exercice 2026');
    const result = await close(fx, year);
    expect(result.result).toBe('600.00');
    expect(
      await one<{ is_closed: boolean }>(db, `select is_closed from fiscal_years where id = $1`, [
        year,
      ]),
    ).toEqual({ is_closed: true });
  });

  it('a year whose successor is already closed', async () => {
    const fx = await companyWithTwoYears('BE');
    await db.query(
      `insert into fiscal_years (company_id, name, start_date, end_date)
       values ($1, 'Exercice 2028', date '2028-01-01', date '2028-12-31')`,
      [fx.companyId],
    );
    const y2027 = await fiscalYear(fx.companyId, 'Exercice 2027');
    await close(fx, y2027);

    const y2026 = await fiscalYear(fx.companyId, 'Exercice 2026');
    const message = await asUser(db, fx.ownerId, () =>
      expectError(db, `select close_fiscal_year($1)`, [y2026]),
    );
    expect(message).toMatch(/later_fiscal_year_closed/);
  });

  it('a year whose predecessor holds posted entries and is open', async () => {
    const fx = await companyWithTwoYears('BE');
    await db.query(
      `insert into fiscal_years (company_id, name, start_date, end_date)
       values ($1, 'Exercice 2025', date '2025-01-01', date '2025-12-31')`,
      [fx.companyId],
    );
    const y2025 = await fiscalYear(fx.companyId, 'Exercice 2025');
    await asUser(db, fx.ownerId, () =>
      db.query(`select opening_balance($1, $2, $3::jsonb)`, [
        fx.companyId,
        y2025,
        JSON.stringify([
          { account_code: '550000', debit: '100.00', credit: '0' },
          { account_code: '100000', debit: '0', credit: '100.00' },
        ]),
      ]),
    );

    const y2026 = await fiscalYear(fx.companyId, 'Exercice 2026');
    const message = await asUser(db, fx.ownerId, () =>
      expectError(db, `select close_fiscal_year($1)`, [y2026]),
    );
    expect(message).toMatch(/earlier_fiscal_year_open/);
  });
});

describe('a closed year', () => {
  it('takes no entry, which post_entry already refused before this change', async () => {
    const fx = await companyWithTwoYears('BE');
    await tradingYear(fx, 'BE', 10000, 4000);
    const year = await fiscalYear(fx.companyId, 'Exercice 2026');
    await close(fx, year);

    const customer = await newContact(db, fx.companyId);
    const invoice = await newDocument(db, fx.companyId, {
      docType: 'sale_invoice',
      contactId: customer,
      date: '2026-11-02',
      lines: [{ unitPrice: 100, taxCode: 'BE-S-21', accountCode: '700000' }],
    });
    const message = await asUser(db, fx.ownerId, () =>
      expectError(db, `select post_document($1)`, [invoice]),
    );
    expect(message).toMatch(/fiscal_year_closed/);
  });

  it('cannot be re-opened by writing the column', async () => {
    const fx = await companyWithTwoYears('BE');
    await tradingYear(fx, 'BE', 10000, 4000);
    const year = await fiscalYear(fx.companyId, 'Exercice 2026');
    await close(fx, year);

    const message = await asUser(db, fx.ownerId, () =>
      expectError(db, `update fiscal_years set is_closed = false where id = $1`, [year]),
    );
    expect(message).toMatch(/fiscal_year_close_not_a_column/);

    // And an open year cannot be closed by writing it either.
    const y2027 = await fiscalYear(fx.companyId, 'Exercice 2027');
    const other = await asUser(db, fx.ownerId, () =>
      expectError(db, `update fiscal_years set is_closed = true where id = $1`, [y2027]),
    );
    expect(other).toMatch(/fiscal_year_close_not_a_column/);
  });
});

// ---------------------------------------------------------------------------
// reopen_fiscal_year
// ---------------------------------------------------------------------------

describe('undoing a close', () => {
  it('reverses both entries and puts the flag back', async () => {
    const fx = await companyWithTwoYears('BE');
    await tradingYear(fx, 'BE', 10000, 4000);
    const year = await fiscalYear(fx.companyId, 'Exercice 2026');
    const before = await balancesAt(fx.companyId, '2026-01-01', '2026-12-31');
    await close(fx, year);

    const undone = await asUser(db, fx.ownerId, () =>
      one<{ reopen_fiscal_year: { reversal_entry_ids: string[] } }>(
        db,
        `select reopen_fiscal_year($1)`,
        [year],
      ),
    );
    // The appropriation entry and the closing entry.
    expect(undone.reopen_fiscal_year.reversal_entry_ids).toHaveLength(2);

    const state = await one<{ is_closed: boolean; closed_at: string | null }>(
      db,
      `select is_closed, closed_at::text as closed_at from fiscal_years where id = $1`,
      [year],
    );
    expect(state.is_closed).toBe(false);
    expect(state.closed_at).toBeNull();

    // The books are back where they were: the income statement carries its
    // figures again and nothing sits on 140.
    expect(await balancesAt(fx.companyId, '2026-01-01', '2026-12-31')).toEqual(before);
  });

  it('lets the year be closed again afterwards', async () => {
    const fx = await companyWithTwoYears('BE');
    await tradingYear(fx, 'BE', 10000, 4000);
    const year = await fiscalYear(fx.companyId, 'Exercice 2026');
    await close(fx, year);
    await asUser(db, fx.ownerId, () => db.query(`select reopen_fiscal_year($1)`, [year]));

    const again = await close(fx, year);
    expect(again.result).toBe('6000.00');
    expect(await balancesAt(fx.companyId, '2026-01-01', '2026-12-31')).toContainEqual({
      code: '140000',
      closing_balance: '-6000.00',
    });
  });

  it('refuses once a later year has been booked into', async () => {
    const fx = await companyWithTwoYears('BE');
    await tradingYear(fx, 'BE', 10000, 4000);
    const year = await fiscalYear(fx.companyId, 'Exercice 2026');
    await close(fx, year);

    const customer = await newContact(db, fx.companyId);
    const invoice = await newDocument(db, fx.companyId, {
      docType: 'sale_invoice',
      contactId: customer,
      date: '2027-02-10',
      lines: [{ unitPrice: 500, taxCode: 'BE-S-21', accountCode: '700000' }],
    });
    await asUser(db, fx.ownerId, () => db.query(`select post_document($1)`, [invoice]));

    const message = await asUser(db, fx.ownerId, () =>
      expectError(db, `select reopen_fiscal_year($1)`, [year]),
    );
    expect(message).toMatch(/next_fiscal_year_in_use/);
  });

  it('refuses a year that is open', async () => {
    const fx = await companyWithTwoYears('BE');
    const year = await fiscalYear(fx.companyId, 'Exercice 2026');
    const message = await asUser(db, fx.ownerId, () =>
      expectError(db, `select reopen_fiscal_year($1)`, [year]),
    );
    expect(message).toMatch(/fiscal_year_not_closed/);
  });
});

// ---------------------------------------------------------------------------
// The surface, and the rule that a country is data
// ---------------------------------------------------------------------------

describe('the three functions', () => {
  it('are closed to the anonymous role', async () => {
    const fx = await companyWithTwoYears('BE');
    const year = await fiscalYear(fx.companyId, 'Exercice 2026');
    const calls: [string, unknown[]][] = [
      [`select opening_balance($1, $2, '[]'::jsonb)`, [fx.companyId, year]],
      [`select close_fiscal_year($1)`, [year]],
      [`select reopen_fiscal_year($1)`, [year]],
    ];
    for (const [sql, params] of calls) {
      const message = await asUser(db, fx.ownerId, () => expectError(db, sql, params), 'anon');
      expect(message).toMatch(/permission denied for function/);
    }
  });

  it('carry no country code and no account code of their own', async () => {
    // A country is a pack. `close_fiscal_year` reads 693, 140, 120 and 129
    // from `country_defaults`; the day it holds one of them itself, the next
    // country needs a release rather than a pack.
    const bodies = await rows<{ proname: string; prosrc: string }>(
      db,
      `select p.proname, p.prosrc
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('opening_balance', 'close_fiscal_year', 'reopen_fiscal_year',
                            'opening_journal_id', 'has_opening_entry', 'fiscal_years_guard_closed')`,
    );
    expect(bodies.length).toBe(6);
    for (const fn of bodies) {
      // SQLSTATE codes are five characters of Postgres, not of a chart.
      const body = fn.prosrc.replace(/errcode = '[0-9A-Z]{5}'/g, '');
      expect(body, `${fn.proname} names a country`).not.toMatch(/'(BE|FR|UK|US|GB|NL|DE|CA)'/);
      expect(body, `${fn.proname} holds an account code`).not.toMatch(/'[0-9]{3,8}'/);
    }
  });

  it('take no default from the schema: a pack that says nothing gets a refusal', async () => {
    // "Il n'y a pas de raison de mettre la Belgique par défaut." A default
    // closing style is one country's mechanism handed to every country that
    // has not spoken, and `OPN` is the journal code Belgium and France happen
    // to use. So the five columns carry no default at all.
    const defaults = await rows<{ column_name: string; column_default: string | null }>(
      db,
      `select column_name, column_default
         from information_schema.columns
        where table_schema = 'public' and table_name = 'country_defaults'
          and column_name in ('closing_style', 'current_year_result_profit_code',
                              'current_year_result_loss_code', 'retained_earnings_loss_code',
                              'opening_journal_code')
        order by column_name`,
    );
    expect(defaults).toHaveLength(5);
    for (const column of defaults) {
      expect(column.column_default, column.column_name).toBeNull();
    }
  });

  it('refuse a year whose pack says nothing about closing, by name', async () => {
    const fx = await companyWithTwoYears('BE');
    await tradingYear(fx, 'BE', 10000, 4000);
    const year = await fiscalYear(fx.companyId, 'Exercice 2026');

    await db.query(`update country_defaults set closing_style = null where country = $1`, ['BE']);
    const message = await asUser(db, fx.ownerId, () =>
      expectError(db, `select close_fiscal_year($1)`, [year]),
    );
    expect(message).toMatch(/no_closing_defaults/);
    expect(message).toMatch(/defaults\.closing_style/);
  });

  it('refuse to open or close when the pack names no opening journal', async () => {
    const fx = await companyWithTwoYears('BE');
    await tradingYear(fx, 'BE', 10000, 4000);
    const year = await fiscalYear(fx.companyId, 'Exercice 2026');

    // The journal is still there under its own code; what is gone is the pack
    // saying which one it is. Nothing falls back on a code written in the
    // schema.
    await db.query(`update country_defaults set opening_journal_code = null where country = $1`, [
      'BE',
    ]);
    const closing = await asUser(db, fx.ownerId, () =>
      expectError(db, `select close_fiscal_year($1)`, [year]),
    );
    expect(closing).toMatch(/no_opening_journal/);

    const opening = await asUser(db, fx.ownerId, () =>
      expectError(db, `select opening_balance($1, $2, $3::jsonb)`, [
        fx.companyId,
        year,
        JSON.stringify([
          { account_code: '550000', debit: '100.00', credit: '0' },
          { account_code: '100000', debit: '0', credit: '100.00' },
        ]),
      ]),
    );
    expect(opening).toMatch(/no_opening_journal/);
  });

  it('read the codes from the pack, which is why two countries behave differently', async () => {
    const defaults = await rows<{
      country: string;
      closing_style: string;
      profit: string;
      loss: string;
      opening_journal_code: string;
    }>(
      db,
      `select country, closing_style::text as closing_style,
              current_year_result_profit_code as profit,
              current_year_result_loss_code as loss,
              opening_journal_code
         from country_defaults order by country`,
    );
    // Four parameters of each manifest. A country that keeps one account for
    // the result of the year, whichever sign it has, says so by naming the
    // same account twice — which is a property of its pack, not of this test.
    expect(defaults).toEqual(
      allPacks
        .map((pack) => ({
          country: pack.manifest.country,
          closing_style: pack.manifest.defaults['closing_style'],
          profit: roleOf(pack, 'current_year_result_profit'),
          loss: roleOf(pack, 'current_year_result_loss'),
          opening_journal_code: pack.manifest.defaults.journal_roles?.['opening'],
        }))
        .sort((a, b) => (a.country < b.country ? -1 : 1)),
    );
  });
});

// ---------------------------------------------------------------------------
// entries.kind
// ---------------------------------------------------------------------------

describe('what an entry is for', () => {
  async function kindOf(entryId: string): Promise<string> {
    return (
      await one<{ kind: string }>(db, `select kind::text as kind from entries where id = $1`, [
        entryId,
      ])
    ).kind;
  }

  it('is `opening` on an imported opening balance', async () => {
    const fx = await companyWithTwoYears('BE');
    const year = await fiscalYear(fx.companyId, 'Exercice 2026');
    const entryId = await asUser(db, fx.ownerId, async () =>
      (
        await one<{ opening_balance: string }>(db, `select opening_balance($1, $2, $3::jsonb)`, [
          fx.companyId,
          year,
          JSON.stringify([
            { account_code: '550000', debit: '100.00', credit: '0' },
            { account_code: '100000', debit: '0', credit: '100.00' },
          ]),
        ])
      ).opening_balance,
    );
    expect(await kindOf(entryId)).toBe('opening');
  });

  it('tells the two entries a close writes apart, and carries it onto their reversals', async () => {
    // They are two acts: one says where the result went, the other empties the
    // income statement. Under one name they cancelled out and the allocation
    // section of the Belgian annual accounts read nil.
    const fx = await companyWithTwoYears('BE');
    await tradingYear(fx, 'BE', 10000, 4000);
    const year = await fiscalYear(fx.companyId, 'Exercice 2026');
    const result = await close(fx, year);

    expect(await kindOf(result.appropriation_entry_id as string)).toBe('appropriation');
    expect(await kindOf(result.closing_entry_id)).toBe('closing');

    const undone = await asUser(db, fx.ownerId, () =>
      one<{ reopen_fiscal_year: { reversal_entry_ids: string[] } }>(
        db,
        `select reopen_fiscal_year($1)`,
        [year],
      ),
    );
    expect(undone.reopen_fiscal_year.reversal_entry_ids).toHaveLength(2);
    const reversed = await Promise.all(
      undone.reopen_fiscal_year.reversal_entry_ids.map((id) => kindOf(id)),
    );
    expect([...reversed].sort()).toEqual(['appropriation', 'closing']);
  });

  it('is `normal` on everything a business writes', async () => {
    const fx = await companyWithTwoYears('BE');
    await tradingYear(fx, 'BE', 10000, 4000);
    const kinds = await rows<{ kind: string; count: string }>(
      db,
      `select kind::text as kind, count(*)::text as count
         from entries where company_id = $1 group by kind`,
      [fx.companyId],
    );
    expect(kinds).toEqual([{ kind: 'normal', count: '2' }]);
  });

  it('cannot be written by hand, on insert or on update', async () => {
    const fx = await companyWithTwoYears('BE');
    const misc = await one<{ id: string }>(
      db,
      `select id from journals where company_id = $1 and code = 'MISC'`,
      [fx.companyId],
    );

    const inserted = await asUser(db, fx.ownerId, () =>
      expectError(
        db,
        `insert into entries (company_id, journal_id, entry_date, description, state, kind)
         values ($1, $2, date '2026-05-05', 'Faux', 'draft', 'closing')`,
        [fx.companyId, misc.id],
      ),
    );
    expect(inserted).toMatch(/entry_kind_not_a_column/);

    await asUser(db, fx.ownerId, () =>
      db.query(
        `insert into entries (company_id, journal_id, entry_date, description, state)
         values ($1, $2, date '2026-05-05', 'Vraie', 'draft')`,
        [fx.companyId, misc.id],
      ),
    );
    const updated = await asUser(db, fx.ownerId, () =>
      expectError(db, `update entries set kind = 'closing' where company_id = $1`, [fx.companyId]),
    );
    expect(updated).toMatch(/entry_kind_not_a_column/);
  });

  it('survives post_entry, which changes everything else about an entry', async () => {
    const fx = await companyWithTwoYears('BE');
    const year = await fiscalYear(fx.companyId, 'Exercice 2026');
    const entryId = await asUser(db, fx.ownerId, async () =>
      (
        await one<{ opening_balance: string }>(db, `select opening_balance($1, $2, $3::jsonb)`, [
          fx.companyId,
          year,
          JSON.stringify([
            { account_code: '550000', debit: '100.00', credit: '0' },
            { account_code: '100000', debit: '0', credit: '100.00' },
          ]),
        ])
      ).opening_balance,
    );
    // post_entry ran inside opening_balance: the number is assigned and the
    // kind did not move.
    const entry = await one<{ state: string; number: string; kind: string }>(
      db,
      `select state::text as state, number, kind::text as kind from entries where id = $1`,
      [entryId],
    );
    expect(entry.state).toBe('posted');
    expect(entry.number).toMatch(/^OPN\//);
    expect(entry.kind).toBe('opening');
  });
});

// ---------------------------------------------------------------------------
// The pack says it, or nothing does
// ---------------------------------------------------------------------------

describe('a pack that declares a closing style', () => {
  // The refusals below break a manifest on purpose. The pack they break is the
  // one that closes through appropriation accounts, because that is the style
  // whose extra accounts they take away — a property, not a country.
  const closer = packWhere(
    'closes through appropriation accounts',
    (pack) => pack.manifest.defaults['closing_style'] === 'appropriation_accounts',
  );

  /** A copy of `packs/` with one manifest patched, so nothing here edits the real one. */
  async function packsWith(patch: (defaults: Record<string, unknown>) => void): Promise<string> {
    const dir = join(tmpdir(), `ekwo-packs-${crypto.randomUUID()}`);
    await mkdir(dir, { recursive: true });
    await cp(join(repoRoot, 'packs'), dir, { recursive: true });
    const file = join(dir, closer.slug, 'pack.json');
    const manifest = JSON.parse(await readFile(file, 'utf8')) as {
      defaults: Record<string, unknown>;
    };
    patch(manifest.defaults);
    await writeFile(file, JSON.stringify(manifest, null, 2));
    return dir;
  }

  it('is accepted as it stands', async () => {
    // Every pack says how it closes, and the two styles are the ones the
    // functions branch on. A pack that said nothing is refused by the reader.
    for (const pack of allPacks) {
      expect(
        ['appropriation_accounts', 'result_accounts'],
        pack.slug,
      ).toContain(pack.manifest.defaults['closing_style']);
    }
    expect(closer.manifest.defaults['closing_style']).toBe('appropriation_accounts');
  });

  it('is refused when it names no account for the result', async () => {
    const dir = await packsWith((defaults) => {
      const roles = defaults['roles'] as Record<string, unknown>;
      delete roles['current_year_result_profit'];
    });
    try {
      await expect(readPack(closer.slug, dir)).rejects.toThrow(/current_year_result_profit/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('is refused when it names no opening journal', async () => {
    const dir = await packsWith((defaults) => {
      const journals = defaults['journal_roles'] as Record<string, unknown>;
      delete journals['opening'];
    });
    try {
      await expect(readPack(closer.slug, dir)).rejects.toThrow(/journal_roles\.opening/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('is refused when the journal it names is not an opening journal', async () => {
    const dir = await packsWith((defaults) => {
      const journals = defaults['journal_roles'] as Record<string, unknown>;
      journals['opening'] = 'MISC';
    });
    try {
      await expect(readPack(closer.slug, dir)).rejects.toThrow(/has to be of type opening/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('the migration of this change', () => {
  it('holds no country code of its own', async () => {
    // A test keeps this true for every migration in the repository; this one
    // says it for the file that introduces the closing parameters, which are
    // exactly the place a country would have been tempting.
    const sql = await readFile(
      join(repoRoot, 'supabase', 'migrations', '20260912094412_opening_and_closing.sql'),
      'utf8',
    );
    expect(sql).not.toMatch(/'(BE|FR|UK|US|CA|GB|IE|NL|DE|LU)'/);
  });
});
