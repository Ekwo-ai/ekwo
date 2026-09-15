/**
 * The version a release declares, and the two places it has to appear.
 *
 * `ekwo_schema_version()` is what the migrations define. `instance.schema_version`
 * is what the installation believes it runs. They are written at different
 * moments — one by a migration, one by the installer or by `ekwo migrate` —
 * and a release that bumps the first and not the second leaves every existing
 * installation naming a version it no longer has, which is the number a client
 * refuses an old database on.
 *
 * The expected version is written out rather than read from the function,
 * because a test that asks the code what it says proves nothing. Bumping it is
 * part of cutting a release; `docs/releasing.md` says so in order.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  applyMigrations,
  applySeeds,
  bootstrap,
  listMigrations,
  status,
  syncSchemaVersion,
  type Migration,
  type SqlClient,
} from '../../packages/cli/src/index.js';
import { emptyDatabase, makeAuthUser, migrationsPath, seedPath } from './helpers.js';

/** The schema this release defines. */
const RELEASE = '0.3.0';

/** What `ekwo_schema_version()` returned before the migration of this release. */
const PREVIOUS = '0.2.0';

/** The migration that carries the number, and nothing else. */
const BUMP = 'schema_version_0_3_0';

let db: SqlClient;
let migrations: Migration[];

beforeEach(async () => {
  ({ db } = await emptyDatabase());
  migrations = await listMigrations(migrationsPath);
});

afterEach(async () => {
  await db.close().catch(() => {});
});

async function installCompany(): Promise<void> {
  await applySeeds(db, seedPath);
  await bootstrap(db, {
    organization: 'Example Group',
    country: 'BE',
    company: 'Example One',
    fiscalYear: 2026,
    adminUserId: await makeAuthUser(db, 'first@example.test'),
  });
}

describe('a fresh installation', () => {
  it('records the version of this release on the instance row', async () => {
    await applyMigrations(db, migrations);
    await installCompany();

    const defined = await db.query<{ version: string }>(
      `select ekwo_schema_version() as version`,
    );
    expect(defined[0]?.version).toBe(RELEASE);

    // `init_instance()` calls the function, so the row is right before
    // anything writes it back.
    const row = await db.query<{ schema_version: string }>(
      `select schema_version from instance where id = 1`,
    );
    expect(row[0]?.schema_version).toBe(RELEASE);
  });

  it('leaves `ekwo status` agreeing with itself', async () => {
    await applyMigrations(db, migrations);
    await installCompany();
    await syncSchemaVersion(db);

    const report = await status(db, migrations);
    expect(report.availableVersion).toBe(RELEASE);
    expect(report.installedVersion).toBe(RELEASE);
  });
});

describe('an installation made at the previous version', () => {
  /** Everything this release carries except the file that moves the number. */
  function before(): Migration[] {
    const older = migrations.filter((m) => m.name !== BUMP);
    expect(older.length, 'the migration that bumps the version is named ' + BUMP).toBe(
      migrations.length - 1,
    );
    return older;
  }

  it('is at the previous version, and says so', async () => {
    await applyMigrations(db, before());
    await installCompany();

    const row = await db.query<{ schema_version: string }>(
      `select schema_version from instance where id = 1`,
    );
    expect(row[0]?.schema_version).toBe(PREVIOUS);
  });

  it('reads the new version once `ekwo migrate` has written it back', async () => {
    await applyMigrations(db, before());
    await installCompany();

    // What `ekwo migrate` does: apply what is missing, then write the number
    // the migrations now define onto the row. Between the two the database is
    // at the new version and the row still claims the old one, which is the
    // state the write-back exists for.
    const applied = await applyMigrations(db, migrations);
    expect(applied.applied.map((m) => m.name)).toEqual([BUMP]);

    const stale = await db.query<{ schema_version: string }>(
      `select schema_version from instance where id = 1`,
    );
    expect(stale[0]?.schema_version).toBe(PREVIOUS);

    expect(await syncSchemaVersion(db)).toBe(RELEASE);

    const row = await db.query<{ schema_version: string }>(
      `select schema_version from instance where id = 1`,
    );
    expect(row[0]?.schema_version).toBe(RELEASE);
  });

  it('is refused by a client of this release until it is migrated', async () => {
    const { schemaIsAtLeast } = await import('../../packages/core/src/schema.js');
    const { SCHEMA_MIN } = await import('../../packages/mcp/src/schema.js');

    expect(schemaIsAtLeast(PREVIOUS, SCHEMA_MIN)).toBe(false);
    expect(schemaIsAtLeast(RELEASE, SCHEMA_MIN)).toBe(true);
  });
});

describe('the number the packages declare', () => {
  it('is the same in the three of them', async () => {
    const cli = (await import('../../packages/cli/src/schema.js')).SCHEMA_MIN;
    const core = (await import('../../packages/core/src/schema.js')).SCHEMA_MIN;
    const mcp = (await import('../../packages/mcp/src/schema.js')).SCHEMA_MIN;
    expect([cli, core, mcp]).toEqual([RELEASE, RELEASE, RELEASE]);
  });
});
