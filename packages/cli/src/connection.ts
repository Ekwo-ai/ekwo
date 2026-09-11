/**
 * Where the connection details come from, and where they do not go.
 *
 * Three sources, in this order: a flag, an environment variable, a prompt.
 * Nothing else. In particular the CLI never reads a secret out of a file it
 * wrote and never writes one into a file — not into `ekwo.json`, not into a
 * dotfile in the home directory, not into a cache. A service_role key can do
 * anything to the project it belongs to; leaving a copy of it on disk because
 * it saved a paste is not a trade worth making. `.env.example` documents the
 * variables so an operator can put them somewhere *they* chose.
 *
 * The reliable way to give the CLI a database is `--db-url`, copied from the
 * Supabase dashboard under Project Settings → Database. `--project-ref` with
 * `--db-password` is a convenience that guesses the host, and a guess is what
 * it stays: the pooler hostname carries a region, and the direct hostname is
 * IPv6-only on recent projects.
 */

export interface Connection {
  /** Postgres connection string. Always present once resolved. */
  dbUrl: string;
  /** `https://<ref>.supabase.co`, when known. Needed to create the first user. */
  supabaseUrl?: string | undefined;
  /** Needed to create the first user, and never stored. */
  serviceRoleKey?: string | undefined;
  projectRef?: string | undefined;
}

export const ENV_DB_URL = 'EKWO_DB_URL';
export const ENV_DB_URL_FALLBACK = 'SUPABASE_DB_URL';
export const ENV_SUPABASE_URL = 'SUPABASE_URL';
export const ENV_SERVICE_ROLE_KEY = 'SUPABASE_SERVICE_ROLE_KEY';

/** The project ref out of whatever we were given, or `undefined`. */
export function projectRefFrom(value: string | undefined): string | undefined {
  if (value === undefined || value.length === 0) return undefined;

  // https://abcdefghijklmnopqrst.supabase.co
  const host = /^https?:\/\/([a-z0-9-]+)\.supabase\.(co|in|red)/i.exec(value);
  if (host !== null) return host[1];

  // postgresql://postgres.<ref>:password@aws-0-eu-central-1.pooler.supabase.com:5432/postgres
  const pooler = /\/\/postgres\.([a-z0-9]+):/i.exec(value);
  if (pooler !== null) return pooler[1];

  // postgresql://postgres:password@db.<ref>.supabase.co:5432/postgres
  const direct = /@db\.([a-z0-9]+)\.supabase\./i.exec(value);
  if (direct !== null) return direct[1];

  // A bare ref: twenty lowercase letters is what Supabase issues.
  if (/^[a-z]{20}$/.test(value)) return value;

  return undefined;
}

export function supabaseUrlFor(projectRef: string): string {
  return `https://${projectRef}.supabase.co`;
}

/**
 * Builds a connection string from a project ref and the database password.
 *
 * With a region, the shared pooler on port 5432 (session mode, which supports
 * everything a migration needs). Without, the direct host, which is what an
 * older project answers on.
 */
export function databaseUrlFor(
  projectRef: string,
  password: string,
  region?: string | undefined,
): string {
  const encoded = encodeURIComponent(password);
  if (region !== undefined && region.length > 0) {
    return `postgresql://postgres.${projectRef}:${encoded}@aws-0-${region}.pooler.supabase.com:5432/postgres`;
  }
  return `postgresql://postgres:${encoded}@db.${projectRef}.supabase.co:5432/postgres`;
}

export function looksLikeConnectionString(value: string): boolean {
  return /^postgres(ql)?:\/\//i.test(value);
}

/** A connection string with `sslmode=require` added when it says nothing. */
export function withSsl(dbUrl: string): string {
  if (/[?&]sslmode=/i.test(dbUrl)) return dbUrl;
  if (/localhost|127\.0\.0\.1/.test(dbUrl)) return dbUrl;
  return `${dbUrl}${dbUrl.includes('?') ? '&' : '?'}sslmode=require`;
}
