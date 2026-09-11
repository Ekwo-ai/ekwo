import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectError, freshDatabase, one } from './helpers/db.js';
import { newCompany, newContact, newDocument, type Fixture } from './helpers/factory.js';

let db: PGlite;
let fx: Fixture;

beforeAll(async () => {
  db = await freshDatabase();
  fx = await newCompany(db, { country: 'BE' });
});

afterAll(async () => {
  await db.close();
});

async function invoiceOn(date: string, number: string): Promise<string> {
  const customer = await newContact(db, fx.companyId, { name: `Client ${number}` });
  return newDocument(db, fx.companyId, {
    docType: 'sale_invoice',
    number,
    contactId: customer,
    date,
    lines: [{ unitPrice: 100, taxCode: 'BE-S-21', accountCode: '704000' }],
  });
}

describe('period locks', () => {
  it('refuses an entry on or before the accounting lock date', async () => {
    await db.query(`update companies set lock_date = date '2026-03-31' where id = $1`, [
      fx.companyId,
    ]);

    const doc = await invoiceOn('2026-03-15', 'FAC-LOCKED');
    expect(await expectError(db, `select post_document($1)`, [doc])).toMatch(/period_locked/);

    const onTheDay = await invoiceOn('2026-03-31', 'FAC-LOCK-DAY');
    expect(await expectError(db, `select post_document($1)`, [onTheDay])).toMatch(/period_locked/);
  });

  it('lets the day after the lock through', async () => {
    const doc = await invoiceOn('2026-04-01', 'FAC-AFTER-LOCK');
    await db.query(`select post_document($1)`, [doc]);
    const entry = await one<{ state: string }>(
      db,
      `select state from entries where document_id = $1`,
      [doc],
    );
    expect(entry.state).toBe('posted');
  });

  it('refuses a VAT-bearing entry before the tax lock date even when the accounting lock allows it', async () => {
    await db.query(
      `update companies set lock_date = null, tax_lock_date = date '2026-06-30' where id = $1`,
      [fx.companyId],
    );
    const doc = await invoiceOn('2026-05-20', 'FAC-TAXLOCK');
    expect(await expectError(db, `select post_document($1)`, [doc])).toMatch(/tax_period_locked/);
  });

  it('refuses anything inside a closed financial year', async () => {
    await db.query(`update companies set lock_date = null, tax_lock_date = null where id = $1`, [
      fx.companyId,
    ]);
    await db.query(
      `insert into fiscal_years (company_id, name, start_date, end_date, is_closed)
       values ($1, 'Exercice 2025', date '2025-01-01', date '2025-12-31', true)`,
      [fx.companyId],
    );
    const doc = await invoiceOn('2025-11-02', 'FAC-CLOSED');
    expect(await expectError(db, `select post_document($1)`, [doc])).toMatch(/fiscal_year_closed/);
  });

  it('still allows matching after the period is locked', async () => {
    const doc = await invoiceOn('2026-07-01', 'FAC-MATCH-AFTER');
    await db.query(`select post_document($1)`, [doc]);
    const receivable = await one<{ id: string }>(
      db,
      `select l.id from entry_lines l join entries e on e.id = l.entry_id
        join accounts a on a.id = l.account_id
       where e.document_id = $1 and a.code = '400000'`,
      [doc],
    );

    const entry = await one<{ id: string }>(
      db,
      `insert into entries (company_id, journal_id, entry_date, description, state)
       select $1, id, date '2026-07-05', 'Encaissement', 'draft' from journals
        where company_id = $1 and code = 'BNK' returning id`,
      [fx.companyId],
    );
    await db.query(
      `insert into entry_lines (entry_id, company_id, account_id, sequence, debit, credit)
       values ($1, $2, account_id_by_code($2, '550000'), 10, 121, 0)`,
      [entry.id, fx.companyId],
    );
    const credit = await one<{ id: string }>(
      db,
      `insert into entry_lines (entry_id, company_id, account_id, sequence, debit, credit)
       values ($1, $2, account_id_by_code($2, '400000'), 20, 0, 121) returning id`,
      [entry.id, fx.companyId],
    );
    await db.query(`select post_entry($1)`, [entry.id]);

    await db.query(`update companies set lock_date = date '2026-12-31' where id = $1`, [
      fx.companyId,
    ]);

    await db.query(`select reconcile($1, $2, null)`, [receivable.id, credit.id]);
    const line = await one<{ matching_number: string }>(
      db,
      `select matching_number from entry_lines where id = $1`,
      [receivable.id],
    );
    expect(line.matching_number).toMatch(/^A\d{4}$/);

    // ... but still refuses a new entry in the locked period.
    const blocked = await invoiceOn('2026-09-01', 'FAC-AFTER-FULL-LOCK');
    expect(await expectError(db, `select post_document($1)`, [blocked])).toMatch(/period_locked/);
  });
});

describe('entry integrity', () => {
  it('refuses to post an unbalanced entry', async () => {
    await db.query(`update companies set lock_date = null where id = $1`, [fx.companyId]);
    const entry = await one<{ id: string }>(
      db,
      `insert into entries (company_id, journal_id, entry_date, description, state)
       select $1, id, date '2026-10-01', 'Bancal', 'draft' from journals
        where company_id = $1 and code = 'MISC' returning id`,
      [fx.companyId],
    );
    await db.query(
      `insert into entry_lines (entry_id, company_id, account_id, sequence, debit, credit)
       values ($1, $2, account_id_by_code($2, '613000'), 10, 100, 0)`,
      [entry.id, fx.companyId],
    );
    expect(await expectError(db, `select post_entry($1)`, [entry.id])).toMatch(/entry_unbalanced/);
  });

  it('refuses a line carrying a debit and a credit at once', async () => {
    const entry = await one<{ id: string }>(
      db,
      `insert into entries (company_id, journal_id, entry_date, description, state)
       select $1, id, date '2026-10-02', 'Deux sens', 'draft' from journals
        where company_id = $1 and code = 'MISC' returning id`,
      [fx.companyId],
    );
    const message = await expectError(
      db,
      `insert into entry_lines (entry_id, company_id, account_id, sequence, debit, credit)
       values ($1, $2, account_id_by_code($2, '613000'), 10, 100, 50)`,
      [entry.id, fx.companyId],
    );
    expect(message).toMatch(/entry_lines_one_side/);
  });

  it('refuses a negative amount', async () => {
    const entry = await one<{ id: string }>(
      db,
      `insert into entries (company_id, journal_id, entry_date, description, state)
       select $1, id, date '2026-10-03', 'Negatif', 'draft' from journals
        where company_id = $1 and code = 'MISC' returning id`,
      [fx.companyId],
    );
    const message = await expectError(
      db,
      `insert into entry_lines (entry_id, company_id, account_id, sequence, debit, credit)
       values ($1, $2, account_id_by_code($2, '613000'), 10, -100, 0)`,
      [entry.id, fx.companyId],
    );
    expect(message).toMatch(/entry_lines_amounts_positive/);
  });

  it('refuses overlapping financial years', async () => {
    const message = await expectError(
      db,
      `insert into fiscal_years (company_id, name, start_date, end_date)
       values ($1, 'Doublon', date '2026-06-01', date '2027-05-31')`,
      [fx.companyId],
    );
    expect(message).toMatch(/fiscal_year_overlap/);
  });
});
