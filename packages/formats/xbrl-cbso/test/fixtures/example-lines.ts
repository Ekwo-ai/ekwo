/**
 * The same balance sheet, as a book-keeping system that stores the taxonomy
 * key next to each statement line hands it over: no reporting code anywhere,
 * only the fact signature and the two figures.
 */
import type { FactKeyLine } from '../../src/index.js';

export const exampleLines: readonly FactKeyLine[] = [
  { xbrl_element: 'met:am1|bas:m2|ntr:m1', amount: 30000, previous_amount: 40000 },
  { xbrl_element: 'met:am1|bas:m2|ntr:m2', amount: 12000, previous_amount: 15000 },
  { xbrl_element: 'met:am1|bas:m5|ntr:m2', amount: 8000, previous_amount: 10000 },
  { xbrl_element: 'met:am1|bas:m2|ntr:m3', amount: 1000, previous_amount: 1000 },
  { xbrl_element: 'met:am1|bas:m2', amount: 43000, previous_amount: 56000 },
  { xbrl_element: 'met:am1|bas:m9|rst:m2', amount: 60000, previous_amount: 47500 },
  { xbrl_element: 'met:am1|bas:m23', amount: 97000, previous_amount: 66500 },
  { xbrl_element: 'met:am1|bas:m12', amount: 158500, previous_amount: 115000 },
  { xbrl_element: 'met:am2|bas:m37|ntr:m4', amount: 126000, previous_amount: 100500 },
  { xbrl_element: 'met:am1|bas:m50', amount: 75500, previous_amount: 70500 },
  // A line with nothing on it is skipped rather than emitted as a zero.
  { xbrl_element: 'met:am1|bas:m50|rst:m1', amount: null, previous_amount: null },
];
