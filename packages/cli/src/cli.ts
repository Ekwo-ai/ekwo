/**
 * The command line itself: parse, dispatch, and turn a thrown error into an
 * exit code and one readable line.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { UsageError, parseArgs, type ParsedArgs } from './args.js';
import { demoCommand } from './commands/demo.js';
import { doctorCommand } from './commands/doctor.js';
import { initCommand, type InitDeps } from './commands/init.js';
import { migrateCommand } from './commands/migrate.js';
import { moduleCommand } from './commands/module.js';
import { packCommand } from './commands/pack.js';
import { registerCommand, unregisterCommand } from './commands/register.js';
import { statusCommand } from './commands/status.js';
import { bold, cyan, dim, fail, line } from './ui.js';

export function version(): string {
  try {
    const path = fileURLToPath(new URL('../package.json', import.meta.url));
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { version?: string };
    return parsed.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export const COMMANDS = [
  'init',
  'migrate',
  'status',
  'doctor',
  'module',
  'pack',
  'register',
  'unregister',
  'demo',
] as const;

export function help(): string {
  return `${bold('ekwo')} — install and operate Ekwo OS on a Supabase project you own.

${bold('Usage')}
  npx ekwo <command> [options]

${bold('Commands')}
  ${cyan('init')}        Apply the schema, seed the reference data, create the first
              administrator and the first company, on a project you already have.
  ${cyan('migrate')}     Apply the migrations this release adds, and show the gap first.
  ${cyan('status')}      Schema version installed against available, the instance,
              its administrators and its companies.
  ${cyan('doctor')}      Check what the schema cannot enforce on its own: row level
              security everywhere, no pending migration, no membership pointing
              at a deleted user, statements that tie to their lines.
  ${cyan('module')}      The modules beside the socle: what is installed, apply their
              migrations, and turn one on or off for a company.
  ${cyan('pack')}        Compile a country pack into its seed, check that the committed
              seed is still the exact output of the pack, and move a company
              onto the version an installation holds.
  ${cyan('register')}    Opt in to security advisories and release notes. Never required.
  ${cyan('unregister')}  Opt back out. Clears the address and the date.
  ${cyan('demo')}        Load the sample company. Fictional data; ask for it explicitly.

${bold('Connecting')} ${dim('(every command)')}
  --db-url <url>            Postgres connection string. Supabase dashboard →
                            Project Settings → Database. The reliable way.
  --project-ref <ref>       With --db-password, the host is guessed from the ref.
  --db-password <password>  Database password. Prompted, masked, if omitted.
  --db-region <region>      Use the pooler in this region, e.g. eu-central-1.
  --supabase-url <url>      https://<ref>.supabase.co — needed to create a user.
  --service-role-key <key>  Project Settings → API. Needed to create a user.

${bold('ekwo init')}
  --country <cc>            Which pack: its chart of accounts and its VAT rules.
                            Required unless the terminal can ask, which lists
                            the packs this installation holds, by name.
  --org <name>              Your organisation. Written on the instance row.
  --company <name>          The first company. Defaults to --org.
  --admin-email <address>   The first administrator, created in your Supabase Auth.
  --admin-password <pw>     Their password. Omitted: an invite link is generated.
  --admin-user-id <uuid>    Use an account that already exists instead.
  --fiscal-year <year>      Calendar year the first financial year opens in.
                            Defaults to this year.
  --fiscal-year-start <d>   First day of it, as YYYY-MM-DD. Defaults to the
                            month the country pack opens a year on; required
                            when the pack names none.
  --language <xx>           Language of the books. Defaults to the country pack's.
  --vat-period <cadence>    How often the company files its VAT return: month,
                            quarter or year. Asked when the country's form
                            offers several; left unrecorded when nothing says.
  --demo                    Also load the sample company.
  --register                Register without being asked. --register-email sets
                            the address; otherwise --admin-email is used.
  --yes, -y                 Never ask a question. Everything must come from
                            flags or the environment.

${bold('ekwo module')}
  list                      What this release carries, and what the database holds.
  migrate [<cc>]            Apply the module migrations and their country seeds.
  enable <code> --company   Turn a module on for a company. Prints the schema to
                            add to the project's exposed schemas, which no
                            migration can do.
  disable <code> --company  Turn it off. Nothing the module wrote is deleted.

${bold('ekwo pack')} ${dim('(build, check and list need a checkout of the repository)')}
  build <cc> | --all        Compile packs/<cc> into supabase/seed/.
  check <cc> | --all        Refuse a seed that is not the output of its pack.
  list                      The packs this checkout carries.
  status                    What each company copied, against what is loaded on
                            the installation this connects to. Read-only.
  upgrade <company>         Move it to the version loaded there. An addition and
                            a closed validity are applied; everything else is
                            listed and left alone until --apply.

${bold('Environment')}
  EKWO_DB_URL               Same as --db-url. SUPABASE_DB_URL also works.
  EKWO_DB_PASSWORD          Same as --db-password.
  SUPABASE_URL              Same as --supabase-url.
  SUPABASE_SERVICE_ROLE_KEY Same as --service-role-key.
  EKWO_REGISTRY_URL         Where registrations are announced.
  NO_COLOR                  Plain output.

${bold('What this CLI does not do')}
  It does not create or pay for a Supabase project. You create one — the free
  plan is enough — and the CLI connects to it. Your data is on your account
  from the first row, and there is nothing for us to hold back.

  It never writes a secret to disk. The database password and the service_role
  key are read from a flag, the environment or a masked prompt, used, and
  forgotten. ${cyan('ekwo.json')} holds the project URL, the country and the schema
  version, and nothing else.

  There is no ${cyan('eject')} command, because there is nothing to eject from. The
  schema is in your database, the migrations are in this repository under
  AGPL-3.0, and ${cyan('supabase db push')} applies them without this CLI ever running
  again — the migration history is the one the Supabase CLI writes.

${bold('Docs')}  https://github.com/Ekwo-ai/ekwo-os
`;
}

export async function run(argv: string[], deps: InitDeps = {}): Promise<number> {
  let args: ParsedArgs;
  try {
    args = parseArgs(argv);
  } catch (error) {
    fail((error as Error).message);
    return 2;
  }

  if (args.flags.get('version') === true && args.command === undefined) {
    line(version());
    return 0;
  }

  if (args.command === undefined || args.command === 'help' || args.flags.get('help') === true) {
    if (args.command !== undefined && args.command !== 'help' && !isKnown(args.command)) {
      fail(`unknown command: ${args.command}`);
      return 2;
    }
    process.stdout.write(help());
    return 0;
  }

  try {
    switch (args.command) {
      case 'init':
        return await initCommand(args, deps);
      case 'migrate':
        return await migrateCommand(args);
      case 'status':
        return await statusCommand(args);
      case 'doctor':
        return await doctorCommand(args);
      case 'module':
        return await moduleCommand(args);
      case 'pack':
        return await packCommand(args);
      case 'register':
        return await registerCommand(args, deps.fetchImpl !== undefined ? { fetchImpl: deps.fetchImpl } : {});
      case 'unregister':
        return await unregisterCommand(args);
      case 'demo':
        return await demoCommand(args);
      default:
        fail(`unknown command: ${args.command}`);
        line(dim('Run `ekwo --help` for the list.'));
        return 2;
    }
  } catch (error) {
    const message = (error as Error).message;
    fail(message);
    if (error instanceof UsageError) return 2;
    return 1;
  }
}

function isKnown(command: string): boolean {
  return (COMMANDS as readonly string[]).includes(command);
}
