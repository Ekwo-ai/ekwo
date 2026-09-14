/**
 * `ekwo init`, end to end, without a Supabase project.
 *
 * Everything `initCommand` does in order, driven directly: migrations, seeds,
 * the administrator, the six steps, the version write-back, `ekwo.json`, and
 * the registration question. Two things are substituted and no more — the
 * GoTrue call and the POST to the registry, both behind an injected `fetch`.
 * The database is a real Postgres.
 *
 * What it is really pinning: after this sequence a company can book an
 * invoice. An installer that leaves a database that cannot post is not an
 * installer.
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  applyDemoSeed,
  applyMigrations,
  applySeeds,
  asUser,
  bootstrap,
  createAuthUser,
  listMigrations,
  readConfig,
  register,
  status,
  syncSchemaVersion,
  writeConfig,
  type SqlClient,
} from '../../packages/cli/src/index.js';
import { emptyDatabase, fakeFetch, migrationsPath, seedPath } from './helpers.js';
import { roleOf, somePack } from '../helpers/packs.js';

const supabaseUrl = 'https://abcdefghijklmnopqrst.supabase.co';
const serviceRoleKey = 'a-service-role-key-that-never-reaches-disk';

let db: SqlClient;
let cwd: string;

beforeEach(async () => {
  ({ db } = await emptyDatabase());
  cwd = await mkdtemp(join(tmpdir(), 'ekwo-init-'));
});

afterEach(async () => {
  await db.close().catch(() => {});
  await rm(cwd, { recursive: true, force: true });
});

/**
 * GoTrue, reduced to what the installer uses: it mints an id, and the id
 * appears in `auth.users` the way a real project would have it.
 */
function shimmedAuth(id: string): ReturnType<typeof fakeFetch> {
  return fakeFetch((url) =>
    url.endsWith('/auth/v1/admin/users')
      ? { status: 200, body: { id, email: 'first@example.test' } }
      : undefined,
  );
}

/**
 * A country, once, for the whole file: the installation these tests run is in
 * some country, and everything they expect about it — the tax it posts with,
 * the sales account it books on — is read from that pack.
 */
const home = somePack;
const HOME = home.manifest.country;
/** The standard domestic sale tax of that pack, at the rate it charges most. */
const saleTax = home.taxes
  .filter((tax) => tax.scope === 'sale' && tax.treatment === 'domestic' && !tax.cash_basis)
  .sort((a, b) => b.rate - a.rate)[0]!;

describe('the full non-interactive install', () => {
  it('leaves an installation that can post an invoice', async () => {
    // 1. Schema.
    const migrations = await listMigrations(migrationsPath);
    await applyMigrations(db, migrations);

    // 2. Reference data, demo file excluded by construction.
    const seeds = await applySeeds(db, seedPath);
    expect(seeds.map((s) => s.file)).not.toContain('90_demo_company.sql');

    // 3. The first administrator, through Supabase Auth.
    const id = '11111111-2222-3333-4444-555555555555';
    const { fetchImpl } = shimmedAuth(id);
    const user = await createAuthUser({
      supabaseUrl,
      serviceRoleKey,
      email: 'first@example.test',
      password: 'a-long-enough-password',
      fetchImpl,
    });
    expect(user.id).toBe(id);
    // A real project has the row by now; the shim stands in for GoTrue.
    await db.query('insert into auth.users (id, email) values ($1, $2)', [
      user.id,
      'first@example.test',
    ]);

    // 4. The six steps.
    const result = await bootstrap(db, {
      organization: 'Example Group',
      country: HOME,
      company: 'Example One',
      fiscalYear: 2026,
      adminUserId: user.id,
    });
    const schemaVersion = await syncSchemaVersion(db);

    // 5. ekwo.json, and nothing secret in it.
    const path = await writeConfig(
      { project_url: supabaseUrl, country: HOME, ...(schemaVersion !== undefined ? { schema_version: schemaVersion } : {}) },
      cwd,
    );
    const written = await readFile(path, 'utf8');
    expect(written).toContain(supabaseUrl);
    expect(written).not.toContain(serviceRoleKey);
    // No value in the file is a secret. The keys are fixed and the only prose
    // is the note saying why there is nothing here to leak.
    const parsed = JSON.parse(written) as Record<string, string>;
    expect(Object.keys(parsed).sort()).toEqual([
      '$comment',
      'country',
      'project_url',
      'schema_version',
    ]);
    for (const [key, value] of Object.entries(parsed)) {
      if (key === '$comment') continue;
      expect(value, key).not.toMatch(/postgres(ql)?:\/\/|eyJ[A-Za-z0-9_-]{10,}/);
    }
    expect(await readConfig(cwd)).toEqual({
      project_url: supabaseUrl,
      country: HOME,
      schema_version: schemaVersion,
    });

    // 6. Registration is offered and the default answer is no, so nothing is
    //    written unless someone asks.
    const report = await status(db, migrations);
    expect(report.instance?.registered_at).toBeNull();
    expect(report.pending).toHaveLength(0);
    expect(report.installedVersion).toBe(report.availableVersion);

    // And now the thing that matters: a sale posts on this installation.
    const contact = await db.query<{ id: string }>(
      `insert into contacts (company_id, name, contact_type, country)
       values ($1, 'A Customer', 'customer', $2) returning id`,
      [result.companyId, HOME],
    );
    const tax = await db.query<{ id: string }>(
      `select id from taxes where company_id = $1 and code = $2`,
      [result.companyId, saleTax.code],
    );
    const account = await db.query<{ id: string }>(
      'select id from accounts where company_id = $1 and code = $2',
      [result.companyId, roleOf(home, 'sales')],
    );
    const document = await db.query<{ id: string }>(
      `insert into documents (company_id, contact_id, doc_type, document_date, currency_code)
       values ($1, $2, 'sale_invoice', date '2026-03-15', 'EUR') returning id`,
      [result.companyId, contact[0]?.id],
    );
    await db.query(
      `insert into document_lines (document_id, company_id, name, quantity, unit_price, account_id, tax_id)
       values ($1, $2, 'Consulting', 1, 1000, $3, $4)`,
      [document[0]?.id, result.companyId, account[0]?.id, tax[0]?.id],
    );
    await db.query('select post_document($1)', [document[0]?.id]);

    const entry = await db.query<{ number: string; total_debit: string; is_balanced: boolean }>(
      `select number, total_debit::text, is_balanced from entries where document_id = $1`,
      [document[0]?.id],
    );
    expect(entry[0]?.is_balanced).toBe(true);
    expect(entry[0]?.total_debit).toBe('1210.00');
    expect(entry[0]?.number).toMatch(/^[A-Z]+\/2026\/0001$/);
  });

  it('records a registration when it is asked for, and survives a dead endpoint', async () => {
    await applyMigrations(db, await listMigrations(migrationsPath));
    await applySeeds(db, seedPath);
    const id = '11111111-2222-3333-4444-555555555555';
    await db.query('insert into auth.users (id, email) values ($1, $2)', [id, 'first@example.test']);
    await bootstrap(db, {
      organization: 'Example Group',
      country: HOME,
      company: 'Example One',
      fiscalYear: 2026,
      adminUserId: id,
    });

    const result = await register(db, {
      adminUserId: id,
      email: 'first@example.test',
      url: 'https://api.ekwo.ai/v1/registrations',
      fetchImpl: async () => {
        throw new Error('connect ECONNREFUSED');
      },
    });

    expect(result.announced).toBe(false);
    expect(result.recordedLocally).toBe(true);
    const instance = await db.query<{ contact_email: string }>(
      'select contact_email from instance',
    );
    expect(instance[0]?.contact_email).toBe('first@example.test');
  });

  it('loads the demo company on top of a real one when it is asked to', async () => {
    await applyMigrations(db, await listMigrations(migrationsPath));
    await applySeeds(db, seedPath);
    const id = '11111111-2222-3333-4444-555555555555';
    await db.query('insert into auth.users (id, email) values ($1, $2)', [id, 'first@example.test']);
    await bootstrap(db, {
      organization: 'Example Group',
      country: HOME,
      company: 'Example One',
      fiscalYear: 2026,
      adminUserId: id,
    });

    // The seed appoints a fictional administrator, and the schema only lets an
    // administrator appoint another. Acting as the real one satisfies that
    // rule rather than going round it.
    await asUser(db, id, () => applyDemoSeed(db, seedPath));

    const companies = await db.query<{ name: string }>('select name from companies order by name');
    expect(companies.map((c) => c.name)).toEqual(['Example One', 'Exemple Conseil']);

    // Twice is still once.
    await asUser(db, id, () => applyDemoSeed(db, seedPath));
    const again = await db.query<{ count: string }>('select count(*)::text from companies');
    expect(again[0]?.count).toBe('2');
  });
});
