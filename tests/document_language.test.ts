/**
 * The language a document was written in.
 *
 * Until `documents.language` existed the answer was re-derived on every read,
 * from the customer's preference, then the company's, then the pack's — so a
 * customer who switched language rewrote every invoice ever sent to them, legal
 * mentions included. These tests hold the two halves of the fix: the chain
 * still decides, and it decides once.
 *
 * A draft is the part that keeps moving. It carries no number and no entry, the
 * customer on it may still change, and so may that customer's own language;
 * until it is posted, its language is whatever the chain answers today. The
 * moment it is posted the column stops, and the guard says so by name.
 *
 * Every expectation here comes from a pack — which languages it publishes,
 * which sentence its law puts at the foot of what a seller issues, which
 * account its manifest names for a sale. A country is named where a scenario is
 * set up and nowhere else.
 */

import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pack } from '../packages/cli/src/index.js';
import {
  expectError,
  freshDatabase,
  migrationFiles,
  one,
  repoRoot,
  rows,
  seedFiles,
  shimPath,
} from './helpers/db.js';
import { newCompany, newContact, newDocument } from './helpers/factory.js';
import { packWhere, roleOf } from './helpers/packs.js';

/** The migration under test, and the line the backfill test builds up to. */
const MIGRATION = '20260915191200_a_document_knows_its_language.sql';

let db: PGlite;
let pack: Pack;
let companyId: string;
/** The language the books are kept in, and two the customer may read in. */
let bookkeeping: string;
let first: string;
let second: string;
/** An account of the pack's own manifest, for the one line every document has. */
let salesAccount: string;

beforeAll(async () => {
  // Two declared languages besides the company's, because the test needs to
  // move a customer from one to another and see the document stay where it
  // was; and a sentence the country puts on what a seller issues, because the
  // mentions are what the language is actually for.
  pack = packWhere(
    'publishes two languages and puts a sentence on what a seller issues',
    (p) =>
      (p.manifest.languages ?? []).length >= 2 &&
      p.documents.mentions.some(
        (m) => m.applies_when === 'always' || m.applies_when === 'late_payment',
      ),
  );
  [first, second] = pack.manifest.languages as [string, string];
  bookkeeping = pack.manifest.defaults.language as string;
  salesAccount = roleOf(pack, 'sales');

  db = await freshDatabase();
  ({ companyId } = await newCompany(db, {
    country: pack.manifest.country,
    name: 'Meertalig',
    language: bookkeeping,
  }));
}, 180_000);

afterAll(async () => {
  await db.close();
});

/** A customer of this company, reading in a language or in none. */
async function customer(name: string, language: string | null): Promise<string> {
  const id = await newContact(db, companyId, { name, country: pack.manifest.country });
  await db.query(`update contacts set language = $2 where id = $1`, [id, language]);
  return id;
}

/** A one-line draft addressed to a customer. */
async function draftFor(contactId: string, number: string): Promise<string> {
  return newDocument(db, companyId, {
    docType: 'sale_invoice',
    number,
    contactId,
    lines: [{ unitPrice: 100, accountCode: salesAccount }],
  });
}

/** What the column holds. */
async function languageOf(documentId: string): Promise<string> {
  const row = await one<{ language: string }>(
    db,
    `select language from documents where id = $1`,
    [documentId],
  );
  return row.language;
}

describe('where a document takes its language from', () => {
  it('starts at the customer, who is the one who reads it', async () => {
    const contactId = await customer('Leest anders', first);
    const documentId = await draftFor(contactId, 'LANG-001');
    expect(await languageOf(documentId)).toBe(first);
  });

  it('falls back to the company when the customer has said nothing', async () => {
    const contactId = await customer('Zegt niets', null);
    const documentId = await draftFor(contactId, 'LANG-002');
    expect(await languageOf(documentId)).toBe(bookkeeping);
  });

  it('keeps a language the caller wrote itself', async () => {
    const contactId = await customer('Overruled', first);
    const documentId = await one<{ id: string }>(
      db,
      `insert into documents (company_id, doc_type, number, contact_id, document_date, language)
       values ($1, 'sale_invoice', 'LANG-003', $2, '2026-06-15', $3) returning id`,
      [companyId, contactId, second],
    );
    expect(await languageOf(documentId.id)).toBe(second);
  });

  it('is the chain preferred_languages() walks, from a starting point it is given', async () => {
    // The overload is the whole of the fix to the second gap: the chain was
    // never about a user, only about where it starts.
    const fromDocument = await one<{ languages: string[] }>(
      db,
      `select preferred_languages($1, $2) as languages`,
      [first, companyId],
    );
    expect(fromDocument.languages[0]).toBe(first);
    expect(fromDocument.languages).toContain(bookkeeping);

    const fromNobody = await one<{ languages: string[] }>(
      db,
      `select preferred_languages(null::text, $1) as languages`,
      [companyId],
    );
    expect(fromNobody.languages[0]).toBe(bookkeeping);
  });
});

describe('a draft, which nobody has been sent', () => {
  it('follows the customer when the customer changes language', async () => {
    const contactId = await customer('Verandert', first);
    const documentId = await draftFor(contactId, 'LANG-010');
    expect(await languageOf(documentId)).toBe(first);

    await db.query(`update contacts set language = $2 where id = $1`, [contactId, second]);
    expect(await languageOf(documentId)).toBe(second);
  });

  it('follows the chain again when it is addressed to somebody else', async () => {
    const one_ = await customer('Eerste klant', first);
    const other = await customer('Tweede klant', second);
    const documentId = await draftFor(one_, 'LANG-011');
    expect(await languageOf(documentId)).toBe(first);

    await db.query(`update documents set contact_id = $2 where id = $1`, [documentId, other]);
    expect(await languageOf(documentId)).toBe(second);
  });

  it('may be given another language by hand', async () => {
    const contactId = await customer('Met de hand', first);
    const documentId = await draftFor(contactId, 'LANG-012');
    await db.query(`update documents set language = $2 where id = $1`, [documentId, second]);
    expect(await languageOf(documentId)).toBe(second);
  });
});

describe('a document that has been posted', () => {
  let contactId: string;
  let documentId: string;

  beforeAll(async () => {
    contactId = await customer('Gefactureerd', first);
    documentId = await draftFor(contactId, 'LANG-020');
    await db.query(`select post_document($1)`, [documentId]);
  });

  it('keeps the language it was sent in when the customer moves on', async () => {
    expect(await languageOf(documentId)).toBe(first);
    await db.query(`update contacts set language = $2 where id = $1`, [contactId, second]);
    expect(await languageOf(documentId)).toBe(first);
  });

  it('reprints its legal mentions in that language and not in the customer of today', async () => {
    const mentions = await rows<{ code: string; language: string; text: string }>(
      db,
      `select code, language, text from document_legal_mentions
        where document_id = $1 order by sequence, code`,
      [documentId],
    );
    expect(mentions.length).toBeGreaterThan(0);
    for (const mention of mentions) {
      const declared = pack.documents.mentions.find((m) => m.code === mention.code);
      if (declared === undefined) throw new Error(`${mention.code} is not a mention of this pack`);
      expect(mention.language, mention.code).toBe(first);
      expect(mention.text, mention.code).toBe(declared.text_i18n[first] ?? declared.text);
    }
  });

  it('refuses to be rewritten, by name', async () => {
    const message = await expectError(db, `update documents set language = $2 where id = $1`, [
      documentId,
      second,
    ]);
    expect(message).toMatch(/document_language_frozen/);
    expect(await languageOf(documentId)).toBe(first);
  });

  it('is not moved by a customer who goes back and forth either', async () => {
    await db.query(`update contacts set language = $2 where id = $1`, [contactId, first]);
    expect(await languageOf(documentId)).toBe(first);
    await db.query(`update contacts set language = null where id = $1`, [contactId]);
    expect(await languageOf(documentId)).toBe(first);
  });
});

describe('the documents that were here before the column was', () => {
  it('are filled from the same chain, which is the best that can be said of them', async () => {
    // A database built to the migration before this one, given a document, and
    // then handed the migration. Nothing else can be said about a document
    // already sent: the chain is what produced the PDF in the customer's inbox,
    // and from here on nothing is derived twice.
    const before = new PGlite();
    await before.waitReady;
    await before.exec(await readFile(shimPath, 'utf8'));
    for (const file of await migrationFiles()) {
      if (file >= MIGRATION) break;
      await before.exec(await readFile(join(repoRoot, 'supabase', 'migrations', file), 'utf8'));
    }
    for (const file of await seedFiles()) {
      await before.exec(await readFile(join(repoRoot, 'supabase', 'seed', file), 'utf8'));
    }

    const older = await newCompany(before, {
      country: pack.manifest.country,
      name: 'Van vroeger',
      language: bookkeeping,
    });
    const reader = await newContact(before, older.companyId, {
      name: 'Oude klant',
      country: pack.manifest.country,
    });
    await before.query(`update contacts set language = $2 where id = $1`, [reader, first]);
    const silent = await newContact(before, older.companyId, {
      name: 'Stille klant',
      country: pack.manifest.country,
    });

    const spoken = await newDocument(before, older.companyId, {
      docType: 'sale_invoice',
      number: 'OLD-001',
      contactId: reader,
      lines: [{ unitPrice: 100, accountCode: salesAccount }],
    });
    const unspoken = await newDocument(before, older.companyId, {
      docType: 'sale_invoice',
      number: 'OLD-002',
      contactId: silent,
      lines: [{ unitPrice: 100, accountCode: salesAccount }],
    });

    const columns = await rows<{ n: number }>(
      before,
      `select count(*)::int as n from information_schema.columns
        where table_name = 'documents' and column_name = 'language'`,
    );
    expect(columns[0]?.n, 'the column is not supposed to exist yet').toBe(0);

    await before.exec(
      await readFile(join(repoRoot, 'supabase', 'migrations', MIGRATION), 'utf8'),
    );

    const filled = await rows<{ number: string; language: string }>(
      before,
      `select number, language from documents where company_id = $1 order by number`,
      [older.companyId],
    );
    expect(filled).toEqual([
      { number: 'OLD-001', language: first },
      { number: 'OLD-002', language: bookkeeping },
    ]);
    expect(spoken).not.toBe(unspoken);

    await before.close();
  }, 180_000);
});
