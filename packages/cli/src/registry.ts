/**
 * Registering an installation with Ekwo.
 *
 * This is an opt-in, asked once at the end of `ekwo init`, and the default
 * answer is no. Community works unregistered, forever: nothing in the schema
 * and nothing in this CLI reads `contact_email` or `registered_at` to decide
 * what you may do. The only thing registration buys is that somebody can tell
 * you a security advisory concerns your version.
 *
 * Two halves, deliberately independent:
 *
 *   - **In your database.** `register_instance(email)` writes the address and
 *     a date onto the instance row. `unregister_instance()` clears both.
 *   - **At Ekwo.** A POST to `EKWO_REGISTRY_URL`. The endpoint does not exist
 *     yet, and that is fine: the local half stands on its own, a failed POST
 *     is a soft message rather than an error, and `ekwo register` retries.
 *
 * The payload carries what an advisory needs to be addressed — the locally
 * generated `instance_id`, the organisation, the country, the edition, the
 * schema version, and the address given. No ledger data, no user list, no
 * connection string, ever.
 */

import type { FetchLike } from './auth.js';
import type { SqlClient } from './sql.js';
import { asUser, first } from './sql.js';

export const DEFAULT_REGISTRY_URL = 'https://api.ekwo.ai/v1/registrations';

export function registryUrl(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env['EKWO_REGISTRY_URL'];
  return configured !== undefined && configured.length > 0 ? configured : DEFAULT_REGISTRY_URL;
}

export interface InstanceRow {
  instance_id: string;
  organization_name: string;
  country: string;
  edition: string;
  schema_version: string;
  contact_email: string | null;
  registered_at: string | null;
}

export async function readInstance(db: SqlClient): Promise<InstanceRow | undefined> {
  return first<InstanceRow>(
    db,
    `select instance_id, organization_name, country, edition, schema_version,
            contact_email, registered_at
       from instance where id = 1`,
  );
}

export interface RegistrationPayload {
  instance_id: string;
  organization: string;
  country: string;
  edition: string;
  schema_version: string;
  contact_email: string;
}

export function payloadFor(instance: InstanceRow, email: string): RegistrationPayload {
  return {
    instance_id: instance.instance_id,
    organization: instance.organization_name,
    country: instance.country,
    edition: instance.edition,
    schema_version: instance.schema_version,
    contact_email: email,
  };
}

export interface RegisterResult {
  /** The instance row was written: this always happens. */
  recordedLocally: boolean;
  /** The POST reached Ekwo. False is a supported, non-fatal state. */
  announced: boolean;
  /** Why the POST did not land, when it did not. */
  reason?: string;
  payload: RegistrationPayload;
}

export interface RegisterOptions {
  /** The administrator whose authority `register_instance()` checks. */
  adminUserId: string;
  email: string;
  organization?: string | undefined;
  country?: string | undefined;
  url?: string;
  fetchImpl?: FetchLike;
}

/**
 * Records the registration locally, then tries to announce it.
 *
 * The local write comes first on purpose. If the network is down, or the
 * endpoint is not live yet, the installation still knows it opted in and
 * `ekwo register` can send it later.
 */
export async function register(
  db: SqlClient,
  options: RegisterOptions,
): Promise<RegisterResult> {
  const { adminUserId, email } = options;

  // Optional corrections collected at the same prompt.
  if (options.organization !== undefined && options.organization.length > 0) {
    await db.query('update instance set organization_name = $1 where id = 1', [
      options.organization,
    ]);
  }
  if (options.country !== undefined && options.country.length === 2) {
    await db.query('update instance set country = $1 where id = 1', [
      options.country.toUpperCase(),
    ]);
  }

  await asUser(db, adminUserId, async () => {
    await db.query('select register_instance($1)', [email]);
  });

  const instance = await readInstance(db);
  if (instance === undefined) throw new Error('instance_not_initialised: call ekwo init first');
  const payload = payloadFor(instance, email);

  const announced = await announce(payload, options);
  return { recordedLocally: true, payload, ...announced };
}

/** POSTs the payload. Never throws: a failure here is not a failed install. */
export async function announce(
  payload: RegistrationPayload,
  options: { url?: string; fetchImpl?: FetchLike } = {},
): Promise<{ announced: boolean; reason?: string }> {
  const url = options.url ?? registryUrl();
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (response.ok) return { announced: true };
    return { announced: false, reason: `the registry answered HTTP ${response.status}` };
  } catch (error) {
    return { announced: false, reason: (error as Error).message };
  }
}

/** Clears the address and the date. The local row is the only thing we hold. */
export async function unregister(
  db: SqlClient,
  adminUserId: string,
): Promise<InstanceRow | undefined> {
  await asUser(db, adminUserId, async () => {
    await db.query('select unregister_instance()');
  });
  return readInstance(db);
}

/** The administrator this CLI acts for: the first one on the installation. */
export async function anyAdminId(db: SqlClient): Promise<string | undefined> {
  const row = await first<{ user_id: string }>(
    db,
    'select user_id from instance_admins order by created_at limit 1',
  );
  return row?.user_id;
}
