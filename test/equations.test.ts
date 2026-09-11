import { describe, expect, it } from 'vitest';
import { checkBnbEquations } from '../src/index.js';

describe('checkBnbEquations', () => {
  it('returns nothing for a consistent form', () => {
    expect(
      checkBnbEquations({
        '20': { n: 0 },
        '21/28': { n: 100 },
        '29/58': { n: 50 },
        '20/58': { n: 150 },
        '10/49': { n: 150 },
      }),
    ).toEqual([]);
  });

  it('reports the total that does not add up, per column', () => {
    const violations = checkBnbEquations({
      '21': { n: 100, p: 90 },
      '22/27': { n: 20, p: 20 },
      '21/28': { n: 121, p: 110 },
    });
    expect(violations).toEqual([
      { code: '21/28', column: 'n', expected: 120, actual: 121, rule: '21/28 = 21 + 22/27 + 28' },
    ]);
  });

  it('treats missing operands as zero and skips identities without a total', () => {
    expect(checkBnbEquations({ '21': { n: 100 } })).toEqual([]);
    expect(checkBnbEquations({ '21/28': { n: 0 } })).toEqual([]);
  });

  it('checks the income statement chain with signed terms', () => {
    const ok = checkBnbEquations({
      '9900': { n: 1000 },
      '62': { n: 400 },
      '630': { n: 100 },
      '9901': { n: 500 },
      '75/76B': { n: 10 },
      '65/66B': { n: 30 },
      '9903': { n: 480 },
      '67/77': { n: 120 },
      '9904': { n: 360 },
      '9905': { n: 360 },
    });
    expect(ok).toEqual([]);
    const bad = checkBnbEquations({ '9903': { n: 480 }, '67/77': { n: 120 }, '9904': { n: 300 } });
    expect(bad).toHaveLength(1);
    expect(bad[0]?.rule).toBe('9904 = 9903 + 780 - 680 - 67/77');
  });

  it('honours a custom tolerance', () => {
    const values = { '20/58': { n: 100.004 }, '10/49': { n: 100 } };
    expect(checkBnbEquations(values)).toEqual([]);
    expect(checkBnbEquations(values, { tolerance: 0.001 })).toHaveLength(1);
  });
});
