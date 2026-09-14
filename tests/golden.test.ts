import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  listPacks,
  packsDir,
  readPack,
  type Pack,
  type PackGolden,
  type PackTax,
} from '../packages/cli/src/index.js';
import { freshDatabase, one, rows } from './helpers/db.js';
import { newCompany } from './helpers/factory.js';
import { replayScenario } from './helpers/golden-scenario.js';

/**
 * The golden test of every country pack, replayed by one runner.
 *
 * A pack is data, and data that compiles says nothing about whether it adds
 * up. A declaration box that sums the wrong postings and a tax that posts to
 * the wrong box agree with each other: the seed builds, every unit test
 * passes, and the return is wrong. What catches that is a year of books whose
 * result somebody wrote down — `packs/<cc>/golden/`, a scenario and, beside
 * it, the declaration, the statements and the trial balance it produces, to
 * the cent.
 *
 * Nothing here knows a country. The runner reads `packs/`, installs a company
 * on each pack from what its own scenario declares, replays the documents and
 * the payments through the real functions — `post_document`, `post_payment`,
 * `reconcile` — and compares `vat_return`, `financial_statement` and
 * `trial_balance` against the files. A pack with no scenario and no declared
 * exemption never reaches this file: `readPack` refuses it, so `ekwo pack
 * check` and the CI refuse it too.
 *
 * What it proves is internal coherence and not legal truth, which no test can
 * reach. That is what the legal source on every tax and every box is for, and
 * what `certification.status` says out loud.
 *
 * To rewrite the expectations after a deliberate change:
 *
 *     UPDATE_GOLDEN=1 npm test -- tests/golden.test.ts
 *
 * It rewrites the three expectation files and never the scenario: a runner
 * that could rewrite its own inputs proves nothing. The diff is then the
 * thing to review.
 */

const UPDATE = process.env['UPDATE_GOLDEN'] === '1';

interface VatExpectation {
  periods: { code: string; from: string; to: string; boxes: Record<string, string> }[];
}
interface StatementExpectation {
  statements: { code: string; from: string; to: string; lines: Record<string, string> }[];
}
interface BalanceExpectation {
  from: string;
  to: string;
  accounts: Record<string, { debit: string; credit: string; closing: string }>;
}

/**
 * An amount as the pack's currency writes it.
 *
 * The engine already rounds at `currencies.decimal_places`, so this only
 * settles how many digits reach the file. A digit beyond them would mean the
 * rounding did not happen, and is raised by name rather than trimmed away —
 * a golden that quietly truncates is a golden that hides the bug it exists
 * to find.
 */
function fixed(raw: string | null, decimals: number, what: string): string {
  const value = raw ?? '0';
  const negative = value.startsWith('-');
  const body = negative ? value.slice(1) : value;
  const [whole = '0', fraction = ''] = body.split('.');
  if (fraction.slice(decimals).replace(/0+$/, '') !== '') {
    throw new Error(`${what}: ${value} carries more decimals than this currency has (${decimals})`);
  }
  const padded = (fraction + '0'.repeat(decimals)).slice(0, decimals);
  const shown = decimals === 0 ? whole : `${whole}.${padded}`;
  return negative && Number(body) !== 0 ? `-${shown}` : shown;
}

/** Reads an expectation file, or the empty shape when it is being written. */
async function expectation<T>(dir: string, file: string, blank: T): Promise<T> {
  const path = join(dir, file);
  if (!existsSync(path)) {
    if (!UPDATE) {
      throw new Error(
        `${path} does not exist. Run UPDATE_GOLDEN=1 npm test -- tests/golden.test.ts and review the diff.`,
      );
    }
    return blank;
  }
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

async function save(dir: string, file: string, value: unknown): Promise<void> {
  if (!UPDATE) return;
  await writeFile(join(dir, file), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

/** Taxes of a pack that are in force on a date, by code. */
function inForce(taxes: PackTax[], on: string): Map<string, PackTax> {
  return new Map(
    taxes.filter((t) => t.valid_from <= on && (t.valid_to === null || t.valid_to >= on)).map((t) => [t.code, t]),
  );
}

const slugs = await listPacks();

for (const slug of slugs) {
  const pack = await readPack(slug);
  // A pack that declares why it has no scenario is not run. `readPack` has
  // already refused one that declares neither.
  if (pack.golden === null) {
    describe(`${slug} — no golden scenario`, () => {
      it('says why, in the manifest, rather than being quietly absent', () => {
        expect(pack.goldenExemption).not.toBeNull();
      });
    });
    continue;
  }

  runGolden(pack, pack.golden);
}

function runGolden(pack: Pack, golden: PackGolden): void {
  const dir = join(packsDir(), pack.slug, 'golden');
  const country = pack.manifest.country;

  describe(`${pack.slug} — ${golden.name}`, () => {
    let db: PGlite;
    let companyId: string;
    let decimals: number;

    beforeAll(async () => {
      db = await freshDatabase();
      const fixture = await newCompany(db, {
        country,
        name: golden.name,
        chart: golden.chart,
        language: golden.language,
        fiscalYear: golden.fiscalYear,
      });
      companyId = fixture.companyId;

      const currency = await one<{ decimal_places: number }>(
        db,
        `select c.decimal_places
           from companies co join currencies c on c.code = co.currency_code
          where co.id = $1`,
        [companyId],
      );
      decimals = Number(currency.decimal_places);

      await replayScenario(db, companyId, golden);
    }, 300_000);

    afterAll(async () => {
      await db.close();
    });

    // -----------------------------------------------------------------
    // What the scenario has to exercise, asked of the pack and not of a
    // country. A pack with a tax due on collection must have a document that
    // uses one; a pack without such a tax is not asked for one.
    // -----------------------------------------------------------------

    it('exercises both directions, more than one rate, and a credit note', () => {
      const used = golden.documents.flatMap((d) => d.lines.map((l) => l.tax)).filter((c) => c !== null);
      const taxes = inForce(pack.taxes, golden.fiscalYear.start);
      const rates = new Set(used.map((code) => taxes.get(code as string)?.rate).filter((r) => (r ?? 0) > 0));

      expect(golden.documents.filter((d) => d.type.startsWith('sale')).length).toBeGreaterThan(0);
      expect(golden.documents.filter((d) => d.type.startsWith('purchase')).length).toBeGreaterThan(0);
      expect(golden.documents.filter((d) => d.type.endsWith('credit_note')).length).toBeGreaterThan(0);
      // A standard rate and at least one reduced one: a return whose rate
      // boxes are all the same box proves nothing about the others.
      expect(rates.size).toBeGreaterThan(1);
    });

    it('exercises an intra-Union reverse charge, in both directions where the pack has both', () => {
      const used = new Set(golden.documents.flatMap((d) => d.lines.map((l) => l.tax)));
      const taxes = inForce(pack.taxes, golden.fiscalYear.start);
      const treatments = new Set(
        [...used].filter((c) => c !== null).map((c) => taxes.get(c as string)?.treatment),
      );
      const supply = ['intracom_goods', 'intracom_services'];
      const acquisition = ['intracom_acquisition_goods', 'intracom_acquisition_services'];

      for (const side of [supply, acquisition]) {
        const offered = pack.taxes.some((t) => side.includes(t.treatment));
        if (!offered) continue;
        expect(side.some((t) => treatments.has(t))).toBe(true);
      }
    });

    it('exercises a tax due on collection and a partly recoverable one, where the pack has them', () => {
      const used = new Set(
        golden.documents.flatMap((d) => d.lines.map((l) => l.tax)).filter((c) => c !== null),
      );
      const taxes = inForce(pack.taxes, golden.fiscalYear.start);
      const chosen = [...used].map((code) => taxes.get(code as string)).filter((t) => t !== undefined);

      if (pack.taxes.some((t) => t.cash_basis)) {
        expect(chosen.some((t) => t.cash_basis)).toBe(true);
      }
      // Partly recoverable is a `tax_on_base` posting: the share of the tax
      // that is not deductible and lands on the accounts of the lines.
      const partial = (tax: PackTax): boolean =>
        Object.values(tax.postings).some((postings) => postings.some((p) => p.type === 'tax_on_base'));
      if (pack.taxes.some(partial)) {
        expect(chosen.some(partial)).toBe(true);
      }
    });

    it('carries a payment that is matched and a payment that is not', () => {
      expect(golden.payments.some((p) => p.match !== null)).toBe(true);
      expect(golden.payments.some((p) => p.match === null)).toBe(true);
    });

    it('leaves the unmatched payment open and closes the matched one', async () => {
      const open = await rows<{ state: string }>(
        db,
        `select payment_state as state from documents where company_id = $1 and payment_state = 'paid'`,
        [companyId],
      );
      expect(open.length).toBeGreaterThan(0);

      const unmatched = await one<{ count: number }>(
        db,
        `select count(*)::int as count
           from entry_lines l
           join payments p on p.entry_id = l.entry_id
           join accounts a on a.id = l.account_id
          where p.company_id = $1 and a.reconcilable
            and not exists (
              select 1 from reconciliations r
               where r.debit_line_id = l.id or r.credit_line_id = l.id
            )`,
        [companyId],
      );
      expect(Number(unmatched.count)).toBeGreaterThan(0);
    });

    // -----------------------------------------------------------------
    // The three comparisons.
    // -----------------------------------------------------------------

    it('files the declaration the golden records, period by period', async () => {
      const actual: VatExpectation = { periods: [] };
      for (const period of golden.periods) {
        const boxes = await rows<{ box: string; kind: string; amount: string }>(
          db,
          `select box, kind, amount::text from vat_return($1, $2::date, $3::date) order by sequence, kind`,
          [companyId, period.from, period.to],
        );
        actual.periods.push({
          code: period.code,
          from: period.from,
          to: period.to,
          boxes: Object.fromEntries(
            boxes.map((b) => [`${b.box}:${b.kind}`, fixed(b.amount, decimals, `box ${b.box} (${b.kind})`)]),
          ),
        });
      }
      await save(dir, 'vat_return.json', actual);
      const golden_ = await expectation<VatExpectation>(dir, 'vat_return.json', actual);

      // Period by period, so a difference names the quarter before it names
      // the box — a tax due on collection moves an amount from one to another
      // without changing the year, and a single comparison would show two
      // differences where there is one cause.
      for (const [index, period] of golden_.periods.entries()) {
        expect(actual.periods[index]?.code).toBe(period.code);
        expect({ period: period.code, boxes: actual.periods[index]?.boxes }).toEqual({
          period: period.code,
          boxes: period.boxes,
        });
      }
      expect(actual.periods).toHaveLength(golden_.periods.length);
    });

    it('draws the financial statements the golden records, line by line', async () => {
      const codes =
        golden.statements.length > 0
          ? golden.statements
          : (
              await rows<{ code: string }>(
                db,
                `select code from available_statements($1) order by code`,
                [companyId],
              )
            ).map((r) => r.code);

      const actual: StatementExpectation = { statements: [] };
      for (const code of codes) {
        const lines = await rows<{ line_code: string; amount: string }>(
          db,
          `select line_code, amount::text from financial_statement($1, $2, $3::date, $4::date)
            order by sequence, line_code`,
          [companyId, code, golden.fiscalYear.start, golden.fiscalYear.end],
        );
        actual.statements.push({
          code,
          from: golden.fiscalYear.start,
          to: golden.fiscalYear.end,
          lines: Object.fromEntries(
            lines.map((l) => [l.line_code, fixed(l.amount, decimals, `${code} line ${l.line_code}`)]),
          ),
        });
      }
      await save(dir, 'statements.json', actual);
      const golden_ = await expectation<StatementExpectation>(dir, 'statements.json', actual);

      for (const [index, statement] of golden_.statements.entries()) {
        expect(actual.statements[index]?.code).toBe(statement.code);
        expect({ statement: statement.code, lines: actual.statements[index]?.lines }).toEqual({
          statement: statement.code,
          lines: statement.lines,
        });
      }
      expect(actual.statements).toHaveLength(golden_.statements.length);
    });

    it('holds the trial balance the golden records, account by account', async () => {
      const balance = await rows<{
        account_code: string;
        debit: string;
        credit: string;
        closing_balance: string;
      }>(
        db,
        `select account_code, debit::text, credit::text, closing_balance::text
           from trial_balance($1, $2::date, $3::date)
          where debit <> 0 or credit <> 0 or closing_balance <> 0
          order by account_code`,
        [companyId, golden.fiscalYear.start, golden.fiscalYear.end],
      );

      const actual: BalanceExpectation = {
        from: golden.fiscalYear.start,
        to: golden.fiscalYear.end,
        accounts: Object.fromEntries(
          balance.map((row) => [
            row.account_code,
            {
              debit: fixed(row.debit, decimals, `account ${row.account_code} debit`),
              credit: fixed(row.credit, decimals, `account ${row.account_code} credit`),
              closing: fixed(row.closing_balance, decimals, `account ${row.account_code} balance`),
            },
          ]),
        ),
      };
      await save(dir, 'trial_balance.json', actual);
      const golden_ = await expectation<BalanceExpectation>(dir, 'trial_balance.json', actual);
      expect(actual).toEqual(golden_);
    });

    it('balances: the ledger of the golden is a ledger, whatever the figures are', async () => {
      // The one assertion that is not read from a file. A golden regenerated
      // from a broken engine would agree with itself; double entry would not.
      const total = await one<{ debit: string; credit: string }>(
        db,
        `select coalesce(sum(l.debit), 0)::text as debit, coalesce(sum(l.credit), 0)::text as credit
           from entry_lines l join entries e on e.id = l.entry_id
          where e.company_id = $1 and e.state = 'posted'`,
        [companyId],
      );
      expect(total.debit).toBe(total.credit);
      expect(Number(total.debit)).toBeGreaterThan(0);
    });
  });
}
