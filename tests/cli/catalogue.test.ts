/**
 * `ekwo doctor` against the inventory of what a release defines.
 *
 * The inventory is generated from the migrations, so the fixture here is the
 * real one: the same migrations, applied by the CLI's own runner, compared to
 * the file the repository commits. A test that built its own expectation would
 * prove the comparison and not the inventory.
 *
 * Each case breaks exactly one thing, and checks both what is said and how
 * severely — missing is a fault, an operator's own table is information, and a
 * policy is a fault either way round.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  applyMigrations,
  applyModuleMigrations,
  applySeeds,
  compareCatalogue,
  doctor,
  listMigrations,
  listModules,
  readExpectedObjects,
  resolveInventoryPath,
  type ExpectedObjects,
  type Migration,
  type SqlClient,
} from '../../packages/cli/src/index.js';
import { emptyDatabase, migrationsPath, seedPath } from './helpers.js';

let db: SqlClient;
let migrations: Migration[];
let expected: ExpectedObjects;

beforeEach(async () => {
  ({ db } = await emptyDatabase());
  migrations = await listMigrations(migrationsPath);
  await applyMigrations(db, migrations);
  await applySeeds(db, seedPath);
  const inventory = await readExpectedObjects();
  if (inventory === undefined) throw new Error('this checkout ships no inventory');
  expected = inventory;
});

afterEach(async () => {
  await db.close().catch(() => {});
});

/** A policy of the socle, whichever one the migrations happen to write first. */
async function anyPolicy(): Promise<{ table: string; name: string }> {
  const rows = await db.query<{ table: string; name: string }>(
    `select c.relname as table, p.polname as name
       from pg_policy p
       join pg_class c on c.oid = p.polrelid
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
      order by c.relname, p.polname
      limit 1`,
  );
  const policy = rows[0];
  if (policy === undefined) throw new Error('the socle has no policy at all');
  return policy;
}

describe('the inventory', () => {
  it('is shipped by this checkout and describes a schema version', () => {
    expect(resolveInventoryPath()).toMatch(/packages\/cli\/assets\/expected-objects\.json$/);
    expect(expected.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(expected.migration).toMatch(/^\d{14}$/);
    expect(expected.socle.tables.length).toBeGreaterThan(30);
    expect(expected.modules.map((m) => m.code)).toEqual(['assets', 'budgets']);
  });

  it('holds no object twice, so a key identifies one thing', () => {
    const keys = expected.socle.functions.map((f) => `${f.name}(${f.arguments})`);
    expect(new Set(keys).size).toBe(keys.length);
    const tables = expected.socle.tables.map((t) => t.name);
    expect(new Set(tables).size).toBe(tables.length);
  });
});

describe('a database at head', () => {
  it('is missing nothing and carries nothing extra', async () => {
    const comparison = await compareCatalogue(db, expected);
    expect(comparison.missing, JSON.stringify(comparison.sections, null, 2)).toBe(0);
    expect(comparison.extra, JSON.stringify(comparison.sections, null, 2)).toBe(0);
    expect(comparison.changed).toBe(0);
    expect(comparison.policyFaults).toBe(0);
    expect(comparison.databaseVersion).toBe(comparison.expectedVersion);
  });

  it('passes the doctor, which runs the check between the migrations and the rest', async () => {
    const report = await doctor(db, migrations, { expected });
    const check = report.checks.find((c) => c.name === 'catalogue');
    expect(check?.severity, JSON.stringify(check, null, 2)).toBe('ok');
    expect(check?.summary).toContain('every object this release defines is there');
    expect(report.checks.map((c) => c.name)[1]).toBe('catalogue');
    expect(report.problems).toBe(0);
  });
});

describe('what the comparison reports', () => {
  it('calls a dropped policy a problem, and names it', async () => {
    const policy = await anyPolicy();
    await db.exec(`drop policy "${policy.name}" on public."${policy.table}";`);

    const report = await doctor(db, migrations, { expected });
    const check = report.checks.find((c) => c.name === 'catalogue');
    expect(check?.severity).toBe('problem');
    expect(check?.details).toContain(`missing policy ${policy.table}.${policy.name}`);
    expect(report.problems).toBeGreaterThan(0);
  });

  it('calls a policy nobody reviewed a problem too, because that is the security model', async () => {
    await db.exec(`create policy "invented" on public.accounts for select using (true);`);

    const comparison = await compareCatalogue(db, expected);
    expect(comparison.policyFaults).toBe(1);
    const socle = comparison.sections.find((s) => s.code === 'socle');
    expect(socle?.policies.extra).toEqual(['accounts.invented']);

    const report = await doctor(db, migrations, { expected });
    const check = report.checks.find((c) => c.name === 'catalogue');
    expect(check?.severity).toBe('problem');
    expect(check?.details).toContain('extra policy accounts.invented');
  });

  it("calls an operator's own table information, and never a failure", async () => {
    await db.exec(`
      create table public.our_own_thing (id uuid primary key);
      alter table public.our_own_thing enable row level security;
      create policy our_own_thing_select on public.our_own_thing for select using (true);
    `);

    const comparison = await compareCatalogue(db, expected);
    expect(comparison.missing).toBe(0);
    expect(comparison.extra).toBe(1);
    // The policy on it is not counted: that table is not this schema's, and
    // what protects it is the operator's decision.
    expect(comparison.policyFaults).toBe(0);

    const report = await doctor(db, migrations, { expected });
    const check = report.checks.find((c) => c.name === 'catalogue');
    expect(check?.severity).toBe('warning');
    expect(check?.details).toContain('extra table our_own_thing');
    expect(report.problems).toBe(0);
  });

  it('names a function that is gone by the signature that makes it that one', async () => {
    // An overload, deliberately: the name alone would say both are missing,
    // or neither. The key is the name and the identity arguments together.
    const gone = 'resolve_line_account(p_company_id uuid, p_doc_type doc_type, p_account_id uuid)';
    const kept = 'resolve_line_account(p_company_id uuid, p_doc_type doc_type, p_product_id uuid, p_account_id uuid)';
    expect(expected.socle.functions.map((f) => `${f.name}(${f.arguments})`)).toEqual(
      expect.arrayContaining([gone, kept]),
    );
    await db.exec(`drop function public.${gone};`);

    const comparison = await compareCatalogue(db, expected);
    const socle = comparison.sections.find((s) => s.code === 'socle');
    expect(socle?.functions.missing).toEqual([gone]);
    expect(socle?.functions.extra).toEqual([]);
  });

  it('names a column whose type has moved, and does not call it missing', async () => {
    await db.exec('alter table public.accounts alter column name type varchar(120);');
    const comparison = await compareCatalogue(db, expected);
    const socle = comparison.sections.find((s) => s.code === 'socle');
    expect(socle?.columns.missing).toEqual([]);
    expect(socle?.columns.changed).toEqual(['accounts.name is character varying(120), expected text']);
    expect(comparison.changed).toBe(1);
  });

  it('says a missing table once, rather than once per column it took with it', async () => {
    await db.exec('drop table public.audit_log cascade;');
    const comparison = await compareCatalogue(db, expected);
    const socle = comparison.sections.find((s) => s.code === 'socle');
    expect(socle?.tables.missing).toContain('audit_log');
    expect(socle?.columns.missing.filter((c) => c.startsWith('audit_log.'))).toEqual([]);
    expect(socle?.policies.missing.filter((p) => p.startsWith('audit_log.'))).toEqual([]);
  });
});

describe('the schema version the database reports', () => {
  it('never gates the comparison: an older installation is compared and told', async () => {
    const older: ExpectedObjects = { ...expected, schemaVersion: '99.0.0' };
    const report = await doctor(db, migrations, { expected: older });
    const check = report.checks.find((c) => c.name === 'catalogue');
    expect(check?.severity).toBe('ok');
    expect(check?.details?.[0]).toContain('the inventory describes schema 99.0.0');
    expect(check?.details?.[0]).toContain(`the database reports ${expected.schemaVersion}`);
    expect(check?.details?.[0]).toContain('compared anyway');
  });
});

describe('the modules', () => {
  it('are not required by a database that does not carry them', async () => {
    const comparison = await compareCatalogue(db, expected);
    for (const code of ['assets', 'budgets']) {
      const section = comparison.sections.find((s) => s.code === code);
      expect(section?.installed).toBe(false);
      expect(section?.tables.missing).toEqual([]);
    }
    expect(comparison.missing).toBe(0);

    const report = await doctor(db, migrations, { expected });
    const check = report.checks.find((c) => c.name === 'catalogue');
    expect(check?.severity).toBe('ok');
    expect(check?.details).toContain('assets is not installed here, so none of its objects are required');
  });

  it('are compared, and clean, once their migrations have run', async () => {
    await applyModuleMigrations(db, await listModules());
    const comparison = await compareCatalogue(db, expected);
    for (const code of ['assets', 'budgets']) {
      const section = comparison.sections.find((s) => s.code === code);
      expect(section?.installed).toBe(true);
      expect(section?.tables.missing, JSON.stringify(section, null, 2)).toEqual([]);
    }
    expect(comparison.missing).toBe(0);
    expect(comparison.extra).toBe(0);
  });

  it('are required once carried: a table dropped from a module schema is named', async () => {
    await applyModuleMigrations(db, await listModules());
    const first = expected.modules[0];
    if (first === undefined) throw new Error('this release carries no module');
    const table = first.tables[0];
    if (table === undefined) throw new Error(`module ${first.code} defines no table`);
    await db.exec(`drop table ${first.schema}."${table.name}" cascade;`);

    const report = await doctor(db, migrations, { expected });
    const check = report.checks.find((c) => c.name === 'catalogue');
    expect(check?.severity).toBe('problem');
    expect(check?.details).toContain(`${first.code}: missing table ${table.name}`);
  });
});

describe('the shape a machine reads', () => {
  it('carries the whole comparison under the check, and survives a JSON round trip', async () => {
    await db.exec('create table public.stray (id uuid primary key);');
    const report = await doctor(db, migrations, { expected });
    const parsed = JSON.parse(JSON.stringify(report)) as {
      checks: { name: string; severity: string; data?: Record<string, unknown> }[];
      problems: number;
      warnings: number;
    };

    const check = parsed.checks.find((c) => c.name === 'catalogue');
    expect(check?.data).toBeDefined();
    expect(Object.keys(check?.data ?? {}).sort()).toEqual([
      'changed',
      'databaseVersion',
      'expectedVersion',
      'extra',
      'missing',
      'policyFaults',
      'sections',
    ]);

    const sections = (check?.data as { sections: Record<string, unknown>[] }).sections;
    expect(sections.map((s) => s['code'])).toEqual(['socle', 'assets', 'budgets']);
    expect(Object.keys(sections[0] ?? {}).sort()).toEqual([
      'code',
      'columns',
      'functions',
      'installed',
      'policies',
      'schema',
      'tables',
      'triggers',
      'types',
      'views',
    ]);
    expect(sections[0]?.['tables']).toEqual({ missing: [], extra: ['stray'], changed: [] });
  });
});
