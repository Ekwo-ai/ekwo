#!/usr/bin/env node
/**
 * Copies `supabase/migrations` and `supabase/seed` into the published package.
 *
 * A user running `npx ekwo init` has no clone of the repository, so the SQL
 * has to travel inside the tarball. This runs at build time and is the only
 * thing that puts files under `dist/assets`.
 *
 * `ee/supabase/migrations` is not copied. The commercial layer has its own
 * migrations and its own installer; a Community installation gets the core.
 *
 * Usage: node scripts/copy-assets.mjs <destination>
 */

import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = dirname(dirname(packageRoot));

/** The folders that ship, and where they come from. */
export const ASSET_FOLDERS = ['migrations', 'seed'];

export async function copyAssets(destination) {
  const target = isAbsolute(destination) ? destination : resolve(packageRoot, destination);
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });

  const copied = [];
  for (const folder of ASSET_FOLDERS) {
    const from = join(repoRoot, 'supabase', folder);
    const to = join(target, folder);
    await mkdir(to, { recursive: true });
    for (const name of (await readdir(from)).sort()) {
      if (!name.endsWith('.sql')) continue;
      await cp(join(from, name), join(to, name));
      copied.push(`${folder}/${name}`);
    }
  }
  return copied;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const destination = process.argv[2] ?? 'dist/assets';
  const copied = await copyAssets(destination);
  console.log(`Copied ${copied.length} SQL file(s) into ${destination}.`);
}
