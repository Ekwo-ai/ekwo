/**
 * The Luxembourg **eCDF** interface file, version 2.0.
 *
 * eCDF is not a form: it is the envelope the CTIE publishes, one XML file that
 * carries any number of declarations, each named by a `type` and filled with
 * numbered fields. This package writes that envelope, and knows the four types
 * that carry a recapitulative statement — supplies of goods and supplies of
 * services, each monthly or quarterly.
 *
 * Give it the rows of a statement and it writes the file, its name, and the
 * list of what could not be put in it.
 *
 * Sources are in the README. This package depends on nothing, reads no
 * database and knows no accounting.
 */

/**
 * One line of a recapitulative statement, as `ec_sales_list(company, from,
 * to)` of [Ekwo OS](https://github.com/Ekwo-ai/ekwo-os) returns it. Declared
 * here so that nothing is imported from it.
 */
export interface StatementRow {
  /** Country of the customer's VAT identification number, ISO 3166-1 alpha-2. */
  vat_country: string | null;
  /** The number itself, without its country prefix — which is how eCDF wants it. */
  vat_number: string | null;
  /** `goods`, `services`, `triangular`. */
  nature: string;
  /** Taxable amount, credit notes already deducted. */
  amount: string | number;
  /** ISO 4217 code the amount is in. */
  currency_code: string;
  /** Why this line cannot be declared as it stands, or null when it can. */
  issue?: string | null;
  /** Names of the customers behind the line, for a message a human reads. */
  contact_names?: string[] | null;
}

/** A party of the envelope: the agent who files, or the taxpayer filed for. */
export interface Party {
  /** National identifier, 11 to 13 digits. */
  matrNbr: string;
  /** Trade register number, or `NE` where there is none. */
  rcsNbr: string;
  /** VAT number, eight digits without `LU`, or `NE`. */
  vatNbr: string;
}

/** How often the statement is filed. eCDF has a form for each. */
export type Cadence = 'month' | 'quarter';

export interface EcdfOptions {
  /** The eCDF prefix of the agent, six characters, from the file transfer menu. */
  prefix: string;
  /** The interface identifier the CTIE attributes. Without one, eCDF refuses the file. */
  interfaceId: string;
  /** Who files. */
  agent: Party;
  /** Who is filed for. The agent again, where they are the same. */
  declarer: Party;
  cadence: Cadence;
  year: number;
  /** 1 to 12 for a month, 1 to 4 for a quarter. */
  period: number;
  /** `FR`, `DE` or `EN`. The labels of the form, not of this file. */
  language?: 'FR' | 'DE' | 'EN';
  /** Moment the reference is built from. Now, when left out. */
  createdAt?: Date;
  /** Two digits distinguishing two files of the same second. Default `01`. */
  sequence?: number;
}

/** Something that does not add up, said in the terms of this format. */
export interface Violation {
  code: string;
  message: string;
  vatNumber?: string;
}

export interface EcdfFile {
  /** The XML, as text. */
  file: string;
  /** `<FileReference>.xml`, which eCDF requires the file to be called. */
  filename: string;
  /** The reference itself, which also identifies the filing. */
  fileReference: string;
  /** The declaration types written, in order. */
  declarations: string[];
  /** Everything that could not be put in the file, and why. */
  violations: Violation[];
}

/**
 * The four forms that carry a recapitulative statement, by what they carry and
 * how often it is filed. `LIC` is *livraisons intracommunautaires* and holds
 * goods and triangular operations in two tables of its own; `PSI` is
 * *prestations de services intracommunautaires*.
 */
export const FORMS: Readonly<Record<string, Readonly<Record<Cadence, string>>>> = Object.freeze({
  goods: Object.freeze({ month: 'TVA_LICM', quarter: 'TVA_LICT' }),
  services: Object.freeze({ month: 'TVA_PSIM', quarter: 'TVA_PSIT' }),
});

/** The eCDF forms are in euro; they carry no currency field. */
export const CURRENCY = 'EUR';

const NAMESPACE = 'http://www.ctie.etat.lu/2011/ecdf';

/** The schema's own patterns, so a refusal here is the one eCDF would give. */
const PREFIX = /^[0-9A-Z]{6}$/;
const MATR = /^[0-9]{11,13}$/;
const VAT = /^(?:[0-9]{8}|NE)$/;
const RCS = /^(?:[A-Z][^\s]{0,6}|NE)$/;

export class EcdfError extends Error {
  override name = 'EcdfError';
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function normalise(value: string): string {
  return value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

/**
 * An amount as eCDF writes one: a comma, at most two decimals, and no
 * thousands separator. A point is refused, including as a grouping mark.
 */
export function formatAmount(value: string | number): string {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) throw new EcdfError(`invalid amount: ${String(value)}`);
  return n.toFixed(2).replace('.', ',');
}

/**
 * `<prefix>X<yyyymmdd>T<hhmmss><nn>`, which is both the identifier of the
 * filing and the name the file has to have on disk.
 */
export function fileReference(prefix: string, at: Date, sequence: number): string {
  const two = (n: number): string => String(n).padStart(2, '0');
  const stamp =
    `${at.getUTCFullYear()}${two(at.getUTCMonth() + 1)}${two(at.getUTCDate())}` +
    `T${two(at.getUTCHours())}${two(at.getUTCMinutes())}${two(at.getUTCSeconds())}`;
  return `${prefix}X${stamp}${two(sequence)}`;
}

interface Client {
  country: string;
  number: string;
  amount: string;
}

interface Sorted {
  goods: Client[];
  triangular: Client[];
  services: Client[];
  violations: Violation[];
}

function sortRows(rows: StatementRow[], declarerVat: string): Sorted {
  const out: Sorted = { goods: [], triangular: [], services: [], violations: [] };

  for (const row of rows) {
    const country = row.vat_country === null ? '' : normalise(row.vat_country);
    const number = row.vat_number === null ? '' : normalise(row.vat_number);
    const named = row.contact_names?.join(', ');
    const about = named === undefined || named === '' ? `${country}${number}` : named;

    if (row.issue !== null && row.issue !== undefined && row.issue !== '') {
      out.violations.push({
        code: row.issue,
        message: `${about}: this supply cannot be declared — ${row.issue.replace(/_/g, ' ')}.`,
        ...(number === '' ? {} : { vatNumber: `${country}${number}` }),
      });
      continue;
    }

    const bucket =
      row.nature === 'goods' ? out.goods : row.nature === 'triangular' ? out.triangular : row.nature === 'services' ? out.services : null;
    if (bucket === null) {
      out.violations.push({
        code: 'unknown_nature',
        message: `${about}: the forms carry supplies of goods, triangular operations and services, and nothing called "${row.nature}".`,
      });
      continue;
    }

    if (row.currency_code.toUpperCase() !== CURRENCY) {
      out.violations.push({
        code: 'wrong_currency',
        message: `${about}: the eCDF forms are filed in ${CURRENCY} and this line is in ${row.currency_code}.`,
      });
      continue;
    }

    if (country === '' || number === '') {
      out.violations.push({
        code: 'no_vat_number',
        message: `${about}: a line of the statement is identified by the customer's VAT number and this one has none.`,
      });
      continue;
    }

    // The declarer's own number carries no country, so the comparison is on
    // the number: a customer identified under the same registration as the
    // declarer is not a customer in another Member State.
    if (number === declarerVat) {
      out.violations.push({
        code: 'vat_number_is_the_declarer',
        message: `${about}: the statement carries supplies to other Member States, and this is the declarer's own number.`,
        vatNumber: `${country}${number}`,
      });
      continue;
    }

    const amount = formatAmount(row.amount);
    if (Number(amount.replace(',', '.')) === 0) {
      out.violations.push({
        code: 'nil_amount',
        message: `${about}: a line whose amount is nil is not carried.`,
        vatNumber: `${country}${number}`,
      });
      continue;
    }

    bucket.push({ country, number, amount });
  }

  const order = (a: Client, b: Client): number =>
    `${a.country}${a.number}`.localeCompare(`${b.country}${b.number}`);
  out.goods.sort(order);
  out.triangular.sort(order);
  out.services.sort(order);
  return out;
}

function total(clients: Client[]): string {
  return formatAmount(clients.reduce((sum, client) => sum + Number(client.amount.replace(',', '.')), 0));
}

/**
 * One `Table` of a form: a line per client, with the field identifiers that
 * table uses. A table with no line is left out — the total beside it stays, at
 * zero — which is what the published example does.
 */
function table(clients: Client[], ids: [string, string, string], indent: string): string[] {
  if (clients.length === 0) return [];
  const [country, number, amount] = ids;
  const lines = [`${indent}<Table>`];
  for (const [index, client] of clients.entries()) {
    lines.push(`${indent}  <Line num="${index + 1}">`);
    lines.push(`${indent}    <TextField id="${country}">${escapeXml(client.country)}</TextField>`);
    lines.push(`${indent}    <TextField id="${number}">${escapeXml(client.number)}</TextField>`);
    lines.push(`${indent}    <NumericField id="${amount}">${client.amount}</NumericField>`);
    lines.push(`${indent}  </Line>`);
  }
  lines.push(`${indent}</Table>`);
  return lines;
}

/**
 * The three identifiers of a party. `Agent` closes on itself; `Declarer` does
 * not, because the declarations it files are its own children.
 */
function partyOpening(tag: string, value: Party, indent: string): string[] {
  return [
    `${indent}<${tag}>`,
    `${indent}  <MatrNbr>${escapeXml(value.matrNbr)}</MatrNbr>`,
    `${indent}  <RCSNbr>${escapeXml(value.rcsNbr)}</RCSNbr>`,
    `${indent}  <VATNbr>${escapeXml(value.vatNbr)}</VATNbr>`,
  ];
}

function checkParty(name: string, value: Party): void {
  if (!MATR.test(value.matrNbr)) {
    throw new EcdfError(`${name}: MatrNbr is eleven to thirteen digits, got "${value.matrNbr}"`);
  }
  if (!VAT.test(value.vatNbr)) {
    throw new EcdfError(`${name}: VATNbr is eight digits without LU, or NE, got "${value.vatNbr}"`);
  }
  if (!RCS.test(value.rcsNbr)) {
    throw new EcdfError(`${name}: RCSNbr is at most seven characters, or NE, got "${value.rcsNbr}"`);
  }
}

/**
 * Writes the file.
 *
 * Two declarations come out of one call where the period carries both natures:
 * Luxembourg files goods and services on separate forms, and the envelope is
 * made to hold several. A nature with nothing in it produces no declaration,
 * because eCDF refuses a statement whose every table is empty.
 *
 * Refuses, by exception, what would make the whole file meaningless: a period
 * that does not fit the cadence, or a party the schema's own patterns reject.
 * Everything wrong with one line comes back in `violations`.
 */
export function generateEcdf(rows: StatementRow[], options: EcdfOptions): EcdfFile {
  const prefix = options.prefix.toUpperCase();
  if (!PREFIX.test(prefix)) {
    throw new EcdfError(`the eCDF prefix is six characters, digits and capitals: "${options.prefix}"`);
  }
  if (options.interfaceId === '' || options.interfaceId.length > 20) {
    throw new EcdfError('the interface identifier is one to twenty characters, attributed by the CTIE');
  }
  checkParty('Agent', options.agent);
  checkParty('Declarer', options.declarer);
  const last = options.cadence === 'month' ? 12 : 4;
  if (!Number.isInteger(options.period) || options.period < 1 || options.period > last) {
    throw new EcdfError(`a ${options.cadence} is 1 to ${last}, got ${options.period}`);
  }
  if (!Number.isInteger(options.year) || options.year < 2000 || options.year > 9999) {
    throw new EcdfError(`year out of range: ${options.year}`);
  }

  const sorted = sortRows(rows, normalise(options.declarer.vatNbr));
  const reference = fileReference(prefix, options.createdAt ?? new Date(), options.sequence ?? 1);
  const language = options.language ?? 'FR';

  const parts: string[] = [];
  parts.push('<?xml version="1.0" encoding="UTF-8"?>');
  parts.push(`<eCDFDeclarations xmlns="${NAMESPACE}">`);
  parts.push(`  <FileReference>${reference}</FileReference>`);
  parts.push('  <eCDFFileVersion>2.0</eCDFFileVersion>');
  parts.push(`  <Interface>${escapeXml(options.interfaceId)}</Interface>`);
  parts.push(...partyOpening('Agent', options.agent, '  '));
  parts.push('  </Agent>');
  parts.push('  <Declarations>');
  parts.push(...partyOpening('Declarer', options.declarer, '    '));

  const written: string[] = [];

  // The goods form: state I is the supplies, state II the triangular
  // operations, and the totals print above both.
  if (sorted.goods.length > 0 || sorted.triangular.length > 0) {
    const type = FORMS['goods']?.[options.cadence] as string;
    written.push(type);
    parts.push(`      <Declaration type="${type}" model="1" language="${language}">`);
    parts.push(`        <Year>${options.year}</Year>`);
    parts.push(`        <Period>${options.period}</Period>`);
    parts.push('        <FormData>');
    parts.push(`          <NumericField id="04">${total(sorted.goods)}</NumericField>`);
    parts.push(`          <NumericField id="08">${total(sorted.triangular)}</NumericField>`);
    parts.push(`          <NumericField id="16">${formatAmount(0)}</NumericField>`);
    parts.push(...table(sorted.goods, ['01', '02', '03'], '          '));
    parts.push(...table(sorted.triangular, ['05', '06', '07'], '          '));
    parts.push('        </FormData>');
    parts.push('      </Declaration>');
  }

  if (sorted.services.length > 0) {
    const type = FORMS['services']?.[options.cadence] as string;
    written.push(type);
    parts.push(`      <Declaration type="${type}" model="1" language="${language}">`);
    parts.push(`        <Year>${options.year}</Year>`);
    parts.push(`        <Period>${options.period}</Period>`);
    parts.push('        <FormData>');
    parts.push(`          <NumericField id="04">${total(sorted.services)}</NumericField>`);
    parts.push(`          <NumericField id="16">${formatAmount(0)}</NumericField>`);
    parts.push(...table(sorted.services, ['01', '02', '03'], '          '));
    parts.push('        </FormData>');
    parts.push('      </Declaration>');
  }

  parts.push('    </Declarer>');
  parts.push('  </Declarations>');
  parts.push('</eCDFDeclarations>');

  if (written.length === 0) {
    sorted.violations.push({
      code: 'nothing_to_declare',
      message:
        'eCDF refuses a statement whose tables are all empty, so this file carries no declaration. Do not file it.',
    });
  }

  return {
    file: `${parts.join('\n')}\n`,
    filename: `${reference}.xml`,
    fileReference: reference,
    declarations: written,
    violations: sorted.violations,
  };
}
