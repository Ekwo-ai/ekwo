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
  databaseUrlFor,
  looksLikeConnectionString,
  projectRefFrom,
  supabaseUrlFor,
  withSsl,
  type Connection,
} from './connection.js';
import { NotInteractiveError, askSecret, isInteractive } from './prompt.js';
import { connect, type SqlClient } from './sql.js';

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
}

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

  if (dbUrl === undefined && projectRef !== undefined) {
    const password =
      stringFlag(args, 'db-password') ??
      env['EKWO_DB_PASSWORD'] ??
      (interactive
        ? await askSecret(`Database password for project ${projectRef}:`)
        : undefined);
    if (password === undefined || password.length === 0) {
      throw new NotInteractiveError('the database password', '--db-password or --db-url');
    }
    dbUrl = databaseUrlFor(projectRef, password, stringFlag(args, 'db-region'));
  }

  if (dbUrl === undefined) {
    if (!interactive) {
      throw new NotInteractiveError('the database connection string', '--db-url');
    }
    const answer = await askSecret(
      'Postgres connection string (Supabase dashboard → Project Settings → Database):',
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
