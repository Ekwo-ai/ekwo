/**
 * `ekwo pack status` and `ekwo pack upgrade`, against a real installation.
 *
 * The three rules live in the schema, and `tests/pack_upgrade.test.ts` proves
 * them there from the published 1.0.0 seeds. What is under test here is the
 * half the CLI owns: reading an installation company by company, resolving the
 * company an operator names, and handing back a result whose shape an
 * operator — or a script reading `--json` — can act on.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  applyMigrations,
  applySeeds,
  bootstrap,
  listMigrations,
  packDiff,
  packStatus,
  packUpgrade,
  resolveCompany,
  type Migration,
  type SqlClient,
} from '../../packages/cli/src/index.js';
import { emptyDatabase, makeAuthUser, migrationsPath, seedPath } from './helpers.js';

let db: SqlClient;
let migrations: Migration[];
let companyId: string;

beforeEach(async () => {
  ({ db } = await emptyDatabase());
  migrations = await listMigrations(migrationsPath);
  await applyMigrations(db, migrations);
  await applySeeds(db, seedPath);
  const userId = await makeAuthUser(db, 'first@example.test');
  const result = await bootstrap(db, {
    organization: 'Example Group',
    country: 'BE',
    company: 'Example One',
    fiscalYear: 2026,
    adminUserId: userId,
  });
  companyId = result.companyId;
});

afterEach(async () => {
  await db.close().catch(() => {});
});

describe('pack status', () => {
  it('reports the packs loaded here and where each company stands', async () => {
    const report = await packStatus(db);

    expect(report.packs.map((p) => p.country)).toContain('BE');
    const company = report.companies.find((c) => c.name === 'Example One');
    expect(company).toBeDefined();
    expect(company?.country).toBe('BE');
    expect(company?.chartCode).toBe('default');
    expect(company?.heldVersion).toBe(company?.packVersion);
    expect(company?.behind).toBe(false);
    expect(company?.differences).toEqual({ additions: 0, closures: 0, review: 0 });
  });

  it('says a company is behind, and counts the difference by rule', async () => {
    // What an installation looks like the day a new release lands: the pack
    // is newer than what the company copied. Only the recorded version is
    // moved back, which is exactly the state `ekwo status` warns about.
    await db.query(`update company_packs set version = '1.0.0' where company_id = $1`, [companyId]);
    await db.query(`delete from taxes where company_id = $1 and code = 'BE-S-06'`, [companyId]);

    const report = await packStatus(db);
    const company = report.companies.find((c) => c.name === 'Example One');
    expect(company?.behind).toBe(true);
    expect(company?.heldVersion).toBe('1.0.0');
    expect(company?.differences?.additions).toBe(1);
  });
});

describe('resolving the company an operator names', () => {
  it('takes a name or an id', async () => {
    expect((await resolveCompany(db, 'Example One')).id).toBe(companyId);
    expect((await resolveCompany(db, 'example one')).id).toBe(companyId);
    expect((await resolveCompany(db, companyId)).name).toBe('Example One');
  });

  it('lists what there is rather than guessing', async () => {
    await expect(resolveCompany(db, 'Nobody')).rejects.toThrow(/unknown_company/);
    await expect(resolveCompany(db, 'Nobody')).rejects.toThrow(/Example One/);
  });

  it('refuses two companies of the same name rather than picking one', async () => {
    await db.query(
      `insert into companies (name, country, fiscal_country, currency_code, language)
       select 'Example One', 'BE', 'BE', d.currency_code, d.language_default
         from country_defaults d where d.country = 'BE'`,
    );
    await expect(resolveCompany(db, 'Example One')).rejects.toThrow(/ambiguous_company/);
  });
});

describe('pack upgrade', () => {
  beforeEach(async () => {
    await db.query(`update company_packs set version = '1.0.0' where company_id = $1`, [companyId]);
  });

  it('applies an addition without being asked, and records the version', async () => {
    await db.query(`delete from taxes where company_id = $1 and code = 'BE-S-06'`, [companyId]);

    const result = await packUpgrade(db, companyId);
    expect(result.from_version).toBe('1.0.0');
    expect(result.applied.map((c) => c.key)).toContain('BE-S-06');
    expect(result.applied.every((c) => c.rule === 'addition' || c.rule === 'closure')).toBe(true);
    expect(result.listed).toHaveLength(0);
    expect(result.version_moved).toBe(true);

    const held = await db.query<{ version: string }>(
      `select version from company_packs where company_id = $1`,
      [companyId],
    );
    expect(held[0]?.version).toBe(result.to_version);
  });

  it('lists what differs and changes nothing, until it is asked', async () => {
    await db.query(
      `update accounts set name = 'Renommé par l''opérateur' where company_id = $1 and code = '700000'`,
      [companyId],
    );

    const listedRun = await packUpgrade(db, companyId);
    expect(listedRun.listed.map((c) => c.key)).toContain('700000');
    expect(listedRun.applied.map((c) => c.key)).not.toContain('700000');
    expect(listedRun.version_moved).toBe(false);

    const untouched = await db.query<{ name: string }>(
      `select name from accounts where company_id = $1 and code = '700000'`,
      [companyId],
    );
    expect(untouched[0]?.name).toBe('Renommé par l\'opérateur');

    const appliedRun = await packUpgrade(db, companyId, { apply: true });
    expect(appliedRun.applied.map((c) => c.key)).toContain('700000');
    expect(appliedRun.version_moved).toBe(true);

    const rewritten = await db.query<{ name: string }>(
      `select name from accounts where company_id = $1 and code = '700000'`,
      [companyId],
    );
    expect(rewritten[0]?.name).not.toBe('Renommé par l\'opérateur');
  });

  it('closes a validity the pack has closed', async () => {
    await db.query(
      `update tax_templates set valid_to = date '2026-12-31' where country = 'BE' and code = 'BE-S-21'`,
    );

    const diff = await packDiff(db, companyId);
    const closure = diff.find((d) => d.key === 'BE-S-21' && d.change === 'valid_to');
    expect(closure?.rule).toBe('closure');

    const result = await packUpgrade(db, companyId);
    expect(result.applied.map((c) => c.change)).toContain('valid_to');
    const held = await db.query<{ valid_to: string }>(
      `select valid_to::text as valid_to from taxes where company_id = $1 and code = 'BE-S-21'`,
      [companyId],
    );
    expect(held[0]?.valid_to).toBe('2026-12-31');
  });

  it('never takes an account away, even when asked to apply everything', async () => {
    await db.query(
      `insert into accounts (company_id, code, name, account_type)
       values ($1, '999500', 'Compte maison', 'expense')`,
      [companyId],
    );

    const result = await packUpgrade(db, companyId, { apply: true });
    expect(result.never_applied.map((c) => c.key)).toContain('999500');
    const still = await db.query<{ code: string }>(
      `select code from accounts where company_id = $1 and code = '999500'`,
      [companyId],
    );
    expect(still).toHaveLength(1);
  });

  it('writes what it did into the audit trail', async () => {
    await db.query(`delete from taxes where company_id = $1 and code = 'BE-S-06'`, [companyId]);
    await packUpgrade(db, companyId);

    const written = await db.query<{ action: string; new_values: Record<string, unknown> }>(
      `select action, new_values from audit_log
        where company_id = $1 and action = 'pack_upgraded'`,
      [companyId],
    );
    expect(written).toHaveLength(1);
    expect(Array.isArray(written[0]?.new_values['applied'])).toBe(true);
  });
});

describe('what the doctor says about the audit trail', () => {
  it('is content when it is append-only and nobody can write it', async () => {
    const { doctor } = await import('../../packages/cli/src/index.js');
    const report = await doctor(db, migrations);
    const check = report.checks.find((c) => c.name === 'audit trail');
    expect(check?.severity).toBe('ok');
  });

  it('names a policy that would let a client write the trail', async () => {
    const { doctor } = await import('../../packages/cli/src/index.js');
    await db.exec(
      `create policy audit_log_insert on audit_log for insert with check (true);`,
    );
    const report = await doctor(db, migrations);
    const check = report.checks.find((c) => c.name === 'audit trail');
    expect(check?.severity).toBe('problem');
    expect(check?.details?.join(' ')).toMatch(/append-only/);
  });

  it('names the guard trigger gone', async () => {
    const { doctor } = await import('../../packages/cli/src/index.js');
    await db.exec(`drop trigger audit_log_append_only on audit_log;`);
    const report = await doctor(db, migrations);
    const check = report.checks.find((c) => c.name === 'audit trail');
    expect(check?.severity).toBe('problem');
    expect(check?.details?.join(' ')).toMatch(/no trigger on audit_log/);
  });
});

describe('before a migration runs', () => {
  it('recommends a snapshot, and says why there is no way back without one', async () => {
    const { snapshotRecommendation } = await import('../../packages/cli/src/index.js');
    const written: string[] = [];
    const out = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((text: string) => {
      written.push(text);
      return true;
    }) as typeof process.stdout.write;
    try {
      snapshotRecommendation();
    } finally {
      process.stdout.write = out;
    }
    const printed = written.join('');
    expect(printed).toMatch(/snapshot/i);
    expect(printed).toMatch(/forward only/i);
    expect(printed).toMatch(/pg_dump/);
  });
});

describe('the schema floor each package declares', () => {
  it('is in the manifest and in the code, and they agree', async () => {
    const repo = join(migrationsPath, '..', '..');
    for (const [pkg, constant] of [
      ['packages/cli', (await import('../../packages/cli/src/schema.js')).SCHEMA_MIN],
      ['packages/core', (await import('../../packages/core/src/schema.js')).SCHEMA_MIN],
      ['packages/mcp', (await import('../../packages/mcp/src/schema.js')).SCHEMA_MIN],
    ] as const) {
      const manifest = JSON.parse(
        await readFile(join(repo, pkg, 'package.json'), 'utf8'),
      ) as { ekwo?: { schemaMin?: string } };
      expect(manifest.ekwo?.schemaMin, `${pkg} declares it`).toBe(constant);
    }
  });

  it('is never newer than the schema this release defines', async () => {
    const { compareSchemaVersions } = await import('../../packages/core/src/schema.js');
    const defined = await db.query<{ version: string }>(`select ekwo_schema_version() as version`);
    const { SCHEMA_MIN } = await import('../../packages/mcp/src/schema.js');
    expect(compareSchemaVersions(defined[0]?.version as string, SCHEMA_MIN)).toBeGreaterThanOrEqual(0);
  });
});
