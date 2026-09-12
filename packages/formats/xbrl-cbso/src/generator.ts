/**
 * XBRL instance generator for the Belgian standardised annual accounts
 * (National Bank of Belgium, Central Balance Sheet Office — CBSO).
 *
 * Template-driven: every emitted fact carries the signature the taxonomy gives
 * it — generic `met:*` element, explicit dimension members, period, unit. The
 * reporting codes come from the taxonomy package itself (see `docs/sources.md`);
 * the identification fields, which carry no reporting code, reproduce a filing
 * the NBB accepted. The generator materialises the dimensional contexts
 * (deduplicated) and only emits the facts for which a value is provided, so a
 * partial form stays importable, as in the Filing editor.
 */
import { NAMESPACES, CBSO_26_M01F } from './taxonomy/index.js';
import { valuesFromFactKeys } from './fact-keys.js';
import { CbsoInputError } from './errors.js';
import { normalizeEnterpriseNumber } from './enterprise-number.js';
import { validateInput } from './validate.js';
import type {
  Administrator,
  CbsoInput,
  CbsoTemplate,
  GenerateOptions,
  PostalAddress,
  TemplateFact,
  YearValues,
} from './types.js';

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8"?>\n';

/** Prefixes always declared: XBRL core plus the axes of every context. */
const CORE_PREFIXES = ['', 'link', 'xbrldi', 'xlink', 'iso4217', 'dim', 'open'];

/** Type of the administrator record (`atc` domain), constant in the abridged model. */
const ADMINISTRATOR_TYPE = 'atc:m001';

const DEFAULT_DECLARATIONS = { m1: true, m2: false, m39: false } as const;

type TypedDimension = readonly [dimension: string, element: string, value: string];
type PeriodRef = { type: 'instant' | 'duration'; ref: 'N' | 'P' };

interface Fact {
  elem: string;
  dims: Record<string, string>;
  typed: readonly TypedDimension[];
  period: PeriodRef;
  value: string;
  unit?: string;
  dec?: string;
}

const INSTANT_N: PeriodRef = { type: 'instant', ref: 'N' };

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/'/g, '&apos;')
    .replace(/"/g, '&quot;');
}

function prefixOf(qname: string): string | null {
  const i = qname.indexOf(':');
  return i > 0 ? qname.slice(0, i) : null;
}

/**
 * Builds one XBRL instance. Use {@link generateCbsoXbrl} unless you need to
 * plug a custom template.
 */
export class XbrlCbso {
  private readonly entityNumber: string;
  private readonly administrators: readonly Administrator[];
  private readonly values: Record<string, YearValues>;

  constructor(
    private readonly input: CbsoInput,
    private readonly template: CbsoTemplate = CBSO_26_M01F,
    private readonly options: GenerateOptions = {},
  ) {
    if (options.validate !== false) validateInput(input);
    this.entityNumber = normalizeEnterpriseNumber(input.entityNumber);
    this.administrators = input.administrators ?? [];
    this.values = mergeValues(input, template);
  }

  /** The XBRL document, as a UTF-8 string ready to be imported in Filing. */
  generate(): string {
    const facts = [
      ...this.templateFacts(),
      ...this.identificationFacts(),
      ...this.administratorFacts(),
    ];
    const { contextXml, contextIdOf } = this.buildContexts(facts);

    const usedPrefixes = new Set(CORE_PREFIXES);
    const use = (qname: string) => {
      const p = prefixOf(qname);
      if (p) usedPrefixes.add(p);
    };
    for (const f of facts) {
      use(f.elem);
      for (const [d, m] of Object.entries(f.dims)) {
        use(d);
        use(m);
      }
      for (const [d, el] of f.typed) {
        use(d);
        use(el);
      }
      use(f.value);
    }
    const nsAttrs = Object.entries(NAMESPACES)
      .filter(([p]) => usedPrefixes.has(p))
      .map(([p, uri]) => (p ? ` xmlns:${p}="${uri}"` : ` xmlns="${uri}"`))
      .join('\n');

    const units = [...new Set(facts.map((f) => f.unit).filter((u): u is string => !!u))];
    const unitXml = units
      .map((u) => {
        const measure = u.toUpperCase().includes('EUR') ? 'iso4217:EUR' : 'pure';
        return `<unit id="${u}"><measure>${measure}</measure></unit>`;
      })
      .join('\n');

    const factXml = facts
      .map((f) => {
        const attrs = [
          `contextRef="${contextIdOf(f)}"`,
          f.unit ? `unitRef="${f.unit}"` : '',
          f.dec != null ? `decimals="${f.dec}"` : '',
        ]
          .filter(Boolean)
          .join(' ');
        return `<${f.elem} ${attrs}>${escapeXml(f.value)}</${f.elem}>`;
      })
      .join('\n');

    return (
      XML_HEADER +
      `<xbrl xml:lang="${this.options.lang ?? 'fr'}"\n${nsAttrs}>\n` +
      `<link:schemaRef xlink:type="simple" xlink:href="${this.template.schemaRef}"/>\n` +
      `${contextXml}\n${unitXml}\n${factXml}\n</xbrl>\n`
    );
  }

  /** Facts driven by the template: identification fields and reporting codes. */
  private templateFacts(): Fact[] {
    const out: Fact[] = [];
    for (const t of this.template.facts) {
      const value = this.templateValue(t);
      if (value == null) continue;
      out.push({ elem: t.elem, dims: t.dims, typed: [], period: t.period, value, unit: t.unit, dec: t.dec });
    }
    return out;
  }

  private templateValue(t: TemplateFact): string | null {
    const [kind, key, col] = t.role.split(':');
    if (!key) return null;
    if (kind === 'rubrique') {
      const v = col === 'P' ? this.values[key]?.p : this.values[key]?.n;
      return v == null ? null : formatNumber(v, t.elem);
    }
    if (kind !== 'ident') return null;
    const i = this.input;
    switch (key) {
      case 'entity_number':
        return this.entityNumber;
      case 'denomination':
        return i.denomination;
      case 'street':
        return i.address.street;
      case 'number':
        return i.address.number;
      case 'box':
        return i.address.box ?? null;
      case 'ga_date':
        return i.gaDate;
      case 'deed_date':
        return i.deedDate;
      case 'period_start':
        return i.periodStart;
      case 'period_end':
        return i.periodEnd;
      case 'prev_period_start':
        return i.prevPeriodStart;
      case 'prev_period_end':
        return i.prevPeriodEnd;
      case 'decl': {
        // role = ident:decl:dcl:mX → t.role.split(':') = ['ident','decl','dcl','mX']
        const member = t.role.split(':')[3] as keyof typeof DEFAULT_DECLARATIONS;
        const value = i.declarations?.[member] ?? DEFAULT_DECLARATIONS[member];
        return value == null ? null : String(value);
      }
      default:
        return null;
    }
  }

  /**
   * Identification enumerations absent from the metric template: legal form,
   * enterprise court, postal code and country of the registered office.
   */
  private identificationFacts(): Fact[] {
    const entity = { 'dim:part': 'part:m2', 'dim:psn': 'psn:m1' };
    return [
      { elem: 'lgf-enum:list2', dims: { 'dim:bas': 'bas:m30', ...entity }, typed: [], period: INSTANT_N, value: this.input.legalForm },
      { elem: 'cct-enum:list1', dims: { 'dim:bas': 'bas:m32', 'dim:part': 'part:m2' }, typed: [], period: INSTANT_N, value: this.input.court },
      ...this.addressEnumFacts(entity, [], this.input.address),
    ];
  }

  /**
   * Postal code and country of an address (`bas:m31`). Belgium → postal-code
   * enumeration (the municipality follows from it); abroad → free text.
   */
  private addressEnumFacts(
    dims: Record<string, string>,
    typed: readonly TypedDimension[],
    address: PostalAddress,
  ): Fact[] {
    const country = (address.country ?? 'BE').toUpperCase();
    const out: Fact[] = [];
    if (country === 'BE') {
      out.push({
        elem: 'pcd-enum:list1',
        dims: { 'dim:bas': 'bas:m31', 'dim:ctc': 'ctc:m4', ...dims },
        typed,
        period: INSTANT_N,
        value: `pcd:m${address.postalCode.replace(/\D/g, '')}`,
      });
    } else {
      for (const [ctc, value] of [
        ['ctc:m4', address.postalCode],
        ['ctc:m5', address.city],
      ] as const) {
        if (!value) continue;
        out.push({ elem: 'met:str2', dims: { 'dim:bas': 'bas:m31', 'dim:ctc': ctc, ...dims }, typed, period: INSTANT_N, value });
      }
    }
    out.push({
      elem: 'cty-enum:list1',
      dims: { 'dim:bas': 'bas:m31', 'dim:ctc': 'ctc:m6', ...dims },
      typed,
      period: INSTANT_N,
      value: `cty:m${country}`,
    });
    return out;
  }

  /**
   * Board members. Natural persons are keyed by first and last name
   * (`afnp`/`annp`), legal entities by name (`anlp`), permanent
   * representatives by entity name plus their own names (`aprf`/`aprn`).
   */
  private administratorFacts(): Fact[] {
    const out: Fact[] = [];
    const person = (psn: string) => ({ 'dim:part': 'part:m2', 'dim:psn': psn });

    const addressFacts = (psn: string, typed: readonly TypedDimension[], address: PostalAddress) => {
      for (const [ctc, value] of [
        ['ctc:m1', address.street],
        ['ctc:m2', address.number],
        ['ctc:m3', address.box],
      ] as const) {
        if (!value) continue;
        out.push({ elem: 'met:str2', dims: { 'dim:bas': 'bas:m31', 'dim:ctc': ctc, ...person(psn) }, typed, period: INSTANT_N, value });
      }
      out.push(...this.addressEnumFacts(person(psn), typed, address));
      out.push({
        elem: 'atc-enum:list1',
        dims: { 'dim:bas': 'bas:m31', 'dim:dcl': 'dcl:m7', ...person(psn) },
        typed,
        period: INSTANT_N,
        value: ADMINISTRATOR_TYPE,
      });
    };

    for (const admin of this.administrators) {
      if (admin.kind === 'person') {
        const typed: TypedDimension[] = [
          ['dim:afnp', 'open:str', admin.firstName],
          ['dim:annp', 'open:str', admin.lastName],
        ];
        addressFacts('psn:m12', typed, admin);
        continue;
      }

      const typed: TypedDimension[] = [['dim:anlp', 'open:str', admin.name]];
      if (admin.enterpriseNumber) {
        // Identifier of the entity: type (enumeration for a Belgian entity, free
        // label otherwise) and number. Required by Filing for any entity with a
        // Belgian address.
        const typeDims = { 'dim:bas': 'bas:m26', 'dim:dcl': 'dcl:m7', ...person('psn:m10') };
        if (admin.identifierLabel) {
          out.push({ elem: 'met:str2', dims: typeDims, typed, period: INSTANT_N, value: admin.identifierLabel });
        } else {
          out.push({ elem: 'nmt-enum:list1', dims: typeDims, typed, period: INSTANT_N, value: 'nmt:m1' });
        }
        const number = (admin.country ?? 'BE').toUpperCase() === 'BE'
          ? normalizeEnterpriseNumber(admin.enterpriseNumber)
          : admin.enterpriseNumber;
        out.push({
          elem: 'met:str2',
          dims: { 'dim:bas': 'bas:m26', 'dim:qlt': 'qlt:m1', ...person('psn:m10') },
          typed,
          period: INSTANT_N,
          value: number,
        });
      }
      addressFacts('psn:m10', typed, admin);

      if (admin.representative) {
        const repTyped: TypedDimension[] = [
          ['dim:anlp', 'open:str', admin.name],
          ['dim:aprf', 'open:str', admin.representative.firstName],
          ['dim:aprn', 'open:str', admin.representative.lastName],
        ];
        addressFacts('psn:m11', repTyped, admin);
      }
    }
    return out;
  }

  private buildContexts(facts: readonly Fact[]): {
    contextXml: string;
    contextIdOf: (f: Fact) => string;
  } {
    const i = this.input;
    const ids = new Map<string, string>();
    const xml: string[] = [];
    const keyOf = (f: Fact) => JSON.stringify([f.period, f.dims, f.typed]);

    for (const f of facts) {
      const key = keyOf(f);
      if (ids.has(key)) continue;
      const id = `c${ids.size + 1}`;
      ids.set(key, id);

      const current = f.period.ref === 'N';
      const periodXml =
        f.period.type === 'instant'
          ? `<period><instant>${current ? i.periodEnd : i.prevPeriodEnd}</instant></period>`
          : `<period><startDate>${current ? i.periodStart : i.prevPeriodStart}</startDate><endDate>${current ? i.periodEnd : i.prevPeriodEnd}</endDate></period>`;
      const explicit = Object.entries(f.dims)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([d, m]) => `<xbrldi:explicitMember dimension="${d}">${m}</xbrldi:explicitMember>`)
        .join('');
      const typed = f.typed
        .map(([d, el, v]) => `<xbrldi:typedMember dimension="${d}"><${el}>${escapeXml(v)}</${el}></xbrldi:typedMember>`)
        .join('');
      const scenario = explicit || typed ? `<scenario>${explicit}${typed}</scenario>` : '';
      xml.push(
        `<context id="${id}"><entity><identifier scheme="http://www.fgov.be">${this.entityNumber}</identifier></entity>${periodXml}${scenario}</context>`,
      );
    }
    return { contextXml: xml.join('\n'), contextIdOf: (f) => ids.get(keyOf(f)) as string };
  }
}

/**
 * Numbers follow the facets of the metric elements: integers for `met:int*`,
 * one decimal for `met:dec*` (full-time equivalents), two decimals for amounts.
 */
export function formatNumber(v: number, elem: string): string {
  if (elem.startsWith('met:int')) return String(Math.round(v));
  if (elem.startsWith('met:dec')) return String(Math.round(v * 10) / 10);
  return v.toFixed(2);
}

/**
 * The figures a filing will actually carry: {@link CbsoInput.values} plus the
 * lines of {@link CbsoInput.lines} resolved against the template. A code given
 * on both sides with two different figures is an error rather than a silent
 * overwrite.
 */
export function mergeValues(
  input: CbsoInput,
  template: CbsoTemplate = CBSO_26_M01F,
): Record<string, YearValues> {
  const fromLines = input.lines ? valuesFromFactKeys(input.lines, template) : {};
  const merged: Record<string, YearValues> = { ...fromLines };
  for (const [code, value] of Object.entries(input.values ?? {})) {
    const line = fromLines[code];
    if (line && (line.n !== (value.n ?? null) || line.p !== (value.p ?? null))) {
      throw new CbsoInputError(
        'given both as a reporting code and as a statement line, with different figures',
        `values.${code}`,
      );
    }
    merged[code] = value;
  }
  return merged;
}

/**
 * Codes of `values` that the template does not know and that
 * {@link generateCbsoXbrl} would therefore not emit. Useful to surface, before
 * filing, figures that belong to another model (full, micro) or to an annex
 * absent from the abridged form.
 */
export function unknownCodes(
  values: Record<string, unknown>,
  template: CbsoTemplate = CBSO_26_M01F,
): string[] {
  const known = new Set<string>();
  for (const t of template.facts) {
    const [kind, code] = t.role.split(':');
    if (kind === 'rubrique' && code) known.add(code);
  }
  return Object.keys(values).filter((code) => !known.has(code)).sort();
}

/**
 * Figures that would be dropped: a code the model does not have, or a code
 * whose column the model does not have — the annex boxes the NBB itself
 * suffixes with `P` (`8059P`, `1003P`) exist only in the previous-year column,
 * so a figure left under `n` would never reach the filing.
 */
export function unfiledValues(
  input: CbsoInput,
  template: CbsoTemplate = CBSO_26_M01F,
): Array<{ code: string; column: 'n' | 'p'; reason: 'unknown code' | 'no such column' }> {
  const columns = new Map<string, Set<'n' | 'p'>>();
  for (const t of template.facts) {
    const [kind, code, col] = t.role.split(':');
    if (kind !== 'rubrique' || !code) continue;
    const set = columns.get(code) ?? new Set<'n' | 'p'>();
    set.add(col === 'P' ? 'p' : 'n');
    columns.set(code, set);
  }
  const out: Array<{ code: string; column: 'n' | 'p'; reason: 'unknown code' | 'no such column' }> = [];
  for (const [code, value] of Object.entries(mergeValues(input, template))) {
    const known = columns.get(code);
    for (const column of ['n', 'p'] as const) {
      if (value[column] == null) continue;
      if (!known) out.push({ code, column, reason: 'unknown code' });
      else if (!known.has(column)) out.push({ code, column, reason: 'no such column' });
    }
  }
  return out.sort((a, b) => a.code.localeCompare(b.code) || a.column.localeCompare(b.column));
}

/**
 * One call: {@link CbsoInput} → XBRL instance string, ready for
 * `filing.cbso.nbb.be` (« Import one or more XBRL forms »).
 */
export function generateCbsoXbrl(input: CbsoInput, options?: GenerateOptions): string {
  return new XbrlCbso(input, CBSO_26_M01F, options).generate();
}
