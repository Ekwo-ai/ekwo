/**
 * Public types of `@ekwo-ai/factur-x`. The invoice model is deliberately
 * small and neutral: it maps one-to-one to the EN 16931 semantic model
 * without carrying any application-specific field.
 */

/** ISO-8601 calendar date, `YYYY-MM-DD`. */
export type IsoDate = string;

/** ISO 4217 currency code, e.g. `"EUR"`. */
export type CurrencyCode = string;

/**
 * VAT category codes of EN 16931 (UNTDID 5305 subset).
 * - `S` standard rate
 * - `Z` zero rated
 * - `E` exempt
 * - `AE` reverse charge
 * - `K` intra-community supply
 * - `G` export outside the EU
 * - `O` not subject to VAT
 */
export type VatCategory = 'S' | 'Z' | 'E' | 'AE' | 'K' | 'G' | 'O';

/**
 * Factur-X / ZUGFeRD conformance levels. The generator emits the same
 * structure for `basic` and `en16931`; the level only changes the guideline
 * identifier in the XML and the XMP metadata of the PDF.
 */
export type Profile = 'minimum' | 'basic-wl' | 'basic' | 'en16931' | 'extended';

/** Document type codes of UNTDID 1001 accepted by Factur-X. */
export type DocumentType = 'invoice' | 'credit-note' | 'corrected-invoice' | 'self-billed-invoice' | 'prepayment-invoice';

export interface PostalAddress {
  line1: string;
  line2?: string;
  line3?: string;
  postalCode: string;
  city: string;
  /** ISO 3166-1 alpha-2. */
  country: string;
  /** Region, province, state. */
  subdivision?: string;
}

/**
 * Legal registration identifier with its ISO 6523 ICD scheme
 * (`"0002"` SIREN/SIRET, `"0208"` Belgian enterprise number, `"0009"` SIRET…).
 */
export interface LegalIdentifier {
  scheme: string;
  value: string;
}

export interface Party {
  name: string;
  address: PostalAddress;
  /** VAT identifier with country prefix, e.g. `"BE0123456749"`. */
  vatId?: string;
  /** Legal registration identifier (BT-30 / BT-47). */
  legalId?: LegalIdentifier;
  /** Electronic address (BT-34 / BT-49), e.g. an e-mail. */
  electronicAddress?: { scheme: string; value: string };
  /** Contact person (BG-6 / BG-9). */
  contact?: { name?: string; phone?: string; email?: string };
}

export interface InvoiceLine {
  /** Line identifier (BT-126). Defaults to the 1-based position. */
  id?: string;
  /** Item name (BT-153). */
  name: string;
  /** Item description (BT-154). */
  description?: string;
  /** Invoiced quantity (BT-129). */
  quantity: number;
  /** UN/ECE Recommendation 20 unit code (BT-130). Defaults to `"C62"` (unit). */
  unitCode?: string;
  /** Net unit price, excluding VAT (BT-146). */
  unitPrice: number;
  /** VAT rate in percent (BT-152), e.g. `21`. */
  vatRate: number;
  /** VAT category (BT-151). Derived from the rate and the parties when omitted. */
  vatCategory?: VatCategory;
  /** Line net amount (BT-131). Defaults to `quantity × unitPrice`, rounded to the cent. */
  netAmount?: number;
  /** Line note (BT-127). */
  note?: string;
  /** Seller item identifier (BT-155). */
  sellerItemId?: string;
}

export interface PaymentInstructions {
  /** UNTDID 4461 code (BT-81). Defaults to `"58"` (SEPA credit transfer) when an IBAN is given. */
  meansCode?: string;
  /** Payee IBAN (BT-84). */
  iban?: string;
  /** Payee BIC (BT-86). Omitted from the XML below the EN 16931 level. */
  bic?: string;
  /** Remittance information (BT-83). */
  reference?: string;
  /** Free-text payment terms (BT-20). */
  terms?: string;
}

export interface Invoice {
  /** Invoice number (BT-1). */
  number: string;
  /** Defaults to `"invoice"`. */
  type?: DocumentType;
  /** Issue date (BT-2). */
  issueDate: IsoDate;
  /** Payment due date (BT-9). */
  dueDate?: IsoDate;
  /** Actual delivery date (BT-72). Defaults to the issue date. */
  deliveryDate?: IsoDate;
  /** Invoice currency (BT-5). Defaults to `"EUR"`. */
  currency?: CurrencyCode;
  seller: Party;
  buyer: Party;
  lines: InvoiceLine[];
  /** Buyer reference (BT-10), e.g. the French « service exécutant » code. */
  buyerReference?: string;
  /** Purchase order reference (BT-13). */
  orderReference?: string;
  /** Contract reference (BT-12). */
  contractReference?: string;
  /** Invoice being corrected or credited (BG-3). */
  precedingInvoice?: { number: string; issueDate?: IsoDate };
  /** Invoice note (BT-22). */
  note?: string;
  payment?: PaymentInstructions;
  /** Amount already paid (BT-113). */
  prepaidAmount?: number;
  /**
   * Overrides the reason texts attached to exempt VAT categories (BT-120).
   * Defaults are neutral English sentences; see {@link DEFAULT_EXEMPTION_REASONS}.
   */
  exemptionReasons?: Partial<Record<Exclude<VatCategory, 'S' | 'Z'>, string>>;
}

export interface VatBreakdown {
  category: VatCategory;
  rate: number;
  /** Sum of the line net amounts in this group (BT-116). */
  basis: number;
  /** VAT amount of the group (BT-117). */
  tax: number;
}

export interface InvoiceTotals {
  /** Sum of line net amounts (BT-106). */
  lineTotal: number;
  /** Taxable amount (BT-109). */
  taxBasisTotal: number;
  /** Total VAT (BT-110). */
  taxTotal: number;
  /** Amount with VAT (BT-112). */
  grandTotal: number;
  /** Amount already paid (BT-113). */
  prepaid: number;
  /** Amount due for payment (BT-115). */
  duePayable: number;
  breakdown: VatBreakdown[];
}

export interface GenerateOptions {
  /** Defaults to `"basic"`, the widest-supported level. */
  profile?: Profile;
  /** Business process identifier (BT-23). Defaults to `"A1"`. */
  businessProcess?: string;
}
