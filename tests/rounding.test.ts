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
 * files are compared byte for byte. The vector itself lives in
 * `helpers/rounding-vector.ts`, because `currency_rounding.test.ts` runs the
 * same one through the SQL function and compares the two answers.
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
import { ROUNDING_VECTOR } from './helpers/rounding-vector.js';

const COPIES = [
  'packages/formats/factur-x/src/rounding.ts',
  'packages/formats/xbrl-cbso/src/rounding.ts',
  'packages/mcp/src/rounding.ts',
];

describe('the one rounding rule', () => {
  for (const [name, round] of [
    ['factur-x', facturx],
    ['xbrl-cbso', xbrl],
    ['mcp', mcp],
  ] as const) {
    it(`is the same in ${name}`, () => {
      for (const { value, decimals, expected, text } of ROUNDING_VECTOR) {
        expect(round(value, decimals), `${text} at ${decimals}`).toBe(expected);
      }
    });
  }

  it('is symmetric: the rounding of -x is the rounding of x, signed back', () => {
    for (const { value, decimals } of ROUNDING_VECTOR) {
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
