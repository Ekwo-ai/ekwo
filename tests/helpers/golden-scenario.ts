/**
 * Replaying a pack's golden scenario into a company.
 *
 * `packs/<cc>/golden/scenario.json` is the one year of books a country pack
 * carries: its contacts, its documents in the order a business did them, and
 * its payments with what each one matches. Two tests need to replay it —
 * `tests/golden.test.ts`, which compares the figures to the files committed
 * beside the scenario, and `tests/e2e/lifecycle.test.ts`, which replays the
 * same year on a company installed at the previous version and then closes it.
 *
 * So the replay lives here and not in either of them. A second copy would be a
 * second scenario for the same pack, and the point of a golden is that there
 * is one.
 */

import type { PGlite } from '@electric-sql/pglite';
import type { PackGolden } from '../../packages/cli/src/index.js';
import { one } from './db.js';
import { newContact, newDocument } from './factory.js';

export interface Replayed {
  /** `ref` of the scenario to the id in the database. */
  contacts: Map<string, string>;
  documents: Map<string, string>;
  payments: Map<string, string>;
}

/** The reconcilable third-party line an entry wrote, by what produced it. */
export async function thirdPartyLine(
  db: PGlite,
  column: 'document_id' | 'payment_id',
  id: string,
): Promise<string> {
  const table = column === 'document_id' ? 'documents' : 'payments';
  const row = await one<{ id: string }>(
    db,
    `select l.id
       from entry_lines l
       join accounts a on a.id = l.account_id
       join ${table} t on t.entry_id = l.entry_id
      where t.id = $1 and a.reconcilable
        and a.account_type in ('asset_receivable', 'liability_payable')`,
    [id],
  );
  return row.id;
}

/**
 * Books the whole scenario into a company that already holds the pack.
 *
 * Through the real functions — `post_document`, `post_payment`, `reconcile` —
 * because a replay that inserted the entries itself would prove nothing about
 * the engine that writes them.
 */
export async function replayScenario(
  db: PGlite,
  companyId: string,
  golden: PackGolden,
): Promise<Replayed> {
  const contacts = new Map<string, string>();
  const documents = new Map<string, string>();
  const payments = new Map<string, string>();

  for (const contact of golden.contacts) {
    contacts.set(
      contact.ref,
      await newContact(db, companyId, {
        name: contact.name,
        type: contact.type,
        country: contact.country,
        vat: contact.vat_number,
        auxiliaryCode: contact.auxiliary_code,
      }),
    );
  }

  // In the order the scenario lists them, which is the order a business did
  // them: numbering is gapless in most countries, so the order is part of
  // what the golden records.
  for (const document of golden.documents) {
    const id = await newDocument(db, companyId, {
      docType: document.type,
      contactId: contacts.get(document.contact) as string,
      date: document.date,
      dueDate: document.due_date,
      lines: document.lines.map((line) => ({
        name: line.name,
        quantity: line.quantity,
        unitPrice: line.unit_price,
        discountPercent: line.discount_percent,
        taxCode: line.tax,
        accountCode: line.account,
      })),
    });
    await db.query(`select post_document($1)`, [id]);
    documents.set(document.ref, id);
  }

  for (const payment of golden.payments) {
    const row = await one<{ id: string }>(
      db,
      `insert into payments (company_id, direction, payment_date, amount, contact_id, journal_id)
       values ($1, $2, $3::date, $4, $5,
               (select id from journals where company_id = $1 and code = $6))
       returning id`,
      [
        companyId,
        payment.direction,
        payment.date,
        payment.amount,
        contacts.get(payment.contact) as string,
        payment.journal,
      ],
    );
    await db.query(`select post_payment($1)`, [row.id]);
    payments.set(payment.ref, row.id);
    if (payment.match === null) continue;

    // A matching is between the two third-party lines: the one the document
    // wrote and the one the payment wrote. `reconcile` takes the lesser of the
    // two open amounts, so a part payment matches for what it is worth and
    // leaves the invoice open for the rest.
    const documentLine = await thirdPartyLine(db, 'document_id', documents.get(payment.match) as string);
    const paymentLine = await thirdPartyLine(db, 'payment_id', row.id);
    await db.query(`select reconcile($1, $2)`, [documentLine, paymentLine]);
  }

  return { contacts, documents, payments };
}
