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
  countryCharts,
  installedPacks,
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

  it('offers the packs it holds, named as the pack names itself', async () => {
    // `ekwo init` has no list of countries and no default one: the question
    // is built from this, so adding a pack is what adds a choice.
    expect(await installedPacks(db)).toEqual([
      { country: 'BE', name: 'Belgium' },
      { country: 'FR', name: 'France' },
    ]);
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

  it('creates no bank account when no IBAN is given', async () => {
    const userId = await makeAuthUser(db);
    const result = await bootstrap(db, {
      organization: 'Example Group',
      country: 'BE',
      company: 'Example One',
      fiscalYear: 2026,
      adminUserId: userId,
    });

    expect(result.bankAccountId).toBeUndefined();
    expect(result.steps.map((s) => s.name)).not.toContain('bank account');
    const accounts = await db.query<{ count: string }>(
      'select count(*)::text from bank_accounts where company_id = $1',
      [result.companyId],
    );
    expect(accounts[0]?.count).toBe('0');
  });

  it('wires the bank account to the bank journal and its ledger account', async () => {
    const userId = await makeAuthUser(db);
    const result = await bootstrap(db, {
      organization: 'Example Group',
      country: 'BE',
      company: 'Example One',
      fiscalYear: 2026,
      adminUserId: userId,
      bankAccount: { iban: 'BE71 0961 2345 6769', bic: 'GKCCBEBB', bankName: 'Banque Exemple' },
    });

    const bank = await db.query<{
      iban: string;
      bic: string;
      bank_name: string;
      name: string;
      currency_code: string;
      code: string;
      journal_code: string;
    }>(
      `select b.iban, b.bic, b.bank_name, b.name, b.currency_code,
              a.code, j.code as journal_code
         from bank_accounts b
         join accounts a on a.id = b.account_id
         join journals j on j.id = b.journal_id
        where b.company_id = $1`,
      [result.companyId],
    );
    expect(bank).toHaveLength(1);
    // Spaces out, upper case in: an IBAN is compared, and the unique index is
    // on the stored form.
    expect(bank[0]?.iban).toBe('BE71096123456769');
    expect(bank[0]?.bic).toBe('GKCCBEBB');
    expect(bank[0]?.name).toBe('Banque Exemple');
    expect(bank[0]?.currency_code).toBe('EUR');
    // 550000 is what the Belgian country model points the bank journal at.
    expect(bank[0]?.code).toBe('550000');
    expect(bank[0]?.journal_code).toBe('BNK');

    const journal = await db.query<{ bank_account_id: string }>(
      `select bank_account_id from journals where company_id = $1 and code = 'BNK'`,
      [result.companyId],
    );
    expect(journal[0]?.bank_account_id).toBe(result.bankAccountId);
  });

  it('finds the same bank account on a second run rather than creating another', async () => {
    const userId = await makeAuthUser(db);
    const options = {
      organization: 'Example Group',
      country: 'BE',
      company: 'Example One',
      fiscalYear: 2026,
      adminUserId: userId,
      bankAccount: { iban: 'BE71096123456769' },
    };

    const first = await bootstrap(db, options);
    const second = await bootstrap(db, options);

    expect(second.bankAccountId).toBe(first.bankAccountId);
    expect(second.steps.find((s) => s.name === 'bank account')?.outcome).toBe('already');
    const count = await db.query<{ count: string }>(
      'select count(*)::text from bank_accounts where company_id = $1',
      [first.companyId],
    );
    expect(count[0]?.count).toBe('1');
  });

  it('takes the currency from the country model, and lets a flag override it', async () => {
    const userId = await makeAuthUser(db);
    const belgian = await bootstrap(db, {
      organization: 'Example Group',
      country: 'BE',
      company: 'Example One',
      fiscalYear: 2026,
      adminUserId: userId,
    });
    expect(belgian.currencyCode).toBe('EUR');

    const chosen = await bootstrap(db, {
      organization: 'Example Group',
      country: 'BE',
      company: 'Example Two',
      fiscalYear: 2026,
      adminUserId: userId,
      currencyCode: 'usd',
    });
    expect(chosen.currencyCode).toBe('USD');
    const row = await db.query<{ currency_code: string }>(
      'select currency_code from companies where id = $1',
      [chosen.companyId],
    );
    expect(row[0]?.currency_code).toBe('USD');
  });

  it('installs the default chart of the country, and records which one it was', async () => {
    const userId = await makeAuthUser(db);
    const result = await bootstrap(db, {
      organization: 'Plan par défaut',
      country: 'BE',
      company: 'Plan par défaut SRL',
      fiscalYear: 2026,
      adminUserId: userId,
    });
    expect(result.chartCode).toBe('default');

    const copied = await db.query<{ chart_code: string }>(
      'select chart_code from company_packs where company_id = $1',
      [result.companyId],
    );
    expect(copied[0]?.chart_code).toBe('default');
  });

  it('installs the chart it is given instead', async () => {
    const userId = await makeAuthUser(db);
    const result = await bootstrap(db, {
      organization: 'Association',
      country: 'BE',
      company: 'Association ASBL',
      fiscalYear: 2026,
      adminUserId: userId,
      chartCode: 'asbl',
    });
    expect(result.chartCode).toBe('asbl');

    const account = await db.query<{ name: string }>(
      'select name from accounts where company_id = $1 and code = $2',
      [result.companyId, '100000'],
    );
    expect(account[0]?.name).toBe('Patrimoine de départ');
  });

  it('lists the charts a country offers, the default one first', async () => {
    const charts = await countryCharts(db, 'BE');
    expect(charts.map((c) => [c.code, c.isDefault, c.audience])).toEqual([
      ['default', true, 'companies'],
      ['asbl', false, 'nonprofits'],
    ]);
    expect(charts[1]?.certificationStatus).toBe('community');
    expect(charts[0]?.accounts).toBe(353);
  });

  it('refuses a chart the country does not have', async () => {
    const userId = await makeAuthUser(db);
    await expect(
      bootstrap(db, {
        organization: 'Mauvais plan',
        country: 'FR',
        company: 'Mauvais plan SAS',
        fiscalYear: 2026,
        adminUserId: userId,
        chartCode: 'asbl',
      }),
    ).rejects.toThrow(/unknown_chart/);
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

describe('the first financial year', () => {
  it('opens on the month the country model names, and not on January', async () => {
    await db.query(`update country_defaults set fiscal_year_default = 'april' where country = 'BE'`);
    const result = await bootstrap(db, {
      organization: 'Exercice decale',
      country: 'BE',
      company: 'Exercice decale SRL',
      fiscalYear: 2026,
      adminUserId: await makeAuthUser(db, 'april@example.test'),
    });
    expect(result.fiscalYearStart).toBe('2026-04-01');
    expect(result.fiscalYearEnd).toBe('2027-03-31');
  });

  it('takes the day it is given, whatever the country says', async () => {
    const result = await bootstrap(db, {
      organization: 'Exercice choisi',
      country: 'BE',
      company: 'Exercice choisi SRL',
      fiscalYear: 2026,
      fiscalYearStart: '2026-10-01',
      adminUserId: await makeAuthUser(db, 'october@example.test'),
    });
    expect(result.fiscalYearStart).toBe('2026-10-01');
    expect(result.fiscalYearEnd).toBe('2027-09-30');
  });

  it('refuses to open one at all when the pack declares no month', async () => {
    await db.query(`update country_defaults set fiscal_year_default = null where country = 'BE'`);
    await expect(
      bootstrap(db, {
        organization: 'Sans exercice',
        country: 'BE',
        company: 'Sans exercice SRL',
        fiscalYear: 2026,
        adminUserId: await makeAuthUser(db, 'silent@example.test'),
      }),
    ).rejects.toThrow(/no_fiscal_year_default/);
  });
});
