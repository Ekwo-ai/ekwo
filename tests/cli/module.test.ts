/**
 * The module half of the installer.
 *
 * What matters here is the same thing as for the socle's runner: that the
 * modules are applied in the right order, recorded the way the Supabase CLI
 * records anything else, do nothing the second time, and can be left out when
 * the operator is about to reach for `supabase db push`.
 */

import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  applyMigrations,
  listMigrations,
  ModuleError,
  allModuleMigrations,
  listModules,
  moduleSeeds,
  exposeSchemaNote,
  readModule,
  resolveModulesDir,
} from '../../packages/cli/src/index.js';
import { repoRoot } from '../helpers/db.js';
import { emptyDatabase, migrationsPath, seedPath } from './helpers.js';

const modulesDir = join(repoRoot, 'modules');

describe('reading the modules of a checkout', () => {
  it('finds them, validates each manifest and lists its migrations', async () => {
    const modules = await listModules(modulesDir);
    expect(modules.map((m) => m.manifest.code)).toEqual(['assets', 'budgets']);
    for (const module of modules) {
      expect(module.migrations.length).toBeGreaterThan(0);
      expect(module.manifest.schema).toBe(module.manifest.code);
    }
  });

  it('resolves the folder from a checkout without being told where it is', () => {
    expect(resolveModulesDir()).toBe(modulesDir);
  });

  it('refuses a module that is not there, by name', async () => {
    await expect(readModule('carbon', modulesDir)).rejects.toThrow(ModuleError);
    await expect(readModule('carbon', modulesDir)).rejects.toThrow(/unknown_module/);
  });

  it('records a migration under the module, and keeps the timestamp as the version', async () => {
    const migrations = allModuleMigrations(await listModules(modulesDir));
    expect(migrations.length).toBeGreaterThan(0);
    for (const migration of migrations) {
      expect(migration.name).toMatch(/^[a-z]+\/[a-z0-9_]+$/);
      expect(migration.version).toMatch(/^\d{14}$/);
    }
    // Ordered globally: they share one history with the socle.
    const versions = migrations.map((m) => m.version);
    expect([...versions].sort()).toEqual(versions);
  });

  it('refuses two modules that claim the same version', () => {
    const fake = [
      {
        manifest: { code: 'a', name: 'A', schema: 'a', version: '1.0.0', status: 'available' as const },
        dir: '',
        migrations: [{ version: '20260913090000', name: 'a/one', file: 'x.sql', path: 'x' }],
      },
      {
        manifest: { code: 'b', name: 'B', schema: 'b', version: '1.0.0', status: 'available' as const },
        dir: '',
        migrations: [{ version: '20260913090000', name: 'b/one', file: 'y.sql', path: 'y' }],
      },
    ];
    expect(() => allModuleMigrations(fake)).toThrow(/migration_version_duplicate/);
  });
});

describe('applying them', () => {
  it('installs the socle, then the modules, and records both in one history', async () => {
    const { db } = await emptyDatabase();
    try {
      const socle = await listMigrations(migrationsPath);
      const modules = await listModules(modulesDir);
      const all = [...socle, ...allModuleMigrations(modules)];

      const first = await applyMigrations(db, all);
      expect(first.applied.length).toBe(all.length);

      const history = await db.query<{ version: string; name: string }>(
        `select version, name from supabase_migrations.schema_migrations order by version`,
      );
      expect(history.length).toBe(all.length);
      // Every module migration of this checkout, recorded under its module —
      // derived rather than written down, so a module gaining a second
      // migration does not make this the test that has to be edited.
      expect(history.filter((row) => row.name.includes('/')).map((row) => row.name).sort()).toEqual(
        allModuleMigrations(modules)
          .map((migration) => migration.name)
          .sort(),
      );

      // The registry the modules wrote for themselves.
      const registry = await db.query<{ code: string }>(`select code from modules order by code`);
      expect(registry.map((row) => row.code)).toEqual(['assets', 'budgets']);

      // And nothing at all the second time.
      const again = await applyMigrations(db, all);
      expect(again.applied).toEqual([]);
    } finally {
      await db.close();
    }
  });

  it('leaves the modules out when the operator asks, so `supabase db push` sees its own files', async () => {
    const { db } = await emptyDatabase();
    try {
      const socle = await listMigrations(migrationsPath);
      await applyMigrations(db, socle);
      const schemas = await db.query<{ nspname: string }>(
        `select nspname from pg_namespace where nspname in ('assets', 'budgets')`,
      );
      expect(schemas).toEqual([]);
      const registry = await db.query<{ code: string }>(`select code from modules`);
      expect(registry).toEqual([]);
    } finally {
      await db.close();
    }
  });
});

describe('the country data of a module', () => {
  it('is a seed of its own, under the module, and not in the flat seed folder', async () => {
    const seeds = await moduleSeeds('assets', seedPath);
    expect(seeds.map((path) => path.slice(seedPath.length + 1))).toEqual([
      'modules/assets/10_pack_be.sql',
      'modules/assets/11_pack_fr.sql',
    ]);
    expect(await moduleSeeds('budgets', seedPath)).toEqual([]);
  });
});

describe('what the CLI cannot do', () => {
  it('says which setting exposes a module schema, because no migration can', () => {
    const note = exposeSchemaNote('assets').join(' ');
    expect(note).toMatch(/Exposed schemas/);
    expect(note).toMatch(/\[api\] schemas/);
    expect(note).toMatch(/assets/);
  });
});
