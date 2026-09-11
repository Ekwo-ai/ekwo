/**
 * Where the SQL lives.
 *
 * The published npm package carries its own copy of `supabase/migrations`
 * and `supabase/seed` under `dist/assets`, copied at build time by
 * `scripts/copy-assets.mjs`. A user running `npx ekwo init` has no clone of
 * the repository, so the schema has to travel with the CLI.
 *
 * When the CLI runs from a checkout instead (`node packages/cli/src/...` or
 * the tests), `dist/assets` does not exist and the repository's own
 * `supabase/` folder is used. Both layouts sit at the same depth relative to
 * this file, which is why the fallback is a fixed path and not a search.
 *
 * `ee/supabase/migrations` is never one of the candidates. The commercial
 * layer has its own migrations and its own installer; a Community
 * installation gets the core and nothing else.
 */

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Directory holding `migrations/` and `seed/`, whichever layout we are in. */
export function resolveBundleDir(): string {
  const candidates = [
    // Published package: packages/cli/dist/bundle.js → dist/assets/
    new URL('./assets/', import.meta.url),
    // Checkout: packages/cli/{src,dist}/bundle.* → <repo>/supabase/
    new URL('../../../supabase/', import.meta.url),
  ];

  for (const candidate of candidates) {
    const dir = fileURLToPath(candidate);
    if (existsSync(`${dir}migrations`)) return dir.replace(/\/$/, '');
  }

  throw new Error(
    'bundle_missing: neither dist/assets nor supabase/ was found next to the CLI. ' +
      'Reinstall the package, or run `npm run build` in a checkout.',
  );
}

export function migrationsDir(bundle = resolveBundleDir()): string {
  return `${bundle}/migrations`;
}

export function seedDir(bundle = resolveBundleDir()): string {
  return `${bundle}/seed`;
}

/**
 * The demo company. Never applied by `init` unless `--demo` is passed, and
 * never by `ekwo migrate`: it is sample data, not reference data.
 */
export const DEMO_SEED = '90_demo_company.sql';
