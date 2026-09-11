/**
 * The first administrator, created through Supabase Auth.
 *
 * Why the CLI cannot do this in SQL. Every policy in the schema compares
 * `auth.uid()` against a row, and `auth.uid()` reads the JWT of the request.
 * The CLI holds a Postgres connection, not a session: it runs as the database
 * owner, `auth.uid()` is NULL, and row level security is bypassed rather than
 * satisfied. So it cannot *be* the first user; it can only create one and then
 * write the rows that user will later be recognised by.
 *
 * Creating the user is also not something SQL can do honestly. `auth.users`
 * belongs to GoTrue — the password hash, the confirmation state, the identity
 * row. Writing it by hand produces an account that looks right and cannot sign
 * in. The admin API is the supported way, and it needs the service_role key.
 *
 * Order, therefore: create the user through GoTrue, take its id, then insert
 * `instance_admins` and the rest over the Postgres connection.
 *
 * `fetch` is a parameter so the tests can drive every branch — created,
 * already exists, invite link, network down — without a Supabase project.
 */

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface AuthUser {
  id: string;
  email: string;
  /** Set when the user was created without a password: send them this link. */
  actionLink?: string;
  /** False when the account was already there and we simply looked it up. */
  created: boolean;
}

export interface CreateAuthUserOptions {
  supabaseUrl: string;
  serviceRoleKey: string;
  email: string;
  /** Omitted: an invite link is generated instead of a password being set. */
  password?: string | undefined;
  fetchImpl?: FetchLike;
}

/** How the bootstrap gets a user id. Injected, so tests never hit the network. */
export type CreateAuthUser = (options: CreateAuthUserOptions) => Promise<AuthUser>;

function authBase(supabaseUrl: string): string {
  return `${supabaseUrl.replace(/\/+$/, '')}/auth/v1`;
}

function headers(serviceRoleKey: string): Record<string, string> {
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    'Content-Type': 'application/json',
  };
}

async function readBody(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (text.trim().length === 0) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { message: text };
  }
}

function describe(body: Record<string, unknown>, status: number): string {
  const message = body['msg'] ?? body['message'] ?? body['error_description'] ?? body['error'];
  return typeof message === 'string' ? message : `HTTP ${status}`;
}

/**
 * Creates the first administrator in the customer's own Supabase Auth.
 *
 * With a password: the account is created confirmed, so they can sign in at
 * once. Without: GoTrue generates an invite link, the account exists with no
 * password, and the link is what the CLI prints.
 *
 * An address that already has an account is not an error. The CLI looks the
 * user up and carries on, which is what makes `ekwo init` safe to re-run.
 */
export const createAuthUser: CreateAuthUser = async ({
  supabaseUrl,
  serviceRoleKey,
  email,
  password,
  fetchImpl = globalThis.fetch,
}: CreateAuthUserOptions): Promise<AuthUser> => {
  const base = authBase(supabaseUrl);

  if (password === undefined || password.length === 0) {
    const response = await fetchImpl(`${base}/admin/generate_link`, {
      method: 'POST',
      headers: headers(serviceRoleKey),
      body: JSON.stringify({ type: 'invite', email }),
    });
    const body = await readBody(response);
    if (!response.ok) {
      throw new Error(`auth_invite_failed: ${describe(body, response.status)}`);
    }
    const id = body['user_id'] ?? (body['user'] as Record<string, unknown> | undefined)?.['id'];
    if (typeof id !== 'string') {
      throw new Error('auth_invite_failed: Supabase Auth returned no user id');
    }
    const link = body['action_link'];
    return {
      id,
      email,
      created: true,
      ...(typeof link === 'string' ? { actionLink: link } : {}),
    };
  }

  const response = await fetchImpl(`${base}/admin/users`, {
    method: 'POST',
    headers: headers(serviceRoleKey),
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const body = await readBody(response);

  if (response.ok) {
    const id = body['id'];
    if (typeof id !== 'string') {
      throw new Error('auth_create_failed: Supabase Auth returned no user id');
    }
    return { id, email, created: true };
  }

  // 422 email_exists, or a 400 from an older GoTrue saying the same thing.
  const message = describe(body, response.status).toLowerCase();
  const alreadyThere =
    body['error_code'] === 'email_exists' ||
    message.includes('already been registered') ||
    message.includes('already registered') ||
    message.includes('already exists');

  if (!alreadyThere) {
    throw new Error(`auth_create_failed: ${describe(body, response.status)}`);
  }

  const existing = await findAuthUserByEmail({
    supabaseUrl,
    serviceRoleKey,
    email,
    fetchImpl,
  });
  if (existing === undefined) {
    throw new Error(
      `auth_create_failed: ${email} already has an account but it could not be read back. ` +
        'Pass --admin-user-id with its id from the Supabase dashboard.',
    );
  }
  return { ...existing, created: false };
};

/** Looks an account up by address through the admin API. */
export async function findAuthUserByEmail({
  supabaseUrl,
  serviceRoleKey,
  email,
  fetchImpl = globalThis.fetch,
}: {
  supabaseUrl: string;
  serviceRoleKey: string;
  email: string;
  fetchImpl?: FetchLike;
}): Promise<AuthUser | undefined> {
  const url = `${authBase(supabaseUrl)}/admin/users?page=1&per_page=200&filter=${encodeURIComponent(email)}`;
  const response = await fetchImpl(url, { headers: headers(serviceRoleKey) });
  if (!response.ok) return undefined;
  const body = await readBody(response);
  const users = body['users'];
  if (!Array.isArray(users)) return undefined;
  for (const candidate of users as Record<string, unknown>[]) {
    if (
      typeof candidate['email'] === 'string' &&
      candidate['email'].toLowerCase() === email.toLowerCase() &&
      typeof candidate['id'] === 'string'
    ) {
      return { id: candidate['id'], email: candidate['email'], created: false };
    }
  }
  return undefined;
}
