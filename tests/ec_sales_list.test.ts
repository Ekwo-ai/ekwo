import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pack, PackTax } from '../packages/cli/src/index.js';
import { asUser, expectError, freshDatabase, one, rows } from './helpers/db.js';
import { newCompany, newContact, newDocument, newUser } from './helpers/factory.js';
import { replayScenario } from './helpers/golden-scenario.js';
import { allPacks, packWhere, packsWhere } from './helpers/packs.js';

/**
 * `ec_sales_list()` — the recapitulative statement of intra-Community supplies.
 *
 * Two things are proved here and they are not the same thing.
 *
 * The first is that the list says what the declaration says. A country pack
 * already carries a year of books and the declaration it produces, to the
 * cent; if the statement and the return disagree about how much was supplied
 * to other Member States, one of them is wrong, and until now nothing could
 * notice. That comparison is the first half of this file, and it is derived
 * from the pack rather than written down: which boxes report an
 * intra-Community supply and with which sign is something `taxes.json` already
 * says, so the test reads it there and reconciles every pack that has such
 * taxes — including the one whose form puts its credit notes in a box of their
 * own, which is the case a per-box equality would have got wrong.
 *
 * The second is that a supply which cannot be declared comes back rather than
 * disappearing. A customer with no VAT number is the ordinary way a listing
 * goes wrong, and a function that quietly dropped the line would produce a
 * file that balances against nothing.
 */

// ---------------------------------------------------------------------------
// What the pack says about its own intra-Community boxes
// ---------------------------------------------------------------------------

/** A tax that reports a supply to another Member State, not an acquisition. */
function isSupply(tax: PackTax): boolean {
  return tax.treatment.startsWith('intracom_') && !tax.treatment.startsWith('intracom_acquisition_');
}

/** `intracom_goods` is `goods`, exactly as the function derives it in SQL. */
function natureOf(tax: PackTax): string {
  return tax.treatment.replace(/^intracom_/, '');
}

interface BasePosting {
  box: string;
  nature: string | null;
  /**
   * What multiplies the box to get back the statement's own sign: an invoice
   * adds and a credit note deducts, whatever sign the form asks the box to
   * carry. A country that nets its credit notes into the box they came from
   * lands on +1 twice; one that reports them positively in a box of their own
   * lands on -1 there.
   */
  correction: number;
  /** False when the box takes a share of the base rather than the whole. */
  whole: boolean;
}

/** Every base posting of a pack that names a box, from every tax it has. */
function basePostings(pack: Pack): BasePosting[] {
  const out: BasePosting[] = [];
  for (const tax of pack.taxes) {
    for (const [kind, postings] of Object.entries(tax.postings)) {
      for (const posting of postings) {
        if (posting.type !== 'base' || posting.box === null) continue;
        out.push({
          box: posting.box,
          nature: isSupply(tax) ? natureOf(tax) : null,
          correction: (kind === 'credit_note' ? -1 : 1) * Math.sign(posting.box_factor),
          whole: Math.abs(posting.box_factor) === 100,
        });
      }
    }
  }
  return out;
}

/**
 * The boxes that report the supplies of `natures` and nothing else, or null
 * when the form mixes them with something this statement does not carry.
 *
 * France is why this returns null rather than a best effort: line 05 of the
 * CA3 reports intra-Community services *and* domestic reverse charge, so the
 * services half of a French statement cannot be read off the return at all.
 * Saying so is the answer; inventing a subtraction would not be.
 */
function boxesReporting(pack: Pack, natures: string[]): Map<string, number> | null {
  const all = basePostings(pack);
  const wanted = all.filter((p) => p.nature !== null && natures.includes(p.nature));
  if (wanted.length === 0) return null;

  const boxes = new Map<string, number>();
  for (const box of new Set(wanted.map((p) => p.box))) {
    const feeding = all.filter((p) => p.box === box);
    if (feeding.some((p) => p.nature === null || !natures.includes(p.nature) || !p.whole)) {
      return null;
    }
    const corrections = new Set(feeding.map((p) => p.correction));
    if (corrections.size !== 1) return null;
    boxes.set(box, [...corrections][0] as number);
  }
  return boxes;
}

/**
 * The groups of natures a pack's own form lets this test reconcile, largest
 * first: each nature on its own where the form keeps it apart, and all of them
 * together where it does not.
 */
function reconcilableGroups(pack: Pack): { natures: string[]; boxes: Map<string, number> }[] {
  const natures = [...new Set(pack.taxes.filter(isSupply).map(natureOf))].sort();
  const groups: { natures: string[]; boxes: Map<string, number> }[] = [];
  for (const nature of natures) {
    const boxes = boxesReporting(pack, [nature]);
    if (boxes !== null) groups.push({ natures: [nature], boxes });
  }
  if (groups.length < natures.length && natures.length > 1) {
    const boxes = boxesReporting(pack, natures);
    if (boxes !== null) groups.push({ natures, boxes });
  }
  return groups;
}

// ---------------------------------------------------------------------------
// The list agrees with the declaration, pack by pack
// ---------------------------------------------------------------------------

interface ListRow {
  vat_country: string | null;
  vat_number: string | null;
  nature: string;
  amount: string;
  currency_code: string;
  documents: number;
  contact_names: string[] | null;
  issue: string | null;
}

const withSupplies = packsWhere('taxes on an intra-Community supply', (pack) =>
  pack.taxes.some(isSupply),
);

for (const pack of withSupplies) {
  if (pack.golden === null) continue;
  const golden = pack.golden;

  describe(`${pack.slug} — the statement and the declaration agree`, () => {
    let db: PGlite;
    let companyId: string;

    beforeAll(async () => {
      db = await freshDatabase();
      const fixture = await newCompany(db, {
        country: pack.manifest.country,
        name: golden.name,
        chart: golden.chart,
        language: golden.language,
        fiscalYear: golden.fiscalYear,
      });
      companyId = fixture.companyId;
      await replayScenario(db, companyId, golden);
    }, 300_000);

    afterAll(async () => {
      await db.close();
    });

    it('has a form that keeps at least one nature of supply to itself', () => {
      // A pack whose every intra-Community box is shared with something else
      // would make the comparison below vacuous, and the failure should name
      // that rather than pass silently.
      expect(reconcilableGroups(pack).length).toBeGreaterThan(0);
    });

    it('lists, period by period, exactly what the declaration reports', async () => {
      const groups = reconcilableGroups(pack);
      let exercised = 0;

      for (const period of golden.periods) {
        const listed = await rows<ListRow>(
          db,
          `select * from ec_sales_list($1, $2::date, $3::date)`,
          [companyId, period.from, period.to],
        );
        const declared = await rows<{ box: string; kind: string; amount: string }>(
          db,
          `select box, kind, amount::text from vat_return($1, $2::date, $3::date)`,
          [companyId, period.from, period.to],
        );

        for (const group of groups) {
          // Everything the statement holds for those natures, whether or not
          // it can be declared: an unreportable line is still a supply the
          // ledger made, and it is still in the box.
          const statement = listed
            .filter((row) => group.natures.includes(row.nature))
            .reduce((total, row) => total + Number(row.amount), 0);

          const returned = declared
            .filter((row) => row.kind === 'base' && group.boxes.has(row.box))
            .reduce(
              (total, row) => total + (group.boxes.get(row.box) as number) * Number(row.amount),
              0,
            );

          expect({
            period: period.code,
            natures: group.natures.join('+'),
            amount: Number(statement.toFixed(2)),
          }).toEqual({
            period: period.code,
            natures: group.natures.join('+'),
            amount: Number(returned.toFixed(2)),
          });
          if (statement !== 0) exercised += 1;
        }
      }

      // A year of books that never supplied anything to another Member State
      // would have compared zero to zero all the way through.
      expect(exercised).toBeGreaterThan(0);
    });

    it('carries both natures of supply the golden scenario books', async () => {
      const natures = new Set<string>();
      for (const period of golden.periods) {
        const listed = await rows<ListRow>(
          db,
          `select * from ec_sales_list($1, $2::date, $3::date)`,
          [companyId, period.from, period.to],
        );
        for (const row of listed) natures.add(row.nature);
      }
      // Asked of the pack, not of a country: a pack that has taxes for goods
      // and for services must exercise both, one that has a single nature is
      // asked for one.
      const offered = new Set(pack.taxes.filter(isSupply).map(natureOf));
      expect([...natures].sort()).toEqual([...offered].sort());
    });

    it('names a customer of another country on every line it can declare', async () => {
      for (const period of golden.periods) {
        const listed = await rows<ListRow>(
          db,
          `select * from ec_sales_list($1, $2::date, $3::date)`,
          [companyId, period.from, period.to],
        );
        for (const row of listed.filter((r) => r.issue === null)) {
          expect(row.vat_country).not.toBe(pack.manifest.country);
          expect(row.vat_number).toBeTruthy();
          expect(row.currency_code).toBe(
            (await one<{ code: string }>(
              db,
              `select currency_code as code from companies where id = $1`,
              [companyId],
            )).code,
          );
        }
      }
    });
  });
}

// ---------------------------------------------------------------------------
// What cannot be declared, and what the function refuses
// ---------------------------------------------------------------------------

/**
 * A pack that supplies goods to another Member State, and the tax, account and
 * year its own golden scenario uses to do it. Everything below is booked from
 * those, so nothing here names a country, a code or a rate.
 */
const supplier = packWhere('a tax on an intra-Community supply of goods', (pack) =>
  pack.golden !== null && pack.taxes.some((t) => t.treatment === 'intracom_goods'),
);

const supplyTax = supplier.taxes.find((t) => t.treatment === 'intracom_goods') as PackTax;
const supplyLine = (supplier.golden?.documents ?? [])
  .flatMap((document) => document.lines)
  .find((line) => line.tax === supplyTax.code);

describe(`${supplier.slug} — a supply that cannot be declared comes back`, () => {
  let db: PGlite;
  let companyId: string;
  let ownerId: string;
  const year = supplier.golden?.fiscalYear as { start: string; end: string };
  const on = year.start;

  async function supply(contactId: string, amount: number): Promise<void> {
    const id = await newDocument(db, companyId, {
      docType: 'sale_invoice',
      contactId,
      date: on,
      lines: [
        {
          unitPrice: amount,
          taxCode: supplyTax.code,
          accountCode: supplyLine?.account as string,
        },
      ],
    });
    await db.query(`select post_document($1)`, [id]);
  }

  async function list(): Promise<ListRow[]> {
    return rows<ListRow>(db, `select * from ec_sales_list($1, $2::date, $3::date)`, [
      companyId,
      year.start,
      year.end,
    ]);
  }

  beforeAll(async () => {
    db = await freshDatabase();
    ownerId = await newUser(db);
    const fixture = await newCompany(db, {
      country: supplier.manifest.country,
      ownerId,
      chart: supplier.golden?.chart ?? null,
      fiscalYear: supplier.golden?.fiscalYear,
    });
    companyId = fixture.companyId;
  }, 300_000);

  afterAll(async () => {
    await db.close();
  });

  it('says no_vat_number, with the customer and the amount, rather than dropping the line', async () => {
    const contact = await newContact(db, companyId, {
      name: 'Customer with no number',
      country: 'ZZ',
      vat: null,
    });
    await supply(contact, 1000);

    const line = (await list()).find((row) => row.issue === 'no_vat_number');
    expect(line).toBeDefined();
    expect(Number(line?.amount)).toBe(1000);
    expect(line?.contact_names).toEqual(['Customer with no number']);
    expect(line?.nature).toBe('goods');
  });

  it('says vat_country_is_the_company_country when the number is not in another State', async () => {
    const contact = await newContact(db, companyId, {
      name: 'Customer at home',
      country: supplier.manifest.country,
      vat: `${supplier.manifest.country}999999999`,
    });
    await supply(contact, 2000);

    const line = (await list()).find(
      (row) => row.issue === 'vat_country_is_the_company_country',
    );
    expect(line).toBeDefined();
    expect(line?.vat_country).toBe(supplier.manifest.country);
    expect(Number(line?.amount)).toBe(2000);
  });

  it('reads a number typed with spaces and dots as the one an administration compares', async () => {
    const contact = await newContact(db, companyId, {
      name: 'Customer who types loosely',
      country: 'ZZ',
      vat: ' zz 99.99 99 ',
    });
    await supply(contact, 3000);

    const line = (await list()).find((row) => row.vat_number === '999999');
    expect(line).toBeDefined();
    expect(line?.vat_country).toBe('ZZ');
    expect(line?.issue).toBeNull();
  });

  it('takes the country of the contact when the number was recorded without one', async () => {
    const contact = await newContact(db, companyId, {
      name: 'Customer whose number carries no prefix',
      country: 'YY',
      vat: '123456789',
    });
    await supply(contact, 4000);

    const line = (await list()).find((row) => row.vat_number === '123456789');
    expect(line?.vat_country).toBe('YY');
    expect(line?.issue).toBeNull();
  });

  it('puts two contacts sharing one VAT number on the single line the form wants', async () => {
    const site = await newContact(db, companyId, { name: 'Branch', country: 'XX', vat: 'XX4242' });
    const head = await newContact(db, companyId, {
      name: 'Head office',
      country: 'XX',
      vat: 'xx-42-42',
    });
    await supply(site, 500);
    await supply(head, 700);

    const lines = (await list()).filter((row) => row.vat_number === '4242');
    expect(lines).toHaveLength(1);
    expect(Number(lines[0]?.amount)).toBe(1200);
    expect(lines[0]?.contact_names?.sort()).toEqual(['Branch', 'Head office']);
    expect(lines[0]?.documents).toBe(2);
  });

  it('deducts a credit note from the customer it was issued to', async () => {
    const contact = await newContact(db, companyId, { name: 'Returned some', country: 'XX', vat: 'XX7777' });
    await supply(contact, 5000);
    const credit = await newDocument(db, companyId, {
      docType: 'sale_credit_note',
      contactId: contact,
      date: on,
      lines: [
        { unitPrice: 1500, taxCode: supplyTax.code, accountCode: supplyLine?.account as string },
      ],
    });
    await db.query(`select post_document($1)`, [credit]);

    const line = (await list()).find((row) => row.vat_number === '7777');
    expect(Number(line?.amount)).toBe(3500);
  });

  it('leaves out a customer whose supplies and credit notes cancel out', async () => {
    const contact = await newContact(db, companyId, { name: 'Cancelled', country: 'XX', vat: 'XX1111' });
    await supply(contact, 800);
    const credit = await newDocument(db, companyId, {
      docType: 'sale_credit_note',
      contactId: contact,
      date: on,
      lines: [
        { unitPrice: 800, taxCode: supplyTax.code, accountCode: supplyLine?.account as string },
      ],
    });
    await db.query(`select post_document($1)`, [credit]);

    expect((await list()).find((row) => row.vat_number === '1111')).toBeUndefined();
  });

  it('refuses a company it does not know, by name', async () => {
    const message = await expectError(
      db,
      `select * from ec_sales_list('00000000-0000-0000-0000-0000000000ff', $1::date, $2::date)`,
      [year.start, year.end],
    );
    expect(message).toContain('unknown_company');
  });

  it('answers a member of the company and refuses a stranger the company itself', async () => {
    const mine = await asUser(db, ownerId, () =>
      rows<ListRow>(db, `select * from ec_sales_list($1, $2::date, $3::date)`, [
        companyId,
        year.start,
        year.end,
      ]),
    );
    expect(mine.length).toBeGreaterThan(0);

    // A stranger does not get an empty statement, which would read as "this
    // company supplied nothing". Row level security hides the company row, so
    // the function cannot find the company it was asked about and says so —
    // the same answer `vat_return()` gives, for the same reason.
    const stranger = await newUser(db);
    const message = await asUser(db, stranger, () =>
      expectError(db, `select * from ec_sales_list($1, $2::date, $3::date)`, [
        companyId,
        year.start,
        year.end,
      ]),
    );
    expect(message).toContain('unknown_company');
  });
});

// ---------------------------------------------------------------------------
// What the function is not
// ---------------------------------------------------------------------------

describe('the statement has a cadence of its own', () => {
  /**
   * `vat_return()` refuses a period the company does not file on. This one
   * must not: in three of the four countries read while writing it, the
   * statement and the return are filed on different cadences, and only one of
   * them is recorded anywhere.
   */
  const filing = packWhere(
    'a form filed on more than one cadence',
    (pack) => pack.golden !== null && pack.taxes.some(isSupply),
  );

  it('answers a month to a company that files its return by quarter', async () => {
    const db = await freshDatabase();
    try {
      const golden = filing.golden as NonNullable<Pack['golden']>;
      const { companyId } = await newCompany(db, {
        country: filing.manifest.country,
        chart: golden.chart,
        language: golden.language,
        fiscalYear: golden.fiscalYear,
      });
      await db.query(`update companies set vat_period = 'quarter' where id = $1`, [companyId]);
      await replayScenario(db, companyId, golden);

      const start = golden.fiscalYear.start;
      const month = `${start.slice(0, 8)}01`;
      const end = new Date(Date.UTC(Number(start.slice(0, 4)), Number(start.slice(5, 7)), 0))
        .toISOString()
        .slice(0, 10);

      // The return refuses it; the statement does not.
      const refused = await expectError(
        db,
        `select * from vat_return($1, $2::date, $3::date)`,
        [companyId, month, end],
      );
      expect(refused).toContain('wrong_declaration_period');

      await expect(
        rows(db, `select * from ec_sales_list($1, $2::date, $3::date)`, [companyId, month, end]),
      ).resolves.toBeInstanceOf(Array);
    } finally {
      await db.close();
    }
  }, 300_000);
});

describe('every pack is read by this file', () => {
  it('has at least one pack with an intra-Community supply, and says so if not', () => {
    expect(withSupplies.length).toBeGreaterThan(0);
    expect(withSupplies.length).toBeLessThanOrEqual(allPacks.length);
  });
});
