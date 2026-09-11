import { describe, expect, it } from 'vitest';
import { defaultVatCategory, toUnitCode } from '../src/index.js';

describe('defaultVatCategory', () => {
  it('standard rate whenever the rate is positive', () => {
    expect(defaultVatCategory({ rate: 21, sellerCountry: 'BE', buyerCountry: 'US', buyerHasVatId: false })).toBe('S');
  });
  it('zero-rated at home, intra-community for EU businesses, exempt for EU consumers, export elsewhere', () => {
    expect(defaultVatCategory({ rate: 0, sellerCountry: 'BE', buyerCountry: 'be', buyerHasVatId: true })).toBe('Z');
    expect(defaultVatCategory({ rate: 0, sellerCountry: 'BE', buyerCountry: 'FR', buyerHasVatId: true })).toBe('K');
    expect(defaultVatCategory({ rate: 0, sellerCountry: 'BE', buyerCountry: 'FR', buyerHasVatId: false })).toBe('E');
    expect(defaultVatCategory({ rate: 0, sellerCountry: 'BE', buyerCountry: 'CH', buyerHasVatId: true })).toBe('G');
  });
});

describe('toUnitCode', () => {
  it('maps words in several languages and passes codes through', () => {
    expect(toUnitCode('heures')).toBe('HUR');
    expect(toUnitCode('Dagen')).toBe('DAY');
    expect(toUnitCode('m²')).toBe('MTK');
    expect(toUnitCode('kWh')).toBe('KWH');
    expect(toUnitCode('MTQ')).toBe('MTQ');
  });
  it('falls back to C62', () => {
    expect(toUnitCode(undefined)).toBe('C62');
    expect(toUnitCode('whatever')).toBe('C62');
  });
});
