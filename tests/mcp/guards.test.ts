/**
 * What the server refuses, and why it is the database that refuses it.
 *
 * A locked period, a viewer trying to write, a member of one company reaching
 * for another: none of these is checked in TypeScript. The server asks, the
 * policies and the triggers answer, and the refusal travels back with the
 * code the schema raised. That is the whole security model, so it is the part
 * worth proving.
 */

import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readTools, writeTools, type Backend } from '../../packages/mcp/src/index.js';
import { freshDatabase } from '../helpers/db.js';
import { newCompany, type Fixture } from '../helpers/factory.js';
import { backendFor, list, record } from './helpers.js';

let db: PGlite;
let one: Fixture;
let two: Fixture;
let owner: Backend;
let viewer: Backend;
let stranger: Backend;
let otherOwner: Backend;
let customerId: string;

beforeAll(async () => {
  db = await freshDatabase();
  one = await newCompany(db, { country: 'BE', name: 'Une SRL' });
  two = await newCompany(db, { country: 'BE', name: 'Autre SRL' });

  const viewerId = crypto.randomUUID();
  await db.query(
    `insert into company_members (company_id, user_id, role) values ($1, $2, 'viewer')`,
    [one.companyId, viewerId],
  );

  owner = backendFor(db, one.ownerId);
  viewer = backendFor(db, viewerId);
  stranger = backendFor(db, crypto.randomUUID());
  otherOwner = backendFor(db, two.ownerId);

  const contact = record(
    await writeTools.createContact(owner, {
      company_id: one.companyId,
      name: 'Client verrou',
      contact_type: 'customer',
    }),
  );
  customerId = String(record(contact['contact'])['id']);
});

afterAll(async () => {
  await db.close();
});

describe('a locked period', () => {
  it('refuses a posting on or before the lock date, and says so', async () => {
    const locked = record(
      await writeTools.lockPeriod(owner, { company_id: one.companyId, lock_date: '2026-06-30' }),
    );
    expect(record(locked['company'])['lock_date']).toBe('2026-06-30');

    const draft = record(
      await writeTools.createDocument(owner, {
        company_id: one.companyId,
        doc_type: 'sale_invoice',
        contact_id: customerId,
        document_date: '2026-06-15',
        lines: [{ name: 'Trop tard', unit_price: '100.00', account_code: '704000', tax_code: 'BE-S-21' }],
      }),
    );
    const documentId = String(record(draft['document'])['id']);

    await expect(writeTools.postDocument(owner, { document_id: documentId })).rejects.toThrow(
      /period_locked/,
    );

    // And the same document books fine after the lock date.
    await writeTools.updateDocumentLines(owner, {
      document_id: documentId,
      lines: [{ name: 'Plus tard', unit_price: '100.00', account_code: '704000', tax_code: 'BE-S-21' }],
    });
    await db.query(`update documents set document_date = date '2026-07-15' where id = $1`, [
      documentId,
    ]);
    const posted = record(await writeTools.postDocument(owner, { document_id: documentId }));
    expect(record(posted['entry'])['state']).toBe('posted');
  });

  it('carries the sentence that says what to do about it', async () => {
    const draft = record(
      await writeTools.createDocument(owner, {
        company_id: one.companyId,
        doc_type: 'sale_invoice',
        contact_id: customerId,
        document_date: '2026-05-15',
        lines: [{ name: 'Encore trop tôt', unit_price: '10.00', account_code: '704000' }],
      }),
    );
    try {
      await writeTools.postDocument(owner, {
        document_id: String(record(draft['document'])['id']),
      });
      throw new Error('expected a refusal');
    } catch (error) {
      const failure = error as { message: string; code?: string; hint?: string };
      expect(failure.code).toBe('period_locked');
      expect(failure.hint).toMatch(/lock date/i);
    }
  });
});

describe('a viewer', () => {
  it('reads the books', async () => {
    const companies = record(await readTools.listCompanies(viewer));
    expect(list(companies['companies']).map((row) => row['name'])).toEqual(['Une SRL']);
    const contacts = record(await readTools.searchContacts(viewer, { company_id: one.companyId }));
    expect(list(contacts['contacts']).length).toBeGreaterThan(0);
  });

  it('is refused every write, by the policy rather than by this server', async () => {
    await expect(
      writeTools.createContact(viewer, {
        company_id: one.companyId,
        name: 'Interdit',
        contact_type: 'customer',
      }),
    ).rejects.toThrow(/row-level security|violates/i);

    await expect(
      writeTools.createDocument(viewer, {
        company_id: one.companyId,
        doc_type: 'sale_invoice',
        contact_id: customerId,
        document_date: '2026-07-15',
        lines: [{ name: 'Interdit', unit_price: '10.00', account_code: '704000' }],
      }),
    ).rejects.toThrow(/row-level security|violates/i);

    await expect(
      writeTools.lockPeriod(viewer, { company_id: one.companyId, lock_date: '2026-12-31' }),
    ).rejects.toThrow(/not_owner/);
  });
});

describe('two companies in one installation', () => {
  it('shows each member only their own', async () => {
    const mine = record(await readTools.listCompanies(owner));
    expect(list(mine['companies']).map((row) => row['id'])).toEqual([one.companyId]);

    const theirs = record(await readTools.listCompanies(otherOwner));
    expect(list(theirs['companies']).map((row) => row['id'])).toEqual([two.companyId]);
  });

  it('refuses to read a company you were not invited to', async () => {
    await expect(readTools.getCompany(otherOwner, { company_id: one.companyId })).rejects.toThrow(
      /not_found/,
    );
    const accounts = record(
      await readTools.listAccounts(otherOwner, { company_id: one.companyId, code_prefix: '7' }),
    );
    expect(list(accounts['accounts'])).toEqual([]);
  });

  it('shows a stranger nothing at all', async () => {
    const nothing = record(await readTools.listCompanies(stranger));
    expect(list(nothing['companies'])).toEqual([]);
    const state = record(await readTools.status(stranger));
    expect(list(state['companies'])).toEqual([]);
  });

  it('refuses to write into a company you are not a member of', async () => {
    await expect(
      writeTools.createContact(otherOwner, {
        company_id: one.companyId,
        name: 'Intrus',
        contact_type: 'customer',
      }),
    ).rejects.toThrow(/row-level security|violates/i);
  });
});
