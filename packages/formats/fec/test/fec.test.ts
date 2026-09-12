import { describe, expect, it } from 'vitest';
import {
  checkFec,
  FEC_COLUMNS,
  FecError,
  fecFileName,
  formatFecAmount,
  formatFecDate,
  generateFec,
  type FecLine,
} from '../src/index.js';

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
