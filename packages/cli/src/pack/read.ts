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

/**
 * The chart a pack has when it declares none, and the name of the framework
 * pack. Both are mechanism words: `default` is not a country and `generic` is
 * not a language — a pack says its chart is called PCMN, in its own data.
 */
export const DEFAULT_CHART = 'default';
export const GENERIC_PACK = 'generic';

export interface PackAccount {
  code: string;
  parent: string | null;
  type: string;
  reconcilable: boolean;
  name: string;
  sequence: number;
}

export interface PackPosting {
  /**
   * `base` is the line itself and `tax_on_base` is the share of the tax that
   * is not recoverable; neither carries an account, because both land on the
   * account the document line names.
   */
  type: 'base' | 'tax' | 'tax_on_base';
  factor: number;
  account: string | null;
  box: string | null;
  box_factor: number;
  /** Declaration form the box belongs to. Defaults to the pack's periodic return. */
  report: string | null;
  sequence: number;
}

export interface PackTax {
  code: string;
  name: string;
  description: string | null;
  /** vat | gst | sales_tax | withholding | other. A label for the reports. */
  kind: string;
  amount_type: string;
  rate: number;
  scope: string;
  treatment: string;
  valid_from: string;
  valid_to: string | null;
  legal_reference: string | null;
  vat_category: string | null;
  exemption_code: string | null;
  /** False when the buyer never gets the tax back. */
  recoverable: boolean;
  /** The unit price already holds the tax. */
  price_include: boolean;
  /** ISO 3166-2 with the country prefix, for a tax levied by a state. */
  jurisdiction: string | null;
  /** Due on collection. Compiled to a column the cash-basis engine reads. */
  cash_basis: boolean;
  /** Account the tax waits on until the invoice is paid. */
  cash_basis_transition_account: string | null;
  sequence: number;
  postings: { invoice: PackPosting[]; credit_note: PackPosting[] };
  /** Reserved for phase 1: several taxes on one line. Refused until the core carries it. */
  group?: string[];
}

/** One chart of accounts of a country, and the accounts it holds. */
export interface PackChart {
  code: string;
  name: string;
  name_i18n: Record<string, string>;
  /** File the accounts were read from, relative to the pack directory. */
  file: string;
  accounts: PackAccount[];
  is_default: boolean;
  audience: string | null;
  /** Codes of the statements this chart reports on. */
  statements: string[];
  certification: { status: string; by?: string | null; on?: string; sources?: string[] } | null;
  legal_reference: string | null;
}

/** One rule bringing accounts of a chart to a line of a statement. */
export interface PackStatementRule {
  kind: 'code_range' | 'code_prefix' | 'account_type' | 'account_code';
  code_from: string | null;
  code_to: string | null;
  account_type: string | null;
  side: 'debit' | 'credit' | 'any';
  sequence: number;
}

/** One line of a financial statement. */
export interface PackStatementLine {
  code: string;
  parent: string | null;
  name: string;
  sequence: number;
  sign: 1 | -1;
  is_total: boolean;
  plus: string[];
  minus: string[];
  xbrl: string | null;
  legal_reference: string | null;
  rules: PackStatementRule[];
}

/** `statements.json`: the financial statements of a pack. */
export interface PackStatement {
  code: string;
  kind: string;
  framework: string | null;
  /**
   * Taxonomy the `xbrl` fact keys of this statement are written against, as
   * `name:version` — `nbb-cbso:26.0`. The format library that reads the keys
   * carries the table of one version; against another, a key resolves onto a
   * different line and nothing says so.
   */
  taxonomy: string | null;
  name: string;
  valid_from: string;
  valid_to: string | null;
  legal_reference: string | null;
  /** Chart this statement belongs to, or null for every chart of the country. */
  chart_code: string | null;
  lines: PackStatementLine[];
}

/** One box of a declaration form. A total carries the lists it is added from. */
export interface PackReportBox {
  box: string;
  kind: 'base' | 'tax' | 'total';
  name: string;
  sequence: number;
  plus: string[];
  minus: string[];
  floor_zero: boolean;
  hidden: boolean;
  xml_element: string | null;
  legal_reference: string | null;
}

/** One sentence a country requires on an invoice, and when it applies. */
export interface PackMention {
  code: string;
  /** One of the nine conditions of the closed vocabulary. */
  applies_when: string;
  text: string;
  text_i18n: Record<string, string>;
  sequence: number;
  valid_from: string;
  valid_to: string | null;
  legal_reference: string | null;
}

/**
 * The `documents`, `einvoicing` and `bank` sections of the manifest, read as
 * one thing because they compile to one row: what a country requires on a
 * document, how it is exchanged, and the formats its banks speak.
 *
 * Every field is null where the pack said nothing, and null is what reaches
 * the column. There is no fallback here and there is none in the schema: a
 * legal payment term or an e-invoicing profile invented for a country that
 * has not spoken would be one country's law printed on another's invoice.
 */
export interface PackDocumentRules {
  /** True where the law forbids a hole in the sequence. Null if unsaid. */
  numbering_gapless: boolean | null;
  number_format: string | null;
  legal_payment_days: number | null;
  late_payment_reference: string | null;
  /** invoice_date | delivery_date | payment_date. */
  tax_point_rule: string | null;
  einvoice_profile: string | null;
  einvoice_mandatory_from: string | null;
  /** ISO 6523 ICD, four digits. */
  party_scheme: string | null;
  vat_scheme: string | null;
  bank_statement_formats: string[];
  payment_formats: string[];
  fiscal_year_default: string | null;
  mentions: PackMention[];
}

/** `tax_report.json`: one declaration form and its boxes. */
export interface PackReport {
  code: string;
  name: string;
  period: string;
  valid_from: string;
  valid_to: string | null;
  legal_reference: string | null;
  boxes: PackReportBox[];
}

/** One line of `assets.json`: what a kind of asset is usually depreciated over. */
export interface PackAssetCategory {
  code: string;
  name: string;
  name_i18n: Record<string, string>;
  method: string;
  duration_months: number;
  coefficient: number | null;
  prorata: string | null;
  account_type: string | null;
  sequence: number;
  legal_reference: string | null;
}

/**
 * `packs/<cc>/assets.json` — the country data of the `assets` module.
 *
 * It is read here, with the rest of the pack, rather than by the module: a
 * pack is one object with one checksum and one `ekwo pack check`, and a module
 * that read its own section would be a second reader of the same folder with
 * its own idea of what a valid pack is. What is module-specific is where the
 * compiler writes it — `supabase/seed/modules/assets/` and not the pack seed.
 */
export interface PackAssets {
  prorata_straight_line: string;
  prorata_declining: string;
  day_count: string;
  declining_cap_percent: number | null;
  declining_switch_to_linear: boolean;
  disposal_style: string | null;
  legal_reference: string | null;
  categories: PackAssetCategory[];
}

export interface Pack {
  /** Lower-case directory name, e.g. `be`. */
  slug: string;
  dir: string;
  manifest: Manifest;
  /** Charts of this country, the default one first. Never empty. */
  charts: PackChart[];
  /** Accounts of the default chart. The chart a pack has when it declares only one. */
  accounts: PackAccount[];
  taxes: PackTax[];
  /** `statements.json`, with every line and rule normalised. */
  statements: PackStatement[];
  /**
   * Languages this pack publishes, the language of its own files first. A
   * language the manifest declares covers every label; one that is only a
   * file under `i18n/` may be partial.
   */
  languages: string[];
  /** Every translated label of the pack, by section, by key, by language. */
  labels: PackLabels;
  /** What this country requires on a document, how it is exchanged, and its bank formats. */
  documents: PackDocumentRules;
  /** The periodic return of this pack, from `tax_report.json`. */
  report: PackReport | null;
  /** Code of the periodic return. The default of every box. */
  reportCode: string | null;
  /** `assets.json`, or null where this country says nothing about fixed assets. */
  assets: PackAssets | null;
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
  languages?: string[];
  journals: { code: string; type: string; name: string; sequence?: number }[];
  charts?: {
    code: string;
    name: string;
    accounts: string;
    default?: boolean;
    audience?: string;
    statements?: string[];
    certification?: { status: string; by?: string | null; on?: string; sources?: string[] };
    legal_reference?: string | null;
  }[];
  [key: string]: unknown;
}

/** `packs/generic/pack.json`: a framework of statements, with no country. */
export interface FrameworkManifest {
  code: string;
  name: string;
  version: string;
  schema_min: string;
  released_at?: string;
  language?: string;
  certification?: { status: string; by?: string | null; on?: string; sources?: string[] };
}

/**
 * Every label of a pack in every language but its own, read from `i18n/`.
 *
 * One shape throughout: section, then the key the label belongs to, then the
 * language. It is the only place a translation lives — the rest of the pack
 * is written in `defaults.language` and carries no second wording, so a
 * contributor adding a language edits one file and a reviewer reads one file.
 */
export interface PackLabels {
  /** The country itself, by language. The one section keyed by language alone. */
  pack_name: Record<string, string>;
  /** By chart code. */
  charts: Record<string, Record<string, string>>;
  /** By account code, across every chart. */
  accounts: Record<string, Record<string, string>>;
  /** By journal code. */
  journals: Record<string, Record<string, string>>;
  /** By tax code. */
  taxes: Record<string, Record<string, string>>;
  /** By `box|kind`, because a form may carry a base and a tax on one line. */
  tax_report_boxes: Record<string, Record<string, string>>;
  /** By `statement:line`, because two statements may both carry a line `20`. */
  statement_lines: Record<string, Record<string, string>>;
  /** By legal mention code. */
  legal_mentions: Record<string, Record<string, string>>;
  /** By fixed-asset category code. */
  asset_categories: Record<string, Record<string, string>>;
}

/** A pack with no country: statements by account type, and nothing else. */
export interface FrameworkPack {
  slug: string;
  dir: string;
  manifest: FrameworkManifest;
  statements: PackStatement[];
  checksum: string;
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

  // The charts. A pack that declares none has exactly one, `default`, whose
  // accounts are in accounts.csv — which is what every pack written before
  // charts existed says, without changing a line of it.
  const declared = manifest.charts ?? [
    { code: DEFAULT_CHART, name: DEFAULT_CHART, accounts: 'accounts.csv', default: true },
  ];
  const charts: PackChart[] = [];
  for (const entry of declared) {
    const file = entry.accounts;
    if (!existsSync(join(root, file))) {
      issues.push({ path: `pack.json charts.${entry.code}`, message: `${file} does not exist` });
      continue;
    }
    const rows = parseCsv(await readFile(join(root, file), 'utf8'), `${slug}/${file}`);
    const accounts = rows.map((row, index) => {
      const account = {
        code: row['code'] ?? '',
        parent: emptyToNull(row['parent']),
        type: row['type'] ?? '',
        reconcilable: parseBoolean(row['reconcilable'], `${slug}/${file} line ${index + 2}`),
        name: row['name'] ?? '',
        sequence: parseInteger(row['sequence'], `${slug}/${file} line ${index + 2}`, (index + 1) * 10),
      } satisfies PackAccount;
      issues.push(...validate(account, defs['accounts_csv'] ?? {}, schema, `${file}[${index + 2}]`));
      return account;
    });
    charts.push({
      code: entry.code,
      name: entry.name,
      name_i18n: {},
      file,
      accounts,
      is_default: entry.default === true,
      audience: entry.audience ?? null,
      statements: entry.statements ?? [],
      certification: entry.certification ?? null,
      legal_reference: entry.legal_reference ?? null,
    });
  }
  charts.sort((a, b) => (a.is_default === b.is_default ? a.code.localeCompare(b.code) : a.is_default ? -1 : 1));
  const accounts = charts.find((c) => c.is_default)?.accounts ?? charts[0]?.accounts ?? [];

  const rawTaxes = (await readJson(join(root, 'taxes.json'))) as unknown[];
  issues.push(...validate(rawTaxes, defs['taxes'] ?? {}, schema, 'taxes.json'));
  const taxes = rawTaxes.map((raw, index) => normaliseTax(raw as Record<string, unknown>, index));

  let report: PackReport | null = null;
  if (existsSync(join(root, 'tax_report.json'))) {
    const raw = await readJson(join(root, 'tax_report.json'));
    issues.push(...validate(raw, defs['tax_report'] ?? {}, schema, 'tax_report.json'));
    report = normaliseReport(raw as Record<string, unknown>);
  }
  const reportCode = report?.code ?? null;

  let statements: PackStatement[] = [];
  if (existsSync(join(root, 'statements.json'))) {
    const raw = await readJson(join(root, 'statements.json'));
    issues.push(...validate(raw, defs['statements'] ?? {}, schema, 'statements.json'));
    statements = normaliseStatements(raw as Record<string, unknown>, charts);
  }

  const documents = normaliseDocumentRules(manifest);

  // The section of a module. A pack that carries none simply has no country
  // rule for that module, and the module refuses by name where it needs one.
  let assets: PackAssets | null = null;
  if (existsSync(join(root, 'assets.json'))) {
    const raw = await readJson(join(root, 'assets.json'));
    issues.push(...validate(raw, defs['module_assets'] ?? {}, schema, 'assets.json'));
    assets = normaliseAssets(raw as Record<string, unknown>);
    issues.push(...assetReferences(assets, manifest));
  }

  // The languages. Read last, because a label is checked against the section
  // it belongs to, and every section has to exist first.
  const labels: PackLabels = {
    pack_name: {},
    charts: {},
    accounts: {},
    journals: {},
    taxes: {},
    tax_report_boxes: {},
    statement_lines: {},
    legal_mentions: {},
    asset_categories: {},
  };
  const languages: string[] = [];
  const i18nDir = join(root, 'i18n');
  if (existsSync(i18nDir)) {
    for (const file of (await readdir(i18nDir)).filter((f) => f.endsWith('.json')).sort()) {
      const translations = (await readJson(join(i18nDir, file))) as Record<string, unknown>;
      issues.push(...validate(translations, defs['i18n'] ?? {}, schema, `i18n/${file}`));
      const language = (translations['language'] as string | undefined) ?? file.replace(/\.json$/, '');
      languages.push(language);
      const section = (name: string): Record<string, string> =>
        (translations[name] ?? {}) as Record<string, string>;

      if (typeof translations['pack_name'] === 'string') {
        labels.pack_name[language] = translations['pack_name'];
      }

      // A key names something the pack carries, or it is a typo nobody would
      // ever see: a label under a code that does not exist reaches no reader.
      const byCode = (
        name: keyof PackLabels & ('charts' | 'accounts' | 'journals' | 'taxes' | 'legal_mentions' | 'asset_categories'),
        known: Set<string>,
        what: string,
      ): void => {
        for (const [code, label] of Object.entries(section(name))) {
          if (!known.has(code)) {
            issues.push({ path: `i18n/${file} ${name}`, message: `${code} is not ${what} of this pack` });
            continue;
          }
          ((labels[name][code] ??= {}) as Record<string, string>)[language] = label;
        }
      };

      byCode('charts', new Set(charts.map((c) => c.code)), 'a chart');
      byCode('accounts', codesOfCharts(charts), 'an account');
      byCode('journals', new Set(manifest.journals.map((j) => j.code)), 'a journal');
      byCode('taxes', new Set(taxes.map((t) => t.code)), 'a tax');
      byCode('legal_mentions', new Set(documents.mentions.map((m) => m.code)), 'a legal mention');
      byCode('asset_categories', new Set((assets?.categories ?? []).map((c) => c.code)), 'a fixed-asset category');

      // A box is translated by the same reference the formulas use: `54`, or
      // `08:tax` where the form carries a base and a tax on one line.
      for (const [ref, label] of Object.entries(section('tax_report_boxes'))) {
        const resolved = resolveBoxRef(ref, report?.boxes ?? []);
        if (typeof resolved === 'string') {
          issues.push({ path: `i18n/${file} ${ref}`, message: resolved });
          continue;
        }
        (labels.tax_report_boxes[`${resolved.box}|${resolved.kind}`] ??= {})[language] = label;
      }

      // A statement line is translated by `<statement>:<line>`, which is how a
      // line is named everywhere else once two statements carry a line `20`.
      for (const [ref, label] of Object.entries(section('statement_lines'))) {
        const [statementCode, lineCode] = ref.includes(':') ? ref.split(':') : [undefined, undefined];
        const line = statements
          .find((st) => st.code === statementCode)
          ?.lines.find((l) => l.code === lineCode);
        if (line === undefined) {
          issues.push({
            path: `i18n/${file} ${ref}`,
            message: 'is not a line of any statement of this pack; write <statement>:<line>',
          });
          continue;
        }
        (labels.statement_lines[`${statementCode as string}:${lineCode as string}`] ??= {})[language] = label;
      }
    }
  }

  // A language the manifest declares is a promise that every label exists in
  // it. A language that is only a file may be partial, and falls back.
  issues.push(...languageCoverage(manifest, languages, labels, charts, taxes, statements, report, documents, assets));

  // The rows that carry a translation get theirs from the language files, so
  // that one file is the whole of one language.
  for (const chart of charts) chart.name_i18n = labels.charts[chart.code] ?? {};
  for (const mention of documents.mentions) mention.text_i18n = labels.legal_mentions[mention.code] ?? {};
  for (const category of assets?.categories ?? []) {
    category.name_i18n = labels.asset_categories[category.code] ?? {};
  }

  // A posting with a box belongs to a form. The pack names one in
  // `tax_report.json`; a posting may override it the day a country files two.
  for (const tax of taxes) {
    for (const postings of Object.values(tax.postings)) {
      for (const posting of postings) {
        if (posting.report === null && posting.box !== null) posting.report = reportCode;
      }
    }
  }

  issues.push(...crossReferences(manifest, charts, taxes));
  issues.push(...reportReferences(report, taxes));
  issues.push(...statementReferences(statements, charts));
  issues.push(...documentReferences(documents));

  if (issues.length > 0) {
    // The cause before the consequence. A label problem is almost always
    // downstream of a structural one — take a box out of the declaration and
    // every language stops resolving it — so the structure is listed first and
    // the reader is not made to scroll past forty translations to reach the one
    // line that explains them.
    const ordered = [
      ...issues.filter((i) => !i.path.startsWith('i18n/')),
      ...issues.filter((i) => i.path.startsWith('i18n/')),
    ];
    const shown = ordered.slice(0, 20).map((i) => `  ${i.path}: ${i.message}`);
    const more = issues.length > shown.length ? `\n  … and ${issues.length - shown.length} more` : '';
    throw new PackError(`pack_invalid: packs/${slug} — ${issues.length} problem(s)\n${shown.join('\n')}${more}`);
  }

  return {
    slug,
    dir: root,
    manifest,
    charts,
    accounts,
    taxes,
    statements,
    // The pack's own language first, then the ones the manifest declares, in
    // the order it declares them — not the order `readdir` happens to return.
    // This list is what an installer shows a human being.
    languages: [
      ...(manifest.defaults.language === undefined ? [] : [manifest.defaults.language]),
      ...(manifest.languages ?? []),
      ...languages.filter((l) => !(manifest.languages ?? []).includes(l)),
    ],
    labels,
    documents,
    report,
    reportCode,
    assets,
    checksum: await checksum(root),
    deferred,
  };
}

function normaliseAssets(raw: Record<string, unknown>): PackAssets {
  const depreciation = (raw['depreciation'] ?? {}) as Record<string, unknown>;
  const disposal = (raw['disposal'] ?? null) as Record<string, unknown> | null;
  const categories = (raw['categories'] ?? []) as Record<string, unknown>[];
  return {
    prorata_straight_line: String(depreciation['prorata_straight_line'] ?? ''),
    prorata_declining: String(depreciation['prorata_declining'] ?? ''),
    // `actual` is the calendar and not a country's answer: a pack that says
    // nothing counts the days that exist. A commercial year of twelve
    // thirty-day months is a convention, so it is declared.
    day_count: String(depreciation['day_count'] ?? 'actual'),
    declining_cap_percent:
      depreciation['declining_cap_percent'] === undefined || depreciation['declining_cap_percent'] === null
        ? null
        : Number(depreciation['declining_cap_percent']),
    declining_switch_to_linear: depreciation['declining_switch_to_linear'] !== false,
    disposal_style: disposal === null ? null : String(disposal['style']),
    legal_reference:
      (depreciation['legal_reference'] as string | null | undefined) ??
      (disposal?.['legal_reference'] as string | null | undefined) ??
      null,
    categories: categories.map((category, index) => ({
      code: String(category['code']),
      name: String(category['name']),
      name_i18n: (category['name_i18n'] ?? {}) as Record<string, string>,
      method: String(category['method']),
      duration_months: Number(category['duration_months']),
      coefficient:
        category['coefficient'] === undefined || category['coefficient'] === null
          ? null
          : Number(category['coefficient']),
      prorata: (category['prorata'] as string | null | undefined) ?? null,
      account_type: (category['account_type'] as string | null | undefined) ?? null,
      sequence: Number(category['sequence'] ?? (index + 1) * 10),
      legal_reference: (category['legal_reference'] as string | null | undefined) ?? null,
    })),
  };
}

/**
 * What an `assets.json` obliges the rest of the pack to say.
 *
 * The same shape as `closingRules`, and for the same reason: a disposal style
 * is a promise about which accounts exist, and a pack that makes it without
 * naming them is a company finding out on the day it sells a van. The role
 * codes themselves are checked against every chart by `crossReferences`, so
 * what is left here is which roles a style needs.
 */
function assetReferences(assets: PackAssets, manifest: Manifest): Issue[] {
  const issues: Issue[] = [];
  const roles = manifest.defaults.roles;
  const named = (role: string): boolean => roles[role] !== undefined && roles[role] !== null;

  if (assets.disposal_style === 'net_result' && !named('asset_disposal_gain')) {
    issues.push({
      path: 'defaults.roles.asset_disposal_gain',
      message: 'a pack that disposes on the net result has to name the account the gain lands on',
    });
  }
  if (assets.disposal_style === 'gross') {
    for (const role of ['asset_disposal_proceeds', 'asset_disposal_value']) {
      if (!named(role)) {
        issues.push({
          path: `defaults.roles.${role}`,
          message: 'a pack that disposes gross has to name it: the value sold and the proceeds are two lines',
        });
      }
    }
  }

  const seen = new Set<string>();
  for (const category of assets.categories) {
    if (seen.has(category.code)) {
      issues.push({ path: `assets.json ${category.code}`, message: 'duplicate category code' });
    }
    seen.add(category.code);
    if (category.method === 'declining_balance' && category.coefficient === null) {
      issues.push({
        path: `assets.json ${category.code}`,
        message: 'a declining balance with no coefficient is a straight line nobody asked for',
      });
    }
    if (category.method !== 'declining_balance' && category.coefficient !== null) {
      issues.push({
        path: `assets.json ${category.code}`,
        message: `a ${category.method} category takes no coefficient`,
      });
    }
    if (category.legal_reference === null) {
      issues.push({
        path: `assets.json ${category.code}`,
        message: 'a usual duration comes from somewhere; name the source',
      });
    }
  }
  return issues;
}

/**
 * The framework pack: statements by account type, no country, no chart.
 *
 * It is read and compiled beside the country packs because it is the same
 * kind of thing — declarative lines an accountant can read — and because the
 * fallback that gives any chart a readable balance sheet should not be the one
 * object of the system that lives in a migration.
 */
export async function readFrameworkPack(slug = GENERIC_PACK, dir = packsDir()): Promise<FrameworkPack> {
  const root = join(dir, slug);
  const schema = await readSchema(dir);
  const defs = (schema['$defs'] ?? {}) as Record<string, Record<string, unknown>>;
  const issues: Issue[] = [];

  const manifest = (await readJson(join(root, 'pack.json'))) as unknown as FrameworkManifest;
  issues.push(...validate(manifest, defs['framework'] ?? {}, schema));

  const raw = await readJson(join(root, 'statements.json'));
  issues.push(...validate(raw, defs['statements'] ?? {}, schema, 'statements.json'));
  const statements = normaliseStatements(raw as Record<string, unknown>, []);

  for (const statement of statements) {
    for (const line of statement.lines) {
      for (const rule of line.rules) {
        if (rule.kind !== 'account_type') {
          issues.push({
            path: `statements.json ${statement.code}.${line.code}`,
            message:
              `a ${rule.kind} rule names a chart, and this framework has none. ` +
              'The generic statements are what the eighteen account types buy: account_type rules only.',
          });
        }
      }
    }
  }
  issues.push(...statementReferences(statements, []));

  if (issues.length > 0) {
    const shown = issues.slice(0, 20).map((i) => `  ${i.path}: ${i.message}`);
    const more = issues.length > shown.length ? `\n  … and ${issues.length - shown.length} more` : '';
    throw new PackError(`pack_invalid: packs/${slug} — ${issues.length} problem(s)\n${shown.join('\n')}${more}`);
  }

  return { slug, dir: root, manifest, statements, checksum: await checksum(root) };
}

function codesOfCharts(charts: PackChart[]): Set<string> {
  const codes = new Set<string>();
  for (const chart of charts) for (const account of chart.accounts) codes.add(account.code);
  return codes;
}

/**
 * What a declared language owes the reader.
 *
 * `languages` in the manifest is a promise: somebody who sets their books to
 * Dutch sees Dutch everywhere, not a chart of accounts in Dutch and a
 * declaration form in French. So a declared language must have its file, and
 * that file must carry every label the pack shows a user — the charts, the
 * accounts of every chart, the journals, the taxes, the boxes of the
 * declaration, the lines of every statement, the legal mentions of an
 * invoice, and the fixed-asset categories where the pack has them.
 *
 * A language that is only a file under `i18n/` and is not declared is not
 * held to this: it may be partial, and a key it does not carry falls back to
 * the pack's own label. That is the way to contribute a language one section
 * at a time without promising a reader something the pack cannot keep.
 */
function languageCoverage(
  manifest: Manifest,
  found: string[],
  labels: PackLabels,
  charts: PackChart[],
  taxes: PackTax[],
  statements: PackStatement[],
  report: PackReport | null,
  documents: PackDocumentRules,
  assets: PackAssets | null,
): Issue[] {
  const issues: Issue[] = [];
  const own = manifest.defaults.language;

  const sections: [keyof PackLabels & string, string[]][] = [
    ['charts', charts.map((c) => c.code)],
    ['accounts', [...codesOfCharts(charts)].sort()],
    ['journals', manifest.journals.map((j) => j.code)],
    ['taxes', taxes.map((t) => t.code)],
    ['tax_report_boxes', (report?.boxes ?? []).map((b) => `${b.box}|${b.kind}`)],
    [
      'statement_lines',
      statements.flatMap((st) => st.lines.map((line) => `${st.code}:${line.code}`)),
    ],
    ['legal_mentions', documents.mentions.map((m) => m.code)],
    ['asset_categories', (assets?.categories ?? []).map((c) => c.code)],
  ];

  for (const language of manifest.languages ?? []) {
    if (language === own) {
      issues.push({
        path: 'pack.json languages',
        message: `${language} is the language the pack itself is written in (defaults.language); do not list it again`,
      });
      continue;
    }
    if (!found.includes(language)) {
      issues.push({
        path: 'pack.json languages',
        message: `${language} is declared and packs/${manifest.country.toLowerCase()}/i18n/${language}.json does not exist`,
      });
      continue;
    }
    if (labels.pack_name[language] === undefined) {
      issues.push({ path: `i18n/${language}.json`, message: 'pack_name is missing' });
    }
    for (const [name, keys] of sections) {
      const held = labels[name] as Record<string, Record<string, string>>;
      const missing = keys.filter((key) => held[key]?.[language] === undefined);
      if (missing.length === 0) continue;
      const shown = missing.slice(0, 8).join(', ');
      const more = missing.length > 8 ? `, and ${missing.length - 8} more` : '';
      issues.push({
        path: `i18n/${language}.json ${name}`,
        message: `${missing.length} of ${keys.length} missing: ${shown}${more}`,
      });
    }
  }
  return issues;
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
      type: p['type'] as 'base' | 'tax' | 'tax_on_base',
      factor: typeof p['factor'] === 'number' ? p['factor'] : 100,
      account: (p['account'] as string | undefined) ?? null,
      box: (p['box'] as string | undefined) ?? null,
      box_factor: typeof p['box_factor'] === 'number' ? p['box_factor'] : 100,
      report: (p['report'] as string | undefined) ?? null,
      sequence: typeof p['sequence'] === 'number' ? p['sequence'] : (position + 1) * 10,
    }));

  return {
    code: String(raw['code']),
    name: String(raw['name']),
    description: (raw['description'] as string | undefined) ?? null,
    kind: (raw['kind'] as string | undefined) ?? 'vat',
    amount_type: (raw['amount_type'] as string | undefined) ?? 'percent',
    rate: Number(raw['rate']),
    scope: String(raw['scope']),
    treatment: String(raw['treatment']),
    valid_from: String(raw['valid_from']),
    valid_to: (raw['valid_to'] as string | undefined) ?? null,
    legal_reference: (raw['legal_reference'] as string | undefined) ?? null,
    vat_category: (raw['vat_category'] as string | undefined) ?? null,
    exemption_code: (raw['exemption_code'] as string | undefined) ?? null,
    recoverable: typeof raw['recoverable'] === 'boolean' ? raw['recoverable'] : true,
    price_include: typeof raw['price_include'] === 'boolean' ? raw['price_include'] : false,
    jurisdiction: (raw['jurisdiction'] as string | undefined) ?? null,
    cash_basis: typeof raw['cash_basis'] === 'boolean' ? raw['cash_basis'] : false,
    cash_basis_transition_account: (raw['cash_basis_transition_account'] as string | undefined) ?? null,
    sequence: typeof raw['sequence'] === 'number' ? raw['sequence'] : (index + 1) * 10,
    postings: { invoice: kind('invoice'), credit_note: kind('credit_note') },
    ...(Array.isArray(raw['group']) ? { group: raw['group'] as string[] } : {}),
  };
}

function normaliseReport(raw: Record<string, unknown>): PackReport {
  const boxes = ((raw['boxes'] ?? []) as Record<string, unknown>[]).map((box, index) => ({
    box: String(box['box']),
    kind: box['kind'] as 'base' | 'tax' | 'total',
    name: String(box['name']),
    sequence: typeof box['sequence'] === 'number' ? box['sequence'] : (index + 1) * 10,
    plus: (box['plus'] as string[] | undefined) ?? [],
    minus: (box['minus'] as string[] | undefined) ?? [],
    floor_zero: box['floor_zero'] === true,
    hidden: box['hidden'] === true,
    xml_element: (box['xml_element'] as string | undefined) ?? null,
    legal_reference: (box['legal_reference'] as string | undefined) ?? null,
  })) satisfies PackReportBox[];

  return {
    code: String(raw['code']),
    name: String(raw['name'] ?? raw['code']),
    period: String(raw['period'] ?? 'month_or_quarter'),
    valid_from: String(raw['valid_from'] ?? '1970-01-01'),
    valid_to: (raw['valid_to'] as string | undefined) ?? null,
    legal_reference: (raw['legal_reference'] as string | undefined) ?? null,
    boxes,
  };
}

/**
 * The tokens a document number may be built from, and the one that counts.
 *
 * `{CODE}` is the series, `{YYYY}` or `{YY}` the year, `{MM}` the month, and
 * a run of `N` is the counter, zero-padded to its own length. Nothing reads
 * the pattern yet — `next_entry_number()` produces `CODE/YYYY/NNNN` — so the
 * check here is that the pattern is *readable*: no token nobody defined, and
 * a counter somewhere, because a number without one is not a number.
 */
const NUMBER_FORMAT_TOKEN = /\{([^{}]*)\}/g;
const KNOWN_NUMBER_TOKEN = /^(CODE|YYYY|YY|MM|N+)$/;

/** The two numbering styles that forbid a hole. The other two allow one. */
const GAPLESS_NUMBERING = new Set(['gapless_per_year', 'gapless']);

/**
 * `documents`, `einvoicing` and `bank`, normalised into the row they compile
 * to. A section left out is not an error and not a default: every field comes
 * out null, and `country_defaults` holds null, and a reader that needs the
 * value raises rather than borrowing another country's answer.
 */
function normaliseDocumentRules(manifest: Manifest): PackDocumentRules {
  const documents = (manifest['documents'] ?? {}) as Record<string, unknown>;
  const einvoicing = (manifest['einvoicing'] ?? {}) as Record<string, unknown>;
  const bank = (manifest['bank'] ?? {}) as Record<string, unknown>;
  const numbering = documents['numbering'] as string | undefined;

  const mentions = ((documents['mentions'] ?? []) as Record<string, unknown>[]).map(
    (mention, index) =>
      ({
        code: String(mention['code']),
        applies_when: String(mention['applies_when']),
        text: String(mention['text']),
        text_i18n: (mention['text_i18n'] as Record<string, string> | undefined) ?? {},
        sequence: typeof mention['sequence'] === 'number' ? mention['sequence'] : (index + 1) * 10,
        valid_from: String(mention['valid_from'] ?? '1970-01-01'),
        valid_to: (mention['valid_to'] as string | undefined) ?? null,
        legal_reference: (mention['legal_reference'] as string | undefined) ?? null,
      }) satisfies PackMention,
  );

  return {
    numbering_gapless: numbering === undefined ? null : GAPLESS_NUMBERING.has(numbering),
    number_format: (documents['number_format'] as string | undefined) ?? null,
    legal_payment_days: (documents['legal_payment_days'] as number | null | undefined) ?? null,
    late_payment_reference: (documents['late_payment_reference'] as string | null | undefined) ?? null,
    tax_point_rule: (documents['tax_point'] as string | undefined) ?? null,
    einvoice_profile: (einvoicing['profile'] as string | null | undefined) ?? null,
    einvoice_mandatory_from: (einvoicing['mandatory_from'] as string | null | undefined) ?? null,
    party_scheme: (einvoicing['party_scheme'] as string | null | undefined) ?? null,
    vat_scheme: (einvoicing['vat_scheme'] as string | null | undefined) ?? null,
    bank_statement_formats: (bank['statement_formats'] as string[] | undefined) ?? [],
    payment_formats: (bank['payment_formats'] as string[] | undefined) ?? [],
    fiscal_year_default: (manifest.defaults['fiscal_year_default'] as string | undefined) ?? null,
    mentions,
  };
}

/**
 * What the schema cannot say about the document rules.
 *
 * The closed vocabularies — the condition of a mention, the tax point, the
 * bank formats, the four digits of an ISO 6523 scheme, the shape of a date —
 * are all in `packs/schema/pack.1.json`, so they are checked before this runs
 * and an editor sees them too. What is left is the handful of things one
 * field cannot know about another.
 */
function documentReferences(rules: PackDocumentRules): Issue[] {
  const issues: Issue[] = [];
  const where = 'pack.json documents';

  const seen = new Set<string>();
  for (const mention of rules.mentions) {
    if (seen.has(mention.code)) {
      issues.push({ path: `${where}.mentions.${mention.code}`, message: 'duplicate mention code' });
    }
    seen.add(mention.code);
    if (mention.valid_to !== null && mention.valid_to < mention.valid_from) {
      issues.push({
        path: `${where}.mentions.${mention.code}`,
        message: `valid_to ${mention.valid_to} is before valid_from ${mention.valid_from}`,
      });
    }
    if (mention.legal_reference === null) {
      issues.push({
        path: `${where}.mentions.${mention.code}`,
        message: 'names no legal_reference; a sentence the law requires cites the article that requires it',
      });
    }
  }

  const format = rules.number_format;
  if (format !== null) {
    let counters = 0;
    for (const [, token] of format.matchAll(NUMBER_FORMAT_TOKEN)) {
      const name = token ?? '';
      if (!KNOWN_NUMBER_TOKEN.test(name)) {
        issues.push({
          path: `${where}.number_format`,
          message: `{${name}} is not a token; write {CODE}, {YYYY}, {YY}, {MM} or a run of N for the counter`,
        });
        continue;
      }
      if (name.startsWith('N')) counters += 1;
    }
    if (counters !== 1) {
      issues.push({
        path: `${where}.number_format`,
        message:
          counters === 0
            ? 'carries no counter; write {NNNN} where the sequence goes'
            : `carries ${counters} counters, and a number is drawn from one`,
      });
    }
  }

  // A date for an obligation nobody named, or the other way round: both are a
  // half-declared pack, and both come out as a column that cannot be read.
  if (rules.einvoice_mandatory_from !== null && rules.einvoice_profile === null) {
    issues.push({
      path: 'pack.json einvoicing',
      message: 'mandatory_from names a day an obligation starts, and no profile says what becomes obligatory',
    });
  }

  return issues;
}

/**
 * Which kind of box a posting feeds. A form knows `base`, `tax` and `total`;
 * a posting knows `base`, `tax` and `tax_on_base`. The share of a tax that
 * nobody recovers reports on the **base** side — it is a cost sitting on a
 * base account, which is exactly why the Belgian grids 82 and 83 carry it
 * together with the base. `vat_return()` says the same thing the other way
 * round, deriving the kind of a ledger line from `tax_line`, which a
 * `tax_on_base` line does not set.
 */
function declarationKind(type: PackPosting['type']): 'base' | 'tax' {
  return type === 'tax' ? 'tax' : 'base';
}

/**
 * `statements.json`, normalised.
 *
 * A statement belongs to the chart that names it: listed by exactly one chart
 * it is that chart's, listed by several or by none it fits every chart of the
 * country. One list, in `pack.json`, decides both what a chart reports on and
 * what a statement applies to — there is no second place to keep in step.
 */
function normaliseStatements(raw: Record<string, unknown>, charts: PackChart[]): PackStatement[] {
  const owners = (code: string): string[] =>
    charts.filter((c) => c.statements.includes(code)).map((c) => c.code);

  return ((raw['statements'] ?? []) as Record<string, unknown>[]).map((statement) => {
    const code = String(statement['code']);
    const named = owners(code);
    const lines = ((statement['lines'] ?? []) as Record<string, unknown>[]).map((line, index) => ({
      code: String(line['code']),
      parent: (line['parent'] as string | undefined) ?? null,
      name: String(line['name']),
      sequence: typeof line['sequence'] === 'number' ? line['sequence'] : (index + 1) * 10,
      sign: (line['sign'] === -1 ? -1 : 1) as 1 | -1,
      is_total: line['is_total'] === true,
      plus: (line['plus'] as string[] | undefined) ?? [],
      minus: (line['minus'] as string[] | undefined) ?? [],
      xbrl: (line['xbrl'] as string | undefined) ?? null,
      legal_reference: (line['legal_reference'] as string | undefined) ?? null,
      rules: ((line['rules'] ?? []) as Record<string, unknown>[]).map((rule, position) => ({
        kind: rule['kind'] as PackStatementRule['kind'],
        code_from: (rule['code_from'] as string | undefined) ?? null,
        code_to: (rule['code_to'] as string | undefined) ?? null,
        account_type: (rule['account_type'] as string | undefined) ?? null,
        side: ((rule['side'] as string | undefined) ?? 'any') as PackStatementRule['side'],
        sequence: typeof rule['sequence'] === 'number' ? rule['sequence'] : (position + 1) * 10,
      })),
    })) satisfies PackStatementLine[];

    return {
      code,
      kind: String(statement['kind']),
      framework: (statement['framework'] as string | undefined) ?? null,
      taxonomy: (statement['taxonomy'] as string | undefined) ?? null,
      name: String(statement['name'] ?? code),
      valid_from: String(statement['valid_from'] ?? '1970-01-01'),
      valid_to: (statement['valid_to'] as string | undefined) ?? null,
      legal_reference: (statement['legal_reference'] as string | undefined) ?? null,
      chart_code: named.length === 1 ? (named[0] as string) : null,
      lines,
    } satisfies PackStatement;
  });
}

/** Does this rule catch this account code? The same comparison the SQL makes. */
function ruleCatches(rule: PackStatementRule, code: string): boolean {
  const from = rule.code_from ?? '';
  const to = rule.code_to ?? '';
  switch (rule.kind) {
    case 'account_code':
      return code === from;
    case 'code_prefix':
      return code.slice(0, from.length) === from;
    case 'code_range':
      return code.slice(0, from.length) >= from && code.slice(0, to.length) <= to;
    default:
      return false;
  }
}

/**
 * What the schema cannot say about a statement.
 *
 * The first four are the rules a declaration form already lives by: a line
 * code is unique, a parent exists, a formula names lines of the same
 * statement, and it never names a total computed after it.
 *
 * The fifth is the one that makes a statement tie out: **every leaf account of
 * every chart it applies to reaches exactly one line**. Two lines may share an
 * account only when their sides exclude each other — a suspense account is a
 * receivable in debit and a payable in credit, and that is one account on one
 * line at a time. A heading account, one with children in the chart, is
 * allowed to reach none: it straddles the lines its children are split over,
 * and nothing is ever posted to it.
 */
/**
 * Shape of a fact key, without knowing any taxonomy: parts separated by `|`,
 * each one a `prefix:member`, the metric first and then the domain members, no
 * prefix twice. `met:am1|bas:m9|rst:m2` is a key; a lone `met:am1` names every
 * amount of the model, and a prefix given twice is two members of one
 * dimension, which no fact has.
 *
 * What a key means is the taxonomy's business, not this file's: the checker
 * refuses what cannot be a key, and the uniqueness rule above catches the key
 * that means two things at once.
 */
function xbrlKeyProblem(key: string): string | null {
  const parts = key.split('|');
  if (parts.some((part) => part !== part.trim() || part === '')) {
    return 'a fact key is parts separated by "|", with nothing empty or padded';
  }
  if (parts.length < 2) {
    return 'a fact key is a metric and at least one domain member, e.g. "met:am1|bas:m9"';
  }
  const seen = new Set<string>();
  for (const part of parts) {
    if (!/^[a-z]+:[a-z0-9]+$/.test(part)) {
      return `"${part}" is not a qualified name such as "bas:m9"`;
    }
    const prefix = part.slice(0, part.indexOf(':'));
    if (seen.has(prefix)) {
      return `two parts in the domain "${prefix}"; a fact has one member per dimension`;
    }
    seen.add(prefix);
  }
  return null;
}

function statementReferences(statements: PackStatement[], charts: PackChart[]): Issue[] {
  const issues: Issue[] = [];
  const seenStatements = new Set<string>();

  for (const statement of statements) {
    const where = `statements.json ${statement.code}`;
    if (seenStatements.has(statement.code)) {
      issues.push({ path: where, message: 'duplicate statement code' });
    }
    seenStatements.add(statement.code);

    const byCode = new Map<string, PackStatementLine>();
    // A fact key names one fact of the taxonomy, so it names one line. Two
    // lines carrying the same key means the key is missing the member that
    // separates them — the two sides of a balance sheet share every member but
    // one, and `met:am1|bas:m25` alone is both totals at once.
    const byXbrl = new Map<string, string>();

    // A fact key is written against one version of one taxonomy. The library
    // that reads the keys carries the table of that version; against another,
    // a key resolves onto a different line and nothing says so. So a statement
    // that carries keys has to name what they were written against. Which
    // library implements that taxonomy is no business of this file: the
    // end-to-end test is where the two are put in the same room.
    if (statement.lines.some((line) => line.xbrl !== null) && statement.taxonomy === null) {
      issues.push({
        path: where,
        message:
          'lines carry fact keys but the statement names no taxonomy; add "taxonomy": "<name>:<version>"',
      });
    }

    for (const line of statement.lines) {
      if (byCode.has(line.code)) {
        issues.push({ path: `${where} ${line.code}`, message: 'duplicate line code' });
      }
      byCode.set(line.code, line);
      if (line.xbrl !== null) {
        const malformed = xbrlKeyProblem(line.xbrl);
        if (malformed !== null) {
          issues.push({ path: `${where} ${line.code}.xbrl`, message: malformed });
        }
        const other = byXbrl.get(line.xbrl);
        if (other !== undefined) {
          issues.push({
            path: `${where} ${line.code}.xbrl`,
            message:
              `${line.xbrl} already names line ${other}. A fact key names one fact: ` +
              'add the member that separates the two lines.',
          });
        }
        byXbrl.set(line.xbrl, line.code);
      }
      if (line.is_total && line.rules.length > 0) {
        issues.push({
          path: `${where} ${line.code}`,
          message: 'a total is computed from other lines; it takes no rule of its own',
        });
      }
      if (!line.is_total && line.plus.length + line.minus.length > 0) {
        issues.push({
          path: `${where} ${line.code}`,
          message: 'only a total is computed from other lines; mark it is_total or drop the formula',
        });
      }
    }

    for (const line of statement.lines) {
      if (line.parent !== null && !byCode.has(line.parent)) {
        issues.push({ path: `${where} ${line.code}`, message: `parent ${line.parent} is not a line of this statement` });
      }
      for (const [list, refs] of [
        ['plus', line.plus],
        ['minus', line.minus],
      ] as const) {
        for (const ref of refs) {
          const target = byCode.get(ref);
          if (target === undefined) {
            issues.push({ path: `${where} ${line.code}.${list}`, message: `${ref} is not a line of this statement` });
            continue;
          }
          if (ref === line.code) {
            issues.push({ path: `${where} ${line.code}.${list}`, message: `${ref} is the line itself` });
          }
        }
      }
    }

    // Totals are evaluated in the order they depend on each other, not the
    // order they are printed in — a balance sheet prints a subtotal above the
    // lines it adds up. What that cannot survive is a cycle.
    const resolved = new Set(statement.lines.filter((l) => !l.is_total).map((l) => l.code));
    let pending = statement.lines.filter((l) => l.is_total);
    for (;;) {
      const ready = pending.filter((l) => [...l.plus, ...l.minus].every((ref) => resolved.has(ref)));
      if (ready.length === 0) break;
      for (const line of ready) resolved.add(line.code);
      pending = pending.filter((l) => !resolved.has(l.code));
    }
    if (pending.length > 0 && pending.every((l) => [...l.plus, ...l.minus].every((ref) => byCode.has(ref)))) {
      issues.push({
        path: where,
        message:
          `the totals ${pending.map((l) => l.code).join(', ')} depend on each other and on nothing else. ` +
          'A total is computed from lines that can be computed without it.',
      });
    }

    // No account on two lines of the same statement. Two lines may share one
    // only when their sides exclude each other: a suspense account is a
    // receivable while it is in debit and a payable while it is in credit, and
    // that is still one line at a time.
    const applicable = charts.filter(
      (c) => statement.chart_code === null || statement.chart_code === c.code,
    );
    for (const chart of applicable) {
      for (const account of chart.accounts) {
        const hits = statement.lines.filter((line) => line.rules.some((rule) => ruleCatches(rule, account.code)));
        if (hits.length < 2) continue;
        const sides = hits.flatMap((line) =>
          line.rules.filter((rule) => ruleCatches(rule, account.code)).map((rule) => rule.side),
        );
        const exclusive = sides.length === 2 && sides.includes('debit') && sides.includes('credit');
        if (!exclusive) {
          issues.push({
            path: `${where} ${chart.code}`,
            message:
              `account ${account.code} reaches ${hits.length} lines (${hits.map((l) => l.code).join(', ')}). ` +
              'Two lines may share an account only when one takes it in debit and the other in credit.',
          });
        }
      }
    }
  }

  // And nothing falls off the edge: every account a chart can be posted to
  // reaches a line of *some* statement of that chart. A heading — an account
  // with children — may reach none, because it straddles the lines its
  // children are split over and nothing is posted to it. This is the check
  // that makes a balance sheet tie out, and the reason `unmapped_accounts()`
  // answers empty on a company that never left the pack.
  for (const chart of charts) {
    const covering = statements.filter(
      (st) => st.chart_code === null || st.chart_code === chart.code,
    );
    if (covering.length === 0) continue;
    const parents = new Set(chart.accounts.map((a) => a.parent).filter((c): c is string => c !== null));
    for (const account of chart.accounts) {
      if (account.type === 'off_balance') continue;
      if (parents.has(account.code)) continue;
      const found = covering.some((st) =>
        st.lines.some((line) => line.rules.some((rule) => ruleCatches(rule, account.code))),
      );
      if (!found) {
        issues.push({
          path: `statements.json ${chart.code}`,
          message: `account ${account.code} (${account.name}) reaches no line of any statement of this chart`,
        });
      }
    }
  }

  // A chart may only name statements the pack carries.
  const known = new Set(statements.map((s) => s.code));
  for (const chart of charts) {
    for (const code of chart.statements) {
      if (!known.has(code)) {
        issues.push({ path: `pack.json charts.${chart.code}`, message: `${code} is not a statement of this pack` });
      }
    }
  }

  return issues;
}

/**
 * A reference in a plus/minus list, or in an i18n key, to the one box it
 * names. Bare, it has to match exactly one box of the form; qualified
 * (`08:tax`), it names the kind itself — the French CA3 carries a base and a
 * tax on line 08 and the Belgian form never does. Returns the box, or the
 * sentence that says why it does not resolve.
 */
export function resolveBoxRef(ref: string, boxes: PackReportBox[]): PackReportBox | string {
  const [code, kind] = ref.includes(':') ? ref.split(':') : [ref, undefined];
  const matches = boxes.filter((b) => b.box === code && (kind === undefined || b.kind === kind));
  if (matches.length === 0) {
    return kind === undefined
      ? `${ref} is not a box of this form`
      : `${ref} is not a ${kind} box of this form`;
  }
  if (matches.length > 1) {
    return `${ref} is ambiguous: this form carries it as ${matches
      .map((b) => b.kind)
      .join(' and ')}. Write ${matches.map((b) => `${code}:${b.kind}`).join(' or ')}.`;
  }
  return matches[0] as PackReportBox;
}

/**
 * What the schema cannot say about a declaration form: a formula only names
 * boxes of the same form, it names them without ambiguity, it never names
 * itself, and it never names a total that is computed after it — the totals
 * are evaluated once, in the order the form declares them.
 */
function reportReferences(report: PackReport | null, taxes: PackTax[]): Issue[] {
  if (report === null) return [];
  const issues: Issue[] = [];
  const where = 'tax_report.json';

  const seen = new Set<string>();
  for (const box of report.boxes) {
    const key = `${box.box}|${box.kind}`;
    if (seen.has(key)) {
      issues.push({ path: `${where} ${box.box}`, message: `duplicate ${box.kind} box` });
    }
    seen.add(key);
    if (box.kind !== 'total' && (box.plus.length > 0 || box.minus.length > 0)) {
      issues.push({
        path: `${where} ${box.box}`,
        message: 'only a total is computed from other boxes; a base or a tax box is summed from the ledger',
      });
    }
  }

  for (const box of report.boxes) {
    for (const [list, refs] of [
      ['plus', box.plus],
      ['minus', box.minus],
    ] as const) {
      for (const ref of refs) {
        const target = resolveBoxRef(ref, report.boxes);
        if (typeof target === 'string') {
          issues.push({ path: `${where} ${box.box}.${list}`, message: target });
          continue;
        }
        if (target.box === box.box && target.kind === box.kind) {
          issues.push({ path: `${where} ${box.box}.${list}`, message: `${ref} is the box itself` });
          continue;
        }
        if (target.kind === 'total' && target.sequence >= box.sequence) {
          issues.push({
            path: `${where} ${box.box}.${list}`,
            message:
              `${ref} is a total computed at sequence ${target.sequence}, ` +
              `after this one at ${box.sequence}. A total may only name a total before it.`,
          });
        }
      }
    }
  }

  // A box a tax posts to has to exist on the form the posting names, or the
  // amount lands nowhere and the return is short without saying so.
  for (const tax of taxes) {
    for (const [kind, postings] of Object.entries(tax.postings)) {
      for (const posting of postings) {
        if (posting.box === null || posting.report !== report.code) continue;
        const target = resolveBoxRef(`${posting.box}:${declarationKind(posting.type)}`, report.boxes);
        if (typeof target === 'string') {
          issues.push({ path: `taxes.json ${tax.code}.${kind}`, message: `box ${target}` });
        }
      }
    }
  }

  return issues;
}

/** What no schema can check: a code has to name something this pack carries. */
function crossReferences(manifest: Manifest, charts: PackChart[], taxes: PackTax[]): Issue[] {
  const issues: Issue[] = [];
  const journals = new Set(manifest.journals.map((j) => j.code));

  // Exactly one default chart, and no code claimed twice inside one chart.
  const defaults = charts.filter((c) => c.is_default);
  if (defaults.length !== 1) {
    issues.push({
      path: 'pack.json charts',
      message:
        defaults.length === 0
          ? 'no chart is the default; `ekwo init` would have nothing to install when nobody names one'
          : `${defaults.length} charts are the default (${defaults.map((c) => c.code).join(', ')}); exactly one is`,
    });
  }
  const chartCodes = new Set<string>();
  for (const chart of charts) {
    if (chartCodes.has(chart.code)) {
      issues.push({ path: `pack.json charts.${chart.code}`, message: 'duplicate chart code' });
    }
    chartCodes.add(chart.code);

    const codes = new Set<string>();
    for (const account of chart.accounts) {
      if (codes.has(account.code)) {
        issues.push({ path: `${chart.file} ${account.code}`, message: 'duplicate account code' });
      }
      codes.add(account.code);
    }
    for (const account of chart.accounts) {
      if (account.parent !== null && !codes.has(account.parent)) {
        issues.push({
          path: `${chart.file} ${account.code}`,
          message: `parent ${account.parent} is not in this chart`,
        });
      }
    }
  }

  // A role and a tax account have to exist in *every* chart: the taxes, the
  // journals and the roles of a country are common to its charts, so a chart
  // that misses one is a company that installs with no payable account or a
  // VAT posting with nowhere to book.
  for (const chart of charts) {
    const codes = new Set(chart.accounts.map((a) => a.code));
    for (const [role, code] of Object.entries(manifest.defaults.roles)) {
      if (code !== null && code !== undefined && !codes.has(code)) {
        issues.push({ path: `defaults.roles.${role}`, message: `${code} is not in chart ${chart.code}` });
      }
    }
    for (const tax of taxes) {
      if (tax.cash_basis_transition_account !== null && !codes.has(tax.cash_basis_transition_account)) {
        issues.push({
          path: `taxes.json ${tax.code}`,
          message: `cash_basis_transition_account ${tax.cash_basis_transition_account} is not in chart ${chart.code}`,
        });
      }
      for (const [kind, postings] of Object.entries(tax.postings)) {
        for (const posting of postings) {
          if (posting.account !== null && !codes.has(posting.account)) {
            issues.push({
              path: `taxes.json ${tax.code}.${kind}`,
              message: `account ${posting.account} is not in chart ${chart.code}`,
            });
          }
        }
      }
    }
  }
  for (const [role, code] of Object.entries(manifest.defaults.journal_roles ?? {})) {
    if (code !== undefined && !journals.has(code)) {
      issues.push({ path: `defaults.journal_roles.${role}`, message: `${code} is not a journal of this pack` });
    }
  }
  issues.push(...closingRules(manifest, journals));
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
    // A tax that falls due on collection waits somewhere, and the place it
    // waits is a fact about the chart, so the pack says it. `post_document`
    // refuses such a tax at posting; this refuses it where it can be read.
    if (tax.cash_basis && tax.cash_basis_transition_account === null) {
      issues.push({
        path: `taxes.json ${tax.code}`,
        message: 'a tax that falls due on collection has to name the account it waits on',
      });
    }
    for (const [kind, postings] of Object.entries(tax.postings)) {
      const bases = postings.filter((p) => p.type === 'base');
      if (bases.length > 1) {
        issues.push({ path: `taxes.json ${tax.code}.${kind}`, message: 'more than one base posting' });
      }
      if (tax.cash_basis) {
        // One posting per side, or the transition lines of a document cannot
        // be told apart when the matching sends each of them on. A tax whose
        // postings net out has nothing waiting to collect anyway.
        if (postings.filter((p) => p.type === 'tax').length > 1) {
          issues.push({
            path: `taxes.json ${tax.code}.${kind}`,
            message: 'a tax that falls due on collection takes one tax posting',
          });
        }
        if (postings.some((p) => p.type === 'tax_on_base')) {
          issues.push({
            path: `taxes.json ${tax.code}.${kind}`,
            message: 'a share nobody gets back is a cost, and a cost is not deferred to a payment',
          });
        }
        // And it needs a box to fall due *into*. `settle_cash_basis_tax()`
        // only ever moves a line that carries a box amount, and a posting
        // with no box produces none — so the tax would sit on the transition
        // account for ever, settled by nothing and declared by nothing, with
        // no error anywhere. Refused here, where the pack can be corrected.
        if (postings.some((p) => p.type === 'tax' && p.box === null)) {
          issues.push({
            path: `taxes.json ${tax.code}.${kind}`,
            message:
              'a tax that falls due on collection has to name the box it falls due into, or the amount waits on the transition account for ever',
          });
        }
      }
      for (const posting of postings) {
        if (posting.type === 'tax' && posting.account === null) {
          issues.push({ path: `taxes.json ${tax.code}.${kind}`, message: 'a tax posting needs an account' });
        }
        if (posting.type !== 'tax' && posting.account !== null) {
          issues.push({
            path: `taxes.json ${tax.code}.${kind}`,
            message: `a ${posting.type} posting takes no account: it lands on the account of the document line`,
          });
        }
      }
    }
  }
  return issues;
}

/**
 * What a `closing_style` obliges the rest of the pack to say.
 *
 * The schema carries no default for any of it — a default closing style is
 * one country's mechanism applied to every country that has not spoken, and
 * `OPN` is the journal code Belgium and France happen to use. So a pack that
 * declares a style has to name the accounts and the journal that style needs,
 * and `ekwo pack check` says which one is missing rather than letting
 * `close_fiscal_year` find out on somebody's year end.
 */
function closingRules(manifest: Manifest, journals: Set<string>): Issue[] {
  const issues: Issue[] = [];
  const style = manifest.defaults['closing_style'] as string | undefined;
  if (style === undefined) return issues;

  const roles = manifest.defaults.roles;
  const needed =
    style === 'retained_earnings'
      ? ['retained_earnings']
      : ['current_year_result_profit', 'current_year_result_loss'];
  for (const role of needed) {
    if (roles[role] === undefined || roles[role] === null) {
      issues.push({
        path: `defaults.roles.${role}`,
        message: `a pack that closes with ${style} has to name it`,
      });
    }
  }

  const opening = manifest.defaults.journal_roles?.['opening'];
  if (opening === undefined) {
    issues.push({
      path: 'defaults.journal_roles.opening',
      message: 'a pack that declares a closing_style has to name the journal its opening and year-end entries go on',
    });
  } else if (journals.has(opening)) {
    const journal = manifest.journals.find((j) => j.code === opening);
    if (journal !== undefined && journal.type !== 'opening') {
      issues.push({
        path: 'defaults.journal_roles.opening',
        message: `${opening} is of type ${journal.type}, and the opening journal has to be of type opening`,
      });
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
