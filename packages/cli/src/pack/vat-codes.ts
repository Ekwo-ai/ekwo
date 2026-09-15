/**
 * What a treatment obliges a tax to say on an invoice.
 *
 * A tax carries three things that are three tellings of one fact: its
 * `treatment`, which is Ekwo's own word for what the operation is; its
 * `vat_category`, which is BT-118 and BT-151 of EN 16931, taken from the
 * UNCL5305 subset the standard publishes; and its `exemption_code`, which is
 * BT-121, taken from the VATEX list. Nothing until now compared them, so a
 * pack could declare an export taxed at the standard rate, or an
 * intra-Community supply with the reverse-charge reason code, and every test
 * in the repository would pass — because neither column is read by the ledger
 * or by the declaration. They are read by whoever renders the invoice, which
 * is the one reader that is not in this repository.
 *
 * The tables below are transcribed, not decided. Three sources say all of it:
 *
 * - **UNCL5305 (UN/CEFACT D.16B, OpenPEPPOL subset)** for what each category
 *   code means. `K` is *VAT exempt for EEA intra-community supply of goods and
 *   services* — goods **and services**, which is what settles the question the
 *   Ekwo vocabulary asks twice; `AE` is *VAT reverse charge*; `G` is *free
 *   export item, VAT not charged*; `O` is *services outside scope of tax*.
 * - **Technical guidance for tax codes in EN 16931, version 1** (European
 *   Commission, Technical Advisory Group on Electronic Invoicing, use cases
 *   dated 1 July 2024), whose six use cases give the pair to use for each
 *   case: exemption in general `E` + a VATEX code, intra-Community supply
 *   between Member States `K` + `VATEX-EU-IC`, reverse charge **within** a
 *   Member State `AE` + `VATEX-EU-AE`, export outside the Union `G` +
 *   `VATEX-EU-G`.
 * - **The VATEX code list itself**, which carries the pairing as a remark on
 *   eight of its codes: `VATEX-EU-AE` *only use with category code AE*,
 *   `VATEX-EU-IC` with `K`, `VATEX-EU-G` with `G`, `VATEX-EU-O` with `O`, and
 *   `VATEX-EU-D`, `-F`, `-I`, `-J` with `E`.
 *
 * Two decisions were taken where the sources leave a choice, and both are
 * written up in `docs/packs.md`.
 *
 * **A category is a term of the invoice, so on a purchase it is the
 * supplier's.** An Ekwo purchase tax describes how the buyer books and
 * declares somebody else's invoice; BT-151 on that invoice was chosen by the
 * seller. An intra-Community acquisition is therefore `K`, because the
 * supplier made an intra-Community supply and rule BR-IC-10 binds them to `K`
 * and `VATEX-EU-IC` — not `AE`, which is the guidance's case for a reverse
 * charge *within* one Member State. A pack that does not want to record the
 * seller's category may leave it null on a purchase-only tax; a value that
 * contradicts the treatment is refused either way.
 *
 * **Where no invoice governed by the standard exists, the category is
 * absent.** An import of goods is assessed on a customs document, and a
 * service received from a supplier the Union's rules do not reach comes on an
 * invoice the Directive does not govern. There is no seller's category to
 * record, so `import` and `foreign_services_received` carry none: `S` there
 * would claim the supplier levied the standard rate, which is the one thing
 * that certainly did not happen.
 *
 * The rate is checked on the sale side only. On a sale the pack's `rate` is
 * the BT-152 the seller prints, and the business rules of EN 16931 fix it per
 * category — BR-S-05 wants a standard-rated line above zero, BR-Z-05,
 * BR-E-05, BR-AE-05, BR-IC-05, BR-G-05 and BR-O-05 want zero everywhere else.
 * On a purchase the rate is the one the buyer self-assesses at, which is
 * 21 % on a line the supplier invoiced at zero, so the same rule applied there
 * would refuse every reverse charge in every pack.
 *
 * What this does **not** do is hold a copy of the VATEX list. The list grows,
 * two published renderings of it already disagree on which codes it holds, and
 * a code this file has not heard of is not a contradiction — it is a code this
 * file has not heard of. So an exemption code is checked for its shape, and
 * for the pairings the list itself states.
 */

/** A source, quoted in the refusal so a reader can go and check it. */
const UNCL5305 = 'UNCL5305, the VAT category codes of EN 16931 (UN/CEFACT D.16B)';
const GUIDANCE = 'Technical guidance for tax codes in EN 16931, version 1';
const VATEX_LIST = 'the VATEX code list of EN 16931';

/** What one treatment may be declared on, and what its invoice may say. */
export interface TreatmentCodes {
  /**
   * The sides of a document the treatment exists on. A tax whose `scope` is
   * `both` is never refused here: `both` says the pack has not narrowed it.
   */
  scopes: ('sale' | 'purchase')[];
  /**
   * The categories the invoice may carry. Empty where no invoice governed by
   * EN 16931 exists, in which case the column has to stay null.
   */
  categories: string[];
  /** Why, in the words of the source, for the message. */
  because: string;
}

/**
 * Treatment to category, keyed by the values of the `tax_treatment` enum.
 *
 * A treatment missing from here is a gap the check cannot see, so
 * `tests/vat_codes.test.ts` asks the database for the enum and refuses a
 * value this table does not cover.
 */
export const TREATMENT_CODES: Record<string, TreatmentCodes> = {
  domestic: {
    scopes: ['sale', 'purchase'],
    categories: ['S', 'Z'],
    because: `a taxed supply is S at a rate above zero and Z at a rate of zero (${UNCL5305})`,
  },
  domestic_reverse_charge: {
    scopes: ['sale', 'purchase'],
    categories: ['AE'],
    because: `a reverse charge within one Member State is AE (${GUIDANCE}, use case 3)`,
  },
  intracom_goods: {
    scopes: ['sale'],
    categories: ['K'],
    because: `an intra-Community supply is K (${GUIDANCE}, use case 2, and rule BR-IC-10)`,
  },
  intracom_services: {
    scopes: ['sale'],
    categories: ['K'],
    because:
      `K is VAT exempt for EEA intra-community supply of goods and services (${UNCL5305}); ` +
      `AE is the case of a reverse charge within one Member State (${GUIDANCE}, use case 3)`,
  },
  intracom_acquisition_goods: {
    scopes: ['purchase'],
    categories: ['K'],
    because:
      'a category is a term of the invoice, and the supplier of an intra-Community acquisition ' +
      `made an intra-Community supply, which is K (${GUIDANCE}, use case 2)`,
  },
  intracom_acquisition_services: {
    scopes: ['purchase'],
    categories: ['K'],
    because:
      'a category is a term of the invoice, and a supplier established in another Member State ' +
      `invoices a supply of services as K (${UNCL5305}, which names services)`,
  },
  foreign_services_received: {
    scopes: ['purchase'],
    categories: [],
    because:
      'the supplier is not established here and their invoice is not governed by EN 16931, ' +
      'so there is no category of theirs to record',
  },
  export: {
    scopes: ['sale'],
    categories: ['G'],
    because: `an export outside the Union is G (${GUIDANCE}, use case 4)`,
  },
  import: {
    scopes: ['purchase'],
    categories: [],
    because:
      'import tax is assessed on a customs document and not on an invoice governed by EN 16931, ' +
      'so there is no category of the supplier to record',
  },
  exempt: {
    scopes: ['sale', 'purchase'],
    categories: ['E'],
    because: `an exemption is E with the article that grants it as the reason (${GUIDANCE}, use case 1)`,
  },
  not_subject: {
    scopes: ['sale', 'purchase'],
    categories: ['O'],
    because: `something outside the scope of the tax is O (${UNCL5305})`,
  },
};

/** What a category obliges the exemption reason to be. */
interface CategoryCodes {
  /** The one code the VATEX list reserves for this category, where it does. */
  exemption: string | null;
  /** A reason is required. False where the line is taxed and has none. */
  needsReason: boolean;
  /** The rate a sale of this category carries: above zero, or exactly zero. */
  rate: 'positive' | 'zero';
  /** The business rule of EN 16931 that fixes the rate. */
  rateRule: string;
}

/**
 * Category to exemption reason and to rate.
 *
 * The four reserved codes are the pairings the VATEX list publishes as a
 * remark on the code itself. `E` takes any other reason, because the whole
 * point of the general case is that the seller picks the article.
 */
export const CATEGORY_CODES: Record<string, CategoryCodes> = {
  S: { exemption: null, needsReason: false, rate: 'positive', rateRule: 'BR-S-05' },
  Z: { exemption: null, needsReason: false, rate: 'zero', rateRule: 'BR-Z-05' },
  E: { exemption: null, needsReason: true, rate: 'zero', rateRule: 'BR-E-05' },
  AE: { exemption: 'VATEX-EU-AE', needsReason: true, rate: 'zero', rateRule: 'BR-AE-05' },
  K: { exemption: 'VATEX-EU-IC', needsReason: true, rate: 'zero', rateRule: 'BR-IC-05' },
  G: { exemption: 'VATEX-EU-G', needsReason: true, rate: 'zero', rateRule: 'BR-G-05' },
  O: { exemption: 'VATEX-EU-O', needsReason: true, rate: 'zero', rateRule: 'BR-O-05' },
};

/**
 * A reason code of the VATEX list: the Union's own codes, and the national
 * ones a Member State publishes beside them.
 *
 * The shape, and not the membership. A national list grows without this
 * repository hearing of it, and the core has no business holding one country's
 * codes anyway.
 */
const EXEMPTION_SHAPE = /^VATEX-(?:EU|[A-Z]{2})-[0-9A-Z][0-9A-Z-]*$/;

/** The categories another category's reserved code may not be borrowed by. */
const RESERVED: Map<string, string> = new Map(
  Object.entries(CATEGORY_CODES)
    .filter(([, codes]) => codes.exemption !== null)
    .map(([category, codes]) => [codes.exemption as string, category]),
);

/** One tax, as much of it as this check reads. */
export interface TaxCodes {
  code: string;
  scope: string;
  amount_type: string;
  rate: number;
  treatment: string;
  vat_category: string | null;
  exemption_code: string | null;
}

/** A problem, in the shape `readPack` collects. */
export interface CodeIssue {
  path: string;
  message: string;
}

/**
 * Whether a tax of this scope can end up on an invoice the company issues.
 *
 * `both` counts: a tax offered on both sides will be put on a sale one day,
 * and that is the day BT-151 has to be there and has to be right.
 */
function isSale(scope: string): boolean {
  return scope === 'sale' || scope === 'both';
}

/**
 * The taxes of a pack, against the three code lists.
 *
 * Every refusal names the tax, the treatment, what the tax says, what the
 * source says instead, and the source. A pack author who has never read
 * EN 16931 should be able to fix the line from the message alone.
 */
export function taxCodes(taxes: TaxCodes[]): CodeIssue[] {
  const issues: CodeIssue[] = [];

  for (const tax of taxes) {
    const where = `taxes.json ${tax.code}`;
    const expected = TREATMENT_CODES[tax.treatment];
    if (expected === undefined) continue; // the schema already refused the value

    // The side. A treatment that exists on one side only, declared on the
    // other, is a pack saying two different things about one operation.
    if (tax.scope !== 'both' && !expected.scopes.includes(tax.scope as 'sale' | 'purchase')) {
      issues.push({
        path: where,
        message:
          `treatment ${tax.treatment} is a ${expected.scopes.join(' or ')} operation, ` +
          `and this tax has scope ${tax.scope}`,
      });
      continue;
    }

    const category = tax.vat_category;

    // No invoice under the standard means no category. Saying one is claiming
    // something about a document nobody governed.
    if (expected.categories.length === 0) {
      if (category !== null) {
        issues.push({
          path: where,
          message:
            `treatment ${tax.treatment} carries vat_category ${category}; it carries none, because ` +
            `${expected.because}`,
        });
      }
      if (tax.exemption_code !== null) {
        issues.push({
          path: where,
          message:
            `treatment ${tax.treatment} carries exemption_code ${tax.exemption_code}; it carries ` +
            `none, because ${expected.because}`,
        });
      }
      continue;
    }

    if (category === null) {
      // Required on anything that can reach an invoice this company issues;
      // optional on a purchase-only tax, where it is the seller's answer and
      // the pack may simply not record it.
      if (isSale(tax.scope)) {
        issues.push({
          path: where,
          message:
            `treatment ${tax.treatment} names no vat_category; an invoice carries BT-151, and ` +
            `${expected.because}`,
        });
      }
      if (tax.exemption_code !== null) {
        issues.push({
          path: where,
          message: `exemption_code ${tax.exemption_code} with no vat_category to belong to`,
        });
      }
      continue;
    }

    if (!expected.categories.includes(category)) {
      issues.push({
        path: where,
        message:
          `treatment ${tax.treatment} carries vat_category ${category}; expected ` +
          `${expected.categories.join(' or ')}, because ${expected.because}`,
      });
      continue;
    }

    const rules = CATEGORY_CODES[category];
    if (rules === undefined) continue;

    // The reason code, its shape, and the pairing the VATEX list publishes.
    const reason = tax.exemption_code;
    if (reason === null) {
      if (rules.needsReason) {
        issues.push({
          path: where,
          message:
            `vat_category ${category} names no exemption_code; ` +
            (rules.exemption === null
              ? `an exempt line states the article it is exempt under (${GUIDANCE}, use case 1)`
              : `${VATEX_LIST} reserves ${rules.exemption} for category ${category}`),
        });
      }
    } else if (!rules.needsReason) {
      issues.push({
        path: where,
        message:
          `vat_category ${category} carries exemption_code ${reason}; a line that is taxed is ` +
          'exempt under nothing',
      });
    } else if (!EXEMPTION_SHAPE.test(reason)) {
      issues.push({
        path: where,
        message:
          `exemption_code ${reason} is not a VATEX code; ${VATEX_LIST} writes them ` +
          'VATEX-EU-<article> and VATEX-<country>-<article>',
      });
    } else if (rules.exemption !== null && reason !== rules.exemption) {
      issues.push({
        path: where,
        message:
          `vat_category ${category} carries exemption_code ${reason}; ${VATEX_LIST} reserves ` +
          `${rules.exemption} for it`,
      });
    } else if (rules.exemption === null && RESERVED.has(reason)) {
      issues.push({
        path: where,
        message:
          `exemption_code ${reason} on category ${category}; ${VATEX_LIST} says to use it only ` +
          `with category ${RESERVED.get(reason) as string}`,
      });
    }

    // The rate, where the pack's rate is the one the seller prints.
    if (isSale(tax.scope) && tax.amount_type === 'percent') {
      if (rules.rate === 'positive' && !(tax.rate > 0)) {
        issues.push({
          path: where,
          message: `vat_category ${category} at a rate of ${tax.rate}; ${rules.rateRule} wants a rate above zero`,
        });
      }
      if (rules.rate === 'zero' && tax.rate !== 0) {
        issues.push({
          path: where,
          message: `vat_category ${category} at a rate of ${tax.rate}; ${rules.rateRule} wants a rate of zero`,
        });
      }
    }
  }

  return issues;
}
