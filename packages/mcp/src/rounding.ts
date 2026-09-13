/**
 * The one rounding rule of Ekwo: **half up, on the absolute value, at the
 * currency's decimals**.
 *
 * Three packages used to answer this differently — `Math.round((v + EPSILON) *
 * 100) / 100`, `Math.round(v * 100) / 100` and `Number.prototype.toFixed(2)` —
 * and the three disagreed on the two cases that matter: a negative half, where
 * `Math.round` goes towards positive infinity and turns -0.005 into -0.00, and
 * a value a binary float cannot hold, where 2.675 becomes 2.67 because
 * `2.675 * 100` is really 267.49999999999994. A credit note is a sale with the
 * sign flipped; a rule that treats the two differently puts a cent between an
 * invoice and its credit note, and the cent is found by the person filing the
 * return.
 *
 * Half up on the absolute value is what an invoice, a VAT return and a set of
 * annual accounts are written with, and it is symmetric by construction: the
 * rounding of -x is the rounding of x with the sign put back.
 *
 * The file is deliberately identical in every package that holds a copy. A
 * format brick may not import the core or another brick, so the rule is
 * duplicated rather than shared — and `tests/rounding.test.ts` reads the
 * copies and refuses one that has drifted. See `docs/decisions.md`.
 */
export function roundCurrency(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  const scaled = Math.abs(value) * factor;
  // The nudge is proportional to the number, which is what makes it work at
  // 1.005 and at 1000000.005 alike, and far too small to move a value that is
  // not already within a bit of the halfway point.
  const rounded = Math.round(scaled + Number.EPSILON * scaled);
  // `-0` is a value of its own in JavaScript and it prints as "-0.00".
  // Adding zero turns it back into `0`.
  return (value < 0 ? -rounded : rounded) / factor + 0;
}
