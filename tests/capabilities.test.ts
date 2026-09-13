/**
 * A role is a preset; a capability is what a policy tests.
 *
 * The three roles keep exactly what they could do before the capability model
 * landed — that is the first half of this file, and it is the half that would
 * notice a regression. The second half is what the model adds: a capability
 * granted to one member, a capability revoked from one member, and a revoke
 * that is honoured on an owner.
 */

import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, expectError, freshDatabase, one, rows } from './helpers/db.js';
import { newCompany, newContact, newDocument, newUser } from './helpers/factory.js';

let db: PGlite;
let companyId: string;
let ownerId: string;
let accountantId: string;
let viewerId: string;
let strangerId: string;

/** The effective capabilities of a member, as the member sees them. */
async function capabilitiesOf(userId: string): Promise<string[]> {
  const seen = await asUser(db, userId, () =>
    rows<{ member_capabilities: string }>(db, `select member_capabilities($1)`, [companyId]),
  );
  return seen.map((row) => row.member_capabilities).sort();
}

async function member(role: 'accountant' | 'viewer'): Promise<string> {
  const id = await newUser(db);
  await db.query(`insert into company_members (company_id, user_id, role) values ($1, $2, $3)`, [
    companyId,
    id,
    role,
  ]);
  return id;
}

beforeAll(async () => {
  db = await freshDatabase();
  ({ companyId, ownerId } = await newCompany(db, { name: 'Capacites SRL' }));
  await db.query(`insert into auth.users (id, email) values ($1, $2) on conflict do nothing`, [
    ownerId,
    'owner@example.test',
  ]);
  accountantId = await member('accountant');
  viewerId = await member('viewer');
  strangerId = await newUser(db, 'stranger@capabilities.test');
});

afterAll(async () => {
  await db.close();
});

describe('the vocabulary', () => {
  it('is a table, and every code in it belongs to an area', async () => {
    const codes = await rows<{ code: string; area: string }>(
      db,
      `select code, area from capabilities order by code`,
    );
    expect(codes.length).toBeGreaterThan(15);
    for (const { code, area } of codes) {
      expect(code, code).toMatch(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/);
      expect(code.startsWith(`${area}.`), code).toBe(true);
    }
  });

  it('refuses a code nobody declared, wherever it is written', async () => {
    const message = await expectError(
      db,
      `update company_members set capabilities_granted = array['documents.burn']
        where company_id = $1 and user_id = $2`,
      [companyId, viewerId],
    );
    expect(message).toMatch(/unknown_capability: documents\.burn/);
  });
});

describe('the presets', () => {
  it('give a viewer every read and nothing else', async () => {
    const held = await capabilitiesOf(viewerId);
    expect(held.every((code) => code.endsWith('.read'))).toBe(true);
    expect(held).toContain('documents.read');
    expect(held).not.toContain('documents.write');
  });

  it('give an accountant the books, and not the members', async () => {
    const held = await capabilitiesOf(accountantId);
    expect(held).toContain('documents.post');
    expect(held).toContain('entries.post');
    expect(held).toContain('year_end.close');
    expect(held).not.toContain('members.manage');
    expect(held).not.toContain('company.write');
  });

  it('give an owner everything a preset carries, and not what no preset does', async () => {
    const held = await capabilitiesOf(ownerId);
    const preset = await rows<{ code: string }>(
      db,
      `select distinct capability as code from role_capabilities order by 1`,
    );
    expect(held).toEqual(preset.map((row) => row.code).sort());

    // `entries.import` is the one deliberately outside every preset: it lets
    // an explicit number through where the country forbids a hole, which is
    // granted for an import and taken back after it, never carried by a role.
    const outside = await rows<{ code: string }>(
      db,
      `select c.code from capabilities c
        where not exists (select 1 from role_capabilities r where r.capability = c.code)
        order by c.code`,
    );
    expect(outside.map((row) => row.code)).toEqual(['entries.import']);
    expect(held).not.toContain('entries.import');
  });

  it('give a stranger nothing at all', async () => {
    const answer = await asUser(db, strangerId, () =>
      one<{ has_capability: boolean }>(db, `select has_capability($1, 'documents.read')`, [
        companyId,
      ]),
    );
    expect(answer.has_capability).toBe(false);
  });
});

describe('what a preset lets somebody do', () => {
  it('leaves a viewer unable to post a document', async () => {
    const contact = await newContact(db, companyId, { name: 'Client capacites' });
    const doc = await newDocument(db, companyId, {
      docType: 'sale_invoice',
      number: 'FAC-CAP-001',
      contactId: contact,
      date: '2026-05-04',
      lines: [{ unitPrice: 100, taxCode: 'BE-S-21', accountCode: '704000' }],
    });
    // A viewer does not even see the draft to lock it: `documents.write` is
    // what `select … for update` needs, on top of `documents.read`.
    const unseen = await asUser(db, viewerId, () =>
      expectError(db, `select post_document($1)`, [doc]),
    );
    expect(unseen).toMatch(/unknown_document|row-level security/i);

    // Handed the two writes and neither of the posts, the same person gets as
    // far as the ledger and is refused there, by name. That is the line the
    // capability model draws and a role could not: keep the books, do not
    // book.
    await db.query(
      `update company_members
          set capabilities_granted = array['documents.write', 'entries.write']
        where company_id = $1 and user_id = $2`,
      [companyId, viewerId],
    );
    const refused = await asUser(db, viewerId, () =>
      expectError(db, `select post_document($1)`, [doc]),
    );
    expect(refused).toMatch(/not_allowed: .*entries\.post/);
    await db.query(
      `update company_members set capabilities_granted = '{}'
        where company_id = $1 and user_id = $2`,
      [companyId, viewerId],
    );

    // And the accountant, on the same document, can.
    const entry = await asUser(db, accountantId, () =>
      one<{ state: string }>(db, `select * from post_document($1)`, [doc]),
    );
    expect(entry.state).toBe('posted');
  });

  it('leaves an accountant unable to invite a member, where an owner can', async () => {
    const newcomer = await newUser(db);
    const refused = await asUser(db, accountantId, () =>
      expectError(
        db,
        `insert into company_members (company_id, user_id, role) values ($1, $2, 'viewer')`,
        [companyId, newcomer],
      ),
    );
    expect(refused).toMatch(/row-level security|violates/i);

    await asUser(db, ownerId, async () => {
      await db.query(
        `insert into company_members (company_id, user_id, role) values ($1, $2, 'viewer')`,
        [companyId, newcomer],
      );
    });
    const seen = await one<{ count: string }>(
      db,
      `select count(*)::text from company_members where company_id = $1 and user_id = $2`,
      [companyId, newcomer],
    );
    expect(seen.count).toBe('1');
  });

  it('leaves an accountant unable to change the company itself', async () => {
    await asUser(db, accountantId, async () => {
      await db.query(`update companies set city = 'Gand' where id = $1`, [companyId]);
    });
    const after = await one<{ city: string | null }>(db, `select city from companies where id = $1`, [
      companyId,
    ]);
    expect(after.city).toBeNull();
  });
});

describe('an adjustment on one member', () => {
  it('grants one capability without moving anybody to another role', async () => {
    await db.query(
      `update company_members set capabilities_granted = array['members.manage']
        where company_id = $1 and user_id = $2`,
      [companyId, accountantId],
    );

    const held = await capabilitiesOf(accountantId);
    expect(held).toContain('members.manage');
    expect(held).not.toContain('company.write');

    const invited = await newUser(db);
    await asUser(db, accountantId, async () => {
      await db.query(
        `insert into company_members (company_id, user_id, role) values ($1, $2, 'viewer')`,
        [companyId, invited],
      );
    });
    const seen = await one<{ count: string }>(
      db,
      `select count(*)::text from company_members where company_id = $1 and user_id = $2`,
      [companyId, invited],
    );
    expect(seen.count).toBe('1');

    // The role is untouched: it is a preset, not a permission.
    const role = await one<{ role: string }>(
      db,
      `select role::text from company_members where company_id = $1 and user_id = $2`,
      [companyId, accountantId],
    );
    expect(role.role).toBe('accountant');
  });

  it('revokes one capability from an owner, and the revoke wins', async () => {
    await db.query(
      `update company_members
          set capabilities_revoked = array['year_end.close'],
              capabilities_granted = array['year_end.close']
        where company_id = $1 and user_id = $2`,
      [companyId, ownerId],
    );

    const held = await capabilitiesOf(ownerId);
    expect(held).not.toContain('year_end.close');

    const year = await one<{ id: string }>(
      db,
      `select id from fiscal_years where company_id = $1 order by start_date limit 1`,
      [companyId],
    );
    const message = await asUser(db, ownerId, () =>
      expectError(db, `select close_fiscal_year($1)`, [year.id]),
    );
    expect(message).toMatch(/not_allowed: closing or re-opening a financial year needs year_end\.close/);

    await db.query(
      `update company_members set capabilities_revoked = '{}', capabilities_granted = '{}'
        where company_id = $1 and user_id = $2`,
      [companyId, ownerId],
    );
  });

  it('lets a viewer be handed exactly one write, and no more', async () => {
    await db.query(
      `update company_members set capabilities_granted = array['contacts.write']
        where company_id = $1 and user_id = $2`,
      [companyId, viewerId],
    );

    const created = await asUser(db, viewerId, () =>
      one<{ id: string }>(
        db,
        `insert into contacts (company_id, name, contact_type) values ($1, 'Ajoute par la lectrice', 'customer')
         returning id`,
        [companyId],
      ),
    );
    expect(created.id).toBeTruthy();

    const refused = await asUser(db, viewerId, () =>
      expectError(
        db,
        `insert into products (company_id, code, name) values ($1, 'P-CAP', 'Interdit')`,
        [companyId],
      ),
    );
    expect(refused).toMatch(/row-level security|violates/i);

    await db.query(
      `update company_members set capabilities_granted = '{}'
        where company_id = $1 and user_id = $2`,
      [companyId, viewerId],
    );
  });

  it('refuses to say what another member may do, without members.manage', async () => {
    const message = await asUser(db, viewerId, () =>
      expectError(db, `select member_capabilities($1, $2)`, [companyId, ownerId]),
    );
    expect(message).toMatch(/not_allowed: reading what another member may do needs members\.manage/);
  });
});

describe('the counters a definer function writes', () => {
  // The guard was written the day the counters became SECURITY DEFINER, and
  // it never fired: `company_role()` returns NULL for a stranger, `NULL in
  // ('owner','accountant')` is NULL, and `if not NULL then raise` does
  // nothing. So anyone signed in could burn numbers in any journal of the
  // installation — which is the one thing the guard existed to stop.
  it('refuse a stranger who asks for a number in a journal that is not theirs', async () => {
    const journal = await one<{ id: string }>(
      db,
      `select id from journals where company_id = $1 and code = 'SAL'`,
      [companyId],
    );
    const message = await asUser(db, strangerId, () =>
      expectError(db, `select next_entry_number($1, date '2026-06-01')`, [journal.id]),
    );
    expect(message).toMatch(/not_allowed: drawing a number in this company needs entries\.post/);

    const matching = await asUser(db, strangerId, () =>
      expectError(db, `select next_matching_number($1)`, [companyId]),
    );
    expect(matching).toMatch(/not_allowed: matching in this company needs reconcile\.write/);
  });
});

describe('the anonymous role', () => {
  it('may evaluate the policy helper and nothing more', async () => {
    const answer = await asUser(
      db,
      strangerId,
      () => one<{ has_capability: boolean }>(db, `select has_capability($1, 'documents.read')`, [companyId]),
      'anon',
    );
    expect(answer.has_capability).toBe(false);

    const message = await asUser(
      db,
      strangerId,
      () => expectError(db, `select member_capabilities($1)`, [companyId]),
      'anon',
    );
    expect(message).toMatch(/permission denied for function member_capabilities/);
  });
});
