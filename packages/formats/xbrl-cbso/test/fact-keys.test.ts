import { describe, expect, it } from 'vitest';
import {
  CBSO_26_M01F,
  CbsoFactKeyError,
  factKeyOf,
  generateCbsoXbrl,
  mergeValues,
  parseFactKey,
  resolveFactKey,
  unfiledValues,
  valuesFromFactKeys,
} from '../src/index.js';
import { exampleInput } from './fixtures/example-input.js';
import { exampleLines } from './fixtures/example-lines.js';

const resolve = (key: string) => resolveFactKey(key, CBSO_26_M01F);

describe('parseFactKey', () => {
  it('reads the metric and the domain members', () => {
    expect(parseFactKey('met:am1|bas:m9|rst:m2')).toEqual({
      metric: 'met:am1',
      members: { 'dim:bas': 'bas:m9', 'dim:rst': 'rst:m2' },
    });
  });

  it('refuses a key that does not start with a metric', () => {
    expect(() => parseFactKey('bas:m9|rst:m2')).toThrow(CbsoFactKeyError);
  });
});

describe('resolveFactKey', () => {
  it('resolves the lines of the balance sheet', () => {
    expect(resolve('met:am1|bas:m2')).toBe('21/28');
    expect(resolve('met:am1|bas:m2|ntr:m1')).toBe('21');
    expect(resolve('met:am1|bas:m2|ntr:m2')).toBe('22/27');
    expect(resolve('met:am1|bas:m5|ntr:m2')).toBe('24');
    expect(resolve('met:am1|bas:m2|ntr:m3')).toBe('28');
    expect(resolve('met:am1|bas:m12')).toBe('29/58');
    expect(resolve('met:am1|bas:m9|rst:m1')).toBe('29');
    expect(resolve('met:am1|bas:m9|rst:m2')).toBe('40/41');
    expect(resolve('met:am1|bas:m23')).toBe('54/58');
  });

  it('resolves the lines of the income statement and of the appropriation', () => {
    expect(resolve('met:am2|bas:m118|ntr:m17')).toBe('9900');
    expect(resolve('met:am2|bas:m1|ntr:m7')).toBe('62');
    expect(resolve('met:am2|bas:m44|ntr:m6')).toBe('9901');
    expect(resolve('met:am2|bas:m59|spec:m16')).toBe('9903');
    expect(resolve('met:am2|bas:m49|spec:m17')).toBe('67/77');
    expect(resolve('met:am2|bas:m59')).toBe('9904');
    expect(resolve('met:am2|bas:m59|sts:m11')).toBe('9905');
    expect(resolve('met:am2|bas:m44|ntr:m4')).toBe('14');
    expect(resolve('met:am2|bas:m44|part:m5|sts:m11')).toBe('9906');
    expect(resolve('met:am2|bas:m61|sts:m8')).toBe('14P');
  });

  it('prefers the line that adds the fewest members of its own', () => {
    // bas:m50 alone is the heading "DETTES", not one of the lines under it.
    expect(resolve('met:am1|bas:m50')).toBe('17/49');
    expect(resolve('met:am1|bas:m50|rst:m1')).toBe('17');
    expect(resolve('met:am1|bas:m50|rst:m2')).toBe('42/48');
  });

  it('names the candidates when a key does not say enough', () => {
    // Total assets and total liabilities share every member but dim:part.
    expect(() => resolve('met:am1|bas:m25')).toThrow(CbsoFactKeyError);
    try {
      resolve('met:am1|bas:m25');
    } catch (e) {
      expect((e as CbsoFactKeyError).candidates).toEqual(['10/49', '20/58']);
      expect((e as CbsoFactKeyError).message).toMatch(/part:/);
    }
    expect(resolve('met:am1|bas:m25|part:m1')).toBe('20/58');
    expect(resolve('met:am1|bas:m25|part:m3')).toBe('10/49');
    // Same for the two "comptes de régularisation", one per side of the sheet.
    expect(() => resolve('met:am1|bas:m24')).toThrow(/490\/1, 492\/3/);
  });

  it('refuses a signature the model does not carry', () => {
    expect(() => resolve('met:am1|bas:m999')).toThrow(/no line of this model/);
  });

  it('round-trips through factKeyOf', () => {
    for (const code of ['21', '22/27', '24', '40/41', '9905', '14P']) {
      const fact = CBSO_26_M01F.facts.find((f) => f.role === `rubrique:${code}:N`);
      expect(fact, code).toBeDefined();
      expect(resolve(factKeyOf(fact!))).toBe(code);
    }
  });
});

describe('valuesFromFactKeys', () => {
  it('turns statement lines into reporting codes', () => {
    const values = valuesFromFactKeys(exampleLines, CBSO_26_M01F);
    expect(values['22/27']).toEqual({ n: 12000, p: 15000 });
    expect(values['24']).toEqual({ n: 8000, p: 10000 });
    expect(values['17/49']).toEqual({ n: 75500, p: 70500 });
    expect(values['17']).toBeUndefined(); // both amounts nil
  });

  it('refuses two lines that resolve to the same code with different figures', () => {
    expect(() =>
      valuesFromFactKeys(
        [
          { xbrl_element: 'met:am1|bas:m2|ntr:m2', amount: 1 },
          { xbrl_element: 'met:am1|bas:m2|ntr:m2', amount: 2 },
        ],
        CBSO_26_M01F,
      ),
    ).toThrow(/two lines resolve to 22\/27/);
  });
});

describe('the two input paths', () => {
  it('produce the same facts', () => {
    const viaCodes = generateCbsoXbrl({
      ...exampleInput,
      values: Object.fromEntries(
        Object.entries(mergeValues({ ...exampleInput, values: undefined, lines: exampleLines })),
      ),
    });
    const viaLines = generateCbsoXbrl({ ...exampleInput, values: undefined, lines: exampleLines });
    expect(viaLines).toBe(viaCodes);
    expect(viaLines).toContain('>12000.00</met:am1>');
    expect(viaLines).toContain('>8000.00</met:am1>');
  });

  it('can be combined, and disagree loudly', () => {
    const merged = mergeValues({
      ...exampleInput,
      values: { '9905': { n: 57500, p: 43600 } },
      lines: exampleLines,
    });
    expect(merged['9905']).toEqual({ n: 57500, p: 43600 });
    expect(merged['21/28']).toEqual({ n: 43000, p: 56000 });

    expect(() =>
      mergeValues({
        ...exampleInput,
        values: { '22/27': { n: 1, p: 2 } },
        lines: exampleLines,
      }),
    ).toThrow(/values\.22\/27/);
  });
});

describe('unfiledValues', () => {
  it('reports a figure that would be dropped', () => {
    expect(
      unfiledValues({
        ...exampleInput,
        // 20/28 is a pre-2016 code; 8029 is a movement of the year, which the
        // model has in the current-year column only.
        values: { '20/28': { n: 1 }, '8029': { n: 1, p: 2 }, '21': { n: 3, p: 4 } },
      }),
    ).toEqual([
      { code: '20/28', column: 'n', reason: 'unknown code' },
      { code: '8029', column: 'p', reason: 'no such column' },
    ]);
  });

  it('finds nothing to report on the example', () => {
    expect(unfiledValues(exampleInput)).toEqual([]);
  });
});
