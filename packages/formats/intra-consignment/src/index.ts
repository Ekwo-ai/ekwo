/**
 * The Belgian intra-Community sales listing, as Intervat takes it.
 *
 * One XML document, `IntraConsignment`, described by the schema the SPF
 * Finances publishes as `NewICO-in_v0_9.xsd`. Give it the rows of a
 * recapitulative statement and it writes the file, a name for it, and the list
 * of what could not be put in it.
 *
 * Sources are in the README, with the exact URL of every schema and of the
 * directives that fix the three operation codes. This package depends on
 * nothing, reads no database and knows no accounting.
 */

import type {
  IntraConsignment,
  IntraConsignmentOptions,
  ListingPeriod,
  StatementRow,
  Violation,
} from './types.js';

export type {
  Declarant,
  IntraConsignment,
  IntraConsignmentOptions,
  ListingPeriod,
  StatementRow,
  Violation,
} from './types.js';

/**
 * The three codes of the listing, from the directives for form 723 (§ 2.3.1.4
 * b): category I is `L`, category II `T`, category III `S`. There is no code
 * for anything else, so a nature this map does not hold is a violation and not
 * a guess.
 */
export const OPERATION_CODES: Readonly<Record<string, string>> = Object.freeze({
  goods: 'L',
  triangular: 'T',
  services: 'S',
});

/** The listing is filed in euro. The form has no currency field to say so. */
export const CURRENCY = 'EUR';

const NS_LISTING = 'http://www.minfin.fgov.be/IntraConsignment';
const NS_COMMON = 'http://www.minfin.fgov.be/InputCommon';

/** The schema's own pattern for the declarant's enterprise number. */
const DECLARANT_NUMBER = /^[0-1][0-9][0-9]{8}$/;

export class IntraConsignmentError extends Error {
  override name = 'IntraConsignmentError';
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Two decimals with a point, which is what `-?[0-9]+\.[0-9]{2}` means.
 *
 * The web page of the administration writes its example with a comma, in
 * French; the schema does not. A comma is refused by the validator.
 */
export function formatAmount(value: string | number): string {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) throw new IntraConsignmentError(`invalid amount: ${String(value)}`);
  return n.toFixed(2);
}

/** Letters and digits, upper case: what an administration compares. */
function normalise(value: string): string {
  return value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

function periodElement(period: ListingPeriod): string {
  const lines: string[] = [];
  if (period.month !== undefined) lines.push(`      <ns2:Month>${period.month}</ns2:Month>`);
  if (period.quarter !== undefined) lines.push(`      <ns2:Quarter>${period.quarter}</ns2:Quarter>`);
  lines.push(`      <ns2:Year>${period.year}</ns2:Year>`);
  return lines.join('\n');
}

/**
 * The declarant block. Its children live in the `InputCommon` namespace and
 * not in the listing's own, because the schema that declares them is a
 * different one — a detail the validator is strict about and no example makes
 * obvious.
 */
function declarantElement(options: IntraConsignmentOptions): string {
  const d = options.declarant;
  const optional: [string, string | undefined][] = [
    ['Name', d.name],
    ['Street', d.street],
    ['PostCode', d.postCode],
    ['City', d.city],
    ['CountryCode', d.countryCode],
    ['EmailAddress', d.emailAddress],
    ['Phone', d.phone],
  ];
  const lines = [`      <VATNumber>${escapeXml(d.vatNumber)}</VATNumber>`];
  for (const [tag, value] of optional) {
    if (value !== undefined && value !== '') lines.push(`      <${tag}>${escapeXml(value)}</${tag}>`);
  }
  return lines.join('\n');
}

interface Client {
  issuedBy: string;
  number: string;
  code: string;
  amount: string;
}

/**
 * Turns the rows into clients of the listing, and says what it could not use.
 *
 * The rules applied here are the schema's and the directives', in the order a
 * reader of the form would apply them:
 *
 * - a line the producer already flagged is not filed, whatever else is true of
 *   it: an amount with no VAT number in front of it has nowhere to go;
 * - the customer's number may not be the declarant's own country, which is
 *   what the schema says with `MSCountryCodeExclBE`;
 * - the number, prefix excluded, is at most twelve characters;
 * - a nil balance is left out, because the directives say a customer whose
 *   balance is 0,00 euro is not carried;
 * - the three categories are never merged, so a customer who was supplied
 *   goods and services gets two lines with the same number, which is exactly
 *   what the rows already are.
 */
function clientsOf(
  rows: StatementRow[],
  options: IntraConsignmentOptions,
): { clients: Client[]; violations: Violation[] } {
  const clients: Client[] = [];
  const violations: Violation[] = [];
  const home = (options.declarant.countryCode ?? '').toUpperCase();

  for (const row of rows) {
    const number = row.vat_number === null ? '' : normalise(row.vat_number);
    const country = row.vat_country === null ? '' : normalise(row.vat_country);
    const named = row.contact_names?.join(', ');
    const about = named === undefined || named === '' ? `${country}${number}` : named;

    if (row.issue !== null && row.issue !== undefined && row.issue !== '') {
      violations.push({
        code: row.issue,
        message: `${about}: this supply cannot be listed — ${row.issue.replace(/_/g, ' ')}.`,
        ...(number === '' ? {} : { vatNumber: `${country}${number}` }),
      });
      continue;
    }

    const code = OPERATION_CODES[row.nature];
    if (code === undefined) {
      violations.push({
        code: 'unknown_nature',
        message: `${about}: the listing has a code for goods, services and triangular operations, and none for "${row.nature}".`,
      });
      continue;
    }

    if (row.currency_code.toUpperCase() !== CURRENCY) {
      violations.push({
        code: 'wrong_currency',
        message: `${about}: the listing is filed in ${CURRENCY} and this line is in ${row.currency_code}.`,
      });
      continue;
    }

    if (country === '' || number === '') {
      violations.push({
        code: 'no_vat_number',
        message: `${about}: a client of the listing is identified by a VAT number and this line has none.`,
      });
      continue;
    }

    if (country === home) {
      violations.push({
        code: 'vat_country_is_the_declarant_country',
        message: `${about}: the listing carries supplies to other Member States, and ${country} is the declarant's own.`,
        vatNumber: `${country}${number}`,
      });
      continue;
    }

    if (number.length > 12) {
      violations.push({
        code: 'vat_number_too_long',
        message: `${about}: the schema holds twelve characters after the country prefix and this number has ${number.length}.`,
        vatNumber: `${country}${number}`,
      });
      continue;
    }

    const amount = formatAmount(row.amount);
    if (Number(amount) === 0) {
      violations.push({
        code: 'nil_balance',
        message: `${about}: a client whose balance is 0,00 euro is not carried on the listing.`,
        vatNumber: `${country}${number}`,
      });
      continue;
    }

    clients.push({ issuedBy: country, number, code, amount });
  }

  // The order the form prints: by customer, then by category, so the same
  // number's two or three lines sit together.
  clients.sort(
    (a, b) =>
      `${a.issuedBy}${a.number}`.localeCompare(`${b.issuedBy}${b.number}`) ||
      a.code.localeCompare(b.code),
  );
  return { clients, violations };
}

/**
 * A name for the file.
 *
 * **The administration imposes none.** Intervat takes a bare `.xml`, and only
 * the archive that carries attachments has a fixed extension (`.ic` for this
 * listing). The `VATINTRA` prefix that circulates comes from accounting
 * software and appears nowhere in the published documentation. So this is a
 * name of ours, stable and readable, and a caller free to choose another.
 */
export function intraConsignmentFileName(
  declarantVatNumber: string,
  period: ListingPeriod,
): string {
  const number = normalise(declarantVatNumber);
  const suffix =
    period.month !== undefined
      ? `M${String(period.month).padStart(2, '0')}`
      : period.quarter !== undefined
        ? `Q${period.quarter}`
        : 'Y';
  return `IntraConsignment-${number}-${period.year}${suffix}.xml`;
}

/**
 * Writes the listing.
 *
 * Refuses, by exception, what would make the whole file meaningless: a period
 * that is neither a month nor a quarter, or a declarant number the schema
 * cannot hold. Everything that is wrong with one line comes back in
 * `violations` and leaves the rest of the file valid, because a statement that
 * refuses to exist over one unidentified customer helps nobody.
 */
export function generateIntraConsignment(
  rows: StatementRow[],
  options: IntraConsignmentOptions,
): IntraConsignment {
  const { period } = options;
  const named = [period.month !== undefined, period.quarter !== undefined].filter(Boolean).length;
  if (named !== 1) {
    throw new IntraConsignmentError(
      'the period of a listing is one month or one quarter: name exactly one of them',
    );
  }
  if (period.month !== undefined && (period.month < 1 || period.month > 12)) {
    throw new IntraConsignmentError(`month out of range: ${period.month}`);
  }
  if (period.quarter !== undefined && (period.quarter < 1 || period.quarter > 4)) {
    throw new IntraConsignmentError(`quarter out of range: ${period.quarter}`);
  }
  if (!Number.isInteger(period.year) || period.year < 2000) {
    throw new IntraConsignmentError(`year out of range: ${period.year}`);
  }

  const declarantNumber = normalise(options.declarant.vatNumber).replace(/^BE/, '');
  if (!DECLARANT_NUMBER.test(declarantNumber)) {
    throw new IntraConsignmentError(
      `the declarant's number is ten digits without its country prefix: ${options.declarant.vatNumber}`,
    );
  }

  const { clients, violations } = clientsOf(rows, options);
  const total = clients.reduce((sum, client) => sum + Number(client.amount), 0);
  const sequence = options.sequenceNumber ?? 1;

  const parts: string[] = [];
  parts.push('<?xml version="1.0" encoding="UTF-8"?>');
  parts.push(
    `<ns2:IntraConsignment xmlns:ns2="${NS_LISTING}" xmlns="${NS_COMMON}" IntraListingsNbr="1">`,
  );
  const reference =
    options.declarantReference === undefined || options.declarantReference === ''
      ? ''
      : ` DeclarantReference="${escapeXml(options.declarantReference)}"`;
  parts.push(
    `  <ns2:IntraListing SequenceNumber="${sequence}" ClientsNbr="${clients.length}"${reference} AmountSum="${formatAmount(total)}">`,
  );
  parts.push('    <ns2:Declarant>');
  parts.push(declarantElement({ ...options, declarant: { ...options.declarant, vatNumber: declarantNumber } }));
  parts.push('    </ns2:Declarant>');
  parts.push('    <ns2:Period>');
  parts.push(periodElement(period));
  parts.push('    </ns2:Period>');
  for (const [index, client] of clients.entries()) {
    parts.push(`    <ns2:IntraClient SequenceNumber="${index + 1}">`);
    parts.push(
      `      <ns2:CompanyVATNumber issuedBy="${client.issuedBy}">${client.number}</ns2:CompanyVATNumber>`,
    );
    parts.push(`      <ns2:Code>${client.code}</ns2:Code>`);
    parts.push(`      <ns2:Amount>${client.amount}</ns2:Amount>`);
    parts.push('    </ns2:IntraClient>');
  }
  if (options.comment !== undefined && options.comment !== '') {
    parts.push(`    <ns2:Comment>${escapeXml(options.comment)}</ns2:Comment>`);
  }
  parts.push('  </ns2:IntraListing>');
  parts.push('</ns2:IntraConsignment>');

  return {
    file: `${parts.join('\n')}\n`,
    filename: intraConsignmentFileName(declarantNumber, period),
    violations,
  };
}
