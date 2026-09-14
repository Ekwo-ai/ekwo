#!/usr/bin/env node
/**
 * Regenerates `packages/cli/assets/expected-objects.json` — the inventory of
 * everything this release defines, read from the migrations themselves.
 *
 *   node scripts/generate-expected-objects.mjs
 *
 * `ekwo doctor` compares a live database against this file and names what is
 * missing and what is extra. The inventory is generated for the same reason
 * `docs/schema.md` is: a list kept by hand in the CLI drifts from the schema
 * the first time somebody adds a table and forgets the list, and a doctor that
 * expects the wrong thing is worse than no doctor at all.
 *
 * Everything here sorts on a stable key — a name, or a name and a signature —
 * so regenerating on an unchanged schema produces a byte-identical file and
 * the CI diff is the whole test. `oid` is never an ordering: it is an
 * allocation order, and `create or replace` is free to move a tuple.
 *
 * The socle is `public`. Each module is its own schema, listed separately, so
 * the doctor can require only the modules a database actually carries.
 *
 * Each section carries a `grants` block too — which of `anon`,
 * `authenticated` and `service_role` may reach each table, view and function,
 * and with which verbs. It belongs here rather than in a file of its own
 * because a privilege and the object it sits on ship in the same migration:
 * since `20260914151207` the schema grants its own rights by name instead of
 * taking whatever a Supabase project's default privileges hand out, and a
 * table added without its grants is exactly as broken as a table added
 * without its policy. `describeGrants` is imported from the CLI, so this file
 * and the doctor can never read the catalogue two different ways.
 */

import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
// Node 22.18+ or 24 (TypeScript stripping enabled by default).
import { freshDatabase, migrationFiles, moduleMigrationFiles } from '../tests/helpers/db.ts';
import { GRANT_ROLES, describeGrants } from '../packages/cli/src/grants.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const INVENTORY_PATH = join(root, 'packages', 'cli', 'assets', 'expected-objects.json');

/** Everything one schema defines, in the categories the doctor compares. */
async function describe(db, schema) {
  const q = async (sql, params = [schema]) => (await db.query(sql, params)).rows;

  const tables = await q(
    `select c.relname as name
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = $1 and c.relkind in ('r', 'p')
      order by c.relname`,
  );

  const columns = await q(
    `select c.relname as table_name,
            a.attname as name,
            format_type(a.atttypid, a.atttypmod) as type
       from pg_attribute a
       join pg_class c on c.oid = a.attrelid
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = $1 and c.relkind in ('r', 'p')
        and a.attnum > 0 and not a.attisdropped
      order by c.relname, a.attname`,
  );

  const views = await q(
    `select c.relname as name
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = $1 and c.relkind in ('v', 'm')
      order by c.relname`,
  );

  // Name and identity arguments together: that pair is what makes an overload
  // a different function, and it is the key the doctor matches on.
  const functions = await q(
    `select p.proname as name,
            pg_get_function_identity_arguments(p.oid) as arguments
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = $1
      order by p.proname, pg_get_function_identity_arguments(p.oid)`,
  );

  const policies = await q(
    `select c.relname as table_name, p.polname as name,
            case p.polcmd when 'r' then 'select' when 'a' then 'insert'
                          when 'w' then 'update' when 'd' then 'delete'
                          else 'all' end as command
       from pg_policy p
       join pg_class c on c.oid = p.polrelid
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = $1
      order by c.relname, p.polname`,
  );

  const triggers = await q(
    `select c.relname as table_name, t.tgname as name
       from pg_trigger t
       join pg_class c on c.oid = t.tgrelid
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = $1 and not t.tgisinternal
      order by c.relname, t.tgname`,
  );

  // Enums, domains and the composite types declared on their own. The row
  // type of every table is a composite too, and is not a type anybody wrote.
  const types = await q(
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
  );

  const columnsOf = (table) =>
    columns
      .filter((c) => c.table_name === table)
      .map((c) => ({ name: c.name, type: c.type }));

  const grants = await describeGrants(async (sql, params) => (await db.query(sql, params)).rows, schema);

  return {
    schema,
    tables: tables.map((t) => ({ name: t.name, columns: columnsOf(t.name) })),
    views: views.map((v) => v.name),
    functions: functions.map((f) => ({ name: f.name, arguments: f.arguments })),
    policies: policies.map((p) => ({ table: p.table_name, name: p.name, command: p.command })),
    triggers: triggers.map((t) => ({ table: t.table_name, name: t.name })),
    types: types.map((t) => ({
      name: t.name,
      kind: t.kind,
      ...(t.labels === null || t.labels === undefined ? {} : { labels: t.labels }),
    })),
    grants,
  };
}

/** The inventory this checkout defines. */
export async function buildInventory() {
  const db = await freshDatabase({ seed: false });
  try {
    const version = (await db.query('select ekwo_schema_version() as v')).rows[0]?.v ?? null;

    const socleVersions = (await migrationFiles()).map((f) => f.slice(0, 14));
    const moduleVersions = (await moduleMigrationFiles()).map((m) => m.version);
    const migration = [...socleVersions, ...moduleVersions].sort().at(-1) ?? null;

    const installed = (
      await db.query(`select code, schema_name, version from modules order by code`)
    ).rows;

    const modules = [];
    for (const row of installed) {
      modules.push({
        code: row.code,
        version: row.version,
        ...(await describe(db, row.schema_name)),
      });
    }

    return { schemaVersion: version, migration, socle: await describe(db, 'public'), modules };
  } finally {
    await db.close();
  }
}

/** How many objects an inventory section holds, per category. */
export function countObjects(section) {
  return {
    tables: section.tables.length,
    columns: section.tables.reduce((n, t) => n + t.columns.length, 0),
    views: section.views.length,
    functions: section.functions.length,
    policies: section.policies.length,
    triggers: section.triggers.length,
    types: section.types.length,
    // One count for the privileges, so the line a regeneration prints says
    // whether a role gained a whole object rather than only a verb.
    granted: GRANT_ROLES.map(
      (role) =>
        `${role} ${
          [...section.grants.tables, ...section.grants.views, ...section.grants.functions].filter(
            (o) => o[role].length > 0,
          ).length
        }`,
    ).join('/'),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const inventory = await buildInventory();
  await writeFile(INVENTORY_PATH, `${JSON.stringify(inventory, null, 2)}\n`, 'utf8');

  const socle = countObjects(inventory.socle);
  const say = (counts) =>
    Object.entries(counts)
      .map(([name, n]) => `${n} ${name}`)
      .join(', ');
  console.log(`packages/cli/assets/expected-objects.json regenerated for schema ${inventory.schemaVersion}.`);
  console.log(`  socle: ${say(socle)}`);
  for (const module of inventory.modules) {
    console.log(`  ${module.code}: ${say(countObjects(module))}`);
  }
}
