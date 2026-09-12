/**
 * UN/ECE Recommendation 20 unit codes, and a lenient mapping from the words
 * people type on invoices (FR / NL / EN / DE).
 */
export const UNIT_CODES = {
  UNIT: 'C62',
  PIECE: 'H87',
  HOUR: 'HUR',
  DAY: 'DAY',
  WEEK: 'WEE',
  MONTH: 'MON',
  YEAR: 'ANN',
  KILOGRAM: 'KGM',
  GRAM: 'GRM',
  TONNE: 'TNE',
  LITRE: 'LTR',
  METRE: 'MTR',
  SQUARE_METRE: 'MTK',
  CUBIC_METRE: 'MTQ',
  KILOMETRE: 'KMT',
  KILOWATT_HOUR: 'KWH',
  MEGAWATT_HOUR: 'MWH',
  LOT: 'LO',
  SET: 'SET',
  PACKAGE: 'XPK',
} as const;

const WORDS: Record<string, string> = {
  // hours
  h: 'HUR', hr: 'HUR', hour: 'HUR', hours: 'HUR', heure: 'HUR', heures: 'HUR', uur: 'HUR', uren: 'HUR', stunde: 'HUR', stunden: 'HUR',
  // days
  d: 'DAY', j: 'DAY', day: 'DAY', days: 'DAY', jour: 'DAY', jours: 'DAY', dag: 'DAY', dagen: 'DAY', tag: 'DAY', tage: 'DAY',
  // weeks, months, years
  week: 'WEE', weeks: 'WEE', semaine: 'WEE', semaines: 'WEE', weken: 'WEE', woche: 'WEE',
  month: 'MON', months: 'MON', mois: 'MON', maand: 'MON', maanden: 'MON', monat: 'MON', monate: 'MON',
  year: 'ANN', years: 'ANN', an: 'ANN', ans: 'ANN', année: 'ANN', années: 'ANN', jaar: 'ANN', jahr: 'ANN',
  // mass, volume, length, area
  kg: 'KGM', kilo: 'KGM', g: 'GRM', t: 'TNE', tonne: 'TNE', l: 'LTR', litre: 'LTR', liter: 'LTR',
  m: 'MTR', km: 'KMT', m2: 'MTK', 'm²': 'MTK', m3: 'MTQ', 'm³': 'MTQ',
  // energy
  kwh: 'KWH', mwh: 'MWH',
  // counting
  unit: 'C62', units: 'C62', unité: 'C62', unités: 'C62', eenheid: 'C62', stück: 'C62', stk: 'C62',
  piece: 'H87', pieces: 'H87', pièce: 'H87', pièces: 'H87', pc: 'H87', pcs: 'H87', stuk: 'H87', stuks: 'H87',
  lot: 'LO', set: 'SET', package: 'XPK', colis: 'XPK', pak: 'XPK',
};

/**
 * Returns the UN/ECE code for a unit written in words, passes a three-letter
 * code through, and falls back to `C62` (unit).
 */
export function toUnitCode(unit: string | null | undefined): string {
  if (!unit) return UNIT_CODES.UNIT;
  const key = unit.trim().toLowerCase();
  const mapped = WORDS[key];
  if (mapped) return mapped;
  if (/^[A-Z0-9]{2,3}$/.test(unit.trim())) return unit.trim();
  return UNIT_CODES.UNIT;
}
