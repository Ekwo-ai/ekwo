/**
 * BT-151 as the database hands it back.
 *
 * `taxes.vat_category`, `tax_templates.vat_category` and
 * `document_lines.vat_category` were `char(2)` from the day they were created,
 * and `char(n)` pads to width on write. Every category of EN 16931 but `AE` is
 * one character, so the column manufactured `S `, `K `, `E ` — and the two
 * views that publish BT-151 published that, to a renderer whose invoice then
 * fails validation and to whoever holds the link to a shared document. Nothing
 * noticed, because the one test that compared the column compared two
 * databases that pad identically and trimmed before it looked.
 *
 * Four claims, and the first is the one that keeps the others honest: no
 * column of this schema called `vat_category` is a fixed-width string any
 * more, whatever table a later migration puts one on. Then the value a pack
 * declares survives the round trip — into `tax_templates`, into the `taxes` of
 * a company that installed the pack, onto the line of a posted invoice, out
 * through `document_line_items`, `document_tax_summary` and the payload an
 * anonymous reader of a shared invoice receives — and comes back as the code
 * and nothing else. Last, the constraint refuses what the column used to
 * produce, so a padded value can no longer be written by hand either.
 *
 * Every expectation is read from the pack whose books are being kept. No
 * category is written down here: a test that asserted `'S'` would be asserting
 * a country's choice.
 */

import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pack, PackGolden } from '../packages/cli/src/index.js';
import { asUser, expectError, freshDatabase, one, rows } from './helpers/db.js';
import { newCompany, newUser } from './helpers/factory.js';
import { replayScenario } from './helpers/golden-scenario.js';
import { allPacks, packWhere } from './helpers/packs.js';

/** A UNCL5305 category is one or two capitals. A padded one is neither. */
const CATEGORY = /^[A-Z]{1,2}$/;

/** The tables and views this schema publishes a VAT category from. */
const PUBLISHES_A_CATEGORY = [
  'document_line_items',
  'document_lines',
  'document_tax_summary',
  'tax_templates',
  'taxes',
];

/** What a pack says the category of one of its taxes is, or null where it says none. */
function categoryOf(pack: Pack, code: string | null): string | null {
  if (code === null) return null;
  return pack.taxes.find((tax) => tax.code === code)?.vat_category ?? null;
}

/** The shape `shared_document()` answers with, reduced to what carries BT-151. */
interface SharedDocument {
  lines: { tax_category: string | null }[];
  tax_summary: { category: string | null }[];
}

let db: PGlite;

beforeAll(async () => {
  db = await freshDatabase();
}, 180_000);

afterAll(async () => {
  await db.close();
});

describe('the column a VAT category lives in', () => {
  it('is text everywhere the schema keeps one', async () => {
    const columns = await rows<{ relation: string; data_type: string }>(
      db,
      `select table_name as relation, data_type
         from information_schema.columns
        where table_schema = 'public' and column_name = 'vat_category'
        order by table_name`,
    );

    // Not a list this test maintains: whatever a later migration adds, it is
    // caught here, and the assertion below is what says the query found
    // something to judge.
    for (const column of columns) {
      expect(column.data_type, column.relation).toBe('text');
    }
    expect(columns.map((column) => column.relation)).toEqual(
      expect.arrayContaining(PUBLISHES_A_CATEGORY),
    );
  });

  it('refuses a value padded to the width it used to pad to', async () => {
    const [tax] = await rows<{ id: string; vat_category: string }>(
      db,
      `select id, vat_category from tax_templates where vat_category is not null limit 1`,
    );
    expect(tax, 'no pack of this repository declares a category').toBeDefined();

    const message = await expectError(
      db,
      `update tax_templates set vat_category = $1 where id = $2`,
      [`${tax!.vat_category} `, tax!.id],
    );
    expect(message).toMatch(/tax_templates_vat_category_format/);
  });
});

describe('the category a pack declares', () => {
  it('comes back from the templates and from an installed company as the pack wrote it', async () => {
    for (const pack of allPacks) {
      const templates = await rows<{ code: string; vat_category: string | null }>(
        db,
        `select code, vat_category from tax_templates where country = $1 order by code`,
        [pack.manifest.country],
      );
      expect(templates.length, pack.slug).toBe(pack.taxes.length);

      const { companyId } = await newCompany(db, {
        country: pack.manifest.country,
        name: `${pack.slug} vat category`,
      });
      const installed = await rows<{ code: string; vat_category: string | null }>(
        db,
        `select code, vat_category from taxes where company_id = $1 order by code`,
        [companyId],
      );
      expect(installed.length, pack.slug).toBe(pack.taxes.length);

      for (const row of [...templates, ...installed]) {
        const declared = categoryOf(pack, row.code);
        expect(row.vat_category, `${pack.slug} ${row.code}`).toBe(declared);
        if (row.vat_category !== null) {
          expect(row.vat_category, `${pack.slug} ${row.code}`).toMatch(CATEGORY);
        }
      }
    }
  }, 180_000);
});

describe('the category of a posted invoice', () => {
  let pack: Pack;
  let golden: PackGolden;
  let companyId: string;
  let ownerId: string;
  let strangerId: string;
  let invoiceId: string;
  /** What the pack says every line of that invoice carries, in sequence order. */
  let expected: (string | null)[];

  beforeAll(async () => {
    // The pack under test is the one whose golden year sells something under a
    // category. Saying which country that is would be the assertion this file
    // exists not to make.
    pack = packWhere(
      'a golden year whose sales carry an EN 16931 category',
      (p) =>
        p.golden !== null &&
        p.golden.documents.some(
          (document) =>
            document.type === 'sale_invoice' &&
            document.lines.some((line) => categoryOf(p, line.tax) !== null),
        ),
    );
    golden = pack.golden as PackGolden;

    ({ companyId, ownerId } = await newCompany(db, {
      country: pack.manifest.country,
      name: golden.name,
      chart: golden.chart,
      language: golden.language,
      fiscalYear: golden.fiscalYear,
    }));
    strangerId = await newUser(db, 'stranger@vat-category.test');

    const replayed = await replayScenario(db, companyId, golden);
    const sale = golden.documents.find(
      (document) =>
        document.type === 'sale_invoice' &&
        document.lines.some((line) => categoryOf(pack, line.tax) !== null),
    );
    invoiceId = replayed.documents.get(sale!.ref) as string;
    expected = sale!.lines.map((line) => categoryOf(pack, line.tax));

    // The snapshot an application writes when it issues the document: BT-151
    // and BT-152 as they stood that day, so a later rate change cannot rewrite
    // history. Nothing in the core writes it, which is why the constat could
    // only ever be seen from here.
    await db.query(
      `update document_lines l
          set vat_category = t.vat_category, vat_rate = t.amount
         from taxes t
        where t.id = l.tax_id and l.document_id = $1`,
      [invoiceId],
    );
  }, 180_000);

  it('reaches document_line_items as the code and nothing else', async () => {
    const lines = await rows<{ vat_category: string | null }>(
      db,
      `select vat_category from document_line_items where document_id = $1 order by sequence`,
      [invoiceId],
    );
    // The invoice has to carry one, or every assertion of this block passes on
    // an empty claim.
    expect(expected.some((category) => category !== null), pack.slug).toBe(true);
    expect(lines.map((line) => line.vat_category)).toEqual(expected);
    for (const line of lines) {
      if (line.vat_category !== null) expect(line.vat_category).toMatch(CATEGORY);
    }
  });

  it('reaches document_tax_summary as the code and nothing else', async () => {
    const summary = await rows<{ vat_category: string | null }>(
      db,
      `select vat_category from document_tax_summary where document_id = $1
        order by vat_category nulls last`,
      [invoiceId],
    );
    const declared = [...new Set(expected.filter((category) => category !== null))].sort();
    expect(summary.map((row) => row.vat_category).filter((c) => c !== null)).toEqual(declared);
    for (const row of summary) {
      if (row.vat_category !== null) expect(row.vat_category).toMatch(CATEGORY);
    }
  });

  it('reaches whoever holds the link to the invoice as the code and nothing else', async () => {
    const share = await asUser(db, ownerId, () =>
      one<{ token: string }>(db, `select * from share_document($1)`, [invoiceId]),
    );
    const payload = await asUser(
      db,
      strangerId,
      async () =>
        (
          await rows<{ p: SharedDocument | null }>(db, `select shared_document($1) as p`, [
            share.token,
          ])
        )[0]?.p ?? null,
      'anon',
    );

    expect(payload).not.toBeNull();
    expect(payload!.lines.map((line) => line.tax_category)).toEqual(expected);
    const declared = [...new Set(expected.filter((category) => category !== null))].sort();
    expect(
      payload!.tax_summary
        .map((row) => row.category)
        .filter((category) => category !== null)
        .sort(),
    ).toEqual(declared);
    for (const category of [
      ...payload!.lines.map((line) => line.tax_category),
      ...payload!.tax_summary.map((row) => row.category),
    ]) {
      if (category !== null) expect(category).toMatch(CATEGORY);
    }
  });
});
