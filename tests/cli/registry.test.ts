/**
 * Registering, and not registering.
 *
 * The endpoint at Ekwo does not exist yet, so the case that matters most here
 * is the one where the POST fails: the installation must still know it opted
 * in, and nothing about it may break.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_REGISTRY_URL,
  anyAdminId,
  applyMigrations,
  applySeeds,
  bootstrap,
  listMigrations,
  payloadFor,
  readInstance,
  register,
  registryUrl,
  unregister,
  type SqlClient,
} from '../../packages/cli/src/index.js';
import { emptyDatabase, fakeFetch, makeAuthUser, migrationsPath, seedPath } from './helpers.js';

let db: SqlClient;
let userId: string;

beforeEach(async () => {
  ({ db } = await emptyDatabase());
  await applyMigrations(db, await listMigrations(migrationsPath));
  await applySeeds(db, seedPath);
  userId = await makeAuthUser(db, 'first@example.test');
  await bootstrap(db, {
    organization: 'Example Group',
    country: 'BE',
    company: 'Example One',
    fiscalYear: 2026,
    adminUserId: userId,
  });
});

afterEach(async () => {
  await db.close().catch(() => {});
});

describe('the endpoint', () => {
  it('defaults to api.ekwo.ai and is overridable', () => {
    expect(registryUrl({})).toBe(DEFAULT_REGISTRY_URL);
    expect(registryUrl({ EKWO_REGISTRY_URL: 'http://localhost:9999/x' })).toBe(
      'http://localhost:9999/x',
    );
    expect(registryUrl({ EKWO_REGISTRY_URL: '' })).toBe(DEFAULT_REGISTRY_URL);
  });
});

describe('a fresh installation', () => {
  it('is not registered, and the fields are empty', async () => {
    const instance = await readInstance(db);
    expect(instance?.contact_email).toBeNull();
    expect(instance?.registered_at).toBeNull();
  });
});

describe('register', () => {
  it('writes the instance row and posts the payload', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({ status: 201, body: { ok: true } }));

    const result = await register(db, {
      adminUserId: userId,
      email: 'operator@example.test',
      url: 'https://registry.example/v1/registrations',
      fetchImpl,
    });

    expect(result.recordedLocally).toBe(true);
    expect(result.announced).toBe(true);

    const instance = await readInstance(db);
    expect(instance?.contact_email).toBe('operator@example.test');
    expect(instance?.registered_at).not.toBeNull();

    // Exactly the six fields, and nothing from the ledger.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://registry.example/v1/registrations');
    expect(Object.keys(calls[0]?.body as object).sort()).toEqual([
      'contact_email',
      'country',
      'edition',
      'instance_id',
      'organization',
      'schema_version',
    ]);
    expect(calls[0]?.body).toMatchObject({
      organization: 'Example Group',
      country: 'BE',
      edition: 'community',
      contact_email: 'operator@example.test',
    });
  });

  it('keeps the local registration when the endpoint is not there', async () => {
    const fetchImpl = async (): Promise<Response> => {
      throw new Error('getaddrinfo ENOTFOUND api.ekwo.ai');
    };

    const result = await register(db, {
      adminUserId: userId,
      email: 'operator@example.test',
      fetchImpl,
    });

    expect(result.recordedLocally).toBe(true);
    expect(result.announced).toBe(false);
    expect(result.reason).toContain('ENOTFOUND');

    const instance = await readInstance(db);
    expect(instance?.contact_email).toBe('operator@example.test');
    expect(instance?.registered_at).not.toBeNull();
  });

  it('treats an error status as not announced, without throwing', async () => {
    const { fetchImpl } = fakeFetch(() => ({ status: 503, body: { error: 'not yet' } }));
    const result = await register(db, {
      adminUserId: userId,
      email: 'operator@example.test',
      fetchImpl,
    });
    expect(result.announced).toBe(false);
    expect(result.reason).toContain('503');
  });

  it('corrects the organisation and the country when they are given', async () => {
    const { fetchImpl } = fakeFetch(() => ({ status: 200, body: {} }));
    await register(db, {
      adminUserId: userId,
      email: 'operator@example.test',
      organization: 'Example Group SRL',
      country: 'fr',
      fetchImpl,
    });
    const instance = await readInstance(db);
    expect(instance?.organization_name).toBe('Example Group SRL');
    expect(instance?.country).toBe('FR');
  });

  it('refuses anyone who is not an instance administrator', async () => {
    const stranger = await makeAuthUser(db, 'stranger@example.test');
    const { fetchImpl } = fakeFetch(() => ({ status: 200, body: {} }));
    await expect(
      register(db, { adminUserId: stranger, email: 'x@example.test', fetchImpl }),
    ).rejects.toThrow(/not_instance_admin/);
  });
});

describe('unregister', () => {
  it('puts both fields back to empty', async () => {
    const { fetchImpl } = fakeFetch(() => ({ status: 200, body: {} }));
    await register(db, { adminUserId: userId, email: 'operator@example.test', fetchImpl });

    const after = await unregister(db, userId);
    expect(after?.contact_email).toBeNull();
    expect(after?.registered_at).toBeNull();
  });

  it('is the administrator the CLI acts for', async () => {
    expect(await anyAdminId(db)).toBe(userId);
  });
});

describe('payloadFor', () => {
  it('carries the instance identity and the address, and nothing else', async () => {
    const instance = await readInstance(db);
    if (instance === undefined) throw new Error('no instance row');
    const payload = payloadFor(instance, 'operator@example.test');
    expect(payload).toEqual({
      instance_id: instance.instance_id,
      organization: 'Example Group',
      country: 'BE',
      edition: 'community',
      schema_version: instance.schema_version,
      contact_email: 'operator@example.test',
    });
  });
});
