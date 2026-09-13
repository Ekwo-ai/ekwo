/**
 * The recommended backend: PostgREST, with the user's own session.
 *
 * Supabase already turns the schema into a REST API with an OpenAPI
 * description, and row level security decides what each request may see. So
 * this server holds no privileges of its own: it signs in as the person using
 * it — or is handed their access token — and everything it can do afterwards
 * is what that person can do. There is no service_role path here, on purpose.
 * A server that could read every company would turn "an AI keeps my books"
 * into "an AI holds the keys to everybody's books".
 *
 * `@supabase/supabase-js` does two things this package deliberately does not
 * hand-write: the password grant with its token refresh, and the query string
 * PostgREST expects. Both are the part that cannot be tested here — no test
 * talks to a Supabase project — and a library that is known to work is worth
 * more than code of ours that is merely untested.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  EkwoMcpError,
  explain,
  identifier,
  type Backend,
  type Filter,
  type Row,
  type SelectQuery,
} from './backend.js';

/** The filter half of a PostgREST builder, whatever else it carries. */
interface Filterable<B> {
  eq(column: string, value: never): B;
  neq(column: string, value: never): B;
  gt(column: string, value: never): B;
  gte(column: string, value: never): B;
  lt(column: string, value: never): B;
  lte(column: string, value: never): B;
  in(column: string, values: never): B;
  ilike(column: string, pattern: string): B;
  is(column: string, value: null): B;
}

function applyFilters<B extends Filterable<B>>(builder: B, filters: Filter[] | undefined): B {
  let out = builder;
  for (const filter of filters ?? []) {
    const column = identifier(filter.column);
    switch (filter.op) {
      case 'is':
        out = out.is(column, null);
        break;
      case 'in':
        out = out.in(column, filter.value as never);
        break;
      case 'ilike':
        out = out.ilike(column, filter.value);
        break;
      default:
        out = out[filter.op](column, filter.value as never);
    }
  }
  return out;
}

interface Answer<T> {
  data: T | null;
  error: { message: string; code?: string; details?: string | null; hint?: string | null } | null;
}

/** Unwraps a PostgREST answer, letting the schema's own message through. */
function unwrap<T>(answer: Answer<T>, what: string): T {
  if (answer.error !== null) {
    const { message, details, hint } = answer.error;
    // `details` is where Postgres puts the rest of a raise; keep it.
    const full = [message, details, hint].filter((part) => typeof part === 'string' && part.length > 0).join(' — ');
    throw explain(full.length > 0 ? full : `${what} failed`);
  }
  if (answer.data === null) {
    throw new EkwoMcpError(`${what}: nothing came back`);
  }
  return answer.data;
}

export interface PostgrestBackendOptions {
  supabaseUrl: string;
  anonKey: string;
  /** A session already in hand. Otherwise sign in with the two below. */
  accessToken?: string | undefined;
  email?: string | undefined;
  password?: string | undefined;
}

/**
 * Signs in, or takes the token it was given, and returns the backend.
 *
 * With an email and a password the client keeps the session in memory and
 * refreshes it on its own; nothing is written to disk, so a long-running
 * server outlives the first hour without a credential cache existing.
 */
export async function postgrestBackend(options: PostgrestBackendOptions): Promise<Backend> {
  const headers: Record<string, string> = {};
  if (options.accessToken !== undefined && options.accessToken.length > 0) {
    headers['Authorization'] = `Bearer ${options.accessToken}`;
  }

  const client: SupabaseClient = createClient(options.supabaseUrl, options.anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: options.accessToken === undefined,
      detectSessionInUrl: false,
    },
    global: { headers },
  });

  let actingAs: string | undefined;

  if (options.accessToken === undefined || options.accessToken.length === 0) {
    if (options.email === undefined || options.password === undefined) {
      throw new EkwoMcpError(
        'no_credentials: set EKWO_EMAIL and EKWO_PASSWORD, or EKWO_ACCESS_TOKEN',
      );
    }
    const { data, error } = await client.auth.signInWithPassword({
      email: options.email,
      password: options.password,
    });
    if (error !== null) {
      throw new EkwoMcpError(`sign_in_failed: ${error.message}`);
    }
    actingAs = data.user?.id;
  } else {
    const { data } = await client.auth.getUser(options.accessToken);
    actingAs = data.user?.id;
  }

  /**
   * The client, pointed at one schema.
   *
   * PostgREST serves a schema other than `public` through the `Accept-Profile`
   * and `Content-Profile` headers, which `supabase-js` sets for you through
   * `.schema()`. It answers 406 for a schema the project does not expose, and
   * no migration can expose one — `ekwo module enable` prints the line to add.
   */
  const on = (schema: string | undefined): typeof client =>
    schema === undefined ? client : (client.schema(identifier(schema)) as unknown as typeof client);

  return {
    mode: 'postgrest',
    actingAs,

    async rpc<T>(fn: string, args: Record<string, unknown> = {}, schema?: string): Promise<T[]> {
      const answer = (await on(schema).rpc(identifier(fn), args)) as Answer<unknown>;
      const data = unwrap(answer, fn);
      // A function returning one composite row comes back as an object, a
      // set-returning one as an array. Tools see an array either way.
      return (Array.isArray(data) ? data : [data]) as T[];
    },

    async rpcVoid(fn: string, args: Record<string, unknown> = {}, schema?: string): Promise<void> {
      const answer = (await on(schema).rpc(identifier(fn), args)) as Answer<unknown>;
      if (answer.error !== null) {
        throw explain(answer.error.message);
      }
    },

    async select<T>(query: SelectQuery): Promise<T[]> {
      let builder = on(query.schema).from(identifier(query.table)).select(query.columns.join(','));
      builder = applyFilters(builder, query.where);
      for (const order of query.order ?? []) {
        builder = builder.order(identifier(order.column), { ascending: order.ascending !== false });
      }
      if (query.limit !== undefined) builder = builder.limit(query.limit);
      return unwrap((await builder) as Answer<T[]>, `select from ${query.table}`);
    },

    async insert<T>(
      table: string,
      rows: Row[],
      returning: string[] = ['*'],
      schema?: string,
    ): Promise<T[]> {
      const answer = (await on(schema)
        .from(identifier(table))
        .insert(rows)
        .select(returning.join(','))) as Answer<T[]>;
      return unwrap(answer, `insert into ${table}`);
    },

    async update<T>(
      table: string,
      patch: Row,
      where: Filter[],
      returning: string[] = ['*'],
      schema?: string,
    ): Promise<T[]> {
      let builder = on(schema).from(identifier(table)).update(patch);
      builder = applyFilters(builder, where);
      const answer = (await builder.select(returning.join(','))) as Answer<T[]>;
      return unwrap(answer, `update ${table}`);
    },

    async remove(table: string, where: Filter[], schema?: string): Promise<void> {
      let builder = on(schema).from(identifier(table)).delete();
      builder = applyFilters(builder, where);
      const answer = (await builder) as Answer<unknown>;
      if (answer.error !== null) throw explain(answer.error.message);
    },

    async close(): Promise<void> {
      // Stops the refresh timer; there is no socket to give back.
      await client.auth.stopAutoRefresh();
    },
  };
}
