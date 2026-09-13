/**
 * `ekwo module` — what is beside the socle, and which company holds it.
 *
 *   ekwo module list                     what this release carries, and what the database holds
 *   ekwo module migrate [<code>]         apply the migrations of the modules, and their pack seeds
 *   ekwo module enable <code> --company  turn a module on for one company
 *   ekwo module disable <code> --company turn it off, unless the module says it holds data
 *
 * `enable` and `disable` go through `enable_module()` / `disable_module()`
 * rather than writing `company_modules`: the guard lives in the function
 * because the table has no write policy, and a CLI that went round it would be
 * a CLI whose rule applies only to clients that respect it. That is the same
 * reason `ekwo register` sets the request claim and calls the function.
 */

import { rejectUnknownFlags, stringFlag, UsageError, type ParsedArgs } from '../args.js';
import { seedDir } from '../bundle.js';
import { CONNECTION_FLAGS, openDatabase } from '../context.js';
import { applyMigrations, appliedVersions, ensureHistory } from '../migrations.js';
import {
  allModuleMigrations,
  exposeSchemaNote,
  listModules,
  moduleSeeds,
  readModule,
  type EkwoModule,
} from '../module/read.js';
import { isInteractive } from '../prompt.js';
import { applySeed } from '../seeds.js';
import { asUser, first, type SqlClient } from '../sql.js';
import { bold, cyan, dim, heading, line, note, skipped, step, warn } from '../ui.js';

export const MODULE_FLAGS = [...CONNECTION_FLAGS, 'company', 'as-user', 'settings', 'yes'] as const;

export async function moduleCommand(args: ParsedArgs): Promise<number> {
  rejectUnknownFlags(args, MODULE_FLAGS);
  const action = args.positional[0];

  if (action === undefined || action === 'help') {
    line(usage());
    return action === undefined ? 2 : 0;
  }
  if (!['list', 'migrate', 'enable', 'disable'].includes(action)) {
    throw new UsageError(`unknown subcommand: module ${action}\n${usage()}`);
  }

  const modules = await listModules();
  const interactive = isInteractive();
  const { db } = await openDatabase(args, { interactive });

  try {
    switch (action) {
      case 'list':
        return await listCommand(db, modules);
      case 'migrate':
        return await migrateCommand(db, modules, args.positional[1]);
      default:
        return await toggleCommand(db, modules, args, action === 'enable');
    }
  } finally {
    await db.close();
  }
}

// ------------------------------------------------------------------- list

interface RegistryRow {
  code: string;
  name: string;
  schema_name: string;
  version: string;
  status: string;
  companies: number;
}

async function listCommand(db: SqlClient, modules: EkwoModule[]): Promise<number> {
  const installed = await registry(db);
  const byCode = new Map(installed.map((row) => [row.code, row]));

  heading(`Modules (${modules.length} in this release)`);
  if (modules.length === 0) {
    note(dim('none — the socle stands on its own'));
    return 0;
  }

  for (const module of modules) {
    const { manifest } = module;
    const row = byCode.get(manifest.code);
    const state =
      row === undefined
        ? dim('not installed — run `ekwo module migrate`')
        : `${row.status}, ${row.companies} compan${row.companies === 1 ? 'y' : 'ies'}`;
    note(
      `${bold(manifest.code)}  ${manifest.name} ${manifest.version} · schema ${cyan(manifest.schema)} · ` +
        `${module.migrations.length} migration(s) · ${state}`,
    );
    if (manifest.description !== undefined) note(dim(`        ${manifest.description}`));
    if (row !== undefined && row.version !== manifest.version) {
      warn(`${manifest.code}: the database holds ${row.version}, this release carries ${manifest.version}`);
    }
  }

  const strangers = installed.filter((row) => !modules.some((m) => m.manifest.code === row.code));
  if (strangers.length > 0) {
    heading('Installed here, not in this release');
    for (const row of strangers) note(`${bold(row.code)}  ${row.name} ${row.version} · schema ${row.schema_name}`);
  }
  line();
  return 0;
}

async function registry(db: SqlClient): Promise<RegistryRow[]> {
  const exists = await first<{ present: boolean }>(
    db,
    `select to_regclass('public.modules') is not null as present`,
  );
  if (exists?.present !== true) return [];
  return db.query<RegistryRow>(
    `select m.code, m.name, m.schema_name, m.version, m.status::text as status,
            (select count(*)::int from company_modules c where c.module_code = m.code) as companies
       from modules m order by m.code`,
  );
}

// ---------------------------------------------------------------- migrate

async function migrateCommand(
  db: SqlClient,
  modules: EkwoModule[],
  only: string | undefined,
): Promise<number> {
  const wanted = only === undefined ? modules : [await readModule(only)];
  if (wanted.length === 0) {
    heading('Modules');
    skipped('this release carries none');
    return 0;
  }

  const applied = await applyModuleMigrations(db, wanted, { heading: true });
  if (applied === 0) skipped('nothing to apply');

  for (const module of wanted) {
    heading(`${module.manifest.name}`);
    for (const sentence of exposeSchemaNote(module.manifest.schema)) note(dim(sentence));
  }
  line();
  return 0;
}

/**
 * Applies every pending migration of the given modules, then their pack seeds.
 *
 * Shared with `ekwo migrate`, which runs it straight after the socle's — a
 * module's tables existing is not the same as a company holding the module, so
 * there is nothing to ask before creating them, and a schema whose migrations
 * are half applied is the state nobody can reason about.
 */
export async function applyModuleMigrations(
  db: SqlClient,
  modules: readonly EkwoModule[],
  options: { heading?: boolean } = {},
): Promise<number> {
  const migrations = allModuleMigrations(modules);
  if (migrations.length === 0) return 0;

  await ensureHistory(db);
  const known = new Set(await appliedVersions(db));
  const pending = migrations.filter((m) => !known.has(m.version));

  if (options.heading === true) {
    heading('Module migrations');
    note(dim(`${migrations.length - pending.length} applied, ${pending.length} pending`));
  }

  const result = await applyMigrations(db, migrations, (migration) => {
    step(`${migration.name} (${migration.file})`);
  });

  for (const module of modules) {
    for (const path of await moduleSeeds(module.manifest.code, seedDir())) {
      await applySeed(db, { file: path.split('/').at(-1) as string, path });
      step(dim(`${module.manifest.code}: ${path.split('/').at(-1)}`));
    }
  }

  return result.applied.length;
}

// ------------------------------------------------------------ enable/disable

async function toggleCommand(
  db: SqlClient,
  modules: EkwoModule[],
  args: ParsedArgs,
  on: boolean,
): Promise<number> {
  const code = args.positional[1];
  if (code === undefined) throw new UsageError(`name a module: ekwo module ${on ? 'enable' : 'disable'} <code>`);

  const module = modules.find((m) => m.manifest.code === code);
  if (module === undefined) {
    throw new UsageError(
      `unknown module: ${code}. This release carries: ${modules.map((m) => m.manifest.code).join(', ') || 'none'}`,
    );
  }

  const companyId = await resolveCompany(db, stringFlag(args, 'company'));
  const actor = await resolveActor(db, stringFlag(args, 'as-user'), companyId);
  const settings = stringFlag(args, 'settings');

  if (on) {
    await pendingCheck(db, module);
    await asUser(db, actor, async () => {
      await db.query(`select enable_module($1, $2, $3::jsonb)`, [companyId, code, settings ?? null]);
    });
    heading(`${module.manifest.name} enabled`);
    step(`${code} is on for company ${companyId}`);
    line();
    for (const sentence of exposeSchemaNote(module.manifest.schema)) note(dim(sentence));
  } else {
    await asUser(db, actor, async () => {
      await db.query(`select disable_module($1, $2)`, [companyId, code]);
    });
    heading(`${module.manifest.name} disabled`);
    step(`${code} is off for company ${companyId}. Nothing it wrote was deleted.`);
  }
  line();
  return 0;
}

/**
 * The socle migration a module needs has to have run, and the module's own
 * too. Both are questions about the history, which the CLI holds and the
 * database function deliberately does not — a project restored from a dump has
 * the schema and not necessarily the history, and refusing *that* installation
 * would be refusing the wrong thing.
 */
async function pendingCheck(db: SqlClient, module: EkwoModule): Promise<void> {
  const known = new Set(await appliedVersions(db));
  const min = module.manifest.requires_socle_min;
  if (min !== undefined && known.size > 0 && !known.has(min)) {
    throw new Error(
      `socle_too_old: ${module.manifest.code} needs socle migration ${min}, which this database has not run. ` +
        'Run `ekwo migrate` first.',
    );
  }
  const pending = module.migrations.filter((m) => !known.has(m.version));
  if (pending.length > 0 && known.size > 0) {
    throw new Error(
      `module_not_migrated: ${module.manifest.code} has ${pending.length} migration(s) still to apply. ` +
        'Run `ekwo module migrate` first.',
    );
  }
}

async function resolveCompany(db: SqlClient, given: string | undefined): Promise<string> {
  const companies = await db.query<{ id: string; name: string }>(
    `select id, name from companies order by name`,
  );
  if (given !== undefined) {
    const match = companies.find((c) => c.id === given || c.name === given);
    if (match === undefined) {
      throw new UsageError(
        `unknown company: ${given}. This installation holds: ${companies.map((c) => c.name).join(', ') || 'none'}`,
      );
    }
    return match.id;
  }
  const only = companies[0];
  if (companies.length !== 1 || only === undefined) {
    throw new UsageError(
      `--company is required: this installation holds ${companies.length} companies — ` +
        companies.map((c) => `${c.name} (${c.id})`).join(', '),
    );
  }
  return only.id;
}

/**
 * Who the CLI acts for.
 *
 * `enable_module` refuses anyone who is not the owner of the company, and a
 * superuser connection is nobody: `auth.uid()` is null and the guard would
 * refuse the installer. So the claim is set the way PostgREST sets it, for an
 * owner of that company — the rule is satisfied rather than circumvented.
 */
async function resolveActor(
  db: SqlClient,
  given: string | undefined,
  companyId: string,
): Promise<string> {
  if (given !== undefined) return given;
  const owner = await first<{ user_id: string }>(
    db,
    `select user_id from company_members where company_id = $1 and role = 'owner' order by created_at limit 1`,
    [companyId],
  );
  if (owner === undefined) {
    throw new Error(
      `no_company_owner: company ${companyId} has no owner to act for. Pass --as-user <uuid>.`,
    );
  }
  return owner.user_id;
}

function usage(): string {
  return `${bold('ekwo module')} — the modules beside the socle.

  ekwo module list                      What this release carries and what the database holds.
  ekwo module migrate [<code>]          Apply module migrations and their country seeds.
  ekwo module enable <code> --company X Turn a module on for one company.
  ekwo module disable <code> --company X Turn it off. Nothing it wrote is deleted.

  --company <id|name>   Which company. Required unless the installation holds one.
  --as-user <uuid>      Act for this user. Defaults to an owner of the company.
  --settings <json>     Settings to store on the company, in the module's own vocabulary.
`;
}
