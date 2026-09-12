#!/usr/bin/env node
/**
 * Builds `src/taxonomy/<framework>-<model>.ts` from an unpacked CBSO taxonomy
 * package published by the National Bank of Belgium.
 *
 * The package is not vendored (it weighs about 60 MB); download it from
 *   https://www.nbb.be/en/central-balance-sheet-office/drawing-and-filing/technical-information-and-taxonomy/taxonomy
 * unpack it, and point `--package` at the unpacked directory.
 *
 *   node scripts/build-taxonomy.mjs --package ~/nbb-cbso-26.0.15
 *   node scripts/build-taxonomy.mjs --package ~/nbb-cbso-26.0.15 --check
 *
 * How a reporting code maps to a fact
 * -----------------------------------
 * The taxonomy is dimensional: there is no element per reporting code. A model
 * (`fws/26.0/mod/m01/m01-f.xsd`) groups sections; a section is a table whose
 * rows and columns are rule nodes carrying dimension members, and whose rows
 * carry the reporting code in a label of role `http://www.nbb.be/fr/xbrl/rub`.
 * One cell = row members + column members, and that is one fact.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RUB_ROLE = 'http://www.nbb.be/fr/xbrl/rub';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1]
    : fallback;
}
const CHECK = process.argv.includes('--check');
const PACKAGE = arg('package');
const FRAMEWORK = arg('framework', '26.0');
const MODEL = arg('model', 'm01-f');

/** Locates `www.nbb.be/be/<lang>/cbso/fws` inside the unpacked package. */
function frameworksDir(pkg) {
  for (const base of [pkg, ...readdirSync(pkg).map((d) => join(pkg, d))]) {
    for (const lang of ['fr', 'nl', 'en', 'de']) {
      const p = join(base, 'www.nbb.be', 'be', lang, 'cbso', 'fws');
      if (existsSync(p)) return p;
    }
  }
  throw new Error(`no www.nbb.be/be/<lang>/cbso/fws under ${pkg}`);
}

const attr = (s, name) => {
  const m = s.match(new RegExp(`${name.replace(':', '\\:')}="([^"]*)"`));
  return m ? m[1] : null;
};

/** Splits an extended link base into its `<gen:link>` blocks. */
function genLinks(xml) {
  return [...xml.matchAll(/<gen:link\b([^>]*)>([\s\S]*?)<\/gen:link>/g)].map((m) => ({
    role: attr(m[1], 'xlink:role') ?? '',
    body: m[2],
  }));
}

/** node id → reporting code, from the labels of role `.../rub`. */
function rubricLabels(labPath) {
  if (!existsSync(labPath)) return new Map();
  const xml = readFileSync(labPath, 'utf8');
  const out = new Map();
  for (const { body } of genLinks(xml)) {
    const locs = new Map(); // xlink:label → node id
    for (const m of body.matchAll(/<loc\b([^>]*)\/>/g)) {
      const href = attr(m[1], 'xlink:href');
      const label = attr(m[1], 'xlink:label');
      if (href && label) locs.set(label, href.split('#').pop());
    }
    const labels = new Map(); // xlink:label → code
    for (const m of body.matchAll(/<label:label\b([^>]*)>([\s\S]*?)<\/label:label>/g)) {
      if (attr(m[1], 'xlink:role') !== RUB_ROLE) continue;
      const label = attr(m[1], 'xlink:label');
      if (label) labels.set(label, m[2].trim());
    }
    for (const m of body.matchAll(/<gen:arc\b([^>]*)\/>/g)) {
      const id = locs.get(attr(m[1], 'xlink:from'));
      const code = labels.get(attr(m[1], 'xlink:to'));
      if (id && code) out.set(id, code);
    }
  }
  return out;
}

/** Every cell of one table of one section, as `{ code, elem, dims }`. */
function tableCells(rendPath, labPath, tableId) {
  const xml = readFileSync(rendPath, 'utf8');
  const rub = rubricLabels(labPath);
  const suffix = `_${tableId.replace('table', '')}`;
  const cells = [];

  for (const { role, body } of genLinks(xml)) {
    if (!role.endsWith(suffix)) continue;

    const nodes = new Map(); // xlink:label → { id, dims, elem }
    // A rule node is either self-closing (an abstract node, no members) or a
    // pair of tags holding its dimension members.
    for (const m of body.matchAll(
      /<table:ruleNode\b([^>]*?)(?:\/>|>([\s\S]*?)<\/table:ruleNode>)/g,
    )) {
      const inner = m[2] ?? '';
      const dims = {};
      for (const d of inner.matchAll(
        /<formula:explicitDimension\s+dimension="([^"]+)">\s*<formula:member>\s*<formula:qname>([^<]+)<\/formula:qname>/g,
      )) {
        dims[d[1]] = d[2].trim();
      }
      const elem = inner.match(/<formula:concept>\s*<formula:qname>([^<]+)<\/formula:qname>/);
      nodes.set(attr(m[1], 'xlink:label'), {
        id: attr(m[1], 'id'),
        dims,
        elem: elem ? elem[1].trim() : null,
      });
    }

    const parent = new Map(); // child label → parent label
    for (const m of body.matchAll(/<table:definitionNodeSubtreeArc\b([^>]*)\/>/g)) {
      parent.set(attr(m[1], 'xlink:to'), attr(m[1], 'xlink:from'));
    }
    const treeRoot = new Map(); // node label → breakdown label
    for (const m of body.matchAll(/<table:breakdownTreeArc\b([^>]*)\/>/g)) {
      treeRoot.set(attr(m[1], 'xlink:to'), attr(m[1], 'xlink:from'));
    }
    const axisOf = new Map(); // breakdown label → axis
    for (const m of body.matchAll(/<table:tableBreakdownArc\b([^>]*)\/>/g)) {
      axisOf.set(attr(m[1], 'xlink:to'), attr(m[1], 'axis'));
    }

    /** Walks up the subtree arcs: a node inherits the members of its ancestors. */
    const chain = (label) => {
      const stack = [];
      for (let cur = label, seen = new Set(); cur && !seen.has(cur); cur = parent.get(cur)) {
        seen.add(cur);
        stack.push(cur);
      }
      const dims = {};
      let elem = null;
      for (const l of stack.reverse()) {
        const n = nodes.get(l);
        if (!n) continue;
        Object.assign(dims, n.dims);
        if (n.elem) elem = n.elem;
      }
      return { dims, elem, root: stack[0] };
    };
    const axis = (label) => axisOf.get(treeRoot.get(chain(label).root)) ?? null;

    const columns = [...nodes.keys()].filter((l) => axis(l) === 'x').map((l) => chain(l));
    for (const [label, node] of nodes) {
      const code = rub.get(node.id);
      if (!code || axis(label) === 'x') continue;
      const row = chain(label);
      for (const col of columns) {
        // The "diagonal" rows of the movement tables (`aln:m1`) belong to the
        // previous-period column, which is the one carrying `rut:m1`.
        if ((row.dims['dim:aln'] === 'aln:m1') !== (col.dims['dim:rut'] === 'rut:m1')) continue;
        cells.push({
          code,
          elem: row.elem ?? col.elem,
          dims: { ...col.dims, ...row.dims },
        });
      }
    }
  }
  return cells;
}

/**
 * Reporting code and column of one cell.
 *
 * The rows of the social balance sheet carry one label for a group of columns
 * (`1001-1002-1003-1003P`, one per `wrg` member plus the previous period), and
 * a code between brackets is the same code shown again in another section.
 */
function reportingCode(cell) {
  const column = cell.dims['dim:prd'] === 'prd:m2' ? 'P' : 'N';
  let code = cell.code.trim();
  if (code.startsWith('(') && code.endsWith(')')) code = code.slice(1, -1);
  if (code.includes('-')) {
    const parts = code.split('-');
    const wrg = cell.dims['dim:wrg'];
    if (!wrg?.startsWith('wrg:m')) return null;
    const i = Number(wrg.slice('wrg:m'.length)) - 1;
    if (column === 'P') return i === 2 && parts.length > 3 ? { code: parts[3], column } : null;
    return i < 3 && i < parts.length ? { code: parts[i], column } : null;
  }
  return { code, column };
}

/**
 * Dimensions that place a fact in the previous-period column of a table rather
 * than name what it measures: the period itself, the "previous rubric" marker
 * and the diagonal layout of the movement tables.
 */
const COLUMN_ONLY = new Set(['dim:prd', 'dim:rut', 'dim:aln']);

/**
 * `8059P` → `8059`, but `14P` stays `14P`.
 *
 * The NBB gives a box of its own to the previous-period figure of the annexes
 * (`8059P`, `1003P`). Where that box measures the same thing as its base code —
 * same metric, same members but for the ones that select the column — it is the
 * `p` figure of that code, and folding the two keeps one entry per measure.
 * `14P` is not in that case: "profit carried forward from the previous year" is
 * a line of its own, on another base than rubric 14.
 */
function foldPreviousPeriodCodes(cells) {
  const signatures = new Map(); // code → set of signatures, column members dropped
  for (const cell of cells) {
    const resolved = reportingCode(cell);
    if (!resolved || !cell.elem) continue;
    const members = Object.entries(cell.dims)
      .filter(([dim]) => !COLUMN_ONLY.has(dim))
      .sort(([a], [b]) => a.localeCompare(b));
    const set = signatures.get(resolved.code) ?? new Set();
    set.add(JSON.stringify([cell.elem, members]));
    signatures.set(resolved.code, set);
  }
  const folded = new Map();
  for (const [code, set] of signatures) {
    if (!code.endsWith('P') || set.size !== 1) continue;
    const base = code.slice(0, -1);
    const baseSet = signatures.get(base);
    if (baseSet?.size === 1 && [...baseSet][0] === [...set][0]) folded.set(code, base);
  }
  return folded;
}

/** Unit and decimals follow the metric: amounts in euro, counts and FTEs pure. */
function measure(elem) {
  if (elem.startsWith('met:am')) return { unit: 'EUR', dec: 'INF' };
  if (elem.startsWith('met:dec') || elem.startsWith('met:int')) return { unit: 'pure', dec: 'INF' };
  return {};
}

function build() {
  const fws = frameworksDir(PACKAGE);
  const modelPath = join(fws, FRAMEWORK, 'mod', MODEL.split('-')[0], `${MODEL}-presentation.xml`);
  if (!existsSync(modelPath)) throw new Error(`model not found: ${modelPath}`);

  const refs = [
    ...new Set(
      [...readFileSync(modelPath, 'utf8').matchAll(/sect\/(s\.[0-9a-z.]+)-rend\.xml#(table\d+)/g)].map(
        (m) => `${m[1]}|${m[2]}`,
      ),
    ),
  ].sort();

  const cells = [];
  for (const ref of refs) {
    const [sec, table] = ref.split('|');
    cells.push(
      ...tableCells(
        join(fws, FRAMEWORK, 'sect', `${sec}-rend.xml`),
        join(fws, FRAMEWORK, 'sect', `${sec}-lab.xml`),
        table,
      ).map((c) => ({ ...c, sec })),
    );
  }
  const folded = foldPreviousPeriodCodes(cells);

  const seen = new Map(); // `${code}:${column}` → fact
  const facts = [];
  const collisions = [];
  {
    for (const cell of cells) {
      const resolved = reportingCode(cell);
      if (!resolved || !cell.elem) continue;
      const code = folded.get(resolved.code) ?? resolved.code;
      const role = `rubrique:${code}:${resolved.column}`;
      const sec = cell.sec;
      const dims = Object.fromEntries(Object.entries(cell.dims).sort(([a], [b]) => a.localeCompare(b)));
      const signature = JSON.stringify([cell.elem, dims]);
      const previous = seen.get(role);
      if (previous) {
        if (previous !== signature) collisions.push({ role, previous, signature, sec });
        continue;
      }
      seen.set(role, signature);
      facts.push({
        elem: cell.elem,
        dims,
        period: { type: 'instant', ref: 'N' },
        role,
        ...measure(cell.elem),
      });
    }
  }
  if (collisions.length) {
    for (const c of collisions) console.error(`collision on ${c.role} (${c.sec})\n  A ${c.previous}\n  B ${c.signature}`);
    throw new Error(`${collisions.length} reporting codes map to more than one fact`);
  }
  facts.sort((a, b) => a.role.localeCompare(b.role));
  return facts;
}

function render(facts) {
  const constant = `CBSO_${FRAMEWORK.split('.')[0]}_${MODEL.toUpperCase().replace('-', '')}_FACTS`;
  const lines = facts.map((f) => `  ${JSON.stringify(f)},`).join('\n');
  return `/**
 * Reporting codes of the CBSO taxonomy — framework ${FRAMEWORK}, model \`${MODEL}\`
 * (abridged annual accounts, companies with capital).
 *
 * The taxonomy is dimensional: the reporting code is carried by the DIMENSIONS
 * of the context, never by the element name, which is one of a handful of
 * generic metrics. One entry = one cell of one section of the model.
 *
 * The previous-period column is the \`dim:prd\` member \`prd:m2\`, in a context
 * whose period stays the closing date of the current financial year.
 *
 * Generated by \`scripts/build-taxonomy.mjs\` from the taxonomy package
 * published by the National Bank of Belgium. Do not edit by hand.
 */
import type { TemplateFact } from '../types.js';

export const ${constant}: readonly TemplateFact[] = [
${lines}
];
`;
}

if (!PACKAGE) {
  console.error('usage: build-taxonomy.mjs --package <unpacked taxonomy dir> [--framework 26.0] [--model m01-f] [--check]');
  process.exit(2);
}

const facts = build();
const out = join(ROOT, 'src', 'taxonomy', `cbso-${FRAMEWORK.split('.')[0]}-${MODEL}.ts`);
const rendered = render(facts);

if (CHECK) {
  const current = existsSync(out) ? readFileSync(out, 'utf8') : '';
  if (current !== rendered) {
    console.error(`${out} is out of date — rerun without --check`);
    process.exit(1);
  }
  console.log(`${out} matches framework ${FRAMEWORK} of the package (${facts.length} facts)`);
} else {
  writeFileSync(out, rendered);
  console.log(`wrote ${out} — ${facts.length} facts, framework ${FRAMEWORK}, model ${MODEL}`);
}
