/**
 * What a treatment obliges a tax to say on an invoice, and where.
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
 *   Member State `AE` + `VATEX-EU-AE`, and the case it calls export outside the
 *   Union `G` + `VATEX-EU-G` — which is the Union's border because the seller
 *   the guidance addresses is established in a Member State. What UNCL5305
 *   itself says of `G` is *free export item, VAT not charged*: the goods leave
 *   the territory of whoever levies the tax.
 * - **The VATEX code list itself**, which carries the pairing as a remark on
 *   eight of its codes: `VATEX-EU-AE` *only use with category code AE*,
 *   `VATEX-EU-IC` with `K`, `VATEX-EU-G` with `G`, `VATEX-EU-O` with `O`, and
 *   `VATEX-EU-D`, `-F`, `-I`, `-J` with `E`.
 *
 * Four decisions were taken where the sources leave a choice, and all four are
 * written up in `docs/packs.md`.
 *
 * **The table above is the Union's, and it applies where the Union's VAT
 * does.** EN 16931 is a European standard and the VATEX list is published by
 * the European Commission: its own codes name articles of Directive
 * 2006/112/EC and its national codes belong to Member States that publish
 * them. A pack for a country the common system does not reach may therefore
 * carry no code from it — `VATEX-EU-G` on an export from a third country
 * claims an article of the Directive that does not bind the seller — and what
 * an exempt line states there is its own article, in `legal_reference`, with
 * BT-121 left empty. The categories are unaffected: UNCL5305 is a UN/CEFACT
 * list, `E`, `G`, `O` and `AE` keep their meanings, and a pack outside the
 * Union goes on being held to them. The treatments of the common system
 * itself — the five `intracom_*` values — are refused there outright, because
 * an intra-Community supply is an operation of a system the country is not in.
 * Whether it is in it is not a fact this file holds: it is a row of
 * `territories`, read through `./territories.js`, on the day the pack's
 * manifest says it speaks of.
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
 * **A triangular supply is `K`, not `AE`.** The guidance gives `AE` for a
 * reverse charge *within* one Member State, where the supplier is established
 * in the buyer's country and national law moves the liability. The middle
 * supply of a triangular arrangement is the opposite shape: the goods leave
 * the seller's State, article 141 of Directive 2006/112/EC relieves the seller
 * of registering where they arrive, and article 197 puts the tax on a customer
 * in a third State. What the line is, in the words of UNCL5305, is *VAT exempt
 * for EEA intra-community supply of goods and services* — `K`, with
 * `VATEX-EU-IC`, which the VATEX list reserves for it. That the *sentence* on
 * that invoice is the reverse-charge one is a different question in a different
 * vocabulary, and it is answered by `applies_when`.
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
 *
 * The same limit applies to the other end. No country outside the Union
 * publishes a list of exemption reason codes today; one may, and PINT is where
 * it would surface. So the field is provided for and the content is not: a pack
 * outside the common system may carry a reason code that is not a VATEX one,
 * on the condition that its register declares a published list — an entry of
 * `certification.sources` whose `kind` is `standard`. What is checked is that a
 * list is named, not that the code is in it, which is exactly what is checked
 * of a VATEX code inside the Union.
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
  /**
   * True where the treatment is an operation of the common system of VAT and
   * exists nowhere else — the five `intracom_*` values, which name a supply
   * between two Member States. A pack for a country the system does not reach
   * is refused one of these before anything else about it is looked at.
   */
  commonSystem?: true;
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
    commonSystem: true,
    scopes: ['sale'],
    categories: ['K'],
    because: `an intra-Community supply is K (${GUIDANCE}, use case 2, and rule BR-IC-10)`,
  },
  intracom_services: {
    commonSystem: true,
    scopes: ['sale'],
    categories: ['K'],
    because:
      `K is VAT exempt for EEA intra-community supply of goods and services (${UNCL5305}); ` +
      `AE is the case of a reverse charge within one Member State (${GUIDANCE}, use case 3)`,
  },
  intracom_triangular: {
    commonSystem: true,
    scopes: ['sale'],
    categories: ['K'],
    because:
      'the middle supply of a triangular arrangement is an exempt supply of goods between two ' +
      `Member States, which is what K names — VAT exempt for EEA intra-community supply (${UNCL5305}); ` +
      `AE is reserved for a reverse charge within one Member State (${GUIDANCE}, use case 3), and this ` +
      "one is not: the goods leave the seller's State and article 197 of Directive 2006/112/EC puts " +
      'the tax on a customer in a third',
  },
  intracom_acquisition_goods: {
    commonSystem: true,
    scopes: ['purchase'],
    categories: ['K'],
    because:
      'a category is a term of the invoice, and the supplier of an intra-Community acquisition ' +
      `made an intra-Community supply, which is K (${GUIDANCE}, use case 2)`,
  },
  intracom_acquisition_services: {
    commonSystem: true,
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
    because:
      `G is free export item, VAT not charged (${UNCL5305}) — goods leaving the territory of ` +
      `whoever levies the tax, which for a seller in a Member State is the Union's border ` +
      `(${GUIDANCE}, use case 4) and for a seller outside it is that country's own`,
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

/**
 * Anything that looks like a code rather than a sentence.
 *
 * All that can be said about a reason code from a list nobody has published
 * yet. It keeps `legal_reference` and `exemption_code` from being written into
 * each other, which is the mistake this column actually attracts.
 */
const CODE_SHAPE = /^[0-9A-Z][0-9A-Z._/-]*$/;

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
  /**
   * The article the tax claims. Outside the common system it is what an exempt
   * line has instead of a reason code, so the check reads it there.
   */
  legal_reference?: string | null;
}

/**
 * Which VAT a pack's country levies, as far as these three lists are concerned.
 *
 * Resolved by the caller, because the answer is a row of `territories` and a
 * date out of the manifest, and neither belongs in a table of code lists.
 * `because` is quoted verbatim in every refusal that turns on it, so a reader
 * of the message is told the country, the day and the scope rather than being
 * left to guess why a code they read in the standard was refused.
 */
export interface VatRegime {
  /** Whether the common system of VAT reached the country on the day the pack speaks of. */
  commonSystem: boolean;
  /** Said in the words of the table, for the message. */
  because: string;
  /**
   * The published list of reason codes the pack's register declares — the
   * title of an entry of `certification.sources` whose `kind` is `standard`.
   * Null where it declares none, which outside the Union means BT-121 has no
   * list to come from and stays empty.
   */
  reasonList: string | null;
}

/**
 * The regime every pack was held to until a country outside the Union arrived.
 *
 * The default of `taxCodes`, so that a caller with no opinion gets the table as
 * the European Commission publishes it. `readPack` always has an opinion.
 */
export const COMMON_SYSTEM: VatRegime = {
  commonSystem: true,
  because: 'the common system of VAT applies here',
  reasonList: null,
};

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
 * What BT-121 may say on a tax of a country the common system does not reach.
 *
 * Three answers, and the first is the one every pack will use: nothing, with
 * the article in `legal_reference`. The second is a VATEX code, which is
 * refused by name — the list belongs to a system this country is not in. The
 * third is a code from some other published list, which is provided for and
 * has no content yet: it is accepted where the pack's register declares the
 * list, and refused with the way to declare it where it does not.
 */
function reasonOutside(
  where: string,
  category: string,
  rules: CategoryCodes,
  tax: TaxCodes,
  regime: VatRegime,
): CodeIssue[] {
  const reason = tax.exemption_code;

  if (reason === null) {
    // The article is what the invoice states, so it has to be there.
    const article = (tax.legal_reference ?? '').trim();
    if (rules.needsReason && article === '') {
      return [
        {
          path: where,
          message:
            `vat_category ${category} names no exemption_code and no legal_reference; ` +
            `${regime.because}, so ${VATEX_LIST} does not reach this tax and the article it is ` +
            'exempt under is what the invoice has instead',
        },
      ];
    }
    return [];
  }

  if (!rules.needsReason) {
    return [
      {
        path: where,
        message:
          `vat_category ${category} carries exemption_code ${reason}; a line that is taxed is ` +
          'exempt under nothing',
      },
    ];
  }

  if (reason.startsWith('VATEX-')) {
    return [
      {
        path: where,
        message:
          `exemption_code ${reason} is a code of ${VATEX_LIST}, whose codes name articles of ` +
          'Directive 2006/112/EC and whose national codes are published by Member States; ' +
          `${regime.because}. State the article in legal_reference and leave exemption_code null`,
      },
    ];
  }

  if (regime.reasonList === null) {
    return [
      {
        path: where,
        message:
          `exemption_code ${reason} comes from no list this pack names; ${regime.because}, so ` +
          'BT-121 has no code list here. Either state the article in legal_reference and leave ' +
          'exemption_code null, or declare the list this code belongs to in ' +
          'certification.sources with kind standard',
      },
    ];
  }

  if (!CODE_SHAPE.test(reason)) {
    return [
      {
        path: where,
        message:
          `exemption_code ${reason} is not a code; ${regime.reasonList} publishes codes, and the ` +
          'article an exemption is granted by belongs in legal_reference',
      },
    ];
  }

  return [];
}

/**
 * The taxes of a pack, against the three code lists.
 *
 * Every refusal names the tax, the treatment, what the tax says, what the
 * source says instead, and the source. A pack author who has never read
 * EN 16931 should be able to fix the line from the message alone.
 *
 * `regime` says whether the Union's own lists reach this pack at all. It
 * defaults to the case every pack was in before a third country arrived.
 */
export function taxCodes(taxes: TaxCodes[], regime: VatRegime = COMMON_SYSTEM): CodeIssue[] {
  const issues: CodeIssue[] = [];

  for (const tax of taxes) {
    const where = `taxes.json ${tax.code}`;
    const expected = TREATMENT_CODES[tax.treatment];
    if (expected === undefined) continue; // the schema already refused the value

    // An operation of the common system, in a country the system does not
    // reach. Before anything else: what the invoice says about a supply that
    // cannot happen is not the interesting half of the mistake.
    if (expected.commonSystem === true && !regime.commonSystem) {
      issues.push({
        path: where,
        message:
          `treatment ${tax.treatment} is an operation of the common system of VAT — a supply ` +
          `between two Member States under Directive 2006/112/EC — and ${regime.because}`,
      });
      continue;
    }

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

    // The reason code, its shape, and the pairing the VATEX list publishes —
    // where that list is the one this country's invoices are written against.
    const reason = tax.exemption_code;
    if (!regime.commonSystem) {
      issues.push(...reasonOutside(where, category, rules, tax, regime));
    } else if (reason === null) {
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
