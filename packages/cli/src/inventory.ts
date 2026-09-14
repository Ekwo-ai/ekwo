/**
 * What this release defines, and what a database actually holds.
 *
 * `packages/cli/assets/expected-objects.json` is generated from the migrations
 * by `scripts/generate-expected-objects.mjs` and travels inside the published
 * package. It is an inventory, not a list kept by hand: a doctor whose
 * expectations are typed out by a human drifts from the schema the first time
 * somebody adds a table and forgets the list, and then it lies in both
 * directions at once.
 *
 * Comparing it to a live catalogue answers two different questions. Something
 * **missing** means the installation is behind or has been damaged — a
 * migration that did not land, an object dropped by hand. Something **extra**
 * means an operator added it: their table, their function, their business, and
 * this reports it as information rather than as a fault.
 *
 * A policy is the exception. Row level security is the whole security model
 * here, so a policy that is gone and a policy that was added to a table of
 * this schema are both faults: the first opens nothing and closes everything,
 * the second is a grant nobody reviewed.
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describeGrants, type GrantsSection } from './grants.js';
import type { SqlClient } from './sql.js';
import { scalar } from './sql.js';

export interface ExpectedColumn {
  name: string;
  type: string;
}

export interface ExpectedTable {
  name: string;
  columns: ExpectedColumn[];
}

export interface ExpectedFunction {
  name: string;
  /** `pg_get_function_identity_arguments`, so an overload is its own entry. */
  arguments: string;
}

export interface ExpectedPolicy {
  table: string;
  name: string;
  command: string;
}

export interface ExpectedTrigger {
  table: string;
  name: string;
}

export interface ExpectedType {
  name: string;
  kind: string;
  labels?: string[];
}

export interface ExpectedSchema {
  schema: string;
  tables: ExpectedTable[];
  views: string[];
  functions: ExpectedFunction[];
  policies: ExpectedPolicy[];
  triggers: ExpectedTrigger[];
  types: ExpectedType[];
  /**
   * Which of `anon`, `authenticated` and `service_role` may reach each of
   * those objects, and with which verbs.
   *
   * Part of the inventory rather than a file of its own, because a privilege
   * and the object it is on ship in the same migration: since
   * `20260914151207` the schema grants its own rights by name instead of
   * taking whatever a Supabase project's default privileges hand out, and a
   * table added without its grants is exactly as broken as a table added
   * without its policy.
   *
   * `doctor.ts` compares it separately from the categories above, because the
   * rule is not the same: a missing grant is a fault, an extra one to `anon`
   * is a fault, and an extra one to a signed-in user is worth saying out loud
   * without failing a build.
   */
  grants: GrantsSection;
}

export interface ExpectedModule extends ExpectedSchema {
  code: string;
  version: string;
}

export interface ExpectedObjects {
  /** The schema version this inventory describes. */
  schemaVersion: string | null;
  /** The last migration it was generated from. */
  migration: string | null;
  socle: ExpectedSchema;
  modules: ExpectedModule[];
}

/** One category, compared. Every entry is a printable key. */
export interface CategoryDiff {
  missing: string[];
  extra: string[];
  /** Present on both sides and not the same: a column whose type moved. */
  changed: string[];
}

export interface SectionComparison {
  /** `socle`, or the module's code. */
  code: string;
  schema: string;
  /**
   * Whether this database carries the section at all. A module the operator
   * never installed is not a fault, and nothing of it is required.
   */
  installed: boolean;
  tables: CategoryDiff;
  columns: CategoryDiff;
  views: CategoryDiff;
  functions: CategoryDiff;
  policies: CategoryDiff;
  triggers: CategoryDiff;
  types: CategoryDiff;
}

export interface CatalogueComparison {
  /** Version the inventory describes. */
  expectedVersion: string | null;
  /** Version the database reports, which may be older or newer. */
  databaseVersion: string | null;
  sections: SectionComparison[];
  missing: number;
  extra: number;
  changed: number;
  /** Missing or extra policies on a table of this schema. Always a fault. */
  policyFaults: number;
}

export class InventoryError extends Error {}

const CATEGORIES = ['tables', 'columns', 'views', 'functions', 'policies', 'triggers', 'types'] as const;

/**
 * Where the inventory is.
 *
 * Published package: `dist/assets/expected-objects.json`, put there at build
 * time by `scripts/copy-assets.mjs`. Checkout: `packages/cli/assets/`, which
 * is the file the generator writes and the repository commits. The two
 * candidates mirror `resolveBundleDir()`.
 */
export function resolveInventoryPath(): string | undefined {
  const candidates = [
    new URL('./assets/expected-objects.json', import.meta.url),
    new URL('../assets/expected-objects.json', import.meta.url),
  ];
  for (const candidate of candidates) {
    const path = fileURLToPath(candidate);
    if (existsSync(path)) return path;
  }
  return undefined;
}

/** The inventory this CLI ships, or `undefined` if it ships none. */
export async function readExpectedObjects(path = resolveInventoryPath()): Promise<ExpectedObjects | undefined> {
  if (path === undefined) return undefined;
  const raw = await readFile(path, 'utf8');
  let parsed: ExpectedObjects;
  try {
    parsed = JSON.parse(raw) as ExpectedObjects;
  } catch (error) {
    throw new InventoryError(`inventory_invalid: ${path} — ${(error as Error).message}`);
  }
  if (parsed.socle === undefined || !Array.isArray(parsed.modules)) {
    throw new InventoryError(`inventory_invalid: ${path} — no socle or no modules`);
  }
  return parsed;
}

// ------------------------------------------------------------------ reading

/** The same categories, read from a live catalogue. */
async function readSchema(db: SqlClient, schema: string): Promise<ExpectedSchema> {
  const tables = await db.query<{ name: string }>(
    `select c.relname as name
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = $1 and c.relkind in ('r', 'p')
      order by c.relname`,
    [schema],
  );
  const columns = await db.query<{ table_name: string; name: string; type: string }>(
    `select c.relname as table_name, a.attname as name,
            format_type(a.atttypid, a.atttypmod) as type
       from pg_attribute a
       join pg_class c on c.oid = a.attrelid
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = $1 and c.relkind in ('r', 'p')
        and a.attnum > 0 and not a.attisdropped
      order by c.relname, a.attname`,
    [schema],
  );
  const views = await db.query<{ name: string }>(
    `select c.relname as name
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = $1 and c.relkind in ('v', 'm')
      order by c.relname`,
    [schema],
  );
  const functions = await db.query<{ name: string; arguments: string }>(
    `select p.proname as name, pg_get_function_identity_arguments(p.oid) as arguments
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = $1
      order by p.proname, pg_get_function_identity_arguments(p.oid)`,
    [schema],
  );
  const policies = await db.query<{ table_name: string; name: string; command: string }>(
    `select c.relname as table_name, p.polname as name,
            case p.polcmd when 'r' then 'select' when 'a' then 'insert'
                          when 'w' then 'update' when 'd' then 'delete'
                          else 'all' end as command
       from pg_policy p
       join pg_class c on c.oid = p.polrelid
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = $1
      order by c.relname, p.polname`,
    [schema],
  );
  const triggers = await db.query<{ table_name: string; name: string }>(
    `select c.relname as table_name, t.tgname as name
       from pg_trigger t
       join pg_class c on c.oid = t.tgrelid
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = $1 and not t.tgisinternal
      order by c.relname, t.tgname`,
    [schema],
  );
  const types = await db.query<{ name: string; kind: string; labels: string[] | null }>(
    `select t.typname as name,
            case t.typtype when 'e' then 'enum' when 'd' then 'domain' else 'composite' end as kind,
            case when t.typtype = 'e' then (
              select array_agg(e.enumlabel order by e.enumsortorder)
                from pg_enum e where e.enumtypid = t.oid
            ) end as labels
       from pg_type t join pg_namespace n on n.oid = t.typnamespace
      where n.nspname = $1 and t.typtype in ('e', 'd', 'c')
        and (t.typtype <> 'c'
             or exists (select 1 from pg_class c where c.oid = t.typrelid and c.relkind = 'c'))
      order by t.typname`,
    [schema],
  );

  const grants = await describeGrants((sql, params) => db.query(sql, params), schema);

  return {
    schema,
    tables: tables.map((t) => ({
      name: t.name,
      columns: columns
        .filter((c) => c.table_name === t.name)
        .map((c) => ({ name: c.name, type: c.type })),
    })),
    views: views.map((v) => v.name),
    functions: functions.map((f) => ({ name: f.name, arguments: f.arguments })),
    policies: policies.map((p) => ({ table: p.table_name, name: p.name, command: p.command })),
    triggers: triggers.map((t) => ({ table: t.table_name, name: t.name })),
    types: types.map((t) => ({
      name: t.name,
      kind: t.kind,
      ...(t.labels === null ? {} : { labels: t.labels }),
    })),
    grants,
  };
}

/** The live grants of one schema, for the doctor's own check. */
export async function readGrants(db: SqlClient, schema: string): Promise<GrantsSection> {
  return describeGrants((sql, params) => db.query(sql, params), schema);
}

/** The schemas of an inventory this database actually carries. */
export async function installedSections(
  db: SqlClient,
  expected: ExpectedObjects,
): Promise<ExpectedSchema[]> {
  const carried = await installedModules(db);
  return [expected.socle, ...expected.modules.filter((m) => carried.has(m.code))];
}

// ---------------------------------------------------------------- comparing

function emptyDiff(): CategoryDiff {
  return { missing: [], extra: [], changed: [] };
}

/**
 * Two keyed sets, compared.
 *
 * `key` is what identifies the object — a name, or a name and a signature —
 * and `same` says whether two objects that share a key are still the same
 * thing. Both sides are already sorted, and the keys are what is printed.
 */
function diff<T>(
  expected: readonly T[],
  actual: readonly T[],
  key: (item: T) => string,
  same: (a: T, b: T) => string | undefined = () => undefined,
): CategoryDiff {
  const out = emptyDiff();
  const here = new Map(actual.map((item) => [key(item), item]));
  const there = new Set(expected.map(key));

  for (const item of expected) {
    const found = here.get(key(item));
    if (found === undefined) {
      out.missing.push(key(item));
      continue;
    }
    const difference = same(item, found);
    if (difference !== undefined) out.changed.push(difference);
  }
  for (const item of actual) {
    if (!there.has(key(item))) out.extra.push(key(item));
  }
  return out;
}

const functionKey = (f: ExpectedFunction): string => `${f.name}(${f.arguments})`;
const policyKey = (p: ExpectedPolicy): string => `${p.table}.${p.name}`;
const triggerKey = (t: ExpectedTrigger): string => `${t.table}.${t.name}`;

/** One section of the inventory against one schema of the database. */
function compareSchema(code: string, expected: ExpectedSchema, actual: ExpectedSchema): SectionComparison {
  const tables = diff(expected.tables, actual.tables, (t) => t.name);

  // Columns, triggers and policies are compared on the tables this schema
  // defines. On a table the operator added, they are the operator's business,
  // and the table itself is already reported as extra.
  const known = new Set(expected.tables.map((t) => t.name));
  const expectedColumns = expected.tables.flatMap((t) =>
    t.columns.map((c) => ({ key: `${t.name}.${c.name}`, type: c.type })),
  );
  const actualColumns = actual.tables
    .filter((t) => known.has(t.name))
    .flatMap((t) => t.columns.map((c) => ({ key: `${t.name}.${c.name}`, type: c.type })));
  const columns = diff(
    expectedColumns,
    actualColumns,
    (c) => c.key,
    (a, b) => (a.type === b.type ? undefined : `${a.key} is ${b.type}, expected ${a.type}`),
  );
  // A column missing because its whole table is missing is already said once.
  columns.missing = columns.missing.filter((c) => !tables.missing.includes(c.split('.')[0] ?? ''));

  const policies = diff(
    expected.policies,
    actual.policies.filter((p) => known.has(p.table)),
    policyKey,
    (a, b) => (a.command === b.command ? undefined : `${policyKey(a)} is ${b.command}, expected ${a.command}`),
  );
  policies.missing = policies.missing.filter((p) => !tables.missing.includes(p.split('.')[0] ?? ''));

  const triggers = diff(
    expected.triggers,
    actual.triggers.filter((t) => known.has(t.table)),
    triggerKey,
  );
  triggers.missing = triggers.missing.filter((t) => !tables.missing.includes(t.split('.')[0] ?? ''));

  return {
    code,
    schema: expected.schema,
    installed: true,
    tables,
    columns,
    views: diff(expected.views, actual.views, (v) => v),
    functions: diff(expected.functions, actual.functions, functionKey),
    policies,
    triggers,
    types: diff(
      expected.types,
      actual.types,
      (t) => t.name,
      (a, b) => {
        if (a.kind !== b.kind) return `${a.name} is a ${b.kind}, expected a ${a.kind}`;
        const expectedLabels = (a.labels ?? []).join(', ');
        const actualLabels = (b.labels ?? []).join(', ');
        if (expectedLabels === actualLabels) return undefined;
        return `${a.name} holds (${actualLabels}), expected (${expectedLabels})`;
      },
    ),
  };
}

/** A section this database does not carry: nothing of it is required. */
function notInstalled(code: string, schema: string): SectionComparison {
  return {
    code,
    schema,
    installed: false,
    tables: emptyDiff(),
    columns: emptyDiff(),
    views: emptyDiff(),
    functions: emptyDiff(),
    policies: emptyDiff(),
    triggers: emptyDiff(),
    types: emptyDiff(),
  };
}

/** The module codes this database carries, whatever this CLI ships. */
async function installedModules(db: SqlClient): Promise<Set<string>> {
  const present = await scalar<boolean>(db, `select to_regclass('public.modules') is not null`);
  if (present !== true) return new Set();
  const rows = await db.query<{ code: string }>('select code from modules');
  return new Set(rows.map((r) => r.code));
}

/**
 * The inventory against the live catalogue.
 *
 * The database's own schema version is read and reported but never gates the
 * comparison: an installation older than the CLI is exactly when this is worth
 * running, and refusing to look would be refusing the case.
 */
export async function compareCatalogue(
  db: SqlClient,
  expected: ExpectedObjects,
): Promise<CatalogueComparison> {
  // Asked in two steps on purpose: naming the function in a `case` still
  // resolves it, so a database that does not have it would raise rather than
  // answer, and that database is one this is meant to report on.
  const hasVersion = await scalar<boolean>(
    db,
    `select to_regprocedure('public.ekwo_schema_version()') is not null`,
  );
  const databaseVersion =
    hasVersion === true ? ((await scalar<string>(db, 'select ekwo_schema_version()')) ?? null) : null;

  const sections = [compareSchema('socle', expected.socle, await readSchema(db, 'public'))];

  const carried = await installedModules(db);
  for (const module of expected.modules) {
    if (!carried.has(module.code)) {
      sections.push(notInstalled(module.code, module.schema));
      continue;
    }
    sections.push(compareSchema(module.code, module, await readSchema(db, module.schema)));
  }

  let missing = 0;
  let extra = 0;
  let changed = 0;
  let policyFaults = 0;
  for (const section of sections) {
    for (const category of CATEGORIES) {
      missing += section[category].missing.length;
      extra += section[category].extra.length;
      changed += section[category].changed.length;
    }
    policyFaults +=
      section.policies.missing.length + section.policies.extra.length + section.policies.changed.length;
  }

  return { expectedVersion: expected.schemaVersion, databaseVersion, sections, missing, extra, changed, policyFaults };
}

/** Every difference of one section, as printable lines. */
export function describeDifferences(section: SectionComparison): {
  faults: string[];
  information: string[];
} {
  const faults: string[] = [];
  const information: string[] = [];
  const where = section.code === 'socle' ? '' : `${section.code}: `;

  for (const category of CATEGORIES) {
    const { missing, extra, changed } = section[category];
    for (const item of missing) faults.push(`${where}missing ${singular(category)} ${item}`);
    for (const item of changed) faults.push(`${where}${item}`);
    for (const item of extra) {
      const line = `${where}extra ${singular(category)} ${item}`;
      if (category === 'policies') faults.push(line);
      else information.push(line);
    }
  }
  return { faults, information };
}

function singular(category: (typeof CATEGORIES)[number]): string {
  return category === 'policies' ? 'policy' : category.replace(/s$/, '');
}
