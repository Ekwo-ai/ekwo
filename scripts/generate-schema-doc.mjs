#!/usr/bin/env node
/**
 * Regenerates `docs/schema.md` from the migrations themselves, so the
 * reference half of the document cannot drift from the schema.
 *
 *   node scripts/generate-schema-doc.mjs
 *
 * The prose at the top of the file lives in `docs/schema.intro.md` and is
 * copied through unchanged.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
// Node 22.18+ or 24 (TypeScript stripping enabled by default).
import { freshDatabase } from '../tests/helpers/db.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const db = await freshDatabase({ seed: false });

const q = async (sql, params = []) => (await db.query(sql, params)).rows;

const out = [await readFile(join(root, 'docs', 'schema.intro.md'), 'utf8')];

/** One schema, its tables and its functions, appended to `out`. */
async function describe(schema, { anchor = (name) => name, heading = '##' } = {}) {
  const tables = await q(
    `
    select c.relname as name, obj_description(c.oid, 'pg_class') as comment
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = $1 and c.relkind = 'r'
     order by c.relname
  `,
    [schema],
  );

  out.push(`${heading} Tables\n`);
  out.push('| Table | Purpose |');
  out.push('|---|---|');
  for (const t of tables) {
    out.push(`| [\`${t.name}\`](#${anchor(t.name)}) | ${(t.comment ?? '').replace(/\|/g, '\\|')} |`);
  }
  out.push('');

  for (const t of tables) {
    out.push(`${heading}# \`${t.name}\`\n`);
    if (t.comment) out.push(`${t.comment}\n`);

    const columns = await q(
      `
      select a.attname as name,
             format_type(a.atttypid, a.atttypmod) as type,
             a.attnotnull as not_null,
             pg_get_expr(d.adbin, d.adrelid) as default_expr,
             a.attgenerated <> '' as generated,
             col_description(a.attrelid, a.attnum) as comment
        from pg_attribute a
        join pg_class c on c.oid = a.attrelid
        join pg_namespace n on n.oid = c.relnamespace
        left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
       where n.nspname = $2 and c.relname = $1 and a.attnum > 0 and not a.attisdropped
       order by a.attnum
    `,
      [t.name, schema],
    );

    out.push('| Column | Type | Notes |');
    out.push('|---|---|---|');
    for (const col of columns) {
      const notes = [];
      if (col.generated) notes.push('generated');
      else if (col.not_null) notes.push('not null');
      if (col.comment) notes.push(col.comment);
      out.push(`| \`${col.name}\` | \`${col.type}\` | ${notes.join(' — ').replace(/\|/g, '\\|')} |`);
    }
    out.push('');

    const constraints = await q(
      `
      select con.conname as name, pg_get_constraintdef(con.oid) as definition
        from pg_constraint con
        join pg_class c on c.oid = con.conrelid
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = $2 and c.relname = $1 and con.contype in ('c', 'u', 'p')
       order by con.contype, con.conname
    `,
      [t.name, schema],
    );
    const meaningful = constraints.filter((c) => !c.name.endsWith('_not_null'));
    if (meaningful.length > 0) {
      out.push('Constraints:');
      out.push('');
      for (const c of meaningful) out.push(`- \`${c.definition}\``);
      out.push('');
    }
  }

  const functions = await q(
    `
    select p.proname as name,
           pg_get_function_identity_arguments(p.oid) as args,
           obj_description(p.oid, 'pg_proc') as comment
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = $1 and obj_description(p.oid, 'pg_proc') is not null
     order by p.proname
  `,
    [schema],
  );

  out.push(`${heading} Functions\n`);
  out.push('| Function | Purpose |');
  out.push('|---|---|');
  for (const f of functions) {
    out.push(`| \`${f.name}(${f.args})\` | ${(f.comment ?? '').replace(/\|/g, '\\|')} |`);
  }
  out.push('');
  return tables.length + functions.length;
}

const socle = await describe('public');

// The modules, one section each. They are schemas of their own, and the socle
// ignores them — so they are documented after it and never mixed into it.
const modules = await q(`select code, name, schema_name, description from modules order by code`);
let described = 0;
if (modules.length > 0) {
  out.push('---');
  out.push('');
  out.push('# Modules\n');
  out.push(
    'One Postgres schema each, beside the socle. A module depends on `public` by foreign key',
    'and reaches the ledger only through `post_module_entry()`. It is enabled per company, and',
    'PostgREST serves its schema only once the project exposes it.\n',
  );
  for (const m of modules) {
    out.push(`## \`${m.schema_name}\` — ${m.name}\n`);
    if (m.description) out.push(`${m.description}\n`);
    described += await describe(m.schema_name, {
      anchor: (name) => `${m.schema_name}-${name}`,
      heading: '###',
    });
  }
}

out.push('---');
out.push('');
out.push('*This file is generated by `scripts/generate-schema-doc.mjs`. Edit the');
out.push('migrations and `docs/schema.intro.md`, then regenerate.*');
out.push('');

await writeFile(join(root, 'docs', 'schema.md'), out.join('\n'), 'utf8');
await db.close();
console.log(
  `docs/schema.md regenerated: ${socle} objects in the socle` +
    (modules.length > 0 ? `, ${described} in ${modules.length} module(s).` : '.'),
);
