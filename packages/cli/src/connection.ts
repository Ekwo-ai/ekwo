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
 * Supabase dashboard under Connect → Session pooler. `--project-ref` with
 * `--db-password` and `--db-region` is the convenience, and it no longer
 * guesses: the pooler hostname carries a generation prefix as well as a
 * region, so both `aws-0-<region>` and `aws-1-<region>` are tried and the one
 * that answers is kept and printed. There is deliberately no helper that
 * builds the direct host `db.<ref>.supabase.co`: it resolves to an IPv6
 * address only on projects created since 2024, so deriving it on the
 * operator's behalf produces a hang rather than an error. Someone who wants it
 * passes it as `--db-url`.
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
 * The two pooler generations Supabase issues today. Both are tried, so the
 * order is only which one costs a round trip when it is the wrong one.
 */
export const POOLER_GENERATIONS = ['aws-0', 'aws-1'] as const;

/**
 * The session pooler, on port 5432, for one generation prefix.
 *
 * Session mode — not the transaction pooler on 6543 — because a migration
 * needs a session: advisory locks, `set local`, and a multi-statement file
 * applied as one command.
 */
export function poolerUrl(
  projectRef: string,
  password: string,
  region: string,
  generation: string,
): string {
  return `postgresql://postgres.${projectRef}:${encodeURIComponent(password)}@${generation}-${region}.pooler.supabase.com:5432/postgres`;
}

/**
 * Every pooler host worth trying for a ref and a region.
 *
 * The generation prefix is not derivable. A project created in `eu-west-3` in
 * September 2026 answered on `aws-1-eu-west-3` and returned "Tenant or user
 * not found" on `aws-0-eu-west-3`; older projects are the other way round.
 * Building one of them and calling it the answer is the bug this replaces.
 */
export function poolerCandidates(
  projectRef: string,
  password: string,
  region: string,
): string[] {
  return POOLER_GENERATIONS.map((generation) =>
    poolerUrl(projectRef, password, region, generation),
  );
}

/** The host of a connection string, for a message that names what answered. */
export function hostOf(dbUrl: string): string {
  const match = /@([^/:?]+)/.exec(dbUrl);
  return match?.[1] ?? dbUrl;
}

/** Answers whether a connection string reaches a database. */
export type Probe = (dbUrl: string) => Promise<boolean>;

export class NoPoolerHostError extends Error {
  constructor(readonly tried: string[]) {
    super(
      `no_pooler_host: none of ${tried.join(', ')} answered. ` +
        'Copy the connection string from your Supabase dashboard — Connect → Session pooler — ' +
        'and pass it as --db-url. That string is the only form that is not derived.',
    );
  }
}

/**
 * Picks the pooler host that answers, trying each generation in turn.
 *
 * Returns the string that worked, so the caller can print the host and the
 * operator learns which one their project is on.
 */
export async function pickPoolerUrl(
  projectRef: string,
  password: string,
  region: string,
  probe: Probe,
): Promise<string> {
  const candidates = poolerCandidates(projectRef, password, region);
  for (const candidate of candidates) {
    if (await probe(withSsl(candidate))) return candidate;
  }
  throw new NoPoolerHostError(candidates.map(hostOf));
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
