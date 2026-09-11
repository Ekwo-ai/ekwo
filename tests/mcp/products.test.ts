/**
 * Products, through the tools, from the catalogue to the posted entry.
 *
 * The claim being tested is the one the design rests on: **a product fills a
 * line in and never constrains it.** So the assertions are on what a line
 * ends up carrying — its own text when it has one, the catalogue's when it
 * does not — and on the entry that comes out at the end.
 *
 * Everything runs under `set role authenticated` with real claims, because
 * `products` is a new table with new policies and the write path is the part
 * a read-only test cannot vouch for.
 */

import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readTools, writeTools, type Backend } from '../../packages/mcp/src/index.js';
import { UNIT_CODES, isUnitCode, isWellFormedUnitCode } from '../../packages/core/src/types.js';
import { freshDatabase, rows } from '../helpers/db.js';
import { newCompany, type Fixture } from '../helpers/factory.js';
import { backendFor, ledgerOfEntry, list, record } from './helpers.js';

let db: PGlite;
let one: Fixture;
let two: Fixture;
let accountant: Backend;
let viewer: Backend;
let otherOwner: Backend;
let customerId: string;
let consultingId: string;
let licenceId: string;
let theirProductId: string;

beforeAll(async () => {
  db = await freshDatabase();
  one = await newCompany(db, { country: 'BE', name: 'Catalogue Une SRL' });
  two = await newCompany(db, { country: 'BE', name: 'Catalogue Deux SRL' });

  const accountantId = crypto.randomUUID();
  const viewerId = crypto.randomUUID();
  await db.query(
    `insert into company_members (company_id, user_id, role)
     values ($1, $2, 'accountant'), ($1, $3, 'viewer')`,
    [one.companyId, accountantId, viewerId],
  );

  accountant = backendFor(db, accountantId);
  viewer = backendFor(db, viewerId);
  otherOwner = backendFor(db, two.ownerId);

  customerId = String(
    record(
      record(
        await writeTools.createContact(accountant, {
          company_id: one.companyId,
          name: 'Cliente Catalogue',
          contact_type: 'customer',
        }),
      )['contact'],
    )['id'],
  );

  theirProductId = String(
    record(
      record(
        await writeTools.createProduct(otherOwner, {
          company_id: two.companyId,
          code: 'LEUR-PRODUIT',
          name: 'Le produit de quelqu un d autre',
          sale_price: '99.00',
        }),
      )['product'],
    )['id'],
  );
});

afterAll(async () => {
  await db.close();
});

describe('the catalogue', () => {
  it('is refused to a viewer and written by an accountant', async () => {
    await expect(
      writeTools.createProduct(viewer, {
        company_id: one.companyId,
        code: 'REFUSE',
        name: 'Rien',
      }),
    ).rejects.toThrow(/not_found|row-level security|violates/);

    const created = record(
      await writeTools.createProduct(accountant, {
        company_id: one.companyId,
        code: 'CONS-JOUR',
        name: 'Journee de conseil',
        description: 'Accompagnement, par journee de sept heures.',
        kind: 'service',
        unit_code: 'DAY',
        sale_price: '500.00',
        sale_account_code: '704000',
        sale_tax_code: 'BE-S-21',
      }),
    );
    const product = record(created['product']);
    consultingId = String(product['id']);
    expect(product['code']).toBe('CONS-JOUR');
    expect(product['unit_code']).toBe('DAY');
    expect(product['sale_price']).toBe('500.000000');
    expect(product['active']).toBe(true);

    licenceId = String(
      record(
        record(
          await writeTools.createProduct(accountant, {
            company_id: one.companyId,
            code: 'LIC-AN',
            name: 'Licence annuelle',
            kind: 'goods',
            unit_code: 'ANN',
            sale_price: '1200.00',
            sale_account_code: '700300',
            sale_tax_code: 'BE-S-21',
          }),
        )['product'],
      )['id'],
    );

    // Nobody but this company sees any of it, in either direction.
    const theirs = record(await readTools.searchProducts(otherOwner, { company_id: two.companyId }));
    expect(list(theirs['products']).map((p) => p['code'])).toEqual(['LEUR-PRODUIT']);
    const peek = record(await readTools.searchProducts(otherOwner, { company_id: one.companyId }));
    expect(list(peek['products'])).toHaveLength(0);
  });

  it('refuses a second row under the same code', async () => {
    await expect(
      writeTools.createProduct(accountant, {
        company_id: one.companyId,
        code: 'CONS-JOUR',
        name: 'Un doublon',
      }),
    ).rejects.toThrow(/duplicate key|unique/i);
  });

  it('is searched by code, by name and by description', async () => {
    const byCode = record(
      await readTools.searchProducts(accountant, { company_id: one.companyId, query: 'CONS' }),
    );
    expect(list(byCode['products']).map((p) => p['code'])).toEqual(['CONS-JOUR']);

    const byWord = record(
      await readTools.searchProducts(accountant, { company_id: one.companyId, query: 'journee' }),
    );
    expect(list(byWord['products']).map((p) => p['code'])).toEqual(['CONS-JOUR']);

    const goods = record(
      await readTools.searchProducts(accountant, { company_id: one.companyId, kind: 'goods' }),
    );
    expect(list(goods['products']).map((p) => p['code'])).toEqual(['LIC-AN']);
  });
});

describe('a product on a document line', () => {
  let documentId: string;

  it('fills in the text, the unit, the price, the account and the tax', async () => {
    const draft = record(
      await writeTools.createDocument(accountant, {
        company_id: one.companyId,
        doc_type: 'sale_invoice',
        contact_id: customerId,
        document_date: '2026-06-15',
        lines: [
          // 1. Everything from the catalogue.
          { product_code: 'CONS-JOUR', quantity: 3 },
          // 2. A product, with the account overridden on the line.
          { product_code: 'LIC-AN', unit_price: '1000.00', account_code: '700100' },
          // 3. Free text, no product at all.
          { name: 'Frais de deplacement', unit_price: '120.00', tax_code: 'BE-S-21' },
        ],
      }),
    );
    documentId = String(record(draft['document'])['id']);
    const lines = list(draft['lines']);
    expect(lines).toHaveLength(3);

    const first = lines[0] as Record<string, unknown>;
    expect(first['name']).toBe('Journee de conseil');
    expect(first['description']).toBe('Accompagnement, par journee de sept heures.');
    expect(first['unit_code']).toBe('DAY');
    expect(first['unit_price']).toBe('500.000000');
    expect(first['quantity']).toBe('3.0000');
    expect(record(first['account'] ?? {})['code']).toBe('704000');
    expect(record(first['tax'] ?? {})['code']).toBe('BE-S-21');

    // The line wins over the catalogue, on the account as on the price.
    const second = lines[1] as Record<string, unknown>;
    expect(second['unit_price']).toBe('1000.000000');
    expect(record(second['account'] ?? {})['code']).toBe('700100');
    expect(second['unit_code']).toBe('ANN');

    // And free text stays possible, with no product to point at.
    const third = lines[2] as Record<string, unknown>;
    expect(third['product_id']).toBeNull();
    expect(third['name']).toBe('Frais de deplacement');
    expect(record(third['account'] ?? {})['code']).toBe('700000');
  });

  it('posts to the accounts the three lines resolved to', async () => {
    const posted = record(await writeTools.postDocument(accountant, { document_id: documentId }));
    const entryId = String(record(posted['entry'])['id']);
    const ledger = await ledgerOfEntry(db, entryId);

    // 1 500 on 704000, 1 000 on 700100, 120 on 700000, VAT on 451000, the
    // customer on 400000 for the total.
    expect(ledger).toEqual([
      { code: '704000', debit: '0.00', credit: '1500.00' },
      { code: '700100', debit: '0.00', credit: '1000.00' },
      { code: '700000', debit: '0.00', credit: '120.00' },
      { code: '451000', debit: '0.00', credit: '550.20' },
      { code: '400000', debit: '3170.20', credit: '0.00' },
    ]);
  });

  it('keeps what a posted line said when the catalogue changes afterwards', async () => {
    await writeTools.updateProduct(accountant, {
      product_id: consultingId,
      name: 'Journee de conseil (2027)',
      sale_price: '600.00',
    });

    const document = record(await readTools.getDocument(accountant, { document_id: documentId }));
    const first = list(document['lines'])[0] as Record<string, unknown>;
    expect(first['name']).toBe('Journee de conseil');
    expect(first['unit_price']).toBe('500.000000');
  });

  it('refuses a product of another company, and does not say what it is', async () => {
    await expect(
      writeTools.createDocument(accountant, {
        company_id: one.companyId,
        doc_type: 'sale_invoice',
        contact_id: customerId,
        document_date: '2026-06-16',
        lines: [{ product_id: theirProductId, quantity: 1 }],
      }),
    ).rejects.toThrow(/unknown_product/);

    await expect(
      writeTools.createDocument(accountant, {
        company_id: one.companyId,
        doc_type: 'sale_invoice',
        contact_id: customerId,
        document_date: '2026-06-16',
        lines: [{ product_code: 'LEUR-PRODUIT', quantity: 1 }],
      }),
    ).rejects.toThrow(/unknown_product_code/);
  });

  it('refuses a line with no price anywhere, naming the line', async () => {
    await writeTools.createProduct(accountant, {
      company_id: one.companyId,
      code: 'SANS-PRIX',
      name: 'Sans prix',
      sale_account_code: '704000',
    });
    await expect(
      writeTools.createDocument(accountant, {
        company_id: one.companyId,
        doc_type: 'sale_invoice',
        contact_id: customerId,
        document_date: '2026-06-16',
        lines: [{ product_code: 'SANS-PRIX', quantity: 1 }],
      }),
    ).rejects.toThrow(/missing_unit_price.*SANS-PRIX/s);
  });
});

describe('retiring a product', () => {
  it('hides it from searches and leaves every line that carries it alone', async () => {
    await writeTools.updateProduct(accountant, {
      company_id: one.companyId,
      product_code: 'CONS-JOUR',
      active: false,
    });

    const visible = record(await readTools.searchProducts(accountant, { company_id: one.companyId }));
    expect(list(visible['products']).map((p) => p['code'])).not.toContain('CONS-JOUR');

    const all = record(
      await readTools.searchProducts(accountant, {
        company_id: one.companyId,
        include_inactive: true,
      }),
    );
    expect(all['products']).toBeDefined();
    expect(list(all['products']).map((p) => p['code'])).toContain('CONS-JOUR');

    // And the schema refuses to let it be deleted while a line points at it,
    // which is why retiring is the way to withdraw something.
    await expect(
      db.query('delete from products where id = $1', [consultingId]),
    ).rejects.toThrow(/violates foreign key/);
  });
});

describe('the EN 16931 item terms', () => {
  it('come out of document_line_items, BT-155 from the product code', async () => {
    const items = await rows<{
      item_name: string;
      item_description: string | null;
      seller_item_identifier: string | null;
      unit_code: string;
      sequence: number;
    }>(
      db,
      `select item_name, item_description, seller_item_identifier, unit_code, sequence
         from document_line_items
        where document_id = (
          select id from documents
           where company_id = $1 and document_date = date '2026-06-15'
           order by created_at limit 1
        )
        order by sequence`,
      [one.companyId],
    );

    expect(items).toHaveLength(3);
    // BT-153, BT-154, BT-155.
    expect(items[0]?.item_name).toBe('Journee de conseil');
    expect(items[0]?.item_description).toBe('Accompagnement, par journee de sept heures.');
    expect(items[0]?.seller_item_identifier).toBe('CONS-JOUR');
    expect(items[0]?.unit_code).toBe('DAY');
    // A line with no product has no seller identifier, and that is the answer
    // rather than a gap: BT-155 is optional in EN 16931.
    expect(items[2]?.seller_item_identifier).toBeNull();
  });

  /**
   * The invoice object `@ekwo-ai/factur-x` takes, built from the view.
   *
   * The library is not a dependency of this repository: it lives in a private
   * GitHub repository and `npm ci` in CI has no credentials for it, so adding
   * it would turn a green build red on the next clone. The mapping is written
   * down in `docs/mapping.md` and asserted here instead, which is what the
   * dependency would have proved: BT-153 and BT-155 are filled for a line
   * that carries a product.
   */
  it('map onto the Factur-X invoice model with BT-153 and BT-155 filled', async () => {
    const lines = await rows<{
      item_name: string;
      item_description: string | null;
      seller_item_identifier: string | null;
      quantity: string;
      unit_code: string;
      unit_price: string;
      vat_rate: string | null;
      vat_category: string | null;
    }>(
      db,
      `select item_name, item_description, seller_item_identifier,
              quantity::text, unit_code, unit_price::text,
              vat_rate::text, vat_category
         from document_line_items
        where document_id = (
          select id from documents
           where company_id = $1 and document_date = date '2026-06-15'
           order by created_at limit 1
        )
        order by sequence`,
      [one.companyId],
    );

    const invoiceLines = lines.map((line) => ({
      name: line.item_name, // BT-153
      description: line.item_description ?? undefined, // BT-154
      sellerItemId: line.seller_item_identifier ?? undefined, // BT-155
      quantity: Number(line.quantity), // BT-129
      unitCode: line.unit_code, // BT-130
      unitPrice: Number(line.unit_price), // BT-146
      vatRate: Number(line.vat_rate ?? 0), // BT-152
      vatCategory: line.vat_category ?? undefined, // BT-151
    }));

    expect(invoiceLines[0]).toMatchObject({
      name: 'Journee de conseil',
      sellerItemId: 'CONS-JOUR',
      unitCode: 'DAY',
      quantity: 3,
      unitPrice: 500,
    });
    // Every line has a name; only the ones with a product have an identifier.
    expect(invoiceLines.every((line) => line.name.length > 0)).toBe(true);
    expect(invoiceLines.filter((line) => line.sellerItemId !== undefined)).toHaveLength(2);
    // The unit codes are ones the library understands unchanged.
    for (const line of invoiceLines) {
      expect(isWellFormedUnitCode(line.unitCode), line.unitCode).toBe(true);
    }
  });

  it('offers a short list of units without refusing the rest', () => {
    expect(isUnitCode('DAY')).toBe(true);
    expect(UNIT_CODES.C62).toBe('one (a piece)');
    // Outside the short list, still a valid rec. 20 code, so the database
    // takes it: the list proposes, the constraint decides.
    expect(isUnitCode('XPP')).toBe(false);
    expect(isWellFormedUnitCode('XPP')).toBe(true);
    expect(isWellFormedUnitCode('kilogram')).toBe(false);
  });
});
