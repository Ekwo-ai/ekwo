import type { PGlite } from '@electric-sql/pglite';
import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CBSO_26_M01F, FRAMEWORK, resolveFactKey } from '@ekwo-ai/xbrl-cbso';
import { readFrameworkPack, readPack } from '../packages/cli/src/index.js';
import { asUser, expectError, freshDatabase, one, repoRoot, rows } from './helpers/db.js';
import { demoCompanyId, newCompany, newContact, newDocument, newUser } from './helpers/factory.js';

// A financial statement is data. The schema could produce a
// trial balance and nothing an accountant files; a balance sheet was a query
// somebody would have written in the application, once per country.
//
// The test that matters is not that the lines exist. It is that they tie out:
// total assets equal total liabilities plus the result of the period, to the
// cent, against the trial balance — on the Belgian scheme, on the French
// liasse, and on the generic framework that fits any chart.

let db: PGlite;
let demo: string;

beforeAll(async () => {
  db = await freshDatabase();
  demo = await demoCompanyId(db);
}, 120_000);

afterAll(async () => {
  await db.close();
});

const n = (value: string | null | undefined): number => Number(value ?? 0);

interface Line {
  line_code: string;
  parent_code: string | null;
  name: string;
  sequence: number;
  is_total: boolean;
  amount: string;
  xbrl_element: string | null;
}

async function statement(company: string, code: string, from: string, to: string): Promise<Line[]> {
  return rows<Line>(db, 'select * from financial_statement($1, $2, $3, $4)', [company, code, from, to]);
}

async function amounts(company: string, code: string, from: string, to: string): Promise<Record<string, number>> {
  const lines = await statement(company, code, from, to);
  return Object.fromEntries(lines.map((l) => [l.line_code, n(l.amount)]));
}

/** The result of the period straight from the ledger, for the statements to match. */
async function profitFromLedger(company: string, from: string, to: string): Promise<number> {
  const row = await one<{ profit: string }>(
    db,
    `select coalesce(-sum(t.closing_balance + 0), 0)::text as profit
       from trial_balance($1, $2, $3) t
      where t.internal_group in ('income', 'expense')`,
    [company, from, to],
  );
  return n(row.profit);
}

describe('the statements the packs carry', () => {
  it('are seeded with their lines and rules, and belong to nobody', async () => {
    const list = await rows<{
      code: string;
      country: string | null;
      chart_code: string | null;
      kind: string;
      lines: number;
      rules: number;
    }>(
      db,
      `select s.code, s.country, s.chart_code, s.kind,
              (select count(*)::int from statement_line_templates l where l.statement_code = s.code) as lines,
              (select count(*)::int from statement_line_rules r where r.statement_code = s.code) as rules
         from statement_templates s order by s.code`,
    );
    expect(list).toEqual([
      { code: 'BE-BNB-ABBR-AF', country: 'BE', chart_code: 'default', kind: 'allocation', lines: 6, rules: 7 },
      { code: 'BE-BNB-ABBR-BS', country: 'BE', chart_code: 'default', kind: 'balance_sheet', lines: 31, rules: 26 },
      { code: 'BE-BNB-ABBR-IS', country: 'BE', chart_code: 'default', kind: 'income_statement', lines: 16, rules: 14 },
      { code: 'FR-2050', country: 'FR', chart_code: 'default', kind: 'balance_sheet', lines: 63, rules: 100 },
      { code: 'FR-2052', country: 'FR', chart_code: 'default', kind: 'income_statement', lines: 49, rules: 51 },
      { code: 'IFRS-SME-BS', country: null, chart_code: null, kind: 'balance_sheet', lines: 18, rules: 17 },
      { code: 'IFRS-SME-IS', country: null, chart_code: null, kind: 'income_statement', lines: 7, rules: 5 },
    ]);
  });

  it('carry no company_id, because a scheme is not customisable', async () => {
    const columns = await rows<{ table_name: string }>(
      db,
      `select table_name from information_schema.columns
        where table_schema = 'public' and column_name = 'company_id'
          and table_name in ('statement_templates', 'statement_line_templates', 'statement_line_rules')`,
    );
    expect(columns).toEqual([]);
  });

  it('name the XBRL facts of the Belgian filing where they are verified', async () => {
    // The CBSO taxonomy is dimensional: a rubric has no element name of its
    // own, it is a metric plus a set of dimension members. So the column holds
    // the fact key, and is null where nothing could be verified.
    const filled = await one<{ total: number; named: number }>(
      db,
      `select count(*)::int as total, count(xbrl_element)::int as named
         from statement_line_templates where statement_code like 'BE-BNB-ABBR-%'`,
    );
    // Every line of the Belgian schemes now names its fact. A line losing its
    // key is a regression, and so is a line gaining one nobody sourced.
    expect(filled.total).toBe(53);
    expect(filled.named).toBe(53);

    const receivables = await one<{ xbrl_element: string }>(
      db,
      `select xbrl_element from statement_line_templates
        where statement_code = 'BE-BNB-ABBR-BS' and code = '40/41'`,
    );
    expect(receivables.xbrl_element).toBe('met:am1|bas:m9|rst:m2');
  });

  it('refuse a rule on a line that is computed from other lines', async () => {
    const message = await expectError(
      db,
      `insert into statement_line_templates (statement_code, code, name, is_total, plus_lines)
       values ('BE-BNB-ABBR-BS', 'ZZ', 'Essai', false, array['20'])`,
    );
    expect(message).toMatch(/statement_line_templates_formula_is_a_total/);
  });

  it('refuse a rule whose arguments do not match its kind', async () => {
    const message = await expectError(
      db,
      `insert into statement_line_rules (statement_code, line_code, rule_kind, account_type)
       values ('BE-BNB-ABBR-BS', '20', 'code_range', 'expense')`,
    );
    expect(message).toMatch(/statement_line_rules_arguments/);
  });
});

describe('the Belgian abbreviated scheme on the demo company', () => {
  const from = '2026-01-01';
  const to = '2026-12-31';

  it('ties the balance sheet to the income statement and to the trial balance', async () => {
    const bs = await amounts(demo, 'BE-BNB-ABBR-BS', from, to);
    const is = await amounts(demo, 'BE-BNB-ABBR-IS', from, to);
    const profit = await profitFromLedger(demo, from, to);

    expect(bs['20/58']).toBeCloseTo(17774.4, 2);
    expect(bs['10/49']).toBeCloseTo(8214.4, 2);
    expect(is['9905']).toBeCloseTo(profit, 2);
    // Assets = liabilities and equity, plus the result the year has not
    // allocated yet. That is the identity the whole feature exists for.
    expect(bs['20/58']).toBeCloseTo(bs['10/49']! + is['9905']!, 2);
  });

  it('adds its subtotals up from the lines below them', async () => {
    const bs = await amounts(demo, 'BE-BNB-ABBR-BS', from, to);
    expect(bs['22/27']).toBeCloseTo(
      ['22', '23', '24', '25', '26', '27'].reduce((s, c) => s + bs[c]!, 0),
      2,
    );
    // A total that names a total: 21/28 adds 22/27, which is itself derived.
    expect(bs['21/28']).toBeCloseTo(bs['21']! + bs['22/27']! + bs['28']!, 2);
    expect(bs['29/58']).toBeCloseTo(
      ['29', '3', '40/41', '50/53', '54/58', '490/1'].reduce((s, c) => s + bs[c]!, 0),
      2,
    );
    expect(bs['20/58']).toBeCloseTo(bs['20']! + bs['21/28']! + bs['29/58']!, 2);
  });

  it('chains the result down to what the year has to allocate', async () => {
    const is = await amounts(demo, 'BE-BNB-ABBR-IS', from, to);
    expect(is['9901']).toBeCloseTo(
      is['9900']! - ['62', '630', '631/4', '635/8', '640/8', '649'].reduce((s, c) => s + is[c]!, 0),
      2,
    );
    expect(is['9903']).toBeCloseTo(is['9901']! + is['75/76B']! - is['65/66B']!, 2);
    expect(is['9904']).toBeCloseTo(is['9903']! - is['67/77']!, 2);
    expect(is['9905']).toBeCloseTo(is['9904']! + is['789']! - is['689']!, 2);
  });

  it('prints the whole frame, nil lines included, in the order the scheme has them', async () => {
    // A declaration drops a nil box; a statement is read top to bottom and
    // tied out, so it prints its frame whole.
    const lines = await statement(demo, 'BE-BNB-ABBR-BS', from, to);
    expect(lines).toHaveLength(31);
    expect(lines.filter((l) => n(l.amount) === 0).length).toBeGreaterThan(10);
    expect(lines.map((l) => l.sequence)).toEqual([...lines.map((l) => l.sequence)].sort((a, b) => a - b));
    expect(lines[0]?.line_code).toBe('20');
    expect(lines.at(-1)?.line_code).toBe('10/49');
    expect(lines.find((l) => l.line_code === '24')?.parent_code).toBe('22/27');
  });

  it('leaves no account of the company outside the scheme', async () => {
    for (const code of ['BE-BNB-ABBR-BS', 'BE-BNB-ABBR-IS']) {
      const left = await rows(db, 'select * from unmapped_accounts($1, $2, $3, $4)', [
        demo,
        code,
        from,
        to,
      ]);
      expect(left, code).toEqual([]);
    }
  });

  it('reads a balance sheet cumulatively and an income statement over the period', async () => {
    // The demo books its quarter in July to September; a balance sheet to the
    // end of the year carries it, an income statement for October alone does
    // not.
    const yearBs = await amounts(demo, 'BE-BNB-ABBR-BS', '2026-10-01', '2026-12-31');
    expect(yearBs['20/58']).toBeCloseTo(17774.4, 2);

    const quarterIs = await amounts(demo, 'BE-BNB-ABBR-IS', '2026-10-01', '2026-12-31');
    expect(quarterIs['9905']).toBeCloseTo(0, 2);
  });

  it('refuses a scheme this installation does not hold', async () => {
    const message = await expectError(
      db,
      `select * from financial_statement($1, 'BE-BNB-FULL-BS', date '2026-01-01', date '2026-12-31')`,
      [demo],
    );
    expect(message).toMatch(/unknown_statement/);
  });
});

describe('the French liasse on a French company', () => {
  const from = '2026-01-01';
  const to = '2026-12-31';
  let french: string;

  beforeAll(async () => {
    const fx = await newCompany(db, { country: 'FR', name: 'Liasse SAS' });
    french = fx.companyId;

    const customer = await newContact(db, french, { name: 'Client FR', country: 'FR' });
    const supplier = await newContact(db, french, {
      name: 'Fournisseur FR',
      type: 'supplier',
      country: 'FR',
    });

    const sale = await newDocument(db, french, {
      docType: 'sale_invoice',
      number: 'FA-2026-0001',
      contactId: customer,
      date: '2026-06-15',
      lines: [{ unitPrice: 8000, taxCode: 'FR-S-20', accountCode: '706000' }],
    });
    await db.query('select post_document($1)', [sale]);

    const purchase = await newDocument(db, french, {
      docType: 'purchase_invoice',
      number: 'ACH-2026-0001',
      contactId: supplier,
      date: '2026-06-20',
      lines: [{ unitPrice: 1500, taxCode: 'FR-P-20', accountCode: '606300' }],
    });
    await db.query('select post_document($1)', [purchase]);
  }, 60_000);

  it('ties the bilan to the compte de résultat, to the cent', async () => {
    const bs = await amounts(french, 'FR-2050', from, to);
    const is = await amounts(french, 'FR-2052', from, to);
    const profit = await profitFromLedger(french, from, to);

    expect(is['FJ']).toBeCloseTo(8000, 2);
    expect(is['FW']).toBeCloseTo(1500, 2);
    expect(is['GG']).toBeCloseTo(6500, 2);
    expect(is['HN']).toBeCloseTo(profit, 2);
    expect(is['HN']).toBeCloseTo(6500, 2);

    expect(bs['CO']).toBeCloseTo(bs['EE']! + is['HN']!, 2);
  });

  it('splits a VAT account between the two sides by what it holds', async () => {
    // Deductible VAT is a receivable and collected VAT is a debt, and both
    // live in the 445 family. `balance_side` is what puts each on its side.
    const bs = await amounts(french, 'FR-2050', from, to);
    expect(bs['BZ']).toBeCloseTo(300, 2); // 20 % of the 1 500 purchase
    expect(bs['DY']).toBeCloseTo(1600, 2); // 20 % of the 8 000 sale
    expect(bs['BX']).toBeCloseTo(9600, 2);
    expect(bs['DX']).toBeCloseTo(1800, 2);
  });

  it('leaves no account of the company outside the liasse', async () => {
    for (const code of ['FR-2050', 'FR-2052']) {
      const left = await rows(db, 'select * from unmapped_accounts($1, $2, $3, $4)', [
        french,
        code,
        from,
        to,
      ]);
      expect(left, code).toEqual([]);
    }
  });
});

describe('the generic framework, on any chart', () => {
  const from = '2026-01-01';
  const to = '2026-12-31';

  it('gives the same totals as the Belgian scheme on a Belgian company', async () => {
    const be = await amounts(demo, 'BE-BNB-ABBR-BS', from, to);
    const generic = await amounts(demo, 'IFRS-SME-BS', from, to);
    const beIs = await amounts(demo, 'BE-BNB-ABBR-IS', from, to);
    const genericIs = await amounts(demo, 'IFRS-SME-IS', from, to);

    expect(generic['A-TOT']).toBeCloseTo(be['20/58']!, 2);
    expect(genericIs['PROFIT']).toBeCloseTo(beIs['9905']!, 2);

    // The two balance sheets differ on one line, deliberately. The NBB frame
    // is filed after the year is closed, so it shows the result only once the
    // meeting has put it somewhere; the generic one derives it from the
    // movements and balances on its own, whether or not the year is closed.
    expect(generic['E-RESULT']).toBeCloseTo(beIs['9905']!, 2);
    expect(generic['EL-TOT']).toBeCloseTo(be['10/49']! + beIs['9905']!, 2);
    expect(generic['A-TOT']).toBeCloseTo(generic['EL-TOT']!, 2);
  });

  it('works on a chart that declares no statement of its own', async () => {
    // The Belgian association chart ships without the NBB association scheme,
    // and this is what makes it usable anyway: eighteen account types are a
    // balance sheet on any chart, including one with no legal codes at all.
    const company = await one<{ id: string }>(
      db,
      `insert into companies (name, country, fiscal_country, currency_code)
       values ('Statements ASBL', 'BE', 'BE', 'EUR') returning id`,
    );
    await db.query(`select install_country_template($1, 'BE', null, 'asbl')`, [company.id]);
    await db.query(
      `insert into fiscal_years (company_id, name, start_date, end_date)
       values ($1, 'Exercice 2026', date '2026-01-01', date '2026-12-31')`,
      [company.id],
    );

    const contact = await newContact(db, company.id, { name: 'Membre', country: 'BE' });
    const invoice = await newDocument(db, company.id, {
      docType: 'sale_invoice',
      number: 'COT-2026-0001',
      contactId: contact,
      date: '2026-05-05',
      lines: [{ unitPrice: 500, taxCode: 'BE-S-21', accountCode: '700000' }],
    });
    await db.query('select post_document($1)', [invoice]);

    const supplier = await newContact(db, company.id, {
      name: 'Fournisseur',
      type: 'supplier',
      country: 'BE',
    });
    const bill = await newDocument(db, company.id, {
      docType: 'purchase_invoice',
      number: 'ACH-2026-0001',
      contactId: supplier,
      date: '2026-05-10',
      lines: [{ unitPrice: 200, taxCode: 'BE-P-21', accountCode: '610000' }],
    });
    await db.query('select post_document($1)', [bill]);

    const bs = await amounts(company.id, 'IFRS-SME-BS', from, to);
    const is = await amounts(company.id, 'IFRS-SME-IS', from, to);
    expect(is['PROFIT']).toBeCloseTo(300, 2);
    expect(bs['E-RESULT']).toBeCloseTo(300, 2);
    expect(bs['A-TOT']).toBeCloseTo(bs['EL-TOT']!, 2);

    const left = await rows(db, `select * from unmapped_accounts($1, 'IFRS-SME-BS', $2, $3)`, [
      company.id,
      from,
      to,
    ]);
    expect(left).toEqual([]);

    // And the association is offered the generic framework and nothing else,
    // because its chart declares no scheme.
    const offered = await rows<{ code: string; is_default: boolean }>(
      db,
      'select code, is_default from available_statements($1)',
      [company.id],
    );
    expect(offered.map((s) => s.code)).toEqual(['IFRS-SME-BS', 'IFRS-SME-IS']);
    expect(offered.every((s) => s.is_default === false)).toBe(true);
  });

  it('marks the schemes a chart declares, and offers the generic ones beside them', async () => {
    const offered = await rows<{ code: string; country: string | null; is_default: boolean }>(
      db,
      'select code, country, is_default from available_statements($1)',
      [demo],
    );
    expect(offered.filter((s) => s.is_default).map((s) => s.code).sort()).toEqual([
      'BE-BNB-ABBR-AF',
      'BE-BNB-ABBR-BS',
      'BE-BNB-ABBR-IS',
    ]);
    expect(offered.filter((s) => s.country === null).map((s) => s.code).sort()).toEqual([
      'IFRS-SME-BS',
      'IFRS-SME-IS',
    ]);
  });
});

describe('a year that has been closed', () => {
  // `close_fiscal_year()` books the mirror image of every income and expense
  // account, on the last day of the year, marked `kind = 'closing'`. The
  // income statement has to leave that entry out or a closed year reads as a
  // result of nil; the balance sheet has to keep it, because it is what moves
  // the result onto the line the balance sheet shows it on.
  const from = '2026-01-01';
  const to = '2026-12-31';
  let company: string;
  let owner: string;
  let before: Record<string, number>;

  beforeAll(async () => {
    const fx = await newCompany(db, { country: 'BE', name: 'Clôturée SRL' });
    company = fx.companyId;
    owner = fx.ownerId;

    const customer = await newContact(db, company, { name: 'Client', country: 'BE' });
    const invoice = await newDocument(db, company, {
      docType: 'sale_invoice',
      number: 'FA-2026-0001',
      contactId: customer,
      date: '2026-04-05',
      lines: [{ unitPrice: 4000, taxCode: 'BE-S-21', accountCode: '700000' }],
    });
    await db.query('select post_document($1)', [invoice]);

    const supplier = await newContact(db, company, {
      name: 'Fournisseur',
      type: 'supplier',
      country: 'BE',
    });
    const bill = await newDocument(db, company, {
      docType: 'purchase_invoice',
      number: 'ACH-2026-0001',
      contactId: supplier,
      date: '2026-04-10',
      lines: [{ unitPrice: 1000, taxCode: 'BE-P-21', accountCode: '610000' }],
    });
    await db.query('select post_document($1)', [bill]);

    before = await amounts(company, 'BE-BNB-ABBR-IS', from, to);

    const year = await one<{ id: string }>(
      db,
      `select id from fiscal_years where company_id = $1 and start_date = date '2026-01-01'`,
      [company],
    );
    await asUser(db, owner, () => db.query('select close_fiscal_year($1)', [year.id]));
  }, 60_000);

  it('still reports the result the year earned, not the nil the ledger now shows', async () => {
    expect(before['9905']).toBeCloseTo(3000, 2);

    const after = await amounts(company, 'BE-BNB-ABBR-IS', from, to);
    expect(after['9905']).toBeCloseTo(3000, 2);
    expect(after['9900']).toBeCloseTo(before['9900']!, 2);

    // And the ledger really is back to nil, which is what the exclusion is for.
    const ledger = await one<{ balance: string }>(
      db,
      `select coalesce(sum(t.closing_balance), 0)::text as balance
         from trial_balance($1, $2, $3) t
        where t.internal_group in ('income', 'expense')`,
      [company, from, to],
    );
    expect(Number(ledger.balance)).toBeCloseTo(0, 2);
  });

  it('shows the result where the close put it, on the balance sheet', async () => {
    // Belgium appropriates through 693, which the closing entry then zeroes,
    // so the result lands on 140 — rubric 14 of the scheme.
    const bs = await amounts(company, 'BE-BNB-ABBR-BS', from, to);
    expect(bs['14']).toBeCloseTo(3000, 2);
    expect(bs['20/58']).toBeCloseTo(bs['10/49']!, 2);
  });

  it('shows the appropriation on the section that exists to show it', async () => {
    // Two entries, two names. The appropriation moves the result into 693 and
    // on to 140; the closing entry then takes 693 back to zero with every
    // other income and expense account. Under one name they cancelled out and
    // this section read nil.
    const af = await amounts(company, 'BE-BNB-ABBR-AF', from, to);
    expect(af['14']).toBeCloseTo(3000, 2);

    const kinds = await rows<{ kind: string; n: number }>(
      db,
      `select e.kind::text as kind, count(*)::int as n
         from entries e where e.company_id = $1 and e.kind <> 'normal'
        group by 1 order by 1`,
      [company],
    );
    expect(kinds).toEqual([
      { kind: 'appropriation', n: 1 },
      { kind: 'closing', n: 1 },
    ]);

    // And the income statement is untouched by it.
    const is = await amounts(company, 'BE-BNB-ABBR-IS', from, to);
    expect(is['9905']).toBeCloseTo(3000, 2);
  });

  it('leaves the generic balance sheet balancing, closed or not', async () => {
    const bs = await amounts(company, 'IFRS-SME-BS', from, to);
    // Derived from the movements, so it is nil once the close has moved them.
    expect(bs['E-RESULT']).toBeCloseTo(0, 2);
    expect(bs['E-RET']).toBeCloseTo(3000, 2);
    expect(bs['A-TOT']).toBeCloseTo(bs['EL-TOT']!, 2);
  });
});

describe('an account the pack never heard of', () => {
  it('is named rather than silently dropped from the statement', async () => {
    const { companyId } = await newCompany(db, { country: 'BE', name: 'Hors plan SRL' });
    await db.query(
      `insert into accounts (company_id, code, name, account_type)
       values ($1, 'X1', 'Compte inventé', 'expense')`,
      [companyId],
    );
    const entry = await one<{ id: string }>(
      db,
      `insert into entries (company_id, journal_id, entry_date, description, state)
       select $1, id, date '2026-03-01', 'Hors plan', 'draft' from journals
        where company_id = $1 and code = 'MISC' returning id`,
      [companyId],
    );
    await db.query(
      `insert into entry_lines (entry_id, company_id, account_id, sequence, debit, credit)
       values ($1, $2, account_id_by_code($2, 'X1'), 10, 750, 0),
              ($1, $2, account_id_by_code($2, '550000'), 20, 0, 750)`,
      [entry.id, companyId],
    );
    await db.query('select post_entry($1)', [entry.id]);

    const left = await rows<{ account_code: string; balance: string }>(
      db,
      `select account_code, balance::text from unmapped_accounts($1, 'BE-BNB-ABBR-IS', $2, $3)`,
      [companyId, '2026-01-01', '2026-12-31'],
    );
    expect(left).toEqual([{ account_code: 'X1', balance: '750.00' }]);

    // And the balance sheet does not report it: a revenue account is not
    // missing from a balance sheet, and neither is an expense one.
    const onBalance = await rows(
      db,
      `select * from unmapped_accounts($1, 'BE-BNB-ABBR-BS', $2, $3)`,
      [companyId, '2026-01-01', '2026-12-31'],
    );
    expect(onBalance).toEqual([]);
  });
});

/**
 * A currency with two decimals and a country that rounds half up, written out
 * as the pair `evaluate_totals` now takes. The evaluator looks nothing up —
 * it is immutable and is called from a view — so the rounding reaches it as an
 * argument, and a test that exercises it says which one it means.
 */
const EUR_ROUNDING = "row(2, 'half_up')::money_rounding";

describe('one evaluator, called by both reports', () => {
  // The rule this repository is built against: one path per calculation. A
  // declaration form and a financial statement derive their totals the same
  // way, so they derive them in the same function, and the two differences
  // between them are arguments.
  it('is the function both report functions call, by name', async () => {
    const callers = await rows<{ proname: string }>(
      db,
      `select p.proname
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.prosrc like '%evaluate_totals(%'
        order by 1`,
    );
    expect(callers.map((c) => c.proname)).toEqual(['financial_statement', 'vat_return']);
  });

  it('leaves neither of them working a formula out on its own', async () => {
    // What a second evaluator looks like: a loop over a plus list inside the
    // caller. Neither report function has one any more.
    const own = await rows<{ proname: string }>(
      db,
      `select p.proname
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('vat_return', 'financial_statement')
          and (p.prosrc like '%foreach%plus_boxes%' or p.prosrc like '%foreach%plus_lines%')`,
    );
    expect(own).toEqual([]);
  });

  it('keeps a nil total for the totals after it, and prints it only when asked', async () => {
    // `p_keep_zero` is the whole difference between a return and a statement:
    // a nil box is left out of a declaration and printed on a scheme, and
    // either way the total that names it reads a zero and not a gap.
    const values = { 'A|total': 0, B: 5 };
    const formulas = [
      { key: 'T1|total', plus: ['A'], sequence: 10 },
      { key: 'T2|total', plus: ['T1', 'B'], sequence: 20 },
    ];
    const dropped = await one<{ result: Record<string, number> }>(
      db,
      `select evaluate_totals($1, $2, ${EUR_ROUNDING}, false) as result`,
      [JSON.stringify(values), JSON.stringify(formulas)],
    );
    expect(dropped.result).toEqual({ 'T2|total': 5 });

    const kept = await one<{ result: Record<string, number> }>(
      db,
      `select evaluate_totals($1, $2, ${EUR_ROUNDING}, true) as result`,
      [JSON.stringify(values), JSON.stringify(formulas)],
    );
    expect(kept.result).toEqual({ 'T1|total': 0, 'T2|total': 5 });
  });

  it('takes a qualified reference and a bare one, which is what a CA3 needs', async () => {
    const result = await one<{ result: Record<string, number> }>(
      db,
      `select evaluate_totals($1, $2, ${EUR_ROUNDING}, true) as result`,
      [
        JSON.stringify({ '08|base': 1000, '08|tax': 200 }),
        JSON.stringify([
          { key: 'BASE|total', plus: ['08:base'], sequence: 10 },
          { key: 'BOTH|total', plus: ['08'], sequence: 20 },
        ]),
      ],
    );
    expect(result.result).toEqual({ 'BASE|total': 1000, 'BOTH|total': 1200 });
  });

  it('floors before it signs, so a pair that splits a balance still splits it', async () => {
    const result = await one<{ result: Record<string, number> }>(
      db,
      `select evaluate_totals($1, $2, ${EUR_ROUNDING}, true) as result`,
      [
        JSON.stringify({ due: 100, deductible: 250 }),
        JSON.stringify([
          { key: '71', plus: ['due'], minus: ['deductible'], floor_zero: true, sequence: 10 },
          { key: '72', plus: ['deductible'], minus: ['due'], floor_zero: true, sequence: 20 },
          { key: 'signed', plus: ['due'], minus: ['deductible'], factor: -1, sequence: 30 },
        ]),
      ],
    );
    expect(result.result).toEqual({ '71': 0, '72': 150, signed: 150 });
  });

  it('refuses two totals that depend only on each other', async () => {
    const message = await expectError(
      db,
      `select evaluate_totals('{}'::jsonb, $1::jsonb, ${EUR_ROUNDING}, true)`,
      [
        JSON.stringify([
          { key: 'X', plus: ['Y'], sequence: 10 },
          { key: 'Y', plus: ['X'], sequence: 20 },
        ]),
      ],
    );
    expect(message).toMatch(/formula_cycle: these totals depend on each other and on nothing else: X, Y/);
  });

  it('is closed to the anonymous role and to PUBLIC', async () => {
    const open = await rows(
      db,
      `select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'evaluate_totals'
          and (p.proacl is null
               or has_function_privilege('anon', p.oid, 'EXECUTE'))`,
    );
    expect(open).toEqual([]);
  });
});

describe('the statement tables under row level security', () => {
  it('let a signed-in user read them, and nobody write them', async () => {
    const { ownerId } = await newCompany(db, { country: 'BE', name: 'Lectrice d’états SRL' });

    await asUser(db, ownerId, async () => {
      const seen = await one<{ n: number }>(
        db,
        'select count(*)::int as n from statement_line_templates',
      );
      expect(seen.n).toBeGreaterThan(150);

      for (const sql of [
        `insert into statement_templates (code, name, kind) values ('MINE', 'À moi', 'balance_sheet')`,
        `insert into statement_line_templates (statement_code, code, name)
         values ('BE-BNB-ABBR-BS', 'ZZ', 'À moi')`,
        `insert into statement_line_rules (statement_code, line_code, rule_kind, code_from)
         values ('BE-BNB-ABBR-BS', '20', 'code_prefix', '9')`,
      ]) {
        const message = await expectError(db, sql);
        expect(message, sql).toMatch(/row-level security|permission denied/);
      }

      for (const sql of [
        `update statement_line_templates set name = 'Changé' where code = '40/41'`,
        `delete from statement_line_rules where line_code = '40/41'`,
      ]) {
        const result = await db.query(sql);
        expect(result.affectedRows ?? 0, sql).toBe(0);
      }
    });

    const intact = await one<{ name: string }>(
      db,
      `select name from statement_line_templates
        where statement_code = 'BE-BNB-ABBR-BS' and code = '40/41'`,
    );
    expect(intact.name).toBe('Créances à un an au plus');
  });

  it('is invisible to a request that carries no user', async () => {
    await db.exec(`select set_config('request.jwt.claims', '', false); set role anon;`);
    try {
      expect(await rows(db, 'select code from statement_templates')).toEqual([]);
      expect(await rows(db, 'select code from statement_line_templates')).toEqual([]);
      expect(await rows(db, 'select line_code from statement_line_rules')).toEqual([]);
    } finally {
      await db.exec('reset role;');
    }
  });

  it('cannot be read by a signed-in stranger through a function either', async () => {
    const strangerId = await newUser(db);
    const message = await asUser(db, strangerId, () =>
      expectError(
        db,
        `select * from financial_statement($1, 'BE-BNB-ABBR-BS', date '2026-01-01', date '2026-12-31')`,
        [demo],
      ),
    );
    // The company is invisible to them, so the function refuses before it
    // reads a single line of the scheme.
    expect(message).toMatch(/unknown_company/);
  });
});

describe('replaying the seeds', () => {
  it('leaves the statement tables exactly as it found them', async () => {
    const snapshot = async (): Promise<Record<string, unknown>> => {
      const out: Record<string, unknown> = {};
      for (const table of ['statement_templates', 'statement_line_templates', 'statement_line_rules', 'chart_templates']) {
        out[table] = await rows(db, `select * from ${table} order by 1, 2, 3`);
      }
      return out;
    };
    const before = await snapshot();
    for (const file of ['05_framework_generic.sql', '10_pack_be.sql', '11_pack_fr.sql']) {
      await db.exec(await readFile(join(repoRoot, 'supabase', 'seed', file), 'utf8'));
    }
    expect(await snapshot()).toEqual(before);
  });
});

describe('what `ekwo pack check` refuses in a statement', () => {
  const packs = join(repoRoot, 'packs');

  /** `packs/be` in a temporary directory, with its statements edited. */
  async function packWith(edit: (statements: Record<string, unknown>) => void): Promise<void> {
    const dir = await mkdtemp(join(tmpdir(), 'ekwo-stmt-'));
    await cp(join(packs, 'schema'), join(dir, 'schema'), { recursive: true });
    await cp(join(packs, 'be'), join(dir, 'be'), { recursive: true });
    const statements = JSON.parse(
      await readFile(join(packs, 'be', 'statements.json'), 'utf8'),
    ) as Record<string, unknown>;
    edit(statements);
    await writeFile(join(dir, 'be', 'statements.json'), JSON.stringify(statements), 'utf8');
    await readPack('be', dir);
  }

  type Statement = { code: string; lines: Record<string, unknown>[] };
  const balanceSheet = (s: Record<string, unknown>): Statement =>
    (s['statements'] as Statement[]).find((st) => st.code === 'BE-BNB-ABBR-BS')!;

  it('accepts the packs of this repository as they are', async () => {
    for (const slug of ['be', 'fr']) {
      const pack = await readPack(slug, packs);
      expect(pack.statements.length, slug).toBeGreaterThan(1);
    }
    const framework = await readFrameworkPack();
    expect(framework.statements).toHaveLength(2);
  });

  it('refuses a total naming a line the statement does not carry', async () => {
    await expect(
      packWith((s) => {
        balanceSheet(s).lines.find((l) => l['code'] === '20/58')!['plus'] = ['20', 'ZZ'];
      }),
    ).rejects.toThrow(/ZZ is not a line of this statement/);
  });

  it('refuses a total naming itself', async () => {
    await expect(
      packWith((s) => {
        balanceSheet(s).lines.find((l) => l['code'] === '20/58')!['plus'] = ['20', '20/58'];
      }),
    ).rejects.toThrow(/20\/58 is the line itself/);
  });

  it('refuses two totals that depend on each other', async () => {
    await expect(
      packWith((s) => {
        const lines = balanceSheet(s).lines;
        lines.find((l) => l['code'] === '21/28')!['plus'] = ['20/58'];
      }),
    ).rejects.toThrow(/depend on each other and on nothing else/);
  });

  it('refuses a line that is both summed and computed', async () => {
    await expect(
      packWith((s) => {
        balanceSheet(s).lines.find((l) => l['code'] === '21/28')!['rules'] = [
          { kind: 'code_range', code_from: '21', code_to: '28' },
        ];
      }),
    ).rejects.toThrow(/a total is computed from other lines; it takes no rule of its own/);
  });

  it('refuses two lines that catch the same account on the same side', async () => {
    await expect(
      packWith((s) => {
        balanceSheet(s).lines.find((l) => l['code'] === '29')!['rules'] = [
          { kind: 'code_range', code_from: '28', code_to: '29' },
        ];
      }),
    ).rejects.toThrow(/reaches 2 lines \(28, 29\)/);
  });

  it('refuses a chart with an account no statement of it catches', async () => {
    // This is the check that makes a balance sheet tie out. Drop the line the
    // cash accounts fall on and the company chart has nowhere to put 550000.
    await expect(
      packWith((s) => {
        const statement = balanceSheet(s);
        statement.lines = statement.lines.filter((l) => l['code'] !== '54/58');
        statement.lines.find((l) => l['code'] === '29/58')!['plus'] = ['29', '3', '40/41', '50/53', '490/1'];
      }),
    ).rejects.toThrow(/reaches no line of any statement of this chart/);
  });

  it('gives every fact key to one line, so it names one fact', async () => {
    // A key that fits two lines is a key missing a member. The two sides of the
    // Belgian balance sheet share every member but `part:`, so `met:am1|bas:m25`
    // alone was both totals at once and `met:am1|bas:m24` both regularisation
    // lines. Sources for the members: Ekwo-ai/xbrl-cbso, docs/sources.md.
    for (const slug of ['be', 'fr']) {
      const pack = await readPack(slug, packs);
      for (const statement of pack.statements) {
        const byKey = new Map<string, string>();
        for (const line of statement.lines) {
          if (line.xbrl === null) continue;
          expect(byKey.get(line.xbrl), `${statement.code} ${line.xbrl}`).toBeUndefined();
          byKey.set(line.xbrl, line.code);
        }
      }
    }
    const be = await readPack('be', packs);
    const bs = be.statements.find((st) => st.code === 'BE-BNB-ABBR-BS')!;
    const keyOf = (code: string): string | null => bs.lines.find((l) => l.code === code)!.xbrl;
    expect(keyOf('20/58')).toBe('met:am1|bas:m25|part:m1');
    expect(keyOf('10/49')).toBe('met:am1|bas:m25|part:m3');
    expect(keyOf('490/1')).toBe('met:am1|bas:m24|part:m1');
    expect(keyOf('492/3')).toBe('met:am1|bas:m24|part:m3');

    // 22/27 is the tangible nature of the fixed-assets base, 24 a base of its
    // own, 26 the remainder of the base — three lines nobody can tell apart
    // from the reporting code alone.
    expect(keyOf('22/27')).toBe('met:am1|bas:m2|ntr:m2');
    expect(keyOf('24')).toBe('met:am1|bas:m5|ntr:m2');
    expect(keyOf('26')).toBe('met:am1|bas:m2|ntr:m2|typ:m1');

    // The result carried forward is one fact, shown on the balance sheet and
    // again at the foot of the appropriation section. One fact, one key.
    const af = be.statements.find((st) => st.code === 'BE-BNB-ABBR-AF')!;
    expect(af.lines.find((l) => l.code === '14')!.xbrl).toBe(keyOf('14'));
  });

  it('names the fact of every Belgian line, in all three schemes', async () => {
    const be = await readPack('be', packs);
    const schemes = be.statements.filter((st) => st.code.startsWith('BE-BNB-ABBR-'));
    expect(schemes).toHaveLength(3);
    const unnamed = schemes.flatMap((st) =>
      st.lines.filter((l) => l.xbrl === null).map((l) => `${st.code} ${l.code}`),
    );
    expect(unnamed).toEqual([]);
  });

  it('resolves every one of them against the taxonomy, onto the line that carries it', async () => {
    // The pack used to state its keys and a test used to count them, which
    // proved that somebody had typed fifty-three things. What has to be true
    // is stronger and nobody can type it: each key names exactly one fact of
    // the published NBB taxonomy, and in the Belgian schemes the line that
    // fact belongs to is the line the pack wrote it on — a Belgian reporting
    // code *is* the rubric code of the model.
    //
    // The table comes from `@ekwo-ai/xbrl-cbso`, generated from the taxonomy
    // package the National Bank publishes. This is the only place the pack and
    // the format library meet, and it is a test rather than a runtime
    // dependency: the core files nothing.
    const be = await readPack('be', packs);
    const schemes = be.statements.filter((st) => st.code.startsWith('BE-BNB-ABBR-'));

    const wrong: string[] = [];
    let resolved = 0;
    for (const statement of schemes) {
      // The keys of a statement are written against one version of one
      // taxonomy, and this is the version the brick carries.
      expect(statement.taxonomy, statement.code).toBe(`nbb-cbso:${FRAMEWORK}`);
      for (const line of statement.lines) {
        if (line.xbrl === null) continue;
        resolved += 1;
        try {
          // `resolveFactKey` throws when a key names no fact of the model, and
          // when it names more than one — uniqueness is the resolver's rule,
          // not a second check here.
          const code = resolveFactKey(line.xbrl, CBSO_26_M01F);
          if (code !== line.code) {
            wrong.push(`${statement.code} ${line.code}: ${line.xbrl} resolves to ${code}`);
          }
        } catch (error) {
          wrong.push(`${statement.code} ${line.code}: ${(error as Error).message}`);
        }
      }
    }

    expect(wrong).toEqual([]);
    // Nothing was skipped: every line of the three schemes was resolved.
    expect(resolved).toBe(schemes.reduce((n, st) => n + st.lines.length, 0));
  });

  it('refuses two lines of one statement carrying the same fact key', async () => {
    await expect(
      packWith((s) => {
        balanceSheet(s).lines.find((l) => l['code'] === '10/49')!['xbrl'] = 'met:am1|bas:m25|part:m1';
      }),
    ).rejects.toThrow(/already names line 20\/58/);
  });

  it('refuses a fact key that is not a metric followed by domain members', async () => {
    const malformed: Array<[string, RegExp]> = [
      ['met:am1', /a metric and at least one domain member/],
      ['met:am1|bas', /is not a qualified name/],
      ['met:am1| bas:m25', /nothing empty or padded/],
      ['met:am1|bas:m25|bas:m24', /two parts in the domain "bas"/],
      ['met:am1|met:am2|bas:m25', /two parts in the domain "met"/],
    ];
    for (const [key, message] of malformed) {
      await expect(
        packWith((s) => {
          balanceSheet(s).lines.find((l) => l['code'] === '20/58')!['xbrl'] = key;
        }),
        key,
      ).rejects.toThrow(message);
    }
  });

  it('allows two lines to share an account when one takes it in debit and one in credit', async () => {
    // The suspense account is a receivable while it is in debit and a payable
    // while it is in credit, and the Belgian pack says exactly that.
    const pack = await readPack('be', packs);
    const bs = pack.statements.find((s) => s.code === 'BE-BNB-ABBR-BS')!;
    const sides = bs.lines
      .filter((l) => l.rules.some((r) => r.code_from === '499'))
      .map((l) => [l.code, l.rules.find((r) => r.code_from === '499')!.side]);
    expect(sides).toEqual([
      ['40/41', 'debit'],
      ['42/48', 'credit'],
    ]);
  });
});
