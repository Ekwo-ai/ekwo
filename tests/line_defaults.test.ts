/**
 * The account a document line falls back to.
 *
 * Order, from the most specific: the line, the company default, the country
 * model. It runs in a trigger rather than in a client, because
 * `document_lines_product_has_account` forbids a product line with no account
 * — so a null account can only ever mean "resolve it", and every client that
 * inserts a line has to get the same answer.
 *
 * `country_defaults.sales_account_code` and `purchase_account_code` are the
 * two columns this gives a reader to. Before it, they were declared and never
 * read, which is the state the naming policy forbids.
 */

import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, expectError, freshDatabase, one, rows } from './helpers/db.js';
import { accountId, newCompany, newContact, type Fixture } from './helpers/factory.js';

let db: PGlite;
let be: Fixture;
let fr: Fixture;
let beCustomer: string;
let beSupplier: string;

/** A draft document with one line that names no account at all. */
async function lineWithoutAccount(
  companyId: string,
  contactId: string,
  docType: string,
): Promise<string | null> {
  const doc = await one<{ id: string }>(
    db,
    `insert into documents (company_id, doc_type, contact_id, document_date)
     values ($1, $2::doc_type, $3, date '2026-06-15') returning id`,
    [companyId, docType, contactId],
  );
  const line = await one<{ code: string | null }>(
    db,
    `with inserted as (
       insert into document_lines (document_id, company_id, name, quantity, unit_price)
       values ($1, $2, 'Sans compte', 1, 100)
       returning account_id
     )
     select a.code from inserted i left join accounts a on a.id = i.account_id`,
    [doc.id, companyId],
  );
  return line.code;
}

beforeAll(async () => {
  db = await freshDatabase();
  be = await newCompany(db, { country: 'BE', name: 'Defaults BE SRL' });
  fr = await newCompany(db, { country: 'FR', name: 'Defaults FR SAS' });
  beCustomer = await newContact(db, be.companyId, { type: 'customer' });
  beSupplier = await newContact(db, be.companyId, { type: 'supplier' });
});

afterAll(async () => {
  await db.close();
});

describe('install_country_template', () => {
  it('wires the two imputation defaults of the country model', async () => {
    const wired = await one<{ sales: string; purchase: string }>(
      db,
      `select s.code as sales, p.code as purchase
         from companies c
         join accounts s on s.id = c.default_sales_account_id
         join accounts p on p.id = c.default_purchase_account_id
        where c.id = $1`,
      [be.companyId],
    );
    expect(wired.sales).toBe('700000');
    expect(wired.purchase).toBe('610000');

    const french = await one<{ sales: string; purchase: string }>(
      db,
      `select s.code as sales, p.code as purchase
         from companies c
         join accounts s on s.id = c.default_sales_account_id
         join accounts p on p.id = c.default_purchase_account_id
        where c.id = $1`,
      [fr.companyId],
    );
    expect(french.sales).toBe('706000');
    expect(french.purchase).toBe('606300');
  });
});

describe('a line that names no account', () => {
  it('takes the sales default on a sale and the purchase default on a purchase', async () => {
    expect(await lineWithoutAccount(be.companyId, beCustomer, 'sale_invoice')).toBe('700000');
    expect(await lineWithoutAccount(be.companyId, beSupplier, 'purchase_invoice')).toBe('610000');
  });

  it('follows the document, so a credit note lands on the same side as its invoice', async () => {
    expect(await lineWithoutAccount(be.companyId, beCustomer, 'sale_credit_note')).toBe('700000');
    expect(await lineWithoutAccount(be.companyId, beSupplier, 'purchase_credit_note')).toBe('610000');
  });

  it('keeps the account the line names, whatever the defaults say', async () => {
    const doc = await one<{ id: string }>(
      db,
      `insert into documents (company_id, doc_type, contact_id, document_date)
       values ($1, 'sale_invoice', $2, date '2026-06-15') returning id`,
      [be.companyId, beCustomer],
    );
    const line = await one<{ code: string }>(
      db,
      `with inserted as (
         insert into document_lines (document_id, company_id, name, unit_price, account_id)
         values ($1, $2, 'Compte choisi', 100, account_id_by_code($2, '700300'))
         returning account_id
       )
       select a.code from inserted i join accounts a on a.id = i.account_id`,
      [doc.id, be.companyId],
    );
    expect(line.code).toBe('700300');
  });

  it('prefers the company default to the country model', async () => {
    const chosen = await accountId(db, be.companyId, '700100');
    await db.query('update companies set default_sales_account_id = $1 where id = $2', [
      chosen,
      be.companyId,
    ]);
    expect(await lineWithoutAccount(be.companyId, beCustomer, 'sale_invoice')).toBe('700100');

    // And back, so the rest of the file reads the country model again.
    await db.query(
      `update companies set default_sales_account_id = account_id_by_code($1, '700000') where id = $1`,
      [be.companyId],
    );
  });

  it('refuses the line when nothing anywhere has an answer', async () => {
    const orphan = await newCompany(db, { country: 'BE', name: 'Sans defaut SRL' });
    const contact = await newContact(db, orphan.companyId);
    await db.query(
      'update companies set default_sales_account_id = null, default_purchase_account_id = null where id = $1',
      [orphan.companyId],
    );
    await db.query(`update country_defaults set sales_account_code = null where country = 'BE'`);

    const doc = await one<{ id: string }>(
      db,
      `insert into documents (company_id, doc_type, contact_id, document_date)
       values ($1, 'sale_invoice', $2, date '2026-06-15') returning id`,
      [orphan.companyId, contact],
    );
    // This is the check constraint that has been there since the first
    // release, and it is what makes a null account unambiguous.
    const message = await expectError(
      db,
      `insert into document_lines (document_id, company_id, name, unit_price)
       values ($1, $2, 'Rien nulle part', 100)`,
      [doc.id, orphan.companyId],
    );
    expect(message).toMatch(/document_lines_product_has_account/);

    await db.query(
      `update country_defaults set sales_account_code = '700000' where country = 'BE'`,
    );
  });
});

describe('under row level security', () => {
  it('resolves for an accountant, who may write, and refuses a viewer outright', async () => {
    const accountantId = crypto.randomUUID();
    const viewerId = crypto.randomUUID();
    await db.query(
      `insert into company_members (company_id, user_id, role)
       values ($1, $2, 'accountant'), ($1, $3, 'viewer')`,
      [be.companyId, accountantId, viewerId],
    );

    const doc = await one<{ id: string }>(
      db,
      `insert into documents (company_id, doc_type, contact_id, document_date)
       values ($1, 'sale_invoice', $2, date '2026-06-15') returning id`,
      [be.companyId, beCustomer],
    );

    // The trigger reads `companies` and `country_defaults` as the caller. A
    // definer function would have hidden whether those reads are allowed; they
    // are, and this is where that is proved.
    const resolved = await asUser(db, accountantId, async () => {
      const inserted = await rows<{ code: string }>(
        db,
        `with inserted as (
           insert into document_lines (document_id, company_id, name, unit_price)
           values ($1, $2, 'Sous RLS', 100)
           returning account_id
         )
         select a.code from inserted i join accounts a on a.id = i.account_id`,
        [doc.id, be.companyId],
      );
      return inserted[0]?.code;
    });
    expect(resolved).toBe('700000');

    const refused = await asUser(db, viewerId, async () =>
      expectError(
        db,
        `insert into document_lines (document_id, company_id, name, unit_price)
         values ($1, $2, 'Refuse', 100)`,
        [doc.id, be.companyId],
      ),
    );
    expect(refused).toMatch(/row-level security/);
  });
});
