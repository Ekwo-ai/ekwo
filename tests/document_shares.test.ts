/**
 * A document, opened by whoever holds its link.
 *
 * The act has two halves and they are tested as two different things. A member
 * of the company creates and withdraws a link, and row level security decides
 * which member: `documents.share` sits on the two presets that issue documents
 * and on neither the viewer nor a stranger. Then somebody who is not signed in
 * at all presents the token, and what comes back has to be the document as it
 * was sent — and *only* that, which is the half a reviewer should read most
 * carefully.
 *
 * Everything the assertions compare against is read from the pack whose books
 * are being kept: the legal mentions of a shared invoice are the pack's own
 * sentences in the document's own language, not a string written here.
 */

import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pack, PackGolden } from '../packages/cli/src/index.js';
import { asUser, expectError, freshDatabase, one, rows } from './helpers/db.js';
import { newCompany, newDocument, newUser } from './helpers/factory.js';
import { replayScenario } from './helpers/golden-scenario.js';
import { packWhere } from './helpers/packs.js';

/** The shape `shared_document()` answers with, as a reader of the page sees it. */
interface SharedDocument {
  document: Record<string, unknown>;
  seller: Record<string, unknown>;
  buyer: Record<string, unknown>;
  lines: Record<string, unknown>[];
  tax_summary: Record<string, unknown>[];
  totals: Record<string, string>;
  payment: Record<string, unknown>;
  legal_mentions: { code: string; text: string }[];
}

let db: PGlite;
let pack: Pack;
let golden: PackGolden;
let companyId: string;
let ownerId: string;
let accountantId: string;
let viewerId: string;
let strangerId: string;
/** A posted sales invoice of the scenario, settled by nothing yet. */
let invoiceId: string;
/** A purchase invoice of the same scenario. */
let purchaseId: string;

/** `share_document`, as the row it returns. */
interface Share {
  share_id: string;
  token: string;
  url: string | null;
}

async function shareAs(userId: string, documentId: string): Promise<Share> {
  return asUser(db, userId, () =>
    one<Share>(db, `select * from share_document($1)`, [documentId]),
  );
}

/** What an anonymous visitor sees when they present a token. */
async function readAsVisitor(token: string): Promise<SharedDocument | null> {
  const answer = await asUser(
    db,
    strangerId,
    () => rows<{ p: SharedDocument | null }>(db, `select shared_document($1) as p`, [token]),
    'anon',
  );
  return answer[0]?.p ?? null;
}

beforeAll(async () => {
  // The pack under test is the one that carries both a year of books and a
  // sentence its law puts on every invoice a seller issues — the two things a
  // shared invoice has to render. Naming a country here would be asserting
  // which country happens to have them.
  pack = packWhere(
    'a golden scenario and a mention its law puts on what a seller issues',
    (p) =>
      p.golden !== null && p.documents.mentions.some((m) => m.applies_when === 'late_payment'),
  );
  golden = pack.golden as PackGolden;

  db = await freshDatabase();
  ({ companyId, ownerId } = await newCompany(db, {
    country: pack.manifest.country,
    name: golden.name,
    chart: golden.chart,
    language: golden.language,
    fiscalYear: golden.fiscalYear,
  }));

  accountantId = await newUser(db, 'accountant@shares.test');
  viewerId = await newUser(db, 'viewer@shares.test');
  strangerId = await newUser(db, 'stranger@shares.test');
  await db.query(
    `insert into company_members (company_id, user_id, role)
     values ($1, $2, 'accountant'), ($1, $3, 'viewer')`,
    [companyId, accountantId, viewerId],
  );

  const replayed = await replayScenario(db, companyId, golden);

  // A sales invoice nothing has been paid against, so the residual of a share
  // can be watched moving; and a purchase invoice, which is somebody else's
  // document and must be refused.
  const settled = new Set(golden.payments.map((payment) => payment.match));
  const sale = golden.documents.find(
    (document) => document.type === 'sale_invoice' && !settled.has(document.ref),
  );
  const purchase = golden.documents.find((document) => document.type === 'purchase_invoice');
  if (sale === undefined || purchase === undefined) {
    throw new Error(`the golden of ${pack.slug} carries no unsettled sale and a purchase`);
  }
  invoiceId = replayed.documents.get(sale.ref) as string;
  purchaseId = replayed.documents.get(purchase.ref) as string;
}, 180_000);

afterAll(async () => {
  await db.close();
});

// ---------------------------------------------------------------------------
// Who may publish a document
// ---------------------------------------------------------------------------

describe('creating a link', () => {
  it('is something an owner and an accountant do', async () => {
    for (const userId of [ownerId, accountantId]) {
      const share = await shareAs(userId, invoiceId);
      expect(share.share_id).toMatch(/^[0-9a-f-]{36}$/);
      // 32 bytes, base64url, no padding.
      expect(share.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      await asUser(db, ownerId, () =>
        db.query(`select revoke_share($1)`, [share.share_id]),
      );
    }
  });

  it('is refused to a viewer, who may read the books and not publish them', async () => {
    const message = await asUser(db, viewerId, () =>
      expectError(db, `select * from share_document($1)`, [invoiceId]),
    );
    expect(message).toMatch(/not_allowed: publishing a document of this company needs documents\.share/);
  });

  it('is refused to somebody who is not a member of the company at all', async () => {
    const message = await asUser(db, strangerId, () =>
      expectError(db, `select * from share_document($1)`, [invoiceId]),
    );
    expect(message).toMatch(/not_allowed/);
  });

  it('is refused on a purchase invoice, which somebody else wrote about their own business', async () => {
    const message = await asUser(db, ownerId, () =>
      expectError(db, `select * from share_document($1)`, [purchaseId]),
    );
    expect(message).toMatch(/share_not_a_sale/);
  });

  it('is refused on a draft, which has no number and is not what was sent', async () => {
    const template = golden.documents.find((document) => document.type === 'sale_invoice');
    const draft = await newDocument(db, companyId, {
      docType: 'sale_invoice',
      contactId: await one<{ id: string }>(db, `select id from contacts where company_id = $1 limit 1`, [
        companyId,
      ]).then((row) => row.id),
      date: golden.fiscalYear.start,
      lines: (template?.lines ?? []).map((line) => ({
        name: line.name,
        quantity: line.quantity,
        unitPrice: line.unit_price,
        discountPercent: line.discount_percent,
        taxCode: line.tax,
        accountCode: line.account,
      })),
    });

    const message = await asUser(db, ownerId, () =>
      expectError(db, `select * from share_document($1)`, [draft]),
    );
    expect(message).toMatch(/share_draft_document/);
  });

  it('refuses an expiry that is already in the past', async () => {
    const message = await asUser(db, ownerId, () =>
      expectError(db, `select * from share_document($1, now() - interval '1 hour')`, [invoiceId]),
    );
    expect(message).toMatch(/share_expires_in_the_past/);
  });

  it('builds the link on the address the installation recorded, and on nothing when it has not', async () => {
    const withoutBase = await shareAs(ownerId, invoiceId);
    expect(withoutBase.url).toBeNull();

    await db.query(`update instance set public_base_url = 'https://books.example.test/' where id = 1`);
    const withBase = await shareAs(ownerId, invoiceId);
    expect(withBase.url).toBe(`https://books.example.test/shared/${withBase.token}`);

    await db.query(`update instance set public_base_url = null where id = 1`);
    for (const share of [withoutBase, withBase]) {
      await asUser(db, ownerId, () => db.query(`select revoke_share($1)`, [share.share_id]));
    }
  });

  it('stores the hash and never the token', async () => {
    const share = await shareAs(ownerId, invoiceId);
    const stored = await rows<{ token_hash: string }>(
      db,
      `select token_hash from document_shares where id = $1`,
      [share.share_id],
    );
    expect(stored[0]?.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored[0]?.token_hash).not.toContain(share.token);

    // And nowhere else either: no column of the row carries it.
    const anywhere = await rows<{ n: string }>(
      db,
      `select count(*)::text as n from document_shares where to_jsonb(document_shares)::text like $1`,
      [`%${share.token}%`],
    );
    expect(anywhere[0]?.n).toBe('0');

    await asUser(db, ownerId, () => db.query(`select revoke_share($1)`, [share.share_id]));
  });
});

// ---------------------------------------------------------------------------
// What the visitor gets
// ---------------------------------------------------------------------------

describe('a visitor who holds the link', () => {
  let share: Share;

  beforeAll(async () => {
    share = await shareAs(ownerId, invoiceId);
  });

  it('reads the document without signing in, and gets what the books say', async () => {
    const seen = await readAsVisitor(share.token);
    expect(seen).not.toBeNull();

    const header = await one<Record<string, string>>(
      db,
      `select doc_type::text, number, document_date::text, currency_code,
              amount_untaxed::text, amount_tax::text, amount_total::text
         from document_header where document_id = $1`,
      [invoiceId],
    );
    expect(seen?.document['type']).toBe(header['doc_type']);
    expect(seen?.document['number']).toBe(header['number']);
    expect(seen?.document['document_date']).toBe(header['document_date']);
    expect(seen?.document['currency']).toBe(header['currency_code']);
    expect(seen?.totals).toEqual({
      amount_untaxed: header['amount_untaxed'],
      amount_tax: header['amount_tax'],
      amount_total: header['amount_total'],
    });
  });

  it('gets the seller, the buyer and the lines of that document and no identifier of anything', async () => {
    const seen = (await readAsVisitor(share.token)) as SharedDocument;

    const parties = await one<Record<string, string | null>>(
      db,
      `select seller_name, seller_vat_number, buyer_name, buyer_vat_number
         from document_header where document_id = $1`,
      [invoiceId],
    );
    expect(seen.seller['name']).toBe(parties['seller_name']);
    expect(seen.seller['vat_number']).toBe(parties['seller_vat_number']);
    expect(seen.buyer['name']).toBe(parties['buyer_name']);
    expect(seen.buyer['vat_number']).toBe(parties['buyer_vat_number']);

    const lines = await rows<{ item_name: string; amount_untaxed: string }>(
      db,
      `select item_name, amount_untaxed from document_line_items
        where document_id = $1 order by sequence`,
      [invoiceId],
    );
    expect(seen.lines.map((line) => line['name'])).toEqual(lines.map((line) => line.item_name));
    expect(seen.lines.map((line) => line['amount_untaxed'])).toEqual(
      lines.map((line) => line.amount_untaxed),
    );

    // The rule this whole function is written around: a link is one document,
    // and nothing in it can be turned into a question about a second one.
    const text = JSON.stringify(seen);
    for (const identifier of [invoiceId, companyId, share.share_id]) {
      expect(text, identifier).not.toContain(identifier);
    }
    expect(Object.keys(seen).sort()).toEqual([
      'buyer',
      'document',
      'legal_mentions',
      'lines',
      'payment',
      'seller',
      'tax_summary',
      'totals',
    ]);
    for (const key of Object.keys(seen.lines[0] ?? {})) {
      expect(key, key).not.toMatch(/_id$/);
    }
  });

  it('gets the VAT breakdown that adds up to the tax on the invoice', async () => {
    const seen = (await readAsVisitor(share.token)) as SharedDocument;
    const breakdown = await rows<{ base_amount: string; tax_charged: string }>(
      db,
      `select base_amount, tax_charged from document_tax_summary
        where document_id = $1 order by tax_rate, tax_name`,
      [invoiceId],
    );
    expect(seen.tax_summary.map((row) => row['base_amount'])).toEqual(
      breakdown.map((row) => row.base_amount),
    );
    const summed = seen.tax_summary.reduce(
      (total, row) => total + Number(row['tax_amount']),
      0,
    );
    expect(summed.toFixed(2)).toBe(Number(seen.totals['amount_tax']).toFixed(2));
  });

  it('gets the legal mentions of the pack, in the language of the document', async () => {
    const seen = (await readAsVisitor(share.token)) as SharedDocument;

    // What the country requires on what a seller issues, from the pack itself.
    const expectedCodes = await rows<{ code: string }>(
      db,
      `select code from document_legal_mentions where document_id = $1 order by sequence, code`,
      [invoiceId],
    );
    expect(seen.legal_mentions.map((mention) => mention.code)).toEqual(
      expectedCodes.map((row) => row.code),
    );
    expect(seen.legal_mentions.length).toBeGreaterThan(0);

    const language = seen.document['language'] as string;
    for (const mention of seen.legal_mentions) {
      const fromPack = pack.documents.mentions.find((m) => m.code === mention.code);
      if (fromPack === undefined) throw new Error(`${mention.code} is not a mention of this pack`);
      const translated = fromPack.text_i18n[language];
      expect(mention.text, mention.code).toBe(translated ?? fromPack.text);
    }
  });

  it('reads a document written for a customer in another language in that language', async () => {
    // A pack publishes its labels in more than one language, and the customer
    // is the one who reads the invoice: their language wins over the books'.
    const other = (pack.manifest.languages ?? []).find(
      (code) => code !== (pack.manifest.defaults.language ?? null),
    );
    if (other === undefined) throw new Error(`packs/${pack.slug} publishes only one language`);

    const contactId = await one<{ contact_id: string }>(
      db,
      `select contact_id from documents where id = $1`,
      [invoiceId],
    );
    await db.query(`update contacts set language = $2 where id = $1`, [
      contactId.contact_id,
      other,
    ]);

    const seen = (await readAsVisitor(share.token)) as SharedDocument;
    expect(seen.document['language']).toBe(other);
    for (const mention of seen.legal_mentions) {
      const fromPack = pack.documents.mentions.find((m) => m.code === mention.code);
      expect(mention.text, mention.code).toBe(fromPack?.text_i18n[other] ?? fromPack?.text);
    }

    await db.query(`update contacts set language = null where id = $1`, [contactId.contact_id]);
  });

  it('is counted, so the sender can see the link was opened', async () => {
    const before = await one<{ view_count: number }>(
      db,
      `select view_count from document_shares where id = $1`,
      [share.share_id],
    );
    await readAsVisitor(share.token);
    const after = await one<{ view_count: number; seen: boolean }>(
      db,
      `select view_count, last_viewed_at is not null as seen from document_shares where id = $1`,
      [share.share_id],
    );
    expect(Number(after.view_count)).toBe(Number(before.view_count) + 1);
    expect(after.seen).toBe(true);
  });

  it('sees what is still owed go down when a payment is matched against it', async () => {
    const before = (await readAsVisitor(share.token)) as SharedDocument;
    expect(Number(before.payment['amount_residual'])).toBeGreaterThan(0);
    expect(before.payment['last_payment_date']).toBeNull();

    const amount = (Number(before.payment['amount_residual']) / 2).toFixed(2);
    const paymentDate = golden.fiscalYear.end;
    const payment = await one<{ id: string }>(
      db,
      `insert into payments (company_id, direction, payment_date, amount, contact_id, journal_id)
       values ($1, 'inbound', $2::date, $3,
               (select contact_id from documents where id = $4),
               (select journal_id from payments where company_id = $1 and direction = 'inbound' limit 1))
       returning id`,
      [companyId, paymentDate, amount, invoiceId],
    );
    await db.query(`select post_payment($1)`, [payment.id]);
    await db.query(
      `select reconcile(
         (select l.id from entry_lines l join documents d on d.entry_id = l.entry_id
           join accounts a on a.id = l.account_id
          where d.id = $1 and a.reconcilable),
         (select l.id from entry_lines l join payments p on p.entry_id = l.entry_id
           join accounts a on a.id = l.account_id
          where p.id = $2 and a.reconcilable))`,
      [invoiceId, payment.id],
    );

    const after = (await readAsVisitor(share.token)) as SharedDocument;
    expect(Number(after.payment['amount_residual'])).toBeLessThan(
      Number(before.payment['amount_residual']),
    );
    expect(after.payment['last_payment_date']).toBe(paymentDate);
    expect(after.payment['state']).toBe('partially_paid');
  });
});

// ---------------------------------------------------------------------------
// The same answer for every kind of no
// ---------------------------------------------------------------------------

describe('a token that is not a live link', () => {
  it('answers null for one that never existed, one withdrawn and one expired — the same null', async () => {
    const revoked = await shareAs(ownerId, invoiceId);
    await asUser(db, ownerId, () => db.query(`select revoke_share($1)`, [revoked.share_id]));

    // A real expiry rather than one written backwards into the table: the
    // constraint refuses a share that is born already dead, and a share is
    // never edited, so the only way to hold an expired one is to wait for it.
    const expiring = await asUser(db, ownerId, () =>
      one<Share>(db, `select * from share_document($1, now() + interval '250 milliseconds')`, [
        invoiceId,
      ]),
    );
    expect(await readAsVisitor(expiring.token)).not.toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 400));

    const answers = [
      await readAsVisitor('not-a-token-anybody-ever-issued-aaaaaaaaaaa'),
      await readAsVisitor(revoked.token),
      await readAsVisitor(expiring.token),
      await readAsVisitor(''),
    ];
    expect(answers).toEqual([null, null, null, null]);
  });

  it('answers null once the document leaves the set that may be shared', async () => {
    const share = await shareAs(ownerId, invoiceId);
    expect(await readAsVisitor(share.token)).not.toBeNull();

    await db.query(`update documents set state = 'cancelled' where id = $1`, [invoiceId]);
    expect(await readAsVisitor(share.token)).toBeNull();

    await db.query(`update documents set state = 'posted' where id = $1`, [invoiceId]);
    expect(await readAsVisitor(share.token)).not.toBeNull();
    await asUser(db, ownerId, () => db.query(`select revoke_share($1)`, [share.share_id]));
  });

  it('does not let a withdrawn link be brought back by writing to the table', async () => {
    const share = await shareAs(ownerId, invoiceId);
    await asUser(db, ownerId, () => db.query(`select revoke_share($1)`, [share.share_id]));

    const message = await asUser(db, ownerId, () =>
      expectError(db, `update document_shares set revoked_at = null where id = $1`, [
        share.share_id,
      ]),
    );
    expect(message).toMatch(/permission denied for table document_shares/);
  });
});

// ---------------------------------------------------------------------------
// What the anonymous role may reach, which is one function and nothing else
// ---------------------------------------------------------------------------

describe('the anonymous role', () => {
  it('cannot read the table the links live in', async () => {
    const message = await asUser(
      db,
      strangerId,
      () => expectError(db, `select token_hash from document_shares`),
      'anon',
    );
    expect(message).toMatch(/permission denied for table document_shares/);
  });

  it('cannot reach the views the shared document is built from', async () => {
    for (const view of [
      'document_header',
      'document_line_items',
      'document_tax_summary',
      'document_legal_mentions',
    ]) {
      const message = await asUser(
        db,
        strangerId,
        () => expectError(db, `select * from ${view} limit 1`),
        'anon',
      );
      expect(message, view).toMatch(/permission denied/);
    }
  });

  it('cannot create a link, withdraw one, or ask which documents may be shared', async () => {
    for (const sql of [
      `select * from share_document('00000000-0000-0000-0000-000000000000')`,
      `select revoke_share('00000000-0000-0000-0000-000000000000')`,
    ]) {
      const message = await asUser(db, strangerId, () => expectError(db, sql), 'anon');
      expect(message, sql).toMatch(/permission denied for function/);
    }
  });
});

// ---------------------------------------------------------------------------
// Who may see that a document was published
// ---------------------------------------------------------------------------

describe('the list of links', () => {
  it('is row level security on the table, and every member of the company reads it', async () => {
    const share = await shareAs(ownerId, invoiceId);
    for (const userId of [ownerId, accountantId, viewerId]) {
      const seen = await asUser(db, userId, () =>
        rows<{ id: string }>(db, `select id from document_shares where company_id = $1`, [
          companyId,
        ]),
      );
      expect(seen.map((row) => row.id)).toContain(share.share_id);
    }

    const bySomebodyElse = await asUser(db, strangerId, () =>
      rows(db, `select id from document_shares`),
    );
    expect(bySomebodyElse).toEqual([]);
    await asUser(db, ownerId, () => db.query(`select revoke_share($1)`, [share.share_id]));
  });
});

// ---------------------------------------------------------------------------
// The trail
// ---------------------------------------------------------------------------

describe('the audit trail', () => {
  it('carries the publication and the withdrawal, and names who did each', async () => {
    const share = await shareAs(accountantId, invoiceId);
    await asUser(db, accountantId, () => db.query(`select revoke_share($1)`, [share.share_id]));

    const trail = await rows<{ action: string; actor_id: string; record_id: string }>(
      db,
      `select action, actor_id, record_id from audit_log
        where table_name = 'document_shares' and record_id = $1
        order by id`,
      [share.share_id],
    );
    expect(trail.map((row) => row.action)).toEqual(['document_shared', 'document_share_revoked']);
    expect(trail.every((row) => row.actor_id === accountantId)).toBe(true);
  });

  it('never writes the token into it', async () => {
    const share = await shareAs(ownerId, invoiceId);
    const leaked = await rows<{ n: string }>(
      db,
      `select count(*)::text as n from audit_log
        where coalesce(old_values::text, '') || coalesce(new_values::text, '') like $1`,
      [`%${share.token}%`],
    );
    expect(leaked[0]?.n).toBe('0');
    await asUser(db, ownerId, () => db.query(`select revoke_share($1)`, [share.share_id]));
  });
});
