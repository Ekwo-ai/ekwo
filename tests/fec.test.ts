import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  checkFec,
  FEC_COLUMNS,
  FecError,
  fecFileName,
  formatFecAmount,
  formatFecDate,
  fromQueryRow,
  generateFec,
  type FecLine,
  type FecQueryRow,
} from '../packages/core/src/fec.js';
import { freshDatabase, repoRoot, rows } from './helpers/db.js';
import { demoCompanyId } from './helpers/factory.js';

const goldenPath = join(repoRoot, 'tests', 'fixtures', 'demo-fec.txt');

describe('FEC formatting', () => {
  it('has the eighteen columns of the arrete, in order', () => {
    expect(FEC_COLUMNS).toHaveLength(18);
    expect(FEC_COLUMNS[0]).toBe('JournalCode');
    expect(FEC_COLUMNS[13]).toBe('EcritureLet');
    expect(FEC_COLUMNS[17]).toBe('Idevise');
  });

  it('writes dates as YYYYMMDD and amounts with two decimals', () => {
    expect(formatFecDate('2026-08-31')).toBe('20260831');
    expect(formatFecDate(new Date(Date.UTC(2026, 0, 2)))).toBe('20260102');
    expect(formatFecDate(null)).toBe('');
    expect(formatFecAmount(1210)).toBe('1210,00');
    expect(formatFecAmount('1210.5')).toBe('1210,50');
    expect(formatFecAmount(0)).toBe('0,00');
    expect(formatFecAmount(null)).toBe('');
    expect(formatFecAmount(1210, '.')).toBe('1210.00');
  });

  it('refuses an invalid date or amount', () => {
    expect(() => formatFecDate('31/08/2026')).toThrow(FecError);
    expect(() => formatFecAmount('abc')).toThrow(FecError);
  });

  it('builds the file name from the SIREN and the closing date', () => {
    expect(fecFileName('123456789', '2026-12-31')).toBe('123456789FEC20261231.txt');
    expect(fecFileName('123 456 789', '2026-12-31')).toBe('123456789FEC20261231.txt');
    expect(() => fecFileName('12345', '2026-12-31')).toThrow(FecError);
  });

  it('replaces a separator found inside a field', () => {
    const line: FecLine = {
      journalCode: 'SAL',
      journalLib: 'Ventes',
      ecritureNum: 'SAL/2026/0001',
      ecritureDate: '2026-01-31',
      compteNum: '400000',
      compteLib: 'Clients',
      pieceRef: 'FAC-1',
      pieceDate: '2026-01-31',
      ecritureLib: 'Libelle avec | un separateur\net un saut',
      debit: 100,
      credit: 0,
      validDate: '2026-02-01',
    };
    const file = generateFec([line], { header: false });
    expect(file.split('|')).toHaveLength(18);
    expect(file).toContain('Libelle avec un separateur et un saut');
  });
});

describe('checkFec', () => {
  const base: FecLine = {
    journalCode: 'SAL',
    journalLib: 'Ventes',
    ecritureNum: 'SAL/2026/0001',
    ecritureDate: '2026-01-31',
    compteNum: '400000',
    compteLib: 'Clients',
    pieceRef: 'FAC-1',
    pieceDate: '2026-01-31',
    ecritureLib: 'Facture',
    debit: 121,
    credit: 0,
    validDate: '2026-02-01',
  };

  it('accepts a balanced entry', () => {
    expect(
      checkFec([base, { ...base, compteNum: '704000', compteLib: 'Ventes', debit: 0, credit: 121 }]),
    ).toEqual([]);
  });

  it('reports an entry that does not balance', () => {
    const violations = checkFec([base]);
    expect(violations.map((v) => v.rule)).toContain('balance');
  });

  it('reports a line carrying both sides', () => {
    const violations = checkFec([{ ...base, credit: 50 }]);
    expect(violations.map((v) => v.rule)).toContain('one-side');
  });

  it('reports a letter without a date', () => {
    const violations = checkFec([{ ...base, ecritureLet: 'A0001' }]);
    expect(violations.map((v) => v.rule)).toContain('letter');
  });

  it('reports a missing mandatory field', () => {
    const violations = checkFec([{ ...base, compteNum: '' }]);
    expect(violations.map((v) => v.rule)).toContain('required');
  });
});

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
