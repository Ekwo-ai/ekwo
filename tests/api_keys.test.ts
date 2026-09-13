/**
 * A key for a machine.
 *
 * The assertions are the four promises the migration makes: the secret is
 * shown once and stored as a hash, a key reaches exactly the capabilities it
 * carries and no others, it stops working when it is withdrawn or when it
 * expires, and nobody can put a capability on a key that they do not hold
 * themselves.
 */

import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, expectError, freshDatabase, one, rows } from './helpers/db.js';
import { newCompany, newContact, newDocument, newUser } from './helpers/factory.js';

let db: PGlite;
let companyId: string;
let ownerId: string;
let accountantId: string;
let documentId: string;

interface IssuedKey {
  api_key_id: string;
  secret: string;
  prefix: string;
}

async function issue(
  as: string,
  name: string,
  capabilities: string[],
  expiresAt: string | null = null,
): Promise<IssuedKey> {
  return asUser(db, as, () =>
    one<IssuedKey>(db, `select * from create_api_key($1, $2, $3::jsonb, $4::timestamptz)`, [
      companyId,
      name,
      JSON.stringify(capabilities),
      expiresAt,
    ]),
  );
}

/** What a machine holding a key can do, inside one transaction. */
async function withKey<T>(secret: string, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role authenticated;`);
  await db.query(`begin`);
  try {
    await db.query(`select * from use_api_key($1)`, [secret]);
    return await fn();
  } finally {
    await db.query(`commit`);
    await db.exec(`reset role;`);
  }
}

beforeAll(async () => {
  db = await freshDatabase();
  ({ companyId, ownerId } = await newCompany(db, { name: 'Cles SRL' }));
  await db.query(`insert into auth.users (id, email) values ($1, $2) on conflict do nothing`, [
    ownerId,
    'owner@keys.test',
  ]);
  accountantId = await newUser(db, 'accountant@keys.test');
  await db.query(
    `insert into company_members (company_id, user_id, role) values ($1, $2, 'accountant')`,
    [companyId, accountantId],
  );
  const contact = await newContact(db, companyId, { name: 'Cliente des cles' });
  documentId = await newDocument(db, companyId, {
    docType: 'sale_invoice',
    number: 'FAC-CLE-001',
    contactId: contact,
    lines: [{ unitPrice: 100, taxCode: 'BE-S-21', accountCode: '704000' }],
  });
});

afterAll(async () => {
  await db.close();
});

describe('issuing a key', () => {
  it('returns the secret once and keeps a hash', async () => {
    const key = await issue(ownerId, 'Import nocturne', ['documents.read']);
    expect(key.secret.startsWith(`ekwo_${key.prefix}_`)).toBe(true);

    const stored = await one<{ key_hash: string; prefix: string; capabilities: string[] }>(
      db,
      `select key_hash, prefix, capabilities from api_keys where id = $1`,
      [key.api_key_id],
    );
    expect(stored.key_hash).not.toContain(key.secret);
    expect(stored.key_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.prefix).toBe(key.prefix);
    expect(stored.capabilities).toEqual(['documents.read']);

    // The hash is the sha256 of the secret and of nothing else.
    const digest = await one<{ digest: string }>(
      db,
      `select encode(sha256(convert_to($1, 'UTF8')), 'hex') as digest`,
      [key.secret],
    );
    expect(stored.key_hash).toBe(digest.digest);
  });

  it('needs members.manage', async () => {
    const message = await asUser(db, accountantId, () =>
      expectError(db, `select * from create_api_key($1, 'Interdite', '["documents.read"]'::jsonb)`, [
        companyId,
      ]),
    );
    expect(message).toMatch(/not_allowed: issuing a key for this company needs members\.manage/);
  });

  it('refuses a capability the person issuing it does not hold', async () => {
    await db.query(
      `update company_members set capabilities_granted = array['members.manage']
        where company_id = $1 and user_id = $2`,
      [companyId, accountantId],
    );
    // The accountant may now issue keys, and still may not put company.write
    // on one, because they do not hold it themselves.
    const message = await asUser(db, accountantId, () =>
      expectError(db, `select * from create_api_key($1, 'Trop forte', '["company.write"]'::jsonb)`, [
        companyId,
      ]),
    );
    expect(message).toMatch(/you do not hold company\.write yourself/);

    const allowed = await issue(accountantId, 'Dans ses moyens', ['documents.post']);
    expect(allowed.api_key_id).toBeTruthy();

    await db.query(
      `update company_members set capabilities_granted = '{}'
        where company_id = $1 and user_id = $2`,
      [companyId, accountantId],
    );
  });

  it('refuses a key that may do nothing, and a capability nobody declared', async () => {
    const empty = await asUser(db, ownerId, () =>
      expectError(db, `select * from create_api_key($1, 'Vide', '[]'::jsonb)`, [companyId]),
    );
    expect(empty).toMatch(/api_key_without_capability/);

    const unknown = await asUser(db, ownerId, () =>
      expectError(db, `select * from create_api_key($1, 'Typo', '["documents.burn"]'::jsonb)`, [
        companyId,
      ]),
    );
    expect(unknown).toMatch(/unknown_capability: documents\.burn/);
  });
});

describe('presenting a key', () => {
  it('reaches exactly what it carries, and nothing beside it', async () => {
    const key = await issue(ownerId, 'Lecture seule', ['documents.read']);

    await withKey(key.secret, async () => {
      const seen = await rows<{ id: string }>(db, `select id from documents`);
      expect(seen.map((row) => row.id)).toContain(documentId);

      const allowed = await one<{ read: boolean; write: boolean; post: boolean }>(
        db,
        `select has_capability($1, 'documents.read') as read,
                has_capability($1, 'documents.write') as write,
                has_capability($1, 'documents.post') as post`,
        [companyId],
      );
      expect(allowed).toEqual({ read: true, write: false, post: false });
    });
  });

  it('reaches no other company', async () => {
    const other = await newCompany(db, { name: 'Voisine SRL' });
    const key = await issue(ownerId, 'Une seule societe', ['documents.read']);
    await withKey(key.secret, async () => {
      const elsewhere = await one<{ has_capability: boolean }>(
        db,
        `select has_capability($1, 'documents.read')`,
        [other.companyId],
      );
      expect(elsewhere.has_capability).toBe(false);
    });
  });

  it('stops at the end of the transaction it was presented in', async () => {
    const key = await issue(ownerId, 'Le temps d’une transaction', ['documents.read']);
    await withKey(key.secret, async () => {
      const inside = await one<{ has_capability: boolean }>(
        db,
        `select has_capability($1, 'documents.read')`,
        [companyId],
      );
      expect(inside.has_capability).toBe(true);
    });

    await db.exec(`set role authenticated;`);
    const after = await one<{ has_capability: boolean }>(
      db,
      `select has_capability($1, 'documents.read')`,
      [companyId],
    );
    await db.exec(`reset role;`);
    expect(after.has_capability).toBe(false);
  });

  it('records that it was used', async () => {
    const key = await issue(ownerId, 'Tracee', ['documents.read']);
    const before = await one<{ last_used_at: string | null }>(
      db,
      `select last_used_at::text from api_keys where id = $1`,
      [key.api_key_id],
    );
    expect(before.last_used_at).toBeNull();

    await withKey(key.secret, async () => undefined);

    const after = await one<{ last_used_at: string | null }>(
      db,
      `select last_used_at::text from api_keys where id = $1`,
      [key.api_key_id],
    );
    expect(after.last_used_at).not.toBeNull();
  });

  it('is refused once it has expired', async () => {
    const key = await issue(ownerId, 'Perimee', ['documents.read']);
    await db.query(
      `update api_keys set created_at = now() - interval '30 days', expires_at = now() - interval '1 day'
        where id = $1`,
      [key.api_key_id],
    );
    const message = await expectError(db, `select * from use_api_key($1)`, [key.secret]);
    expect(message).toMatch(/api_key_expired/);
  });

  it('is refused once it has been withdrawn', async () => {
    const key = await issue(ownerId, 'Retiree', ['documents.read']);
    await asUser(db, ownerId, () =>
      one(db, `select * from revoke_api_key($1)`, [key.api_key_id]),
    );
    const message = await expectError(db, `select * from use_api_key($1)`, [key.secret]);
    expect(message).toMatch(/api_key_revoked/);
  });

  it('is refused when it is not a key at all', async () => {
    const message = await expectError(db, `select * from use_api_key('ekwo_deadbeef_nope')`);
    expect(message).toMatch(/unknown_api_key/);
  });

  it('never takes away what the signed-in person already had', async () => {
    // A member presenting a narrow key keeps their own capabilities: the key
    // is consulted only where there is no member answer.
    const key = await issue(ownerId, 'Etroite', ['documents.read']);
    await db.exec(
      `select set_config('request.jwt.claims', '${JSON.stringify({ sub: ownerId, role: 'authenticated' })}', false);`,
    );
    await db.query(`begin`);
    await db.query(`select * from use_api_key($1)`, [key.secret]);
    const still = await one<{ has_capability: boolean }>(
      db,
      `select has_capability($1, 'company.write')`,
      [companyId],
    );
    await db.query(`commit`);
    await db.exec(`select set_config('request.jwt.claims', '', false);`);
    expect(still.has_capability).toBe(true);
  });
});

describe('withdrawing a key', () => {
  it('needs members.manage, and cannot be undone', async () => {
    const key = await issue(ownerId, 'A retirer', ['documents.read']);
    const refused = await asUser(db, accountantId, () =>
      expectError(db, `select * from revoke_api_key($1)`, [key.api_key_id]),
    );
    expect(refused).toMatch(/not_allowed: withdrawing a key needs members\.manage/);

    const first = await asUser(db, ownerId, () =>
      one<{ revoked_at: string }>(db, `select revoked_at::text from revoke_api_key($1)`, [
        key.api_key_id,
      ]),
    );
    const second = await asUser(db, ownerId, () =>
      one<{ revoked_at: string }>(db, `select revoked_at::text from revoke_api_key($1)`, [
        key.api_key_id,
      ]),
    );
    expect(second.revoked_at).toBe(first.revoked_at);
  });
});

describe('who sees the keys of a company', () => {
  it('is whoever manages its members, and nobody else', async () => {
    const byOwner = await asUser(db, ownerId, () => rows(db, `select id from api_keys`));
    expect(byOwner.length).toBeGreaterThan(0);

    const byAccountant = await asUser(db, accountantId, () => rows(db, `select id from api_keys`));
    expect(byAccountant).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The audit of 13 September 2026: a key was the widest caller, not the
// narrowest.
//
// Eleven guards were written as `auth.uid() is not null and not
// has_capability(…)`, meant as "the installer is exempt". A key is precisely a
// caller with no `auth.uid()`, so every one of them stood aside for it.
// Migration 20260913102115 names the installer instead — `is_installer()`,
// false whenever `ekwo.api_key` is set — and `has_capability()` becomes the
// only authority over a key, which is what it was always documented to be.
// ---------------------------------------------------------------------------

describe('a key that may only read', () => {
  let readOnly: string;
  let otherCompany: string;
  let yearId: string;
  let journalId: string;

  beforeAll(async () => {
    // Every `.read` capability and not one more — the viewer preset, as a
    // machine. A key that could not even see a row would be refused by row
    // level security before a guard was reached, and it is the guards that
    // are on trial here.
    const reads = (
      await rows<{ code: string }>(db, `select code from capabilities where code like '%.read'`)
    ).map((r) => r.code);
    readOnly = (await issue(ownerId, 'Lecture seule', reads)).secret;
    otherCompany = (await newCompany(db, { name: 'Voisine SRL' })).companyId;
    yearId = (
      await one<{ id: string }>(db, `select id from fiscal_years where company_id = $1 limit 1`, [
        companyId,
      ])
    ).id;
    journalId = (
      await one<{ id: string }>(
        db,
        `select id from journals where company_id = $1 and code = 'MISC'`,
        [companyId],
      )
    ).id;
  });

  it('cannot issue itself a second key carrying everything', async () => {
    const message = await withKey(readOnly, () =>
      expectError(
        db,
        `select * from create_api_key($1, 'Promotion', '["company.write","members.manage"]'::jsonb)`,
        [companyId],
      ),
    );
    expect(message).toMatch(/not_allowed: issuing a key for this company needs members\.manage/);
  });

  it('cannot post an entry', async () => {
    const message = await withKey(readOnly, () =>
      expectError(
        db,
        `insert into entries (company_id, journal_id, entry_date, description, state)
         values ($1, $2, date '2026-06-01', 'Par la cle', 'posted')`,
        [companyId, journalId],
      ),
    );
    expect(message).toMatch(/not_allowed: posting an entry in this company needs entries\.post/);
  });

  it('cannot draw a number, nor a matching number', async () => {
    const number = await withKey(readOnly, () =>
      expectError(db, `select next_entry_number($1, date '2026-06-01')`, [journalId]),
    );
    expect(number).toMatch(/not_allowed: drawing a number/);

    const matching = await withKey(readOnly, () =>
      expectError(db, `select next_matching_number($1)`, [companyId]),
    );
    expect(matching).toMatch(/not_allowed: matching in this company/);
  });

  it('cannot book a document: row level security never hands it the row', async () => {
    const changed = await withKey(readOnly, () =>
      rows(db, `update documents set state = 'posted' where id = $1 returning id`, [documentId]),
    );
    expect(changed).toEqual([]);
    expect(
      (await one<{ state: string }>(db, `select state from documents where id = $1`, [documentId]))
        .state,
    ).not.toBe('posted');
  });

  it('cannot close a financial year, for the same reason', async () => {
    const changed = await withKey(readOnly, () =>
      rows(db, `update fiscal_years set is_closed = true where id = $1 returning id`, [yearId]),
    );
    expect(changed).toEqual([]);
  });

  it('cannot invite a member, nor create a company of its own', async () => {
    const invite = await withKey(readOnly, () =>
      expectError(db, `select * from invite_member($1, 'complice@example.test', 'owner')`, [
        companyId,
      ]),
    );
    expect(invite).toMatch(/not_allowed/);

    const created = await withKey(readOnly, () =>
      expectError(db, `select * from create_company('Fantome SRL', $1)`, ['BE']),
    );
    expect(created).toMatch(/not_instance_admin/);
  });

  it('cannot reach the company next door at all', async () => {
    const message = await withKey(readOnly, () =>
      expectError(
        db,
        `select * from create_api_key($1, 'Chez le voisin', '["entries.read"]'::jsonb)`,
        [otherCompany],
      ),
    );
    expect(message).toMatch(/not_allowed/);

    const seen = await withKey(readOnly, () =>
      rows(db, `select id from entries where company_id = $1`, [otherCompany]),
    );
    expect(seen).toEqual([]);
  });

  it('is never the installer, whatever the connection it travels over says', async () => {
    // The connection this test suite holds *is* the installer: `freshDatabase`
    // set `ekwo.installing`. Presenting a key withdraws it for the length of
    // the transaction, which is the property the guards rest on.
    const outside = await one<{ installer: boolean }>(db, `select is_installer() as installer`);
    expect(outside.installer).toBe(true);

    const inside = await withKey(readOnly, () =>
      one<{ installer: boolean }>(db, `select is_installer() as installer`),
    );
    expect(inside.installer).toBe(false);
  });
});

describe('a caller with neither a session nor a key', () => {
  it('is not the installer just because it reached the authenticated role', async () => {
    // What a PostgREST request with no JWT looks like. It cannot set a GUC,
    // so it cannot claim to be installing.
    await db.exec(`set role authenticated;`);
    try {
      const answer = await one<{ installer: boolean }>(
        db,
        `select is_installer() as installer from (select set_config('ekwo.installing', '', true)) s`,
      );
      expect(answer.installer).toBe(false);
    } finally {
      await db.exec(`reset role;`);
    }
  });
});

// A key that may change a draft and still may not put it in the ledger. This
// is where the three triggers of 20260913083216 are the only thing standing
// in the way: row level security hands the row over, and the guard has to
// fire. Before 20260913102115 it did not, for any key at all.
describe('a key that may write but not post', () => {
  let writer: string;
  let yearId: string;

  beforeAll(async () => {
    const caps = (
      await rows<{ code: string }>(
        db,
        `select code from capabilities
          where code like '%.read' or code in ('documents.write', 'entries.write', 'settings.write')`,
      )
    ).map((r) => r.code);
    writer = (await issue(ownerId, 'Saisie', caps)).secret;
    yearId = (
      await one<{ id: string }>(db, `select id from fiscal_years where company_id = $1 limit 1`, [
        companyId,
      ])
    ).id;
  });

  it('is refused when it books a document', async () => {
    const message = await withKey(writer, () =>
      expectError(db, `update documents set state = 'posted' where id = $1`, [documentId]),
    );
    expect(message).toMatch(/not_allowed: booking a document in this company needs documents\.post/);
  });

  it('is refused when it closes a financial year', async () => {
    const message = await withKey(writer, () =>
      expectError(db, `update fiscal_years set is_closed = true where id = $1`, [yearId]),
    );
    expect(message).toMatch(/not_allowed: closing or re-opening a financial year/);
  });
});
