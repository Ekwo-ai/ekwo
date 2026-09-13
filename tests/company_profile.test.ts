/**
 * A company has a face, and an invoice has to print it.
 *
 * The assertions that matter are the two fallbacks — a capital stated with no
 * currency, and a sales document with no IBAN — because both are places where
 * a literal could have been written into the schema and was not.
 */

import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, expectError, freshDatabase, one, rows } from './helpers/db.js';
import { newCompany, newContact, newDocument, newUser } from './helpers/factory.js';

let db: PGlite;
let companyId: string;
let ownerId: string;
let accountantId: string;
let contactId: string;
let bankAccountId: string;

beforeAll(async () => {
  db = await freshDatabase();
  ({ companyId, ownerId } = await newCompany(db, { name: 'Profil SRL' }));
  await db.query(`insert into auth.users (id, email) values ($1, $2) on conflict do nothing`, [
    ownerId,
    'owner@profile.test',
  ]);
  accountantId = await newUser(db, 'accountant@profile.test');
  await db.query(
    `insert into company_members (company_id, user_id, role) values ($1, $2, 'accountant')`,
    [companyId, accountantId],
  );
  contactId = await newContact(db, companyId, { name: 'Cliente du profil' });
  const bank = await one<{ id: string }>(
    db,
    `insert into bank_accounts (company_id, name, iban, account_id, journal_id)
     values ($1, 'Banque', 'BE68539007547034', account_id_by_code($1, '550000'),
             (select id from journals where company_id = $1 and code = 'BNK'))
     returning id`,
    [companyId],
  );
  bankAccountId = bank.id;
});

afterAll(async () => {
  await db.close();
});

describe('the capital a company states', () => {
  it('takes the currency of the company when none is given', async () => {
    await db.query(`update companies set share_capital = 61500 where id = $1`, [companyId]);
    const stored = await one<{ share_capital: string; share_capital_currency: string; currency_code: string }>(
      db,
      `select share_capital::text, share_capital_currency, currency_code from companies where id = $1`,
      [companyId],
    );
    expect(stored.share_capital).toBe('61500.00');
    expect(stored.share_capital_currency).toBe(stored.currency_code);
  });

  it('keeps the currency that was given', async () => {
    await db.query(
      `update companies set share_capital = 61500, share_capital_currency = 'USD' where id = $1`,
      [companyId],
    );
    const stored = await one<{ share_capital_currency: string }>(
      db,
      `select share_capital_currency from companies where id = $1`,
      [companyId],
    );
    expect(stored.share_capital_currency).toBe('USD');
    await db.query(
      `update companies set share_capital_currency = null, share_capital = 61500 where id = $1`,
      [companyId],
    );
  });
});

describe('the account a customer pays into', () => {
  it('has to belong to the company', async () => {
    const other = await newCompany(db, { name: 'Autre profil SRL' });
    const foreign = await one<{ id: string }>(
      db,
      `insert into bank_accounts (company_id, name, iban, account_id, journal_id)
       values ($1, 'Banque', 'BE68539007547035', account_id_by_code($1, '550000'),
               (select id from journals where company_id = $1 and code = 'BNK'))
       returning id`,
      [other.companyId],
    );
    const message = await expectError(
      db,
      `update companies set default_bank_account_id = $1 where id = $2`,
      [foreign.id, companyId],
    );
    expect(message).toMatch(/foreign_bank_account/);
  });

  it('fills the payee IBAN of a sales document that names none', async () => {
    await db.query(`update companies set default_bank_account_id = $1 where id = $2`, [
      bankAccountId,
      companyId,
    ]);

    const sale = await newDocument(db, companyId, {
      docType: 'sale_invoice',
      number: 'FAC-PROFIL-001',
      contactId,
      lines: [{ unitPrice: 100, taxCode: 'BE-S-21', accountCode: '704000' }],
    });
    const filled = await one<{ payee_iban: string }>(
      db,
      `select payee_iban from documents where id = $1`,
      [sale],
    );
    expect(filled.payee_iban).toBe('BE68539007547034');
  });

  it('leaves a purchase document alone, because the payee there is somebody else', async () => {
    const supplier = await newContact(db, companyId, { name: 'Fournisseur', type: 'supplier' });
    const purchase = await newDocument(db, companyId, {
      docType: 'purchase_invoice',
      number: 'ACH-PROFIL-001',
      contactId: supplier,
      lines: [{ unitPrice: 100, taxCode: 'BE-P-21-S', accountCode: '613000' }],
    });
    const untouched = await one<{ payee_iban: string | null }>(
      db,
      `select payee_iban from documents where id = $1`,
      [purchase],
    );
    expect(untouched.payee_iban).toBeNull();
  });

  it('never overwrites an IBAN the document carries', async () => {
    const sale = await one<{ payee_iban: string }>(
      db,
      `insert into documents (company_id, doc_type, number, contact_id, document_date, payee_iban)
       values ($1, 'sale_invoice', 'FAC-PROFIL-002', $2, date '2026-06-15', 'BE00000000000099')
       returning payee_iban`,
      [companyId, contactId],
    );
    expect(sale.payee_iban).toBe('BE00000000000099');
  });
});

describe('withdrawing the account a company points at', () => {
  it('clears the default rather than refusing the delete', async () => {
    const spare = await one<{ id: string }>(
      db,
      `insert into bank_accounts (company_id, name, iban, account_id, journal_id)
       values ($1, 'Seconde banque', 'BE68539007547036', account_id_by_code($1, '550000'),
               (select id from journals where company_id = $1 and code = 'BNK'))
       returning id`,
      [companyId],
    );
    await db.query(`update companies set default_bank_account_id = $1 where id = $2`, [
      spare.id,
      companyId,
    ]);
    await db.query(`delete from bank_accounts where id = $1`, [spare.id]);
    const after = await one<{ default_bank_account_id: string | null }>(
      db,
      `select default_bank_account_id from companies where id = $1`,
      [companyId],
    );
    expect(after.default_bank_account_id).toBeNull();

    await db.query(`update companies set default_bank_account_id = $1 where id = $2`, [
      bankAccountId,
      companyId,
    ]);
  });
});

describe('document_header', () => {
  it('hands a renderer the seller, the buyer and the rules of the country in one read', async () => {
    const header = await one<Record<string, unknown>>(
      db,
      `select * from document_header where number = 'FAC-PROFIL-001'`,
    );
    expect(header['seller_name']).toBe('Profil SRL');
    expect(header['buyer_name']).toBe('Cliente du profil');
    expect(header['payee_iban']).toBe('BE68539007547034');
    expect(header['seller_share_capital']).toBe('61500.00');
    // The country of a document is the company's fiscal country, and the rules
    // are the pack's — asserted against the row rather than against a value
    // typed here.
    const pack = await one<{ country: string; number_format: string; legal_payment_days: number }>(
      db,
      `select d.country, d.number_format, d.legal_payment_days
         from country_defaults d join companies c on c.fiscal_country = d.country
        where c.id = $1`,
      [companyId],
    );
    expect(header['country']).toBe(pack.country);
    expect(header['number_format']).toBe(pack.number_format);
    expect(header['legal_payment_days']).toBe(pack.legal_payment_days);
  });

  it('shows a trade name where there is one, and the legal name beside it', async () => {
    await db.query(
      `update companies set trade_name = 'Profil', legal_name = 'Profil SRL' where id = $1`,
      [companyId],
    );
    const header = await one<{ seller_name: string; seller_legal_name: string }>(
      db,
      `select seller_name, seller_legal_name from document_header where number = 'FAC-PROFIL-001'`,
    );
    expect(header.seller_name).toBe('Profil');
    expect(header.seller_legal_name).toBe('Profil SRL');
  });

  it('shows nothing to somebody who may not read the document', async () => {
    const stranger = await newUser(db, 'stranger@profile.test');
    const seen = await asUser(db, stranger, () => rows(db, `select document_id from document_header`));
    expect(seen).toEqual([]);
  });
});

describe('who may change the profile', () => {
  it('is company.write, which the accountant preset does not hold', async () => {
    await asUser(db, accountantId, async () => {
      await db.query(`update companies set trade_name = 'Pirate' where id = $1`, [companyId]);
    });
    const untouched = await one<{ trade_name: string }>(
      db,
      `select trade_name from companies where id = $1`,
      [companyId],
    );
    expect(untouched.trade_name).toBe('Profil');

    await asUser(db, ownerId, async () => {
      await db.query(`update companies set trade_name = 'Profil & Cie' where id = $1`, [companyId]);
    });
    const changed = await one<{ trade_name: string }>(
      db,
      `select trade_name from companies where id = $1`,
      [companyId],
    );
    expect(changed.trade_name).toBe('Profil & Cie');
  });
});
