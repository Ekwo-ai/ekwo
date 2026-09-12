/**
 * The compiler: a pack in, one seed file out.
 *
 * The SQL is a build artefact, like `docs/schema.md`. The source is the pack,
 * the output is committed so that `supabase db push` and `psql -f` install a
 * country without this CLI ever running, and `ekwo pack check` refuses an
 * output that is no longer what its pack says. The order of every row is
 * fixed here, so the same pack always compiles to the same bytes.
 *
 * Every insert **upserts on the template tables and on nothing else**. The
 * seeds used to say `on conflict do nothing`, which meant an instance
 * installed last month never received a single pack change — not even for a
 * company created afterwards, since a company copies the templates at
 * install. A template is reference data and a seed is allowed to re-state it;
 * a row that belongs to a company is never touched here, and moving a company
 * from one pack version to the next is `ekwo pack upgrade` (P0-9), which
 * shows the diff first.
 *
 * What an upsert cannot do is remove: a template dropped from a pack stays in
 * the database. That is the rule anyway — nothing is ever deleted from a
 * pack, an account is deprecated and a tax gets a `valid_to`.
 */

import { describeCertification } from './certification.js';
import type { Pack } from './read.js';

/** `packs/be` → `10_pack_be.sql`, `packs/fr` → `11_pack_fr.sql`. */
export function seedFileName(slug: string, allSlugs: readonly string[]): string {
  const index = [...allSlugs].sort().indexOf(slug);
  if (index === -1) throw new Error(`unknown_pack: ${slug}`);
  return `${10 + index}_pack_${slug}.sql`;
}

export function compilePack(pack: Pack): string {
  const { manifest } = pack;
  const country = manifest.country;
  const out: string[] = [];

  out.push(...header(pack));
  out.push(...manifestRow(pack, country));
  out.push(...accounts(pack, country));
  out.push(...journals(pack, country));
  out.push(...taxes(pack, country));
  out.push(...postings(pack, country));
  out.push(...taxReport(pack, country));
  out.push(...defaults(pack, country));

  return `${out.join('\n')}\n`;
}

function header(pack: Pack): string[] {
  const { manifest } = pack;
  const lines = [
    `-- Ekwo OS — ${manifest.name}: chart of accounts, journals, taxes and defaults.`,
    '--',
    `-- Generated from packs/${pack.slug} at version ${manifest.version}, do not edit.`,
    `-- Change the pack and run \`ekwo pack build ${pack.slug}\`; \`ekwo pack check --all\``,
    '-- refuses a seed that is not the exact output of its pack, and the CI runs it.',
    '--',
  ];
  const certification = manifest.certification;
  if (certification !== undefined) {
    lines.push(`-- ${capitalise(describeCertification(certification))}.`);
    lines.push('-- Written from:');
    for (const source of certification.sources ?? []) lines.push(`--   ${source}`);
    lines.push('--');
  }
  if (pack.deferred.length > 0) {
    lines.push('-- In the pack, not compiled by this release:');
    for (const section of pack.deferred) lines.push(`--   ${section}`);
    lines.push('--');
  }
  lines.push(
    '-- Reference data: `install_country_template()` copies it into a company,',
    '-- nothing here belongs to a company.',
    '',
  );
  return lines;
}

function accounts(pack: Pack, country: string): string[] {
  const rows = [...pack.accounts].sort(byCode);
  const values = rows.map(
    (a) =>
      `  (${text(country)}, ${text(a.code)}, ${text(a.name)}, ${json(pack.accountLabels[a.code])}, ` +
      `${text(a.type)}, ${a.reconcilable ? 'true' : 'false'}, ${text(a.parent)}, ${a.sequence})`,
  );
  return [
    'insert into account_templates',
    '  (country, code, name, name_i18n, account_type, reconcilable, parent_code, sequence)',
    'values',
    values.join(',\n'),
    'on conflict (country, code) do update set',
    '  name         = excluded.name,',
    '  name_i18n    = excluded.name_i18n,',
    '  account_type = excluded.account_type,',
    '  reconcilable = excluded.reconcilable,',
    '  parent_code  = excluded.parent_code,',
    '  sequence     = excluded.sequence;',
    '',
  ];
}

function journals(pack: Pack, country: string): string[] {
  const rows = [...pack.manifest.journals].sort((a, b) => a.code.localeCompare(b.code));
  const values = rows.map(
    (j, index) =>
      `  (${text(country)}, ${text(j.code)}, ${text(j.name)}, ${text(j.type)}, ${j.sequence ?? (index + 1) * 10})`,
  );
  return [
    'insert into journal_templates (country, code, name, journal_type, sequence) values',
    values.join(',\n'),
    'on conflict (country, code) do update set',
    '  name         = excluded.name,',
    '  journal_type = excluded.journal_type,',
    '  sequence     = excluded.sequence;',
    '',
  ];
}

function taxes(pack: Pack, country: string): string[] {
  const rows = [...pack.taxes].sort(byCode);
  const values = rows.map(
    (t) =>
      `  (${text(country)}, ${text(t.code)}, ${text(t.name)}, ${text(t.description)}, ` +
      `${text(t.amount_type)}, ${number(t.rate)}, ${text(t.scope)}, ${text(t.treatment)}, ` +
      `${date(t.valid_from)}, ${date(t.valid_to)}, ${text(t.legal_reference)}, ` +
      `${text(t.vat_category)}, ${text(t.exemption_code)}, ${t.sequence}, ` +
      `${text(t.kind)}, ${bool(t.recoverable)}, ${text(t.jurisdiction)}, ` +
      `${bool(t.price_include)}, ${bool(t.cash_basis)}, ${text(t.cash_basis_transition_account)})`,
  );
  return [
    'insert into tax_templates',
    '  (country, code, name, description, amount_type, amount, applies_to, treatment,',
    '   valid_from, valid_to, legal_reference, vat_category, exemption_code, sequence,',
    '   tax_kind, recoverable, jurisdiction, price_include, cash_basis,',
    '   cash_basis_transition_account_code)',
    'values',
    values.join(',\n'),
    'on conflict (country, code) do update set',
    '  name            = excluded.name,',
    '  description     = excluded.description,',
    '  amount_type     = excluded.amount_type,',
    '  amount          = excluded.amount,',
    '  applies_to      = excluded.applies_to,',
    '  treatment       = excluded.treatment,',
    '  valid_from      = excluded.valid_from,',
    '  valid_to        = excluded.valid_to,',
    '  legal_reference = excluded.legal_reference,',
    '  vat_category    = excluded.vat_category,',
    '  exemption_code  = excluded.exemption_code,',
    '  sequence        = excluded.sequence,',
    '  tax_kind        = excluded.tax_kind,',
    '  recoverable     = excluded.recoverable,',
    '  jurisdiction    = excluded.jurisdiction,',
    '  price_include   = excluded.price_include,',
    '  cash_basis      = excluded.cash_basis,',
    '  cash_basis_transition_account_code = excluded.cash_basis_transition_account_code;',
    '',
  ];
}

function postings(pack: Pack, country: string): string[] {
  const values: string[] = [];
  for (const tax of [...pack.taxes].sort(byCode)) {
    for (const kind of ['invoice', 'credit_note'] as const) {
      const rows = [...tax.postings[kind]].sort((a, b) => a.sequence - b.sequence || a.type.localeCompare(b.type));
      for (const posting of rows) {
        values.push(
          `    (${text(tax.code)}, ${text(kind)}, ${text(posting.type)}, ` +
            `${number(posting.factor)}, ${text(posting.account)}, ${text(posting.box)}, ` +
            `${number(posting.box_factor)}, ${text(posting.report)}, ${posting.sequence})`,
        );
      }
    }
  }
  if (values.length === 0) return [];
  return [
    'insert into tax_posting_templates',
    '  (tax_template_id, document_kind, posting_type, factor_percent, account_code,',
    '   declaration_box, box_factor_percent, report_code, sequence)',
    'select t.id,',
    '       v.document_kind::tax_document_kind,',
    '       v.posting_type::tax_posting_type,',
    '       v.factor_percent::numeric,',
    '       v.account_code::text,',
    '       v.declaration_box::text,',
    '       v.box_factor_percent::numeric,',
    '       v.report_code::text,',
    '       v.sequence::integer',
    '  from (values',
    values.join(',\n'),
    '  ) as v (tax_code, document_kind, posting_type, factor_percent, account_code,',
    '          declaration_box, box_factor_percent, report_code, sequence)',
    `  join tax_templates t on t.country = ${text(country)} and t.code = v.tax_code`,
    'on conflict (tax_template_id, document_kind, posting_type, sequence) do update set',
    '  factor_percent     = excluded.factor_percent,',
    '  account_code       = excluded.account_code,',
    '  declaration_box    = excluded.declaration_box,',
    '  box_factor_percent = excluded.box_factor_percent,',
    '  report_code        = excluded.report_code;',
    '',
  ];
}

/**
 * The declaration form and its boxes. Not copied into a company: a chart of
 * accounts is customisable and a form is not. The order is the order the form
 * declares, because that is the order `vat_return()` evaluates the totals in.
 */
function taxReport(pack: Pack, country: string): string[] {
  const report = pack.report;
  if (report === null) return [];

  const out = [
    'insert into tax_report_templates',
    '  (country, code, name, period, valid_from, valid_to, legal_reference, is_periodic_return)',
    'values',
    `  (${text(country)}, ${text(report.code)}, ${text(report.name)}, ${text(report.period)}, ` +
      `${date(report.valid_from)}, ${date(report.valid_to)}, ${text(report.legal_reference)}, true)`,
    'on conflict (country, code) do update set',
    '  name               = excluded.name,',
    '  period             = excluded.period,',
    '  valid_from         = excluded.valid_from,',
    '  valid_to           = excluded.valid_to,',
    '  legal_reference    = excluded.legal_reference,',
    '  is_periodic_return = excluded.is_periodic_return;',
    '',
  ];

  const boxes = [...report.boxes].sort((a, b) => a.sequence - b.sequence || (a.box < b.box ? -1 : 1));
  const values = boxes.map(
    (b) =>
      `  (${text(country)}, ${text(report.code)}, ${text(b.box)}, ${text(b.kind)}, ${text(b.name)}, ` +
      `${json(pack.boxLabels[`${b.box}|${b.kind}`])}, ${b.sequence}, ` +
      `${array(b.plus)}, ${array(b.minus)}, ${b.floor_zero ? 'true' : 'false'}, ` +
      `${b.hidden ? 'true' : 'false'}, ${text(b.xml_element)}, ${text(b.legal_reference)})`,
  );

  out.push(
    'insert into tax_report_box_templates',
    '  (country, report_code, box, kind, name, name_i18n, sequence,',
    '   plus_boxes, minus_boxes, floor_zero, hidden, xml_element, legal_reference)',
    'values',
    values.join(',\n'),
    'on conflict (country, report_code, box, kind) do update set',
    '  name            = excluded.name,',
    '  name_i18n       = excluded.name_i18n,',
    '  sequence        = excluded.sequence,',
    '  plus_boxes      = excluded.plus_boxes,',
    '  minus_boxes     = excluded.minus_boxes,',
    '  floor_zero      = excluded.floor_zero,',
    '  hidden          = excluded.hidden,',
    '  xml_element     = excluded.xml_element,',
    '  legal_reference = excluded.legal_reference;',
    '',
  );
  return out;
}

function defaults(pack: Pack, country: string): string[] {
  const { roles, journal_roles: journalRoles = {} } = pack.manifest.defaults;
  const row = [
    text(country),
    text(pack.manifest.name),
    text(pack.manifest.defaults.currency),
    text(roles['receivable'] ?? null),
    text(roles['payable'] ?? null),
    text(roles['suspense'] ?? null),
    text(roles['rounding'] ?? null),
    text(roles['retained_earnings'] ?? null),
    text(roles['sales'] ?? null),
    text(roles['purchase'] ?? null),
    text(roles['bank'] ?? null),
    text(roles['cash'] ?? null),
    text(journalRoles['sales'] ?? 'SAL'),
    text(journalRoles['purchase'] ?? 'PUR'),
    text(journalRoles['miscellaneous'] ?? 'MISC'),
    text(pack.manifest.defaults.language ?? null),
    // No fallback: a pack that says nothing about closing writes null, and
    // close_fiscal_year refuses by name. A default here would be one
    // country's mechanism given to every country that has not spoken.
    text((pack.manifest.defaults['closing_style'] as string | undefined) ?? null),
    text(roles['current_year_result_profit'] ?? null),
    text(roles['current_year_result_loss'] ?? null),
    text(roles['retained_earnings_loss'] ?? null),
    text(journalRoles['opening'] ?? null),
    text((pack.manifest.defaults['rounding_method'] as string | undefined) ?? 'half_up'),
    number((pack.manifest.defaults['cash_rounding_unit'] as number | null | undefined) ?? 0),
  ];
  return [
    'insert into country_defaults',
    '  (country, name, currency_code, receivable_code, payable_code, suspense_code,',
    '   rounding_code, retained_earnings_code, sales_account_code, purchase_account_code,',
    '   bank_account_code, cash_account_code, sales_journal_code, purchase_journal_code,',
    '   misc_journal_code, language_default, closing_style, current_year_result_profit_code,',
    '   current_year_result_loss_code, retained_earnings_loss_code, opening_journal_code,',
    '   rounding_method, cash_rounding_unit)',
    'values',
    `  (${row.join(', ')})`,
    'on conflict (country) do update set',
    '  name                   = excluded.name,',
    '  currency_code          = excluded.currency_code,',
    '  receivable_code        = excluded.receivable_code,',
    '  payable_code           = excluded.payable_code,',
    '  suspense_code          = excluded.suspense_code,',
    '  rounding_code          = excluded.rounding_code,',
    '  retained_earnings_code = excluded.retained_earnings_code,',
    '  sales_account_code     = excluded.sales_account_code,',
    '  purchase_account_code  = excluded.purchase_account_code,',
    '  bank_account_code      = excluded.bank_account_code,',
    '  cash_account_code      = excluded.cash_account_code,',
    '  sales_journal_code     = excluded.sales_journal_code,',
    '  purchase_journal_code  = excluded.purchase_journal_code,',
    '  misc_journal_code      = excluded.misc_journal_code,',
    '  language_default       = excluded.language_default,',
    '  closing_style          = excluded.closing_style,',
    '  current_year_result_profit_code = excluded.current_year_result_profit_code,',
    '  current_year_result_loss_code   = excluded.current_year_result_loss_code,',
    '  retained_earnings_loss_code     = excluded.retained_earnings_loss_code,',
    '  opening_journal_code            = excluded.opening_journal_code,',
    '  rounding_method        = excluded.rounding_method,',
    '  cash_rounding_unit     = excluded.cash_rounding_unit;',
  ];
}

/**
 * `country_packs`: which pack this installation holds, and how much anyone
 * has read it. `ekwo init` prints the certification status, `ekwo status`
 * compares this version to what each company copied.
 */
function manifestRow(pack: Pack, country: string): string[] {
  const { manifest } = pack;
  const certification = manifest.certification;
  const row = [
    text(country),
    text(manifest.name),
    text(manifest.version),
    date(manifest.released_at ?? null),
    text(manifest.schema_min),
    text(certification?.status ?? 'community'),
    text(certification?.by ?? null),
    date(certification?.on ?? null),
    text(pack.checksum),
  ];
  return [
    'insert into country_packs',
    '  (country, name, version, released_at, schema_min, certification_status,',
    '   certified_by, certified_at, checksum)',
    'values',
    `  (${row.join(', ')})`,
    'on conflict (country) do update set',
    '  name                 = excluded.name,',
    '  version              = excluded.version,',
    '  released_at          = excluded.released_at,',
    '  schema_min           = excluded.schema_min,',
    '  certification_status = excluded.certification_status,',
    '  certified_by         = excluded.certified_by,',
    '  certified_at         = excluded.certified_at,',
    '  checksum             = excluded.checksum;',
    '',
  ];
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function byCode(a: { code: string }, b: { code: string }): number {
  return a.code < b.code ? -1 : a.code > b.code ? 1 : 0;
}

function text(value: string | null | undefined): string {
  if (value === null || value === undefined) return 'null';
  return `'${value.replace(/'/g, "''")}'`;
}

function date(value: string | null | undefined): string {
  return value === null || value === undefined ? 'null' : `date '${value}'`;
}

function number(value: number): string {
  return String(value);
}

/** A `text[]` literal, empty included, in the order the pack wrote it. */
function array(values: readonly string[]): string {
  if (values.length === 0) return `'{}'::text[]`;
  return `array[${values.map((value) => text(value)).join(', ')}]::text[]`;
}

function bool(value: boolean): string {
  return value ? 'true' : 'false';
}

/** A jsonb literal, with its keys in a fixed order so the output is stable. */
function json(value: Record<string, string> | undefined): string {
  const entries = Object.entries(value ?? {}).sort(([a], [b]) => (a < b ? -1 : 1));
  const object: Record<string, string> = {};
  for (const [key, item] of entries) object[key] = item;
  return `${text(JSON.stringify(object))}::jsonb`;
}
