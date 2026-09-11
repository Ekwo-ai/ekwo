import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, expectError, freshDatabase, one, rows } from './helpers/db.js';
import { demoCompanyId, DEMO_OWNER, newCompany, newContact } from './helpers/factory.js';

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

  it('shows nothing at all to an anonymous visitor', async () => {
    const seen = await asUser(db, strangerId, async () => rows(db, `select id from documents`), 'anon');
    expect(seen).toEqual([]);
  });
});
