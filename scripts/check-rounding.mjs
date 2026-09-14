#!/usr/bin/env node
/**
 * Refuses a new migration that rounds a money amount to a hard-coded number of
 * decimals.
 *
 * Since `20260914120500_rounding_reads_the_currency`, the decimals of an
 * amount come from `currencies.decimal_places` and the method from
 * `country_defaults.rounding_method`, through one function:
 *
 *     round_amount(amount, rounding_of(company_id, currency_code))
 *
 * A `round(x, 2)` written anywhere else is the bug that migration exists to
 * remove — right for the euro, wrong for the yen, which has no decimals, and
 * for the dinar, which has three. So is a cast to `numeric(n, 2)`, which
 * rounds just as silently while looking like a type.
 *
 * The check runs on migrations *newer than* that one, because a published
 * migration is never edited: the fifty-one calls that were there before are
 * history, and what replaced them is what the database now runs. The live
 * definitions are checked from the catalogue instead, in
 * `tests/currency_rounding.test.ts` — that test is the other half of this one
 * and neither replaces the other.
 *
 * Run with `npm run check:rounding`; CI runs it on every push.
 */

import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The migration that made rounding read the currency. */
const FROM_VERSION = '20260914120500';

/**
 * A rounding that is deliberately not a money amount. Add to this with a
 * sentence saying why, never by widening the rule.
 *
 * Nothing is on it today: every `round(x, <number>)` left in a live migration
 * is inside `round_amount` itself, where the number is a variable.
 */
const ALLOWED = new Map([
  // 'supabase/migrations/00000000000000_example.sql': 'a percentage, not an amount',
]);

/** `-- …` comments stripped, so a call quoted in a comment is not a finding. */
function withoutComments(sql) {
  return sql.replace(/--[^\n]*/g, '');
}

/** The last top-level argument of every `round(` call in a body of SQL. */
function scalesOfRound(sql) {
  const out = [];
  const call = /(^|[^_a-zA-Z0-9.])round\s*\(/g;
  let match;
  while ((match = call.exec(sql)) !== null) {
    let depth = 1;
    let last = call.lastIndex;
    for (let i = call.lastIndex; i < sql.length && depth > 0; i += 1) {
      const c = sql[i];
      if (c === '(') depth += 1;
      else if (c === ')') {
        depth -= 1;
        if (depth === 0) out.push(sql.slice(last, i).trim());
      } else if (c === ',' && depth === 1) last = i + 1;
    }
  }
  return out;
}

async function migrations() {
  const dirs = [join(root, 'supabase', 'migrations')];
  const modules = await readdir(join(root, 'modules'), { withFileTypes: true }).catch(() => []);
  for (const entry of modules) {
    if (entry.isDirectory() && entry.name !== 'schema') {
      dirs.push(join(root, 'modules', entry.name, 'supabase', 'migrations'));
    }
  }
  const files = [];
  for (const dir of dirs) {
    for (const name of (await readdir(dir).catch(() => [])).sort()) {
      if (name.endsWith('.sql') && name.slice(0, 14) >= FROM_VERSION) files.push(join(dir, name));
    }
  }
  return files;
}

const found = [];

for (const path of await migrations()) {
  const rel = relative(root, path);
  if (ALLOWED.has(rel)) continue;
  const sql = withoutComments(await readFile(path, 'utf8'));

  for (const scale of scalesOfRound(sql)) {
    if (/^\d+$/.test(scale)) {
      found.push(`${rel}: round(…, ${scale}) — the decimals of an amount come from its currency`);
    }
  }
  // A column declaration is the schema saying what it can hold; a cast is a
  // rounding written as a type. The two are told apart by the `::`.
  for (const cast of sql.match(/::\s*numeric\s*\(\s*\d+\s*,\s*\d+\s*\)/g) ?? []) {
    found.push(
      `${rel}: a cast to ${cast.replace(/\s+/g, ' ')} rounds as silently as round() does`,
    );
  }
}

if (found.length > 0) {
  console.error('A money amount is rounded to a number of decimals written down:\n');
  for (const line of found) console.error(`  ${line}`);
  console.error(
    `\nUse round_amount(amount, rounding_of(company_id, currency_code)).` +
      `\nIf the rounding is genuinely not an amount — a percentage, a quantity —` +
      `\nadd the file to ALLOWED in scripts/check-rounding.mjs with the reason.`,
  );
  process.exit(1);
}

console.log(`No hard-coded rounding in the migrations since ${FROM_VERSION}.`);
