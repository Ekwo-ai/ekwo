/**
 * A company installed at the previous version, carried through a whole year.
 *
 * This is the test the release is judged on. It starts where a real
 * installation starts — the seeds of 1.0.0, a company created from them,
 * releases of schema since — brings it to this release, upgrades its pack
 * through `ekwo pack upgrade`, and then does the year.
 *
 * **The year is the pack's own golden scenario, not a year invented here.**
 * `packs/<cc>/golden/scenario.json` is the one year a country pack carries and
 * `packs/<cc>/golden/` holds the figures it produces, reviewed and committed.
 * Replaying it on a company that came up through an upgrade turns those files
 * into the claim this test exists to make: **an installation upgraded from
 * 1.0.0 is, to the cent, the installation a fresh `ekwo init` gives you.** A
 * scenario of its own here would have been a second year of books per country
 * that nobody reviewed, and a reason for the two to drift.
 *
 * What the golden does not do, and this does: the upgrade itself, the close of
 * the year, the re-opening, the close again, and the opening balance that
 * carries the result into the year after. The figures of the close are
 * compared to ones this file works out from `sum(debit) - sum(credit)`, and
 * both financial statements are compared, line by line, to a reimplementation
 * of the rule engine in `./expected.ts` — so a golden regenerated from a
 * broken engine, which would agree with itself, would not agree with this.
 *
 * It runs once per country the frozen 1.0.0 seeds carry. A country added to
 * `packs/` since has no "previous version" to upgrade from and is covered by
 * `tests/golden.test.ts` instead.
 */

import type { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { packUpgrade, packsDir, readPack, type PackGolden } from '../../packages/cli/src/index.js';
import { adapt, type Queryable } from '../cli/helpers.js';
import { asUser, one, rows } from '../helpers/db.js';
import {
  companyInstalledAtOneZeroZero,
  countriesFrozenAtOneZeroZero,
} from '../helpers/installed-at-1-0-0.js';
import { replayScenario } from '../helpers/golden-scenario.js';
import { expectedStatement } from './expected.js';

interface VatExpectation {
  periods: { code: string; from: string; to: string; boxes: Record<string, string> }[];
}
interface StatementExpectation {
  statements: { code: string; from: string; to: string; lines: Record<string, string> }[];
}

const countries = await countriesFrozenAtOneZeroZero();

/** The pack of a country, by its two letters rather than by its folder. */
async function packOf(country: string): Promise<{ slug: string; golden: PackGolden | null }> {
  const slug = country.toLowerCase();
  const pack = await readPack(slug);
  return { slug, golden: pack.golden };
}

describe.each(countries)('%s — installed at 1.0.0, then a whole year', (country) => {
  let pg: PGlite;
  let companyId: string;
  let ownerId: string;
  let decimals: number;
  let yearId: string;
  let golden: PackGolden;
  let goldenDir: string;

  beforeAll(async () => {
    const pack = await packOf(country);
    if (pack.golden === null) throw new Error(`${country} carries no golden scenario to replay`);
    golden = pack.golden;
    goldenDir = join(packsDir(), pack.slug, 'golden');

    ({ db: pg, companyId, ownerId } = await companyInstalledAtOneZeroZero({
      country,
      modules: false,
      name: golden.name,
    }));

    // The upgrade, through the CLI's own command rather than the SQL function:
    // `ekwo pack upgrade <company> --apply` is the supported way in.
    const db = adapt(pg as unknown as Queryable, pg);
    const upgrade = await asUser(pg, ownerId, () => packUpgrade(db, companyId, { apply: true }));
    expect(upgrade.version_moved).toBe(true);

    const currency = await one<{ decimal_places: number }>(
      pg,
      `select c.decimal_places from currencies c
         join companies co on co.currency_code = c.code where co.id = $1`,
      [companyId],
    );
    decimals = Number(currency.decimal_places);

    const year = await one<{ id: string }>(
      pg,
      `insert into fiscal_years (company_id, name, start_date, end_date)
       values ($1, $2, $3::date, $4::date) returning id`,
      [companyId, golden.fiscalYear.name, golden.fiscalYear.start, golden.fiscalYear.end],
    );
    yearId = year.id;

    await asUser(pg, ownerId, () => replayScenario(pg, companyId, golden));
  }, 300_000);

  afterAll(async () => {
    await pg.close();
  });

  it('gained, in the upgrade, the journal a close needs and 1.0.0 never had', async () => {
    const opening = await one<{ n: string }>(
      pg,
      `select count(*)::text as n from journals
        where company_id = $1 and journal_type::text = 'opening' and active`,
      [companyId],
    );
    expect(Number(opening.n)).toBe(1);

    const held = await one<{ version: string; chart_code: string }>(
      pg,
      `select version, chart_code from company_packs where company_id = $1`,
      [companyId],
    );
    const pack = await one<{ version: string }>(
      pg,
      `select version from country_packs where country = $1`,
      [country],
    );
    expect(held.version).toBe(pack.version);
    // The golden is written for a chart, and this company copied the default
    // one at 1.0.0, when a country had exactly one. A golden on another chart
    // would be replaying a scenario on a chart this company does not hold.
    expect(golden.chart).toBe(held.chart_code);
  });

  it('books the pack’s golden year without a single refusal', async () => {
    const posted = await one<{ n: string }>(
      pg,
      `select count(*)::text as n from documents where company_id = $1 and state = 'posted'`,
      [companyId],
    );
    expect(Number(posted.n)).toBe(golden.documents.length);

    const balanced = await one<{ debit: string; credit: string }>(
      pg,
      `select coalesce(sum(l.debit), 0)::text as debit, coalesce(sum(l.credit), 0)::text as credit
         from entry_lines l join entries e on e.id = l.entry_id
        where e.company_id = $1 and e.state = 'posted'`,
      [companyId],
    );
    expect(balanced.debit).toBe(balanced.credit);
    expect(Number(balanced.debit)).toBeGreaterThan(0);
  });

  it('files, box for box, the declaration a fresh installation files', async () => {
    // The whole point of the upgrade path: what a company that came up through
    // it reports has to be what `tests/golden.test.ts` pinned on a company
    // that never needed one. A difference here is a pack upgrade that lost
    // something, and there is nowhere else it would show.
    const expected = JSON.parse(
      await readFile(join(goldenDir, 'vat_return.json'), 'utf8'),
    ) as VatExpectation;

    for (const period of expected.periods) {
      const boxes = await rows<{ box: string; kind: string; amount: string }>(
        pg,
        `select box, kind, amount::text from vat_return($1, $2::date, $3::date)
          order by sequence, kind`,
        [companyId, period.from, period.to],
      );
      const filed = Object.fromEntries(
        boxes.map((b) => [`${b.box}:${b.kind}`, Number(b.amount).toFixed(decimals)]),
      );
      expect({ period: period.code, boxes: filed }).toEqual({
        period: period.code,
        boxes: period.boxes,
      });
    }
    expect(expected.periods.length).toBeGreaterThan(0);
  });

  it('draws, line for line, the financial statements a fresh installation draws', async () => {
    const expected = JSON.parse(
      await readFile(join(goldenDir, 'statements.json'), 'utf8'),
    ) as StatementExpectation;

    for (const statement of expected.statements) {
      const lines = await rows<{ line_code: string; amount: string }>(
        pg,
        `select line_code, amount::text from financial_statement($1, $2, $3::date, $4::date)
          order by sequence, line_code`,
        [companyId, statement.code, statement.from, statement.to],
      );
      const drawn = Object.fromEntries(
        lines.map((l) => [l.line_code, Number(l.amount).toFixed(decimals)]),
      );
      expect({ statement: statement.code, lines: drawn }).toEqual({
        statement: statement.code,
        lines: statement.lines,
      });
    }
    expect(expected.statements.length).toBeGreaterThan(0);
  });

  it('and those statements are what the ledger says, not what a file says', async () => {
    // A golden regenerated from a broken engine agrees with itself. This does
    // not: every line is rebuilt in TypeScript from `sum(debit) - sum(credit)`
    // and the pack's own rules.
    for (const code of golden.statements) {
      const produced = await rows<{ line_code: string; is_total: boolean; amount: string }>(
        pg,
        `select line_code, is_total, amount::text as amount
           from financial_statement($1, $2, $3::date, $4::date)`,
        [companyId, code, golden.fiscalYear.start, golden.fiscalYear.end],
      );
      const expected = await expectedStatement(
        pg,
        companyId,
        code,
        golden.fiscalYear.start,
        golden.fiscalYear.end,
        decimals,
      );
      const render = (lines: { line_code: string; is_total: boolean; amount: number }[]): string[] =>
        lines
          .map((l) => `${l.line_code} ${l.is_total ? 'T' : ' '} ${l.amount.toFixed(decimals)}`)
          .sort((a, b) => a.localeCompare(b));

      expect(produced.length).toBeGreaterThan(5);
      expect(
        render(
          produced.map((r) => ({
            line_code: r.line_code,
            is_total: r.is_total,
            amount: Number(r.amount),
          })),
        ),
        `${code} does not say what the ledger says`,
      ).toEqual(render(expected.lines));

      // And nothing fell off the scheme: an account with a balance and no line
      // is money the statement does not show.
      const orphans = await rows<{ account_code: string }>(
        pg,
        `select account_code from unmapped_accounts($1, $2, $3::date, $4::date)`,
        [companyId, code, golden.fiscalYear.start, golden.fiscalYear.end],
      );
      expect(orphans.map((o) => o.account_code).sort()).toEqual(
        expected.unmapped.map((a) => a.code).sort(),
      );
      expect(orphans).toHaveLength(0);
    }
    expect(golden.statements.length).toBeGreaterThan(1);
  });

  it('closes, re-opens and closes again on the same result', async () => {
    const profit = await one<{ result: string }>(
      pg,
      `select (sum(l.credit) - sum(l.debit))::text as result
         from entry_lines l
         join entries e on e.id = l.entry_id
         join accounts a on a.id = l.account_id
        where l.company_id = $1 and e.state = 'posted'
          and e.entry_date between $2::date and $3::date
          and not a.carries_forward`,
      [companyId, golden.fiscalYear.start, golden.fiscalYear.end],
    );
    const expectedResult = Number(profit.result);
    expect(expectedResult).not.toBe(0);

    // Closing is what makes a balance sheet balance. Until the result of the
    // year is appropriated, the accounts that carry forward are out by exactly
    // that result, and every scheme prints the gap.
    expect(await carriedForward()).toBe(expectedResult);

    const first = await asUser(pg, ownerId, () =>
      one<{ close_fiscal_year: { result: string; result_kind: string; closing_style: string } }>(
        pg,
        `select close_fiscal_year($1)`,
        [yearId],
      ),
    );
    expect(first.close_fiscal_year.result).toBe(expectedResult.toFixed(decimals));
    expect(first.close_fiscal_year.result_kind).toBe(expectedResult > 0 ? 'profit' : 'loss');

    const closedStatements = await bothStatements();
    expect(await carriedForward()).toBe(0);

    const undone = await asUser(pg, ownerId, () =>
      one<{ reopen_fiscal_year: { reversal_entry_ids: string[] } }>(
        pg,
        `select reopen_fiscal_year($1)`,
        [yearId],
      ),
    );
    expect(undone.reopen_fiscal_year.reversal_entry_ids.length).toBeGreaterThan(0);
    const open = await one<{ is_closed: boolean }>(
      pg,
      `select is_closed from fiscal_years where id = $1`,
      [yearId],
    );
    expect(open.is_closed).toBe(false);
    expect(await carriedForward()).toBe(expectedResult);

    const second = await asUser(pg, ownerId, () =>
      one<{ close_fiscal_year: { result: string; closing_style: string } }>(
        pg,
        `select close_fiscal_year($1)`,
        [yearId],
      ),
    );
    expect(second.close_fiscal_year.result).toBe(first.close_fiscal_year.result);
    expect(second.close_fiscal_year.closing_style).toBe(first.close_fiscal_year.closing_style);

    // The books after a close, an undo and a close are the books after the
    // first close. A re-opening that leaves a trace is a re-opening that
    // changes what the year earned.
    expect(await bothStatements()).toEqual(closedStatements);
    expect(await carriedForward()).toBe(0);
  });

  it('opens the year after with the balance the closed one leaves', async () => {
    // The other half of a close, and the reason `reopen_fiscal_year` refuses a
    // year whose successor has been booked into: the opening entry of the next
    // year is the closing balance of this one, and it is written once.
    const next = await one<{ id: string; start_date: string }>(
      pg,
      `insert into fiscal_years (company_id, name, start_date, end_date)
       values ($1, 'FY-next', ($2::date + 1), ($2::date + 366))
       returning id, start_date::text`,
      [companyId, golden.fiscalYear.end],
    );

    const carried = await rows<{ code: string; balance: string }>(
      pg,
      `select a.code, (sum(l.debit) - sum(l.credit))::text as balance
         from entry_lines l
         join entries e on e.id = l.entry_id
         join accounts a on a.id = l.account_id
        where l.company_id = $1 and e.state = 'posted'
          and e.entry_date <= $2::date and a.carries_forward
        group by a.code
       having sum(l.debit) - sum(l.credit) <> 0
        order by a.code`,
      [companyId, golden.fiscalYear.end],
    );
    expect(carried.length).toBeGreaterThan(3);

    const lines = carried.map((row) => ({
      account_code: row.code,
      debit: Number(row.balance) > 0 ? Number(row.balance).toFixed(decimals) : '0',
      credit: Number(row.balance) < 0 ? (-Number(row.balance)).toFixed(decimals) : '0',
    }));

    const entry = await asUser(pg, ownerId, () =>
      one<{ opening_balance: string }>(pg, `select opening_balance($1, $2, $3::jsonb)`, [
        companyId,
        next.id,
        JSON.stringify(lines),
      ]),
    );

    const totals = await one<{ debit: string; credit: string; kind: string; date: string }>(
      pg,
      `select total_debit::text as debit, total_credit::text as credit,
              kind::text as kind, entry_date::text as date
         from entries where id = $1`,
      [entry.opening_balance],
    );
    expect(totals.debit).toBe(totals.credit);
    expect(Number(totals.debit)).toBeGreaterThan(0);
    expect(totals.kind).toBe('opening');
    expect(totals.date).toBe(next.start_date);

    // A second one is refused rather than doubled.
    const twice = await asUser(pg, ownerId, () =>
      pg
        .query(`select opening_balance($1, $2, $3::jsonb)`, [
          companyId,
          next.id,
          JSON.stringify(lines),
        ])
        .then(
          () => '',
          (error: Error) => error.message,
        ),
    );
    expect(twice).toContain('opening_entry_exists');
  });

  /**
   * The net of every account that carries forward, at the end of the year.
   *
   * Zero is the accounting identity — what is owned equals what is owed plus
   * what is held — and it only holds once the result of the year has been
   * appropriated. Before that it is the result, with the sign of the side it
   * sits on.
   */
  async function carriedForward(): Promise<number> {
    const row = await one<{ net: string }>(
      pg,
      `select coalesce(sum(l.debit) - sum(l.credit), 0)::text as net
         from entry_lines l
         join entries e on e.id = l.entry_id
         join accounts a on a.id = l.account_id
        where l.company_id = $1 and e.state = 'posted'
          and e.entry_date <= $2::date and a.carries_forward`,
      [companyId, golden.fiscalYear.end],
    );
    return Number(row.net);
  }

  /** Both schemes of the golden, rendered, so two moments can be compared. */
  async function bothStatements(): Promise<Record<string, string[]>> {
    const out: Record<string, string[]> = {};
    for (const code of golden.statements) {
      const lines = await rows<{ line_code: string; amount: string }>(
        pg,
        `select line_code, amount::text as amount
           from financial_statement($1, $2, $3::date, $4::date)`,
        [companyId, code, golden.fiscalYear.start, golden.fiscalYear.end],
      );
      out[code] = lines.map((l) => `${l.line_code} ${Number(l.amount).toFixed(decimals)}`);
    }
    return out;
  }
});
