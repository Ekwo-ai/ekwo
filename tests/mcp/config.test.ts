/**
 * What the server refuses to start with.
 *
 * Two mistakes are easy to make and expensive to discover later: pasting the
 * `service_role` key where the anon key goes, and pointing the server at a
 * database connection with nobody behind it. Both would appear to work — that
 * is precisely the problem — so both are refused here, before a transport is
 * opened.
 */

import { describe, expect, it } from 'vitest';
import { ENV, isServiceRoleKey, readConfig } from '../../packages/mcp/src/index.js';

/** A JWT-shaped key with the given role claim. Signature is never checked. */
function keyWithRole(role: string): string {
  const payload = Buffer.from(JSON.stringify({ iss: 'supabase', role })).toString('base64url');
  return `eyJhbGciOiJIUzI1NiJ9.${payload}.notasignature`;
}

const ANON = keyWithRole('anon');
const USER = '11111111-1111-4111-8111-111111111111';

describe('reading the environment', () => {
  it('takes a project, a key and a password', () => {
    const config = readConfig({
      [ENV.supabaseUrl]: 'https://abcdefghijklmnopqrst.supabase.co',
      [ENV.anonKey]: ANON,
      [ENV.email]: 'you@example.test',
      [ENV.password]: 'a-long-password',
    });
    expect(config.mode).toBe('postgrest');
    expect(config.email).toBe('you@example.test');
  });

  it('takes an access token instead of a password', () => {
    const config = readConfig({
      [ENV.supabaseUrl]: 'https://abcdefghijklmnopqrst.supabase.co',
      [ENV.anonKey]: ANON,
      [ENV.accessToken]: 'an-access-token',
    });
    expect(config.mode).toBe('postgrest');
    expect(config.password).toBeUndefined();
  });

  it('says what is missing rather than failing at the first query', () => {
    expect(() => readConfig({})).toThrow(/missing_configuration/);
    expect(() =>
      readConfig({
        [ENV.supabaseUrl]: 'https://abcdefghijklmnopqrst.supabase.co',
        [ENV.anonKey]: ANON,
      }),
    ).toThrow(/missing_credentials/);
  });
});

describe('the service_role key', () => {
  it('is recognised in both shapes Supabase has issued', () => {
    expect(isServiceRoleKey(keyWithRole('service_role'))).toBe(true);
    expect(isServiceRoleKey('sb_secret_abcdef')).toBe(true);
    expect(isServiceRoleKey(ANON)).toBe(false);
    expect(isServiceRoleKey('sb_publishable_abcdef')).toBe(false);
  });

  it('is refused, because it would answer for companies nobody invited it to', () => {
    expect(() =>
      readConfig({
        [ENV.supabaseUrl]: 'https://abcdefghijklmnopqrst.supabase.co',
        [ENV.anonKey]: keyWithRole('service_role'),
        [ENV.email]: 'you@example.test',
        [ENV.password]: 'a-long-password',
      }),
    ).toThrow(/service_role_refused/);
  });

  // The audit of 13 September 2026. Only the anon slot was checked, and the
  // access token is the one that decides: it travels in `Authorization:
  // Bearer`, which is where PostgREST reads the role from, so it overrides a
  // perfectly good anon key sitting next to it. The refusal has to cover both
  // doors or it covers neither.
  it('is refused in the access token too, where it would override the anon key', () => {
    expect(() =>
      readConfig({
        [ENV.supabaseUrl]: 'https://abcdefghijklmnopqrst.supabase.co',
        [ENV.anonKey]: ANON,
        [ENV.accessToken]: keyWithRole('service_role'),
      }),
    ).toThrow(/service_role_refused/);

    // Both shapes, in that slot as in the other.
    expect(() =>
      readConfig({
        [ENV.supabaseUrl]: 'https://abcdefghijklmnopqrst.supabase.co',
        [ENV.anonKey]: ANON,
        [ENV.accessToken]: 'sb_secret_abcdef',
      }),
    ).toThrow(/service_role_refused/);
  });

  it('leaves a real session token alone', () => {
    const config = readConfig({
      [ENV.supabaseUrl]: 'https://abcdefghijklmnopqrst.supabase.co',
      [ENV.anonKey]: ANON,
      [ENV.accessToken]: keyWithRole('authenticated'),
    });
    expect(config.mode).toBe('postgrest');
    expect(config.accessToken).toBeDefined();
  });
});

describe('the direct Postgres route', () => {
  it('demands the user it acts for', () => {
    expect(() => readConfig({ [ENV.dbUrl]: 'postgresql://postgres@localhost/postgres' })).toThrow(
      /missing_act_as_user/,
    );
    expect(() =>
      readConfig({
        [ENV.dbUrl]: 'postgresql://postgres@localhost/postgres',
        [ENV.actAsUserId]: 'the-admin',
      }),
    ).toThrow(/bad_act_as_user/);
  });

  it('is taken when a database url is given, in preference to the rest', () => {
    const config = readConfig({
      [ENV.dbUrl]: 'postgresql://postgres@localhost/postgres',
      [ENV.actAsUserId]: USER,
      [ENV.supabaseUrl]: 'https://abcdefghijklmnopqrst.supabase.co',
      [ENV.anonKey]: ANON,
    });
    expect(config.mode).toBe('sql');
    expect(config.actAsUserId).toBe(USER);
  });
});
