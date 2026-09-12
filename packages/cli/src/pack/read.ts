/**
 * Reading a pack: the files, the CSV, and what the schema says about them.
 *
 * A pack is `packs/<cc>/`: a manifest, a chart of accounts as CSV, taxes as
 * JSON, and — accepted here, compiled later — the declaration boxes, the
 * financial statements and the translations. Nothing in it executes.
 */

import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate, type Issue } from './schema.js';

export interface PackAccount {
  code: string;
  parent: string | null;
  type: string;
  reconcilable: boolean;
  name: string;
  sequence: number;
}

export interface PackPosting {
  type: 'base' | 'tax';
  factor: number;
  account: string | null;
  box: string | null;
  box_factor: number;
  sequence: number;
}

export interface PackTax {
  code: string;
  name: string;
  description: string | null;
  amount_type: string;
  rate: number;
  scope: string;
  treatment: string;
  valid_from: string;
  valid_to: string | null;
  legal_reference: string | null;
  vat_category: string | null;
  exemption_code: string | null;
  sequence: number;
  postings: { invoice: PackPosting[]; credit_note: PackPosting[] };
  /** Reserved for phase 1: several taxes on one line. Refused until the core carries it. */
  group?: string[];
}

export interface Pack {
  /** Lower-case directory name, e.g. `be`. */
  slug: string;
  dir: string;
  manifest: Manifest;
  accounts: PackAccount[];
  taxes: PackTax[];
  /** Languages found under `i18n/`, whether or not they hold anything yet. */
  languages: string[];
  /** Account labels by code, then by language, gathered from `i18n/`. */
  accountLabels: Record<string, Record<string, string>>;
  /** sha256 of every file of the pack, so a change is visible without a diff. */
  checksum: string;
  /** Sections the schema accepts and this release does not compile. */
  deferred: string[];
}

export interface Manifest {
  country: string;
  name: string;
  version: string;
  schema_min: string;
  released_at?: string;
  certification?: { status: string; by?: string | null; on?: string; sources?: string[] };
  defaults: {
    currency: string;
    language?: string;
    roles: Record<string, string | null | undefined>;
    journal_roles?: Record<string, string | undefined>;
    [key: string]: unknown;
  };
  journals: { code: string; type: string; name: string; sequence?: number }[];
  [key: string]: unknown;
}

export class PackError extends Error {}

/** Repository root: the folder that holds both `packs/` and `supabase/seed/`. */
export function repoRootDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(join(dir, 'packs')) && existsSync(join(dir, 'supabase', 'seed'))) return dir;
    dir = dirname(dir);
  }
  throw new PackError(
    'packs_not_found: `ekwo pack` builds the country packs of a checkout of the repository, ' +
      'and neither packs/ nor supabase/seed/ was found above this file. ' +
      'A published installation does not need it: the compiled seeds ship with the package.',
  );
}

export function packsDir(root = repoRootDir()): string {
  return join(root, 'packs');
}

export function seedOutputDir(root = repoRootDir()): string {
  return join(root, 'supabase', 'seed');
}

/** The packs of this repository, by directory name, alphabetically. */
export async function listPacks(dir = packsDir()): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory() && /^[a-z]{2}$/.test(e.name))
    .map((e) => e.name)
    .sort();
}

/** The published schema, read from `packs/schema/pack.1.json`. */
export async function readSchema(dir = packsDir()): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(dir, 'schema', 'pack.1.json'), 'utf8')) as Record<string, unknown>;
}

/**
 * Reads, validates and normalises one pack.
 *
 * Validation is the published schema for every document, then the three
 * things a schema cannot say: a role, a posting and a journal role must name
 * something the pack itself carries.
 */
export async function readPack(slug: string, dir = packsDir()): Promise<Pack> {
  const root = join(dir, slug);
  const schema = await readSchema(dir);
  const defs = (schema['$defs'] ?? {}) as Record<string, Record<string, unknown>>;
  const issues: Issue[] = [];
  const deferred: string[] = [];

  const manifest = (await readJson(join(root, 'pack.json'))) as unknown as Manifest;
  issues.push(...validate(manifest, schema, schema));

  const rows = parseCsv(await readFile(join(root, 'accounts.csv'), 'utf8'), `${slug}/accounts.csv`);
  const accounts = rows.map((row, index) => {
    const account = {
      code: row['code'] ?? '',
      parent: emptyToNull(row['parent']),
      type: row['type'] ?? '',
      reconcilable: parseBoolean(row['reconcilable'], `${slug}/accounts.csv line ${index + 2}`),
      name: row['name'] ?? '',
      sequence: parseInteger(row['sequence'], `${slug}/accounts.csv line ${index + 2}`, (index + 1) * 10),
    } satisfies PackAccount;
    issues.push(
      ...validate(account, defs['accounts_csv'] ?? {}, schema, `accounts.csv[${index + 2}]`),
    );
    return account;
  });

  const rawTaxes = (await readJson(join(root, 'taxes.json'))) as unknown[];
  issues.push(...validate(rawTaxes, defs['taxes'] ?? {}, schema, 'taxes.json'));
  const taxes = rawTaxes.map((raw, index) => normaliseTax(raw as Record<string, unknown>, index));

  // Accepted, validated, not compiled by this release.
  if (existsSync(join(root, 'tax_report.json'))) {
    const report = await readJson(join(root, 'tax_report.json'));
    issues.push(...validate(report, defs['tax_report'] ?? {}, schema, 'tax_report.json'));
    deferred.push('tax_report.json — declaration boxes as data (P0-3)');
  }
  if (existsSync(join(root, 'statements.json'))) {
    const statements = await readJson(join(root, 'statements.json'));
    issues.push(...validate(statements, defs['statements'] ?? {}, schema, 'statements.json'));
    const lines = (statements as { statements?: unknown[] }).statements ?? [];
    if (lines.length > 0) deferred.push('statements.json — financial statements as data (P0-4)');
  }

  const languages: string[] = [];
  const accountLabels: Record<string, Record<string, string>> = {};
  const i18nDir = join(root, 'i18n');
  if (existsSync(i18nDir)) {
    for (const file of (await readdir(i18nDir)).filter((f) => f.endsWith('.json')).sort()) {
      const translations = (await readJson(join(i18nDir, file))) as {
        language?: string;
        accounts?: Record<string, string>;
        journals?: Record<string, string>;
        taxes?: Record<string, string>;
        tax_report_boxes?: Record<string, string>;
      };
      issues.push(...validate(translations, defs['i18n'] ?? {}, schema, `i18n/${file}`));
      const language = translations.language ?? file.replace(/\.json$/, '');
      languages.push(language);
      for (const [code, label] of Object.entries(translations.accounts ?? {})) {
        (accountLabels[code] ??= {})[language] = label;
      }
      const untranslated = Object.keys(translations.accounts ?? {}).filter((code) => !codesOf(accounts).has(code));
      for (const code of untranslated) {
        issues.push({ path: `i18n/${file}`, message: `account ${code} is not in this chart` });
      }
      if (
        Object.keys(translations.journals ?? {}).length > 0 ||
        Object.keys(translations.taxes ?? {}).length > 0 ||
        Object.keys(translations.tax_report_boxes ?? {}).length > 0
      ) {
        deferred.push(`i18n/${file} — only account labels are compiled; journals, taxes and boxes wait for their column`);
      }
    }
  }

  for (const section of ['documents', 'einvoicing', 'bank'] as const) {
    if (manifest[section] !== undefined) {
      deferred.push(`${section} — country_defaults columns and legal_mention_templates (P0-7)`);
    }
  }

  issues.push(...crossReferences(manifest, accounts, taxes));

  if (issues.length > 0) {
    const shown = issues.slice(0, 20).map((i) => `  ${i.path}: ${i.message}`);
    const more = issues.length > shown.length ? `\n  … and ${issues.length - shown.length} more` : '';
    throw new PackError(`pack_invalid: packs/${slug} — ${issues.length} problem(s)\n${shown.join('\n')}${more}`);
  }

  return {
    slug,
    dir: root,
    manifest,
    accounts,
    taxes,
    languages,
    accountLabels,
    checksum: await checksum(root),
    deferred,
  };
}

function codesOf(accounts: PackAccount[]): Set<string> {
  return new Set(accounts.map((a) => a.code));
}

/**
 * sha256 of the whole pack: every file, by relative path, path and bytes both.
 * It lands in `country_packs.checksum`, so an instance can be compared to a
 * pack without shipping the pack.
 */
async function checksum(dir: string): Promise<string> {
  const hash = createHash('sha256');
  for (const file of await filesUnder(dir)) {
    hash.update(file);
    hash.update('\0');
    hash.update(await readFile(join(dir, file)));
    hash.update('\0');
  }
  return hash.digest('hex');
}

async function filesUnder(dir: string, prefix = ''): Promise<string[]> {
  const entries = await readdir(join(dir, prefix), { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) out.push(...(await filesUnder(dir, relative)));
    else out.push(relative);
  }
  return out.sort();
}

function normaliseTax(raw: Record<string, unknown>, index: number): PackTax {
  const postings = (raw['postings'] ?? {}) as Record<string, Record<string, unknown>[] | undefined>;
  const kind = (name: 'invoice' | 'credit_note'): PackPosting[] =>
    (postings[name] ?? []).map((p, position) => ({
      type: p['type'] as 'base' | 'tax',
      factor: typeof p['factor'] === 'number' ? p['factor'] : 100,
      account: (p['account'] as string | undefined) ?? null,
      box: (p['box'] as string | undefined) ?? null,
      box_factor: typeof p['box_factor'] === 'number' ? p['box_factor'] : 100,
      sequence: typeof p['sequence'] === 'number' ? p['sequence'] : (position + 1) * 10,
    }));

  return {
    code: String(raw['code']),
    name: String(raw['name']),
    description: (raw['description'] as string | undefined) ?? null,
    amount_type: (raw['amount_type'] as string | undefined) ?? 'percent',
    rate: Number(raw['rate']),
    scope: String(raw['scope']),
    treatment: String(raw['treatment']),
    valid_from: String(raw['valid_from']),
    valid_to: (raw['valid_to'] as string | undefined) ?? null,
    legal_reference: (raw['legal_reference'] as string | undefined) ?? null,
    vat_category: (raw['vat_category'] as string | undefined) ?? null,
    exemption_code: (raw['exemption_code'] as string | undefined) ?? null,
    sequence: typeof raw['sequence'] === 'number' ? raw['sequence'] : (index + 1) * 10,
    postings: { invoice: kind('invoice'), credit_note: kind('credit_note') },
    ...(Array.isArray(raw['group']) ? { group: raw['group'] as string[] } : {}),
  };
}

/** What no schema can check: a code has to name something this pack carries. */
function crossReferences(manifest: Manifest, accounts: PackAccount[], taxes: PackTax[]): Issue[] {
  const issues: Issue[] = [];
  const codes = new Set(accounts.map((a) => a.code));
  const journals = new Set(manifest.journals.map((j) => j.code));

  for (const account of accounts) {
    if (account.parent !== null && !codes.has(account.parent)) {
      issues.push({ path: `accounts.csv ${account.code}`, message: `parent ${account.parent} is not in this chart` });
    }
  }
  for (const [role, code] of Object.entries(manifest.defaults.roles)) {
    if (code !== null && code !== undefined && !codes.has(code)) {
      issues.push({ path: `defaults.roles.${role}`, message: `${code} is not in this chart` });
    }
  }
  for (const [role, code] of Object.entries(manifest.defaults.journal_roles ?? {})) {
    if (code !== undefined && !journals.has(code)) {
      issues.push({ path: `defaults.journal_roles.${role}`, message: `${code} is not a journal of this pack` });
    }
  }
  const seen = new Set<string>();
  for (const tax of taxes) {
    if (seen.has(tax.code)) issues.push({ path: `taxes.json ${tax.code}`, message: 'duplicate code' });
    seen.add(tax.code);
    if (tax.group !== undefined) {
      issues.push({
        path: `taxes.json ${tax.code}`,
        message: 'a tax group is reserved for phase 1 and the core does not carry it yet',
      });
    }
    for (const [kind, postings] of Object.entries(tax.postings)) {
      const bases = postings.filter((p) => p.type === 'base');
      if (bases.length > 1) {
        issues.push({ path: `taxes.json ${tax.code}.${kind}`, message: 'more than one base posting' });
      }
      for (const posting of postings) {
        if (posting.type === 'tax' && posting.account === null) {
          issues.push({ path: `taxes.json ${tax.code}.${kind}`, message: 'a tax posting needs an account' });
        }
        if (posting.type === 'base' && posting.account !== null) {
          issues.push({ path: `taxes.json ${tax.code}.${kind}`, message: 'a base posting takes no account' });
        }
        if (posting.account !== null && !codes.has(posting.account)) {
          issues.push({
            path: `taxes.json ${tax.code}.${kind}`,
            message: `account ${posting.account} is not in this chart`,
          });
        }
      }
    }
  }
  return issues;
}

async function readJson(path: string): Promise<unknown> {
  const text = await readFile(path, 'utf8');
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new PackError(`pack_unreadable: ${path} — ${(error as Error).message}`);
  }
}

/**
 * The CSV subset a chart of accounts is written in: a header line, one row
 * per account, no newline inside a field, a field quoted only when it holds a
 * comma or a quote, a quote doubled inside a quoted field. Forty lines,
 * because anything richer is a format nobody can review in a diff.
 */
export function parseCsv(text: string, file: string): Record<string, string>[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n').filter((line) => line.length > 0);
  if (lines.length === 0) throw new PackError(`pack_invalid: ${file} is empty`);
  const header = splitCsvLine(lines[0] as string, file, 1);
  return lines.slice(1).map((line, index) => {
    const fields = splitCsvLine(line, file, index + 2);
    if (fields.length !== header.length) {
      throw new PackError(
        `pack_invalid: ${file} line ${index + 2} has ${fields.length} field(s), the header has ${header.length}`,
      );
    }
    const row: Record<string, string> = {};
    header.forEach((name, position) => {
      row[name] = fields[position] as string;
    });
    return row;
  });
}

function splitCsvLine(line: string, file: string, number: number): string[] {
  const fields: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char === '"') {
        if (line[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      if (field.length > 0) throw new PackError(`pack_invalid: ${file} line ${number}: a quote opens mid-field`);
      quoted = true;
      continue;
    }
    if (char === ',') {
      fields.push(field);
      field = '';
      continue;
    }
    field += char;
  }
  if (quoted) throw new PackError(`pack_invalid: ${file} line ${number}: a quoted field never closes`);
  fields.push(field);
  return fields;
}

function emptyToNull(value: string | undefined): string | null {
  return value === undefined || value === '' ? null : value;
}

function parseBoolean(value: string | undefined, where: string): boolean {
  if (value === 'true') return true;
  if (value === 'false' || value === undefined || value === '') return false;
  throw new PackError(`pack_invalid: ${where}: "${value}" is not true or false`);
}

function parseInteger(value: string | undefined, where: string, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new PackError(`pack_invalid: ${where}: "${value}" is not a whole number`);
  return parsed;
}
