/**
 * The six steps of the installation sequence, in SQL.
 *
 * They are the same six the README spells out, in the same order, and they
 * run over the Postgres connection as the database owner. Row level security
 * is bypassed rather than satisfied there, which is exactly why the first
 * administrator has to be created through Supabase Auth first (see `auth.ts`)
 * — the id written into `instance_admins` and `company_members` must be one a
 * signed-in user will later present as `auth.uid()`.
 *
 * Every step is check-then-act, so `ekwo init` can be run twice on the same
 * project without creating a second company or a second financial year. Each
 * one reports whether it did the work or found it already done.
 */

import type { SqlClient } from './sql.js';
import { first, scalar } from './sql.js';

export type StepOutcome = 'created' | 'already';

export interface Step {
  name: string;
  outcome: StepOutcome;
  detail?: string;
}

export interface BankAccountOptions {
  /** The only field that is required to create one; without it, none is. */
  iban: string;
  bic?: string | undefined;
  bankName?: string | undefined;
  /** What it is called in the books. Defaults to the bank name, then to `Compte courant`. */
  label?: string | undefined;
}

export interface BootstrapOptions {
  organization: string;
  country: string;
  company: string;
  /** Calendar year the first financial year opens in. */
  fiscalYear: number;
  /**
   * First day of that year, as YYYY-MM-DD. Left out, the month comes from
   * `country_defaults.fiscal_year_default` — and a pack that declares none
   * produces a refusal naming the flag, never a January nobody chose.
   */
  fiscalYearStart?: string | undefined;
  /** `auth.users.id` of the first administrator. */
  adminUserId: string;
  /** ISO 4217 code. Left out, the country model decides; it is `EUR` for both countries shipped. */
  currencyCode?: string | undefined;
  /** Two letters. Left out, the country model decides. Chooses which label of the pack lands in `accounts.name`. */
  language?: string | undefined;
  /** Chart of accounts to install. Left out, the pack's default chart. */
  chartCode?: string | undefined;
  /** The main bank account, when the operator has one to give. */
  bankAccount?: BankAccountOptions | undefined;
}

export interface BootstrapResult {
  instanceId: string;
  companyId: string;
  fiscalYearName: string;
  /** The first and last day the financial year was opened on. */
  fiscalYearStart: string;
  fiscalYearEnd: string;
  /** The currency the company was created with. */
  currencyCode: string;
  /** The language the chart of accounts was copied in. */
  language: string;
  /** Version of the country pack the company copied, from `company_packs`. */
  packVersion?: string | undefined;
  /** Chart of accounts the company was installed on. */
  chartCode?: string | undefined;
  /** The bank account, when one was asked for. */
  bankAccountId?: string | undefined;
  steps: Step[];
}

/**
 * The currency the country model proposes.
 *
 * `companies.currency_code` is not null and has a default, so the value has to
 * be chosen *before* the insert — after it there is nothing empty left to
 * fill, which is why `install_country_template` could never be the place for
 * this. It is the reader `country_defaults.currency_code` never had.
 */
export async function countryCurrency(db: SqlClient, country: string): Promise<string | undefined> {
  return scalar<string>(db, 'select currency_code from country_defaults where country = $1', [
    country.toUpperCase(),
  ]);
}

/**
 * The language the country model proposes, for the same reason as the
 * currency: the column has a default, so the choice has to be made before the
 * insert. It is what `country_defaults.language_default` is for.
 */
export async function countryLanguage(db: SqlClient, country: string): Promise<string | undefined> {
  return scalar<string>(db, 'select language_default from country_defaults where country = $1', [
    country.toUpperCase(),
  ]);
}

/** One language a country pack publishes every label in. */
export interface LanguageChoice {
  /** ISO 639-1, two letters. */
  code: string;
  /** The country's own name in that language, which is a hint anyone can read. */
  label: string;
  /** True of the language the pack itself is written in. */
  isPackLanguage: boolean;
}

/**
 * The languages this country's pack publishes, the pack's own first.
 *
 * `ekwo init` asks rather than assumes: a Belgian company may keep its books
 * in French, Dutch or German, and which one it is is not something a country
 * code answers. The list comes from the database — `country_defaults` — and
 * not from the pack folder, because an installation has the compiled seeds
 * and no pack to read.
 */
export async function countryLanguages(db: SqlClient, country: string): Promise<LanguageChoice[]> {
  const row = await first<{ name: string; name_i18n: Record<string, string>; languages: string[] }>(
    db,
    'select name, name_i18n, languages from country_defaults where country = $1',
    [country.toUpperCase()],
  );
  if (row === undefined) return [];
  const own = await countryLanguage(db, country);
  return (row.languages ?? []).map((code) => ({
    code,
    label: row.name_i18n?.[code] ?? row.name,
    isPackLanguage: code === own,
  }));
}

/**
 * The month the country model opens a financial year on, or nothing.
 *
 * `ekwo init` reads it to know whether it has to ask. The dates themselves
 * are never computed here: `fiscal_year_bounds()` in the schema is the one
 * place that turns a month into two days.
 */
export async function countryFiscalYearOpening(
  db: SqlClient,
  country: string,
): Promise<string | undefined> {
  return scalar<string>(db, 'select fiscal_year_default from country_defaults where country = $1', [
    country.toUpperCase(),
  ]);
}

/** One chart a country pack offers. */
export interface ChartChoice {
  code: string;
  name: string;
  isDefault: boolean;
  audience: string | null;
  certificationStatus: string | null;
  accounts: number;
}

/**
 * The charts a country offers, the default one first.
 *
 * `ekwo init` asks only when there are two or more, and preselects nothing:
 * the question whose wrong answer is a chart of accounts has no right default
 * beyond the one the pack itself declares.
 */
export async function countryCharts(db: SqlClient, country: string): Promise<ChartChoice[]> {
  const rows = await db.query<{
    code: string;
    name: string;
    is_default: boolean;
    audience: string | null;
    certification_status: string | null;
    accounts: string;
  }>(
    `select c.code, c.name, c.is_default, c.audience,
            c.certification_status::text,
            (select count(*) from account_templates a
              where a.country = c.country and a.chart_code = c.code)::text as accounts
       from chart_templates c
      where c.country = $1
      order by c.is_default desc, c.code`,
    [country.toUpperCase()],
  );
  return rows.map((r) => ({
    code: r.code,
    name: r.name,
    isDefault: r.is_default,
    audience: r.audience,
    certificationStatus: r.certification_status,
    accounts: Number(r.accounts),
  }));
}

/** What a pack says about itself: version and how much anyone has read it. */
export interface PackSummary {
  country: string;
  name: string;
  version: string;
  certificationStatus: string;
  certifiedBy: string | null;
  certifiedAt: string | null;
}

export async function countryPack(db: SqlClient, country: string): Promise<PackSummary | undefined> {
  const row = await first<{
    country: string;
    name: string;
    version: string;
    certification_status: string;
    certified_by: string | null;
    certified_at: string | null;
  }>(
    db,
    `select country, name, version, certification_status::text, certified_by,
            certified_at::text
       from country_packs where country = $1`,
    [country.toUpperCase()],
  );
  if (row === undefined) return undefined;
  return {
    country: row.country,
    name: row.name,
    version: row.version,
    certificationStatus: row.certification_status,
    certifiedBy: row.certified_by,
    certifiedAt: row.certified_at,
  };
}

/** Countries with a chart of accounts seeded in this database. */
export async function availableCountries(db: SqlClient): Promise<string[]> {
  const rows = await db.query<{ country: string }>(
    'select distinct country from account_templates order by country',
  );
  return rows.map((r) => r.country);
}

/** A country offered at install time: its code, and what the pack calls it. */
export interface InstalledPack {
  country: string;
  name: string;
}

/**
 * What this installation can install a company on, in the order it is
 * offered: the packs it holds, by name.
 *
 * The name comes from the pack — `country_packs.name` — so no list of
 * countries and no label for one is ever written in this code. A database
 * seeded before `country_packs` existed still has charts, so the codes of
 * `account_templates` are the fallback, each standing as its own label.
 */
export async function installedPacks(db: SqlClient): Promise<InstalledPack[]> {
  const rows = await db.query<{ country: string; name: string }>(
    'select country, name from country_packs order by name, country',
  );
  if (rows.length > 0) return rows.map((r) => ({ country: r.country, name: r.name }));
  return (await availableCountries(db)).map((country) => ({ country, name: country }));
}

/** Whether the schema has been installed at all. */
export async function schemaIsInstalled(db: SqlClient): Promise<boolean> {
  const present = await scalar<boolean>(
    db,
    `select exists (
       select 1 from information_schema.tables
        where table_schema = 'public' and table_name = 'instance'
     )`,
  );
  return present === true;
}

export async function bootstrap(
  db: SqlClient,
  options: BootstrapOptions,
): Promise<BootstrapResult> {
  const country = options.country.toUpperCase();
  const steps: Step[] = [];

  const countries = await availableCountries(db);
  if (!countries.includes(country)) {
    throw new Error(
      `unknown_country: no chart of accounts seeded for ${country}. ` +
        `This release ships ${countries.join(', ')}.`,
    );
  }

  // 1. The installation itself.
  const existingInstance = await first<{ instance_id: string; organization_name: string }>(
    db,
    'select instance_id, organization_name from instance where id = 1',
  );
  let instanceId: string;
  if (existingInstance === undefined) {
    const created = await first<{ instance_id: string }>(
      db,
      `select instance_id from init_instance($1, $2, 'community')`,
      [options.organization, country],
    );
    if (created === undefined) throw new Error('init_instance_failed: no row returned');
    instanceId = created.instance_id;
    steps.push({ name: 'instance', outcome: 'created', detail: options.organization });
  } else {
    instanceId = existingInstance.instance_id;
    steps.push({
      name: 'instance',
      outcome: 'already',
      detail: existingInstance.organization_name,
    });
  }

  // 2. The first administrator.
  const isAdmin = await scalar<boolean>(
    db,
    'select exists (select 1 from instance_admins where user_id = $1)',
    [options.adminUserId],
  );
  if (isAdmin === true) {
    steps.push({ name: 'administrator', outcome: 'already', detail: options.adminUserId });
  } else {
    const someoneElse = await scalar<boolean>(db, 'select exists (select 1 from instance_admins)');
    if (someoneElse === true) {
      // The database's own rule: the first claim is open, afterwards only an
      // administrator appoints another. The CLI does not get to break it just
      // because it holds the connection.
      throw new Error(
        'instance_already_claimed: this installation already has an administrator. ' +
          'An existing administrator appoints another; the CLI will not overrule that.',
      );
    }
    await db.query('select claim_instance_admin($1)', [options.adminUserId]);
    steps.push({ name: 'administrator', outcome: 'created', detail: options.adminUserId });
  }

  // 3. The company. Its currency is chosen here or nowhere: the column has a
  //    default, so nothing downstream could tell a deliberate choice from a
  //    fallback. The caller answers, or the pack does. There is no third
  //    answer written in this file: a company keeping its books in Canadian
  //    dollars would get a wrong one, and a wrong answer is worse than a
  //    refusal.
  const packCurrency = options.currencyCode ?? (await countryCurrency(db, country));
  if (packCurrency === undefined) {
    throw new Error(
      `no_currency: the ${country} pack names no currency. Pass --currency.`,
    );
  }
  const currencyCode = packCurrency.toUpperCase();

  const packLanguage = options.language ?? (await countryLanguage(db, country));
  if (packLanguage === undefined) {
    throw new Error(
      `no_language: the ${country} pack names no language for its labels. Pass --language.`,
    );
  }
  const language = packLanguage.toLowerCase();

  const existingCompany = await first<{ id: string; currency_code: string }>(
    db,
    'select id, currency_code from companies where name = $1 order by created_at limit 1',
    [options.company],
  );
  let companyId: string;
  if (existingCompany === undefined) {
    const created = await first<{ id: string }>(
      db,
      `insert into companies (name, country, fiscal_country, currency_code, language)
       values ($1, $2, $2, $3, $4)
       returning id`,
      [options.company, country, currencyCode, language],
    );
    if (created === undefined) throw new Error('company_insert_failed: no row returned');
    companyId = created.id;
    steps.push({
      name: 'company',
      outcome: 'created',
      detail: `${options.company} (${currencyCode})`,
    });
  } else {
    companyId = existingCompany.id;
    steps.push({
      name: 'company',
      outcome: 'already',
      detail: `${options.company} (${existingCompany.currency_code})`,
    });
  }

  // 4. The administrator on the books of that company. Administering an
  //    installation is not the same as being a member of a company.
  const membership = await db.query(
    `insert into company_members (company_id, user_id, role)
     values ($1, $2, 'owner')
     on conflict (company_id, user_id) do nothing
     returning user_id`,
    [companyId, options.adminUserId],
  );
  steps.push({
    name: 'owner',
    outcome: membership.length > 0 ? 'created' : 'already',
  });

  // 5. Chart of accounts, journals, taxes, and the company's default accounts.
  //    Idempotent on its own: every insert inside it is `on conflict do nothing`.
  const accountsBefore = await scalar<string>(
    db,
    'select count(*)::text from accounts where company_id = $1',
    [companyId],
  );
  await db.query('select install_country_template($1, $2, $3, $4)', [
    companyId,
    country,
    language,
    options.chartCode ?? null,
  ]);
  const accountsAfter = await scalar<string>(
    db,
    'select count(*)::text from accounts where company_id = $1',
    [companyId],
  );
  const copied = await first<{ version: string; chart_code: string }>(
    db,
    'select version, chart_code from company_packs where company_id = $1 and country = $2',
    [companyId, country],
  );
  steps.push({
    name: 'country template',
    outcome: accountsBefore === accountsAfter ? 'already' : 'created',
    detail:
      `${accountsAfter ?? '0'} accounts, ${country} pack ${copied?.version ?? '?'} ` +
      `chart ${copied?.chart_code ?? '?'} in ${language}`,
  });

  // 6. The first financial year, on the month the country model names. The
  //    dates are computed by the schema — `fiscal_year_bounds()` — because
  //    `ekwo init`, the MCP server and whoever opens next year all have to
  //    get the same answer, and two answers is how a company ends up with two
  //    overlapping first years.
  const bounds = await first<{ start_date: string; end_date: string }>(
    db,
    'select start_date::text, end_date::text from fiscal_year_bounds($1, $2, $3::date)',
    [country, options.fiscalYear, options.fiscalYearStart ?? null],
  );
  if (bounds === undefined) throw new Error('fiscal_year_bounds_failed: no row returned');
  const start = bounds.start_date;
  const end = bounds.end_date;
  const fiscalYearName = `FY${options.fiscalYear}`;
  const existingYear = await first<{ name: string }>(
    db,
    'select name from fiscal_years where company_id = $1 and start_date = $2',
    [companyId, start],
  );
  if (existingYear === undefined) {
    await db.query(
      `insert into fiscal_years (company_id, name, start_date, end_date)
       values ($1, $2, $3, $4)`,
      [companyId, fiscalYearName, start, end],
    );
    steps.push({
      name: 'financial year',
      outcome: 'created',
      detail: `${fiscalYearName} — ${start} to ${end}`,
    });
  } else {
    steps.push({ name: 'financial year', outcome: 'already', detail: existingYear.name });
  }

  // 7. The main bank account, when an IBAN was given. Without one there is
  //    nothing to create: a bank account with no IBAN identifies nothing, and
  //    `ekwo doctor` says so rather than this step inventing a placeholder.
  let bankAccountId: string | undefined;
  if (options.bankAccount !== undefined) {
    const outcome = await ensureBankAccount(db, companyId, currencyCode, options.bankAccount);
    bankAccountId = outcome.id;
    steps.push({
      name: 'bank account',
      outcome: outcome.outcome,
      detail: `${outcome.label} — ${options.bankAccount.iban}${outcome.accountCode === undefined ? '' : ` on ${outcome.accountCode}`}`,
    });
  }

  return {
    instanceId,
    companyId,
    fiscalYearName,
    fiscalYearStart: start,
    fiscalYearEnd: end,
    currencyCode,
    language,
    packVersion: copied?.version,
    chartCode: copied?.chart_code,
    bankAccountId,
    steps,
  };
}

interface BankAccountOutcome {
  id: string;
  outcome: StepOutcome;
  label: string;
  accountCode?: string | undefined;
}

/**
 * The company's first bank account, wired to the bank journal and its ledger
 * account.
 *
 * `install_country_template` already points the bank journal at 550000 or
 * 512000, so the ledger side is known and this step does not ask for it. The
 * IBAN is the natural key — `bank_accounts_company_iban_idx` — so running
 * `init` again with the same one finds it rather than creating a second.
 */
export async function ensureBankAccount(
  db: SqlClient,
  companyId: string,
  currencyCode: string,
  options: BankAccountOptions,
): Promise<BankAccountOutcome> {
  const iban = options.iban.replace(/\s+/g, '').toUpperCase();
  const label = options.label ?? options.bankName ?? 'Compte courant';

  const journal = await first<{ id: string; default_account_id: string | null; code: string }>(
    db,
    `select id, default_account_id, code from journals
      where company_id = $1 and journal_type = 'bank' and active
      order by code limit 1`,
    [companyId],
  );
  if (journal === undefined) {
    throw new Error(
      'no_bank_journal: this company has no journal of type bank, so a bank account has nothing to book through. ' +
        'Run install_country_template first.',
    );
  }

  const accountCode = await scalar<string>(
    db,
    'select code from accounts where id = $1',
    [journal.default_account_id],
  );

  const existing = await first<{ id: string; name: string }>(
    db,
    'select id, name from bank_accounts where company_id = $1 and iban = $2',
    [companyId, iban],
  );

  let id: string;
  let outcome: StepOutcome;
  if (existing === undefined) {
    const created = await first<{ id: string }>(
      db,
      `insert into bank_accounts (company_id, name, iban, bic, bank_name, currency_code,
                                  account_id, journal_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       returning id`,
      [
        companyId,
        label,
        iban,
        options.bic ?? null,
        options.bankName ?? null,
        currencyCode,
        journal.default_account_id,
        journal.id,
      ],
    );
    if (created === undefined) throw new Error('bank_account_insert_failed: no row returned');
    id = created.id;
    outcome = 'created';
  } else {
    id = existing.id;
    outcome = 'already';
  }

  // The journal points back, so `post_payment` finds the money side from
  // either direction.
  await db.query(
    'update journals set bank_account_id = $1 where id = $2 and bank_account_id is null',
    [id, journal.id],
  );

  // And the company points at it, so the first invoice carries an IBAN a
  // customer can pay into. Only when nothing was chosen: the operator picking
  // a different account later is a choice this step must not take back.
  await db.query(
    'update companies set default_bank_account_id = $1 where id = $2 and default_bank_account_id is null',
    [id, companyId],
  );

  return { id, outcome, label, accountCode };
}
