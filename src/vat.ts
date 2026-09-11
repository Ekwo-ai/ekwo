import type { VatCategory } from './types.js';

/** EU member states, ISO 3166-1 alpha-2. */
export const EU_COUNTRIES: ReadonlySet<string> = new Set([
  'AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'HU',
  'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK',
]);

export function isEuCountry(code: string): boolean {
  return EU_COUNTRIES.has(code.toUpperCase());
}

/**
 * Picks the VAT category of a line when the caller does not state it.
 * Positive rate → standard. Zero rate: domestic → zero-rated; EU buyer with a
 * VAT identifier → intra-community supply; EU buyer without → exempt;
 * non-EU buyer → export.
 */
export function defaultVatCategory(input: {
  rate: number;
  sellerCountry: string;
  buyerCountry: string;
  buyerHasVatId: boolean;
}): VatCategory {
  if (input.rate > 0) return 'S';
  const seller = input.sellerCountry.toUpperCase();
  const buyer = input.buyerCountry.toUpperCase();
  if (seller === buyer) return 'Z';
  if (isEuCountry(buyer)) return input.buyerHasVatId ? 'K' : 'E';
  return 'G';
}

/** Categories that require an exemption reason (BR-E-10, BR-AE-10, BR-IC-10, BR-G-10, BR-O-10). */
export const EXEMPT_CATEGORIES: ReadonlySet<VatCategory> = new Set(['E', 'AE', 'K', 'G', 'O']);

/** VATEX exemption reason codes (BT-121) where one exists. */
export const EXEMPTION_REASON_CODES: Readonly<Partial<Record<VatCategory, string>>> = {
  K: 'VATEX-EU-IC',
  AE: 'VATEX-EU-AE',
  G: 'VATEX-EU-G',
  O: 'VATEX-EU-O',
};

/** Neutral default reason texts (BT-120). Override per invoice with `exemptionReasons`. */
export const DEFAULT_EXEMPTION_REASONS: Readonly<Record<Exclude<VatCategory, 'S' | 'Z'>, string>> = {
  E: 'Exempt from VAT',
  AE: 'Reverse charge: VAT to be accounted for by the recipient',
  K: 'Intra-community supply, exempt from VAT',
  G: 'Export outside the European Union, exempt from VAT',
  O: 'Not subject to VAT',
};
