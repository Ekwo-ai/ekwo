/**
 * `ekwo init` — a Supabase project you own, turned into a set of books.
 *
 * Six things happen, in this order:
 *
 *   1. the migrations are applied, and recorded the way `supabase db push`
 *      records them;
 *   2. the reference seeds are applied — currencies, the charts of accounts,
 *      the VAT codes;
 *   3. the first administrator is created in *your* Supabase Auth, because a
 *      superuser connection cannot be a signed-in user (see `../auth.ts`);
 *   4. the installation sequence runs: instance, administrator, company,
 *      ownership, country template, first financial year;
 *   5. `ekwo.json` is written, with nothing secret in it;
 *   6. registering with Ekwo is offered, and the default answer is no.
 *
 * Every step is safe to run twice. Running `ekwo init` again on a set-up
 * project reports what was already there and creates nothing a second time.
 */

import { boolFlag, numberFlag, rejectUnknownFlags, stringFlag, type ParsedArgs } from '../args.js';
import { createAuthUser, type CreateAuthUser } from '../auth.js';
import {
  bootstrap,
  countryCharts,
  countryCurrency,
  countryFiscalYearOpening,
  countryLanguage,
  countryLanguages,
  countryPack,
  installedPacks,
} from '../bootstrap.js';
import { describeCertification, needsWarning } from '../pack/certification.js';
import { DEMO_SEED, migrationsDir, seedDir } from '../bundle.js';
import { writeConfig } from '../config.js';
import { CONNECTION_FLAGS, openDatabase } from '../context.js';
import { listMigrations } from '../migrations.js';
import { applyMigrations } from '../migrations.js';
import { ask as askText, askRequired, askSecret, choose, confirm, isInteractive, NotInteractiveError } from '../prompt.js';
import { register, registryUrl } from '../registry.js';
import { applyDemoSeed, applySeeds } from '../seeds.js';
import { asUser, scalar } from '../sql.js';
import { syncSchemaVersion } from '../status.js';
import { bold, cyan, dim, heading, line, note, pairs, skipped, step, warn } from '../ui.js';

export const INIT_FLAGS = [
  ...CONNECTION_FLAGS,
  'country',
  'chart',
  'org',
  'company',
  'admin-email',
  'admin-password',
  'admin-user-id',
  'fiscal-year',
  'fiscal-year-start',
  'currency',
  'language',
  'iban',
  'bic',
  'bank-name',
  'demo',
  'register',
  'register-email',
  'registry-url',
  'yes',
] as const;

export interface InitDeps {
  createAuthUser?: CreateAuthUser;
  fetchImpl?: typeof globalThis.fetch;
}

export async function initCommand(args: ParsedArgs, deps: InitDeps = {}): Promise<number> {
  rejectUnknownFlags(args, INIT_FLAGS);

  const yes = boolFlag(args, 'yes');
  const interactive = !yes && isInteractive();
  const makeUser = deps.createAuthUser ?? createAuthUser;

  const { db, connection } = await openDatabase(args, { interactive });

  try {
    heading('Schema');
    const migrations = await listMigrations(migrationsDir());
    const result = await applyMigrations(db, migrations, (migration) => {
      step(migration.file);
    });
    if (result.applied.length === 0) {
      skipped(`${result.alreadyApplied} migration(s) already applied, nothing to do`);
    } else {
      note(dim(`${result.applied.length} applied, ${result.alreadyApplied} were already there`));
    }

    heading('Reference data');
    await applySeeds(db, seedDir(), (seed) => {
      step(seed.file);
    });
    skipped(`${DEMO_SEED} is sample data and is not applied here`);

    // ---- What this installation is -----------------------------------------
    //
    // There is no default country, and there is no list of countries in this
    // file: both come from the packs this installation holds, named as the
    // pack names itself. A preselected country would be a choice nobody made,
    // and the one question whose wrong answer is a chart of accounts.
    const packs = await installedPacks(db);
    if (packs.length === 0) {
      throw new Error(
        'no_country_pack: this database holds no country pack, so there is no chart of ' +
          'accounts to install. Apply the reference seeds first.',
      );
    }
    const country = (
      stringFlag(args, 'country') ??
      (interactive
        ? await choose(
            'Country whose accounting rules apply?',
            packs.map((p) => ({ value: p.country, label: p.name })),
          )
        : requiredCountry(packs))
    ).toUpperCase();

    const organization =
      stringFlag(args, 'org') ??
      (interactive
        ? await askRequired('Name of your organisation?')
        : required('--org', 'the organisation name'));

    const company =
      stringFlag(args, 'company') ??
      (interactive ? await askRequired('Name of the first company?', organization) : organization);

    const fiscalYear = numberFlag(args, 'fiscal-year') ?? new Date().getUTCFullYear();

    // When the first financial year opens. The country model names a month —
    // `calendar`, `april`, `july`, `october` — and the flag names a day. A
    // pack that declares neither is asked about when there is a terminal, and
    // refused when there is not: opening somebody's books on a date nobody
    // chose is found out a year later, in a closing.
    const packOpening = await countryFiscalYearOpening(db, country);
    const askedStart = stringFlag(args, 'fiscal-year-start');
    if (askedStart !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(askedStart)) {
      throw new Error(`bad_date: --fiscal-year-start takes a day as YYYY-MM-DD, not "${askedStart}".`);
    }
    const fiscalYearStart =
      askedStart ??
      (packOpening !== undefined
        ? undefined
        : interactive
          ? await askRequired(`First day of the financial year ${fiscalYear}? (YYYY-MM-DD)`)
          : requiredFiscalYearStart(country));

    // The currency has to be settled before the company row exists:
    // `companies.currency_code` is `not null`, so there is no later moment at
    // which it is empty and the country model could fill it. The pack answers
    // it; a pack that does not is asked about, never guessed at.
    const packCurrency = await countryCurrency(db, country);
    const currencyCode = (
      stringFlag(args, 'currency') ??
      (interactive
        ? await askRequired('Currency of the company?', packCurrency)
        : (packCurrency ?? required('--currency', 'the currency')))
    ).toUpperCase();

    // Which chart of accounts. A country with one chart is not a question:
    // there is nothing to choose. A country with two is asked about, with
    // nothing preselected beyond the default the pack itself declares — the
    // wrong answer here is a whole plan of accounts.
    const charts = await countryCharts(db, country);
    const askedChart = stringFlag(args, 'chart');
    if (askedChart !== undefined && !charts.some((c) => c.code === askedChart)) {
      throw new Error(
        `unknown_chart: ${country} has no chart ${askedChart}. ` +
          `It has: ${charts.map((c) => c.code).join(', ') || 'none'}.`,
      );
    }
    const chartCode =
      askedChart ??
      (charts.length > 1 && interactive
        ? await choose(
            'Which chart of accounts?',
            charts.map((c) => ({
              value: c.code,
              label:
                `${c.name}${c.audience === null ? '' : ` — ${c.audience}`}` +
                ` (${c.accounts} accounts${c.certificationStatus === null ? '' : `, ${c.certificationStatus}`})`,
            })),
          )
        : charts.length > 1
          ? requiredChart(country, charts)
          : undefined);

    // The language of the books, for the same reason as the currency: it is
    // written on the company row, which does not exist yet, and it decides
    // which label of the pack lands in `accounts.name`.
    //
    // The pack says which languages it publishes, and the question lists them
    // with nothing pre-selected. A Belgian company keeps its books in French,
    // Dutch or German, and offering the first of the three as the answer to
    // press Enter on is how two of the three end up installed in the wrong
    // one. Outside an interactive session `--language` is required whenever
    // there is a choice to make.
    const packLanguage = await countryLanguage(db, country);
    const languages = await countryLanguages(db, country);
    const askedLanguage = stringFlag(args, 'language');
    if (
      askedLanguage !== undefined &&
      languages.length > 0 &&
      !languages.some((l) => l.code === askedLanguage.toLowerCase())
    ) {
      warn(
        `${country} publishes its labels in ${languages.map((l) => l.code).join(', ')}; ` +
          `the books will be kept in ${askedLanguage.toLowerCase()} and the chart of accounts ` +
          `will carry the pack's own wording.`,
      );
    }
    const language = (
      askedLanguage ??
      (interactive && languages.length > 1
        ? await choose(
            'Language of the books?',
            languages.map((l) => ({
              value: l.code,
              label: l.isPackLanguage ? `${l.label}, the language the pack is written in` : l.label,
            })),
          )
        : interactive
          ? await askRequired('Language of the books?', packLanguage)
          : languages.length > 1
            ? required('--language', `the language of the books (${languages.map((l) => l.code).join(', ')})`)
            : (packLanguage ?? required('--language', 'the language of the books')))
    ).toLowerCase();

    // What the operator is about to install, and how much anyone has read it.
    const pack = await countryPack(db, country);
    if (pack === undefined) {
      warn(`no country pack is recorded for ${country}; the seeds of this release declare one.`);
    } else {
      const said = `${pack.name} pack ${pack.version}: ${describeCertification({
        status: pack.certificationStatus,
        by: pack.certifiedBy,
        on: pack.certifiedAt,
      })}.`;
      if (needsWarning(pack.certificationStatus)) {
        warn(`${said} Check the boxes against your own situation before you file anything.`);
      } else {
        note(dim(said));
      }
    }

    // The main bank account. Optional everywhere: a company can be installed
    // and book sales without one, and `ekwo doctor` is what notices later.
    const iban =
      stringFlag(args, 'iban') ??
      (interactive
        ? emptyToUndefined(await askText('IBAN of the main bank account? (optional, Enter to skip)'))
        : undefined);
    const bankAccount =
      iban === undefined || iban.length === 0
        ? undefined
        : {
            iban,
            bic:
              stringFlag(args, 'bic') ??
              (interactive ? emptyToUndefined(await askText('BIC? (optional)')) : undefined),
            bankName:
              stringFlag(args, 'bank-name') ??
              (interactive ? emptyToUndefined(await askText('Name of the bank? (optional)')) : undefined),
          };

    // ---- The first administrator -------------------------------------------
    heading('First administrator');
    const adminUserId = await resolveAdminUser(db, args, {
      interactive,
      connection,
      makeUser,
    });

    // ---- The installation sequence -----------------------------------------
    heading('Installation');
    const outcome = await bootstrap(db, {
      organization,
      country,
      company,
      fiscalYear,
      ...(fiscalYearStart === undefined ? {} : { fiscalYearStart }),
      adminUserId,
      currencyCode,
      language,
      ...(chartCode === undefined ? {} : { chartCode }),
      bankAccount,
    });
    for (const s of outcome.steps) {
      const text = s.detail === undefined ? s.name : `${s.name} — ${s.detail}`;
      if (s.outcome === 'created') step(text);
      else skipped(`${text} (already there)`);
    }

    const schemaVersion = await syncSchemaVersion(db);

    // ---- The demo company, only when asked ---------------------------------
    if (boolFlag(args, 'demo')) {
      heading('Demo company');
      await asUser(db, adminUserId, () => applyDemoSeed(db, seedDir()));
      step('Exemple Conseil SRL, its contacts, invoices, a payment and a statement');
      warn('Fictional data, including a fictional administrator. Do not leave it on real books.');
    }

    // ---- ekwo.json ----------------------------------------------------------
    const configFile = await writeConfig({
      ...(connection.supabaseUrl !== undefined ? { project_url: connection.supabaseUrl } : {}),
      country,
      ...(schemaVersion !== undefined ? { schema_version: schemaVersion } : {}),
    });

    // ---- Registration, offered, never required ------------------------------
    await offerRegistration(db, args, { interactive, adminUserId, deps });

    heading('Done');
    pairs([
      ['organisation', organization],
      ['company', `${company} (${country}, ${outcome.currencyCode}, ${outcome.language})`],
      [
        'chart of accounts',
        `${outcome.chartCode ?? 'unknown'}${
          charts.find((c) => c.code === outcome.chartCode)?.name === undefined
            ? ''
            : ` — ${charts.find((c) => c.code === outcome.chartCode)?.name}`
        }`,
      ],
      [
        'country pack',
        pack === undefined
          ? 'none recorded'
          : `${pack.version} — ${describeCertification({ status: pack.certificationStatus, by: pack.certifiedBy, on: pack.certifiedAt })}`,
      ],
      ['financial year', `${outcome.fiscalYearName} — ${outcome.fiscalYearStart} to ${outcome.fiscalYearEnd}`],
      ['bank account', bankAccount === undefined ? 'none — ekwo doctor will say so' : bankAccount.iban],
      ['schema version', schemaVersion ?? 'unknown'],
      ['config', configFile],
    ]);
    line();
    line(`  ${bold('Next:')} sign in to your Supabase project as the administrator you just created,`);
    line(`  then ${cyan('ekwo status')} to see what is there and ${cyan('ekwo doctor')} to check it.`);
    line();
    return 0;
  } finally {
    await db.close();
  }
}

function required(flag: string, what: string): never {
  throw new NotInteractiveError(what, flag);
}

/**
 * The refusal when `--country` is missing and nobody can be asked. It names
 * the packs this installation holds rather than a country it prefers, because
 * it has no reason to prefer one.
 */
function requiredCountry(packs: { country: string; name: string }[]): never {
  throw new Error(
    'missing_input: the country was not given and this is not a terminal. Pass --country, ' +
      `one of: ${packs.map((p) => `${p.country} (${p.name})`).join(', ')}.`,
  );
}

/**
 * The refusal when the pack names no opening month, `--fiscal-year-start` is
 * missing and nobody can be asked. It names the field the pack should carry
 * as well as the flag, because one of the two is the real fix.
 */
function requiredFiscalYearStart(country: string): never {
  throw new Error(
    `missing_input: the ${country} pack declares no defaults.fiscal_year_default and this is not a ` +
      'terminal. Pass --fiscal-year-start YYYY-MM-DD, or add the field to the pack.',
  );
}

/**
 * The refusal when a country offers several charts, `--chart` is missing and
 * nobody can be asked. It lists them rather than picking the default: a
 * non-interactive install that meant the other one would find out a year later.
 */
function requiredChart(
  country: string,
  charts: { code: string; name: string; isDefault: boolean }[],
): never {
  throw new Error(
    `missing_input: ${country} offers several charts of accounts and this is not a terminal. ` +
      `Pass --chart, one of: ${charts
        .map((c) => `${c.code} (${c.name}${c.isDefault ? ', the default' : ''})`)
        .join(', ')}.`,
  );
}

/** An unanswered optional question is not an empty string. */
function emptyToUndefined(value: string): string | undefined {
  return value.length === 0 ? undefined : value;
}

/**
 * The id that will be written into `instance_admins` and `company_members`.
 *
 * Either an account already exists and its id was given, or one is created
 * through the Supabase Auth admin API. There is no third way: the id has to
 * be one that `auth.uid()` will return for a real signed-in user, and only
 * GoTrue can mint that.
 */
async function resolveAdminUser(
  db: Awaited<ReturnType<typeof openDatabase>>['db'],
  args: ParsedArgs,
  options: {
    interactive: boolean;
    connection: { supabaseUrl?: string | undefined; serviceRoleKey?: string | undefined };
    makeUser: CreateAuthUser;
  },
): Promise<string> {
  const given = stringFlag(args, 'admin-user-id');
  if (given !== undefined) {
    const exists = await scalar<boolean>(
      db,
      'select exists (select 1 from auth.users where id = $1)',
      [given],
    );
    if (exists !== true) {
      throw new Error(
        `unknown_user: ${given} is not a user of this Supabase project. ` +
          'Create the account first, or drop --admin-user-id and let the CLI create one.',
      );
    }
    skipped(`using the existing account ${given}`);
    return given;
  }

  const email =
    stringFlag(args, 'admin-email') ??
    (options.interactive
      ? await askRequired('E-mail address of the first administrator?')
      : required('--admin-email', "the administrator's address"));

  const { supabaseUrl, serviceRoleKey } = options.connection;
  if (supabaseUrl === undefined) {
    throw new Error(
      'missing_supabase_url: creating the first user needs the project URL. ' +
        'Pass --supabase-url, or set SUPABASE_URL.',
    );
  }
  const key =
    serviceRoleKey ??
    (options.interactive
      ? await askSecret('service_role key (Project Settings → API). It is never written to disk:')
      : required('--service-role-key', 'the service_role key'));

  const password =
    stringFlag(args, 'admin-password') ??
    (options.interactive
      ? await askSecret('Password for that administrator (blank to send an invite link instead):')
      : undefined);

  const user = await options.makeUser({
    supabaseUrl,
    serviceRoleKey: key,
    email,
    password: password !== undefined && password.length > 0 ? password : undefined,
  });

  if (user.created) step(`created ${email} in your Supabase Auth`);
  else skipped(`${email} already had an account here`);
  if (user.actionLink !== undefined) {
    note(dim('No password was set. Send them this link to choose one:'));
    note(user.actionLink);
  }

  // The foreign key on instance_admins will refuse an id GoTrue has not
  // written yet; say so here rather than three steps later.
  const visible = await scalar<boolean>(
    db,
    'select exists (select 1 from auth.users where id = $1)',
    [user.id],
  );
  if (visible !== true) {
    throw new Error(
      `auth_user_not_visible: Supabase Auth reported user ${user.id}, but the database does not ` +
        'see it. Check that --db-url and --supabase-url point at the same project.',
    );
  }

  return user.id;
}

async function offerRegistration(
  db: Awaited<ReturnType<typeof openDatabase>>['db'],
  args: ParsedArgs,
  options: { interactive: boolean; adminUserId: string; deps: InitDeps },
): Promise<void> {
  const asked = boolFlag(args, 'register');
  const wanted = asked
    ? true
    : options.interactive
      ? await ask(
          'Register this installation with Ekwo to receive security advisories and release notes?',
        )
      : false;

  if (!wanted) {
    heading('Registration');
    skipped('not registered — Community works unregistered, forever');
    note(dim('Change your mind later with `ekwo register --email you@example.com`.'));
    return;
  }

  const email =
    stringFlag(args, 'register-email') ??
    stringFlag(args, 'admin-email') ??
    (options.interactive ? await askRequired('Contact address?') : undefined);
  if (email === undefined) {
    warn('--register needs an address: pass --register-email or --admin-email. Skipped.');
    return;
  }

  heading('Registration');
  const url = stringFlag(args, 'registry-url') ?? registryUrl();
  const result = await register(db, {
    adminUserId: options.adminUserId,
    email,
    url,
    ...(options.deps.fetchImpl !== undefined ? { fetchImpl: options.deps.fetchImpl } : {}),
  });
  step(`recorded on the instance row: ${email}`);
  if (result.announced) {
    step(`announced to ${url}`);
  } else {
    warn(`could not reach ${url} (${result.reason ?? 'unknown'}).`);
    note(dim('The local registration stands. `ekwo register` will try again.'));
  }
  note(dim(`Sent: ${JSON.stringify(result.payload)}`));
}

/** Yes/no with no as the default, kept separate so the wording stays fixed. */
async function ask(question: string): Promise<boolean> {
  return confirm(question, false);
}
