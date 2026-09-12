/**
 * Minimal end-to-end example: build the values, check the identities,
 * generate the XBRL file.
 *
 *   npm run example            → writes ./example-conseil-2025.xbrl
 */
import { writeFileSync } from 'node:fs';
import { checkBnbEquations, generateCbsoXbrl } from '../src/index.js';
import { exampleInput, exampleValues } from '../test/fixtures/example-input.js';

const violations = checkBnbEquations(exampleValues);
if (violations.length > 0) {
  for (const v of violations) {
    console.error(`✗ ${v.rule} (${v.column}): expected ${v.expected}, got ${v.actual}`);
  }
  process.exit(1);
}

const xml = generateCbsoXbrl(exampleInput);
const file = 'example-conseil-2025.xbrl';
writeFileSync(file, xml);

const contexts = (xml.match(/<context /g) ?? []).length;
const facts = (xml.match(/ contextRef=/g) ?? []).length;
console.log(`✓ ${file} — ${xml.length} bytes, ${contexts} contexts, ${facts} facts`);
