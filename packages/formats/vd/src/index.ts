/**
 * The Estonian **form VD** — *ühendusesisese käibe aruanne*, the report of
 * intra-Community turnover — as the e-MTA loads it from a file.
 *
 * One XML document, `VD_deklaratsioon`, described by the schema the tax and
 * customs board publishes beside the form. Give it the rows of a
 * recapitulative statement and it writes the file, a name for it, and the list
 * of what could not be put in it.
 *
 * **One line per customer, not one per nature.** Estonia is the odd one out:
 * where the Belgian listing prints the same number three times with three
 * codes, form VD prints it once with three amount columns. So this package
 * merges the rows it is given, which the others must not do.
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
  /** The number itself, without its country prefix — which is how form VD wants it. */
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

export interface VdOptions {
  /**
   * The declarer's registry code, at most eleven characters. The e-MTA checks
   * it against the client the report is opened for.
   */
  registryCode: string;
  year: number;
  /** 1 to 12. Form VD is filed monthly, with the VAT return. */
  month: number;
}

/** Something that does not add up, said in the terms of this format. */
export interface Violation {
  code: string;
  message: string;
  vatNumber?: string;
}

export interface Vd {
  /** The XML, as text. */
  file: string;
  /** A name for it. See the README: the administration imposes none. */
  filename: string;
  /** Everything that could not be put in the file, and why. */
  violations: Violation[];
}

/** The three amount columns of the form, by what the statement calls each. */
export const COLUMNS: Readonly<Record<string, string>> = Object.freeze({
  goods: 'kaup',
  triangular: 'kolmnurktehing',
  services: 'teenusteMyyk',
});

/** Form VD is in euro; it carries no currency field. */
export const CURRENCY = 'EUR';

const NAMESPACE = 'http://www.emta.ee/VD/xsd/webimport/v1';

/** The schema's own pattern for a customer's registration number. */
const CUSTOMER_NUMBER = /^[A-Za-z0-9+*]{1,12}$/;

export class VdError extends Error {
  override name = 'VdError';
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function normalise(value: string): string {
  // `+` and `*` are part of the alphabet the schema allows, so they survive.
  return value.replace(/[^A-Za-z0-9+*]/g, '').toUpperCase();
}

/**
 * Whole euros, rounded away from zero at the half.
 *
 * The form says `täiseurodes` under each of its three amount columns, the XML
 * description types them `Number(20)`, and the published error messages refuse
 * `1.5` by name. `Math.round` would send −0,5 to −0, which is the wrong
 * direction for a credit note, so the sign is taken out and put back.
 */
export function roundToEuro(value: string | number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) throw new VdError(`invalid amount: ${String(value)}`);
  return Math.sign(n) * Math.round(Math.abs(n));
}

interface Line {
  country: string;
  number: string;
  amounts: Map<string, number>;
}

function linesOf(rows: StatementRow[], declarer: string): { lines: Line[]; violations: Violation[] } {
  const byCustomer = new Map<string, Line>();
  const violations: Violation[] = [];

  for (const row of rows) {
    const country = row.vat_country === null ? '' : normalise(row.vat_country);
    const number = row.vat_number === null ? '' : normalise(row.vat_number);
    const named = row.contact_names?.join(', ');
    const about = named === undefined || named === '' ? `${country}${number}` : named;

    if (row.issue !== null && row.issue !== undefined && row.issue !== '') {
      violations.push({
        code: row.issue,
        message: `${about}: this supply cannot be reported — ${row.issue.replace(/_/g, ' ')}.`,
        ...(number === '' ? {} : { vatNumber: `${country}${number}` }),
      });
      continue;
    }

    const column = COLUMNS[row.nature];
    if (column === undefined) {
      violations.push({
        code: 'unknown_nature',
        message: `${about}: form VD has a column for goods, triangular operations and services, and none for "${row.nature}".`,
      });
      continue;
    }

    if (row.currency_code.toUpperCase() !== CURRENCY) {
      violations.push({
        code: 'wrong_currency',
        message: `${about}: form VD is filed in ${CURRENCY} and this line is in ${row.currency_code}.`,
      });
      continue;
    }

    if (country === '' || number === '') {
      violations.push({
        code: 'no_vat_number',
        message: `${about}: a row of form VD is identified by the acquirer's VAT number and this one has none.`,
      });
      continue;
    }

    if (country.length !== 2) {
      violations.push({
        code: 'country_code_length',
        message: `${about}: column 1 of form VD holds a two-character country code and this one is "${country}".`,
      });
      continue;
    }

    if (number === declarer) {
      violations.push({
        code: 'vat_number_is_the_declarer',
        message: `${about}: form VD reports supplies to other Member States, and this is the declarer's own number.`,
        vatNumber: `${country}${number}`,
      });
      continue;
    }

    if (!CUSTOMER_NUMBER.test(number)) {
      violations.push({
        code: 'vat_number_shape',
        message: `${about}: the schema holds twelve characters of letters, digits, + and * for a number, and this one is "${number}".`,
        vatNumber: `${country}${number}`,
      });
      continue;
    }

    const value = roundToEuro(row.amount);
    const key = `${country}|${number}`;
    // The instructions are explicit: a VAT number may not appear twice in the
    // column, so goods and services for the same acquirer are one row with two
    // amounts. That is the aggregation this format asks for and no other does.
    const held = byCustomer.get(key) ?? { country, number, amounts: new Map<string, number>() };
    held.amounts.set(column, (held.amounts.get(column) ?? 0) + value);
    byCustomer.set(key, held);
  }

  const lines: Line[] = [];
  for (const line of byCustomer.values()) {
    for (const [column, value] of [...line.amounts]) {
      if (value === 0) line.amounts.delete(column);
    }
    if (line.amounts.size === 0) {
      violations.push({
        code: 'nil_amounts',
        message: `${line.country}${line.number}: every amount of this acquirer rounds to nothing, and a row of form VD carries at least one.`,
        vatNumber: `${line.country}${line.number}`,
      });
      continue;
    }
    lines.push(line);
  }

  lines.sort((a, b) => `${a.country}${a.number}`.localeCompare(`${b.country}${b.number}`));
  return { lines, violations };
}

/**
 * A name for the file.
 *
 * **The administration imposes none.** The technical description prescribes no
 * naming convention: the e-MTA checks the header of the file against the report
 * it is being loaded into, and nothing else. So this is a name of ours, and a
 * caller is free to pick another.
 */
export function vdFileName(registryCode: string, year: number, month: number): string {
  return `VD-${normalise(registryCode)}-${year}${String(month).padStart(2, '0')}.xml`;
}

/**
 * Writes the report.
 *
 * Refuses, by exception, what would make the whole file meaningless: a month
 * outside the year, or a registry code the schema cannot hold. Everything
 * wrong with one line comes back in `violations`.
 *
 * Note for whoever uses the result: loading a file into the e-MTA **replaces
 * every row already there**, whether it was loaded or typed in, and only works
 * on a report that has not been confirmed.
 */
export function generateVd(rows: StatementRow[], options: VdOptions): Vd {
  if (!Number.isInteger(options.month) || options.month < 1 || options.month > 12) {
    throw new VdError(`month out of range: ${options.month}`);
  }
  if (!Number.isInteger(options.year) || options.year < 1000 || options.year > 9999) {
    throw new VdError(`year out of range: ${options.year}`);
  }
  const declarer = normalise(options.registryCode);
  if (declarer === '' || declarer.length > 11) {
    throw new VdError(
      `the declarer's registry code is one to eleven characters: "${options.registryCode}"`,
    );
  }

  const { lines, violations } = linesOf(rows, declarer);

  const parts: string[] = [];
  parts.push('<?xml version="1.0" encoding="UTF-8"?>');
  parts.push(`<v1:VD_deklaratsioon xmlns:v1="${NAMESPACE}">`);
  parts.push(`  <deklareerijaKood>${escapeXml(declarer)}</deklareerijaKood>`);
  parts.push(`  <perioodAasta>${options.year}</perioodAasta>`);
  parts.push(`  <perioodKuu>${options.month}</perioodKuu>`);
  parts.push('  <aruandeRead>');
  for (const line of lines) {
    parts.push('    <aruandeRida>');
    parts.push(
      `      <kmkrKood riik="${escapeXml(line.country)}">${escapeXml(line.number)}</kmkrKood>`,
    );
    // The schema fixes the order of the three columns, and a line carries only
    // the ones that came to something.
    for (const nature of ['goods', 'triangular', 'services']) {
      const column = COLUMNS[nature] as string;
      const value = line.amounts.get(column);
      if (value !== undefined) parts.push(`      <${column}>${value}</${column}>`);
    }
    parts.push('    </aruandeRida>');
  }
  parts.push('  </aruandeRead>');
  parts.push('</v1:VD_deklaratsioon>');

  return {
    file: `${parts.join('\n')}\n`,
    filename: vdFileName(declarer, options.year, options.month),
    violations,
  };
}
