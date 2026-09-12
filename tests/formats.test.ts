import { readFile, readdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { repoRoot } from './helpers/db.js';

// A format library is a brick: MIT, alone, and readable by somebody who has
// never heard of this core. The rules below are what "alone" means, and they
// are checked rather than trusted — a brick that grows an import of the core
// stops being publishable under MIT the day it does, and nobody notices.
//
// What is *not* checked here: the absence of a country. A format brick names
// the country whose format it implements, because a format is code and the
// NBB scheme is Belgian by nature. The repo-wide country guard in
// `tax_report.test.ts` reads `packages/{cli,mcp,core}/src` for that reason.

const formatsDir = join(repoRoot, 'packages', 'formats');

/**
 * Runtime dependencies each brick is allowed, by package name. A format
 * library takes what its format needs and nothing else: `pdf-lib` to put an
 * XML inside a PDF/A-3, and for a text or XML format, nothing at all.
 *
 * A brick missing from this list fails too. Adding one is a decision, and this
 * is where it is written down.
 */
const ALLOWED_DEPENDENCIES: Record<string, readonly string[]> = {
  '@ekwo-ai/xbrl-cbso': [],
  '@ekwo-ai/fec': [],
  '@ekwo-ai/factur-x': ['pdf-lib'],
};

interface Brick {
  dir: string;
  name: string;
  manifest: Record<string, unknown>;
  files: string[];
}

async function tsFilesUnder(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await tsFilesUnder(path)));
    else if (entry.name.endsWith('.ts')) out.push(path);
  }
  return out.sort();
}

async function bricks(): Promise<Brick[]> {
  let entries;
  try {
    entries = await readdir(formatsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: Brick[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const dir = join(formatsDir, entry.name);
    let manifest: Record<string, unknown>;
    try {
      manifest = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
    } catch {
      continue;
    }
    out.push({
      dir,
      name: String(manifest['name']),
      manifest,
      files: await tsFilesUnder(join(dir, 'src')),
    });
  }
  return out;
}

/** Every `from '…'`, `import '…'` and `import('…')` of a source file. */
function importsOf(source: string): string[] {
  const out: string[] = [];
  const patterns = [
    /\bfrom\s+['"]([^'"]+)['"]/g,
    /\bimport\s+['"]([^'"]+)['"]/g,
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) out.push(match[1] as string);
  }
  return out;
}

describe('the format libraries are bricks, not parts of the core', () => {
  it('gives every one of them the MIT licence, in the manifest and in a file', async () => {
    const guilty: string[] = [];
    for (const brick of await bricks()) {
      if (brick.manifest['license'] !== 'MIT') {
        guilty.push(`${brick.name}: license is ${String(brick.manifest['license'])}, not MIT`);
      }
      try {
        const text = await readFile(join(brick.dir, 'LICENSE'), 'utf8');
        if (!/MIT License/i.test(text)) guilty.push(`${brick.name}: LICENSE is not the MIT text`);
      } catch {
        guilty.push(`${brick.name}: no LICENSE file`);
      }
    }
    expect(guilty).toEqual([]);
  });

  it('lets none of them import the core, the schema or another brick', async () => {
    const guilty: string[] = [];
    for (const brick of await bricks()) {
      for (const file of brick.files) {
        for (const specifier of importsOf(await readFile(file, 'utf8'))) {
          const where = `${brick.name}/${relative(brick.dir, file)}`;
          if (specifier.startsWith('@ekwo-ai/')) {
            guilty.push(`${where}: imports ${specifier}`);
            continue;
          }
          if (!specifier.startsWith('.')) continue;
          const target = resolve(file, '..', specifier);
          if (relative(brick.dir, target).startsWith('..')) {
            guilty.push(`${where}: reaches outside the package with ${specifier}`);
          }
        }
      }
    }
    expect(guilty).toEqual([]);
  });

  it('lets none of them take a runtime dependency its format does not need', async () => {
    const guilty: string[] = [];
    for (const brick of await bricks()) {
      const allowed = ALLOWED_DEPENDENCIES[brick.name];
      if (allowed === undefined) {
        guilty.push(
          `${brick.name}: not listed in ALLOWED_DEPENDENCIES — say what this brick may depend on`,
        );
        continue;
      }
      for (const field of ['dependencies', 'peerDependencies'] as const) {
        const declared = Object.keys(
          (brick.manifest[field] as Record<string, string> | undefined) ?? {},
        );
        for (const dependency of declared) {
          if (!allowed.includes(dependency)) guilty.push(`${brick.name}: ${field} ${dependency}`);
        }
      }
    }
    expect(guilty).toEqual([]);
  });

  it('declares no schema_min: the contract is the shape of the rows', async () => {
    const guilty: string[] = [];
    for (const brick of await bricks()) {
      if ('schema_min' in brick.manifest || 'schemaMin' in brick.manifest) {
        guilty.push(brick.name);
      }
    }
    expect(guilty).toEqual([]);
  });
});
