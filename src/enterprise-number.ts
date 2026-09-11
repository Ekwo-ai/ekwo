/**
 * Belgian enterprise number (numéro d'entreprise / ondernemingsnummer):
 * ten digits, the last two being `97 - (first eight mod 97)`.
 */

/** Strip dots, spaces and an optional `BE` prefix: `"BE 0123.456.749"` → `"0123456749"`. */
export function normalizeEnterpriseNumber(raw: string): string {
  return raw.replace(/^\s*BE/i, '').replace(/\D/g, '');
}

/** `true` when the ten-digit number carries valid check digits. */
export function isValidEnterpriseNumber(raw: string): boolean {
  const digits = normalizeEnterpriseNumber(raw);
  if (!/^\d{10}$/.test(digits)) return false;
  const base = Number(digits.slice(0, 8));
  const check = Number(digits.slice(8));
  return 97 - (base % 97) === check;
}
