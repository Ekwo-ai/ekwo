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
  countryPack,
  describeCertification,
  installedPacks,
  needsWarning,
  listMigrations,
  schemaIsInstalled,
  type SqlClient,
} from '../../packages/cli/src/index.js';
import { emptyDatabase, makeAuthUser, migrationsPath, seedPath } from './helpers.js';
import {
  allPacks,
  declarationPeriods as CADENCES,
  packCountries,
  packWhere,
  roleOf,
  somePack,
} from '../helpers/packs.js';

let db: SqlClient;

beforeEach(async () => {
  ({ db } = await emptyDatabase());
  await applyMigrations(db, await listMigrations(migrationsPath));
  await applySeeds(db, seedPath);
});

afterEach(async () => {
  await db.close().catch(() => {});
});

// Which country a company is bootstrapped in is a fixture choice, and it is
// made once here: `home` is a pack, any pack, and everything the tests expect
// about it — its bank account, its charts, its certification — is read from
// that pack rather than typed.
const home = somePack;
const HOME = home.manifest.country;
/** A second pack, to prove the bootstrap is not wired to the first one. */
const abroad = allPacks.find((pack) => pack.slug !== home.slug)!;
/** A pack with a second chart, for the two tests that install one. */
const several = packWhere('declares more than one chart', (pack) => pack.charts.length > 1);
const secondChart = several.charts.find((chart) => !chart.is_default)!;

describe('before anything is installed', () => {
  it('knows the schema is there and which countries it ships', async () => {
    expect(await schemaIsInstalled(db)).toBe(true);
    expect(await availableCountries(db)).toEqual(packCountries);
  });

  it('offers the packs it holds, named as the pack names itself', async () => {
    // `ekwo init` has no list of countries and no default one: the question
    // is built from this, so adding a pack is what adds a choice.
    expect(await installedPacks(db)).toEqual(
      allPacks.map((pack) => ({ country: pack.manifest.country, name: pack.manifest.name })),
    );
  });

  it('has applied the reference seeds but not the demo company', async () => {
    const companies = await db.query<{ count: string }>('select count(*)::text from companies');
    expect(companies[0]?.count).toBe('0');
    const templates = await db.query<{ count: string }>(
      `select count(*)::text from account_templates where country = $1`,
      [HOME],
    );
    expect(Number(templates[0]?.count)).toBe(
      new Set(home.charts.flatMap((chart) => chart.accounts.map((a) => a.code))).size === 0
        ? 0
        : home.charts.reduce((n, chart) => n + chart.accounts.length, 0),
    );
  });
});

describe('bootstrap', () => {
  it('runs the six steps and leaves a company ready to be booked', async () => {
    const userId = await makeAuthUser(db, 'first@example.test');

    const result = await bootstrap(db, {
      organization: 'Example Group',
      country: HOME,
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
      country: HOME,
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
      country: HOME,
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
    ).rejects.toThrow(/unknown_country.*BE, EE, FR/s);
  });

  it('will not hand the administrator seat to a second person', async () => {
    const first = await makeAuthUser(db, 'first@example.test');
    const second = await makeAuthUser(db, 'second@example.test');
    const options = {
      organization: 'Example Group',
      country: HOME,
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
      country: HOME,
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
      country: HOME,
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
    // The account the country model points the bank journal at, in its manifest.
    expect(bank[0]?.code).toBe(roleOf(home, 'bank'));
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
      country: HOME,
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
      country: HOME,
      company: 'Example One',
      fiscalYear: 2026,
      adminUserId: userId,
    });
    expect(belgian.currencyCode).toBe('EUR');

    const chosen = await bootstrap(db, {
      organization: 'Example Group',
      country: HOME,
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

  it('records how often the company files, and refuses a cadence the form has not', async () => {
    const userId = await makeAuthUser(db);
    // The country whose form offers a choice is the one this is about: where a
    // form is filed on one cadence there is nothing to record wrongly.
    const choice = packWhere(
      'whose periodic return is filed on more than one cadence',
      (pack) => (pack.report?.periods.length ?? 0) > 1,
    );
    const country = choice.manifest.country;
    const files = choice.report!.periods[1]!;
    const notFiled = CADENCES.find((cadence) => !choice.report!.periods.includes(cadence))!;

    // Nothing said, and nothing invented: a pack proposes a cadence only where
    // the law of its country gives one answer for everybody, and this one does
    // not, so the company is recorded as not having decided.
    const silent = await bootstrap(db, {
      organization: 'Example Group',
      country,
      company: 'Example One',
      fiscalYear: 2026,
      adminUserId: userId,
    });
    expect(silent.vatPeriod).toBeUndefined();
    const unrecorded = await db.query<{ vat_period: string | null }>(
      'select vat_period from companies where id = $1',
      [silent.companyId],
    );
    expect(unrecorded[0]?.vat_period).toBeNull();

    const chosen = await bootstrap(db, {
      organization: 'Example Group',
      country,
      company: 'Example Two',
      fiscalYear: 2026,
      adminUserId: userId,
      vatPeriod: files,
    });
    expect(chosen.vatPeriod).toBe(files);
    const recorded = await db.query<{ vat_period: string | null }>(
      'select vat_period from companies where id = $1',
      [chosen.companyId],
    );
    expect(recorded[0]?.vat_period).toBe(files);

    // A cadence the form is not filed on. The refusal names what the form does
    // accept, so the operator can see the answer rather than guess again.
    await expect(
      bootstrap(db, {
        organization: 'Example Group',
        country,
        company: 'Example Three',
        fiscalYear: 2026,
        adminUserId: userId,
        vatPeriod: notFiled,
      }),
    ).rejects.toThrow(
      new RegExp(`unknown_vat_period: .* is filed ${choice.report!.periods.join(' or ')}`),
    );
  });

  it('installs the default chart of the country, and records which one it was', async () => {
    const userId = await makeAuthUser(db);
    const result = await bootstrap(db, {
      organization: 'Plan par défaut',
      country: HOME,
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
      country: several.manifest.country,
      company: 'Association ASBL',
      fiscalYear: 2026,
      adminUserId: userId,
      chartCode: secondChart.code,
    });
    expect(result.chartCode).toBe(secondChart.code);

    // An account the second chart names differently from the default one: the
    // proof that the chart installed is the one that was asked for.
    const renamed = secondChart.accounts.find(
      (account) =>
        several.charts[0]!.accounts.find((a) => a.code === account.code)?.name !== undefined &&
        several.charts[0]!.accounts.find((a) => a.code === account.code)!.name !== account.name,
    )!;
    const account = await db.query<{ name: string }>(
      'select name from accounts where company_id = $1 and code = $2',
      [result.companyId, renamed.code],
    );
    expect(account[0]?.name).toBe(renamed.name);
  });

  it('lists the charts a country offers, the default one first', async () => {
    const charts = await countryCharts(db, several.manifest.country);
    expect(charts.map((c) => [c.code, c.isDefault, c.audience])).toEqual(
      several.charts.map((chart) => [chart.code, chart.is_default, chart.audience]),
    );
    expect(charts.map((c) => c.certificationStatus)).toEqual(
      several.charts.map((chart) => chart.certification?.status ?? null),
    );
    expect(charts[0]?.accounts).toBe(several.charts[0]!.accounts.length);
  });

  it('says, before anything is booked, how much anyone has read the pack', async () => {
    // `ekwo init` prints this sentence between choosing a country and
    // creating the company. It is the only thing standing between an operator
    // and the belief that an accountant checked these boxes, so what it says
    // is asserted here rather than trusted to a code path nobody reads.
    const maintained = packWhere(
      'is maintained and not reviewed',
      (candidate) => candidate.manifest.certification?.status === 'maintained',
    );
    const pack = await countryPack(db, maintained.manifest.country);
    expect(pack?.certificationStatus).toBe('maintained');
    expect(pack?.certifiedBy).toBeNull();
    expect(describeCertification({ status: pack!.certificationStatus, by: pack!.certifiedBy, on: pack!.certifiedAt })).toBe(
      'maintained by Ekwo — not yet reviewed by an accountant',
    );
    // Maintained is not reviewed, so the operator is warned and not merely told.
    expect(needsWarning(pack!.certificationStatus)).toBe(true);
  });

  it('refuses a chart the country does not have', async () => {
    const userId = await makeAuthUser(db);
    // A chart code no pack of this repository carries.
    const nowhere = 'skr04';
    expect(allPacks.some((pack) => pack.charts.some((c) => c.code === nowhere))).toBe(false);
    await expect(
      bootstrap(db, {
        organization: 'Mauvais plan',
        country: abroad.manifest.country,
        company: 'Mauvais plan SAS',
        fiscalYear: 2026,
        adminUserId: userId,
        chartCode: nowhere,
      }),
    ).rejects.toThrow(/unknown_chart/);
  });

  it('installs a second country on its own chart', async () => {
    const userId = await makeAuthUser(db);
    const result = await bootstrap(db, {
      organization: 'Exemple SAS',
      country: abroad.manifest.country,
      company: 'Exemple SAS',
      fiscalYear: 2026,
      adminUserId: userId,
    });

    const account = await db.query<{ name: string }>(
      'select name from accounts where company_id = $1 and code = $2',
      [result.companyId, roleOf(abroad, 'receivable')],
    );
    expect(account).toHaveLength(1);
    const country = await db.query<{ country: string }>(
      'select country from companies where id = $1',
      [result.companyId],
    );
    expect(country[0]?.country).toBe(abroad.manifest.country);
  });
});

describe('the first financial year', () => {
  it('opens on the month the country model names, and not on January', async () => {
    await db.query(`update country_defaults set fiscal_year_default = 'april' where country = $1`, [HOME]);
    const result = await bootstrap(db, {
      organization: 'Exercice decale',
      country: HOME,
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
      country: HOME,
      company: 'Exercice choisi SRL',
      fiscalYear: 2026,
      fiscalYearStart: '2026-10-01',
      adminUserId: await makeAuthUser(db, 'october@example.test'),
    });
    expect(result.fiscalYearStart).toBe('2026-10-01');
    expect(result.fiscalYearEnd).toBe('2027-09-30');
  });

  it('refuses to open one at all when the pack declares no month', async () => {
    await db.query(`update country_defaults set fiscal_year_default = null where country = $1`, [HOME]);
    await expect(
      bootstrap(db, {
        organization: 'Sans exercice',
        country: HOME,
        company: 'Sans exercice SRL',
        fiscalYear: 2026,
        adminUserId: await makeAuthUser(db, 'silent@example.test'),
      }),
    ).rejects.toThrow(/no_fiscal_year_default/);
  });
});
