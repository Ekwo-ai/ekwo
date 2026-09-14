#!/usr/bin/env node
/**
 * A test may book in a country. It may not expect one.
 *
 * The suite used to name `BE`, `FR` and `LU` by hand: a loop over two slugs, a
 * table of three rows, a count per country. Every one of those is a place a new
 * pack has to be added before it is checked at all — and until it is added, the
 * pack proves nothing, because nothing looks at it.
 *
 * So the line this guard draws is between the two halves of a test:
 *
 * - **Setting up** may name a country. A scenario books invoices somewhere, on
 *   some chart, with some tax code, and saying which is how it stays readable.
 *   A new pack never has to touch that line.
 * - **Expecting** may not. What a test asserts about the core has to come from
 *   the pack — `listPacks()`, the manifest's roles, the chart, the declaration
 *   form — or it is an assertion about the countries somebody remembered.
 *
 * Three things fail, then:
 *
 *   1. a country code inside an `expect(...)`, next to the word `country`;
 *   2. a list of two or more country codes or pack slugs, anywhere;
 *   3. a pack named by hand where `listPacks()` would have found it.
 *
 * The way out is one line, and it has to say why:
 *
 *     // country-literal: the demo company is Belgian, and this reads its books
 *
 * on the offending line, or in a comment above the lines it covers.
 */

import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Where the suite lives. Everything under these, `.ts` only. */
const ROOTS = ['tests', 'modules'];

/**
 * ISO 3166-1 alpha-2 codes of the European Union, plus the ones the packs of
 * this repository use. A wider list would catch a French balance-sheet line
 * called `EE` or `BX`; a narrower one would stop catching a country the day a
 * pack for it landed. Rule 1 needs the word `country` beside the code anyway.
 */
const COUNTRIES = new Set([
  'AT', 'BE', 'BG', 'CH', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GB',
  'GR', 'HR', 'HU', 'IE', 'IS', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'NO', 'PL',
  'PT', 'RO', 'SE', 'SI', 'SK',
]);

const MARKER = /\/\/\s*country-literal:\s*\S/;

async function packSlugs() {
  const entries = await readdir(join(root, 'packs'), { withFileTypes: true });
  return new Set(
    entries.filter((e) => e.isDirectory() && /^[a-z]{2}$/.test(e.name)).map((e) => e.name),
  );
}

async function testFiles(dir) {
  const out = [];
  for (const entry of await readdir(join(root, dir), { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await testFiles(path)));
    else if (entry.name.endsWith('.ts') && path.includes('tests')) out.push(path);
  }
  return out;
}

/**
 * The character ranges of every `expect(...)` statement of a file.
 *
 * From `expect(` to the `;` that closes the statement, so a multi-line
 * `.toEqual([...])` counts as one expectation. Strings are skipped while the
 * brackets are counted, and searched afterwards: a country code inside a SQL
 * string in an expectation is exactly the case this looks for.
 */
function expectRanges(text) {
  const ranges = [];
  for (let i = 0; i < text.length; i += 1) {
    if (!text.startsWith('expect(', i)) continue;
    if (i > 0 && /[\w$.]/.test(text[i - 1])) continue;
    let depth = 0;
    let j = i + 'expect'.length;
    for (; j < text.length; j += 1) {
      const c = text[j];
      if (c === "'" || c === '"' || c === '`') {
        j = endOfString(text, j);
        continue;
      }
      if (c === '(' || c === '[' || c === '{') depth += 1;
      else if (c === ')' || c === ']' || c === '}') depth -= 1;
      else if (c === ';' && depth === 0) break;
      if (depth < 0) break;
    }
    ranges.push([i, Math.min(j, text.length)]);
    i = j;
  }
  return ranges;
}

/** Index of the closing quote of the string that opens at `start`. */
function endOfString(text, start) {
  const quote = text[start];
  for (let i = start + 1; i < text.length; i += 1) {
    if (text[i] === '\\') i += 1;
    else if (text[i] === quote) return i;
  }
  return text.length;
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

/**
 * The lines a marker excuses.
 *
 * Its own line, and — when it stands in a comment above the code — the run of
 * code under that comment, down to the first blank line. A reason worth
 * writing rarely fits on one line and rarely covers exactly one.
 */
function excusedLines(lines) {
  const excused = new Set();
  let marked = false;
  lines.forEach((raw, index) => {
    const text = raw.trim();
    const line = index + 1;
    if (MARKER.test(text)) {
      excused.add(line);
      if (text.startsWith('//')) marked = true;
      return;
    }
    if (text.startsWith('//')) {
      if (marked) excused.add(line);
      return;
    }
    if (text === '') {
      marked = false;
      return;
    }
    if (marked) excused.add(line);
  });
  return excused;
}

async function main() {
  const slugs = await packSlugs();
  const files = (await Promise.all(ROOTS.map(testFiles))).flat().sort();
  const problems = [];

  for (const file of files) {
    if (file.endsWith('scripts/check-no-country-literals-in-tests.mjs')) continue;
    const text = await readFile(join(root, file), 'utf8');
    const lines = text.split('\n');
    const excused = excusedLines(lines);
    const flag = (index, rule, what) => {
      const line = lineOf(text, index);
      if (excused.has(line)) return;
      problems.push({ file, line, rule, what });
    };

    // 1. A country in an expectation.
    for (const [from, to] of expectRanges(text)) {
      const slice = text.slice(from, to);
      // A country code within reach of the word `country`: `country: 'BE'`,
      // `country = 'BE'`, `country'] === 'BE'`, `row.country).toBe('BE')`.
      const near = /country[^\n'"]{0,60}?(['"])([A-Z]{2})\1/g;
      for (const match of slice.matchAll(near)) {
        if (!COUNTRIES.has(match[2])) continue;
        flag(from + match.index, 1, `${match[2]} is expected by hand; take it from the pack`);
      }
      const bare = /(['"])([a-z]{2})\1/g;
      for (const match of slice.matchAll(bare)) {
        if (!slugs.has(match[2])) continue;
        flag(from + match.index, 1, `the pack ${match[2]} is expected by hand`);
      }
    }

    // 2. A list of countries, anywhere: what `listPacks()` is for.
    const list = /(['"])([A-Za-z]{2})\1\s*,\s*(['"])([A-Za-z]{2})\3/g;
    for (const match of text.matchAll(list)) {
      const [a, b] = [match[2], match[4]];
      // Two *different* codes are a list. The same one twice is a company and
      // its fiscal country, which names one country and enumerates nothing.
      const both =
        (COUNTRIES.has(a) && COUNTRIES.has(b)) || (slugs.has(a) && slugs.has(b));
      if (!both || a === b) continue;
      flag(match.index, 2, `${a} and ${b} are listed by hand; iterate listPacks()`);
    }

    // 3. A pack named by hand where listPacks() would have found it.
    const named = /(?:readPack|listPacks)\(\s*(['"])([a-z]{2})\1|join\([^()\n]*,\s*(['"])([a-z]{2})\3\s*\)/g;
    for (const match of text.matchAll(named)) {
      const slug = match[2] ?? match[4];
      if (!slugs.has(slug)) continue;
      flag(match.index, 3, `packs/${slug} is named by hand; pick it by what it carries`);
    }
  }

  if (problems.length === 0) {
    console.log(`${files.length} test files: no country is enumerated.`);
    return;
  }
  for (const p of problems) {
    console.error(`${p.file}:${p.line}  [rule ${p.rule}] ${p.what}`);
  }
  console.error(
    `\n${problems.length} country literal(s) in what the tests expect.\n` +
      'A test about the core iterates listPacks() and reads its expectation from the pack.\n' +
      'A claim only one country can make belongs in packs/<cc>/golden/expectations.json.\n' +
      'If the literal is right, say why on the line above: // country-literal: <reason>',
  );
  process.exitCode = 1;
}

await main();
