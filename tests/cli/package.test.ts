/**
 * What ships in the npm package.
 *
 * Somebody running `npx ekwo init` has no clone of this repository, so the
 * migrations and the seeds travel inside the tarball. If that copy drifts
 * from `supabase/`, installations get a schema nobody in this repository has
 * ever tested. These tests pin it byte for byte.
 */

import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEMO_SEED, migrationsDir, resolveBundleDir, seedDir } from '../../packages/cli/src/index.js';
import { copyAssets } from '../../packages/cli/scripts/copy-assets.mjs';
import { repoRoot } from '../helpers/db.js';
import { migrationsPath, seedPath } from './helpers.js';

let temp: string | undefined;

afterEach(async () => {
  if (temp !== undefined) await rm(temp, { recursive: true, force: true });
  temp = undefined;
});

async function sqlFiles(dir: string): Promise<string[]> {
  return (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
}

async function digest(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

describe('the assets copied into the package', () => {
  it('are exactly the files of supabase/migrations and supabase/seed', async () => {
    temp = await mkdtemp(join(tmpdir(), 'ekwo-assets-'));
    await copyAssets(temp);

    expect(await sqlFiles(join(temp, 'migrations'))).toEqual(await sqlFiles(migrationsPath));
    expect(await sqlFiles(join(temp, 'seed'))).toEqual(await sqlFiles(seedPath));
  });

  it('are byte for byte what the repository holds', async () => {
    temp = await mkdtemp(join(tmpdir(), 'ekwo-assets-'));
    await copyAssets(temp);

    for (const [folder, source] of [
      ['migrations', migrationsPath],
      ['seed', seedPath],
    ] as const) {
      for (const file of await sqlFiles(source)) {
        expect(await digest(join(temp, folder, file)), `${folder}/${file}`).toBe(
          await digest(join(source, file)),
        );
      }
    }
  });

  it('carry the demo seed, which the installer then refuses to apply', async () => {
    temp = await mkdtemp(join(tmpdir(), 'ekwo-assets-'));
    await copyAssets(temp);
    // It ships, because `ekwo demo` needs it; it is simply never applied by
    // `init` or `migrate`.
    expect(await sqlFiles(join(temp, 'seed'))).toContain(DEMO_SEED);
  });

  it('contain nothing from ee/', async () => {
    temp = await mkdtemp(join(tmpdir(), 'ekwo-assets-'));
    const copied = await copyAssets(temp);

    const eeMigrations = join(repoRoot, 'ee', 'supabase', 'migrations');
    const eeFiles = await readdir(eeMigrations).catch(() => [] as string[]);
    for (const file of eeFiles.filter((f) => f.endsWith('.sql'))) {
      expect(copied, 'an ee/ migration must never ship in the Community package').not.toContain(
        `migrations/${file}`,
      );
    }

    // And the runtime resolver never points there either.
    expect(migrationsDir(resolveBundleDir())).not.toContain(`${join('ee', 'supabase')}`);
  });
});

describe('the bundle resolver', () => {
  it('finds the repository folders when run from a checkout', async () => {
    const bundle = resolveBundleDir();
    expect(await stat(migrationsDir(bundle))).toBeTruthy();
    expect(await stat(seedDir(bundle))).toBeTruthy();
    expect(await sqlFiles(migrationsDir(bundle))).toEqual(await sqlFiles(migrationsPath));
  });
});

describe('package.json', () => {
  it('publishes the binary and the dist folder under the name ekwo', async () => {
    const manifest = JSON.parse(
      await readFile(join(repoRoot, 'packages', 'cli', 'package.json'), 'utf8'),
    ) as {
      name: string;
      bin: Record<string, string>;
      files: string[];
      type: string;
      dependencies: Record<string, string>;
    };

    expect(manifest.name).toBe('ekwo');
    expect(manifest.bin['ekwo']).toBe('./dist/bin.js');
    expect(manifest.files).toContain('dist');
    expect(manifest.type).toBe('module');
    // One runtime dependency, and it is the Postgres driver. Everything this
    // CLI is handed is a secret; every package added here could read it.
    expect(Object.keys(manifest.dependencies)).toEqual(['postgres']);
  });

  it('is a workspace of the repository', async () => {
    const root = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8')) as {
      workspaces: string[];
    };
    expect(root.workspaces).toContain('packages/*');
  });
});
