/**
 * The one vector both halves of the rounding rule are checked against.
 *
 * `tests/rounding.test.ts` runs it through the three TypeScript copies;
 * `tests/currency_rounding.test.ts` runs it through the SQL function and
 * compares the two. It lives here so that neither file can quietly stop
 * testing a case the other still covers.
 *
 * Each case carries the value twice. `value` is the JavaScript number, which
 * is a binary float and is not always the decimal it is written as — 2.675 is
 * really 2.67499999999999982236431605997495353221893310546875. `text` is the
 * decimal itself, which is what Postgres parses into an exact `numeric`. The
 * rule is that the two agree on the answer *for the decimal the author wrote*,
 * which is why the TypeScript version nudges by an epsilon and the SQL version
 * does not have to.
 */
export interface RoundingCase {
  text: string;
  value: number;
  decimals: number;
  expected: number;
  expectedText: string;
}

const cases: [string, number, string][] = [
  ['0', 2, '0.00'],
  ['1.005', 2, '1.01'],
  ['-1.005', 2, '-1.01'],
  ['2.675', 2, '2.68'],
  ['-2.675', 2, '-2.68'],
  ['0.125', 2, '0.13'],
  ['-0.125', 2, '-0.13'],
  ['1.0049', 2, '1.00'],
  ['-1.0049', 2, '-1.00'],
  ['1234.567', 2, '1234.57'],
  ['-1234.567', 2, '-1234.57'],
  ['1000000.005', 2, '1000000.01'],
  ['0.005', 2, '0.01'],
  ['-0.005', 2, '-0.01'],
  ['0.004', 2, '0.00'],
  ['-0.004', 2, '0.00'],
  ['19.99', 2, '19.99'],
  ['-19.99', 2, '-19.99'],
  // A currency with no decimals at all: the yen, and the halves it meets.
  ['1.5', 0, '2'],
  ['-1.5', 0, '-2'],
  ['2.5', 0, '3'],
  ['-2.5', 0, '-3'],
  ['0.5', 0, '1'],
  ['-0.5', 0, '-1'],
  ['0.4999', 0, '0'],
  ['1234.5', 0, '1235'],
  ['-1234.5', 0, '-1235'],
  // A currency with three: the dinar, and the millime it is written to.
  ['1.2345', 3, '1.235'],
  ['-1.2345', 3, '-1.235'],
  ['0.0005', 3, '0.001'],
  ['-0.0005', 3, '-0.001'],
  ['0.0004', 3, '0.000'],
  ['1234.5678', 3, '1234.568'],
  // And four, which no currency has and the helpers still answer.
  ['1.23456', 4, '1.2346'],
  ['-1.23456', 4, '-1.2346'],
];

export const ROUNDING_VECTOR: RoundingCase[] = cases.map(([text, decimals, expectedText]) => ({
  text,
  value: Number(text),
  decimals,
  expected: Number(expectedText),
  expectedText,
}));
