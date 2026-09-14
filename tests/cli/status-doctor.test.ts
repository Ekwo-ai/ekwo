/**
 * `ekwo status` and `ekwo doctor`, against a real installed schema.
 *
 * The doctor's job is to notice what the database cannot refuse on its own.
 * Each test breaks exactly one of those things and checks it is named.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  applyMigrations,
  applySeeds,
  bootstrap,
  doctor,
  listMigrations,
  status,
  syncSchemaVersion,
  type Migration,
  type SqlClient,
} from '../../packages/cli/src/index.js';
import { emptyDatabase, makeAuthUser, migrationsPath, seedPath } from './helpers.js';

let db: SqlClient;
let migrations: Migration[];
let userId: string;
let companyId: string;

beforeEach(async () => {
  ({ db } = await emptyDatabase());
  migrations = await listMigrations(migrationsPath);
  await applyMigrations(db, migrations);
  await applySeeds(db, seedPath);
  userId = await makeAuthUser(db, 'first@example.test');
  const result = await bootstrap(db, {
    organization: 'Example Group',
    country: 'BE',
    company: 'Example One',
    fiscalYear: 2026,
    adminUserId: userId,
    bankAccount: { iban: 'BE71 0961 2345 6769', bic: 'GKCCBEBB', bankName: 'Banque Exemple' },
  });
  companyId = result.companyId;
});

afterEach(async () => {
  await db.close().catch(() => {});
});

describe('status', () => {
  it('reports the versions, the instance and the companies', async () => {
    await syncSchemaVersion(db);
    const report = await status(db, migrations);

    expect(report.schemaInstalled).toBe(true);
    expect(report.pending).toHaveLength(0);
    expect(report.unknown).toHaveLength(0);
    expect(report.appliedCount).toBe(migrations.length);
    expect(report.installedVersion).toBe(report.availableVersion);
    expect(report.admins).toBe(1);
    expect(report.instance?.organization_name).toBe('Example Group');
    expect(report.instance?.registered_at).toBeNull();

    expect(report.companies).toHaveLength(1);
    expect(report.companies[0]?.name).toBe('Example One');
    expect(report.companies[0]?.country).toBe('BE');
    expect(report.companies[0]?.accounts).toBeGreaterThan(300);
    expect(report.companies[0]?.fiscalYears).toBe(1);
    // A fresh installation has nothing closed; `close_fiscal_year` is the
    // only thing that changes this number.
    expect(report.companies[0]?.closedFiscalYears).toBe(0);
  });

  it('shows the gap when a migration has not been applied', async () => {
    await db.query(
      'delete from supabase_migrations.schema_migrations where version = $1',
      [migrations[migrations.length - 1]?.version],
    );
    const report = await status(db, migrations);
    expect(report.pending).toHaveLength(1);
  });

  it('says so when nothing is installed at all', async () => {
    const { db: fresh } = await emptyDatabase();
    try {
      const report = await status(fresh, migrations);
      expect(report.schemaInstalled).toBe(false);
      expect(report.pending).toHaveLength(migrations.length);
    } finally {
      await fresh.close();
    }
  });
});

describe('doctor', () => {
  it('finds nothing wrong with a fresh installation', async () => {
    const report = await doctor(db, migrations);
    expect(report.problems, JSON.stringify(report.checks, null, 2)).toBe(0);
    expect(report.warnings, JSON.stringify(report.checks, null, 2)).toBe(0);
    expect(report.checks.map((c) => c.name)).toEqual([
      'migrations',
      'row level security',
      'policies',
      'company members',
      'instance administrators',
      'bank accounts',
      'bank statements',
      'posted entries',
      'audit trail',
    ]);
  });

  it('warns about a company with no bank account, and never fails on it', async () => {
    await db.query('delete from bank_accounts where company_id = $1', [companyId]);
    const report = await doctor(db, migrations);
    const check = report.checks.find((c) => c.name === 'bank accounts');
    expect(check?.severity).toBe('warning');
    expect(check?.details).toContain('Example One');
    // A company without a bank account is incomplete, not broken: `ekwo doctor`
    // exits 1 on a problem and 0 on warnings, and this must stay on the 0 side.
    expect(report.problems).toBe(0);
    expect(report.warnings).toBeGreaterThan(0);
  });

  it('names a table that was added without row level security', async () => {
    await db.exec('create table forgotten (id uuid primary key, company_id uuid);');
    const report = await doctor(db, migrations);
    const check = report.checks.find((c) => c.name === 'row level security');
    expect(check?.severity).toBe('problem');
    expect(check?.details).toContain('forgotten');
    expect(report.problems).toBeGreaterThan(0);
  });

  it('names a table protected by row level security and no policy', async () => {
    await db.exec(`
      create table locked_out (id uuid primary key);
      alter table locked_out enable row level security;
    `);
    const report = await doctor(db, migrations);
    const check = report.checks.find((c) => c.name === 'policies');
    expect(check?.severity).toBe('problem');
    expect(check?.details).toContain('locked_out');
  });

  it('names a membership whose user has been deleted', async () => {
    // company_members has no foreign key to auth.users on purpose: inviting
    // someone before they have an account is a normal thing to want. This is
    // where that choice is paid for, and it is a warning, not a failure.
    const ghost = await makeAuthUser(db, 'ghost@example.test');
    await db.query('insert into company_members (company_id, user_id, role) values ($1, $2, $3)', [
      companyId,
      ghost,
      'accountant',
    ]);
    await db.query('delete from auth.users where id = $1', [ghost]);

    const report = await doctor(db, migrations);
    const check = report.checks.find((c) => c.name === 'company members');
    expect(check?.severity).toBe('warning');
    expect(check?.summary).toContain('1 membership row');
    expect(check?.details?.[0]).toContain(ghost);
    expect(report.problems).toBe(0);
  });

  it('names a migration that has not been applied', async () => {
    await db.query('delete from supabase_migrations.schema_migrations where version = $1', [
      migrations[0]?.version,
    ]);
    const report = await doctor(db, migrations);
    const check = report.checks.find((c) => c.name === 'migrations');
    expect(check?.severity).toBe('problem');
    expect(check?.details?.[0]).toBe(migrations[0]?.file);
  });

  it('names a bank statement that does not tie to its lines', async () => {
    const account = await db.query<{ id: string }>(
      `insert into bank_accounts (company_id, name, iban, currency_code)
       values ($1, 'Current', 'BE68539007547034', 'EUR') returning id`,
      [companyId],
    );
    await db.query(
      `insert into bank_statements (company_id, bank_account_id, statement_date,
                                    balance_start, balance_end_declared, balance_end_computed)
       values ($1, $2, date '2026-03-31', 0, 1000, 900)`,
      [companyId, account[0]?.id],
    );

    const report = await doctor(db, migrations);
    const check = report.checks.find((c) => c.name === 'bank statements');
    expect(check?.severity).toBe('warning');
    expect(check?.details?.[0]).toContain('declared 1000.00');
  });

  it('says when an installation has no administrator left', async () => {
    await db.query('delete from instance_admins');
    const report = await doctor(db, migrations);
    const check = report.checks.find((c) => c.name === 'instance administrators');
    expect(check?.severity).toBe('warning');
    expect(check?.summary).toContain('nobody can create a company');
  });
});
