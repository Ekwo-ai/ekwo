/**
 * A tax tells one fact in three code lists, and this is what compares them.
 *
 * `treatment` is Ekwo's word for what an operation is, `vat_category` is
 * BT-118 and BT-151 of EN 16931, and `exemption_code` is BT-121 from the
 * VATEX list. The ledger reads none of the last two, so until `ekwo pack
 * check` learned the correspondence nothing in this repository would have
 * noticed an export taxed at the standard rate.
 *
 * Four claims, and none of them names a country:
 *
 *   1. the vocabulary is the same list in the three places that write it down
 *      — the Postgres enum, the TypeScript constant and the pack schema — in
 *      the same order, so a value added to one and forgotten in the others
 *      fails here rather than narrowing what a pack may say;
 *   2. every value of it is covered by the correspondence table, so a
 *      treatment nobody wrote a rule for cannot slip through the check;
 *   3. every pack of this repository satisfies the correspondence, which is
 *      what `readPack` already enforces and what this states as a claim;
 *   4. the check actually refuses each way of contradicting it, asked of a
 *      copy of a pack broken on purpose.
 *
 * Two of the three lists are the Union's, so a fifth claim was added when a
 * country outside it arrived: that the CLI reads where the common system
 * applies from the same seed the database does, and gets the same answer as
 * `eu_vat_scope_of()` for every territory on every day the table names.
 */

import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CATEGORY_CODES,
  COMMON_SYSTEM,
  TREATMENT_CODES,
  euVatScopeOf,
  readSchema,
  readTerritories,
  repoRootDir,
  territoryOf,
  taxCodes,
  vatRegime,
  type TaxCodes,
  type VatRegime,
} from '../packages/cli/src/index.js';
import { TAX_TREATMENTS } from '../packages/core/src/types.js';
import { freshDatabase, rows } from './helpers/db.js';
import { allPacks, packsRoot } from './helpers/packs.js';

/** The enum of the pack schema, which is the third place the list is written. */
async function schemaTreatments(): Promise<string[]> {
  const schema = await readSchema(packsRoot);
  const defs = (schema['$defs'] ?? {}) as Record<string, Record<string, unknown>>;
  const properties = (defs['tax']?.['properties'] ?? {}) as Record<string, Record<string, unknown>>;
  const values = properties['treatment']?.['enum'];
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error('packs/schema/pack.1.json defines no tax treatment');
  }
  return values as string[];
}

/** A tax as the check reads one, with every field at its least offensive value. */
function tax(over: Partial<TaxCodes>): TaxCodes {
  return {
    code: 'X-1',
    scope: 'sale',
    amount_type: 'percent',
    rate: 0,
    treatment: 'domestic',
    vat_category: null,
    exemption_code: null,
    legal_reference: null,
    ...over,
  };
}

/**
 * A country the common system of VAT does not reach, and one that publishes a
 * list of reason codes of its own.
 *
 * Neither names anybody. What `readPack` resolves out of `territories` and the
 * pack's register is exactly these three fields, so a test of the rule states
 * the three fields and no country at all.
 */
const OUTSIDE: VatRegime = {
  commonSystem: false,
  because: 'the check was asked about a country the common system of VAT does not reach',
  reasonList: null,
};

const OUTSIDE_WITH_A_LIST: VatRegime = {
  ...OUTSIDE,
  reasonList: 'a published list of exemption reason codes',
};

/** The messages one tax produces, joined so a test can say what it expects to read. */
function refusalFor(over: Partial<TaxCodes>, regime: VatRegime = COMMON_SYSTEM): string {
  return taxCodes([tax(over)], regime)
    .map((issue) => issue.message)
    .join(' | ');
}

describe('the tax treatments', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await freshDatabase();
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it('are the same list in the database, in TypeScript and in the pack schema', async () => {
    const enumerated = (
      await rows<{ label: string }>(
        db,
        `select e.enumlabel as label from pg_enum e
           join pg_type t on t.oid = e.enumtypid
          where t.typname = 'tax_treatment' order by e.enumsortorder`,
      )
    ).map((row) => row.label);

    expect(enumerated).toEqual([...TAX_TREATMENTS]);
    expect(await schemaTreatments()).toEqual([...TAX_TREATMENTS]);
  });

  it('are each covered by the correspondence the check reads', () => {
    for (const treatment of TAX_TREATMENTS) {
      const codes = TREATMENT_CODES[treatment];
      expect(codes, treatment).toBeDefined();
      expect(codes?.scopes.length, treatment).toBeGreaterThan(0);
      expect(codes?.because, treatment).toMatch(/\S/);
      for (const category of codes?.categories ?? []) {
        expect(CATEGORY_CODES[category], `${treatment} → ${category}`).toBeDefined();
      }
    }
  });

  it('carry the general reverse-charge rule for a supplier who is not established here', async () => {
    // The value the Estonian pack had to call `import` before it existed, and
    // the reason it is in the vocabulary at all. The claim is about the view
    // that decides the sentence on an invoice, not about a country: a tax of
    // this treatment has to reach the reverse-charge mention and no other.
    const conditions = await rows<{ applies_when: string }>(
      db,
      `select distinct applies_when::text from legal_mention_templates order by 1`,
    );
    expect(conditions.map((c) => c.applies_when)).toContain('reverse_charge');
    expect(TREATMENT_CODES['foreign_services_received']?.scopes).toEqual(['purchase']);
    expect(TREATMENT_CODES['foreign_services_received']?.categories).toEqual([]);
  });
});

describe('the taxes of every pack', () => {
  it('agree with their EN 16931 category and their VATEX reason', async () => {
    for (const pack of allPacks) {
      expect(taxCodes(pack.taxes, await vatRegime(pack.manifest)), pack.slug).toEqual([]);
    }
  });

  it('name a category wherever one can reach an invoice the company issues', () => {
    // Not "every tax", which would be an opinion about the purchase side:
    // there the category is the supplier's and a pack may not record it.
    for (const pack of allPacks) {
      for (const sale of pack.taxes.filter((t) => t.scope === 'sale' || t.scope === 'both')) {
        expect(sale.vat_category, `${pack.slug} ${sale.code}`).not.toBeNull();
      }
    }
  });

  it('are the evidence that the check is not vacuous', () => {
    // Every pack passes, so the claim above proves nothing on its own unless
    // the same function refuses something. It does, below, one way at a time.
    const checked = allPacks.flatMap((pack) => pack.taxes);
    expect(checked.length).toBeGreaterThan(50);
  });
});

describe('what the check refuses', () => {
  it('a category the treatment contradicts', () => {
    expect(refusalFor({ treatment: 'export', vat_category: 'S', rate: 21 })).toContain(
      'expected G',
    );
  });

  it('a reverse-charge reason on an intra-Community supply', () => {
    expect(
      refusalFor({ treatment: 'intracom_goods', vat_category: 'K', exemption_code: 'VATEX-EU-AE' }),
    ).toContain('reserves VATEX-EU-IC');
  });

  it('the reverse-charge category on the middle supply of a triangular arrangement', () => {
    // AE is the guidance's case for a reverse charge *within* one Member
    // State. A triangular supply is the opposite shape — the goods leave the
    // seller's State and article 197 puts the tax on a customer in a third —
    // so what the line is, is K.
    expect(
      refusalFor({
        treatment: 'intracom_triangular',
        vat_category: 'AE',
        exemption_code: 'VATEX-EU-AE',
      }),
    ).toContain('expected K');
    expect(
      refusalFor({
        treatment: 'intracom_triangular',
        scope: 'purchase',
      }),
    ).toContain('is a sale operation');
    // And the pair the VATEX list reserves passes.
    expect(
      refusalFor({
        treatment: 'intracom_triangular',
        vat_category: 'K',
        exemption_code: 'VATEX-EU-IC',
      }),
    ).toBe('');
  });

  it('an exemption reason on a line that is taxed', () => {
    expect(
      refusalFor({ vat_category: 'S', rate: 21, exemption_code: 'VATEX-EU-132' }),
    ).toContain('exempt under nothing');
  });

  it('an exempt line with no article behind it', () => {
    expect(refusalFor({ treatment: 'exempt', vat_category: 'E' })).toContain(
      'names no exemption_code',
    );
  });

  it('a reason code that is not a VATEX code', () => {
    expect(refusalFor({ treatment: 'exempt', vat_category: 'E', exemption_code: 'art. 44' })).toContain(
      'is not a VATEX code',
    );
  });

  it('a category on an operation no invoice of the standard governs', () => {
    expect(refusalFor({ treatment: 'import', scope: 'purchase', vat_category: 'S' })).toContain(
      'it carries none',
    );
    expect(
      refusalFor({ treatment: 'foreign_services_received', scope: 'purchase', vat_category: 'AE' }),
    ).toContain('it carries none');
  });

  it('a sale that names no category at all', () => {
    expect(refusalFor({ vat_category: null })).toContain('names no vat_category');
  });

  it('a standard rate of zero, and an exempt rate that is not', () => {
    expect(refusalFor({ vat_category: 'S', rate: 0 })).toContain('BR-S-05');
    expect(
      refusalFor({ treatment: 'export', vat_category: 'G', exemption_code: 'VATEX-EU-G', rate: 21 }),
    ).toContain('BR-G-05');
  });

  it('a treatment declared on the side it does not happen on', () => {
    expect(refusalFor({ treatment: 'import', scope: 'sale' })).toContain(
      'is a purchase operation',
    );
  });

  it('nothing at all about a rate the buyer self-assesses at', () => {
    // The mirror of the rule above, and the reason it is narrowed to sales: a
    // purchase-side reverse charge carries the rate the buyer computes, on a
    // line the supplier invoiced at zero. Applied there, BR-IC-05 would refuse
    // every intra-Community acquisition ever written.
    expect(
      refusalFor({
        treatment: 'intracom_acquisition_goods',
        scope: 'purchase',
        vat_category: 'K',
        exemption_code: 'VATEX-EU-IC',
        rate: 21,
      }),
    ).toBe('');
  });
});

describe('where the common system of VAT applies', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await freshDatabase();
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it('is read by the CLI from the seed the database reads', async () => {
    // `ekwo pack check` runs on a checkout and has no database, so it parses
    // `supabase/seed/00_territories.sql` itself. The claim is that the two
    // readings never differ: every territory, on every day the table names —
    // an accession, a withdrawal, the day of the test — asked of Postgres and
    // asked of TypeScript.
    const territories = await readTerritories(repoRootDir());
    const days = [
      ...new Set(
        territories
          .flatMap((territory) => [territory.eu_vat_from, territory.eu_vat_to])
          .filter((day): day is string => day !== null),
      ),
      new Date().toISOString().slice(0, 10),
    ].sort();
    expect(days.length).toBeGreaterThan(5);

    const answers = await rows<{ code: string; day: string; scope: string }>(
      db,
      `select t.code, d.day::text as day, eu_vat_scope_of(t.code, d.day)::text as scope
         from territories t
         cross join (values ${days.map((day) => `(date '${day}')`).join(', ')}) as d(day)
        order by t.code, d.day`,
    );
    expect(answers.length).toBe(territories.length * days.length);

    const differences = answers.filter(
      (answer) => euVatScopeOf(answer.code, answer.day, territories) !== answer.scope,
    );
    expect(differences).toEqual([]);
  });

  it('carries every pack of this repository, so none falls back on not knowing', async () => {
    // `vatRegime` holds a pack to the Union's table where `territories` has no
    // row for its country, because a missing row is silence and not a no. That
    // fallback must never be what a pack of this repository is judged by, and
    // this is the CLI-side half of the invariant `tests/territories.test.ts`
    // states against the database.
    const territories = await readTerritories(repoRootDir());
    for (const pack of allPacks) {
      expect(territoryOf(pack.manifest.country, territories), pack.slug).not.toBeNull();
    }
  });

  it('is what tells a pack which of the three code lists reach it', async () => {
    // The regimes of the packs of this repository, and the claim that the
    // distinction is a live one: at least one pack is in the common system and
    // at least one is not, or the rules below are checked against nothing.
    const regimes = await Promise.all(allPacks.map((pack) => vatRegime(pack.manifest)));
    expect(regimes.filter((regime) => regime.commonSystem).length).toBeGreaterThan(0);
    expect(regimes.filter((regime) => !regime.commonSystem).length).toBeGreaterThan(0);
    for (const regime of regimes) {
      expect(regime.because).toMatch(/eu_vat_scope/);
    }
  });

  it('leaves BT-121 empty in a pack it does not reach, and the article in its place', async () => {
    const regimes = await Promise.all(allPacks.map((pack) => vatRegime(pack.manifest)));
    const outside = allPacks.filter((_, index) => !(regimes[index] as VatRegime).commonSystem);

    for (const pack of outside) {
      for (const levy of pack.taxes) {
        expect(levy.exemption_code, `${pack.slug} ${levy.code}`).toBeNull();
        const category = levy.vat_category;
        if (category !== null && CATEGORY_CODES[category]?.needsReason === true) {
          expect(levy.legal_reference, `${pack.slug} ${levy.code}`).toMatch(/\S/);
        }
        expect(TREATMENT_CODES[levy.treatment]?.commonSystem, `${pack.slug} ${levy.code}`).not.toBe(
          true,
        );
      }
    }
  });
});

describe('what the check refuses outside the common system of VAT', () => {
  it('a VATEX code, which belongs to a system the country is not in', () => {
    for (const category of Object.keys(CATEGORY_CODES)) {
      const reserved = CATEGORY_CODES[category]?.exemption;
      if (reserved === null || reserved === undefined) continue;
      expect(
        refusalFor({ treatment: 'not_subject', vat_category: 'O', exemption_code: reserved }, OUTSIDE),
        reserved,
      ).toContain('is a code of');
    }
    // Including the national spelling, which is a Member State's extension of
    // the same list and not a licence for anybody else to mint one.
    expect(
      refusalFor(
        { treatment: 'exempt', vat_category: 'E', exemption_code: 'VATEX-XX-SCH9' },
        OUTSIDE,
      ),
    ).toContain('State the article in legal_reference');
  });

  it('an exempt line with neither a code nor an article', () => {
    expect(refusalFor({ treatment: 'exempt', vat_category: 'E' }, OUTSIDE)).toContain(
      'names no exemption_code and no legal_reference',
    );
    // And the article on its own is the whole of what the line needs.
    expect(
      refusalFor(
        { treatment: 'exempt', vat_category: 'E', legal_reference: 'the article that exempts it' },
        OUTSIDE,
      ),
    ).toBe('');
  });

  it('an operation of the common system itself', () => {
    const inside = Object.entries(TREATMENT_CODES).filter(
      ([, codes]) => codes.commonSystem === true,
    );
    expect(inside.length).toBeGreaterThan(0);
    for (const [treatment, codes] of inside) {
      expect(
        refusalFor(
          {
            treatment,
            scope: codes.scopes[0] as string,
            vat_category: codes.categories[0] as string,
            exemption_code: null,
            legal_reference: 'an article',
          },
          OUTSIDE,
        ),
        treatment,
      ).toContain('is an operation of the common system of VAT');
    }
  });

  it('a reason code from a list the pack names nowhere', () => {
    expect(
      refusalFor({ treatment: 'exempt', vat_category: 'E', exemption_code: 'SCH9-G10' }, OUTSIDE),
    ).toContain('comes from no list this pack names');
    // Declared in the register as a standard, and the field is there for it.
    expect(
      refusalFor(
        { treatment: 'exempt', vat_category: 'E', exemption_code: 'SCH9-G10' },
        OUTSIDE_WITH_A_LIST,
      ),
    ).toBe('');
  });

  it('an article written into the column a code belongs in', () => {
    expect(
      refusalFor(
        { treatment: 'exempt', vat_category: 'E', exemption_code: 'Schedule 9, group 10' },
        OUTSIDE_WITH_A_LIST,
      ),
    ).toContain('is not a code');
  });

  it('nothing it refuses inside: the categories are UNCL5305 and stay', () => {
    expect(
      refusalFor({ treatment: 'export', vat_category: 'S', rate: 20 }, OUTSIDE),
    ).toContain('expected G');
    expect(refusalFor({ vat_category: null }, OUTSIDE)).toContain('names no vat_category');
    expect(refusalFor({ vat_category: 'S', rate: 0 }, OUTSIDE)).toContain('BR-S-05');
    expect(
      refusalFor({ treatment: 'import', scope: 'purchase', vat_category: 'S' }, OUTSIDE),
    ).toContain('it carries none');
    expect(
      refusalFor({ vat_category: 'S', rate: 20, exemption_code: 'SCH9-G10' }, OUTSIDE),
    ).toContain('exempt under nothing');
  });
});
