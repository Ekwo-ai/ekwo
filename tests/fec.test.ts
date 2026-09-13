import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { checkFec, fromQueryRow, generateFec, type FecQueryRow } from '@ekwo-ai/fec';
import { asUser, expectError, freshDatabase, one, repoRoot, rows } from './helpers/db.js';
import {
  DEMO_OWNER,
  demoCompanyId,
  newCompany,
  newContact,
  newDocument,
  type Fixture,
} from './helpers/factory.js';

// The format itself is tested where it lives, in `packages/formats/fec`. What
// is tested here is the join: that `fec_lines()` returns the columns the brick
// reads, under the names it reads them by. Nothing but this file knows both.

const goldenPath = join(repoRoot, 'tests', 'fixtures', 'demo-fec.txt');

describe('FEC export of the demo company', () => {
  let db: PGlite;
  let companyId: string;

  beforeAll(async () => {
    db = await freshDatabase();
    companyId = await demoCompanyId(db);
    // `posted_at` is the wall clock; freeze it so the golden file is stable.
    await db.query(`update entries set posted_at = timestamptz '2026-09-01 09:00:00+00'`);
    await db.query(`update reconciliations set matched_at = date '2026-08-05'`);
  });

  afterAll(async () => {
    await db.close();
  });

  it('matches the golden file', async () => {
    const queried = await rows<FecQueryRow>(
      db,
      `select * from fec_lines($1, '2026-01-01', '2026-12-31')`,
      [companyId],
    );
    const file = generateFec(queried.map(fromQueryRow));

    if (process.env['UPDATE_GOLDEN'] === '1') {
      await writeFile(goldenPath, file, 'utf8');
    }
    const golden = await readFile(goldenPath, 'utf8');
    expect(file).toBe(golden);
  });

  it('produces a file every entry of which balances', async () => {
    const queried = await rows<FecQueryRow>(
      db,
      `select * from fec_lines($1, '2026-01-01', '2026-12-31')`,
      [companyId],
    );
    expect(checkFec(queried.map(fromQueryRow))).toEqual([]);
  });

  it('carries the sub-ledger code and the reconciliation letter', async () => {
    const queried = await rows<FecQueryRow>(
      db,
      `select * from fec_lines($1, '2026-01-01', '2026-12-31')`,
      [companyId],
    );
    const receivable = queried.filter((r) => r.compte_num === '400000');
    expect(receivable.length).toBeGreaterThan(0);
    expect(receivable.every((r) => r.comp_aux_num !== null)).toBe(true);

    const lettered = queried.filter((r) => r.ecriture_let !== null);
    expect(lettered).toHaveLength(2);
    expect(new Set(lettered.map((r) => r.ecriture_let)).size).toBe(1);
    expect(lettered.every((r) => r.date_let !== null)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The opening balances
//
// A FEC of a financial year has to rebuild the balance sheet, and until the
// opening lines existed it could not: every account started the year at nil.
// They are computed from the ledger and never posted, because every report
// here reads the ledger from the beginning and an opening *entry* on top of
// that counts each carried balance twice.
//
// Two things are asserted over and over below, because they are the whole
// design. The opening lines balance on their own, so the file balances. And
// they do not depend on whether the year before has been closed: an
// accountant exports the file of a year long before the meeting that closes
// the one before it, and the two files have to agree to the cent.
// ---------------------------------------------------------------------------

interface OpeningLine {
  account: string;
  debit: string;
  credit: string;
  label: string;
  number: string;
  journal: string;
}

/** The lines of a FEC, and the opening ones told apart from the movements. */
async function fec(db: PGlite, companyId: string, from: string, to: string) {
  const queried = await rows<FecQueryRow>(db, `select * from fec_lines($1, $2::date, $3::date)`, [
    companyId,
    from,
    to,
  ]);
  // The opening lines are the ones whose number the export built rather than
  // the ledger: the opening journal's code and the day the year opens.
  const opening: OpeningLine[] = queried
    .filter((r) => /^[A-Z]+-\d{8}$/.test(r.ecriture_num))
    .map((r) => ({
      account: r.compte_num,
      debit: r.debit,
      credit: r.credit,
      label: r.ecriture_lib,
      number: r.ecriture_num,
      journal: r.journal_code,
    }));
  return { queried, lines: queried.map(fromQueryRow), opening };
}

const sum = (values: string[]): number =>
  Math.round(values.reduce((total, value) => total + Number(value), 0) * 100) / 100;

describe('the opening balances of a financial year', () => {
  let db: PGlite;

  beforeEach(async () => {
    db = await freshDatabase();
  });

  afterEach(async () => {
    await db.close();
  });

  /** A French company that traded in 2025 and is now living in 2026. */
  async function frenchCompanyWithAHistory(): Promise<Fixture> {
    const fx = await newCompany(db, { country: 'FR', name: 'Reprise SAS' });
    await db.query(
      `insert into fiscal_years (company_id, name, start_date, end_date)
       values ($1, 'Exercice 2025', date '2025-01-01', date '2025-12-31')`,
      [fx.companyId],
    );

    const customer = await newContact(db, fx.companyId, { type: 'customer', country: 'FR' });
    const supplier = await newContact(db, fx.companyId, { type: 'supplier', country: 'FR' });
    const invoice = await newDocument(db, fx.companyId, {
      docType: 'sale_invoice',
      contactId: customer,
      date: '2025-06-15',
      lines: [{ unitPrice: 10000, taxCode: 'FR-S-20', accountCode: '706000' }],
    });
    const bill = await newDocument(db, fx.companyId, {
      docType: 'purchase_invoice',
      contactId: supplier,
      date: '2025-06-20',
      lines: [{ unitPrice: 4000, taxCode: 'FR-P-20', accountCode: '611000' }],
    });
    await asUser(db, fx.ownerId, async () => {
      await db.query(`select post_document($1)`, [invoice]);
      await db.query(`select post_document($1)`, [bill]);
    });
    return fx;
  }

  async function closeYear(fx: Fixture, name: string): Promise<void> {
    const year = await one<{ id: string }>(
      db,
      `select id from fiscal_years where company_id = $1 and name = $2`,
      [fx.companyId, name],
    );
    await asUser(db, fx.ownerId, () => db.query(`select close_fiscal_year($1)`, [year.id]));
  }

  it('balance, and carry the result of a year nobody has closed', async () => {
    const fx = await frenchCompanyWithAHistory();
    const { lines, opening } = await asUser(db, fx.ownerId, () =>
      fec(db, fx.companyId, '2026-01-01', '2026-12-31'),
    );

    expect(checkFec(lines)).toEqual([]);
    expect(sum(opening.map((l) => l.debit))).toBe(sum(opening.map((l) => l.credit)));

    // 10 000 sold, 4 000 bought: a profit of 6 000 sitting in classes 6 and 7,
    // which no close has moved anywhere. The file puts it where the close
    // would have — France keeps a profit of the year on its own balance-sheet
    // account until a meeting allocates it.
    expect(opening).toEqual([
      { account: '120000', debit: '0.00', credit: '6000.00', label: 'À-nouveaux', number: 'OPN-20260101', journal: 'OPN' },
      { account: '401000', debit: '0.00', credit: '4800.00', label: 'À-nouveaux', number: 'OPN-20260101', journal: 'OPN' },
      { account: '411000', debit: '12000.00', credit: '0.00', label: 'À-nouveaux', number: 'OPN-20260101', journal: 'OPN' },
      { account: '445660', debit: '800.00', credit: '0.00', label: 'À-nouveaux', number: 'OPN-20260101', journal: 'OPN' },
      { account: '445710', debit: '0.00', credit: '2000.00', label: 'À-nouveaux', number: 'OPN-20260101', journal: 'OPN' },
    ]);
  });

  it('do not change when the year before is closed: the same file, to the cent', async () => {
    const fx = await frenchCompanyWithAHistory();
    const before = await asUser(db, fx.ownerId, () =>
      fec(db, fx.companyId, '2026-01-01', '2026-12-31'),
    );

    await closeYear(fx, 'Exercice 2025');

    const after = await asUser(db, fx.ownerId, () =>
      fec(db, fx.companyId, '2026-01-01', '2026-12-31'),
    );

    // Closing 2025 posts the result onto 120 for real. The opening lines of
    // 2026 read the same figures, because they read the same ledger — what
    // changes is where the 6 000 comes from, not what it is.
    expect(after.opening).toEqual(before.opening);
    expect(checkFec(after.lines)).toEqual([]);
    expect(generateFec(after.lines)).toBe(generateFec(before.lines));
  });

  it('equal the closing balances of the year before, account by account', async () => {
    const fx = await frenchCompanyWithAHistory();
    await closeYear(fx, 'Exercice 2025');

    const closing = await asUser(db, fx.ownerId, () =>
      rows<{ code: string; balance: string }>(
        db,
        `select account_code as code, closing_balance::text as balance
           from trial_balance($1, date '2025-01-01', date '2025-12-31')
          where closing_balance <> 0 order by account_code`,
        [fx.companyId],
      ),
    );
    const { opening } = await asUser(db, fx.ownerId, () =>
      fec(db, fx.companyId, '2026-01-01', '2026-12-31'),
    );

    // A closed year leaves nothing but the balance sheet standing, so the two
    // lists are the same list: same accounts, same amounts, the side chosen
    // from the sign.
    expect(opening.map((l) => l.account)).toEqual(closing.map((b) => b.code));
    for (const [index, line] of opening.entries()) {
      const balance = Number(closing[index]?.balance);
      expect(Number(line.debit) - Number(line.credit), line.account).toBe(balance);
    }
  });

  it('are one balanced entry of the opening journal, not one entry per account', async () => {
    const fx = await frenchCompanyWithAHistory();
    const { opening } = await asUser(db, fx.ownerId, () =>
      fec(db, fx.companyId, '2026-01-01', '2026-12-31'),
    );
    expect(new Set(opening.map((l) => l.number)).size).toBe(1);
    expect(new Set(opening.map((l) => l.journal))).toEqual(new Set(['OPN']));
  });

  it('are absent from a period that is not a whole financial year', async () => {
    const fx = await frenchCompanyWithAHistory();
    for (const [from, to] of [
      ['2026-01-01', '2026-06-30'],
      ['2026-02-01', '2026-12-31'],
    ]) {
      const { opening } = await asUser(db, fx.ownerId, () =>
        fec(db, fx.companyId, from as string, to as string),
      );
      expect(opening, `${from}..${to}`).toEqual([]);
    }
  });

  it('take their wording from the pack, and a neutral one where the pack is silent', async () => {
    // The format fixes eighteen columns and no wording, and an administration
    // reads the file in its own language — so the label is a value of the
    // country model. Belgium names none, and gets the fallback rather than a
    // refusal: there is no wrong answer a missing label could give.
    const fx = await frenchCompanyWithAHistory();
    const french = await asUser(db, fx.ownerId, () =>
      fec(db, fx.companyId, '2026-01-01', '2026-12-31'),
    );
    expect(new Set(french.opening.map((l) => l.label))).toEqual(new Set(['À-nouveaux']));

    await db.query(`update country_defaults set opening_entry_label = null where country = 'FR'`);
    const silent = await asUser(db, fx.ownerId, () =>
      fec(db, fx.companyId, '2026-01-01', '2026-12-31'),
    );
    expect(new Set(silent.opening.map((l) => l.label))).toEqual(new Set(['Opening balance']));
  });
});

describe('what the opening balances refuse, by name', () => {
  let db: PGlite;

  beforeEach(async () => {
    db = await freshDatabase();
  });

  afterEach(async () => {
    await db.close();
  });

  async function companyWithABalance(): Promise<Fixture> {
    const fx = await newCompany(db, { country: 'FR', name: 'Refus SAS' });
    await db.query(
      `insert into fiscal_years (company_id, name, start_date, end_date)
       values ($1, 'Exercice 2025', date '2025-01-01', date '2025-12-31')`,
      [fx.companyId],
    );
    const customer = await newContact(db, fx.companyId, { type: 'customer', country: 'FR' });
    const invoice = await newDocument(db, fx.companyId, {
      docType: 'sale_invoice',
      contactId: customer,
      date: '2025-06-15',
      lines: [{ unitPrice: 10000, taxCode: 'FR-S-20', accountCode: '706000' }],
    });
    await asUser(db, fx.ownerId, () => db.query(`select post_document($1)`, [invoice]));
    return fx;
  }

  it('refuses a pack that names no opening journal', async () => {
    const fx = await companyWithABalance();
    await db.query(`update country_defaults set opening_journal_code = null where country = 'FR'`);
    const message = await asUser(db, fx.ownerId, () =>
      expectError(db, `select * from fec_lines($1, date '2026-01-01', date '2026-12-31')`, [
        fx.companyId,
      ]),
    );
    expect(message).toMatch(/no_opening_journal/);
    expect(message).toMatch(/defaults\.journal_roles\.opening/);
  });

  it('refuses a pack that names no account for a result nobody has closed', async () => {
    const fx = await companyWithABalance();
    await db.query(
      `update country_defaults set current_year_result_profit_code = null where country = 'FR'`,
    );
    const message = await asUser(db, fx.ownerId, () =>
      expectError(db, `select * from fec_lines($1, date '2026-01-01', date '2026-12-31')`, [
        fx.companyId,
      ]),
    );
    expect(message).toMatch(/no_result_account/);
  });

  it('refuses an account that does not carry forward, which would carry nothing', async () => {
    const fx = await companyWithABalance();
    await db.query(
      `update country_defaults set current_year_result_profit_code = '706000' where country = 'FR'`,
    );
    const message = await asUser(db, fx.ownerId, () =>
      expectError(db, `select * from fec_lines($1, date '2026-01-01', date '2026-12-31')`, [
        fx.companyId,
      ]),
    );
    expect(message).toMatch(/no_result_account/);
    expect(message).toMatch(/income or expense account/);
  });

  it('asks the pack for nothing at all when there is nothing to carry', async () => {
    // A first set of books opens on nil, and a company whose pack names no
    // opening journal still gets its file. The refusals above are about a
    // balance that exists and has nowhere to go.
    const fx = await newCompany(db, { country: 'FR', name: 'Premier exercice SAS' });
    await db.query(`update country_defaults set opening_journal_code = null where country = 'FR'`);
    const { opening, lines } = await asUser(db, fx.ownerId, () =>
      fec(db, fx.companyId, '2026-01-01', '2026-12-31'),
    );
    expect(opening).toEqual([]);
    expect(checkFec(lines)).toEqual([]);
  });
});

describe('the entries a close writes', () => {
  let db: PGlite;
  let companyId: string;

  beforeEach(async () => {
    db = await freshDatabase();
    companyId = await demoCompanyId(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it('leave the file of the year they close exactly as it was', async () => {
    // The demo books are Belgian, which is the interesting case: a close there
    // writes two entries, an appropriation and a closing one, both dated
    // inside the year. Kept in the file, the result would appear twice — in
    // classes 6 and 7 and again on retained earnings — and the income
    // statement read from the file would be nil.
    const before = await asUser(db, DEMO_OWNER, () =>
      fec(db, companyId, '2026-01-01', '2026-12-31'),
    );

    const year = await one<{ id: string }>(
      db,
      `select id from fiscal_years where company_id = $1 and name = 'Exercice 2026'`,
      [companyId],
    );
    await asUser(db, DEMO_OWNER, () => db.query(`select close_fiscal_year($1)`, [year.id]));

    const after = await asUser(db, DEMO_OWNER, () =>
      fec(db, companyId, '2026-01-01', '2026-12-31'),
    );
    expect(generateFec(after.lines)).toBe(generateFec(before.lines));
    expect(checkFec(after.lines)).toEqual([]);
  });

  it('reach the next year through its opening lines, closed or not', async () => {
    // Belgium appropriates through 693, which the closing entry then empties,
    // so what a balance sheet carries forward is 140 and never 693. The file
    // of 2027 says so whether 2026 has been closed or not.
    await db.query(
      `insert into fiscal_years (company_id, name, start_date, end_date)
       values ($1, 'Exercice 2027', date '2027-01-01', date '2027-12-31')`,
      [companyId],
    );
    const open = await asUser(db, DEMO_OWNER, () =>
      fec(db, companyId, '2027-01-01', '2027-12-31'),
    );

    expect(open.opening).toEqual([
      { account: '140000', debit: '0.00', credit: '9560.00', label: 'Opening balance', number: 'OPN-20270101', journal: 'OPN' },
      { account: '241000', debit: '2400.00', credit: '0.00', label: 'Opening balance', number: 'OPN-20270101', journal: 'OPN' },
      { account: '400000', debit: '9629.00', credit: '0.00', label: 'Opening balance', number: 'OPN-20270101', journal: 'OPN' },
      { account: '411000', debit: '1268.40', credit: '0.00', label: 'Opening balance', number: 'OPN-20270101', journal: 'OPN' },
      { account: '440000', debit: '0.00', credit: '7100.50', label: 'Opening balance', number: 'OPN-20270101', journal: 'OPN' },
      { account: '451000', debit: '0.00', credit: '1113.90', label: 'Opening balance', number: 'OPN-20270101', journal: 'OPN' },
      { account: '550000', debit: '4477.00', credit: '0.00', label: 'Opening balance', number: 'OPN-20270101', journal: 'OPN' },
    ]);
    expect(sum(open.opening.map((l) => l.debit))).toBe(17774.4);
    expect(sum(open.opening.map((l) => l.credit))).toBe(17774.4);

    const year = await one<{ id: string }>(
      db,
      `select id from fiscal_years where company_id = $1 and name = 'Exercice 2026'`,
      [companyId],
    );
    await asUser(db, DEMO_OWNER, () => db.query(`select close_fiscal_year($1)`, [year.id]));

    const closed = await asUser(db, DEMO_OWNER, () =>
      fec(db, companyId, '2027-01-01', '2027-12-31'),
    );
    expect(closed.opening).toEqual(open.opening);
    expect(checkFec(closed.lines)).toEqual([]);
  });
});
