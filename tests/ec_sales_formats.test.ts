import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateIntraConsignment } from '@ekwo-ai/intra-consignment';
import { generateDes } from '@ekwo-ai/des';
import { generateEcdf } from '@ekwo-ai/ecdf';
import { generateVd } from '@ekwo-ai/vd';
import type { Pack } from '../packages/cli/src/index.js';
import { freshDatabase, rows } from './helpers/db.js';
import { newCompany } from './helpers/factory.js';
import { replayScenario } from './helpers/golden-scenario.js';
import { packOfCountry } from './helpers/packs.js';

/**
 * Where a pack and a format brick meet.
 *
 * Nothing joins them at runtime: `ec_sales_list()` returns rows that know no
 * country, and each brick turns those rows into the file one administration
 * expects. If either moves — a treatment renamed, a column dropped, a form
 * changed — this is what says so, and it is the only test that can, because a
 * brick is published on its own and a pack is data.
 *
 * Each block below books the golden year of one pack through the real engine,
 * asks for the statement of that year, and hands it to the brick of that
 * country's format. What it asserts is that the figures the books produced are
 * the figures in the file: nothing is written down here that the scenario does
 * not already say.
 *
 * The country of each block is named on purpose. A format is code and the
 * Belgian listing is Belgian by nature, exactly as `packages/formats/README.md`
 * says of the NBB scheme — what may not name a country is a test about the
 * core, and that one is `ec_sales_list.test.ts`.
 */

interface ListRow {
  vat_country: string | null;
  vat_number: string | null;
  nature: string;
  amount: string;
  currency_code: string;
  documents: number;
  contact_ids: string[] | null;
  contact_names: string[] | null;
  issue: string | null;
}

/** Books a pack's golden year and hands back the statement it produced. */
async function statementOf(pack: Pack): Promise<{ db: PGlite; list: ListRow[]; golden: NonNullable<Pack['golden']> }> {
  const golden = pack.golden as NonNullable<Pack['golden']>;
  const db = await freshDatabase();
  const { companyId } = await newCompany(db, {
    country: pack.manifest.country,
    name: golden.name,
    chart: golden.chart,
    language: golden.language,
    fiscalYear: golden.fiscalYear,
  });
  await replayScenario(db, companyId, golden);
  const list = await rows<ListRow>(db, `select * from ec_sales_list($1, $2::date, $3::date)`, [
    companyId,
    golden.fiscalYear.start,
    golden.fiscalYear.end,
  ]);
  return { db, list, golden };
}

/** The amount of one nature, as the books came to it, for an assertion to use. */
function amountOf(list: ListRow[], nature: string): number {
  return list
    .filter((row) => row.nature === nature && row.issue === null)
    .reduce((total, row) => total + Number(row.amount), 0);
}

// ---------------------------------------------------------------------------
// country-literal: a format brick implements one administration's file, so the
// block that tests it names the pack whose books that administration would
// read. The core's own test walks every pack instead.
// ---------------------------------------------------------------------------

describe('the Belgian listing, from a year of Belgian books', () => {
  const pack = packOfCountry('BE');
  let db: PGlite;
  let list: ListRow[];

  beforeAll(async () => {
    ({ db, list } = await statementOf(pack));
  }, 300_000);

  afterAll(async () => {
    await db.close();
  });

  it('carries a supply of goods and a supply of services to one customer', () => {
    // Which customer, read from the scenario: the one abroad with a number.
    const abroad = (pack.golden?.contacts ?? []).filter(
      (contact) => contact.vat_number !== null && contact.country !== pack.manifest.country,
    );
    expect(list.filter((row) => row.issue === null)).toHaveLength(2);
    expect(new Set(list.map((row) => row.vat_country))).toEqual(
      new Set(abroad.filter((c) => c.type === 'customer').map((c) => c.country)),
    );
    expect(amountOf(list, 'goods')).toBeGreaterThan(0);
    expect(amountOf(list, 'services')).toBeGreaterThan(0);
  });

  it('deducts the credit note of the year from the customer, not from a box', () => {
    // The Belgian return reports a credit note on an intra-Community supply in
    // box 48, positively and in a box of its own. The listing has no such box:
    // it lowers the customer's line. That the two do not read alike is the
    // whole reason this statement is a function and not a box of the return.
    const goods = list.find((row) => row.nature === 'goods') as ListRow;
    expect(goods.documents).toBe(2);
    expect(Number(goods.amount)).toBeLessThan(
      Number(
        // What the invoice alone was, from the scenario rather than from here.
        (pack.golden?.documents ?? [])
          .filter((d) => d.type === 'sale_invoice')
          .flatMap((d) => d.lines)
          .filter((l) => l.tax !== null && pack.taxes.find((t) => t.code === l.tax)?.treatment === 'intracom_goods')
          .reduce((total, l) => total + l.quantity * l.unit_price, 0),
      ),
    );
  });

  it('writes a listing whose amounts are the ones the books came to', () => {
    const { file, filename, violations } = generateIntraConsignment(list, {
      declarant: { vatNumber: '0999999999', name: 'Demo', countryCode: pack.manifest.country },
      period: { year: 2026, quarter: 4 },
    });

    expect(violations).toEqual([]);
    expect(file).toContain('ClientsNbr="2"');
    expect(file).toContain(`<ns2:Amount>${amountOf(list, 'goods').toFixed(2)}</ns2:Amount>`);
    expect(file).toContain(`<ns2:Amount>${amountOf(list, 'services').toFixed(2)}</ns2:Amount>`);
    expect(file).toContain('<ns2:Code>L</ns2:Code>');
    expect(file).toContain('<ns2:Code>S</ns2:Code>');
    expect(file).toContain(
      `AmountSum="${(amountOf(list, 'goods') + amountOf(list, 'services')).toFixed(2)}"`,
    );
    expect(filename).toMatch(/\.xml$/);
  });
});

describe('the French DES, from a year of French books', () => {
  const pack = packOfCountry('FR');
  let db: PGlite;
  let list: ListRow[];

  beforeAll(async () => {
    ({ db, list } = await statementOf(pack));
  }, 300_000);

  afterAll(async () => {
    await db.close();
  });

  it('declares the services and sends the goods to the other file', () => {
    const { file, violations } = generateDes(list, {
      vatNumber: 'FRKK999999999',
      year: 2026,
      month: 8,
    });

    expect(file.match(/<ligne_des>/g)).toHaveLength(1);
    expect(file).toContain(`<valeur>${Math.round(amountOf(list, 'services'))}</valeur>`);
    // The customer's number goes back together for this format, prefix
    // included, which is the opposite of what Luxembourg and Estonia want.
    const customer = list.find((row) => row.nature === 'services') as ListRow;
    expect(file).toContain(`<partner_des>${customer.vat_country}${customer.vat_number}</partner_des>`);

    expect(violations.map((v) => v.code)).toEqual(['not_a_service']);
    expect(violations[0]?.message).toContain('état récapitulatif TVA');
  });
});

describe('the Luxembourg eCDF file, from a year of Luxembourg books', () => {
  const pack = packOfCountry('LU');
  let db: PGlite;
  let list: ListRow[];

  beforeAll(async () => {
    ({ db, list } = await statementOf(pack));
  }, 300_000);

  afterAll(async () => {
    await db.close();
  });

  it('writes one declaration per nature, both in the same envelope', () => {
    const party = { matrNbr: '19999999999', rcsNbr: 'B999999', vatNbr: '99999999' };
    const { file, filename, fileReference, declarations, violations } = generateEcdf(list, {
      prefix: '000000',
      interfaceId: 'DEMO',
      agent: party,
      declarer: party,
      cadence: 'quarter',
      year: 2026,
      period: 4,
      createdAt: new Date(Date.UTC(2027, 0, 20, 9, 0, 0)),
    });

    expect(violations).toEqual([]);
    expect(declarations).toEqual(['TVA_LICT', 'TVA_PSIT']);
    expect(filename).toBe(`${fileReference}.xml`);

    // A comma, and the country apart from the number.
    const goods = list.find((row) => row.nature === 'goods') as ListRow;
    expect(file).toContain(
      `<NumericField id="03">${amountOf(list, 'goods').toFixed(2).replace('.', ',')}</NumericField>`,
    );
    expect(file).toContain(`<TextField id="01">${goods.vat_country}</TextField>`);
    expect(file).toContain(`<TextField id="02">${goods.vat_number}</TextField>`);
    expect(file).not.toContain(`${goods.vat_country}${goods.vat_number}`);
  });
});

describe('the Estonian form VD, from a year of Estonian books', () => {
  const pack = packOfCountry('EE');
  let db: PGlite;
  let list: ListRow[];

  beforeAll(async () => {
    ({ db, list } = await statementOf(pack));
  }, 300_000);

  afterAll(async () => {
    await db.close();
  });

  it('merges the two natures of one acquirer onto the single row the form has', () => {
    const { file, violations } = generateVd(list, {
      registryCode: '19999999',
      year: 2026,
      month: 2,
    });

    expect(violations).toEqual([]);
    // Two rows out of the statement, one row in the file: this is the
    // aggregation no other format here asks for.
    expect(list.filter((row) => row.issue === null)).toHaveLength(2);
    expect(file.match(/<aruandeRida>/g)).toHaveLength(1);

    const customer = list.find((row) => row.issue === null) as ListRow;
    expect(file).toContain(`<kmkrKood riik="${customer.vat_country}">${customer.vat_number}</kmkrKood>`);
    expect(file).toContain(`<kaup>${Math.round(amountOf(list, 'goods'))}</kaup>`);
    expect(file).toContain(`<teenusteMyyk>${Math.round(amountOf(list, 'services'))}</teenusteMyyk>`);
  });
});
