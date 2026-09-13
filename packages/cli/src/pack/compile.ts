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
 * from one pack version to the next is `ekwo pack upgrade`, still to come, which
 * shows the diff first.
 *
 * What an upsert cannot do is remove: a template dropped from a pack stays in
 * the database. That is the rule anyway — nothing is ever deleted from a
 * pack, an account is deprecated and a tax gets a `valid_to`.
 */

import { describeCertification } from './certification.js';
import type { FrameworkPack, Pack, PackStatement } from './read.js';

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
  out.push(...charts(pack, country));
  out.push(...accounts(pack, country));
  out.push(...journals(pack, country));
  out.push(...taxes(pack, country));
  out.push(...postings(pack, country));
  out.push(...taxReport(pack, country));
  out.push(...statements(pack.statements, pack.labels.statement_lines, country));
  out.push(...defaults(pack, country));
  out.push(...documentRules(pack, country));

  return `${out.join('\n')}\n`;
}

/**
 * The country data of one module, for one pack:
 * `supabase/seed/modules/assets/10_pack_be.sql`.
 *
 * It is a seed of its own, under the module's own folder, and deliberately not
 * part of the pack seed. The pack seed is applied by every installation;
 * `assets.category_templates` does not exist on one that does not carry the
 * module, and a seed that half fails is a seed nobody can re-run. So the
 * module migration runner applies these, and only for the modules it installed.
 *
 * The numbering is the pack's own — `10_pack_be`, `11_pack_fr` — so the file
 * of a country is recognisable wherever it sits.
 */
export function moduleSeedFileName(slug: string, allSlugs: readonly string[]): string {
  return seedFileName(slug, allSlugs);
}

/**
 * `packs/<cc>/assets.json` → the two reference tables of the `assets` module.
 *
 * Returns `undefined` when the pack says nothing about fixed assets, which is
 * not a gap to fill: `assets.generate_schedule` refuses by name where it needs
 * a prorata convention nobody has declared, rather than taking another
 * country's.
 */
export function compileAssetsSeed(pack: Pack): string | undefined {
  const assets = pack.assets;
  if (assets === null) return undefined;
  const country = pack.manifest.country;

  const out: string[] = [
    `-- Ekwo OS — ${pack.manifest.name}: how this country depreciates and derecognises a fixed asset.`,
    '--',
    `-- Generated from packs/${pack.slug}/assets.json at version ${pack.manifest.version}, do not edit.`,
    `-- Change the pack and run \`ekwo pack build ${pack.slug}\`; \`ekwo pack check --all\``,
    '-- refuses a seed that is not the exact output of its pack, and the CI runs it.',
    '--',
    '-- Applied by the module migration runner — `ekwo migrate`, or `ekwo module',
    '-- migrate` — and never by the socle seed step: these tables exist only on an',
    '-- installation that carries the `assets` module.',
    '--',
    '-- The accounts a disposal lands on are not here. They are roles of the chart,',
    '-- in `country_defaults`, written by the pack seed beside every other role.',
    '',
    'insert into assets.country_rules',
    '  (country, prorata_straight_line, prorata_declining, day_count,',
    '   declining_cap_percent, declining_switch_to_linear, disposal_style, legal_reference)',
    'values',
    `  (${text(country)}, ${text(assets.prorata_straight_line)}, ${text(assets.prorata_declining)}, ` +
      `${text(assets.day_count)}, ${orNull(assets.declining_cap_percent, number)}, ` +
      `${bool(assets.declining_switch_to_linear)}, ${text(assets.disposal_style)}, ` +
      `${text(assets.legal_reference)})`,
    'on conflict (country) do update set',
    '  prorata_straight_line      = excluded.prorata_straight_line,',
    '  prorata_declining          = excluded.prorata_declining,',
    '  day_count                  = excluded.day_count,',
    '  declining_cap_percent      = excluded.declining_cap_percent,',
    '  declining_switch_to_linear = excluded.declining_switch_to_linear,',
    '  disposal_style             = excluded.disposal_style,',
    '  legal_reference            = excluded.legal_reference;',
    '',
  ];

  if (assets.categories.length === 0) return `${out.join('\n')}\n`;

  const values = [...assets.categories]
    .sort((a, b) => a.sequence - b.sequence || (a.code < b.code ? -1 : 1))
    .map(
      (c) =>
        `    (${text(country)}, ${text(c.code)}, ${text(c.name)}, ${json(c.name_i18n)}, ` +
        `${text(c.method)}, ${number(c.duration_months)}, ${orNull(c.coefficient, number)}, ` +
        `${text(c.prorata)}, ${text(c.account_type)}, ${number(c.sequence)}, ` +
        `${text(c.legal_reference)})`,
    );

  out.push(
    'insert into assets.category_templates',
    '  (country, code, name, name_i18n, method, duration_months, coefficient,',
    '   prorata, account_type, sequence, legal_reference)',
    'select v.country::char(2), v.code, v.name, v.name_i18n::jsonb,',
    '       v.method::assets.depreciation_method, v.duration_months::integer,',
    '       v.coefficient::numeric, v.prorata::assets.prorata_rule,',
    '       v.account_type::account_type, v.sequence::integer, v.legal_reference',
    '  from (values',
    values.join(',\n'),
    '  ) as v (country, code, name, name_i18n, method, duration_months, coefficient,',
    '          prorata, account_type, sequence, legal_reference)',
    'on conflict (country, code) do update set',
    '  name            = excluded.name,',
    '  name_i18n       = excluded.name_i18n,',
    '  method          = excluded.method,',
    '  duration_months = excluded.duration_months,',
    '  coefficient     = excluded.coefficient,',
    '  prorata         = excluded.prorata,',
    '  account_type    = excluded.account_type,',
    '  sequence        = excluded.sequence,',
    '  legal_reference = excluded.legal_reference;',
    '',
  );
  return `${out.join('\n')}\n`;
}

/** Every module seed a pack compiles to, by module code. */
export function compileModuleSeeds(pack: Pack): Map<string, string> {
  const seeds = new Map<string, string>();
  const assets = compileAssetsSeed(pack);
  if (assets !== undefined) seeds.set('assets', assets);
  return seeds;
}

/** `packs/generic` → `05_framework_generic.sql`. It sorts before every pack. */
export function frameworkSeedFileName(slug: string): string {
  return `05_framework_${slug}.sql`;
}

/**
 * The framework pack: statements with no country, and nothing else. They are
 * seeded before the country packs because a chart may name one, and because a
 * company whose country has no pack at all still gets a balance sheet.
 */
export function compileFrameworkPack(pack: FrameworkPack): string {
  const { manifest } = pack;
  const out: string[] = [
    `-- Ekwo OS — ${manifest.name}: financial statements by account type, for any chart of any country.`,
    '--',
    `-- Generated from packs/${pack.slug} at version ${manifest.version}, do not edit.`,
    `-- Change the pack and run \`ekwo pack build ${pack.slug}\`; \`ekwo pack check --all\``,
    '-- refuses a seed that is not the exact output of its pack, and the CI runs it.',
    '--',
  ];
  if (manifest.certification !== undefined) {
    out.push(`-- ${capitalise(describeCertification(manifest.certification))}.`);
    out.push('-- Written from:');
    for (const source of manifest.certification.sources ?? []) out.push(`--   ${source}`);
    out.push('--');
  }
  out.push(
    '-- Reference data with no country and no chart: `financial_statement()` reads it',
    '-- directly, and nothing here is copied into a company.',
    '',
  );
  out.push(...statements(pack.statements, {}, null));
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

/**
 * The charts this country offers. They come before the accounts: a template
 * account points at its chart, so the chart has to exist first.
 */
function charts(pack: Pack, country: string): string[] {
  const values = pack.charts.map(
    (c) =>
      `  (${text(country)}, ${text(c.code)}, ${text(c.name)}, ${json(c.name_i18n)}, ` +
      `${c.is_default ? 'true' : 'false'}, ${text(c.audience)}, ${array([...c.statements].sort())}, ` +
      `${text(c.certification?.status ?? null)}, ${text(c.legal_reference)})`,
  );
  return [
    'insert into chart_templates',
    '  (country, code, name, name_i18n, is_default, audience, statements,',
    '   certification_status, legal_reference)',
    'values',
    values.join(',\n'),
    'on conflict (country, code) do update set',
    '  name                 = excluded.name,',
    '  name_i18n            = excluded.name_i18n,',
    '  is_default           = excluded.is_default,',
    '  audience             = excluded.audience,',
    '  statements           = excluded.statements,',
    '  certification_status = excluded.certification_status,',
    '  legal_reference      = excluded.legal_reference;',
    '',
  ];
}

function accounts(pack: Pack, country: string): string[] {
  const values: string[] = [];
  for (const chart of pack.charts) {
    for (const a of [...chart.accounts].sort(byCode)) {
      values.push(
        `  (${text(country)}, ${text(chart.code)}, ${text(a.code)}, ${text(a.name)}, ` +
          `${json(pack.labels.accounts[a.code])}, ${text(a.type)}, ` +
          `${a.reconcilable ? 'true' : 'false'}, ${text(a.parent)}, ${a.sequence})`,
      );
    }
  }
  return [
    'insert into account_templates',
    '  (country, chart_code, code, name, name_i18n, account_type, reconcilable,',
    '   parent_code, sequence)',
    'values',
    values.join(',\n'),
    'on conflict (country, chart_code, code) do update set',
    '  name         = excluded.name,',
    '  name_i18n    = excluded.name_i18n,',
    '  account_type = excluded.account_type,',
    '  reconcilable = excluded.reconcilable,',
    '  parent_code  = excluded.parent_code,',
    '  sequence     = excluded.sequence;',
    '',
  ];
}

/**
 * The statements and their lines and rules. The order is the order the scheme
 * declares, because that is the order `financial_statement()` evaluates the
 * totals in.
 */
function statements(
  list: PackStatement[],
  labels: Record<string, Record<string, string>>,
  country: string | null,
): string[] {
  if (list.length === 0) return [];
  const out: string[] = [];

  out.push(
    'insert into statement_templates',
    '  (code, country, chart_code, name, kind, framework, valid_from, valid_to, legal_reference)',
    'values',
    [...list]
      .sort(byCode)
      .map(
        (s) =>
          `  (${text(s.code)}, ${text(country)}, ${text(s.chart_code)}, ${text(s.name)}, ` +
          `${text(s.kind)}, ${text(s.framework)}, ${date(s.valid_from)}, ${date(s.valid_to)}, ` +
          `${text(s.legal_reference)})`,
      )
      .join(',\n'),
    'on conflict (code) do update set',
    '  country         = excluded.country,',
    '  chart_code      = excluded.chart_code,',
    '  name            = excluded.name,',
    '  kind            = excluded.kind,',
    '  framework       = excluded.framework,',
    '  valid_from      = excluded.valid_from,',
    '  valid_to        = excluded.valid_to,',
    '  legal_reference = excluded.legal_reference;',
    '',
  );

  const lines: string[] = [];
  const rules: string[] = [];
  for (const statement of [...list].sort(byCode)) {
    for (const line of [...statement.lines].sort((a, b) => a.sequence - b.sequence || (a.code < b.code ? -1 : 1))) {
      lines.push(
        `  (${text(statement.code)}, ${text(line.code)}, ${text(line.parent)}, ${text(line.name)}, ` +
          `${json(labels[`${statement.code}:${line.code}`])}, ${line.sequence}, ${line.sign}, ` +
          `${line.is_total ? 'true' : 'false'}, ${array(line.plus)}, ${array(line.minus)}, ` +
          `${text(line.xbrl)}, ${text(line.legal_reference)})`,
      );
      for (const rule of [...line.rules].sort((a, b) => a.sequence - b.sequence)) {
        rules.push(
          `  (${text(statement.code)}, ${text(line.code)}, ${rule.sequence}, ${text(rule.kind)}, ` +
            `${text(rule.code_from)}, ${text(rule.code_to)}, ${text(rule.account_type)}, ${text(rule.side)})`,
        );
      }
    }
  }

  out.push(
    'insert into statement_line_templates',
    '  (statement_code, code, parent_code, name, name_i18n, sequence, sign, is_total,',
    '   plus_lines, minus_lines, xbrl_element, legal_reference)',
    'values',
    lines.join(',\n'),
    'on conflict (statement_code, code) do update set',
    '  parent_code     = excluded.parent_code,',
    '  name            = excluded.name,',
    '  name_i18n       = excluded.name_i18n,',
    '  sequence        = excluded.sequence,',
    '  sign            = excluded.sign,',
    '  is_total        = excluded.is_total,',
    '  plus_lines      = excluded.plus_lines,',
    '  minus_lines     = excluded.minus_lines,',
    '  xbrl_element    = excluded.xbrl_element,',
    '  legal_reference = excluded.legal_reference;',
    '',
  );

  if (rules.length > 0) {
    out.push(
      'insert into statement_line_rules',
      '  (statement_code, line_code, sequence, rule_kind, code_from, code_to,',
      '   account_type, balance_side)',
      'select v.statement_code, v.line_code, v.sequence, v.rule_kind, v.code_from,',
      '       v.code_to, v.account_type::account_type, v.balance_side',
      '  from (values',
      rules.map((row) => `  ${row}`).join(',\n'),
      '  ) as v (statement_code, line_code, sequence, rule_kind, code_from, code_to,',
      '          account_type, balance_side)',
      'on conflict (statement_code, line_code, sequence) do update set',
      '  rule_kind    = excluded.rule_kind,',
      '  code_from    = excluded.code_from,',
      '  code_to      = excluded.code_to,',
      '  account_type = excluded.account_type,',
      '  balance_side = excluded.balance_side;',
      '',
    );
  }
  return out;
}

function journals(pack: Pack, country: string): string[] {
  const rows = [...pack.manifest.journals].sort((a, b) => a.code.localeCompare(b.code));
  const values = rows.map(
    (j, index) =>
      `  (${text(country)}, ${text(j.code)}, ${text(j.name)}, ${json(pack.labels.journals[j.code])}, ` +
      `${text(j.type)}, ${j.sequence ?? (index + 1) * 10})`,
  );
  return [
    'insert into journal_templates (country, code, name, name_i18n, journal_type, sequence) values',
    values.join(',\n'),
    'on conflict (country, code) do update set',
    '  name         = excluded.name,',
    '  name_i18n    = excluded.name_i18n,',
    '  journal_type = excluded.journal_type,',
    '  sequence     = excluded.sequence;',
    '',
  ];
}

function taxes(pack: Pack, country: string): string[] {
  const rows = [...pack.taxes].sort(byCode);
  const values = rows.map(
    (t) =>
      `  (${text(country)}, ${text(t.code)}, ${text(t.name)}, ${json(pack.labels.taxes[t.code])}, ` +
      `${text(t.description)}, ` +
      `${text(t.amount_type)}, ${number(t.rate)}, ${text(t.scope)}, ${text(t.treatment)}, ` +
      `${date(t.valid_from)}, ${date(t.valid_to)}, ${text(t.legal_reference)}, ` +
      `${text(t.vat_category)}, ${text(t.exemption_code)}, ${t.sequence}, ` +
      `${text(t.kind)}, ${bool(t.recoverable)}, ${text(t.jurisdiction)}, ` +
      `${bool(t.price_include)}, ${bool(t.cash_basis)}, ${text(t.cash_basis_transition_account)})`,
  );
  return [
    'insert into tax_templates',
    '  (country, code, name, name_i18n, description, amount_type, amount, applies_to, treatment,',
    '   valid_from, valid_to, legal_reference, vat_category, exemption_code, sequence,',
    '   tax_kind, recoverable, jurisdiction, price_include, cash_basis,',
    '   cash_basis_transition_account_code)',
    'values',
    values.join(',\n'),
    'on conflict (country, code) do update set',
    '  name            = excluded.name,',
    '  name_i18n       = excluded.name_i18n,',
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
      `${json(pack.labels.tax_report_boxes[`${b.box}|${b.kind}`])}, ${b.sequence}, ` +
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
    json(pack.labels.pack_name),
    // The pack's own language first: it is the one every label is written in,
    // and an installer that offered the translations before it would put the
    // country's own wording last on its own chart of accounts.
    array([
      ...(pack.manifest.defaults.language === undefined ? [] : [pack.manifest.defaults.language]),
      ...(pack.manifest.languages ?? []),
    ]),
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
    // The same rule for rounding, which has a column default where closing has
    // none: the pack's value, or `default` so the column decides. Writing one
    // here would make the CLI a second place where a country model lives.
    defaulted(pack.manifest.defaults['rounding_method'] as string | null | undefined, text),
    defaulted(pack.manifest.defaults['cash_rounding_unit'] as number | null | undefined, number),
    // Where a realised exchange difference lands. No fallback, for the reason
    // above: an account number is a fact about a chart.
    text(roles['fx_gain'] ?? null),
    text(roles['fx_loss'] ?? null),
    // Where the disposal of a fixed asset lands. Four, because two countries
    // present a disposal differently and neither is a variant of the other:
    // one gain-or-loss line, or the value sold and the proceeds in full. Which
    // of the two a country follows is in `assets.json`, with the rest of that
    // module's country model; these are the accounts, and an account that
    // plays a part is a role, so it is named where every other role is.
    text(roles['asset_disposal_gain'] ?? null),
    text(roles['asset_disposal_loss'] ?? null),
    text(roles['asset_disposal_proceeds'] ?? null),
    text(roles['asset_disposal_value'] ?? null),
    // The wording the computed opening lines of an export carry, in the
    // language the administration of this country reads. No fallback here
    // either, but for the opposite reason to an account code: the schema keeps
    // a neutral one, because a format that fixes no wording has no wrong
    // answer to give, and a missing label is not a reason to refuse a file.
    text((pack.manifest.defaults['opening_entry_label'] as string | undefined) ?? null),
  ];
  return [
    'insert into country_defaults',
    '  (country, name, name_i18n, languages, currency_code, receivable_code, payable_code, suspense_code,',
    '   rounding_code, retained_earnings_code, sales_account_code, purchase_account_code,',
    '   bank_account_code, cash_account_code, sales_journal_code, purchase_journal_code,',
    '   misc_journal_code, language_default, closing_style, current_year_result_profit_code,',
    '   current_year_result_loss_code, retained_earnings_loss_code, opening_journal_code,',
    '   rounding_method, cash_rounding_unit, fx_gain_code, fx_loss_code,',
    '   asset_disposal_gain_code, asset_disposal_loss_code,',
    '   asset_disposal_proceeds_code, asset_disposal_value_code, opening_entry_label)',
    'values',
    `  (${row.join(', ')})`,
    'on conflict (country) do update set',
    '  name                   = excluded.name,',
    '  name_i18n              = excluded.name_i18n,',
    '  languages              = excluded.languages,',
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
    '  cash_rounding_unit     = excluded.cash_rounding_unit,',
    '  fx_gain_code           = excluded.fx_gain_code,',
    '  fx_loss_code           = excluded.fx_loss_code,',
    '  asset_disposal_gain_code        = excluded.asset_disposal_gain_code,',
    '  asset_disposal_loss_code        = excluded.asset_disposal_loss_code,',
    '  asset_disposal_proceeds_code    = excluded.asset_disposal_proceeds_code,',
    '  asset_disposal_value_code       = excluded.asset_disposal_value_code,',
    '  opening_entry_label             = excluded.opening_entry_label;',
  ];
}

/**
 * What a country requires on a document, how the document is exchanged, and
 * the formats its banks speak: twelve columns of `country_defaults` and the
 * sentences of `legal_mention_templates`.
 *
 * An `update` rather than a second `insert`. The row exists — `defaults()`
 * writes it immediately above — and an insert would have to restate the name,
 * the currency and the two account roles that its not-null columns need, which
 * is the same values twice in one generated file. The update touches only the
 * columns this section owns, so it stays independent of the row above, and a
 * pack that declares nothing writes null where null already was.
 *
 * None of these columns has a default, so `null` is written literally rather
 * than the `default` keyword the rounding columns use: there is nothing for
 * the schema to decide.
 */
function documentRules(pack: Pack, country: string): string[] {
  const rules = pack.documents;
  const out = [
    '',
    'update country_defaults set',
    `  numbering_gapless       = ${orNull(rules.numbering_gapless, bool)},`,
    `  number_format           = ${text(rules.number_format)},`,
    `  legal_payment_days      = ${orNull(rules.legal_payment_days, number)},`,
    `  late_payment_reference  = ${text(rules.late_payment_reference)},`,
    `  tax_point_rule          = ${text(rules.tax_point_rule)},`,
    `  einvoice_profile        = ${text(rules.einvoice_profile)},`,
    `  einvoice_mandatory_from = ${date(rules.einvoice_mandatory_from)},`,
    `  party_scheme            = ${text(rules.party_scheme)},`,
    `  vat_scheme              = ${text(rules.vat_scheme)},`,
    `  bank_statement_formats  = ${listOrNull(rules.bank_statement_formats)},`,
    `  payment_formats         = ${listOrNull(rules.payment_formats)},`,
    `  fiscal_year_default     = ${text(rules.fiscal_year_default)}`,
    ` where country = ${text(country)};`,
  ];

  if (rules.mentions.length === 0) return out;

  const mentions = [...rules.mentions].sort(
    (a, b) => a.sequence - b.sequence || (a.code < b.code ? -1 : 1),
  );
  const values = mentions.map(
    (m) =>
      `  (${text(country)}, ${text(m.code)}, ${text(m.applies_when)}, ${text(m.text)}, ` +
      `${json(m.text_i18n)}, ${m.sequence}, ${date(m.valid_from)}, ${date(m.valid_to)}, ` +
      `${text(m.legal_reference)})`,
  );

  out.push(
    '',
    'insert into legal_mention_templates',
    '  (country, code, applies_when, text, text_i18n, sequence, valid_from, valid_to, legal_reference)',
    'values',
    values.join(',\n'),
    'on conflict (country, code) do update set',
    '  applies_when    = excluded.applies_when,',
    '  text            = excluded.text,',
    '  text_i18n       = excluded.text_i18n,',
    '  sequence        = excluded.sequence,',
    '  valid_from      = excluded.valid_from,',
    '  valid_to        = excluded.valid_to,',
    '  legal_reference = excluded.legal_reference;',
  );
  return out;
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

/**
 * The pack's value, or a literal `null`. For a column with no default, which
 * is every column this release adds: nothing for the schema to fall back on,
 * so "the pack said nothing" is written as the absence it is.
 */
function orNull<T>(value: T | null | undefined, render: (value: T) => string): string {
  return value === null || value === undefined ? 'null' : render(value);
}

/**
 * A `text[]` of formats, or null. An empty list and a missing section say the
 * same thing here — this country has told us nothing about its banks — and
 * one of them has to reach the column, so it is null rather than `{}`, which
 * would read as "explicitly no format at all".
 */
function listOrNull(values: readonly string[]): string {
  return values.length === 0 ? 'null' : array(values);
}

/**
 * The value the pack declared, or the SQL keyword that lets the column decide.
 * `default` in a `values` row is also what `excluded` carries into the upsert,
 * so a pack that stops declaring something goes back to the schema's answer
 * rather than keeping the last one it was given.
 */
function defaulted<T>(value: T | null | undefined, render: (value: T) => string): string {
  return value === null || value === undefined ? 'default' : render(value);
}

/** A jsonb literal, with its keys in a fixed order so the output is stable. */
function json(value: Record<string, string> | undefined): string {
  const entries = Object.entries(value ?? {}).sort(([a], [b]) => (a < b ? -1 : 1));
  const object: Record<string, string> = {};
  for (const [key, item] of entries) object[key] = item;
  return `${text(JSON.stringify(object))}::jsonb`;
}
