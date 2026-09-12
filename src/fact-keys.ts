/**
 * Fact keys — the dimensional way to name a line of the annual accounts.
 *
 * The CBSO taxonomy has no element per reporting code: a code is a generic
 * metric plus a set of explicit dimension members. A fact key writes that
 * signature down, metric first:
 *
 *     met:am1|bas:m9|rst:m2      → "Créances à un an au plus" (40/41)
 *     met:am2|bas:m44|ntr:m4     → "Bénéfice (Perte) reporté(e)" (14)
 *
 * A key names the members that matter and leaves the rest implicit, so it can
 * be stored next to a statement line without repeating the whole context. It
 * resolves against the template to exactly one reporting code, or throws.
 */
import { CbsoInputError } from './errors.js';
import type { BnbCode, CbsoTemplate, TemplateFact, YearValues } from './types.js';

/**
 * One line of a financial statement, keyed by its fact signature rather than
 * by a reporting code. Shaped after the rows a book-keeping system produces:
 * `xbrl_element` holds the key, `amount` the figure of the financial year.
 */
export interface FactKeyLine {
  /** Fact key, e.g. `"met:am1|bas:m9|rst:m2"`. */
  xbrl_element: string;
  /** Amount of the current financial year. */
  amount?: number | null;
  /** Amount of the previous financial year, when the line carries one. */
  previous_amount?: number | null;
}

/** Thrown when a fact key names no line of the model, or more than one. */
export class CbsoFactKeyError extends CbsoInputError {
  constructor(
    message: string,
    /** The key that could not be resolved. */
    public readonly key: string,
    /** Reporting codes the key could stand for, when it is ambiguous. */
    public readonly candidates: readonly BnbCode[] = [],
  ) {
    super(message, `xbrl_element[${key}]`);
    this.name = 'CbsoFactKeyError';
  }
}

/** Dimensions the taxonomy uses to place a fact in a column, not to name it. */
const POSITIONAL = new Set(['dim:part', 'dim:prd']);

interface ParsedKey {
  metric: string;
  members: Record<string, string>;
}

/** `"met:am1|bas:m9|rst:m2"` → metric plus `{ "dim:bas": "bas:m9", … }`. */
export function parseFactKey(key: string): ParsedKey {
  const parts = key
    .split('|')
    .map((p) => p.trim())
    .filter(Boolean);
  const metric = parts.shift();
  if (!metric?.startsWith('met:')) {
    throw new CbsoFactKeyError('a fact key starts with its metric, e.g. "met:am1"', key);
  }
  const members: Record<string, string> = {};
  for (const part of parts) {
    const prefix = part.split(':')[0];
    if (!prefix || !part.includes(':')) {
      throw new CbsoFactKeyError(`"${part}" is not a domain member such as "bas:m9"`, key);
    }
    members[`dim:${prefix}`] = part;
  }
  return { metric, members };
}

/**
 * Reporting code a fact key stands for.
 *
 * Candidates are the facts of the template that carry the key's metric and
 * every one of its members; the winner is the one that adds the fewest members
 * of its own — `met:am1|bas:m2` is "ACTIFS IMMOBILISÉS" (21/28) and not one of
 * the three lines under it. A tie means the key does not say enough: the error
 * lists the codes it could stand for.
 */
export function resolveFactKey(key: string, template: CbsoTemplate): BnbCode {
  const { metric, members } = parseFactKey(key);
  const entries = Object.entries(members);

  let best: number | null = null;
  const winners = new Map<BnbCode, true>();
  for (const fact of template.facts) {
    if (fact.elem !== metric) continue;
    const [kind, code] = fact.role.split(':');
    if (kind !== 'rubrique' || !code) continue;
    if (entries.some(([dim, member]) => fact.dims[dim] !== member)) continue;
    const extra = Object.keys(fact.dims).filter(
      (dim) => !POSITIONAL.has(dim) && !(dim in members),
    ).length;
    if (best === null || extra < best) {
      best = extra;
      winners.clear();
    }
    if (extra === best) winners.set(code, true);
  }

  const codes = [...winners.keys()].sort();
  if (codes.length === 0) {
    throw new CbsoFactKeyError('no line of this model carries that signature', key);
  }
  if (codes.length > 1) {
    throw new CbsoFactKeyError(
      `signature shared by ${codes.join(', ')} — add the member that separates them (usually a "part:" member)`,
      key,
      codes,
    );
  }
  return codes[0] as BnbCode;
}

/**
 * Turns statement lines keyed by fact signature into the `values` map of
 * {@link CbsoInput}. Lines whose two amounts are both absent are skipped; a
 * code reached twice with conflicting figures is an error, not a silent
 * overwrite.
 */
export function valuesFromFactKeys(
  lines: readonly FactKeyLine[],
  template: CbsoTemplate,
): Record<BnbCode, YearValues> {
  const values: Record<BnbCode, YearValues> = {};
  for (const line of lines) {
    if (line.amount == null && line.previous_amount == null) continue;
    const code = resolveFactKey(line.xbrl_element, template);
    const previous = values[code];
    const next: YearValues = { n: line.amount ?? null, p: line.previous_amount ?? null };
    if (previous && (previous.n !== next.n || previous.p !== next.p)) {
      throw new CbsoFactKeyError(
        `two lines resolve to ${code} with different amounts`,
        line.xbrl_element,
        [code],
      );
    }
    values[code] = next;
  }
  return values;
}

/** Fact key of one template fact, in the same syntax {@link parseFactKey} reads. */
export function factKeyOf(fact: TemplateFact): string {
  const members = Object.entries(fact.dims)
    .filter(([dim]) => !POSITIONAL.has(dim))
    .map(([, member]) => member)
    .sort();
  return [fact.elem, ...members].join('|');
}
