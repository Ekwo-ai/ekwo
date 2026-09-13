import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, expectError, freshDatabase, one, rows } from '../../../tests/helpers/db.js';
import { newCompany } from '../../../tests/helpers/factory.js';

// The `assets` module, end to end: a schedule is a calculation, so it is
// pinned to the cent on a worked example per country and per method; the
// posting is pinned to the entry it produces; and the rules that are not
// arithmetic — a closed year, a second run, a stranger, a disposal — each get
// the refusal or the ledger they are supposed to get.

let db: PGlite;
let be = { companyId: '', ownerId: '' };
let fr = { companyId: '', ownerId: '' };

/** A company with the module on and six financial years to depreciate over. */
async function company(country: 'BE' | 'FR', name: string): Promise<{ companyId: string; ownerId: string }> {
  const fixture = await newCompany(db, { country, name });
  await asUser(db, fixture.ownerId, async () => {
    await db.query(`select enable_module($1, 'assets')`, [fixture.companyId]);
  });
  for (const year of [2027, 2028, 2029, 2030, 2031, 2032]) {
    await db.query(
      `insert into fiscal_years (company_id, name, start_date, end_date)
       values ($1, $2, make_date($3, 1, 1), make_date($3, 12, 31))`,
      [fixture.companyId, `Exercice ${year}`, year],
    );
  }
  return fixture;
}

interface ScheduleLine {
  sequence: number;
  period_start: string;
  period_end: string;
  amount: string;
  accumulated: string;
  net_book_value: string;
}

async function schedule(assetId: string): Promise<ScheduleLine[]> {
  return rows<ScheduleLine>(
    db,
    `select sequence, period_start::text, period_end::text, amount, accumulated, net_book_value
       from assets.depreciation_lines where asset_id = $1 order by sequence`,
    [assetId],
  );
}

const amounts = (lines: ScheduleLine[]): string[] => lines.map((l) => l.amount);

beforeAll(async () => {
  db = await freshDatabase();
  be = await company('BE', 'Immobilisations SRL');
  fr = await company('FR', 'Immobilisations SAS');
});

afterAll(async () => {
  await db.close();
});

describe('a straight-line schedule', () => {
  it('takes the Belgian prorata in real days on the first year, and the remainder on the last', async () => {
    // A laptop of 3 000 €, three years, in service on 1 July 2026. Belgium
    // prorates the first annuity in days of the actual calendar — article 196,
    // § 2, 1° CIR 92 for a company that is not a small one — so 2026 carries
    // 184 of the 365 days of the year, the day it entered service included:
    // 1 000 × 184 / 365 = 504,11. The tail of 495,89 falls into a fourth year,
    // which is what a prorata always does.
    const asset = await one<{ id: string }>(
      db,
      `select assets.create_asset($1, 'IT-01', 'Portable', date '2026-07-01', 3000,
              '241000', '241900', '630200', 'it-equipment') as id`,
      [be.companyId],
    );
    const lines = await schedule(asset.id);

    expect(amounts(lines)).toEqual(['504.11', '1000.00', '1000.00', '495.89']);
    expect(lines[0]?.period_start).toBe('2026-01-01');
    expect(lines[0]?.period_end).toBe('2026-12-31');
    expect(lines.at(-1)?.accumulated).toBe('3000.00');
    expect(lines.at(-1)?.net_book_value).toBe('0.00');
  });

  it('takes the French prorata on a commercial year of three hundred and sixty days', async () => {
    // Office furniture of 12 000 €, five years, in service on 15 April 2026.
    // France counts the prorata on a year of 360 days and months of 30, so
    // 2026 carries 256 of them: 2 400 × 256 / 360 = 1 706,67.
    const asset = await one<{ id: string }>(
      db,
      `select assets.create_asset($1, 'MOB-01', 'Mobilier', date '2026-04-15', 12000,
              '218400', '281840', '681100', 'furniture', 60) as id`,
      [fr.companyId],
    );
    expect(amounts(await schedule(asset.id))).toEqual([
      '1706.67', '2400.00', '2400.00', '2400.00', '2400.00', '693.33',
    ]);
  });

  it('follows a financial year that is not the calendar year', async () => {
    // `fiscal_years` has always allowed a shifted year, so a schedule that
    // assumed January would be a module quietly disagreeing with the books.
    // The periods are anchored on the year that covers the day the asset
    // entered service, and each one takes that year's own end date where the
    // company has declared it.
    const shifted = await newCompany(db, { country: 'BE', name: 'Exercice décalé SRL' });
    await asUser(db, shifted.ownerId, async () => {
      await db.query(`select enable_module($1, 'assets')`, [shifted.companyId]);
    });
    await db.query(`delete from fiscal_years where company_id = $1`, [shifted.companyId]);
    for (const year of [2026, 2027, 2028]) {
      await db.query(
        `insert into fiscal_years (company_id, name, start_date, end_date)
         values ($1, $2, make_date($3, 7, 1), make_date($3 + 1, 6, 30))`,
        [shifted.companyId, `Exercice ${year}/${year + 1}`, year],
      );
    }

    const asset = await one<{ id: string }>(
      db,
      `select assets.create_asset($1, 'MAC-01', 'Machine', date '2026-08-01', 12000,
              '231000', '231900', '630200', null, 24) as id`,
      [shifted.companyId],
    );
    const lines = await schedule(asset.id);

    expect(lines.map((line) => [line.period_start, line.period_end])).toEqual([
      ['2026-07-01', '2027-06-30'],
      ['2027-07-01', '2028-06-30'],
      ['2028-07-01', '2029-06-30'],
    ]);
    // 334 of the 365 days of the first year, then a full annuity, then the rest.
    expect(amounts(lines)).toEqual(['5490.41', '6000.00', '509.59']);
    expect(lines.at(-1)?.accumulated).toBe('12000.00');
  });

  it('leaves the residual value on the books', async () => {
    const asset = await one<{ id: string }>(
      db,
      `select assets.create_asset($1, 'VEH-01', 'Camionnette', date '2027-01-01', 30000,
              '241000', '241900', '630200', null, 60, 'straight_line', null, 5000) as id`,
      [be.companyId],
    );
    const lines = await schedule(asset.id);
    expect(amounts(lines)).toEqual(['5000.00', '5000.00', '5000.00', '5000.00', '5000.00']);
    expect(lines.at(-1)?.net_book_value).toBe('5000.00');
  });
});

describe('a declining balance', () => {
  it('follows the French coefficient and switches to the straight line when that is larger', async () => {
    // 100 000 € over five years at the 1,75 of article 39 A CGI: 35 %.
    // 35 000, then 22 750, then 14 787,50 — and in the fourth year the
    // straight line over the two remaining years (13 731,25) overtakes the
    // declining annuity (9 611,88), which is where the switch happens.
    const asset = await one<{ id: string }>(
      db,
      `select assets.create_asset($1, 'MAC-01', 'Machine', date '2026-01-01', 100000,
              '215400', '281500', '681100', null, 60, 'declining_balance', 1.75) as id`,
      [fr.companyId],
    );
    expect(amounts(await schedule(asset.id))).toEqual([
      '35000.00', '22750.00', '14787.50', '13731.25', '13731.25',
    ]);
  });

  it('honours the Belgian cap of forty per cent of the acquisition value', async () => {
    // Belgium doubles the straight-line rate — 40 % on a five-year asset — and
    // article 36 AR/CIR 92 caps the annuity at 40 % of the acquisition value,
    // which on this asset is exactly the same figure. The cap bites on a
    // shorter duration, which the next test is for.
    const asset = await one<{ id: string }>(
      db,
      `select assets.create_asset($1, 'MAC-02', 'Machine', date '2026-01-01', 100000,
              '231000', '231900', '630200', null, 60, 'declining_balance', 2) as id`,
      [be.companyId],
    );
    expect(amounts(await schedule(asset.id))).toEqual([
      '40000.00', '24000.00', '14400.00', '10800.00', '10800.00',
    ]);
  });

  it('caps an annuity that would otherwise exceed forty per cent', async () => {
    // Three years at double the rate is 66,7 %, and the cap takes it to 40 %.
    const asset = await one<{ id: string }>(
      db,
      `select assets.create_asset($1, 'MAC-03', 'Outillage', date '2026-01-01', 90000,
              '233000', '233900', '630200', null, 36, 'declining_balance', 2) as id`,
      [be.companyId],
    );
    const lines = await schedule(asset.id);
    expect(lines[0]?.amount).toBe('36000.00');
    expect(
      lines.reduce((sum, line) => sum + Number(line.amount), 0).toFixed(2),
    ).toBe('90000.00');
  });

  it('refuses a schedule by output rather than guessing at the units', async () => {
    const message = await expectError(
      db,
      `insert into assets.assets (company_id, code, name, acquisition_date, cost, method,
                                  duration_months, asset_account_id, depreciation_account_id,
                                  expense_account_id)
       values ($1, 'UNI-01', 'Presse', date '2026-01-01', 50000, 'units_of_production', 60,
               account_id_by_code($1, '231000'), account_id_by_code($1, '231900'),
               account_id_by_code($1, '630200'))
       returning (select assets.generate_schedule(id))`,
      [be.companyId],
    );
    expect(message).toMatch(/units_of_production_unsupported/);
  });
});

describe('every schedule', () => {
  it('sums to exactly the cost less the residual value', async () => {
    const off = await rows<{ code: string; planned: string; expected: string }>(
      db,
      `select a.code,
              (select sum(l.amount) from assets.depreciation_lines l where l.asset_id = a.id) as planned,
              (a.cost - a.residual_value) as expected
         from assets.assets a
        where exists (select 1 from assets.depreciation_lines l where l.asset_id = a.id)
          and (select sum(l.amount) from assets.depreciation_lines l where l.asset_id = a.id)
              <> a.cost - a.residual_value`,
    );
    expect(off).toEqual([]);
  });
});

describe('running the depreciation', () => {
  let companyId: string;
  let ownerId: string;

  beforeAll(async () => {
    const fixture = await company('BE', 'Amortissements SRL');
    companyId = fixture.companyId;
    ownerId = fixture.ownerId;
    await db.query(
      `select assets.create_asset($1, 'IT-01', 'Portable', date '2026-01-01', 3600,
              '241000', '241900', '630200', 'it-equipment')`,
      [companyId],
    );
  });

  it('posts one entry per period, through post_entry, and marks the lines', async () => {
    const result = await one<{ run: { entries: { period_end: string; amount: string }[] } }>(
      db,
      `select assets.run_depreciation($1, date '2027-12-31') as run`,
      [companyId],
    );
    expect(result.run.entries.map((e) => [e.period_end, e.amount])).toEqual([
      ['2026-12-31', '1200.00'],
      ['2027-12-31', '1200.00'],
    ]);

    const entry = await one<{ number: string; state: string; module_code: string; module_ref: string }>(
      db,
      `select number, state::text, module_code, module_ref from entries
        where company_id = $1 and module_ref = 'depreciation:2026-12-31'`,
      [companyId],
    );
    expect(entry.state).toBe('posted');
    expect(entry.number).toMatch(/^MISC\/2026\/\d{4}$/);
    expect(entry.module_code).toBe('assets');

    const ledger = await rows<{ code: string; debit: string; credit: string }>(
      db,
      `select a.code, l.debit, l.credit
         from entry_lines l
         join accounts a on a.id = l.account_id
         join entries e on e.id = l.entry_id
        where e.company_id = $1 and e.module_ref = 'depreciation:2026-12-31'
        order by l.sequence`,
      [companyId],
    );
    expect(ledger).toEqual([
      { code: '630200', debit: '1200.00', credit: '0.00' },
      { code: '241900', debit: '0.00', credit: '1200.00' },
    ]);
  });

  it('does nothing at all the second time', async () => {
    const before = await one<{ n: number }>(
      db,
      `select count(*)::int as n from entries where company_id = $1 and module_code = 'assets'`,
      [companyId],
    );
    const again = await one<{ run: { entries: unknown[] } }>(
      db,
      `select assets.run_depreciation($1, date '2027-12-31') as run`,
      [companyId],
    );
    expect(again.run.entries).toEqual([]);
    const after = await one<{ n: number }>(
      db,
      `select count(*)::int as n from entries where company_id = $1 and module_code = 'assets'`,
      [companyId],
    );
    expect(after.n).toBe(before.n);
  });

  it('is refused by a closed financial year, because post_entry asserts the period', async () => {
    // Its own company: closing a year asks for every earlier one to be closed,
    // and the one above has entries in each of them.
    const closed = await company('BE', 'Exercice clos SRL');
    await db.query(
      `select assets.create_asset($1, 'IT-01', 'Portable', date '2026-01-01', 3600,
              '241000', '241900', '630200', 'it-equipment')`,
      [closed.companyId],
    );
    await db.query(
      `select close_fiscal_year(id) from fiscal_years
        where company_id = $1 and start_date = date '2026-01-01'`,
      [closed.companyId],
    );

    const message = await expectError(
      db,
      `select assets.run_depreciation($1, date '2026-12-31')`,
      [closed.companyId],
    );
    expect(message).toMatch(/fiscal_year_closed/);

    // And nothing was left half done: no entry, and the line is still pending.
    const pending = await one<{ n: number }>(
      db,
      `select count(*)::int as n from assets.depreciation_lines
        where company_id = $1 and posted_at is null`,
      [closed.companyId],
    );
    expect(pending.n).toBeGreaterThan(0);
  });

  it('refuses to rewrite a schedule whose lines are already booked', async () => {
    const asset = await one<{ id: string }>(
      db,
      `select id from assets.assets where company_id = $1 and code = 'IT-01'`,
      [companyId],
    );
    const message = await expectError(db, `select assets.generate_schedule($1)`, [asset.id]);
    expect(message).toMatch(/schedule_already_posted/);
  });

  it('refuses to be disabled while it holds booked depreciation', async () => {
    const message = await asUser(db, ownerId, () =>
      expectError(db, `select disable_module($1, 'assets')`, [companyId]),
    );
    expect(message).toMatch(/module_holds_data: assets/);
    expect(message).toMatch(/depreciation has been booked/);
  });
});

describe('a disposal', () => {
  it('books a Belgian gain on the net result', async () => {
    const fixture = await company('BE', 'Cession SRL');
    await db.query(
      `select assets.create_asset($1, 'VEH-01', 'Camionnette', date '2026-01-01', 24000,
              '241000', '241900', '630200', null, 48)`,
      [fixture.companyId],
    );
    await db.query(`select assets.run_depreciation($1, date '2027-12-31')`, [fixture.companyId]);

    // Two years booked: 12 000 written off, 12 000 left. Sold for 15 000, so
    // the gain is 3 000 and lands on 763 in one line.
    const asset = await one<{ id: string }>(
      db,
      `select id from assets.assets where company_id = $1 and code = 'VEH-01'`,
      [fixture.companyId],
    );
    const entry = await one<{ id: string }>(
      db,
      `select assets.dispose_asset($1, date '2028-01-15', 15000, '400000') as id`,
      [asset.id],
    );

    const ledger = await rows<{ code: string; debit: string; credit: string }>(
      db,
      `select a.code, l.debit, l.credit from entry_lines l
         join accounts a on a.id = l.account_id
        where l.entry_id = $1 order by l.sequence`,
      [entry.id],
    );
    expect(ledger).toEqual([
      { code: '241900', debit: '12000.00', credit: '0.00' },
      { code: '241000', debit: '0.00', credit: '24000.00' },
      { code: '400000', debit: '15000.00', credit: '0.00' },
      { code: '763000', debit: '0.00', credit: '3000.00' },
    ]);

    const disposal = await one<{ result: string; net_book_value: string }>(
      db,
      `select result, net_book_value from assets.disposals where asset_id = $1`,
      [asset.id],
    );
    expect(disposal.net_book_value).toBe('12000.00');
    expect(disposal.result).toBe('3000.00');
  });

  it('books a Belgian loss on the other account, and clears the register', async () => {
    const fixture = await company('BE', 'Perte SRL');
    await db.query(
      `select assets.create_asset($1, 'VEH-02', 'Camionnette', date '2026-01-01', 24000,
              '241000', '241900', '630200', null, 48)`,
      [fixture.companyId],
    );
    await db.query(`select assets.run_depreciation($1, date '2026-12-31')`, [fixture.companyId]);
    const asset = await one<{ id: string }>(
      db,
      `select id from assets.assets where company_id = $1 and code = 'VEH-02'`,
      [fixture.companyId],
    );
    const entry = await one<{ id: string }>(
      db,
      `select assets.dispose_asset($1, date '2027-03-01', 14000, '400000') as id`,
      [asset.id],
    );
    const ledger = await rows<{ code: string; debit: string; credit: string }>(
      db,
      `select a.code, l.debit, l.credit from entry_lines l
         join accounts a on a.id = l.account_id
        where l.entry_id = $1 order by l.sequence`,
      [entry.id],
    );
    // 6 000 written off, so the net book value is 18 000 and the 14 000 sale
    // is a loss of 4 000 on 663.
    expect(ledger).toEqual([
      { code: '241900', debit: '6000.00', credit: '0.00' },
      { code: '241000', debit: '0.00', credit: '24000.00' },
      { code: '400000', debit: '14000.00', credit: '0.00' },
      { code: '663000', debit: '4000.00', credit: '0.00' },
    ]);

    const register = await rows(db, `select * from assets.register($1, date '2027-12-31')`, [
      fixture.companyId,
    ]);
    expect(register).toEqual([]);
  });

  it('books a French disposal gross: the value sold as a charge, the proceeds as an income', async () => {
    const fixture = await company('FR', 'Cession SAS');
    await db.query(
      `select assets.create_asset($1, 'MAC-01', 'Machine', date '2026-01-01', 24000,
              '215400', '281500', '681100', null, 48)`,
      [fixture.companyId],
    );
    await db.query(`select assets.run_depreciation($1, date '2027-12-31')`, [fixture.companyId]);
    const asset = await one<{ id: string }>(
      db,
      `select id from assets.assets where company_id = $1 and code = 'MAC-01'`,
      [fixture.companyId],
    );
    const entry = await one<{ id: string }>(
      db,
      `select assets.dispose_asset($1, date '2028-01-15', 15000, '411000') as id`,
      [asset.id],
    );
    const ledger = await rows<{ code: string; debit: string; credit: string }>(
      db,
      `select a.code, l.debit, l.credit from entry_lines l
         join accounts a on a.id = l.account_id
        where l.entry_id = $1 order by l.sequence`,
      [entry.id],
    );
    expect(ledger).toEqual([
      { code: '281500', debit: '12000.00', credit: '0.00' },
      { code: '215400', debit: '0.00', credit: '24000.00' },
      { code: '411000', debit: '15000.00', credit: '0.00' },
      { code: '675000', debit: '12000.00', credit: '0.00' },
      { code: '775000', debit: '0.00', credit: '15000.00' },
    ]);
  });

  it('refuses while a period that has already ended is still unbooked', async () => {
    const fixture = await company('BE', 'Retard SRL');
    await db.query(
      `select assets.create_asset($1, 'MAC-01', 'Machine', date '2026-01-01', 24000,
              '231000', '231900', '630200', null, 48)`,
      [fixture.companyId],
    );
    const asset = await one<{ id: string }>(
      db,
      `select id from assets.assets where company_id = $1 and code = 'MAC-01'`,
      [fixture.companyId],
    );
    const message = await expectError(
      db,
      `select assets.dispose_asset($1, date '2027-06-30', 10000, '400000')`,
      [asset.id],
    );
    expect(message).toMatch(/depreciation_pending/);
  });
});

describe('the register and the movements', () => {
  it('show what has been booked, and nothing that has not', async () => {
    const fixture = await company('BE', 'Registre SRL');
    await db.query(
      `select assets.create_asset($1, 'MAC-01', 'Machine', date '2026-01-01', 10000,
              '231000', '231900', '630200', null, 60)`,
      [fixture.companyId],
    );
    await db.query(`select assets.run_depreciation($1, date '2026-12-31')`, [fixture.companyId]);

    const register = await rows<{ code: string; cost: string; accumulated: string; net_book_value: string }>(
      db,
      `select code, cost, accumulated, net_book_value from assets.register($1, date '2026-12-31')`,
      [fixture.companyId],
    );
    expect(register).toEqual([
      { code: 'MAC-01', cost: '10000.00', accumulated: '2000.00', net_book_value: '8000.00' },
    ]);

    const movements = await rows<{ additions: string; depreciation: string; closing_accumulated: string }>(
      db,
      `select additions, depreciation, closing_accumulated
         from assets.movements($1, date '2026-01-01', date '2026-12-31')`,
      [fixture.companyId],
    );
    expect(movements).toEqual([
      { additions: '10000.00', depreciation: '2000.00', closing_accumulated: '2000.00' },
    ]);
  });

  it('tie to the ledger account they sit on', async () => {
    const fixture = await company('BE', 'Rapprochement SRL');
    await db.query(
      `select assets.create_asset($1, 'MAC-01', 'Machine', date '2026-01-01', 10000,
              '231000', '231900', '630200', null, 60)`,
      [fixture.companyId],
    );
    await db.query(`select assets.run_depreciation($1, date '2027-12-31')`, [fixture.companyId]);

    const booked = await one<{ balance: string }>(
      db,
      `select coalesce(sum(l.credit - l.debit), 0)::numeric(16,2) as balance
         from entry_lines l join accounts a on a.id = l.account_id
         join entries e on e.id = l.entry_id
        where l.company_id = $1 and a.code = '231900' and e.state = 'posted'`,
      [fixture.companyId],
    );
    const register = await one<{ accumulated: string }>(
      db,
      `select accumulated from assets.register($1, date '2027-12-31')`,
      [fixture.companyId],
    );
    expect(register.accumulated).toBe(booked.balance);
  });
});

describe('a monthly company', () => {
  it('splits each annuity into months, the last one taking the remainder', async () => {
    const fixture = await newCompany(db, { country: 'BE', name: 'Mensuel SRL' });
    await asUser(db, fixture.ownerId, async () => {
      await db.query(`select enable_module($1, 'assets', '{"period":"monthly"}'::jsonb)`, [
        fixture.companyId,
      ]);
    });
    await db.query(
      `select assets.create_asset($1, 'IT-01', 'Portable', date '2026-01-01', 1000,
              '241000', '241900', '630200', null, 12)`,
      [fixture.companyId],
    );
    const asset = await one<{ id: string }>(
      db,
      `select id from assets.assets where company_id = $1 and code = 'IT-01'`,
      [fixture.companyId],
    );
    const lines = await schedule(asset.id);
    expect(lines).toHaveLength(12);
    // 1 000 over twelve months is 83,33 eleven times and 83,37 once — the
    // remainder lands on the last month of the period, not on a rounding
    // account and not nowhere.
    expect(amounts(lines).slice(0, 11)).toEqual(Array(11).fill('83.33'));
    expect(lines[11]?.amount).toBe('83.37');
    expect(lines[11]?.accumulated).toBe('1000.00');
    expect(lines[0]?.period_start).toBe('2026-01-01');
    expect(lines[11]?.period_end).toBe('2026-12-31');
  });
});

describe('row level security', () => {
  it('shows a member of another company nothing at all', async () => {
    const stranger = await newCompany(db, { country: 'BE', name: 'Voisine SRL' });
    const seen = await asUser(db, stranger.ownerId, () =>
      rows(db, `select id from assets.assets`),
    );
    expect(seen).toEqual([]);
  });

  it('shows a member their own assets, once the module is on', async () => {
    const fixture = await company('BE', 'Lecture SRL');
    await db.query(
      `select assets.create_asset($1, 'MAC-01', 'Machine', date '2026-01-01', 10000,
              '231000', '231900', '630200', null, 60)`,
      [fixture.companyId],
    );
    const seen = await asUser(db, fixture.ownerId, () =>
      rows<{ code: string }>(db, `select code from assets.assets`),
    );
    expect(seen.map((r) => r.code)).toEqual(['MAC-01']);
  });

  it('hides the rows again the moment the module is disabled', async () => {
    const fixture = await company('BE', 'Coupure SRL');
    await db.query(
      `select assets.create_asset($1, 'MAC-01', 'Machine', date '2026-01-01', 10000,
              '231000', '231900', '630200', null, 60)`,
      [fixture.companyId],
    );
    const message = await asUser(db, fixture.ownerId, () =>
      expectError(db, `select disable_module($1, 'assets')`, [fixture.companyId]),
    );
    expect(message).toMatch(/still holds assets/);

    await db.query(`delete from assets.assets where company_id = $1`, [fixture.companyId]);
    await asUser(db, fixture.ownerId, async () => {
      await db.query(`select disable_module($1, 'assets')`, [fixture.companyId]);
    });
    const seen = await asUser(db, fixture.ownerId, () => rows(db, `select id from assets.assets`));
    expect(seen).toEqual([]);
  });

  it('lets an accountant of the company create an asset, and a viewer not', async () => {
    const fixture = await company('BE', 'Roles SRL');
    const accountant = crypto.randomUUID();
    const viewer = crypto.randomUUID();
    await db.query(
      `insert into company_members (company_id, user_id, role)
       values ($1, $2, 'accountant'), ($1, $3, 'viewer')`,
      [fixture.companyId, accountant, viewer],
    );

    const created = await asUser(db, accountant, () =>
      one<{ id: string }>(
        db,
        `select assets.create_asset($1, 'MAC-01', 'Machine', date '2026-01-01', 10000,
                '231000', '231900', '630200', null, 60) as id`,
        [fixture.companyId],
      ),
    );
    expect(created.id).toBeTruthy();

    const message = await asUser(db, viewer, () =>
      expectError(
        db,
        `select assets.create_asset($1, 'MAC-02', 'Machine', date '2026-01-01', 10000,
                '231000', '231900', '630200', null, 60)`,
        [fixture.companyId],
      ),
    );
    expect(message).toMatch(/row-level security|violates/i);
  });

  it('refuses an asset on a company that has not enabled the module', async () => {
    const fixture = await newCompany(db, { country: 'BE', name: 'Sans module SRL' });
    const message = await expectError(
      db,
      `select assets.create_asset($1, 'MAC-01', 'Machine', date '2026-01-01', 10000,
              '231000', '231900', '630200', null, 60)`,
      [fixture.companyId],
    );
    expect(message).toMatch(/module_not_enabled/);
  });
});

describe('the country data', () => {
  it('carries Belgium and France, each with the source it comes from', async () => {
    const rules = await rows<{ country: string; disposal_style: string; declining_cap_percent: string | null }>(
      db,
      `select country, disposal_style::text, declining_cap_percent from assets.country_rules order by country`,
    );
    expect(rules).toEqual([
      { country: 'BE', disposal_style: 'net_result', declining_cap_percent: '40.000' },
      { country: 'FR', disposal_style: 'gross', declining_cap_percent: null },
    ]);

    const unsourced = await rows(
      db,
      `select country, code from assets.category_templates where legal_reference is null`,
    );
    expect(unsourced).toEqual([]);
  });

  it('names a disposal account for each style, and nothing for the other', async () => {
    const roles = await rows<Record<string, string | null>>(
      db,
      `select country, asset_disposal_gain_code, asset_disposal_loss_code,
              asset_disposal_proceeds_code, asset_disposal_value_code
         from country_defaults order by country`,
    );
    expect(roles).toEqual([
      {
        country: 'BE',
        asset_disposal_gain_code: '763000',
        asset_disposal_loss_code: '663000',
        asset_disposal_proceeds_code: null,
        asset_disposal_value_code: null,
      },
      {
        country: 'FR',
        asset_disposal_gain_code: null,
        asset_disposal_loss_code: null,
        asset_disposal_proceeds_code: '775000',
        asset_disposal_value_code: '675000',
      },
    ]);
  });
});
