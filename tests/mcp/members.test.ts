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
import { newCompany, newInstanceAdmin, newUser, type Fixture } from '../helpers/factory.js';
import { backendFor, list, record } from './helpers.js';
import { somePack } from '../helpers/packs.js';

// The companies these tests create are in some country, named once.
const HOME = somePack.manifest.country;

let db: PGlite;
let fx: Fixture;
let asOwner: Backend;
let asAccountant: Backend;

beforeAll(async () => {
  db = await freshDatabase();
  fx = await newCompany(db, { country: HOME, name: 'Invitations MCP SRL' });
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

describe('the company profile through the server', () => {
  it('changes only what was named, and needs company.write', async () => {
    const updated = record(
      await writeTools.updateCompanyProfile(asOwner, {
        company_id: fx.companyId,
        trade_name: 'Invitations',
        share_capital: '18600.00',
        activity_code: '70.22',
        activity_scheme: 'NACE-BEL 2008',
      }),
    );
    const company = record(updated['company']);
    expect(company['trade_name']).toBe('Invitations');
    expect(company['share_capital']).toBe('18600.00');
    // No currency was given, so the company's own was taken — and not one
    // written into the schema.
    expect(company['share_capital_currency']).toBe(company['currency_code']);
    expect(company['name']).toBe('Invitations MCP SRL');

    await expect(
      writeTools.updateCompanyProfile(asAccountant, {
        company_id: fx.companyId,
        trade_name: 'Par la comptable',
      }),
    ).rejects.toThrow(/company\.write/);
  });

  it('refuses a call that names nothing to change', async () => {
    await expect(
      writeTools.updateCompanyProfile(asOwner, { company_id: fx.companyId }),
    ).rejects.toThrow(/nothing_to_change/);
  });
});

describe('machine keys through the server', () => {
  it('issues one, shows the secret once, and lists it without the hash', async () => {
    const answer = record(
      await writeTools.createApiKey(asOwner, {
        company_id: fx.companyId,
        name: 'Flux bancaire',
        capabilities: ['bank.write'],
      }),
    );
    const key = record(answer['api_key']);
    expect(String(key['secret'])).toMatch(/^ekwo_[0-9a-f]{12}_[0-9a-f]{64}$/);

    const listed = list(
      record(await readTools.listApiKeys(asOwner, { company_id: fx.companyId }))['api_keys'],
    );
    expect(listed).toHaveLength(1);
    expect(listed[0]?.['name']).toBe('Flux bancaire');
    expect(listed[0]?.['state']).toBe('live');
    expect(Object.keys(listed[0] ?? {})).not.toContain('key_hash');

    await writeTools.revokeApiKey(asOwner, { api_key_id: String(key['api_key_id']) });
    const after = list(
      record(await readTools.listApiKeys(asOwner, { company_id: fx.companyId }))['api_keys'],
    );
    expect(after).toEqual([]);
  });

  it('refuses an accountant, who does not manage members', async () => {
    await expect(
      writeTools.createApiKey(asAccountant, {
        company_id: fx.companyId,
        name: 'Interdite',
        capabilities: ['bank.write'],
      }),
    ).rejects.toThrow(/members\.manage/);
  });
});

describe('creating a company through the server', () => {
  it('is an instance-level act, and it opens the year the pack opens', async () => {
    await expect(
      writeTools.createCompany(asOwner, { name: 'Refusee SRL', country: HOME }),
    ).rejects.toThrow(/not_instance_admin/);

    const adminId = await newInstanceAdmin(db);
    const asAdmin = backendFor(db, adminId);
    const answer = record(
      await writeTools.createCompany(asAdmin, {
        name: 'Nouvelle SRL',
        country: HOME,
        fiscal_year: 2026,
      }),
    );
    const company = record(answer['company']);
    expect(company['name']).toBe('Nouvelle SRL');

    const years = list(answer['fiscal_years']);
    expect(years).toHaveLength(1);
    const expected = await one<{ start_date: string; end_date: string }>(
      db,
      `select start_date::text, end_date::text from fiscal_year_bounds('BE', 2026)`,
    );
    expect(years[0]?.['start_date']).toBe(expected.start_date);
    expect(years[0]?.['end_date']).toBe(expected.end_date);
  });
});
