/**
 * Inviting somebody who does not have an account yet.
 *
 * Everything here runs as a signed-in user, because that is the only way the
 * checks mean anything: the token, the address, the single use and the
 * expiry are all refusals aimed at somebody holding a session.
 */

import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, expectError, freshDatabase, one, rows } from './helpers/db.js';
import { newCompany, newUser } from './helpers/factory.js';

let db: PGlite;
let companyId: string;
let ownerId: string;
let accountantId: string;
let inviteeId: string;
let strangerId: string;

interface Invitation {
  invitation_id: string;
  token: string;
  expires_at: string;
}

async function invite(
  as: string,
  email: string,
  role = 'viewer',
  capabilities: string[] = [],
): Promise<Invitation> {
  return asUser(db, as, () =>
    one<Invitation>(db, `select * from invite_member($1, $2, $3::member_role, $4::jsonb)`, [
      companyId,
      email,
      role,
      JSON.stringify(capabilities),
    ]),
  );
}

beforeAll(async () => {
  db = await freshDatabase();
  ({ companyId, ownerId } = await newCompany(db, { name: 'Invitations SRL' }));
  await db.query(`insert into auth.users (id, email) values ($1, $2) on conflict do nothing`, [
    ownerId,
    'owner@invitations.test',
  ]);
  accountantId = await newUser(db, 'accountant@invitations.test');
  await db.query(
    `insert into company_members (company_id, user_id, role) values ($1, $2, 'accountant')`,
    [companyId, accountantId],
  );
  inviteeId = await newUser(db, 'Newcomer@Invitations.test');
  strangerId = await newUser(db, 'stranger@invitations.test');
});

afterAll(async () => {
  await db.close();
});

describe('issuing an invitation', () => {
  it('returns the token once, and keeps only its hash', async () => {
    const created = await invite(ownerId, 'first@invitations.test');
    expect(created.token).toMatch(/^[0-9a-f]{64}$/);

    const stored = await one<{ token_hash: string; email: string; role: string }>(
      db,
      `select token_hash, email, role::text from company_invitations where id = $1`,
      [created.invitation_id],
    );
    expect(stored.token_hash).not.toBe(created.token);
    expect(stored.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.email).toBe('first@invitations.test');
    expect(stored.role).toBe('viewer');
  });

  it('lower-cases the address it was given', async () => {
    const created = await invite(ownerId, '  MiXeD@Invitations.Test ');
    const stored = await one<{ email: string }>(
      db,
      `select email from company_invitations where id = $1`,
      [created.invitation_id],
    );
    expect(stored.email).toBe('mixed@invitations.test');
  });

  it('needs members.manage, which an accountant does not have by preset', async () => {
    const message = await asUser(db, accountantId, () =>
      expectError(db, `select * from invite_member($1, $2)`, [companyId, 'nope@invitations.test']),
    );
    expect(message).toMatch(/not_allowed: inviting somebody into this company needs members\.manage/);

    await db.query(
      `update company_members set capabilities_granted = array['members.manage']
        where company_id = $1 and user_id = $2`,
      [companyId, accountantId],
    );
    const created = await invite(accountantId, 'byaccountant@invitations.test');
    expect(created.invitation_id).toBeTruthy();
    await db.query(
      `update company_members set capabilities_granted = '{}'
        where company_id = $1 and user_id = $2`,
      [companyId, accountantId],
    );
  });

  it('refuses a capability nobody declared', async () => {
    const message = await asUser(db, ownerId, () =>
      expectError(db, `select * from invite_member($1, $2, 'viewer', '["books.burn"]'::jsonb)`, [
        companyId,
        'typo@invitations.test',
      ]),
    );
    expect(message).toMatch(/unknown_capability: books\.burn/);
  });

  it('replaces a pending invitation for the same address rather than adding a second', async () => {
    const first = await invite(ownerId, 'twice@invitations.test');
    const second = await invite(ownerId, 'twice@invitations.test');

    const live = await rows<{ id: string }>(
      db,
      `select id from company_invitations
        where company_id = $1 and email = 'twice@invitations.test'
          and accepted_at is null and revoked_at is null`,
      [companyId],
    );
    expect(live.map((row) => row.id)).toEqual([second.invitation_id]);
    expect(first.invitation_id).not.toBe(second.invitation_id);
  });
});

describe('accepting one', () => {
  it('makes the invitee a member with the preset and the capabilities that were invited', async () => {
    const created = await invite(ownerId, 'newcomer@invitations.test', 'viewer', [
      'documents.write',
    ]);

    const membership = await asUser(db, inviteeId, () =>
      one<{ role: string; capabilities_granted: string[] }>(
        db,
        `select role::text, capabilities_granted from accept_invitation($1)`,
        [created.token],
      ),
    );
    expect(membership.role).toBe('viewer');
    expect(membership.capabilities_granted).toEqual(['documents.write']);

    // And it is a real membership: the new member reads, and writes the one
    // thing they were granted beyond their preset.
    const held = await asUser(db, inviteeId, () =>
      rows<{ member_capabilities: string }>(db, `select member_capabilities($1)`, [companyId]),
    );
    expect(held.map((row) => row.member_capabilities)).toContain('documents.write');

    const invitation = await one<{ accepted_by: string; accepted_at: string }>(
      db,
      `select accepted_by, accepted_at::text from company_invitations where id = $1`,
      [created.invitation_id],
    );
    expect(invitation.accepted_by).toBe(inviteeId);
    expect(invitation.accepted_at).not.toBeNull();
  });

  it('is refused to somebody signed in with another address', async () => {
    const created = await invite(ownerId, 'meant-for-her@invitations.test');
    const message = await asUser(db, strangerId, () =>
      expectError(db, `select * from accept_invitation($1)`, [created.token]),
    );
    expect(message).toMatch(/invitation_not_yours/);
  });

  it('works once', async () => {
    const used = await one<{ token_hash: string }>(
      db,
      `select token_hash from company_invitations where email = 'newcomer@invitations.test'
        and accepted_at is not null limit 1`,
    );
    expect(used.token_hash).toBeTruthy();

    // The token itself is gone — only its hash was kept — so a second
    // acceptance is tried with a fresh invitation to the same person.
    const again = await invite(ownerId, 'newcomer@invitations.test');
    await asUser(db, inviteeId, () =>
      one(db, `select * from accept_invitation($1)`, [again.token]),
    );
    const message = await asUser(db, inviteeId, () =>
      expectError(db, `select * from accept_invitation($1)`, [again.token]),
    );
    expect(message).toMatch(/invitation_already_accepted/);
  });

  it('is refused once it has expired', async () => {
    const created = await invite(ownerId, 'late@invitations.test');
    await db.query(
      `update company_invitations
          set created_at = now() - interval '30 days', expires_at = now() - interval '1 day'
        where id = $1`,
      [created.invitation_id],
    );
    await db.query(`insert into auth.users (id, email) values ($1, 'late@invitations.test')`, [
      '33333333-3333-4333-8333-333333333333',
    ]);
    const message = await asUser(db, '33333333-3333-4333-8333-333333333333', () =>
      expectError(db, `select * from accept_invitation($1)`, [created.token]),
    );
    expect(message).toMatch(/invitation_expired/);
  });

  it('is refused once it has been withdrawn', async () => {
    const created = await invite(ownerId, 'withdrawn@invitations.test');
    await asUser(db, ownerId, () =>
      one(db, `select * from revoke_invitation($1)`, [created.invitation_id]),
    );
    await db.query(`insert into auth.users (id, email) values ($1, 'withdrawn@invitations.test')`, [
      '44444444-4444-4444-8444-444444444444',
    ]);
    const message = await asUser(db, '44444444-4444-4444-8444-444444444444', () =>
      expectError(db, `select * from accept_invitation($1)`, [created.token]),
    );
    expect(message).toMatch(/invitation_revoked/);
  });

  it('refuses a token that is not one', async () => {
    const message = await asUser(db, strangerId, () =>
      expectError(db, `select * from accept_invitation('not-a-token')`),
    );
    expect(message).toMatch(/unknown_invitation/);
  });
});

describe('withdrawing one', () => {
  it('needs members.manage', async () => {
    const created = await invite(ownerId, 'towithdraw@invitations.test');
    const message = await asUser(db, accountantId, () =>
      expectError(db, `select * from revoke_invitation($1)`, [created.invitation_id]),
    );
    expect(message).toMatch(/not_allowed: withdrawing an invitation needs members\.manage/);
  });

  it('refuses one that is already a membership', async () => {
    const accepted = await one<{ id: string }>(
      db,
      `select id from company_invitations where accepted_at is not null limit 1`,
    );
    const message = await asUser(db, ownerId, () =>
      expectError(db, `select * from revoke_invitation($1)`, [accepted.id]),
    );
    expect(message).toMatch(/invitation_already_accepted/);
  });
});

describe('who sees the invitations of a company', () => {
  it('is whoever manages its members, and nobody else', async () => {
    const byOwner = await asUser(db, ownerId, () =>
      rows(db, `select id from company_invitations where company_id = $1`, [companyId]),
    );
    expect(byOwner.length).toBeGreaterThan(0);

    const byAccountant = await asUser(db, accountantId, () =>
      rows(db, `select id from company_invitations where company_id = $1`, [companyId]),
    );
    expect(byAccountant).toEqual([]);

    const byStranger = await asUser(db, strangerId, () =>
      rows(db, `select id from company_invitations`),
    );
    expect(byStranger).toEqual([]);
  });
});
