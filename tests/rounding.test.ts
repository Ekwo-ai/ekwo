/**
 * One rounding rule, in three copies that have to stay identical.
 *
 * Before 13 September 2026 the three packages answered this differently:
 * `factur-x` added an epsilon and rounded, `xbrl-cbso` rounded without one,
 * and the MCP server used `toFixed(2)`. The three disagree on exactly the two
 * cases a ledger meets — a negative half, where `Math.round` goes towards
 * positive infinity and turns -0.005 into -0.00, and a value a binary float
 * cannot hold, where 2.675 becomes 2.67 because `2.675 * 100` is really
 * 267.49999999999994.
 *
 * A format brick may not import the core or another brick, so the rule cannot
 * be shared as code. It is duplicated, and this file is what keeps the copies
 * honest: the same vector is run through all three, and the three source
 * files are compared byte for byte.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { roundCurrency as facturx } from '../packages/formats/factur-x/src/rounding.js';
import { roundCurrency as xbrl } from '../packages/formats/xbrl-cbso/src/rounding.js';
import { roundCurrency as mcp } from '../packages/mcp/src/rounding.js';
import { money } from '../packages/mcp/src/format.js';
import { round2 } from '../packages/formats/factur-x/src/totals.js';
import { repoRoot } from './helpers/db.js';

const COPIES = [
  'packages/formats/factur-x/src/rounding.ts',
  'packages/formats/xbrl-cbso/src/rounding.ts',
  'packages/mcp/src/rounding.ts',
];

/**
 * The vector. Half up, on the absolute value, at the named decimals — so the
 * rounding of -x is the rounding of x with the sign put back, always.
 */
const VECTOR: [number, number, number][] = [
  [0, 2, 0],
  [1.005, 2, 1.01],
  [-1.005, 2, -1.01],
  [2.675, 2, 2.68],
  [-2.675, 2, -2.68],
  [0.125, 2, 0.13],
  [-0.125, 2, -0.13],
  [1.0049, 2, 1.0],
  [-1.0049, 2, -1.0],
  [1234.567, 2, 1234.57],
  [-1234.567, 2, -1234.57],
  [1000000.005, 2, 1000000.01],
  [0.005, 2, 0.01],
  [-0.005, 2, -0.01],
  [0.004, 2, 0],
  [-0.004, 2, 0],
  [1.5, 0, 2],
  [-1.5, 0, -2],
  [2.5, 0, 3],
  [-2.5, 0, -3],
  [1.23456, 4, 1.2346],
  [-1.23456, 4, -1.2346],
  [19.99, 2, 19.99],
  [-19.99, 2, -19.99],
];

describe('the one rounding rule', () => {
  for (const [name, round] of [
    ['factur-x', facturx],
    ['xbrl-cbso', xbrl],
    ['mcp', mcp],
  ] as const) {
    it(`is the same in ${name}`, () => {
      for (const [value, decimals, expected] of VECTOR) {
        expect(round(value, decimals), `${value} at ${decimals}`).toBe(expected);
      }
    });
  }

  it('is symmetric: the rounding of -x is the rounding of x, signed back', () => {
    for (const [value, decimals] of VECTOR) {
      expect(facturx(-value, decimals)).toBe(-facturx(value, decimals) + 0);
    }
  });

  it('is what the callers of the three packages actually get', () => {
    // `round2` is what the Factur-X totals are built on, and `money()` is how
    // every amount leaves the MCP server.
    expect(round2(2.675)).toBe(2.68);
    expect(round2(-2.675)).toBe(-2.68);
    expect(money(2.675)).toBe('2.68');
    expect(money(-2.675)).toBe('-2.68');
    expect(money(-0.004)).toBe('0.00');
  });

  it('is one file, copied and not rewritten', async () => {
    const texts = await Promise.all(
      COPIES.map((path) => readFile(join(repoRoot, path), 'utf8')),
    );
    for (let i = 1; i < texts.length; i += 1) {
      expect(texts[i], `${COPIES[i]} has drifted from ${COPIES[0]}`).toBe(texts[0]);
    }
  });
});
