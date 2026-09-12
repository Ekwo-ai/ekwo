/**
 * The French FEC — *fichier des ecritures comptables*.
 *
 * Eighteen columns fixed by the arrete du 29 juillet 2013 (art. A. 47 A-1 du
 * Livre des procedures fiscales). Feed it the rows of a `fec_lines(company,
 * from, to)` query — {@link FecQueryRow} is that shape — and it writes the
 * file.
 *
 * It depends on nothing, reads no database and knows no accounting: the rows
 * come from wherever the books are kept.
 */

/** ISO-8601 calendar date, `YYYY-MM-DD`. */
export type IsoDate = string;

/**
 * A fixed-point number as Postgres returns `numeric`: a string, because a
 * double would lose cents on the way in.
 */
export type Decimal = string;

/** The eighteen column headers, in the order the specification fixes. */
export const FEC_COLUMNS = [
  'JournalCode',
  'JournalLib',
  'EcritureNum',
  'EcritureDate',
  'CompteNum',
  'CompteLib',
  'CompAuxNum',
  'CompAuxLib',
  'PieceRef',
  'PieceDate',
  'EcritureLib',
  'Debit',
  'Credit',
  'EcritureLet',
  'DateLet',
  'ValidDate',
  'Montantdevise',
  'Idevise',
] as const;

export type FecColumn = (typeof FEC_COLUMNS)[number];

/**
 * One line of the file. Field names match the columns; dates are ISO
 * (`YYYY-MM-DD`) and converted to `YYYYMMDD` on output. Amounts accept a
 * number or the string Postgres returns for `numeric`.
 */
export interface FecLine {
  journalCode: string;
  journalLib: string;
  ecritureNum: string;
  ecritureDate: IsoDate | Date;
  compteNum: string;
  compteLib: string;
  compAuxNum?: string | null;
  compAuxLib?: string | null;
  pieceRef: string;
  pieceDate: IsoDate | Date;
  ecritureLib: string;
  debit: number | Decimal;
  credit: number | Decimal;
  ecritureLet?: string | null;
  dateLet?: IsoDate | Date | null;
  validDate: IsoDate | Date;
  montantDevise?: number | Decimal | null;
  idevise?: string | null;
}

export interface FecOptions {
  /**
   * Decimal separator. The administration accepts both; a comma is what the
   * French tooling expects and is the default.
   */
  decimalSeparator?: ',' | '.';
  /** Field separator. `|` is the usual choice and the default. */
  fieldSeparator?: '|' | '\t';
  /** Line ending. Default `\r\n`. */
  newline?: '\r\n' | '\n';
  /** Emit the header row. Default true; the specification requires it. */
  header?: boolean;
}

const DEFAULTS: Required<FecOptions> = {
  decimalSeparator: ',',
  fieldSeparator: '|',
  newline: '\r\n',
  header: true,
};

/** `2026-08-31` or a Date becomes `20260831`. Empty input becomes ''. */
export function formatFecDate(value: IsoDate | Date | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  if (value instanceof Date) {
    const y = value.getUTCFullYear().toString().padStart(4, '0');
    const m = (value.getUTCMonth() + 1).toString().padStart(2, '0');
    const d = value.getUTCDate().toString().padStart(2, '0');
    return `${y}${m}${d}`;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (match === null) throw new FecError(`invalid date: ${value}`);
  return `${match[1]}${match[2]}${match[3]}`;
}

/** Two decimals, no thousands separator, with the chosen decimal mark. */
export function formatFecAmount(
  value: number | Decimal | null | undefined,
  separator: ',' | '.' = ',',
): string {
  if (value === null || value === undefined || value === '') return '';
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) throw new FecError(`invalid amount: ${String(value)}`);
  return n.toFixed(2).replace('.', separator);
}

export class FecError extends Error {
  override name = 'FecError';
}

export interface FecViolation {
  /** Zero-based index in the input, or `null` for a whole-file rule. */
  line: number | null;
  rule: string;
  message: string;
}

/**
 * Checks the file-level rules a tax inspector applies first: mandatory
 * fields, one side per line, and each entry balancing to zero.
 */
export function checkFec(lines: readonly FecLine[]): FecViolation[] {
  const violations: FecViolation[] = [];
  const perEntry = new Map<string, { debit: number; credit: number; first: number }>();

  lines.forEach((line, index) => {
    for (const field of ['journalCode', 'ecritureNum', 'compteNum', 'ecritureLib'] as const) {
      if (line[field] === undefined || line[field] === null || line[field] === '') {
        violations.push({ line: index, rule: 'required', message: `${field} is empty` });
      }
    }

    const debit = Number(line.debit ?? 0);
    const credit = Number(line.credit ?? 0);
    if (debit !== 0 && credit !== 0) {
      violations.push({
        line: index,
        rule: 'one-side',
        message: 'a line carries both a debit and a credit',
      });
    }
    if (debit < 0 || credit < 0) {
      violations.push({
        line: index,
        rule: 'sign',
        message: 'amounts must be positive; a reversal flips the side',
      });
    }
    if ((line.ecritureLet ?? '') !== '' && (line.dateLet ?? '') === '') {
      violations.push({
        line: index,
        rule: 'letter',
        message: 'EcritureLet is set but DateLet is empty',
      });
    }

    const key = `${line.journalCode}/${line.ecritureNum}`;
    const bucket = perEntry.get(key) ?? { debit: 0, credit: 0, first: index };
    bucket.debit += debit;
    bucket.credit += credit;
    perEntry.set(key, bucket);
  });

  for (const [key, bucket] of perEntry) {
    if (Math.abs(bucket.debit - bucket.credit) > 0.005) {
      violations.push({
        line: bucket.first,
        rule: 'balance',
        message: `entry ${key} has debit ${bucket.debit.toFixed(2)} and credit ${bucket.credit.toFixed(2)}`,
      });
    }
  }

  return violations;
}

/** The whole file as a string. Write it out as UTF-8 or ISO-8859-15. */
export function generateFec(lines: readonly FecLine[], options: FecOptions = {}): string {
  const opts = { ...DEFAULTS, ...options };
  const sep = opts.fieldSeparator;

  const clean = (value: string | null | undefined): string => {
    if (value === null || value === undefined) return '';
    // A separator or a newline inside a field would shift every column after
    // it; the format has no quoting, so they become a space and runs of
    // whitespace are collapsed.
    return value.replace(/[\r\n\t|]+/g, ' ').replace(/\s+/g, ' ').trim();
  };

  const out: string[] = [];
  if (opts.header) out.push(FEC_COLUMNS.join(sep));

  for (const line of lines) {
    out.push(
      [
        clean(line.journalCode),
        clean(line.journalLib),
        clean(line.ecritureNum),
        formatFecDate(line.ecritureDate),
        clean(line.compteNum),
        clean(line.compteLib),
        clean(line.compAuxNum),
        clean(line.compAuxLib),
        clean(line.pieceRef),
        formatFecDate(line.pieceDate),
        clean(line.ecritureLib),
        formatFecAmount(line.debit, opts.decimalSeparator),
        formatFecAmount(line.credit, opts.decimalSeparator),
        clean(line.ecritureLet),
        formatFecDate(line.dateLet),
        formatFecDate(line.validDate),
        formatFecAmount(line.montantDevise, opts.decimalSeparator),
        clean(line.idevise),
      ].join(sep),
    );
  }

  return out.join(opts.newline) + opts.newline;
}

/**
 * The file name the administration expects: SIREN, the literal `FEC`, the
 * closing date of the financial year, `.txt`.
 */
export function fecFileName(siren: string, fiscalYearEnd: IsoDate | Date): string {
  const digits = siren.replace(/\D/g, '');
  if (digits.length !== 9) {
    throw new FecError(`a SIREN has nine digits, got "${siren}"`);
  }
  return `${digits}FEC${formatFecDate(fiscalYearEnd)}.txt`;
}

/** Row shape returned by the `fec_lines()` database function. */
export interface FecQueryRow {
  journal_code: string;
  journal_lib: string;
  ecriture_num: string;
  ecriture_date: string | Date;
  compte_num: string;
  compte_lib: string;
  comp_aux_num: string | null;
  comp_aux_lib: string | null;
  piece_ref: string;
  piece_date: string | Date;
  ecriture_lib: string;
  debit: string;
  credit: string;
  ecriture_let: string | null;
  date_let: string | Date | null;
  valid_date: string | Date;
  montant_devise: string | null;
  idevise: string | null;
}

/** Maps a `fec_lines()` row onto a {@link FecLine}. */
export function fromQueryRow(row: FecQueryRow): FecLine {
  return {
    journalCode: row.journal_code,
    journalLib: row.journal_lib,
    ecritureNum: row.ecriture_num,
    ecritureDate: row.ecriture_date as IsoDate,
    compteNum: row.compte_num,
    compteLib: row.compte_lib,
    compAuxNum: row.comp_aux_num,
    compAuxLib: row.comp_aux_lib,
    pieceRef: row.piece_ref,
    pieceDate: row.piece_date as IsoDate,
    ecritureLib: row.ecriture_lib,
    debit: row.debit,
    credit: row.credit,
    ecritureLet: row.ecriture_let,
    dateLet: row.date_let as IsoDate | null,
    validDate: row.valid_date as IsoDate,
    montantDevise: row.montant_devise,
    idevise: row.idevise,
  };
}
