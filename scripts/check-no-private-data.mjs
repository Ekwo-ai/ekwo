#!/usr/bin/env node
/**
 * Refuses a commit that carries a real company or person into a public
 * repository. Demo data is fictional and stays that way.
 *
 * Run with `npm run check:no-private-data`; CI runs it on every push.
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage', '.vitest']);
const SKIP_FILES = new Set(['package-lock.json', 'LICENSE']);

/**
 * Names that must never appear. Add to this list rather than relaxing it.
 * `scripts/` itself is excluded, since this file contains the list.
 */
const DENY = [
  'newide',
  'ai4energy',
  'alaya',
  'baltus',
  'wesmart',
  'wecompta',
  'bordes',
  'nexgen',
];

const found = [];

async function walk(dir) {
  for (const name of await readdir(dir)) {
    if (SKIP_DIRS.has(name) || SKIP_FILES.has(name)) continue;
    const full = join(dir, name);
    const info = await stat(full);
    if (info.isDirectory()) {
      await walk(full);
      continue;
    }
    if (info.size > 4_000_000) continue;
    const rel = relative(root, full);
    if (rel.startsWith('scripts/')) continue;

    const text = await readFile(full, 'utf8').catch(() => null);
    if (text === null) continue;
    const lower = text.toLowerCase();
    for (const needle of DENY) {
      let index = lower.indexOf(needle);
      while (index !== -1) {
        const line = text.slice(0, index).split('\n').length;
        found.push(`${rel}:${line}  ${needle}`);
        index = lower.indexOf(needle, index + needle.length);
      }
    }
  }
}

await walk(root);

if (found.length > 0) {
  console.error('Private data found in the repository:\n');
  for (const hit of found) console.error(`  ${hit}`);
  console.error(`\n${found.length} occurrence(s). Remove them before committing.`);
  process.exit(1);
}

console.log('No private data found.');
