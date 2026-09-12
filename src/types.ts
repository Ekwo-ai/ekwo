/**
 * Public types of `@ekwo-ai/xbrl-cbso`.
 */
import type { FactKeyLine } from './fact-keys.js';

/** ISO-8601 calendar date, `YYYY-MM-DD`. */
export type IsoDate = string;

/**
 * A reporting code of the Belgian standardised annual accounts
 * (e.g. `"20/58"`, `"10/49"`, `"9903"`, `"8059"`, `"14P"`).
 */
export type BnbCode = string;

/** Value of one reporting code: `n` = current year, `p` = previous year. */
export interface YearValues {
  n?: number | null;
  p?: number | null;
}

export interface PostalAddress {
  street: string;
  number: string;
  box?: string;
  postalCode: string;
  city: string;
  /**
   * ISO 3166-1 alpha-2 country code. Defaults to `"BE"`.
   * A Belgian address is encoded with the taxonomy's postal-code enumeration;
   * a foreign address carries postal code and city as free text.
   */
  country?: string;
}

/** A natural person sitting on the board. */
export interface NaturalPersonAdministrator extends PostalAddress {
  kind: 'person';
  lastName: string;
  firstName: string;
}

/** A legal entity sitting on the board, optionally through a permanent representative. */
export interface LegalEntityAdministrator extends PostalAddress {
  kind: 'company';
  name: string;
  /** Enterprise number (Belgian entity) or foreign registration number. */
  enterpriseNumber?: string;
  /**
   * Label of the identifier type for a foreign entity (free text, e.g. `"KvK (Netherlands)"`).
   * Leave empty for a Belgian entity: the taxonomy's "enterprise number" enumeration is used.
   */
  identifierLabel?: string;
  representative?: { lastName: string; firstName: string };
}

export type Administrator = NaturalPersonAdministrator | LegalEntityAdministrator;

/**
 * Standard declarations of the identification section (`dcl` domain).
 * Keys are the member ids of the taxonomy's `dcl` domain.
 * Defaults reproduce a filing accepted by the NBB for a company with capital.
 */
export interface Declarations {
  /** `dcl:m1` — defaults to `true`. */
  m1?: boolean;
  /** `dcl:m2` — defaults to `false`. */
  m2?: boolean;
  /** `dcl:m39` — defaults to `false`. */
  m39?: boolean;
}

/**
 * Everything the generator needs to produce one XBRL instance.
 */
export interface CbsoInput {
  /** Belgian enterprise number, with or without dots or `BE` prefix. */
  entityNumber: string;
  /** Registered name of the company. */
  denomination: string;
  /**
   * Legal form, as a member of the taxonomy's `lgf` domain (e.g. `"lgf:m014"`).
   * See {@link LegalForm} for the identifiers verified against accepted filings.
   */
  legalForm: string;
  /**
   * Competent enterprise court, as a member of the taxonomy's `cct` domain
   * (e.g. `"cct:m31"`). See {@link EnterpriseCourt}.
   */
  court: string;
  /** Registered office. */
  address: PostalAddress;
  /** Current financial year. */
  periodStart: IsoDate;
  periodEnd: IsoDate;
  /** Previous financial year. */
  prevPeriodStart: IsoDate;
  prevPeriodEnd: IsoDate;
  /** Date of the general meeting that approved the accounts. */
  gaDate: IsoDate;
  /** Date of the deed of incorporation or of the latest amendment of the articles. */
  deedDate: IsoDate;
  /**
   * Amounts and figures, keyed by reporting code. Missing codes are simply not
   * emitted. This is the legacy path: it makes the caller hold its own mapping
   * from its accounts to the codes of the model. Prefer {@link CbsoInput.lines}
   * when the mapping already lives in the book-keeping system.
   */
  values?: Record<BnbCode, YearValues>;
  /**
   * Statement lines keyed by their fact signature (`met:am1|bas:m9|rst:m2`),
   * as a book-keeping system that stores the taxonomy key next to each line
   * produces them. Resolved against the template and merged into
   * {@link CbsoInput.values}; a code given on both sides with two different
   * figures is an error.
   */
  lines?: readonly FactKeyLine[];
  /** Board members. May be empty. */
  administrators?: Administrator[];
  /** Identification declarations. Defaults apply when omitted. */
  declarations?: Declarations;
}

export interface GenerateOptions {
  /**
   * Validate the input (enterprise number check digits, ISO dates, Belgian
   * postal codes) and throw a descriptive {@link CbsoInputError} on failure.
   * Defaults to `true`.
   */
  validate?: boolean;
  /** Value of the `xml:lang` attribute of the root element. Defaults to `"fr"`. */
  lang?: 'fr' | 'nl' | 'de' | 'en';
}

/** One fact signature of the taxonomy template. */
export interface TemplateFact {
  /** Generic metric element, e.g. `met:am1`. */
  elem: string;
  /** Explicit dimension members of the context, e.g. `{ "dim:bas": "bas:m25" }`. */
  dims: Record<string, string>;
  period: { type: 'instant' | 'duration'; ref: 'N' | 'P' };
  /**
   * What the fact carries: `ident:<field>` for identification fields,
   * `rubrique:<code>:<N|P>` for a reporting code.
   */
  role: string;
  unit?: string;
  dec?: string;
}

export interface CbsoTemplate {
  /** Location of the entry-point schema of the model, used in `link:schemaRef`. */
  schemaRef: string;
  facts: readonly TemplateFact[];
}
