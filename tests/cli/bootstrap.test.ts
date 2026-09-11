/**
 * The installation sequence.
 *
 * The six steps of the README, run by the CLI over a superuser connection,
 * with the GoTrue call replaced by a row in the shimmed `auth.users`. That
 * substitution is the whole of the mocking: everything after it — the
 * instance row, the administrator, the company, the ownership, the country
 * template and the first financial year — is the real schema deciding.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  applyMigrations,
  applySeeds,
  availableCountries,
  bootstrap,
  listMigrations,
  schemaIsInstalled,
  type SqlClient,
} from '../../packages/cli/src/index.js';
import { emptyDatabase, makeAuthUser, migrationsPath, seedPath } from './helpers.js';

let db: SqlClient;

beforeEach(async () => {
  ({ db } = await emptyDatabase());
  await applyMigrations(db, await listMigrations(migrationsPath));
  await applySeeds(db, seedPath);
});

afterEach(async () => {
  await db.close().catch(() => {});
});

describe('before anything is installed', () => {
  it('knows the schema is there and which countries it ships', async () => {
    expect(await schemaIsInstalled(db)).toBe(true);
    expect(await availableCountries(db)).toEqual(['BE', 'FR']);
  });

  it('has applied the reference seeds but not the demo company', async () => {
    const companies = await db.query<{ count: string }>('select count(*)::text from companies');
    expect(companies[0]?.count).toBe('0');
    const templates = await db.query<{ count: string }>(
      `select count(*)::text from account_templates where country = 'BE'`,
    );
    expect(Number(templates[0]?.count)).toBeGreaterThan(300);
  });
});

describe('bootstrap', () => {
  it('runs the six steps and leaves a company ready to be booked', async () => {
    const userId = await makeAuthUser(db, 'first@example.test');

    const result = await bootstrap(db, {
      organization: 'Example Group',
      country: 'BE',
      company: 'Example One',
      fiscalYear: 2026,
      adminUserId: userId,
    });

    expect(result.steps.map((s) => s.name)).toEqual([
      'instance',
      'administrator',
      'company',
      'owner',
      'country template',
      'financial year',
    ]);
    expect(result.steps.every((s) => s.outcome === 'created')).toBe(true);

    const instance = await db.query<{
      organization_name: string;
      country: string;
      edition: string;
      contact_email: string | null;
      registered_at: string | null;
    }>('select organization_name, country, edition, contact_email, registered_at from instance');
    expect(instance[0]).toMatchObject({
      organization_name: 'Example Group',
      country: 'BE',
      edition: 'community',
      // Registration is an opt-in: init leaves both empty.
      contact_email: null,
      registered_at: null,
    });

    const admins = await db.query<{ user_id: string }>('select user_id from instance_admins');
    expect(admins).toEqual([{ user_id: userId }]);

    const member = await db.query<{ role: string }>(
      'select role from company_members where company_id = $1 and user_id = $2',
      [result.companyId, userId],
    );
    expect(member[0]?.role).toBe('owner');

    const accounts = await db.query<{ count: string }>(
      'select count(*)::text from accounts where company_id = $1',
      [result.companyId],
    );
    expect(Number(accounts[0]?.count)).toBeGreaterThan(300);

    const journals = await db.query<{ count: string }>(
      'select count(*)::text from journals where company_id = $1',
      [result.companyId],
    );
    expect(Number(journals[0]?.count)).toBeGreaterThanOrEqual(6);

    const taxes = await db.query<{ count: string }>(
      'select count(*)::text from taxes where company_id = $1',
      [result.companyId],
    );
    expect(Number(taxes[0]?.count)).toBeGreaterThanOrEqual(19);

    // The default accounts are wired, which is what makes posting work.
    const company = await db.query<{
      receivable_account_id: string | null;
      payable_account_id: string | null;
      sales_journal_id: string | null;
    }>(
      'select receivable_account_id, payable_account_id, sales_journal_id from companies where id = $1',
      [result.companyId],
    );
    expect(company[0]?.receivable_account_id).not.toBeNull();
    expect(company[0]?.payable_account_id).not.toBeNull();
    expect(company[0]?.sales_journal_id).not.toBeNull();

    const year = await db.query<{ name: string; start_date: string; end_date: string }>(
      'select name, start_date::text, end_date::text from fiscal_years where company_id = $1',
      [result.companyId],
    );
    expect(year[0]).toEqual({
      name: 'FY2026',
      start_date: '2026-01-01',
      end_date: '2026-12-31',
    });
  });

  it('creates nothing a second time', async () => {
    const userId = await makeAuthUser(db);
    const options = {
      organization: 'Example Group',
      country: 'BE',
      company: 'Example One',
      fiscalYear: 2026,
      adminUserId: userId,
    };
    const first = await bootstrap(db, options);
    const second = await bootstrap(db, options);

    expect(second.companyId).toBe(first.companyId);
    expect(second.steps.every((s) => s.outcome === 'already')).toBe(true);

    const companies = await db.query<{ count: string }>('select count(*)::text from companies');
    expect(companies[0]?.count).toBe('1');
    const years = await db.query<{ count: string }>('select count(*)::text from fiscal_years');
    expect(years[0]?.count).toBe('1');
  });

  it('refuses a country it has no chart of accounts for', async () => {
    const userId = await makeAuthUser(db);
    await expect(
      bootstrap(db, {
        organization: 'Example Group',
        country: 'ZZ',
        company: 'Example One',
        fiscalYear: 2026,
        adminUserId: userId,
      }),
    ).rejects.toThrow(/unknown_country.*BE, FR/s);
  });

  it('will not hand the administrator seat to a second person', async () => {
    const first = await makeAuthUser(db, 'first@example.test');
    const second = await makeAuthUser(db, 'second@example.test');
    const options = {
      organization: 'Example Group',
      country: 'BE',
      company: 'Example One',
      fiscalYear: 2026,
    };

    await bootstrap(db, { ...options, adminUserId: first });
    await expect(bootstrap(db, { ...options, adminUserId: second })).rejects.toThrow(
      /instance_already_claimed/,
    );
  });

  it('installs a French company on the PCG', async () => {
    const userId = await makeAuthUser(db);
    const result = await bootstrap(db, {
      organization: 'Exemple SAS',
      country: 'FR',
      company: 'Exemple SAS',
      fiscalYear: 2026,
      adminUserId: userId,
    });

    const account = await db.query<{ name: string }>(
      'select name from accounts where company_id = $1 and code = $2',
      [result.companyId, '411000'],
    );
    expect(account).toHaveLength(1);
    const country = await db.query<{ country: string }>(
      'select country from companies where id = $1',
      [result.companyId],
    );
    expect(country[0]?.country).toBe('FR');
  });
});
