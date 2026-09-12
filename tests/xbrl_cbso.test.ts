import type { PGlite } from '@electric-sql/pglite';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CBSO_26_M01F,
  EnterpriseCourt,
  LegalForm,
  checkBnbEquations,
  generateCbsoXbrl,
  valuesFromFactKeys,
  type CbsoInput,
  type FactKeyLine,
} from '@ekwo-ai/xbrl-cbso';
import { asUser, freshDatabase, one, repoRoot, rows } from './helpers/db.js';
import { DEMO_OWNER, demoCompanyId } from './helpers/factory.js';

// The end-to-end test the split into two repositories made impossible: a set
// of books, closed, presented on the three schemes the pack carries, and filed
// through the format library — and the arithmetic the National Bank's own
// Filing application runs, passing.
//
// This is where the pack and the brick meet. Nothing joins them at runtime:
// the pack says which fact each line is, the brick knows what the taxonomy
// calls it, and if either moves, this test is what says so. It is also the
// only test that can say so, which is the whole reason the brick came here.

const SCHEMES = ['BE-BNB-ABBR-BS', 'BE-BNB-ABBR-IS', 'BE-BNB-ABBR-AF'] as const;
const GOLDEN = join(repoRoot, 'tests', 'fixtures', 'demo-cbso-26.xbrl');

/**
 * Identification, which the ledger does not hold. A company row says "SRL";
 * which member of the taxonomy's `lgf` domain that is, is a mapping nobody has
 * verified against an accepted filing, so the fixture states the one form the
 * brick does vouch for. Everything here is invented, like the demo company it
 * describes.
 */
const IDENTIFICATION = {
  legalForm: LegalForm.SA_NV,
  court: EnterpriseCourt.BRUSSELS_FR,
  periodStart: '2026-01-01',
  periodEnd: '2026-12-31',
  prevPeriodStart: '2025-01-01',
  prevPeriodEnd: '2025-12-31',
  gaDate: '2027-05-12',
  deedDate: '2019-03-04',
} as const;

let db: PGlite;
let demo: string;
let lines: FactKeyLine[];
let input: CbsoInput;

beforeAll(async () => {
  db = await freshDatabase();
  demo = await demoCompanyId(db);

  // Annual accounts are filed on a closed year: until the result is
  // appropriated it sits on neither side of the balance sheet, and 20/58 =
  // 10/49 — an identity the Filing application checks — is false.
  const year = await one<{ id: string }>(
    db,
    `select id from fiscal_years where company_id = $1 and start_date = date '2026-01-01'`,
    [demo],
  );
  await asUser(db, DEMO_OWNER, () =>
    one(db, `select close_fiscal_year($1) as closed`, [year.id]),
  );

  interface StatementRow {
    line_code: string;
    amount: string;
    xbrl_element: string | null;
  }

  const rowsOfSchemes: StatementRow[] = [];
  for (const code of SCHEMES) {
    rowsOfSchemes.push(
      ...(await rows<StatementRow>(db, `select * from financial_statement($1, $2, $3, $4)`, [
        demo,
        code,
        IDENTIFICATION.periodStart,
        IDENTIFICATION.periodEnd,
      ])),
    );
  }

  // The rows go to the brick as they come out of the function: a fact key and
  // an amount. No mapping in between, which is the point — the mapping is the
  // pack, and it was written once.
  lines = rowsOfSchemes.map((row) => ({
    xbrl_element: row.xbrl_element as string,
    amount: Number(row.amount),
  }));

  const company = await one<{
    legal_name: string;
    registration_number: string;
    address_line1: string;
    postal_code: string;
    city: string;
  }>(
    db,
    `select legal_name, registration_number, address_line1, postal_code, city
       from companies where id = $1`,
    [demo],
  );

  const [street, number] = [
    company.address_line1.replace(/\s+\S+$/, ''),
    company.address_line1.split(' ').at(-1) as string,
  ];

  input = {
    ...IDENTIFICATION,
    entityNumber: company.registration_number,
    denomination: company.legal_name,
    address: { street, number, postalCode: company.postal_code, city: company.city },
    lines,
  };
}, 120_000);

afterAll(async () => {
  await db.close();
});

describe('the demo books, filed with the National Bank', () => {
  it('presents every line of the three schemes, each one naming its fact', () => {
    expect(lines).toHaveLength(53);
    expect(lines.filter((line) => line.xbrl_element === null)).toEqual([]);
  });

  it('resolves them onto the reporting codes of the model, 14 once and not twice', () => {
    // The result carried forward is one fact: the balance sheet shows it and
    // the appropriation section shows it again. Two rows, one code, and the
    // resolver refuses them only if the two figures disagree.
    const values = valuesFromFactKeys(lines, CBSO_26_M01F);
    expect(Object.keys(values)).toHaveLength(52);
    expect(values['14']).toEqual(values['9905']);
  });

  it('satisfies the arithmetic the Filing application checks', () => {
    expect(checkBnbEquations(valuesFromFactKeys(lines, CBSO_26_M01F))).toEqual([]);
  });

  it('produces the instance committed as the golden file, byte for byte', async () => {
    // The generator writes no timestamp and no identifier of its own, so the
    // same books give the same bytes. A diff here is a change in the pack, in
    // the statements function, or in the brick — all three worth reading.
    const xml = generateCbsoXbrl(input);
    // A golden nobody can regenerate is a golden nobody reads. `UPDATE_GOLDEN=1
    // npm test` rewrites the file; the diff is then the thing to review, and
    // the CI never sets it.
    if (process.env['UPDATE_GOLDEN'] === '1') await writeFile(GOLDEN, xml, 'utf8');
    expect(xml).toBe(await readFile(GOLDEN, 'utf8'));
  });
});
