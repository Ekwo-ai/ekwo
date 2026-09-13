/**
 * The modules this checkout — or this published package — carries.
 *
 * A module is a folder: a manifest, a `supabase/migrations/` of its own, a
 * README and its tests. There is no registry in code here either: the folders
 * are the list, `module.json` is what each one says about itself, and
 * `public.modules` is what the database holds once its migrations have run.
 *
 * Nothing in this file talks to a database. Reading and validating a manifest
 * is the same work whether the next step is `ekwo module list` in a checkout
 * or `ekwo migrate` against a Supabase project, so it is done once, here.
 */

import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMigrationFile, type Migration } from '../migrations.js';
import { validate } from '../pack/schema.js';

export class ModuleError extends Error {}

export interface ModuleMcp {
  prefix: string;
}

export interface ModulePack {
  /** `assets` → a country pack may carry `packs/<cc>/assets.json`. */
  section: string;
}

export interface ModuleManifest {
  code: string;
  name: string;
  description?: string;
  schema: string;
  version: string;
  status: 'draft' | 'available' | 'deprecated';
  requires_socle_min?: string;
  posts?: boolean;
  mcp?: ModuleMcp;
  pack?: ModulePack;
}

export interface EkwoModule {
  manifest: ModuleManifest;
  /** Absolute path of `modules/<code>/`. */
  dir: string;
  /** Its own migrations, in the order they must be applied. */
  migrations: Migration[];
}

/**
 * Where the modules live.
 *
 * Published package: `dist/assets/modules/`, put there at build time by
 * `scripts/copy-assets.mjs`, because `npx ekwo migrate` has no clone. Checkout:
 * `<repo>/modules/`. The two candidates mirror `resolveBundleDir()`.
 */
export function resolveModulesDir(): string | undefined {
  const candidates = [
    new URL('../assets/modules/', import.meta.url),
    new URL('../../../../modules/', import.meta.url),
  ];
  for (const candidate of candidates) {
    const dir = fileURLToPath(candidate).replace(/\/$/, '');
    if (existsSync(dir)) return dir;
  }
  return undefined;
}

/** `modules/schema/module.1.json`, the published shape of a manifest. */
export async function readModuleSchema(dir: string): Promise<Record<string, unknown>> {
  const path = join(dir, 'schema', 'module.1.json');
  const raw = await readFile(path, 'utf8').catch(() => {
    throw new ModuleError(`module_schema_missing: ${path}`);
  });
  return JSON.parse(raw) as Record<string, unknown>;
}

/** The module folders of `dir`, by code, in the order they are applied. */
export async function listModules(dir = resolveModulesDir()): Promise<EkwoModule[]> {
  if (dir === undefined) return [];
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const schema = await readModuleSchema(dir);
  const modules: EkwoModule[] = [];

  for (const entry of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || entry.name === 'schema') continue;
    const folder = join(dir, entry.name);
    if (!existsSync(join(folder, 'module.json'))) continue;
    modules.push(await readModule(entry.name, dir, schema));
  }
  return modules;
}

/** One module, with its manifest validated and its migrations listed. */
export async function readModule(
  code: string,
  dir = resolveModulesDir(),
  schema?: Record<string, unknown>,
): Promise<EkwoModule> {
  if (dir === undefined) throw new ModuleError('modules_missing: this installation carries no modules folder');
  const folder = join(dir, code);
  const manifestPath = join(folder, 'module.json');

  const raw = await readFile(manifestPath, 'utf8').catch(() => {
    throw new ModuleError(`unknown_module: ${manifestPath} does not exist`);
  });
  let manifest: ModuleManifest;
  try {
    manifest = JSON.parse(raw) as ModuleManifest;
  } catch (error) {
    throw new ModuleError(`module_manifest_invalid: ${code}/module.json — ${(error as Error).message}`);
  }

  const issues = validate(manifest, schema ?? (await readModuleSchema(dir)));
  if (issues.length > 0) {
    throw new ModuleError(
      `module_manifest_invalid: ${code}/module.json\n` +
        issues.map((issue) => `  ${issue.path}: ${issue.message}`).join('\n'),
    );
  }
  if (manifest.code !== code) {
    throw new ModuleError(
      `module_code_mismatch: modules/${code}/module.json calls itself "${manifest.code}"`,
    );
  }

  return { manifest, dir: folder, migrations: await moduleMigrations(manifest, folder) };
}

/**
 * A module's migrations, recorded under the same history the socle uses.
 *
 * `version` stays the plain timestamp, because that is the column Supabase
 * keys its history on and the whole point of that choice is that `ekwo
 * migrate` and `supabase db push` read and write the same table. What carries
 * the module is `name`: `assets/initial` rather than `initial`, so a human
 * reading `supabase migration list` sees which module a version belongs to.
 *
 * The consequence, which is a rule and a test: a module's timestamps sort
 * after every socle migration it depends on, and no two migrations anywhere in
 * this repository share a version.
 */
export async function moduleMigrations(
  manifest: ModuleManifest,
  folder: string,
): Promise<Migration[]> {
  const dir = join(folder, 'supabase', 'migrations');
  if (!existsSync(dir)) return [];
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  return files.map((file) => {
    const parsed = parseMigrationFile(file);
    if (parsed === undefined) {
      throw new ModuleError(
        `migration_name_invalid: modules/${manifest.code}/supabase/migrations/${file} — expected YYYYMMDDHHMMSS_subject.sql`,
      );
    }
    return {
      version: parsed.version,
      name: `${manifest.code}/${parsed.name}`,
      file: parsed.file,
      path: join(dir, file),
    };
  });
}

/**
 * Every module migration, in one list, ordered by version.
 *
 * Concatenated with the socle's and sorted, this is what `ekwo migrate`
 * applies. A duplicate version is a bug in whoever wrote the second one and is
 * refused here rather than silently dropping a file, which is exactly what the
 * Supabase history does when two files share a timestamp prefix.
 */
export function allModuleMigrations(modules: readonly EkwoModule[]): Migration[] {
  const seen = new Map<string, string>();
  const all: Migration[] = [];
  for (const module of modules) {
    for (const migration of module.migrations) {
      const previous = seen.get(migration.version);
      if (previous !== undefined) {
        throw new ModuleError(
          `migration_version_duplicate: ${migration.version} is used by ${previous} and by ${migration.name}`,
        );
      }
      seen.set(migration.version, migration.name);
      all.push(migration);
    }
  }
  return all.sort((a, b) => a.version.localeCompare(b.version));
}

/**
 * The seeds compiled from the `<section>.json` of a country pack, for one
 * module: `supabase/seed/modules/<code>/*.sql`.
 *
 * They are not reference data of the socle and are deliberately not in
 * `supabase/seed/` itself, where `ekwo migrate` and the test harness read a
 * flat directory: a module's country data has no business landing on an
 * installation that does not carry the module.
 */
export async function moduleSeeds(code: string, seedDir: string): Promise<string[]> {
  const dir = join(seedDir, 'modules', code);
  if (!existsSync(dir)) return [];
  return (await readdir(dir))
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((file) => join(dir, file));
}

/** The line an operator has to add by hand, because no migration can. */
export function exposeSchemaNote(schemaName: string): string[] {
  return [
    `PostgREST does not serve \`${schemaName}\` until the project exposes it.`,
    `  Supabase dashboard → Project Settings → API → Exposed schemas: add \`${schemaName}\`.`,
    `  Self-hosted: add it to \`[api] schemas\` in supabase/config.toml and restart.`,
    'No migration can do this: it is a setting of the API, not of the database.',
  ];
}
