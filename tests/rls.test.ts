import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, expectError, freshDatabase, one, rows } from './helpers/db.js';
import {
  DEMO_OWNER,
  demoCompanyId,
  newCompany,
  newContact,
  newDocument,
  numberShape,
} from './helpers/factory.js';

let db: PGlite;
let companyId: string;
let accountantId: string;
let viewerId: string;
const strangerId = '00000000-0000-0000-0000-0000000000ff';

beforeAll(async () => {
  db = await freshDatabase();
  companyId = await demoCompanyId(db);
  accountantId = crypto.randomUUID();
  viewerId = crypto.randomUUID();
  await db.query(
    `insert into company_members (company_id, user_id, role) values ($1, $2, 'accountant'), ($1, $3, 'viewer')`,
    [companyId, accountantId, viewerId],
  );
});

afterAll(async () => {
  await db.close();
});

describe('row level security', () => {
  it('covers every table in the public schema', async () => {
    const unprotected = await rows<{ tablename: string }>(
      db,
      `select c.relname as tablename
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
        order by 1`,
    );
    expect(unprotected).toEqual([]);
  });

  it('gives every table at least a select policy', async () => {
    const bare = await rows<{ tablename: string }>(
      db,
      `select t.tablename from pg_tables t
        where t.schemaname = 'public'
          and not exists (select 1 from pg_policies p
                           where p.schemaname = 'public' and p.tablename = t.tablename)
        order by 1`,
    );
    expect(bare).toEqual([]);
  });

  it('hides a company from a user who is not a member', async () => {
    const visible = await asUser(db, strangerId, async () =>
      rows(db, `select id from companies`),
    );
    expect(visible).toEqual([]);

    const documents = await asUser(db, strangerId, async () =>
      rows(db, `select id from documents`),
    );
    expect(documents).toEqual([]);
  });

  it('lets a viewer read', async () => {
    const visible = await asUser(db, viewerId, async () =>
      rows<{ id: string }>(db, `select id from documents`),
    );
    expect(visible.length).toBeGreaterThan(0);
  });

  it('leaves a viewer unable to change anything', async () => {
    const contact = await newContact(db, companyId, { name: 'Intouchable' });
    await asUser(db, viewerId, async () => {
      await db.query(`update contacts set name = 'Change' where id = $1`, [contact]);
    });
    const after = await one<{ name: string }>(db, `select name from contacts where id = $1`, [
      contact,
    ]);
    expect(after.name).toBe('Intouchable');
  });

  it('refuses an insert by a viewer', async () => {
    const message = await asUser(db, viewerId, async () =>
      expectError(
        db,
        `insert into contacts (company_id, name, contact_type) values ($1, 'Interdit', 'customer')`,
        [companyId],
      ),
    );
    expect(message).toMatch(/row-level security|violates/i);
  });

  it('lets an accountant write', async () => {
    const created = await asUser(db, accountantId, async () =>
      one<{ id: string }>(
        db,
        `insert into contacts (company_id, name, contact_type) values ($1, 'Autorise', 'customer')
         returning id`,
        [companyId],
      ),
    );
    expect(created.id).toBeTruthy();
  });

  it('keeps the company record itself for the owner', async () => {
    await asUser(db, accountantId, async () => {
      await db.query(`update companies set city = 'Anvers' where id = $1`, [companyId]);
    });
    const untouched = await one<{ city: string }>(db, `select city from companies where id = $1`, [
      companyId,
    ]);
    expect(untouched.city).toBe('Bruxelles');

    await asUser(db, DEMO_OWNER, async () => {
      await db.query(`update companies set city = 'Anvers' where id = $1`, [companyId]);
    });
    const changed = await one<{ city: string }>(db, `select city from companies where id = $1`, [
      companyId,
    ]);
    expect(changed.city).toBe('Anvers');
  });

  it('does not let a second company leak into the first', async () => {
    const other = await newCompany(db, { name: 'Autre SRL' });
    const seen = await asUser(db, other.ownerId, async () =>
      rows<{ id: string }>(db, `select id from companies`),
    );
    expect(seen.map((c) => c.id)).toEqual([other.companyId]);

    const accounts = await asUser(db, other.ownerId, async () =>
      rows<{ company_id: string }>(db, `select distinct company_id from accounts`),
    );
    expect(accounts.map((a) => a.company_id)).toEqual([other.companyId]);
  });

  it('lets an accountant post and match, and not only read', async () => {
    // The counters behind next_entry_number() and next_matching_number() are
    // select-only tables, and the functions used to run as the caller: posting
    // worked for the table owner — which is what every other test is — and
    // failed for every signed-in user. The write path needs its own test.
    const customer = await newContact(db, companyId, { name: 'Client RLS' });
    const doc = await newDocument(db, companyId, {
      docType: 'sale_invoice',
      number: 'FAC-RLS-001',
      contactId: customer,
      date: '2026-09-15',
      lines: [{ unitPrice: 100, taxCode: 'BE-S-21', accountCode: '704000' }],
    });

    const entry = await asUser(db, accountantId, async () =>
      one<{ number: string; state: string }>(db, `select * from post_document($1)`, [doc]),
    );
    expect(entry.state).toBe('posted');
    expect(entry.number).toMatch(await numberShape(db, companyId, 'SAL', '2026-09-15'));

    // And money against it, which draws a matching letter from the other counter.
    const matching = await asUser(db, accountantId, async () => {
      const payment = await one<{ id: string }>(
        db,
        `insert into payments (company_id, direction, payment_date, amount, contact_id, journal_id)
         values ($1, 'inbound', date '2026-09-20', 121.00, $2,
                 (select id from journals where company_id = $1 and code = 'BNK'))
         returning id`,
        [companyId, customer],
      );
      await db.query(`select post_payment($1)`, [payment.id]);
      return one<{ matching_number: string }>(
        db,
        `select * from reconcile(
           (select l.id from entry_lines l join entries e on e.id = l.entry_id
             where e.document_id = $1 and l.contact_id = $2),
           (select l.id from entry_lines l join payments p on p.entry_id = l.entry_id
             where p.id = $3 and l.contact_id = $2))`,
        [doc, customer, payment.id],
      );
    });
    expect(matching.matching_number).toMatch(/^A\d{4}$/);
  });

  it('refuses an anonymous visitor at the table, before any policy is read', async () => {
    // Until `20260914151207` this read returned an empty set: the project's
    // default privileges gave `anon` SELECT — and INSERT, UPDATE and DELETE —
    // on every table, and row level security was the only thing between a
    // visitor and the books. The schema grants its own rights now, `anon`
    // holds none on any table, and the refusal arrives one layer earlier.
    const message = await asUser(
      db,
      strangerId,
      () => expectError(db, `select id from documents`),
      'anon',
    );
    expect(message).toMatch(/permission denied for table documents/);
  });
});
