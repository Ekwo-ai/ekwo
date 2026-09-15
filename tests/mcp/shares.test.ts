/**
 * Publishing a document, through the tools an assistant actually calls.
 *
 * The contract is the database's and the refusals are the database's: this
 * file proves the server does not soften either. The one thing it adds is what
 * a model is told afterwards — the token is in the answer and nowhere else —
 * and the one thing it deliberately does not carry is `shared_document`. That
 * function is the public door, not an agent's tool: an assistant that could
 * read a document by presenting a token would be an assistant somebody hands a
 * token to.
 */

import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readTools, writeTools, type Backend } from '../../packages/mcp/src/index.js';
import { buildServer } from '../../packages/mcp/src/index.js';
import { freshDatabase, one } from '../helpers/db.js';
import { newCompany, newContact, newDocument, newUser, type Fixture } from '../helpers/factory.js';
import { backendFor, list, record } from './helpers.js';
import { defaultChartOf, somePack } from '../helpers/packs.js';

// The company these tests keep books for is in some country, named once.
const HOME = somePack.manifest.country;

let db: PGlite;
let fx: Fixture;
let asOwner: Backend;
let asViewer: Backend;
let invoiceId: string;
let purchaseId: string;

/** An account of the working chart that a line of this kind may sit on. */
function accountFor(role: string): string {
  const code = somePack.manifest.defaults.roles[role];
  if (typeof code !== 'string') throw new Error(`packs/${somePack.slug} names no ${role} account`);
  return code;
}

beforeAll(async () => {
  db = await freshDatabase();
  fx = await newCompany(db, { country: HOME, name: 'Shares MCP SRL' });
  await db.query(`insert into auth.users (id, email) values ($1, $2) on conflict do nothing`, [
    fx.ownerId,
    'owner@shares-mcp.test',
  ]);
  const viewer = await newUser(db, 'viewer@shares-mcp.test');
  await db.query(`insert into company_members (company_id, user_id, role) values ($1, $2, 'viewer')`, [
    fx.companyId,
    viewer,
  ]);
  asOwner = backendFor(db, fx.ownerId);
  asViewer = backendFor(db, viewer);

  // Two documents of the same books: one this company issued, one it received.
  const sales = accountFor('sales');
  const purchases = accountFor('purchase');
  const customer = await newContact(db, fx.companyId, { name: 'Customer', country: HOME });
  const supplier = await newContact(db, fx.companyId, {
    name: 'Supplier',
    type: 'supplier',
    country: HOME,
  });
  invoiceId = await newDocument(db, fx.companyId, {
    docType: 'sale_invoice',
    contactId: customer,
    lines: [{ unitPrice: 100, accountCode: sales, taxCode: null }],
  });
  purchaseId = await newDocument(db, fx.companyId, {
    docType: 'purchase_invoice',
    contactId: supplier,
    lines: [{ unitPrice: 50, accountCode: purchases, taxCode: null }],
  });
  await db.query(`select post_document($1)`, [invoiceId]);
  await db.query(`select post_document($1)`, [purchaseId]);

  // The chart is read once so the helper above cannot silently name nothing.
  expect(defaultChartOf(somePack).code.length).toBeGreaterThan(0);
}, 120_000);

afterAll(async () => {
  await db.close();
});

describe('publishing a document through the server', () => {
  it('returns the token once, and the table holds only its hash', async () => {
    const answer = record(
      await writeTools.shareDocument(asOwner, { document_id: invoiceId }),
    );
    const share = record(answer['share']);
    expect(String(share['token'])).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(String(answer['note'])).toMatch(/nowhere else/);

    const stored = await one<{ token_hash: string; document_id: string }>(
      db,
      `select token_hash, document_id from document_shares where id = $1`,
      [share['share_id']],
    );
    expect(stored.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.document_id).toBe(invoiceId);

    const listed = list(
      record(await readTools.listShares(asOwner, { company_id: fx.companyId }))['shares'],
    );
    expect(listed.map((row) => row['id'])).toContain(share['share_id']);
    // No token and no hash reaches a client, whichever way it asks.
    for (const row of listed) {
      expect(Object.keys(row)).not.toContain('token');
      expect(Object.keys(row)).not.toContain('token_hash');
    }

    const withdrawn = record(
      await writeTools.revokeShare(asOwner, { share_id: String(share['share_id']) }),
    );
    expect(record(withdrawn['share'])['revoked_at']).not.toBeNull();

    const live = list(
      record(await readTools.listShares(asOwner, { company_id: fx.companyId }))['shares'],
    );
    expect(live.map((row) => row['id'])).not.toContain(share['share_id']);
    const all = list(
      record(
        await readTools.listShares(asOwner, {
          company_id: fx.companyId,
          include_withdrawn: true,
        }),
      )['shares'],
    );
    expect(all.find((row) => row['id'] === share['share_id'])?.['state']).toBe('withdrawn');
  });

  it('hands back the refusal the database wrote, unsoftened', async () => {
    await expect(
      writeTools.shareDocument(asViewer, { document_id: invoiceId }),
    ).rejects.toThrow(/documents\.share/);

    await expect(
      writeTools.shareDocument(asOwner, { document_id: purchaseId }),
    ).rejects.toThrow(/share_not_a_sale/);
  });

  it('is not offered the public door', async () => {
    // `shared_document` is what a visitor's browser calls. A tool for it would
    // be an agent reading a document by holding a secret, which is exactly the
    // shape this feature exists to keep outside the agent.
    const server = buildServer(asOwner);
    expect(Object.keys(writeTools)).not.toContain('sharedDocument');
    expect(Object.keys(readTools)).not.toContain('sharedDocument');
    expect(server).toBeDefined();
  });
});
