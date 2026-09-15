import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateIntraConsignment } from '@ekwo-ai/intra-consignment';
import { generateDes } from '@ekwo-ai/des';
import { generateEcdf } from '@ekwo-ai/ecdf';
import { generateVd } from '@ekwo-ai/vd';
import type { PackTax } from '../packages/cli/src/index.js';
import { TREATMENT_CODES } from '../packages/cli/src/index.js';
import { freshDatabase, one, rows } from './helpers/db.js';
import { newCompany, newContact, newDocument } from './helpers/factory.js';
import { allPacks, packWhere } from './helpers/packs.js';

/**
 * `intracom_triangular` — the supply in the middle of a triangular
 * arrangement.
 *
 * A sells to B, B sells to C, the goods go straight from A to C, and article
 * 141 of Directive 2006/112/EC relieves B of registering where they arrive
 * while article 197 puts the tax on C. All four recapitulative statements
 * print B's supply as a category of its own; `tax_treatment` had no word for
 * it, so `docs/international.md` recorded the gap and this is the value that
 * closes it.
 *
 * **Nothing here uses a country pack to make one.** No pack of this repository
 * declares a triangular tax, and the first test insists on that: writing one
 * for a country nobody asked would be inventing a rule rather than
 * transcribing one, and a pack that carried an invented tax would be reviewed
 * against a law that does not have it. So the fixture is a company's own tax
 * with its treatment changed — which is what the value is for, and which puts
 * the whole path under test without putting a fiction in `packs/`.
 *
 * What the path has to show is that nothing was written for it:
 *
 *   - `ec_sales_list()` returns the nature `triangular` because it takes
 *     `intracom_` off the treatment, and that function is untouched by the
 *     migration that added the value;
 *   - the format bricks were published before the value existed and already
 *     carry its column and its code;
 *   - the invoice says the customer owes the tax, which is the sentence the
 *     Directive requires and not the intra-Community exemption.
 */

const supplier = packWhere(
  'a tax on an intra-Community supply of goods, with a year of books behind it',
  (pack) => pack.golden !== null && pack.taxes.some((t) => t.treatment === 'intracom_goods'),
);

const goodsTax = supplier.taxes.find((t) => t.treatment === 'intracom_goods') as PackTax;
const goodsAccount = (supplier.golden?.documents ?? [])
  .flatMap((document) => document.lines)
  .find((line) => line.tax === goodsTax.code)?.account as string;

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

describe('no pack invents a triangular tax', () => {
  it('is declared by nobody, and the vocabulary is there all the same', () => {
    for (const pack of allPacks) {
      const invented = pack.taxes.filter((tax) => tax.treatment === 'intracom_triangular');
      expect(invented.map((tax) => `${pack.slug} ${tax.code}`)).toEqual([]);
    }
    // The value exists for the pack that will one day need it, and the check
    // that reads a pack knows what to do with it the day it arrives.
    expect(TREATMENT_CODES['intracom_triangular']?.scopes).toEqual(['sale']);
    expect(TREATMENT_CODES['intracom_triangular']?.categories).toEqual(['K']);
  });
});

describe(`${supplier.slug} — a triangular supply, from a tax of the company`, () => {
  let db: PGlite;
  let companyId: string;
  let customerId: string;
  let documentId: string;
  let prefix: string;
  const year = supplier.golden?.fiscalYear as { start: string; end: string };

  beforeAll(async () => {
    db = await freshDatabase();
    const fixture = await newCompany(db, {
      country: supplier.manifest.country,
      chart: supplier.golden?.chart ?? null,
      fiscalYear: supplier.golden?.fiscalYear,
    });
    companyId = fixture.companyId;

    // The fixture: the company's own intra-Community supply of goods, treated
    // as the middle supply of a triangular arrangement. One column, on one
    // row, of one company — and no file under `packs/` moves.
    await db.query(
      `update taxes set treatment = 'intracom_triangular' where company_id = $1 and code = $2`,
      [companyId, goodsTax.code],
    );

    const abroad = await one<{ code: string; prefix: string }>(
      db,
      `select code, vat_prefix_of(code) as prefix
         from territories
        where is_eu_member(code, $1::date)
          and vat_prefix_of(code) is distinct from vat_prefix_of($2)
        order by code limit 1`,
      [year.start, supplier.manifest.country],
    );
    prefix = abroad.prefix;

    customerId = await newContact(db, companyId, {
      name: 'The third party of the chain',
      country: abroad.code,
      vat: `${abroad.prefix}123456789`,
    });
    documentId = await newDocument(db, companyId, {
      docType: 'sale_invoice',
      contactId: customerId,
      date: year.start,
      lines: [{ unitPrice: 4000, taxCode: goodsTax.code, accountCode: goodsAccount }],
    });
    await db.query(`select post_document($1)`, [documentId]);
  }, 300_000);

  afterAll(async () => {
    await db.close();
  });

  async function list(): Promise<ListRow[]> {
    return rows<ListRow>(db, `select * from ec_sales_list($1, $2::date, $3::date)`, [
      companyId,
      year.start,
      year.end,
    ]);
  }

  it('comes out of the statement as its own nature, with the statement unchanged', async () => {
    const listed = await list();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.nature).toBe('triangular');
    expect(listed[0]?.issue).toBeNull();
    expect(listed[0]?.vat_country).toBe(prefix);
    expect(Number(listed[0]?.amount)).toBe(4000);
  });

  it('puts the reverse-charge sentence on the invoice, and not the intra-Union exemption', async () => {
    // The sentence under `intra_eu_goods` is the exemption of article 138, and
    // this supply is not exempt under it: it takes place where the goods
    // arrive, and article 197 makes the customer liable. So it is the sentence
    // every pack prints for a reverse charge that comes out — the same
    // mechanism, a different article — exactly as `foreign_services_received`
    // does. Which mentions those are is read from the pack, not written here.
    const printed = await rows<{ applies_when: string }>(
      db,
      `select applies_when::text from document_legal_mentions where document_id = $1`,
      [documentId],
    );
    const conditions = printed.map((row) => row.applies_when);
    expect(conditions).toContain('reverse_charge');
    expect(conditions).not.toContain('intra_eu_goods');
    expect(conditions).not.toContain('intra_eu_services');
  });

  it('is written into the file by three of the four bricks, and refused by name by the fourth', async () => {
    const listed = await list();

    // Belgium: category II of form 723, which the directives code `T`.
    const belgian = generateIntraConsignment(listed, {
      declarant: { vatNumber: '0999999999', countryCode: supplier.manifest.country },
      period: { year: 2026, quarter: 4 },
    });
    expect(belgian.violations).toEqual([]);
    expect(belgian.file).toContain('<ns2:Code>T</ns2:Code>');

    // Luxembourg: the `LIC` form, whose second table is the triangular one.
    const party = { matrNbr: '19999999999', rcsNbr: 'B999999', vatNbr: '99999999' };
    const luxembourg = generateEcdf(listed, {
      prefix: '000000',
      interfaceId: 'DEMO',
      agent: party,
      declarer: party,
      cadence: 'quarter',
      year: 2026,
      period: 4,
      createdAt: new Date(Date.UTC(2027, 0, 20, 9, 0, 0)),
    });
    expect(luxembourg.violations).toEqual([]);
    expect(luxembourg.declarations).toEqual(['TVA_LICT']);

    // Estonia: the `kolmnurktehing` column of form VD.
    const estonian = generateVd(listed, { registryCode: '19999999', year: 2026, month: 12 });
    expect(estonian.violations).toEqual([]);
    expect(estonian.file).toContain('<kolmnurktehing>');

    // France: the DES carries services and says so. A triangular supply of
    // goods belongs on the état récapitulatif, which is another file — and a
    // brick that guessed would put an amount in a form that never asked for it.
    const french = generateDes(listed, {
      vatNumber: 'FRKK999999999',
      year: 2026,
      month: 12,
    });
    expect(french.violations.map((v) => v.code)).toEqual(['not_a_service']);
    expect(french.violations[0]?.message).toContain('triangular');
  });
});
