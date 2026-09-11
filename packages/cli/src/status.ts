/**
 * `ekwo status` — what is installed, against what this CLI carries.
 *
 * Two versions matter and they are not the same thing. `instance.schema_version`
 * is what the installation believes it runs; `ekwo_schema_version()` is what
 * the migrations actually define. They diverge when a migration bumped the
 * function but nothing wrote it back onto the row, which is precisely the case
 * `ekwo migrate` closes.
 */

import type { Migration } from './migrations.js';
import { migrationGap } from './migrations.js';
import { readInstance, type InstanceRow } from './registry.js';
import type { SqlClient } from './sql.js';
import { scalar } from './sql.js';

export interface CompanySummary {
  name: string;
  country: string;
  accounts: number;
  entries: number;
  fiscalYears: number;
}

export interface Status {
  schemaInstalled: boolean;
  /** Version recorded on the instance row. */
  installedVersion: string | null;
  /** Version the applied migrations define. */
  availableVersion: string | null;
  appliedCount: number;
  pending: Migration[];
  unknown: string[];
  instance: InstanceRow | undefined;
  admins: number;
  companies: CompanySummary[];
}

export async function status(db: SqlClient, migrations: Migration[]): Promise<Status> {
  const schemaInstalled =
    (await scalar<boolean>(
      db,
      `select exists (
         select 1 from information_schema.tables
          where table_schema = 'public' and table_name = 'instance'
       )`,
    )) === true;

  const gap = await migrationGap(db, migrations);

  if (!schemaInstalled) {
    return {
      schemaInstalled: false,
      installedVersion: null,
      availableVersion: null,
      appliedCount: gap.applied.length,
      pending: gap.pending,
      unknown: gap.unknown,
      instance: undefined,
      admins: 0,
      companies: [],
    };
  }

  const instance = await readInstance(db);
  const availableVersion = (await scalar<string>(db, 'select ekwo_schema_version()')) ?? null;
  const admins = Number((await scalar<string>(db, 'select count(*)::text from instance_admins')) ?? '0');

  const companies = await db.query<{
    name: string;
    country: string;
    accounts: string;
    entries: string;
    fiscal_years: string;
  }>(
    `select c.name,
            c.country,
            (select count(*) from accounts a where a.company_id = c.id)::text as accounts,
            (select count(*) from entries e where e.company_id = c.id)::text as entries,
            (select count(*) from fiscal_years f where f.company_id = c.id)::text as fiscal_years
       from companies c
      order by c.name`,
  );

  return {
    schemaInstalled: true,
    installedVersion: instance?.schema_version ?? null,
    availableVersion,
    appliedCount: gap.applied.length,
    pending: gap.pending,
    unknown: gap.unknown,
    instance,
    admins,
    companies: companies.map((c) => ({
      name: c.name,
      country: c.country,
      accounts: Number(c.accounts),
      entries: Number(c.entries),
      fiscalYears: Number(c.fiscal_years),
    })),
  };
}

/**
 * Writes the version the migrations define back onto the instance row.
 *
 * Called at the end of `ekwo migrate`, so `status` stops disagreeing with
 * itself. It is the only place the CLI writes `schema_version`.
 */
export async function syncSchemaVersion(db: SqlClient): Promise<string | undefined> {
  const version = await scalar<string>(db, 'select ekwo_schema_version()');
  if (version === undefined) return undefined;
  await db.query('update instance set schema_version = $1 where id = 1', [version]);
  return version;
}
