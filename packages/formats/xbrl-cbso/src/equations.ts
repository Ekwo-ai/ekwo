/**
 * Arithmetic identities of the abridged model, as checked by the Filing
 * application. Run them before generating to catch inconsistent inputs early.
 */
import type { BnbCode, YearValues } from './types.js';
import { roundCurrency } from './rounding.js';

export interface EquationViolation {
  /** Code of the total that does not add up. */
  code: BnbCode;
  column: 'n' | 'p';
  expected: number;
  actual: number;
  /** Human-readable identity, e.g. `"20/58 = 20 + 21/28 + 29/58"`. */
  rule: string;
}

interface Identity {
  total: BnbCode;
  /** Operands with their sign. */
  terms: Array<{ code: BnbCode; sign: 1 | -1 }>;
}

const plus = (code: BnbCode) => ({ code, sign: 1 as const });
const minus = (code: BnbCode) => ({ code, sign: -1 as const });

/** Identities of the abridged model for companies with capital. */
export const ABRIDGED_IDENTITIES: readonly Identity[] = [
  // Balance sheet
  { total: '20/58', terms: [plus('20'), plus('21/28'), plus('29/58')] },
  { total: '21/28', terms: [plus('21'), plus('22/27'), plus('28')] },
  { total: '22/27', terms: [plus('22'), plus('23'), plus('24'), plus('25'), plus('26'), plus('27')] },
  { total: '29/58', terms: [plus('29'), plus('3'), plus('40/41'), plus('50/53'), plus('54/58'), plus('490/1')] },
  { total: '40/41', terms: [plus('40'), plus('41')] },
  { total: '10/49', terms: [plus('10/15'), plus('16'), plus('17/49')] },
  { total: '10/15', terms: [plus('10/11'), plus('12'), plus('13'), plus('14'), plus('15'), plus('19')] },
  { total: '10/11', terms: [plus('10'), plus('11')] },
  { total: '10', terms: [plus('100'), plus('101')] },
  { total: '13', terms: [plus('130/1'), plus('132'), plus('133')] },
  { total: '17/49', terms: [plus('17'), plus('42/48'), plus('492/3')] },
  { total: '42/48', terms: [plus('42'), plus('43'), plus('44'), plus('46'), plus('45'), plus('47/48')] },
  { total: '45', terms: [plus('450/3'), plus('454/9')] },
  // Balance sheet total = total of liabilities and equity
  { total: '20/58', terms: [plus('10/49')] },
  // Income statement
  { total: '75/76B', terms: [plus('75'), plus('76B')] },
  { total: '65/66B', terms: [plus('65'), plus('66B')] },
  {
    total: '9901',
    terms: [plus('9900'), minus('62'), minus('630'), minus('631/4'), minus('635/8'), minus('640/8'), plus('649'), minus('66A')],
  },
  { total: '9903', terms: [plus('9901'), plus('75/76B'), minus('65/66B')] },
  { total: '9904', terms: [plus('9903'), plus('780'), minus('680'), minus('67/77')] },
  { total: '9905', terms: [plus('9904'), plus('789'), minus('689')] },
  // Appropriation
  { total: '9906', terms: [plus('9905'), plus('14P')] },
  // Fixed assets: net book value = acquisition value − depreciation
  { total: '21', terms: [plus('8059'), minus('8129')] },
  { total: '22/27', terms: [plus('8199'), minus('8329')] },
  { total: '28', terms: [plus('8395')] },
];

/**
 * Checks every identity whose total and at least one operand are present in
 * `values`. Missing operands count as zero, as in Filing. Returns the
 * violations (empty = consistent).
 */
export function checkBnbEquations(
  values: Record<BnbCode, YearValues>,
  options: { tolerance?: number; identities?: readonly Identity[] } = {},
): EquationViolation[] {
  const tolerance = options.tolerance ?? 0.005;
  const identities = options.identities ?? ABRIDGED_IDENTITIES;
  const violations: EquationViolation[] = [];

  for (const identity of identities) {
    for (const column of ['n', 'p'] as const) {
      const actual = values[identity.total]?.[column];
      if (actual == null) continue;
      // An identity whose operands are all absent is not part of the form
      // being filed (e.g. the fixed-assets annex was not provided).
      if (!identity.terms.some((t) => values[t.code]?.[column] != null)) continue;
      const expected = identity.terms.reduce(
        (sum, t) => sum + t.sign * (values[t.code]?.[column] ?? 0),
        0,
      );
      if (Math.abs(expected - actual) > tolerance) {
        violations.push({
          code: identity.total,
          column,
          expected: round2(expected),
          actual: round2(actual),
          rule: `${identity.total} = ${identity.terms
            .map((t, k) => `${t.sign < 0 ? '- ' : k === 0 ? '' : '+ '}${t.code}`)
            .join(' ')}`,
        });
      }
    }
  }
  return violations;
}

/** The one rounding rule, at two decimals. See `rounding.ts`. */
function round2(v: number): number {
  return roundCurrency(v, 2);
}
