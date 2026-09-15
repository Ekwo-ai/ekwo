/**
 * The French DES — *déclaration européenne de services*.
 *
 * One XML document, `fichier_des`, described by the cahier des charges the
 * DGDDI publishes as *DES — description des échanges DTI+ en XML*. Give it the
 * rows of a recapitulative statement and it writes the file, a name for it,
 * and the list of what could not be put in it.
 *
 * **It is the services half and only the services half.** France splits the
 * recapitulative statement in two: services are declared here, supplies of
 * goods on the *état récapitulatif TVA* of DEBWEB2, which is a different file
 * in a different format. A row of goods handed to this package comes back as a
 * violation rather than being written into a declaration that has no place for
 * it.
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
  /** The number itself, without its country prefix. */
  vat_number: string | null;
  /** `goods`, `services`, `triangular`. Only services reach this file. */
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

export interface DesOptions {
  /**
   * The declarant's own VAT number, thirteen characters: `FR`, a two-character
   * key and the nine digits of the SIREN. The cahier des charges fixes the
   * length and refuses anything else.
   */
  vatNumber: string;
  /** The month the tax became chargeable in the customer's Member State. */
  year: number;
  month: number;
  /** Number of the declaration inside the file, at most six digits. Default 1. */
  declarationNumber?: number;
}

/** Something that does not add up, said in the terms of this format. */
export interface Violation {
  code: string;
  message: string;
  vatNumber?: string;
}

export interface Des {
  /** The XML, as text. */
  file: string;
  /** A name for it. See the README: the administration imposes none. */
  filename: string;
  /** Everything that could not be put in the file, and why. */
  violations: Violation[];
}

/** The nature this declaration carries. The others are another file's. */
export const NATURE = 'services';

/** The DES has no currency field: the cahier des charges declares euro. */
export const CURRENCY = 'EUR';

/** `FR`, a two-character key, nine digits of SIREN. Thirteen characters. */
const DECLARANT_NUMBER = /^FR[0-9A-Z]{2}[0-9]{9}$/;

export class DesError extends Error {
  override name = 'DesError';
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function normalise(value: string): string {
  return value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

/**
 * Euros, whole, rounded away from zero at the half.
 *
 * The BOFiP says it in words (BOI-TVA-DECLA-20-20-40 § 170): an amount below
 * 0,50 € is dropped and one of 0,50 € or more counts for one. `Math.round`
 * would send −0,5 to −0, which is the wrong direction for a minoration, so the
 * sign is taken out and put back.
 */
export function roundToEuro(value: string | number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) throw new DesError(`invalid amount: ${String(value)}`);
  return Math.sign(n) * Math.round(Math.abs(n));
}

interface Line {
  partner: string;
  value: number;
}

function linesOf(rows: StatementRow[], options: DesOptions): { lines: Line[]; violations: Violation[] } {
  const lines: Line[] = [];
  const violations: Violation[] = [];
  const home = normalise(options.vatNumber).slice(0, 2);

  for (const row of rows) {
    const country = row.vat_country === null ? '' : normalise(row.vat_country);
    const number = row.vat_number === null ? '' : normalise(row.vat_number);
    const partner = `${country}${number}`;
    const named = row.contact_names?.join(', ');
    const about = named === undefined || named === '' ? partner : named;

    if (row.issue !== null && row.issue !== undefined && row.issue !== '') {
      violations.push({
        code: row.issue,
        message: `${about}: this supply cannot be declared — ${row.issue.replace(/_/g, ' ')}.`,
        ...(partner === '' ? {} : { vatNumber: partner }),
      });
      continue;
    }

    if (row.nature !== NATURE) {
      violations.push({
        code: 'not_a_service',
        message: `${about}: the DES declares services. A supply of ${row.nature} belongs to the état récapitulatif TVA, which is another file.`,
        ...(partner === '' ? {} : { vatNumber: partner }),
      });
      continue;
    }

    if (row.currency_code.toUpperCase() !== CURRENCY) {
      violations.push({
        code: 'wrong_currency',
        message: `${about}: the DES is filed in ${CURRENCY} and this line is in ${row.currency_code}. Convert it before declaring it.`,
      });
      continue;
    }

    if (country === '' || number === '') {
      violations.push({
        code: 'no_vat_number',
        message: `${about}: a line of the DES is identified by the customer's VAT number and this one has none.`,
      });
      continue;
    }

    if (country === home) {
      violations.push({
        code: 'vat_country_is_the_declarant_country',
        message: `${about}: the DES carries services supplied to another Member State, and ${country} is the declarant's own.`,
        vatNumber: partner,
      });
      continue;
    }

    if (partner.length < 4 || partner.length > 14) {
      violations.push({
        code: 'partner_length',
        message: `${about}: the cahier des charges holds between four and fourteen characters for a customer's number, prefix included, and this one has ${partner.length}.`,
        vatNumber: partner,
      });
      continue;
    }

    const value = roundToEuro(row.amount);
    if (value === 0) {
      violations.push({
        code: 'nil_value',
        message: `${about}: the value of a line may not be zero, and this one rounds to nothing.`,
        vatNumber: partner,
      });
      continue;
    }

    lines.push({ partner, value });
  }

  lines.sort((a, b) => a.partner.localeCompare(b.partner) || a.value - b.value);
  return { lines, violations };
}

/**
 * A name for the file.
 *
 * **The administration imposes none.** The manual describes a file picker and
 * nothing else; no convention, no extension beyond `.xml`, no size limit. So
 * this is a name of ours, and a caller is free to pick another.
 */
export function desFileName(vatNumber: string, year: number, month: number): string {
  return `DES-${normalise(vatNumber)}-${year}${String(month).padStart(2, '0')}.xml`;
}

/**
 * Writes the declaration.
 *
 * Refuses, by exception, what would make the whole file meaningless: a month
 * outside 1 to 12, a year before the first the format accepts, or a declarant
 * number that is not the thirteen characters the cahier des charges fixes.
 * Everything wrong with one line comes back in `violations`.
 *
 * The encoding is UTF-8. The cahier des charges contradicts itself — its
 * conventions section prescribes ISO-8859-1 and its own complete example
 * declares UTF-8 — and the file it describes holds nothing but digits and the
 * letters of a VAT number, so the two are the same bytes. The example is the
 * half of the document that was executed.
 */
export function generateDes(rows: StatementRow[], options: DesOptions): Des {
  if (!Number.isInteger(options.month) || options.month < 1 || options.month > 12) {
    throw new DesError(`month out of range: ${options.month}`);
  }
  // The format's own floor. It was introduced for the declarations of 2010 and
  // refuses a year before that rather than silently accepting one.
  if (!Number.isInteger(options.year) || options.year < 2010) {
    throw new DesError(`year out of range: ${options.year}`);
  }
  const declarant = normalise(options.vatNumber);
  if (!DECLARANT_NUMBER.test(declarant)) {
    throw new DesError(
      `the declarant's number is thirteen characters, FR then a key then nine digits: ${options.vatNumber}`,
    );
  }
  const declaration = options.declarationNumber ?? 1;
  if (!Number.isInteger(declaration) || declaration < 1 || declaration > 999999) {
    throw new DesError(`declaration number out of range: ${options.declarationNumber}`);
  }

  const { lines, violations } = linesOf(rows, options);

  const parts: string[] = [];
  parts.push('<?xml version="1.0" encoding="UTF-8"?>');
  parts.push('<fichier_des>');
  parts.push('<declaration_des>');
  parts.push(`<num_des>${String(declaration).padStart(5, '0')}</num_des>`);
  parts.push(`<num_tvaFr>${escapeXml(declarant)}</num_tvaFr>`);
  parts.push(`<mois_des>${String(options.month).padStart(2, '0')}</mois_des>`);
  parts.push(`<an_des>${options.year}</an_des>`);
  for (const [index, line] of lines.entries()) {
    parts.push('<ligne_des>');
    parts.push(`<numlin_des>${String(index + 1).padStart(6, '0')}</numlin_des>`);
    parts.push(`<valeur>${line.value}</valeur>`);
    parts.push(`<partner_des>${escapeXml(line.partner)}</partner_des>`);
    parts.push('</ligne_des>');
  }
  parts.push('</declaration_des>');
  parts.push('</fichier_des>');

  return {
    file: `${parts.join('\n')}\n`,
    filename: desFileName(declarant, options.year, options.month),
    violations,
  };
}
