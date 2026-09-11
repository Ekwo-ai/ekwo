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
import { availableCountries, bootstrap } from '../bootstrap.js';
import { DEMO_SEED, migrationsDir, seedDir } from '../bundle.js';
import { writeConfig } from '../config.js';
import { CONNECTION_FLAGS, openDatabase } from '../context.js';
import { listMigrations } from '../migrations.js';
import { applyMigrations } from '../migrations.js';
import { askRequired, askSecret, choose, confirm, isInteractive, NotInteractiveError } from '../prompt.js';
import { register, registryUrl } from '../registry.js';
import { applyDemoSeed, applySeeds } from '../seeds.js';
import { asUser, scalar } from '../sql.js';
import { syncSchemaVersion } from '../status.js';
import { bold, cyan, dim, heading, line, note, pairs, skipped, step, warn } from '../ui.js';

export const INIT_FLAGS = [
  ...CONNECTION_FLAGS,
  'country',
  'org',
  'company',
  'admin-email',
  'admin-password',
  'admin-user-id',
  'fiscal-year',
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
    const countries = await availableCountries(db);
    const country = (
      stringFlag(args, 'country') ??
      (interactive
        ? await choose(
            'Country whose accounting rules apply?',
            countries.map((c) => ({ value: c, label: c === 'BE' ? 'PCMN' : c === 'FR' ? 'PCG' : c })),
            countries[0] ?? 'BE',
          )
        : required('--country', 'the country'))
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
      adminUserId,
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
      ['company', `${company} (${country})`],
      ['financial year', outcome.fiscalYearName],
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
