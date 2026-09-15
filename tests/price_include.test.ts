import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { roundCurrency } from '../packages/mcp/src/rounding.js';
import { asUser, expectError, freshDatabase, one, rows } from './helpers/db.js';
import { installFixturePack } from './helpers/fixture-pack.js';
import { newCompany, newContact, newDocument, newUser, taxId, type Fixture } from './helpers/factory.js';
import { packWhere } from './helpers/packs.js';

/**
 * A price that already holds its tax.
 *
 * `taxes.price_include` had been a column since the tax engine landed and was
 * read by nothing: a line carrying such a tax was booked with the tax added on
 * top of a price the customer had already paid. What is proved here:
 *
 *   1. the gross is converted per **tax group**, not per line — the tax
 *      rounded once as BR-CO-14 requires, the base the gross less that tax, so
 *      the total is the price that was quoted, to the unit, always;
 *   2. the base is shared over the lines in proportion to their gross and the
 *      last line takes the remainder, so the lines add up to the group;
 *   3. a discount applies to the gross, before the conversion;
 *   4. the flag is snapshotted on the line and frozen when the document is
 *      posted, so changing the tax cannot rewrite an invoice that was sent;
 *   5. the three refusals — a fixed-amount tax, a line with no tax, a group
 *      that is half inclusive — each answer by name;
 *   6. an invoice behind a share link says which price it is showing;
 *   7. none of it assumes a currency with cents.
 *
 * The pack under test is whichever one prices with the tax in it, and the rate
 * and the account come from that pack's own files: nothing here names a
 * country.
 */

/** The pack that carries a tax whose price holds it, and that tax. */
const pack = packWhere('prices with the tax already in the price', (p) =>
  p.taxes.some((tax) => tax.price_include),
);
const inclusiveTax = pack.taxes.find((tax) => tax.price_include)!;
const RATE = Number(inclusiveTax.rate);

/**
 * The account the pack's own golden puts that tax on. Reading it there rather
 * than picking one keeps this test true of the pack and not of a chart.
 */
const SALES_ACCOUNT = (() => {
  for (const document of pack.golden?.documents ?? []) {
    for (const line of document.lines) {
      if (line.tax === inclusiveTax.code) return line.account;
    }
  }
  throw new Error(`${pack.slug} declares ${inclusiveTax.code} and never books it`);
})();

/** The conversion, written out, at a given number of decimals. */
function taxOutOf(gross: number, decimals = 2): number {
  return roundCurrency(gross - gross / (1 + RATE / 100), decimals);
}

/** ISO 4217 assigns nothing beginning with Z, so this shadows no real money. */
const ZERO_DECIMAL = { country: 'ZY', currency: 'ZYA', currencyName: 'Zeroland unit', decimals: 0 };
const THREE_DECIMAL = { country: 'ZX', currency: 'ZXB', currencyName: 'Threeland unit', decimals: 3 };

let db: PGlite;
let retail: Fixture;
let customer: string;

beforeAll(async () => {
  db = await freshDatabase();
  const owner = await newUser(db, 'retail@example.test');
  // country-literal: the pack under test is the one that prices with the tax
  // in it, and a company has to be installed somewhere to book anything.
  retail = await newCompany(db, {
    country: pack.manifest.country,
    name: 'Retail Fixture',
    ownerId: owner,
  });
  customer = await newContact(db, retail.companyId, { country: pack.manifest.country });
}, 180_000);

afterAll(async () => {
  await db.close();
});

describe('the column reaches the line', () => {
  it('snapshots the flag from the tax, and leaves a line with no tax alone', async () => {
    const document = await newDocument(db, retail.companyId, {
      docType: 'sale_invoice',
      contactId: customer,
      lines: [
        { name: 'Counter sale', unitPrice: 100, taxCode: inclusiveTax.code, accountCode: SALES_ACCOUNT },
        { name: 'Out of scope', unitPrice: 50, taxCode: null, accountCode: SALES_ACCOUNT },
      ],
    });
    const lines = await rows<{ name: string; includes: boolean; gross: string | null }>(
      db,
      `select name, unit_price_includes_tax as includes, amount_incl_tax::text as gross
         from document_lines where document_id = $1 order by sequence`,
      [document],
    );
    expect(lines).toEqual([
      { name: 'Counter sale', includes: true, gross: '100.00' },
      { name: 'Out of scope', includes: false, gross: null },
    ]);
  });

  it('refuses a price that includes a tax the line does not name', async () => {
    const document = await newDocument(db, retail.companyId, {
      docType: 'sale_invoice',
      number: 'OUT-OF-SCOPE-1',
      contactId: customer,
      lines: [{ name: 'Anything', unitPrice: 10, taxCode: null, accountCode: SALES_ACCOUNT }],
    });
    // On a draft the trigger reads the tax and answers false, so the column can
    // only be made to lie once the snapshot is frozen. The constraint is the
    // floor under it.
    await db.query(`select post_document($1)`, [document]);
    const message = await expectError(
      db,
      `update document_lines set unit_price_includes_tax = true where document_id = $1`,
      [document],
    );
    expect(message).toMatch(/document_lines_included_tax_needs_a_tax/);
  });

  it('refuses a fixed-amount tax that claims to be included in the price', async () => {
    const tax = await taxId(db, retail.companyId, inclusiveTax.code);
    const message = await expectError(db, `update taxes set amount_type = 'fixed' where id = $1`, [
      tax,
    ]);
    expect(message).toMatch(/taxes_price_include_needs_a_rate/);
  });
});

describe('one line, and the price the customer paid', () => {
  let document: string;

  beforeAll(async () => {
    document = await newDocument(db, retail.companyId, {
      docType: 'sale_invoice',
      number: 'RETAIL-1',
      contactId: customer,
      lines: [
        { name: 'Counter sales', unitPrice: 100, taxCode: inclusiveTax.code, accountCode: SALES_ACCOUNT },
      ],
    });
  });

  it('takes the tax out of the price instead of adding it on top', async () => {
    const tax = taxOutOf(100);
    const totals = await one<{ untaxed: string; tax: string; total: string }>(
      db,
      `select amount_untaxed::text as untaxed, amount_tax::text as tax, amount_total::text as total
         from documents where id = $1`,
      [document],
    );
    expect(totals).toEqual({
      untaxed: (100 - tax).toFixed(2),
      tax: tax.toFixed(2),
      total: '100.00',
    });
  });

  it('publishes a net line amount and keeps the gross that was quoted beside it', async () => {
    const line = await one<{
      untaxed: string;
      gross: string;
      unit_price: string;
      includes: boolean;
    }>(
      db,
      `select amount_untaxed::text as untaxed, amount_incl_tax::text as gross,
              unit_price::text, unit_price_includes_tax as includes
         from document_line_items where document_id = $1`,
      [document],
    );
    // BT-131 is net, and the gross the customer paid is beside it under its own
    // name. `unit_price` is the price as keyed, which is the gross one here —
    // BT-146 wants the net price and this view does not publish it yet, which
    // is a gap named in docs/international.md.
    expect(line.untaxed).toBe((100 - taxOutOf(100)).toFixed(2));
    expect(line.gross).toBe('100.00');
    expect(line.unit_price).toBe('100.000000');
    expect(line.includes).toBe(true);
  });

  it('books an entry that balances on the price that was quoted', async () => {
    await db.query(`select post_document($1)`, [document]);
    const entry = await one<{ debit: string; credit: string }>(
      db,
      `select e.total_debit::text as debit, e.total_credit::text as credit
         from entries e join documents d on d.entry_id = e.id where d.id = $1`,
      [document],
    );
    expect(entry).toEqual({ debit: '100.00', credit: '100.00' });
  });
});

describe('a group of three, a discount and a remainder', () => {
  /**
   * 100 × 49.99, 4 × 59.99, and 5 × 59.99 with 15 % off: three grosses of
   * 4 999.00, 239.96 and 254.96. Shared out on their own, the three bases round
   * to a penny more than the group's base, which is what the last line is for.
   */
  const GROSS = [4999.0, 239.96, 254.96];
  let document: string;

  beforeAll(async () => {
    document = await newDocument(db, retail.companyId, {
      docType: 'sale_invoice',
      number: 'RETAIL-2',
      contactId: customer,
      lines: [
        { name: 'Waxed jackets', quantity: 100, unitPrice: 49.99, taxCode: inclusiveTax.code, accountCode: SALES_ACCOUNT },
        { name: 'Walking boots', quantity: 4, unitPrice: 59.99, taxCode: inclusiveTax.code, accountCode: SALES_ACCOUNT },
        {
          name: 'Clearance rail',
          quantity: 5,
          unitPrice: 59.99,
          discountPercent: 15,
          taxCode: inclusiveTax.code,
          accountCode: SALES_ACCOUNT,
        },
      ],
    });
  });

  it('applies the discount to the gross, before the tax is taken out of it', async () => {
    const lines = await rows<{ gross: string }>(
      db,
      `select amount_incl_tax::text as gross from document_lines
        where document_id = $1 and line_type = 'product' order by sequence`,
      [document],
    );
    expect(lines.map((l) => l.gross)).toEqual(GROSS.map((g) => g.toFixed(2)));
  });

  it('rounds the tax once on the group, and the base is the gross less that tax', async () => {
    const gross = roundCurrency(GROSS[0]! + GROSS[1]! + GROSS[2]!, 2);
    const tax = taxOutOf(gross);
    const summary = await one<{ base: string; tax: string }>(
      db,
      `select base_amount::text as base, tax_amount::text as tax
         from document_tax_summary where document_id = $1`,
      [document],
    );
    expect(summary).toEqual({ base: (gross - tax).toFixed(2), tax: tax.toFixed(2) });

    const totals = await one<{ total: string }>(
      db,
      `select amount_total::text as total from documents where id = $1`,
      [document],
    );
    expect(totals.total).toBe(gross.toFixed(2));
  });

  it('shares the base out in proportion, and puts the remainder on the last line', async () => {
    const gross = roundCurrency(GROSS[0]! + GROSS[1]! + GROSS[2]!, 2);
    const base = roundCurrency(gross - taxOutOf(gross), 2);
    const shares = GROSS.map((g) => roundCurrency((base * g) / gross, 2));
    const naive = roundCurrency(shares[0]! + shares[1]! + shares[2]!, 2);
    // The case this document was chosen for: three shares rounded on their own
    // do not add up to the base they came from.
    expect(naive).not.toBe(base);

    const lines = await rows<{ untaxed: string }>(
      db,
      `select amount_untaxed::text as untaxed from document_lines
        where document_id = $1 and line_type = 'product' order by sequence`,
      [document],
    );
    expect(lines.map((l) => l.untaxed)).toEqual([
      shares[0]!.toFixed(2),
      shares[1]!.toFixed(2),
      roundCurrency(base - shares[0]! - shares[1]!, 2).toFixed(2),
    ]);
  });
});

describe('the invoice behind a link says which price it is showing', () => {
  /**
   * `shared_document()` names every field of a line by hand, so a column added
   * to `document_line_items` does not reach it on its own. A customer opening a
   * retail invoice would otherwise be shown a gross `unit_price` beside a net
   * `amount_untaxed`, with nothing saying which is which.
   */
  it('carries the flag and the gross into the shared payload', async () => {
    const document = await newDocument(db, retail.companyId, {
      docType: 'sale_invoice',
      number: 'RETAIL-SHARE',
      contactId: customer,
      lines: [
        { name: 'Counter sales', unitPrice: 100, taxCode: inclusiveTax.code, accountCode: SALES_ACCOUNT },
        { name: 'Out of scope', unitPrice: 40, taxCode: null, accountCode: SALES_ACCOUNT },
      ],
    });
    await db.query(`select post_document($1)`, [document]);

    const share = await asUser(db, retail.ownerId, () =>
      one<{ token: string }>(db, `select token from share_document($1)`, [document]),
    );
    const stranger = await newUser(db);
    const seen = await asUser(
      db,
      stranger,
      () =>
        rows<{ p: { lines: Record<string, unknown>[]; document: Record<string, unknown> } | null }>(
          db,
          `select shared_document($1) as p`,
          [share.token],
        ),
      'anon',
    );
    const payload = seen[0]?.p ?? null;
    // Replacing a function replaces it whole, so this also proves that what the
    // migration before this one put in the payload is still in it: the language
    // the document was written in, and the sentences that came out in it.
    expect((payload as unknown as { document: Record<string, unknown> }).document['language'])
      .toBeTruthy();
    expect(
      (payload as unknown as { legal_mentions: unknown[] }).legal_mentions,
    ).toBeInstanceOf(Array);

    const lines = payload?.lines ?? [];
    expect(lines).toHaveLength(2);

    // The retail line: the keyed price is the gross one and the payload says so.
    expect(lines[0]).toMatchObject({
      unit_price: '100.000000',
      unit_price_includes_tax: true,
      amount_incl_tax: '100.00',
      amount_untaxed: (100 - taxOutOf(100)).toFixed(2),
    });
    // And a line priced without a tax is unchanged: no gross, and it says so.
    expect(lines[1]).toMatchObject({
      unit_price: '40.000000',
      unit_price_includes_tax: false,
      amount_incl_tax: null,
      amount_untaxed: '40.00',
    });
  });
});

describe('the snapshot is frozen when the document is posted', () => {
  it('keeps the base a posted invoice was sent with when the tax changes', async () => {
    const document = await newDocument(db, retail.companyId, {
      docType: 'sale_invoice',
      number: 'RETAIL-3',
      contactId: customer,
      lines: [
        { name: 'Counter sales', unitPrice: 240, taxCode: inclusiveTax.code, accountCode: SALES_ACCOUNT },
      ],
    });
    await db.query(`select post_document($1)`, [document]);
    const before = await one<{ untaxed: string; includes: boolean }>(
      db,
      `select amount_untaxed::text as untaxed, unit_price_includes_tax as includes
         from document_lines where document_id = $1`,
      [document],
    );

    // The pack changes its mind. A document that has been sent does not.
    const tax = await taxId(db, retail.companyId, inclusiveTax.code);
    await db.query(`update taxes set price_include = false where id = $1`, [tax]);
    await db.query(
      `update document_lines set description = 'reprinted' where document_id = $1`,
      [document],
    );

    const after = await one<{ untaxed: string; includes: boolean }>(
      db,
      `select amount_untaxed::text as untaxed, unit_price_includes_tax as includes
         from document_lines where document_id = $1`,
      [document],
    );
    expect(after).toEqual(before);
    expect(after.includes).toBe(true);
    await db.query(`update taxes set price_include = true where id = $1`, [tax]);
  });

  it('refuses a tax group that is half quoted with the tax and half without', async () => {
    const document = await newDocument(db, retail.companyId, {
      docType: 'sale_invoice',
      number: 'RETAIL-4',
      contactId: customer,
      lines: [
        { name: 'First', unitPrice: 100, taxCode: inclusiveTax.code, accountCode: SALES_ACCOUNT },
        { name: 'Second', unitPrice: 60, taxCode: inclusiveTax.code, accountCode: SALES_ACCOUNT },
      ],
    });
    // A draft cannot hold a half-inclusive group: the trigger reads the tax on
    // every write, so both lines always agree. Freezing the snapshot is what
    // makes one possible at all, which is why the document is posted first.
    await db.query(`select post_document($1)`, [document]);
    const message = await expectError(
      db,
      `update document_lines set unit_price_includes_tax = false
        where document_id = $1 and sequence = 10`,
      [document],
    );
    expect(message).toMatch(/mixed_price_include/);
  });
});

describe('a currency with no decimals, and one with three', () => {
  let zeroCompany: string;
  let zeroTax: string;
  let zeroAccount: string;
  let zeroRate: number;

  beforeAll(async () => {
    await installFixturePack(db, ZERO_DECIMAL);
    await installFixturePack(db, THREE_DECIMAL);
    const company = await one<{ id: string }>(
      db,
      `insert into companies (name, country, fiscal_country, currency_code, language)
       select 'Zeroland Retail', $1, $1, d.currency_code, d.language_default
         from country_defaults d where d.country = $1
       returning id`,
      [ZERO_DECIMAL.country],
    );
    zeroCompany = company.id;
    await db.query(
      `insert into company_members (company_id, user_id, role) values ($1, gen_random_uuid(), 'owner')`,
      [zeroCompany],
    );
    await db.query(`select install_country_template($1, $2)`, [zeroCompany, ZERO_DECIMAL.country]);
    await db.query(
      `insert into fiscal_years (company_id, name, start_date, end_date)
       values ($1, 'Exercice 2026', date '2026-01-01', date '2026-12-31')`,
      [zeroCompany],
    );

    // The fixture pack is a copy of a real one and carries no retail tax, so
    // the highest standard sale rate it has is told to price with the tax in
    // it. Which tax that is comes from the installed books, never from a code.
    const chosen = await one<{ id: string; amount: string; account_id: string }>(
      db,
      `select t.id, t.amount::text,
              (select tp.account_id from tax_postings tp
                where tp.tax_id = t.id and tp.posting_type = 'tax'
                  and tp.document_kind = 'invoice' limit 1) as account_id
         from taxes t
        where t.company_id = $1 and t.applies_to in ('sale', 'both')
          and t.amount_type = 'percent' and t.amount > 0 and t.treatment = 'domestic'
        order by t.amount desc, t.code limit 1`,
      [zeroCompany],
    );
    zeroTax = chosen.id;
    zeroRate = Number(chosen.amount);
    await db.query(`update taxes set price_include = true where id = $1`, [zeroTax]);

    const account = await one<{ id: string }>(
      db,
      `select a.id from accounts a
        where a.company_id = $1 and a.account_type = 'income'
        order by a.code limit 1`,
      [zeroCompany],
    );
    zeroAccount = account.id;
  }, 240_000);

  it('gives whole units, and a total that is the price on the ticket', async () => {
    const contact = await newContact(db, zeroCompany, { country: ZERO_DECIMAL.country });
    const document = await one<{ id: string }>(
      db,
      `insert into documents (company_id, doc_type, contact_id, document_date)
       values ($1, 'sale_invoice', $2, date '2026-06-15') returning id`,
      [zeroCompany, contact],
    );
    await db.query(
      `insert into document_lines (document_id, company_id, sequence, name, quantity,
                                   unit_price, tax_id, account_id)
       values ($1, $2, 10, 'Counter sales', 1, 100, $3, $4)`,
      [document.id, zeroCompany, zeroTax, zeroAccount],
    );

    const expectedTax = roundCurrency(100 - 100 / (1 + zeroRate / 100), 0);
    const totals = await one<{ untaxed: string; tax: string; total: string }>(
      db,
      `select amount_untaxed::text as untaxed, amount_tax::text as tax, amount_total::text as total
         from documents where id = $1`,
      [document.id],
    );
    // Whole units, and the two of them add back to the hundred that was paid.
    expect(totals.tax).toBe(expectedTax.toFixed(2));
    expect(totals.untaxed).toBe((100 - expectedTax).toFixed(2));
    expect(totals.total).toBe('100.00');
    expect(Number(totals.tax) % 1).toBe(0);
    expect(Number(totals.untaxed) % 1).toBe(0);
  });

  it('takes the tax out at the millime in a currency that has them', async () => {
    const contact = await newContact(db, zeroCompany, { country: ZERO_DECIMAL.country });
    const document = await one<{ id: string }>(
      db,
      `insert into documents (company_id, doc_type, contact_id, document_date, currency_code,
                             exchange_rate)
       values ($1, 'sale_invoice', $2, date '2026-06-15', $3, 1) returning id`,
      [zeroCompany, contact, THREE_DECIMAL.currency],
    );
    await db.query(
      `insert into document_lines (document_id, company_id, sequence, name, quantity,
                                   unit_price, tax_id, account_id)
       values ($1, $2, 10, 'Counter sales', 1, 100, $3, $4)`,
      [document.id, zeroCompany, zeroTax, zeroAccount],
    );

    const summary = await one<{ tax: string; base: string }>(
      db,
      `select tax_amount::text as tax, base_amount::text as base
         from document_tax_summary where document_id = $1`,
      [document.id],
    );
    // The engine works at the decimals of the currency: three of them here.
    expect(summary.tax).toBe(roundCurrency(100 - 100 / (1 + zeroRate / 100), 3).toFixed(3));

    // And the base comes back at two, because `document_lines.amount_untaxed`
    // is `numeric(16, 2)` and rounds the third decimal away on the way in — by
    // the column and not by the rule. That gap is not this migration's: it is
    // named in `currency_rounding.test.ts` and in `docs/decisions.md`, and it
    // is why a three-decimal currency is asserted here on the figure the view
    // computes rather than on the one the column stores.
    expect(summary.base).toBe(roundCurrency(100 - Number(summary.tax), 2).toFixed(2));
  });
});
