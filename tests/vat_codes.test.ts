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
 */

import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CATEGORY_CODES,
  TREATMENT_CODES,
  readSchema,
  taxCodes,
  type TaxCodes,
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
    ...over,
  };
}

/** The messages one tax produces, joined so a test can say what it expects to read. */
function refusalFor(over: Partial<TaxCodes>): string {
  return taxCodes([tax(over)])
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
  it('agree with their EN 16931 category and their VATEX reason', () => {
    for (const pack of allPacks) {
      expect(taxCodes(pack.taxes), pack.slug).toEqual([]);
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
