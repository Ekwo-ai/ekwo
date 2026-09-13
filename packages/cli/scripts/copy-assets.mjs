#!/usr/bin/env node
/**
 * Copies `supabase/migrations`, `supabase/seed` and `modules/` into the
 * published package.
 *
 * A user running `npx ekwo init` has no clone of the repository, so the SQL
 * has to travel inside the tarball. This runs at build time and is the only
 * thing that puts files under `dist/assets`.
 *
 * `supabase/seed` is copied whole, subdirectories included: `seed/modules/<code>/`
 * holds the country data a module's pack section compiles to, and it is applied
 * by the module migration runner rather than by the socle's seed step, which
 * reads a flat directory on purpose.
 *
 * `ee/supabase/migrations` is not copied. The commercial layer has its own
 * migrations and its own installer; a Community installation gets the core.
 *
 * Usage: node scripts/copy-assets.mjs <destination>
 */

import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = dirname(dirname(packageRoot));

/** The folders that ship, and where they come from. */
export const ASSET_FOLDERS = ['migrations', 'seed'];

/** Every `.sql` under `from`, recursively, written under `to`. */
async function copySql(from, to, prefix, copied) {
  await mkdir(to, { recursive: true });
  for (const name of (await readdir(from)).sort()) {
    const source = join(from, name);
    if ((await stat(source)).isDirectory()) {
      await copySql(source, join(to, name), `${prefix}${name}/`, copied);
      continue;
    }
    if (!name.endsWith('.sql')) continue;
    await cp(source, join(to, name));
    copied.push(`${prefix}${name}`);
  }
}

export async function copyAssets(destination) {
  const target = isAbsolute(destination) ? destination : resolve(packageRoot, destination);
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });

  const copied = [];
  for (const folder of ASSET_FOLDERS) {
    await copySql(join(repoRoot, 'supabase', folder), join(target, folder), `${folder}/`, copied);
  }

  // The modules: their manifest and their own migrations. `ekwo migrate`
  // applies them, so they have to travel with the CLI exactly as the socle's
  // do. Their tests and README stay in the repository.
  const modulesFrom = join(repoRoot, 'modules');
  for (const name of (await readdir(modulesFrom)).sort()) {
    if (name === 'schema') continue;
    const folder = join(modulesFrom, name);
    if (!(await stat(folder)).isDirectory()) continue;
    const to = join(target, 'modules', name);
    await mkdir(to, { recursive: true });
    await cp(join(folder, 'module.json'), join(to, 'module.json'));
    copied.push(`modules/${name}/module.json`);
    await copySql(
      join(folder, 'supabase', 'migrations'),
      join(to, 'supabase', 'migrations'),
      `modules/${name}/supabase/migrations/`,
      copied,
    );
  }
  await mkdir(join(target, 'modules', 'schema'), { recursive: true });
  await cp(join(modulesFrom, 'schema', 'module.1.json'), join(target, 'modules', 'schema', 'module.1.json'));
  copied.push('modules/schema/module.1.json');

  return copied;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const destination = process.argv[2] ?? 'dist/assets';
  const copied = await copyAssets(destination);
  console.log(`Copied ${copied.length} file(s) into ${destination}.`);
}
