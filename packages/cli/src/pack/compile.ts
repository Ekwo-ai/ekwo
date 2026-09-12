/**
 * The compiler: a pack in, one seed file out.
 *
 * The SQL is a build artefact, like `docs/schema.md`. The source is the pack,
 * the output is committed so that `supabase db push` and `psql -f` install a
 * country without this CLI ever running, and `ekwo pack check` refuses an
 * output that is no longer what its pack says. The order of every row is
 * fixed here, so the same pack always compiles to the same bytes.
 */

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
  out.push(...accounts(pack, country));
  out.push(...journals(pack, country));
  out.push(...taxes(pack, country));
  out.push(...postings(pack, country));
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
    const by = certification.by ?? 'nobody named';
    const on = certification.on ?? 'no date';
    lines.push(`-- Certification: ${certification.status}, by ${by} on ${on}.`);
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
      `  (${text(country)}, ${text(a.code)}, ${text(a.name)}, ${text(a.type)}, ` +
      `${a.reconcilable ? 'true' : 'false'}, ${text(a.parent)}, ${a.sequence})`,
  );
  return [
    'insert into account_templates (country, code, name, account_type, reconcilable, parent_code, sequence) values',
    values.join(',\n'),
    'on conflict (country, code) do nothing;',
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
    'on conflict (country, code) do nothing;',
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
      `${text(t.vat_category)}, ${text(t.exemption_code)}, ${t.sequence})`,
  );
  return [
    'insert into tax_templates',
    '  (country, code, name, description, amount_type, amount, applies_to, treatment,',
    '   valid_from, valid_to, legal_reference, vat_category, exemption_code, sequence)',
    'values',
    values.join(',\n'),
    'on conflict (country, code) do nothing;',
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
            `${number(posting.box_factor)}, ${posting.sequence})`,
        );
      }
    }
  }
  if (values.length === 0) return [];
  return [
    'insert into tax_posting_templates',
    '  (tax_template_id, document_kind, posting_type, factor_percent, account_code,',
    '   declaration_box, box_factor_percent, sequence)',
    'select t.id,',
    '       v.document_kind::tax_document_kind,',
    '       v.posting_type::tax_posting_type,',
    '       v.factor_percent::numeric,',
    '       v.account_code::text,',
    '       v.declaration_box::text,',
    '       v.box_factor_percent::numeric,',
    '       v.sequence::integer',
    '  from (values',
    values.join(',\n'),
    '  ) as v (tax_code, document_kind, posting_type, factor_percent, account_code,',
    '          declaration_box, box_factor_percent, sequence)',
    `  join tax_templates t on t.country = ${text(country)} and t.code = v.tax_code`,
    'on conflict (tax_template_id, document_kind, posting_type, sequence) do nothing;',
    '',
  ];
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
  ];
  return [
    'insert into country_defaults',
    '  (country, name, currency_code, receivable_code, payable_code, suspense_code,',
    '   rounding_code, retained_earnings_code, sales_account_code, purchase_account_code,',
    '   bank_account_code, cash_account_code, sales_journal_code, purchase_journal_code,',
    '   misc_journal_code)',
    'values',
    `  (${row.join(', ')})`,
    'on conflict (country) do nothing;',
  ];
}

function byCode(a: { code: string }, b: { code: string }): number {
  return a.code < b.code ? -1 : a.code > b.code ? 1 : 0;
}

function text(value: string | null | undefined): string {
  if (value === null || value === undefined) return 'null';
  return `'${value.replace(/'/g, "''")}'`;
}

function date(value: string | null): string {
  return value === null ? 'null' : `date '${value}'`;
}

function number(value: number): string {
  return String(value);
}
