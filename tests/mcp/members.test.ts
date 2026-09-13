/**
 * Inviting somebody, through the tools an assistant actually calls.
 *
 * The interesting assertions are the two refusals: the token is in the answer
 * and nowhere else, and a member who may not manage members gets the
 * database's own refusal rather than a silent no-op.
 */

import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readTools, writeTools, type Backend } from '../../packages/mcp/src/index.js';
import { freshDatabase, one } from '../helpers/db.js';
import { newCompany, newUser, type Fixture } from '../helpers/factory.js';
import { backendFor, list, record } from './helpers.js';

let db: PGlite;
let fx: Fixture;
let asOwner: Backend;
let asAccountant: Backend;

beforeAll(async () => {
  db = await freshDatabase();
  fx = await newCompany(db, { country: 'BE', name: 'Invitations MCP SRL' });
  await db.query(`insert into auth.users (id, email) values ($1, $2) on conflict do nothing`, [
    fx.ownerId,
    'owner@mcp.test',
  ]);
  const accountant = await newUser(db, 'accountant@mcp.test');
  await db.query(
    `insert into company_members (company_id, user_id, role) values ($1, $2, 'accountant')`,
    [fx.companyId, accountant],
  );
  asOwner = backendFor(db, fx.ownerId);
  asAccountant = backendFor(db, accountant);
});

afterAll(async () => {
  await db.close();
});

describe('invitations through the server', () => {
  it('issues one, and the token is in the answer and not in the table', async () => {
    const answer = record(
      await writeTools.inviteMember(asOwner, {
        company_id: fx.companyId,
        email: 'Newcomer@MCP.test',
        role: 'accountant',
        capabilities: ['members.manage'],
      }),
    );
    const invitation = record(answer['invitation']);
    expect(String(invitation['token'])).toMatch(/^[0-9a-f]{64}$/);

    const stored = await one<{ email: string; role: string; capabilities_granted: string[] }>(
      db,
      `select email, role::text, capabilities_granted from company_invitations where id = $1`,
      [String(invitation['invitation_id'])],
    );
    expect(stored.email).toBe('newcomer@mcp.test');
    expect(stored.role).toBe('accountant');
    expect(stored.capabilities_granted).toEqual(['members.manage']);
  });

  it('lists what is pending, without ever showing a hash', async () => {
    const answer = record(await readTools.listInvitations(asOwner, { company_id: fx.companyId }));
    const pending = list(answer['invitations']);
    expect(pending.length).toBe(1);
    expect(pending[0]?.['state']).toBe('pending');
    expect(pending[0]?.['email']).toBe('newcomer@mcp.test');
    expect(Object.keys(pending[0] ?? {})).not.toContain('token_hash');
  });

  it('hands an accountant the database’s refusal rather than an empty list', async () => {
    await expect(
      writeTools.inviteMember(asAccountant, {
        company_id: fx.companyId,
        email: 'nope@mcp.test',
      }),
    ).rejects.toThrow(/members\.manage/);

    const seen = record(
      await readTools.listInvitations(asAccountant, { company_id: fx.companyId }),
    );
    expect(list(seen['invitations'])).toEqual([]);
  });

  it('withdraws one, and says so in the listing', async () => {
    const pending = list(
      record(await readTools.listInvitations(asOwner, { company_id: fx.companyId }))['invitations'],
    );
    const id = String(pending[0]?.['id']);

    await writeTools.revokeInvitation(asOwner, { invitation_id: id });

    const after = record(
      await readTools.listInvitations(asOwner, { company_id: fx.companyId, include_settled: true }),
    );
    const settled = list(after['invitations']).find((row) => row['id'] === id);
    expect(settled?.['state']).toBe('withdrawn');

    const stillPending = list(
      record(await readTools.listInvitations(asOwner, { company_id: fx.companyId }))['invitations'],
    );
    expect(stillPending).toEqual([]);
  });

  it('says who is on the books and what the caller may do', async () => {
    const answer = record(await readTools.getCompany(asOwner, { company_id: fx.companyId }));
    const members = list(answer['members']);
    expect(members.map((row) => row['role']).sort()).toEqual(['accountant', 'owner']);
    expect(answer['your_capabilities']).toContain('members.manage');

    const seenByAccountant = record(
      await readTools.getCompany(asAccountant, { company_id: fx.companyId }),
    );
    expect(seenByAccountant['your_capabilities']).not.toContain('members.manage');
  });
});

describe('preferences through the server', () => {
  it('saves what the caller named, and resolves the language chain', async () => {
    const saved = record(await writeTools.setPreferences(asOwner, { language: 'nl' }));
    expect(record(saved['preferences'])['language']).toBe('nl');

    const read = record(await readTools.getPreferences(asOwner, { company_id: fx.companyId }));
    const languages = read['languages'] as string[];
    expect(languages[0]).toBe('nl');
    expect(languages.length).toBeGreaterThan(1);

    // Clearing puts the question back to the company and to the pack.
    await writeTools.setPreferences(asOwner, { language: null });
    const after = record(await readTools.getPreferences(asOwner, { company_id: fx.companyId }));
    expect((after['languages'] as string[])[0]).not.toBe('nl');
  });

  it('never shows one user the preferences of another', async () => {
    await writeTools.setPreferences(asAccountant, { theme: 'dark' });
    const mine = record(await readTools.getPreferences(asOwner, {}));
    expect(record(mine['preferences'] ?? {})['theme']).toBeNull();

    const theirs = record(await readTools.getPreferences(asAccountant, {}));
    expect(record(theirs['preferences'] ?? {})['theme']).toBe('dark');
  });
});
