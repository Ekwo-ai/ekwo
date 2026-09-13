import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asUser,
  expectError,
  freshDatabase,
  migrationFiles,
  moduleCodes,
  moduleMigrationFiles,
  one,
  repoRoot,
  rows,
} from './helpers/db.js';
import { newCompany, newInstanceAdmin } from './helpers/factory.js';
import { listModules, readModuleSchema } from '../packages/cli/src/module/read.js';
import { validate } from '../packages/cli/src/pack/schema.js';

// The module mechanism, and the rules that keep a module a module.
//
// Half of this file is the machinery — a registry that is a table, an enable
// that is a function, a ledger that is reached through one entry point — and
// half is the guards. The guards are the point: "a module never writes the
// ledger by hand" and "a module knows no country" are promises until something
// checks them on every file of `modules/**`, and then they are rules.

let db: PGlite;
let companyId: string;
let ownerId: string;
let strangerId: string;

const modulesDir = join(repoRoot, 'modules');

beforeAll(async () => {
  db = await freshDatabase();
  ({ companyId, ownerId } = await newCompany(db, { country: 'BE', name: 'Modules SRL' }));
  strangerId = await newInstanceAdmin(db);
});

afterAll(async () => {
  await db.close();
});

// ---------------------------------------------------------------- the registry

describe('the registry', () => {
  it('is a table, holding one row per module of this release', async () => {
    const installed = await rows<{ code: string; schema_name: string; status: string }>(
      db,
      `select code, schema_name, status::text from modules order by code`,
    );
    expect(installed.map((m) => m.code)).toEqual(await moduleCodes());
    for (const module of installed) expect(module.schema_name).toBe(module.code);
  });

  it('agrees with the manifest each module ships', async () => {
    const installed = new Map(
      (await rows<{ code: string; version: string; schema_name: string; requires_socle_min: string }>(
        db,
        `select code, version, schema_name, requires_socle_min from modules`,
      )).map((row) => [row.code, row]),
    );
    for (const module of await listModules(modulesDir)) {
      const row = installed.get(module.manifest.code);
      expect(row, `${module.manifest.code} is not in public.modules`).toBeDefined();
      expect(row?.version).toBe(module.manifest.version);
      expect(row?.schema_name).toBe(module.manifest.schema);
      expect(row?.requires_socle_min ?? undefined).toBe(module.manifest.requires_socle_min);
    }
  });

  it('holds a schema that exists, and no schema it does not claim', async () => {
    const schemas = (
      await rows<{ nspname: string }>(
        db,
        `select nspname from pg_namespace
          where nspname not in ('public', 'auth', 'pg_catalog', 'information_schema', 'pg_toast')
            and nspname not like 'pg_temp%' and nspname not like 'pg_toast_temp%'
            and nspname <> 'supabase_migrations'
          order by 1`,
      )
    ).map((s) => s.nspname);
    const claimed = (
      await rows<{ schema_name: string }>(db, `select schema_name from modules order by 1`)
    ).map((m) => m.schema_name);
    expect(schemas).toEqual(claimed);
  });
});

// ------------------------------------------------------------ enable / disable

describe('enabling a module', () => {
  it('needs company.write, which the accountant preset does not hold', async () => {
    const accountant = crypto.randomUUID();
    await db.query(
      `insert into company_members (company_id, user_id, role) values ($1, $2, 'accountant')`,
      [companyId, accountant],
    );
    const message = await asUser(db, accountant, () =>
      expectError(db, `select enable_module($1, 'budgets')`, [companyId]),
    );
    expect(message).toMatch(/not_allowed: enabling a module on this company needs company.write/);

    const row = await asUser(db, ownerId, () =>
      one<{ enable_module: string }>(db, `select enable_module($1, 'budgets')`, [companyId]),
    );
    expect(row.enable_module).toContain('budgets');
  });

  // The guard used to be `if not is_company_owner(p_company_id)`, and
  // `is_company_owner` answered NULL for somebody who is not a member at all.
  // `not NULL` is NULL, the `if` never branched, and this was the exploit:
  // `company_modules` has no write policy, so the definer function was the
  // only door and it stood open to anyone with a login.
  it('is closed to the owner of another company, who is a member of nothing here', async () => {
    const other = await newCompany(db, { country: 'BE', name: 'Ailleurs SRL' });

    const enabling = await asUser(db, other.ownerId, () =>
      expectError(db, `select enable_module($1, 'budgets')`, [companyId]),
    );
    expect(enabling).toMatch(/not_allowed/);

    const disabling = await asUser(db, other.ownerId, () =>
      expectError(db, `select disable_module($1, 'budgets')`, [companyId]),
    );
    expect(disabling).toMatch(/not_allowed/);

    // And the settings, which `enable_module` doubles as the writer of.
    const overwriting = await asUser(db, other.ownerId, () =>
      expectError(db, `select enable_module($1, 'budgets', '{"stolen":true}'::jsonb)`, [companyId]),
    );
    expect(overwriting).toMatch(/not_allowed/);

    expect(
      await one<{ on: boolean }>(db, `select module_is_enabled($1, 'budgets') as on`, [companyId]),
    ).toEqual({ on: true });
  });

  it('refuses a module nobody installed', async () => {
    const message = await asUser(db, ownerId, () =>
      expectError(db, `select enable_module($1, 'carbon')`, [companyId]),
    );
    expect(message).toMatch(/unknown_module: carbon/);
  });

  it('refuses a draft, and keeps the companies a deprecated module already has', async () => {
    await db.query(`update modules set status = 'draft' where code = 'assets'`);
    const draft = await asUser(db, ownerId, () =>
      expectError(db, `select enable_module($1, 'assets')`, [companyId]),
    );
    expect(draft).toMatch(/module_not_available/);

    await db.query(`update modules set status = 'available' where code = 'assets'`);
    await asUser(db, ownerId, async () => {
      await db.query(`select enable_module($1, 'assets')`, [companyId]);
    });

    // Deprecated takes no new company and leaves this one alone.
    await db.query(`update modules set status = 'deprecated' where code = 'assets'`);
    const other = await newCompany(db, { country: 'BE', name: 'Tardive SRL' });
    const refused = await asUser(db, other.ownerId, () =>
      expectError(db, `select enable_module($1, 'assets')`, [other.companyId]),
    );
    expect(refused).toMatch(/module_deprecated/);
    expect(
      await one<{ on: boolean }>(db, `select module_is_enabled($1, 'assets') as on`, [companyId]),
    ).toEqual({ on: true });
    await db.query(`update modules set status = 'available' where code = 'assets'`);
  });

  it('keeps the settings a company gave it, and leaves them alone when none is passed', async () => {
    await asUser(db, ownerId, async () => {
      await db.query(`select enable_module($1, 'assets', '{"period":"monthly"}'::jsonb)`, [companyId]);
    });
    expect(
      await one<{ settings: Record<string, string> }>(
        db,
        `select module_settings($1, 'assets') as settings`,
        [companyId],
      ),
    ).toEqual({ settings: { period: 'monthly' } });

    await asUser(db, ownerId, async () => {
      await db.query(`select enable_module($1, 'assets')`, [companyId]);
    });
    expect(
      await one<{ settings: Record<string, string> }>(
        db,
        `select module_settings($1, 'assets') as settings`,
        [companyId],
      ),
    ).toEqual({ settings: { period: 'monthly' } });
  });

  it('cannot be written round: company_modules has no write policy', async () => {
    const message = await asUser(db, ownerId, () =>
      expectError(
        db,
        `insert into company_modules (company_id, module_code) values ($1, 'budgets')`,
        [companyId],
      ),
    );
    expect(message).toMatch(/row-level security|violates/i);
  });

  it('shows a stranger none of it', async () => {
    const seen = await asUser(db, strangerId, () => rows(db, `select * from company_modules`));
    expect(seen).toEqual([]);
    expect(
      await asUser(db, strangerId, () =>
        one<{ on: boolean }>(db, `select module_enabled($1, 'assets') as on`, [companyId]),
      ),
    ).toEqual({ on: false });
  });
});

// -------------------------------------------------------- post_module_entry

describe('a module reaching the ledger', () => {
  const lines = `'[{"account_code":"610000","debit":"100.00"},
                   {"account_code":"440000","credit":"100.00"}]'::jsonb`;

  it('refuses a module the company has not enabled', async () => {
    const other = await newCompany(db, { country: 'BE', name: 'Sans module SRL' });
    const message = await expectError(
      db,
      `select post_module_entry($1, 'budgets', 'x', date '2026-06-01', 'Essai', ${lines})`,
      [other.companyId],
    );
    expect(message).toMatch(/module_not_enabled/);
  });

  it('refuses lines that do not balance, and an entry with no reference', async () => {
    expect(
      await expectError(
        db,
        `select post_module_entry($1, 'budgets', 'unbalanced', date '2026-06-01', 'Essai',
                '[{"account_code":"610000","debit":"100.00"}]'::jsonb)`,
        [companyId],
      ),
    ).toMatch(/entry_unbalanced/);

    expect(
      await expectError(
        db,
        `select post_module_entry($1, 'budgets', null, date '2026-06-01', 'Essai', ${lines})`,
        [companyId],
      ),
    ).toMatch(/module_entry_without_ref/);
  });

  it('posts through post_entry: numbered, posted, on the miscellaneous journal', async () => {
    const entry = await one<{ id: string }>(
      db,
      `select post_module_entry($1, 'budgets', 'essai:1', date '2026-06-01', 'Essai', ${lines}) as id`,
      [companyId],
    );
    const posted = await one<{ number: string; state: string; code: string; kind: string }>(
      db,
      `select e.number, e.state::text, j.code, e.kind::text
         from entries e join journals j on j.id = e.journal_id where e.id = $1`,
      [entry.id],
    );
    expect(posted.state).toBe('posted');
    expect(posted.code).toBe('MISC');
    expect(posted.number).toMatch(/^MISC\/2026\/\d{4}$/);
    // No `entry_kind` value per module: what a module wrote is said by the tag,
    // and a module entry is an ordinary entry a report may leave in.
    expect(posted.kind).toBe('normal');
  });

  it('refuses the same reference twice, which is what makes a module idempotent', async () => {
    const message = await expectError(
      db,
      `select post_module_entry($1, 'budgets', 'essai:1', date '2026-06-02', 'Encore', ${lines})`,
      [companyId],
    );
    expect(message).toMatch(/entries_module_ref_idx|duplicate key/);
    expect(
      await one<{ id: string | null }>(
        db,
        `select module_entry_id($1, 'budgets', 'essai:1') as id`,
        [companyId],
      ),
    ).not.toEqual({ id: null });
  });

  it('never lets an entry carrying a module tag be born posted, or moved afterwards', async () => {
    expect(
      await expectError(
        db,
        `insert into entries (company_id, journal_id, entry_date, state, number, module_code, module_ref)
         values ($1, (select id from journals where company_id = $1 and code = 'MISC'),
                 date '2026-06-01', 'posted', 'MISC/2026/9999', 'budgets', 'by-hand')`,
        [companyId],
      ),
    ).toMatch(/module_entry_not_posted_by_hand/);

    expect(
      await expectError(
        db,
        `update entries set module_ref = 'moved'
          where company_id = $1 and module_ref = 'essai:1'`,
        [companyId],
      ),
    ).toMatch(/module_tag_immutable/);
  });

  it('refuses a tag naming a module the company does not hold', async () => {
    const other = await newCompany(db, { country: 'BE', name: 'Etiquette SRL' });
    const message = await expectError(
      db,
      `insert into entries (company_id, journal_id, entry_date, module_code, module_ref)
       values ($1, (select id from journals where company_id = $1 and code = 'MISC'),
               date '2026-06-01', 'assets', 'x')`,
      [other.companyId],
    );
    expect(message).toMatch(/module_not_enabled/);
  });

  it('is refused by a closed period, because post_entry asserts it', async () => {
    await db.query(`update companies set lock_date = date '2026-12-31' where id = $1`, [companyId]);
    const message = await expectError(
      db,
      `select post_module_entry($1, 'budgets', 'essai:2', date '2026-06-03', 'Essai', ${lines})`,
      [companyId],
    );
    expect(message).toMatch(/period_locked/);
    await db.query(`update companies set lock_date = null where id = $1`, [companyId]);
  });
});

// ------------------------------------------------------------------- guards

describe('every module', () => {
  it('keeps row level security on every table it creates', async () => {
    const unprotected = await rows<{ nspname: string; relname: string }>(
      db,
      `select n.nspname, c.relname
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname in (select schema_name from modules)
          and c.relkind = 'r' and not c.relrowsecurity
        order by 1, 2`,
    );
    expect(unprotected).toEqual([]);
  });

  it('gives every table it creates at least one policy', async () => {
    const bare = await rows<{ schemaname: string; tablename: string }>(
      db,
      `select t.schemaname, t.tablename from pg_tables t
        where t.schemaname in (select schema_name from modules)
          and not exists (select 1 from pg_policies p
                           where p.schemaname = t.schemaname and p.tablename = t.tablename)
        order by 1, 2`,
    );
    expect(bare).toEqual([]);
  });

  it('routes every policy on a table of a company through module_enabled()', async () => {
    // A module table that carries `company_id` belongs to a company, and the
    // company has to hold the module to see it — which is the whole meaning of
    // enabling one. A table with no `company_id` is reference data of the
    // installation, like `country_defaults`, and gets the signed-in policy.
    const offenders = await rows<{ schemaname: string; tablename: string; policyname: string }>(
      db,
      `select p.schemaname, p.tablename, p.policyname
         from pg_policies p
        where p.schemaname in (select schema_name from modules)
          and exists (
            select 1 from information_schema.columns c
             where c.table_schema = p.schemaname and c.table_name = p.tablename
               and c.column_name = 'company_id')
          and coalesce(p.qual, '') not like '%module_enabled%'
        order by 1, 2, 3`,
    );
    expect(offenders).toEqual([]);
  });

  it('carries company_id on every table that is not reference data', async () => {
    // The socle's rule, one schema out: no `tenant_id` anywhere, and a row that
    // belongs to a company says so on the row.
    const tables = await rows<{ table_schema: string; table_name: string }>(
      db,
      `select t.table_schema, t.table_name
         from information_schema.tables t
        where t.table_schema in (select schema_name from modules) and t.table_type = 'BASE TABLE'
          and not exists (select 1 from information_schema.columns c
                           where c.table_schema = t.table_schema and c.table_name = t.table_name
                             and c.column_name in ('company_id', 'country'))
        order by 1, 2`,
    );
    expect(tables).toEqual([]);
  });

  it('leaves no function of its schema executable by PUBLIC or by anon', async () => {
    const open = await rows<{ nspname: string; proname: string }>(
      db,
      `select n.nspname, p.proname
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in (select schema_name from modules)
          and (p.proacl is null
               or exists (select 1 from aclexplode(p.proacl) a
                           where a.grantee = 0 and a.privilege_type = 'EXECUTE')
               or has_function_privilege('anon', p.oid, 'execute'))
        order by 1, 2`,
    );
    expect(
      open,
      'these module functions are open: add the revoke to the migration that created them',
    ).toEqual([]);
  });

  it('holds no country code of its own, in SQL or in TypeScript', async () => {
    // The repository-wide rule, applied to `modules/**`: a country is data, so
    // it lives in a pack and in the seed compiled from it. A module that named
    // one would be a localisation in code, which is the thing this project is
    // built against. A comment may quote the rule it implements.
    const COUNTRY = /'(BE|FR|UK|US|CA|GB|IE|NL|DE|LU)'|"(BE|FR|UK|US|CA|GB|IE|NL|DE|LU)"/;
    const LOCALE = /'(EUR|USD|GBP|CAD|CHF)'|"(EUR|USD|GBP|CAD|CHF)"/;
    const guilty: string[] = [];
    for (const file of await sqlAndTs(modulesDir)) {
      // A test names a country the way `tax_report.test.ts` does: it picks one
      // to book an example on. What is checked is the module itself.
      if (file.includes('/tests/')) continue;
      const text = stripComments(await readFile(file, 'utf8'), file.endsWith('.sql') ? '--' : '//');
      for (const pattern of [COUNTRY, LOCALE]) {
        const match = pattern.exec(text);
        if (match !== null) guilty.push(`${relative(file)}: ${match[0]}`);
      }
    }
    expect(guilty).toEqual([]);
  });

  it('never writes entries or entry_lines, and never posts anything itself', async () => {
    // The rule the whole mechanism rests on. A module hands its lines to
    // `post_module_entry()`, which builds the draft and calls `post_entry()` —
    // so sides, rounding, numbering and period locks stay in one place and
    // cannot answer differently in a module. Reading the ledger is another
    // matter and is allowed: `budgets.variance` does exactly that.
    const WRITE = /\b(insert\s+into|update|delete\s+from)\s+(public\.)?(entries|entry_lines)\b/i;
    const POSTS = /\bpost_entry\s*\(/i;
    const guilty: string[] = [];
    for (const file of await sqlAndTs(modulesDir)) {
      if (file.includes('/tests/')) continue;
      // String literals go too: a `comment on function` that explains the rule
      // names `post_entry()` in prose, and prose is not a call.
      const text = stripStrings(
        stripComments(await readFile(file, 'utf8'), file.endsWith('.sql') ? '--' : '//'),
      );
      const write = WRITE.exec(text);
      if (write !== null) guilty.push(`${relative(file)}: ${write[0]}`);
      if (POSTS.test(text.replace(/post_module_entry/g, ''))) {
        guilty.push(`${relative(file)}: calls post_entry() directly`);
      }
    }
    expect(guilty).toEqual([]);
  });

  it('is held to what its manifest says about posting', async () => {
    for (const module of await listModules(modulesDir)) {
      const calls: string[] = [];
      for (const migration of module.migrations) {
        const text = stripComments(await readFile(migration.path, 'utf8'), '--');
        if (/post_module_entry\s*\(/.test(text)) calls.push(migration.file);
      }
      if (module.manifest.posts === true) {
        expect(calls.length, `${module.manifest.code} says it posts and never does`).toBeGreaterThan(0);
      } else {
        expect(calls, `${module.manifest.code} says it does not post`).toEqual([]);
      }
    }
  });

  it('validates its manifest against the published schema', async () => {
    const schema = await readModuleSchema(modulesDir);
    for (const code of await moduleCodes()) {
      const manifest = JSON.parse(
        await readFile(join(modulesDir, code, 'module.json'), 'utf8'),
      ) as unknown;
      expect(validate(manifest, schema), `modules/${code}/module.json`).toEqual([]);
    }
  });

  it('ships a README next to its manifest', async () => {
    for (const code of await moduleCodes()) {
      const files = await readdir(join(modulesDir, code));
      expect(files, `modules/${code}`).toContain('README.md');
    }
  });
});

describe('the migrations of a module', () => {
  it('carry the module in their recorded name, and the timestamp in their version', async () => {
    for (const module of await listModules(modulesDir)) {
      for (const migration of module.migrations) {
        expect(migration.name.startsWith(`${module.manifest.code}/`)).toBe(true);
        expect(migration.version).toMatch(/^\d{14}$/);
        expect(migration.file).toMatch(/^\d{14}_[a-z0-9_]+\.sql$/);
      }
    }
  });

  // This used to ask that a module migration sort after *every* socle
  // migration, which is a promise no module can keep: the socle gains a
  // migration the week after a module ships, and the only way to restore a
  // total order is to rename a published module migration — the one thing
  // rule 1 of `supabase/migrations/README.md` forbids. The company profile
  // release was the first
  // socle change to land after a module and it failed exactly there.
  //
  // What a module can promise, and what the order actually needs, is the test
  // below: every one of its migrations sorts after the socle migration its
  // manifest declares it needs. `ekwo migrate` applies the socle first and
  // the modules after, so the applied order is right whatever the timestamps
  // say; what `requires_socle_min` guarantees is that the objects a module
  // builds on already exist.

  it('take a version no other migration anywhere uses', async () => {
    const versions = [
      ...(await migrationFiles()).map((f) => f.slice(0, 14)),
      ...(await moduleMigrationFiles()).map((m) => m.version),
    ];
    expect(new Set(versions).size).toBe(versions.length);
  });

  it('apply after the socle migration each one declares it needs, which is the order that matters', async () => {
    const socle = new Set((await migrationFiles()).map((f) => f.slice(0, 14)));
    for (const module of await listModules(modulesDir)) {
      const min = module.manifest.requires_socle_min;
      if (min === undefined) continue;
      expect(socle.has(min), `${module.manifest.code} needs a socle migration that does not exist`).toBe(
        true,
      );
      for (const migration of module.migrations) {
        expect(migration.version > min).toBe(true);
      }
    }
  });

  it('never open a transaction of their own, as the runner owns it', async () => {
    const guilty: string[] = [];
    for (const migration of await moduleMigrationFiles()) {
      const text = stripComments(await readFile(migration.path, 'utf8'), '--');
      if (/\b(begin|commit|rollback)\s*;/i.test(text)) guilty.push(`${migration.code}/${migration.file}`);
    }
    expect(guilty).toEqual([]);
  });
});

// ------------------------------------------------------------------ helpers

async function sqlAndTs(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await sqlAndTs(path)));
    else if (entry.name.endsWith('.sql') || entry.name.endsWith('.ts')) out.push(path);
  }
  return out.sort();
}

/** The file without the lines that are only a comment. */
function stripComments(text: string, marker: '--' | '//'): string {
  return text
    .split('\n')
    .filter((line) => {
      const trimmed = line.trimStart();
      return !trimmed.startsWith(marker) && !trimmed.startsWith('*') && !trimmed.startsWith('/*');
    })
    .join('\n');
}

/** The file without its single-quoted literals, which are data and not code. */
function stripStrings(text: string): string {
  return text.replace(/'(?:[^']|'')*'/g, "''");
}

function relative(path: string): string {
  return path.slice(repoRoot.length + 1);
}

// ---------------------------------------------------------------------------
// The audit of 13 September 2026: a module shared the socle's lock.
//
// Every module policy asked `can_write_company()`, which is `entries.write` —
// so whoever could draft a journal entry could also rewrite the fixed asset
// register and next year's budget. Each module now declares its own
// vocabulary in its own migration, which is where a module's words belong.
// ---------------------------------------------------------------------------

describe('a module’s own capabilities', () => {
  it('are declared by the module, with the module code as their area', async () => {
    const declared = await rows<{ code: string; area: string }>(
      db,
      `select code, area from capabilities
        where area in (select code from modules) order by code`,
    );
    expect(declared).toEqual([
      { code: 'assets.post', area: 'assets' },
      { code: 'assets.read', area: 'assets' },
      { code: 'assets.write', area: 'assets' },
      { code: 'budgets.read', area: 'budgets' },
      { code: 'budgets.write', area: 'budgets' },
    ]);
  });

  it('are in the presets the socle uses: a viewer reads, an accountant works', async () => {
    const preset = async (role: string): Promise<string[]> =>
      (
        await rows<{ capability: string }>(
          db,
          `select capability from role_capabilities
            where role = $1::member_role
              and capability in (select code from capabilities where area in (select code from modules))
            order by capability`,
          [role],
        )
      ).map((r) => r.capability);

    expect(await preset('viewer')).toEqual(['assets.read', 'budgets.read']);
    expect(await preset('accountant')).toEqual([
      'assets.post',
      'assets.read',
      'assets.write',
      'budgets.read',
      'budgets.write',
    ]);
    expect(await preset('owner')).toEqual([
      'assets.post',
      'assets.read',
      'assets.write',
      'budgets.read',
      'budgets.write',
    ]);
  });

  it('is what every policy of a module now tests, and not the socle’s write lock', async () => {
    const offenders = await rows<{ schemaname: string; tablename: string; policyname: string }>(
      db,
      `select p.schemaname, p.tablename, p.policyname
         from pg_policies p
        where p.schemaname in (select schema_name from modules)
          and (coalesce(p.qual, '') like '%can_write_company%'
               or coalesce(p.with_check, '') like '%can_write_company%')
        order by 1, 2, 3`,
    );
    expect(
      offenders,
      'a module policy tests the socle’s write lock instead of its own capability',
    ).toEqual([]);
  });

  it('keeps a member who holds entries.write but not the module’s out of it', async () => {
    const other = await newCompany(db, { country: 'BE', name: 'Immobilisee SRL' });
    await asUser(db, other.ownerId, async () => {
      await db.query(`select enable_module($1, 'assets')`, [other.companyId]);
      await db.query(`select enable_module($1, 'budgets')`, [other.companyId]);
    });

    const bookkeeper = crypto.randomUUID();
    await db.query(
      `insert into company_members (company_id, user_id, role, capabilities_revoked)
       values ($1, $2, 'accountant', array['assets.write', 'budgets.write', 'assets.read'])`,
      [other.companyId, bookkeeper],
    );

    await asUser(db, bookkeeper, async () => {
      // Still an accountant of the company by every other measure.
      expect(
        (await rows(db, `select 1 as ok where has_capability($1, 'entries.write')`, [other.companyId]))
          .length,
      ).toBe(1);

      // And nothing of the register: not a read, and not a write.
      expect(await rows(db, `select id from assets.assets`)).toEqual([]);
      const refused = await expectError(
        db,
        `insert into assets.assets (company_id, code, name, acquisition_date, cost,
                                    asset_account_id, depreciation_account_id, expense_account_id,
                                    duration_months, method)
         values ($1, 'IM-1', 'Machine', date '2026-01-01', 1000,
                 account_id_by_code($1, '240000'), account_id_by_code($1, '240900'),
                 account_id_by_code($1, '630200'), 60, 'straight_line')`,
        [other.companyId],
      );
      expect(refused).toMatch(/row-level security|violates/i);

      const budget = await expectError(
        db,
        `insert into budgets.budgets (company_id, fiscal_year_id, name)
         values ($1, (select id from fiscal_years where company_id = $1 limit 1), 'Plan')`,
        [other.companyId],
      );
      expect(budget).toMatch(/row-level security|violates/i);
    });
  });
});
