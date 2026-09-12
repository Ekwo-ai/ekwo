/**
 * The migration runner.
 *
 * What matters here is not that the schema works — the other test files prove
 * that — but that the installer applies it in the right order, records it the
 * way the Supabase CLI does, does nothing the second time, and leaves a
 * database it can resume from when a migration fails halfway.
 */

import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  appliedVersions,
  applyMigrations,
  listMigrations,
  migrationGap,
  parseMigrationFile,
  splitStatements,
} from '../../packages/cli/src/index.js';
import { emptyDatabase, migrationsPath } from './helpers.js';

const opened: { close: () => Promise<void> }[] = [];

async function open(): Promise<Awaited<ReturnType<typeof emptyDatabase>>['db']> {
  const { db } = await emptyDatabase();
  opened.push(db);
  return db;
}

afterEach(async () => {
  while (opened.length > 0) {
    const db = opened.pop();
    await db?.close().catch(() => {});
  }
});

describe('reading the migrations', () => {
  it('parses a filename into the version and the name the Supabase CLI stores', () => {
    expect(parseMigrationFile('20260911120000_core_companies.sql')).toEqual({
      version: '20260911120000',
      name: 'core_companies',
      file: '20260911120000_core_companies.sql',
    });
  });

  it('refuses a filename that is not a timestamped migration', () => {
    expect(parseMigrationFile('core_companies.sql')).toBeUndefined();
    expect(parseMigrationFile('2026_core.sql')).toBeUndefined();
  });

  it('lists them in the order they must run', async () => {
    const migrations = await listMigrations(migrationsPath);
    expect(migrations.length).toBeGreaterThanOrEqual(16);
    const versions = migrations.map((m) => m.version);
    expect([...versions].sort()).toEqual(versions);
  });
});

describe('applying them', () => {
  it('installs the whole schema and records it in the Supabase history table', async () => {
    const db = await open();
    const migrations = await listMigrations(migrationsPath);

    const result = await applyMigrations(db, migrations);
    expect(result.applied).toHaveLength(migrations.length);
    expect(result.alreadyApplied).toBe(0);

    // The history is the Supabase one, not one of our own.
    const columns = await db.query<{ column_name: string; data_type: string }>(
      `select column_name, data_type from information_schema.columns
        where table_schema = 'supabase_migrations' and table_name = 'schema_migrations'
        order by column_name`,
    );
    expect(columns.map((c) => c.column_name)).toEqual(['name', 'statements', 'version']);
    expect(columns.find((c) => c.column_name === 'statements')?.data_type).toBe('ARRAY');

    const rows = await db.query<{ version: string; name: string; statements: string[] }>(
      'select version, name, statements from supabase_migrations.schema_migrations order by version',
    );
    expect(rows.map((r) => r.version)).toEqual(migrations.map((m) => m.version));
    expect(rows.map((r) => r.name)).toEqual(migrations.map((m) => m.name));
    for (const row of rows) expect(row.statements.length).toBeGreaterThan(0);

    // And the schema really is there.
    const tables = await db.query<{ count: string }>(
      `select count(*)::text from information_schema.tables where table_schema = 'public'`,
    );
    expect(Number(tables[0]?.count)).toBeGreaterThanOrEqual(32);
  });

  it('does nothing the second time', async () => {
    const db = await open();
    const migrations = await listMigrations(migrationsPath);
    await applyMigrations(db, migrations);

    const second = await applyMigrations(db, migrations);
    expect(second.applied).toHaveLength(0);
    expect(second.alreadyApplied).toBe(migrations.length);

    const gap = await migrationGap(db, migrations);
    expect(gap.pending).toHaveLength(0);
    expect(gap.unknown).toHaveLength(0);
  });

  it('reports a database that is ahead of the CLI', async () => {
    const db = await open();
    const migrations = await listMigrations(migrationsPath);
    await applyMigrations(db, migrations);
    await db.query(
      `insert into supabase_migrations.schema_migrations (version, name) values ('20991231235959', 'from_the_future')`,
    );

    const gap = await migrationGap(db, migrations);
    expect(gap.unknown).toEqual(['20991231235959']);
    expect(gap.pending).toHaveLength(0);
  });
});

describe('a migration that fails halfway', () => {
  let dir: string | undefined;

  afterEach(async () => {
    if (dir !== undefined) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('rolls its own file back, records nothing, and resumes on the next run', async () => {
    dir = await mkdtemp(join(tmpdir(), 'ekwo-migrations-'));
    await writeFile(join(dir, '20260101000000_first.sql'), 'create table first_table (id int);');
    await writeFile(
      join(dir, '20260101000100_broken.sql'),
      `create table broken_table (id int);
       create table broken_table (id int);`, // the second one raises
    );
    await writeFile(join(dir, '20260101000200_third.sql'), 'create table third_table (id int);');

    const db = await open();
    const migrations = await listMigrations(dir);

    await expect(applyMigrations(db, migrations)).rejects.toThrow(/already exists/i);

    // The first landed and is recorded; the broken one left nothing behind.
    expect(await appliedVersions(db)).toEqual(['20260101000000']);
    const tables = await db.query<{ table_name: string }>(
      `select table_name from information_schema.tables
        where table_schema = 'public' order by table_name`,
    );
    expect(tables.map((t) => t.table_name)).toEqual(['first_table']);

    // Fix it, run again: it picks up where it stopped.
    await writeFile(join(dir, '20260101000100_broken.sql'), 'create table broken_table (id int);');
    const result = await applyMigrations(db, await listMigrations(dir));
    expect(result.applied.map((m) => m.version)).toEqual(['20260101000100', '20260101000200']);
    expect(await appliedVersions(db)).toEqual([
      '20260101000000',
      '20260101000100',
      '20260101000200',
    ]);
  });
});

describe('splitting a file into statements', () => {
  it('leaves a dollar-quoted function body alone', () => {
    const sql = `
      create function f() returns int language sql as $$
        select 1; select 2;
      $$;
      create table t (id int);
    `;
    const statements = splitStatements(sql);
    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain('select 1; select 2;');
    expect(statements[1]).toBe('create table t (id int);');
  });

  it('ignores semicolons inside literals, identifiers and comments', () => {
    const sql = `
      -- a comment; with a semicolon
      insert into t (a, b) values ('one; two', 'it''s fine');
      /* block; comment */
      select "odd;name" from t;
    `;
    const statements = splitStatements(sql);
    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain("'one; two'");
    expect(statements[1]).toContain('"odd;name"');
  });

  it('handles a tagged dollar quote', () => {
    const statements = splitStatements(`do $body$ begin raise notice 'x;y'; end $body$;`);
    expect(statements).toHaveLength(1);
  });

  it('splits every real migration into the statements it holds, losing nothing', async () => {
    const files = (await readdir(migrationsPath)).filter((f) => f.endsWith('.sql'));
    let multiStatement = 0;
    for (const file of files) {
      const sql = await readFile(join(migrationsPath, file), 'utf8');
      const statements = splitStatements(sql);
      // One statement is a real migration — `20260912081015` is a single
      // update, because a new enum value cannot be used in the transaction
      // that added it and the two had to be separate files. What would be
      // wrong is zero, or the whole file handed back as one blob when it
      // holds several statements, which the round trip below catches.
      expect(statements.length, file).toBeGreaterThan(0);
      if (statements.length > 1) multiStatement += 1;
      // Nothing is lost: the statements put back together are the file again,
      // give or take the whitespace between them.
      const rejoined = statements.join('\n').replace(/\s+/g, ' ').trim();
      const original = sql.replace(/\s+/g, ' ').trim().replace(/;?$/, ';');
      expect(rejoined.replace(/;?$/, ';'), file).toBe(original);
    }
    // And the splitter does split: almost every migration holds several.
    expect(multiStatement).toBeGreaterThan(files.length - 3);
  });
});
