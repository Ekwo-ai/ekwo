/**
 * Turning flags, environment variables and questions into a connection.
 *
 * Every command starts here, so the rules about where a secret may come from
 * are written once. See `connection.ts` for why none of them is a file.
 */

import type { ParsedArgs } from './args.js';
import { stringFlag } from './args.js';
import {
  ENV_DB_URL,
  ENV_DB_URL_FALLBACK,
  ENV_SERVICE_ROLE_KEY,
  ENV_SUPABASE_URL,
  hostOf,
  looksLikeConnectionString,
  pickPoolerUrl,
  projectRefFrom,
  supabaseUrlFor,
  withSsl,
  type Connection,
  type Probe,
} from './connection.js';
import { NotInteractiveError, askSecret, isInteractive } from './prompt.js';
import { connect, type SqlClient } from './sql.js';
import { dim, note } from './ui.js';

export const CONNECTION_FLAGS = [
  'db-url',
  'db-password',
  'db-region',
  'project-ref',
  'supabase-url',
  'service-role-key',
] as const;

export interface ResolveOptions {
  /** Ask for what is missing. False in `--yes` runs and when stdin is not a terminal. */
  interactive: boolean;
  env?: NodeJS.ProcessEnv;
  /**
   * How a candidate pooler host is tried. Injected so the resolution can be
   * tested without a network, and so nothing else in this file knows a driver
   * exists.
   */
  probe?: Probe;
}

/** Opens the connection, closes it, and answers whether that worked. */
export const connectProbe: Probe = async (dbUrl) => {
  try {
    const db = await connect(dbUrl);
    await db.close();
    return true;
  } catch {
    return false;
  }
};

/** Works out how to reach the database, without connecting yet. */
export async function resolveConnection(
  args: ParsedArgs,
  options: ResolveOptions,
): Promise<Connection> {
  const env = options.env ?? process.env;
  const interactive = options.interactive && isInteractive();

  const supabaseUrlGiven = stringFlag(args, 'supabase-url') ?? env[ENV_SUPABASE_URL];
  const serviceRoleKey = stringFlag(args, 'service-role-key') ?? env[ENV_SERVICE_ROLE_KEY];

  let dbUrl = stringFlag(args, 'db-url') ?? env[ENV_DB_URL] ?? env[ENV_DB_URL_FALLBACK];

  let projectRef =
    projectRefFrom(stringFlag(args, 'project-ref')) ??
    projectRefFrom(supabaseUrlGiven) ??
    projectRefFrom(dbUrl);

  const region = stringFlag(args, 'db-region');

  if (dbUrl === undefined && projectRef !== undefined && region !== undefined) {
    const password =
      stringFlag(args, 'db-password') ??
      env['EKWO_DB_PASSWORD'] ??
      (interactive
        ? await askSecret(`Database password for project ${projectRef}:`)
        : undefined);
    if (password === undefined || password.length === 0) {
      throw new NotInteractiveError('the database password', '--db-password or --db-url');
    }
    // Both pooler generations are tried and the one that answers is kept. The
    // prefix is not derivable from the region, and building one of the two and
    // calling it the host is how `--db-region` used to fail: the connection
    // was refused with "Tenant or user not found", which reads like a wrong
    // password rather than a wrong hostname.
    dbUrl = await pickPoolerUrl(projectRef, password, region, options.probe ?? connectProbe);
    note(dim(`Session pooler: ${hostOf(dbUrl)}`));
  }

  // No `--db-region`, or no ref at all: ask for the string the dashboard
  // prints. The direct host `db.<ref>.supabase.co` is not built here on the
  // operator's behalf — it resolves to IPv6 only on any recent project, so
  // deriving it silently produces a hang rather than an answer.
  if (dbUrl === undefined) {
    if (!interactive) {
      throw new NotInteractiveError(
        'the database connection string',
        '--db-url (or --project-ref with --db-password and --db-region)',
      );
    }
    const answer = await askSecret(
      'Postgres connection string (Supabase dashboard → Connect → Session pooler):',
    );
    if (!looksLikeConnectionString(answer)) {
      throw new Error(
        `bad_connection_string: expected something starting with postgresql://, got "${answer.slice(0, 24)}…"`,
      );
    }
    dbUrl = answer;
    projectRef = projectRef ?? projectRefFrom(dbUrl);
  }

  const supabaseUrl =
    supabaseUrlGiven ?? (projectRef !== undefined ? supabaseUrlFor(projectRef) : undefined);

  return {
    dbUrl: withSsl(dbUrl),
    ...(supabaseUrl !== undefined ? { supabaseUrl } : {}),
    ...(serviceRoleKey !== undefined ? { serviceRoleKey } : {}),
    ...(projectRef !== undefined ? { projectRef } : {}),
  };
}

export interface Context {
  db: SqlClient;
  connection: Connection;
}

/** Resolves and opens. The caller closes. */
export async function openDatabase(
  args: ParsedArgs,
  options: ResolveOptions,
): Promise<Context> {
  const connection = await resolveConnection(args, options);
  const db = await connect(connection.dbUrl);
  return { db, connection };
}
