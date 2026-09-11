import { describe, expect, it } from 'vitest';
import { isValidEnterpriseNumber, normalizeEnterpriseNumber } from '../src/index.js';

describe('normalizeEnterpriseNumber', () => {
  it('strips dots, spaces and the BE prefix', () => {
    expect(normalizeEnterpriseNumber('0123.456.749')).toBe('0123456749');
    expect(normalizeEnterpriseNumber('BE 0123 456 749')).toBe('0123456749');
    expect(normalizeEnterpriseNumber('be0123456749')).toBe('0123456749');
  });
});

describe('isValidEnterpriseNumber', () => {
  it('accepts numbers with correct check digits', () => {
    expect(isValidEnterpriseNumber('0123456749')).toBe(true);
    expect(isValidEnterpriseNumber('0400.000.086')).toBe(true);
  });

  it('rejects wrong check digits and wrong lengths', () => {
    expect(isValidEnterpriseNumber('0123456748')).toBe(false);
    expect(isValidEnterpriseNumber('123456749')).toBe(false);
    expect(isValidEnterpriseNumber('')).toBe(false);
  });
});
