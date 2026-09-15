/**
 * The shapes this package reads and returns.
 *
 * {@link StatementRow} is the row shape of the `ec_sales_list(company, from,
 * to)` function of [Ekwo OS](https://github.com/Ekwo-ai/ekwo-os), declared
 * here so that nothing is imported from it. Any book-keeping system that can
 * produce those columns can use this package; it reads no database and knows
 * no accounting.
 */

/**
 * One line of a recapitulative statement: a customer, what was supplied to
 * them, and how much, over a period.
 */
export interface StatementRow {
  /** Country of the customer's VAT identification number, ISO 3166-1 alpha-2. */
  vat_country: string | null;
  /** The number itself, without its country prefix, letters and digits only. */
  vat_number: string | null;
  /**
   * What was supplied: `goods`, `services`, `triangular`. A value this package
   * does not know comes back as a violation rather than being guessed at.
   */
  nature: string;
  /** Taxable amount, credit notes already deducted. A string keeps the cents. */
  amount: string | number;
  /** ISO 4217 code the amount is in. */
  currency_code: string;
  /** Why this line cannot be declared as it stands, or null when it can. */
  issue?: string | null;
  /** Names of the customers behind the line, for a message a human reads. */
  contact_names?: string[] | null;
}

/** The party filing. Only the VAT number is required by the schema. */
export interface Declarant {
  /**
   * The Belgian enterprise number of the declarant, ten digits and no `BE`.
   * The schema's own pattern is `[0-1][0-9][0-9]{8}`; anything else is
   * reported rather than cleaned up.
   */
  vatNumber: string;
  name?: string;
  street?: string;
  postCode?: string;
  city?: string;
  /** ISO 3166-1 alpha-2 of the declarant's address. */
  countryCode?: string;
  emailAddress?: string;
  phone?: string;
}

/**
 * The period the listing covers. Exactly one of `month` or `quarter`, because
 * that is what the schema's `choice` allows and because a listing is filed on
 * one cadence or the other.
 */
export interface ListingPeriod {
  year: number;
  month?: number;
  quarter?: number;
}

export interface IntraConsignmentOptions {
  declarant: Declarant;
  period: ListingPeriod;
  /** Sequence number of this listing inside the consignment. Default 1. */
  sequenceNumber?: number;
  /** The declarant's own reference for this filing, at most 14 characters. */
  declarantReference?: string;
  /** Free text the administration displays with the filing. */
  comment?: string;
}

/** Something that does not add up, said in the terms of this format. */
export interface Violation {
  /** A stable token, for a caller that branches on it. */
  code: string;
  /** What is wrong, in a sentence. */
  message: string;
  /** The customer the line was about, where there is one. */
  vatNumber?: string;
}

export interface IntraConsignment {
  /** The XML, as text. */
  file: string;
  /** A name for it. See the README: the administration imposes none. */
  filename: string;
  /** Everything that could not be put in the file, and why. */
  violations: Violation[];
}
