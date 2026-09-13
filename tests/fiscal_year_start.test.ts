/**
 * The first financial year is a parameter too.
 *
 * `ekwo init` opened it on 1 January in two string literals. The country
 * model has carried the answer since document rules became pack data, and
 * these are its readers: the
 * function that turns a month into two days, the installer, and the company
 * an assistant creates.
 */

import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, expectError, freshDatabase, one, rows } from './helpers/db.js';
import { newInstanceAdmin, newUser } from './helpers/factory.js';

let db: PGlite;
let adminId: string;
let country: string;

beforeAll(async () => {
  db = await freshDatabase();
  adminId = await newInstanceAdmin(db);
  const row = await one<{ country: string }>(
    db,
    `select country from country_defaults where fiscal_year_default is not null order by country limit 1`,
  );
  country = row.country;
});

afterAll(async () => {
  await db.close();
});

async function bounds(year: number, start: string | null = null): Promise<{ start_date: string; end_date: string }> {
  return one<{ start_date: string; end_date: string }>(
    db,
    `select start_date::text, end_date::text from fiscal_year_bounds($1, $2, $3::date)`,
    [country, year, start],
  );
}

describe('fiscal_year_bounds', () => {
  it('opens on the month the country pack declares', async () => {
    const declared = await one<{ fiscal_year_default: string }>(
      db,
      `select fiscal_year_default from country_defaults where country = $1`,
      [country],
    );
    const month = { calendar: '01', april: '04', july: '07', october: '10' }[
      declared.fiscal_year_default
    ];
    const opened = await bounds(2026);
    expect(opened.start_date).toBe(`2026-${month}-01`);
  });

  it('closes on the day before the same day a year later', async () => {
    expect(await bounds(2026, '2026-04-01')).toEqual({
      start_date: '2026-04-01',
      end_date: '2027-03-31',
    });
    // A leap day changes nothing: the year is a day to a day.
    expect(await bounds(2027, '2027-07-01')).toEqual({
      start_date: '2027-07-01',
      end_date: '2028-06-30',
    });
  });

  it('follows the pack when the pack changes its mind', async () => {
    await db.query(`update country_defaults set fiscal_year_default = 'april' where country = $1`, [
      country,
    ]);
    try {
      expect(await bounds(2026)).toEqual({ start_date: '2026-04-01', end_date: '2027-03-31' });
    } finally {
      await db.query(
        `update country_defaults set fiscal_year_default = 'calendar' where country = $1`,
        [country],
      );
    }
  });

  it('refuses to guess January when the pack has said nothing', async () => {
    await db.query(`update country_defaults set fiscal_year_default = null where country = $1`, [
      country,
    ]);
    try {
      const message = await expectError(db, `select * from fiscal_year_bounds($1, 2026)`, [country]);
      expect(message).toMatch(/no_fiscal_year_default/);
      expect(message).toMatch(/defaults\.fiscal_year_default/);

      // Named a day, it answers anyway: the refusal is about guessing, not
      // about the country.
      expect(await bounds(2026, '2026-02-01')).toEqual({
        start_date: '2026-02-01',
        end_date: '2027-01-31',
      });
    } finally {
      await db.query(
        `update country_defaults set fiscal_year_default = 'calendar' where country = $1`,
        [country],
      );
    }
  });
});

describe('create_company', () => {
  it('copies the pack in and opens the first year on the pack’s month', async () => {
    const company = await asUser(db, adminId, () =>
      one<{ id: string; name: string; currency_code: string; language: string }>(
        db,
        `select id, name, currency_code, language from create_company($1, $2)`,
        ['Premiere SRL', country],
      ),
    );
    expect(company.name).toBe('Premiere SRL');

    const pack = await one<{ currency_code: string; language_default: string }>(
      db,
      `select currency_code, language_default from country_defaults where country = $1`,
      [country],
    );
    expect(company.currency_code).toBe(pack.currency_code);
    expect(company.language).toBe(pack.language_default);

    const accounts = await one<{ count: string }>(
      db,
      `select count(*)::text from accounts where company_id = $1`,
      [company.id],
    );
    expect(Number(accounts.count)).toBeGreaterThan(300);

    const year = await one<{ start_date: string; end_date: string }>(
      db,
      `select start_date::text, end_date::text from fiscal_years where company_id = $1`,
      [company.id],
    );
    const expected = await bounds(new Date().getUTCFullYear());
    expect(year).toEqual(expected);

    const membership = await one<{ role: string }>(
      db,
      `select role::text from company_members where company_id = $1 and user_id = $2`,
      [company.id, adminId],
    );
    expect(membership.role).toBe('owner');
  });

  it('opens the year on the day it is given', async () => {
    const company = await asUser(db, adminId, () =>
      one<{ id: string }>(
        db,
        `select id from create_company($1, $2, null, null, null, 2026, date '2026-07-01')`,
        ['Decalee SRL', country],
      ),
    );
    const year = await one<{ name: string; start_date: string; end_date: string }>(
      db,
      `select name, start_date::text, end_date::text from fiscal_years where company_id = $1`,
      [company.id],
    );
    expect(year).toEqual({ name: 'FY2026', start_date: '2026-07-01', end_date: '2027-06-30' });
  });

  it('is refused to somebody who does not administer the installation', async () => {
    const outsider = await newUser(db, 'outsider@fiscalyear.test');
    const message = await asUser(db, outsider, () =>
      expectError(db, `select * from create_company($1, $2)`, ['Interdite SRL', country]),
    );
    expect(message).toMatch(/not_instance_admin/);
  });

  it('leaves nothing behind when the pack cannot answer', async () => {
    const before = await one<{ count: string }>(db, `select count(*)::text from companies`);
    await db.query(`update country_defaults set fiscal_year_default = null where country = $1`, [
      country,
    ]);
    try {
      const message = await asUser(db, adminId, () =>
        expectError(db, `select * from create_company($1, $2)`, ['Sans annee SRL', country]),
      );
      expect(message).toMatch(/no_fiscal_year_default/);
      const after = await one<{ count: string }>(db, `select count(*)::text from companies`);
      expect(after.count).toBe(before.count);
    } finally {
      await db.query(
        `update country_defaults set fiscal_year_default = 'calendar' where country = $1`,
        [country],
      );
    }
  });
});
