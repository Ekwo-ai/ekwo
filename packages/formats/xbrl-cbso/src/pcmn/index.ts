/**
 * Belgian minimum chart of accounts (PCMN / MAR) → reporting codes of the
 * abridged annual accounts, and the arithmetic that turns a trial balance
 * into the `values` expected by the generator.
 *
 * Input convention: `balance` is `debit − credit` for every account, both for
 * the current and the previous year. The functions below apply the sign
 * conventions of the standardised form (liabilities, equity and revenue shown
 * as positive amounts).
 */
import type { BnbCode, YearValues } from '../types.js';
import { roundCurrency } from '../rounding.js';

export interface ReportingLine {
  /** Reporting code, e.g. `"21/28"`. Empty for a heading. */
  code: BnbCode;
  /** French label of the standardised form. */
  label: string;
  /** PCMN account prefixes summed into this line (leaf lines only). */
  accountPrefixes: string[];
  /** Codes summed into this line (subtotal lines only). */
  sumOf?: BnbCode[];
  /** Computed by a formula rather than from accounts or children. */
  computed?: boolean;
  /** Indentation level in the printed form. */
  indent: number;
  style: 'total' | 'section' | 'subsection' | 'category' | 'detail';
}

export interface AccountBalance {
  /** PCMN account number, e.g. `"400000"`. */
  account: string;
  /** Current year, debit − credit. */
  balance: number;
  /** Previous year, debit − credit. */
  priorBalance: number;
}

export interface Pair {
  current: number;
  prior: number;
}

export type Section = 'assets' | 'liabilities' | 'income' | 'appropriation';

const leaf = (code: BnbCode, label: string, accountPrefixes: string[], indent: number, style: ReportingLine['style']): ReportingLine =>
  ({ code, label, accountPrefixes, indent, style });
const subtotal = (code: BnbCode, label: string, sumOf: BnbCode[], indent: number, style: ReportingLine['style']): ReportingLine =>
  ({ code, label, accountPrefixes: [], sumOf, indent, style });
const computed = (code: BnbCode, label: string, indent: number, style: ReportingLine['style']): ReportingLine =>
  ({ code, label, accountPrefixes: [], computed: true, indent, style });

/** Balance sheet after appropriation — assets. */
export const ASSETS: readonly ReportingLine[] = [
  leaf('20', "Frais d'établissement", ['20'], 0, 'section'),
  subtotal('21/28', 'Actifs immobilisés', ['21', '22/27', '28'], 0, 'section'),
  leaf('21', 'Immobilisations incorporelles', ['21'], 1, 'subsection'),
  subtotal('22/27', 'Immobilisations corporelles', ['22', '23', '24', '25', '26', '27'], 1, 'subsection'),
  leaf('22', 'Terrains et constructions', ['22'], 2, 'detail'),
  leaf('23', 'Installations, machines et outillage', ['23'], 2, 'detail'),
  leaf('24', 'Mobilier et matériel roulant', ['24'], 2, 'detail'),
  leaf('25', 'Location-financement et droits similaires', ['25'], 2, 'detail'),
  leaf('26', 'Autres immobilisations corporelles', ['26'], 2, 'detail'),
  leaf('27', 'Immobilisations en cours et acomptes versés', ['27'], 2, 'detail'),
  leaf('28', 'Immobilisations financières', ['28'], 1, 'subsection'),
  subtotal('29/58', 'Actifs circulants', ['29', '3', '40/41', '50/53', '54/58', '490/1'], 0, 'section'),
  leaf('29', "Créances à plus d'un an", ['29'], 1, 'subsection'),
  leaf('290', 'Créances commerciales', ['290'], 2, 'detail'),
  leaf('291', 'Autres créances', ['291'], 2, 'detail'),
  subtotal('3', "Stocks et commandes en cours d'exécution", ['30/36', '37'], 1, 'subsection'),
  leaf('30/36', 'Stocks', ['30', '31', '32', '33', '34', '35', '36'], 2, 'detail'),
  leaf('37', "Commandes en cours d'exécution", ['37'], 2, 'detail'),
  subtotal('40/41', 'Créances à un an au plus', ['40', '41'], 1, 'subsection'),
  leaf('40', 'Créances commerciales', ['40'], 2, 'detail'),
  leaf('41', 'Autres créances', ['41'], 2, 'detail'),
  leaf('50/53', 'Placements de trésorerie', ['50', '51', '52', '53'], 1, 'subsection'),
  leaf('54/58', 'Valeurs disponibles', ['54', '55', '56', '57', '58'], 1, 'subsection'),
  leaf('490/1', 'Comptes de régularisation', ['490', '491'], 1, 'subsection'),
  subtotal('20/58', "Total de l'actif", ['20', '21/28', '29/58'], 0, 'total'),
];

/** Balance sheet after appropriation — equity and liabilities. */
export const LIABILITIES: readonly ReportingLine[] = [
  subtotal('10/15', 'Capitaux propres', ['10/11', '12', '13', '14', '15', '19'], 0, 'section'),
  subtotal('10/11', 'Apport', ['10', '11'], 1, 'subsection'),
  leaf('10', 'Capital', ['10'], 2, 'category'),
  leaf('100', 'Capital souscrit', ['100'], 3, 'detail'),
  leaf('101', 'Capital non appelé', ['101'], 3, 'detail'),
  leaf('11', 'En dehors du capital', ['11'], 2, 'category'),
  leaf('1100/10', "Primes d'émission", ['1100', '1101', '1102', '1103', '1104', '1105', '1106', '1107', '1108', '1110'], 3, 'detail'),
  leaf('1109/19', 'Autres', ['1109', '1119'], 3, 'detail'),
  leaf('12', 'Plus-values de réévaluation', ['12'], 1, 'subsection'),
  subtotal('13', 'Réserves', ['130/1', '132', '133'], 1, 'subsection'),
  subtotal('130/1', 'Réserves indisponibles', ['130', '1311', '1312', '1313', '1319'], 2, 'category'),
  leaf('130', 'Réserve légale', ['130'], 3, 'detail'),
  leaf('1311', 'Réserves statutairement indisponibles', ['1311'], 3, 'detail'),
  leaf('1312', "Acquisition d'actions propres", ['1312'], 3, 'detail'),
  leaf('1313', 'Soutien financier', ['1313'], 3, 'detail'),
  leaf('1319', 'Autres', ['1319'], 3, 'detail'),
  leaf('132', 'Réserves immunisées', ['132'], 2, 'detail'),
  leaf('133', 'Réserves disponibles', ['133'], 2, 'detail'),
  leaf('14', 'Bénéfice (perte) reporté(e)', ['14'], 1, 'subsection'),
  leaf('15', 'Subsides en capital', ['15'], 1, 'subsection'),
  leaf('19', "Avance aux associés sur la répartition de l'actif net", ['19'], 1, 'subsection'),
  subtotal('16', 'Provisions et impôts différés', ['160/5', '168'], 0, 'section'),
  subtotal('160/5', 'Provisions pour risques et charges', ['160', '161', '162', '163', '164/5'], 1, 'subsection'),
  leaf('160', 'Pensions et obligations similaires', ['160'], 2, 'detail'),
  leaf('161', 'Charges fiscales', ['161'], 2, 'detail'),
  leaf('162', 'Grosses réparations et gros entretien', ['162'], 2, 'detail'),
  leaf('163', 'Obligations environnementales', ['163'], 2, 'detail'),
  leaf('164/5', 'Autres risques et charges', ['164', '165'], 2, 'detail'),
  leaf('168', 'Impôts différés', ['168'], 1, 'subsection'),
  subtotal('17/49', 'Dettes', ['17', '42/48', '492/3'], 0, 'section'),
  subtotal('17', "Dettes à plus d'un an", ['170/4', '175', '176', '178/9'], 1, 'subsection'),
  leaf('170/4', 'Dettes financières', ['170', '171', '172', '173', '174'], 2, 'category'),
  leaf('172/3', 'Établissements de crédit, dettes de location-financement et dettes assimilées', ['172', '173'], 3, 'detail'),
  leaf('174/0', 'Autres emprunts', ['174', '170'], 3, 'detail'),
  leaf('175', 'Dettes commerciales', ['175'], 2, 'detail'),
  leaf('176', 'Acomptes sur commandes', ['176'], 2, 'detail'),
  leaf('178/9', 'Autres dettes', ['178', '179'], 2, 'detail'),
  subtotal('42/48', 'Dettes à un an au plus', ['42', '43', '44', '46', '45', '47/48'], 1, 'subsection'),
  leaf('42', "Dettes à plus d'un an échéant dans l'année", ['42'], 2, 'detail'),
  leaf('43', 'Dettes financières', ['43'], 2, 'category'),
  leaf('430/8', 'Établissements de crédit', ['430', '431', '432', '433', '434', '435', '436', '437', '438'], 3, 'detail'),
  leaf('439', 'Autres emprunts', ['439'], 3, 'detail'),
  leaf('44', 'Dettes commerciales', ['44'], 2, 'category'),
  leaf('440/4', 'Fournisseurs', ['440', '441', '442', '443', '444'], 3, 'detail'),
  leaf('441', 'Effets à payer', ['441'], 3, 'detail'),
  leaf('46', 'Acomptes sur commandes', ['46'], 2, 'detail'),
  leaf('45', 'Dettes fiscales, salariales et sociales', ['45'], 2, 'category'),
  leaf('450/3', 'Impôts', ['450', '451', '452', '453'], 3, 'detail'),
  leaf('454/9', 'Rémunérations et charges sociales', ['454', '455', '456', '457', '458', '459'], 3, 'detail'),
  leaf('47/48', 'Autres dettes', ['47', '48'], 2, 'detail'),
  leaf('492/3', 'Comptes de régularisation', ['492', '493'], 1, 'subsection'),
  subtotal('10/49', 'Total du passif', ['10/15', '16', '17/49'], 0, 'total'),
];

/** Income statement (abridged: starts at gross margin). */
export const INCOME_STATEMENT: readonly ReportingLine[] = [
  computed('9900', 'Marge brute', 1, 'subsection'),
  leaf('70', "Chiffre d'affaires", ['70'], 2, 'detail'),
  leaf('60/61', 'Approvisionnements, marchandises, services et biens divers', ['60', '61'], 2, 'detail'),
  leaf('62', 'Rémunérations, charges sociales et pensions', ['62'], 1, 'subsection'),
  leaf('630', "Amortissements et réductions de valeur sur frais d'établissement, sur immobilisations incorporelles et corporelles", ['630'], 1, 'subsection'),
  leaf('631/4', "Réductions de valeur sur stocks, sur commandes en cours d'exécution et sur créances commerciales", ['631', '632', '633', '634'], 1, 'subsection'),
  leaf('635/8', 'Provisions pour risques et charges', ['635', '636', '637', '638'], 1, 'subsection'),
  leaf('640/8', "Autres charges d'exploitation", ['640', '641', '642', '643', '644', '645', '646', '647', '648'], 1, 'subsection'),
  leaf('649', "Charges d'exploitation portées à l'actif au titre de frais de restructuration", ['649'], 1, 'subsection'),
  computed('9901', "Bénéfice (perte) d'exploitation", 0, 'section'),
  subtotal('75/76B', 'Produits financiers', ['75', '76B'], 1, 'subsection'),
  leaf('75', 'Produits financiers récurrents', ['75'], 2, 'detail'),
  leaf('753', 'Dont : subsides en capital et en intérêts', ['753'], 3, 'detail'),
  leaf('76B', 'Produits financiers non récurrents', ['76'], 2, 'detail'),
  subtotal('65/66B', 'Charges financières', ['65', '66B'], 1, 'subsection'),
  leaf('65', 'Charges financières récurrentes', ['65'], 2, 'detail'),
  leaf('66B', 'Charges financières non récurrentes', ['66'], 2, 'detail'),
  computed('9903', "Bénéfice (perte) de l'exercice avant impôts", 0, 'section'),
  leaf('780', 'Prélèvement sur les impôts différés', ['780'], 1, 'detail'),
  leaf('680', 'Transfert aux impôts différés', ['680'], 1, 'detail'),
  leaf('67/77', 'Impôts sur le résultat', ['67', '77'], 1, 'subsection'),
  computed('9904', "Bénéfice (perte) de l'exercice", 0, 'section'),
  leaf('789', 'Prélèvement sur les réserves immunisées', ['789'], 1, 'detail'),
  leaf('689', 'Transfert aux réserves immunisées', ['689'], 1, 'detail'),
  computed('9905', "Bénéfice (perte) de l'exercice à affecter", 0, 'total'),
];

/** Appropriation of the result. */
export const APPROPRIATION: readonly ReportingLine[] = [
  computed('9906', 'Bénéfice (perte) à affecter', 0, 'section'),
  computed('14P', "Bénéfice (perte) reporté(e) de l'exercice précédent", 1, 'detail'),
  leaf('791/2', 'Prélèvement sur les capitaux propres', ['791', '792'], 0, 'subsection'),
  subtotal('691/2', 'Affectation aux capitaux propres', ['691', '6920', '6921'], 0, 'subsection'),
  leaf('691', "À l'apport", ['691'], 1, 'detail'),
  leaf('6920', 'À la réserve légale', ['6920'], 1, 'detail'),
  leaf('6921', 'Aux autres réserves', ['6921'], 1, 'detail'),
  leaf('794', 'Intervention des associés dans la perte', ['794'], 0, 'subsection'),
  subtotal('694/7', 'Bénéfice à distribuer', ['694', '695', '696', '697'], 0, 'subsection'),
  leaf('694', "Rémunération de l'apport", ['694'], 1, 'detail'),
  leaf('695', 'Administrateurs ou gérants', ['695'], 1, 'detail'),
  leaf('696', 'Travailleurs', ['696'], 1, 'detail'),
  leaf('697', 'Autres allocataires', ['697'], 1, 'detail'),
];

function sumByPrefix(accounts: readonly AccountBalance[], prefixes: readonly string[], negate = false): Pair {
  let current = 0;
  let prior = 0;
  for (const acc of accounts) {
    if (prefixes.some((p) => acc.account.startsWith(p))) {
      current += acc.balance;
      prior += acc.priorBalance;
    }
  }
  return negate ? { current: neg(current), prior: neg(prior) } : { current, prior };
}

/** Negation that never yields `-0`. */
function neg(x: number): number {
  return x === 0 ? 0 : -x;
}

function resolveSubtotals(lines: readonly ReportingLine[], values: Map<BnbCode, Pair>): void {
  // Iterate until stable: handles chains such as 20/58 → 21/28 → 22/27.
  let changed = true;
  let guard = lines.length;
  while (changed && guard-- > 0) {
    changed = false;
    for (const line of lines) {
      if (!line.sumOf || values.has(line.code)) continue;
      if (!line.sumOf.every((c) => values.has(c))) continue;
      const total = line.sumOf.reduce(
        (acc, c) => {
          const v = values.get(c) as Pair;
          return { current: acc.current + v.current, prior: acc.prior + v.prior };
        },
        { current: 0, prior: 0 },
      );
      values.set(line.code, total);
      changed = true;
    }
  }
}

/**
 * Balance sheet side from a trial balance. Liabilities and equity are
 * negated so that credit balances read as positive amounts.
 */
export function computeBalanceSheet(
  side: 'assets' | 'liabilities',
  accounts: readonly AccountBalance[],
): Map<BnbCode, Pair> {
  const lines = side === 'assets' ? ASSETS : LIABILITIES;
  const values = new Map<BnbCode, Pair>();
  for (const line of lines) {
    if (line.sumOf || line.computed || line.accountPrefixes.length === 0) continue;
    values.set(line.code, sumByPrefix(accounts, line.accountPrefixes, side === 'liabilities'));
  }
  resolveSubtotals(lines, values);
  return values;
}

/** Income statement from a trial balance, including the computed results. */
export function computeIncomeStatement(accounts: readonly AccountBalance[]): Map<BnbCode, Pair> {
  const v = new Map<BnbCode, Pair>();
  const revenue = (prefixes: string[]) => sumByPrefix(accounts, prefixes, true);
  const expense = (prefixes: string[]) => sumByPrefix(accounts, prefixes);
  const add = (...pairs: Array<Pair | { negate: Pair }>): Pair =>
    pairs.reduce<Pair>(
      (acc, p) =>
        'negate' in p
          ? { current: acc.current - p.negate.current, prior: acc.prior - p.negate.prior }
          : { current: acc.current + p.current, prior: acc.prior + p.prior },
      { current: 0, prior: 0 },
    );
  const not = (p: Pair) => ({ negate: p });

  const turnover = revenue(['70']);
  v.set('70', turnover);
  const supplies = expense(['60', '61']);
  v.set('60/61', supplies);
  // Gross margin = 70 + 71 + 72 + 74 − 60/61
  const grossMargin = add(turnover, revenue(['71']), revenue(['72']), revenue(['74']), not(supplies));
  v.set('9900', grossMargin);

  v.set('62', expense(['62']));
  v.set('630', expense(['630']));
  v.set('631/4', expense(['631', '632', '633', '634']));
  v.set('635/8', expense(['635', '636', '637', '638']));
  v.set('640/8', expense(['640', '641', '642', '643', '644', '645', '646', '647', '648']));
  v.set('649', expense(['649']));
  const operating = add(
    grossMargin,
    not(v.get('62') as Pair),
    not(v.get('630') as Pair),
    not(v.get('631/4') as Pair),
    not(v.get('635/8') as Pair),
    not(v.get('640/8') as Pair),
    v.get('649') as Pair,
  );
  v.set('9901', operating);

  v.set('75', revenue(['75']));
  v.set('753', revenue(['753']));
  v.set('76B', revenue(['76']));
  v.set('75/76B', add(v.get('75') as Pair, v.get('76B') as Pair));
  v.set('65', expense(['65']));
  v.set('66B', expense(['66']));
  v.set('65/66B', add(v.get('65') as Pair, v.get('66B') as Pair));
  const beforeTax = add(operating, v.get('75/76B') as Pair, not(v.get('65/66B') as Pair));
  v.set('9903', beforeTax);

  v.set('780', revenue(['780']));
  v.set('680', expense(['680']));
  v.set('67/77', expense(['67', '77']));
  const result = add(beforeTax, v.get('780') as Pair, not(v.get('680') as Pair), not(v.get('67/77') as Pair));
  v.set('9904', result);

  v.set('789', revenue(['789']));
  v.set('689', expense(['689']));
  v.set('9905', add(result, v.get('789') as Pair, not(v.get('689') as Pair)));
  return v;
}

/**
 * Appropriation from a trial balance. Needs the income statement for `9905`.
 * `14P` (result carried forward from the previous year) is read from the
 * previous-year balance of account 14.
 */
export function computeAppropriation(
  accounts: readonly AccountBalance[],
  incomeStatement: ReadonlyMap<BnbCode, Pair>,
): Map<BnbCode, Pair> {
  const v = new Map<BnbCode, Pair>();
  const toAppropriate = incomeStatement.get('9905') ?? { current: 0, prior: 0 };
  const carried = sumByPrefix(accounts, ['14'], true);
  v.set('14P', { current: carried.prior, prior: 0 });
  v.set('9906', { current: toAppropriate.current + carried.prior, prior: toAppropriate.prior });
  for (const line of APPROPRIATION) {
    if (line.sumOf || line.computed || line.accountPrefixes.length === 0) continue;
    v.set(line.code, sumByPrefix(accounts, line.accountPrefixes));
  }
  resolveSubtotals(APPROPRIATION, v);
  return v;
}

/**
 * Everything at once: the four sections from one trial balance, merged into
 * the `values` shape expected by the generator (amounts rounded to the cent).
 */
export function valuesFromTrialBalance(accounts: readonly AccountBalance[]): Record<BnbCode, YearValues> {
  const income = computeIncomeStatement(accounts);
  return mergeSections(
    computeBalanceSheet('assets', accounts),
    computeBalanceSheet('liabilities', accounts),
    income,
    computeAppropriation(accounts, income),
  );
}

/** Merges section maps into generator values; later sections win on conflicts. */
export function mergeSections(...sections: ReadonlyMap<BnbCode, Pair>[]): Record<BnbCode, YearValues> {
  const values: Record<BnbCode, YearValues> = {};
  for (const section of sections) {
    for (const [code, pair] of section) {
      values[code] = { n: round2(pair.current), p: round2(pair.prior) };
    }
  }
  return values;
}

/** The one rounding rule, at two decimals. See `../rounding.ts`. */
function round2(v: number): number {
  return roundCurrency(v, 2);
}
