/**
 * The schema grants its own rights, and this is what says so.
 *
 * Until `20260914151207` not one migration gave `anon` or `authenticated` a
 * privilege on a table. Everything worked because a Supabase project carries
 * default privileges on `public` that hand `all` on every new table to the
 * three API roles — so row level security was the only thing between an
 * anonymous request and the ledger, and an installation whose `public` schema
 * was recreated answered "permission denied for table companies" to its first
 * read while `ekwo doctor` reported perfect health.
 *
 * Four claims are made here, and each is asked of a database rather than of a
 * list somebody keeps:
 *
 *   1. what the catalogue holds is what the `grants` section of
 *      `packages/cli/assets/expected-objects.json` declares, object by object
 *      and role by role;
 *   2. the doctrine holds — `anon` reaches no table, a grant on a table says
 *      the same thing as the policies on it, and a trigger body is callable by
 *      nobody;
 *   3. a database whose roles start with nothing at all, and where no default
 *      privilege exists, is fully working after the migrations alone: a whole
 *      country pack's golden scenario is booked through it as `authenticated`;
 *   4. and the third claim is not vacuous — take one grant away and the same
 *      scenario stops.
 *
 * The harness stopped helping. `tests/helpers/supabase-shim.sql` used to end
 * with the project's default privileges and `freshDatabase` with a `grant …
 * on all tables in schema public`, which between them made every test in this
 * repository pass against privileges no installation was guaranteed to have.
 * Both are gone, so every other file here is now also a test of the grants.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  GRANT_ROLES,
  compareSection,
  describeGrants,
  listPacks,
  readExpectedObjects,
  readPack,
  type ExpectedObjects,
  type GrantsSection,
  type Pack,
  type PackGolden,
  type QueryRows,
} from '../packages/cli/src/index.js';
import {
  asUser,
  expectError,
  freshDatabase,
  migrationFiles,
  moduleMigrationFiles,
  moduleSeedFiles,
  repoRoot,
  rows,
  seedFiles,
  shimPath,
} from './helpers/db.js';
import { newCompany } from './helpers/factory.js';
import { replayScenario } from './helpers/golden-scenario.js';

/** `describeGrants` wants rows; PGlite returns a result around them. */
const queryRows =
  (db: PGlite): QueryRows =>
  async <T>(sql: string, params: unknown[]) =>
    (await db.query<T>(sql, params)).rows;

/** The first pack of this checkout that carries a year of books. */
async function aPackWithAScenario(): Promise<{ pack: Pack; golden: PackGolden }> {
  for (const slug of await listPacks()) {
    const pack = await readPack(slug);
    if (pack.golden !== null) return { pack, golden: pack.golden };
  }
  throw new Error('no pack of this checkout carries a golden scenario');
}

/**
 * A database where the three roles begin with nothing whatsoever.
 *
 * The shim creates them and gives them `usage` on `auth`, which is Supabase's
 * schema and not Ekwo's to grant. Everything else is taken away before the
 * first migration runs — including the default privileges, which is the
 * mechanism this whole change exists to stop relying on — and the assertions
 * below are about what the migrations put back.
 */
async function strippedDatabase(): Promise<PGlite> {
  const db = new PGlite();
  await db.waitReady;
  await db.exec(await readFile(shimPath, 'utf8'));

  await db.exec(`
    revoke all privileges on schema public from anon, authenticated, service_role;
    revoke all privileges on all tables    in schema public from anon, authenticated, service_role;
    revoke all privileges on all sequences in schema public from anon, authenticated, service_role;
    revoke all privileges on all functions in schema public from public, anon, authenticated, service_role;
    alter default privileges in schema public revoke all on tables    from anon, authenticated, service_role;
    alter default privileges in schema public revoke all on sequences from anon, authenticated, service_role;
    alter default privileges in schema public revoke all on functions from public, anon, authenticated, service_role;
  `);

  for (const file of await migrationFiles()) {
    await db.exec(await readFile(join(repoRoot, 'supabase', 'migrations', file), 'utf8'));
  }
  for (const migration of await moduleMigrationFiles()) {
    await db.exec(await readFile(migration.path, 'utf8'));
  }
  for (const file of await seedFiles()) {
    await db.exec(await readFile(join(repoRoot, 'supabase', 'seed', file), 'utf8'));
  }
  for (const seed of await moduleSeedFiles()) {
    await db.exec(await readFile(seed.path, 'utf8'));
  }
  await db.exec(`select set_config('ekwo.installing', 'on', false);`);
  return db;
}

// ---------------------------------------------------------------------------
// 1. The catalogue against the inventory this release carries
// ---------------------------------------------------------------------------

describe('the inventory of privileges this release declares', () => {
  let db: PGlite;
  let expected: ExpectedObjects;

  beforeAll(async () => {
    db = await freshDatabase({ seed: false });
    const inventory = await readExpectedObjects();
    if (inventory === undefined) throw new Error('this checkout ships no inventory');
    expected = inventory;
  }, 180_000);

  afterAll(async () => {
    await db.close();
  });

  it('is exactly what a freshly migrated database holds', async () => {
    const lines: string[] = [];
    for (const section of [expected.socle, ...expected.modules]) {
      const actual = await describeGrants(queryRows(db), section.schema);
      // Printed rather than counted: a failure here has to name the object and
      // the role, or the next person regenerates the file and moves on.
      for (const finding of compareSection(section.grants, actual)) {
        lines.push(
          `${finding.schema}.${finding.object}: ${finding.role} ${finding.difference} ${finding.privileges.join(',')}`,
        );
      }
      expect(actual.defaultPrivileges, section.schema).toEqual([]);
    }
    expect(lines).toEqual([]);
  });

  it('covers every schema this checkout installs', async () => {
    const installed = await rows<{ schema_name: string }>(
      db,
      `select schema_name from modules order by code`,
    );
    expect(expected.modules.map((m) => m.schema).sort()).toEqual(
      installed.map((r) => r.schema_name).sort(),
    );
  });

  it('names the three roles, and says what each holds even when it holds nothing', async () => {
    const socle = expected.socle.grants;
    for (const object of [...socle.tables, ...socle.views, ...socle.functions]) {
      for (const role of GRANT_ROLES) {
        expect(Array.isArray(object[role]), `${object.name}.${role}`).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 2. The doctrine, asked of the catalogue
// ---------------------------------------------------------------------------

describe('what the grants say, against what the policies say', () => {
  let db: PGlite;
  let sections: GrantsSection[];

  beforeAll(async () => {
    db = await freshDatabase({ seed: false });
    const installed = await rows<{ schema_name: string }>(db, `select schema_name from modules`);
    sections = [];
    for (const schema of ['public', ...installed.map((r) => r.schema_name)]) {
      sections.push(await describeGrants(queryRows(db), schema));
    }
  }, 180_000);

  afterAll(async () => {
    await db.close();
  });

  it('leaves the anonymous role nothing on any table, view or sequence', () => {
    const held: string[] = [];
    for (const section of sections) {
      for (const object of [...section.tables, ...section.views, ...section.sequences]) {
        if (object.anon.length > 0) held.push(`${section.schema}.${object.name}: ${object.anon.join(',')}`);
      }
    }
    expect(held).toEqual([]);
  });

  it('leaves the anonymous role exactly the helpers a policy evaluates on its behalf', () => {
    // The doctrine of `20260911210131`, unchanged: those functions answer about
    // `auth.uid()`, which is null for `anon`, so what they give away is the
    // word *no*. The list is asserted rather than counted, because a tenth
    // entry appearing here is a decision and not a detail.
    //
    // `shared_document` is the one entry that is not a policy helper. It is a
    // door rather than an answer about the caller: `20260915153000` publishes
    // one document to whoever presents its token, and nothing else — no table
    // is reached on the visitor's behalf, and a token that is not a live link
    // gets the same null as a token that never existed.
    const callable = sections
      .flatMap((s) => s.functions.filter((f) => f.anon.length > 0).map((f) => `${s.schema}.${f.name}`))
      .sort();
    expect(callable).toEqual([
      'public.can_write_company',
      'public.company_has_no_member',
      'public.company_role',
      'public.has_capability',
      'public.instance_has_no_admin',
      'public.is_any_company_member',
      'public.is_company_member',
      'public.is_company_owner',
      'public.is_instance_admin',
      'public.module_enabled',
      'public.shared_document',
    ]);
  });

  it('gives a signed-in user the verbs the policies of that table are prepared to judge', async () => {
    // The rule, in one sentence: a grant and a policy are two halves of the
    // same statement, and a table that grants DELETE with no delete policy is
    // a table whose schema says two different things. Read from `pg_policy`,
    // so nothing here is a list kept by hand.
    const policies = await rows<{ schema: string; table_name: string; commands: string[] }>(
      db,
      `select n.nspname as schema, c.relname as table_name,
              coalesce(array_agg(distinct p.polcmd::text) filter (where p.polcmd is not null), '{}') as commands
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
         left join pg_policy p on p.polrelid = c.oid
        where n.nspname = any($1::text[]) and c.relkind = 'r'
        group by 1, 2`,
      [sections.map((s) => s.schema)],
    );

    const verb: Record<string, string> = { r: 'select', a: 'insert', w: 'update', d: 'delete' };
    const mismatch: string[] = [];
    for (const row of policies) {
      const allowed = new Set<string>();
      for (const command of row.commands) {
        if (command === '*') for (const v of Object.values(verb)) allowed.add(v);
        else if (verb[command] !== undefined) allowed.add(verb[command] as string);
      }
      const section = sections.find((s) => s.schema === row.schema);
      const granted = section?.tables.find((t) => t.name === row.table_name)?.authenticated ?? [];
      const expected = [...allowed].sort().join(',');
      if (granted.join(',') !== expected) {
        mismatch.push(`${row.schema}.${row.table_name}: granted ${granted.join(',')}, policies allow ${expected}`);
      }
    }
    expect(mismatch).toEqual([]);
  });

  it('grants the backend role no more than a person, table by table', () => {
    const wider: string[] = [];
    for (const section of sections) {
      for (const object of [...section.tables, ...section.views]) {
        if (object.service_role.join(',') !== object.authenticated.join(',')) {
          wider.push(`${section.schema}.${object.name}`);
        }
      }
    }
    expect(wider).toEqual([]);
  });

  it('leaves a trigger body callable by nobody', () => {
    // PostgreSQL checks EXECUTE when a trigger is created, never when it
    // fires, so a trigger function needs no grant. One that has one is an RPC
    // endpoint answering "trigger functions can only be called as triggers".
    const callable: string[] = [];
    for (const section of sections) {
      for (const fn of section.functions.filter((f) => f.trigger === true)) {
        for (const role of GRANT_ROLES) {
          if (fn[role].length > 0) callable.push(`${section.schema}.${fn.name}: ${role}`);
        }
      }
    }
    expect(callable).toEqual([]);
  });

  it('reserves two functions to the connections that are not a client', () => {
    const socle = sections.find((s) => s.schema === 'public');
    const closed = (socle?.functions ?? [])
      .filter((f) => f.trigger !== true && f.authenticated.length === 0)
      .map((f) => f.name)
      .sort();
    // `audit_record` writes the trail and `purge_audit_log` empties it. A
    // client that could call either could write a history that never happened,
    // or erase one that did.
    expect(closed).toEqual(['audit_record', 'purge_audit_log']);
  });

  it('keeps every other callable function reachable by a signed-in user', () => {
    const unreachable: string[] = [];
    for (const section of sections) {
      for (const fn of section.functions) {
        if (fn.trigger === true) continue;
        if (['audit_record', 'purge_audit_log'].includes(fn.name)) continue;
        if (!fn.authenticated.includes('execute')) unreachable.push(`${section.schema}.${fn.name}`);
      }
    }
    expect(unreachable).toEqual([]);
  });

  it('depends on no default privilege, in any schema', () => {
    // The finding of the first real end-to-end run, as an assertion. A row
    // here is a privilege that comes from `pg_default_acl` rather than from a
    // migration, which is to say from something the installer never wrote and
    // a `drop schema public` takes away.
    expect(sections.flatMap((s) => s.defaultPrivileges.map((d) => `${s.schema}: ${d}`))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 3. Revoke everything, replay the migrations, book a year
// ---------------------------------------------------------------------------

describe('a database whose roles start with nothing at all', () => {
  let db: PGlite;
  let pack: Pack;
  let golden: PackGolden;
  let companyId: string;
  let ownerId: string;

  beforeAll(async () => {
    ({ pack, golden } = await aPackWithAScenario());
    db = await strippedDatabase();
    const fixture = await newCompany(db, {
      country: pack.manifest.country,
      name: golden.name,
      chart: golden.chart,
      language: golden.language,
      fiscalYear: golden.fiscalYear,
    });
    companyId = fixture.companyId;
    ownerId = fixture.ownerId;
  }, 300_000);

  afterAll(async () => {
    await db.close();
  });

  it('holds no default privilege once the migrations have run', async () => {
    const left = await rows<{ n: string }>(
      db,
      `select count(*)::text as n
         from pg_default_acl d
         join pg_namespace n on n.oid = d.defaclnamespace
        where n.nspname in ('public', 'assets', 'budgets')`,
    );
    expect(left[0]?.n).toBe('0');
  });

  it('books a whole year of a country pack as a signed-in user', async () => {
    // The claim of this file, in one act. Everything the scenario touches —
    // the documents and their lines, the payments, the matching, the counters,
    // the audit trail written behind it — is reached through PostgREST's own
    // role, on a database where the only privileges that exist are the ones a
    // migration wrote down. A single missing grant stops it.
    await asUser(db, ownerId, async () => {
      await replayScenario(db, companyId, golden);
    });

    const posted = await rows<{ n: string }>(
      db,
      `select count(*)::text as n from entries where company_id = $1 and state = 'posted'`,
      [companyId],
    );
    expect(Number(posted[0]?.n ?? '0')).toBeGreaterThan(0);
  }, 300_000);

  it('lets that user read the reports and the views the application draws', async () => {
    await asUser(db, ownerId, async () => {
      const balance = await rows(
        db,
        `select * from trial_balance($1, $2::date, $3::date)`,
        [companyId, golden.fiscalYear.start, golden.fiscalYear.end],
      );
      expect(balance.length).toBeGreaterThan(0);

      for (const view of [
        'document_header',
        'document_legal_mentions',
        'document_line_items',
        'document_tax_summary',
      ]) {
        const seen = await rows(db, `select * from ${view} limit 1`);
        expect(Array.isArray(seen), view).toBe(true);
      }
    });
  });

  it('shows the anonymous role a closed door rather than an empty room', async () => {
    await asUser(
      db,
      ownerId,
      async () => {
        for (const sql of ['select * from companies', 'select * from entries', 'select * from document_header']) {
          expect(await expectError(db, sql), sql).toMatch(/permission denied/);
        }
      },
      'anon',
    );
  });

  it('stops as soon as one grant is taken away, which is what makes the rest of this file mean something', async () => {
    // Last, because it breaks the database it runs on. Without it the claim
    // above is unfalsifiable: a scenario that would pass whatever the grants
    // are proves nothing about them.
    await db.exec(`revoke select on table documents from authenticated;`);
    await asUser(db, ownerId, async () => {
      expect(await expectError(db, `select id from documents where company_id = $1`, [companyId])).toMatch(
        /permission denied for table documents/,
      );
      // And through the view above it, which is `security_invoker`: a reader
      // needs the privilege on the view *and* on the tables under it, so one
      // missing grant closes both.
      expect(await expectError(db, `select * from document_header`)).toMatch(
        /permission denied for table documents/,
      );
    });
  });
});
