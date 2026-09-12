import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkFec, fromQueryRow, generateFec, type FecQueryRow } from '@ekwo-ai/fec';
import { freshDatabase, repoRoot, rows } from './helpers/db.js';
import { demoCompanyId } from './helpers/factory.js';

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
