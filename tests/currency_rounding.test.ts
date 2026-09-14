import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { roundCurrency } from '../packages/mcp/src/rounding.js';
import { asUser, expectError, freshDatabase, one, rows } from './helpers/db.js';
import { installFixturePack } from './helpers/fixture-pack.js';
import { accountId, ledgerOf, newContact, newDocument, newUser } from './helpers/factory.js';
import { ROUNDING_VECTOR } from './helpers/rounding-vector.js';

/**
 * Rounding reads the currency and the country, in one place.
 *
 * Before this, every amount in the schema was `round(x, 2)` — fifty-one times,
 * in eighteen functions, a view and a generated column — while
 * `currencies.decimal_places` and `country_defaults.rounding_method` sat filled
 * by every pack and read by nobody. Two decimals is right for the euro and
 * wrong for the yen, which has none, and for the dinar, which has three; and
 * "half up" was never decided anywhere, it was what `round()` happens to do.
 *
 * Four things are proved here.
 *
 *   1. The arithmetic is right for all four methods a pack may declare, and
 *      the answer it gives is the answer the three TypeScript copies give, on
 *      the same vector.
 *   2. The lookup reads the two columns and refuses, by name, everything it
 *      cannot answer. It invents no currency and no country.
 *   3. A whole ledger works in a currency with no decimals: a document, its
 *      entry, a payment, the matching, the declaration and the balance, all of
 *      them to the unit of that currency and never to a hundredth of it.
 *   4. Nothing in the live schema rounds to two decimals on its own any more.
 */

/** ISO 4217 assigns nothing beginning with Z, so these shadow no real money. */
const ZERO_DECIMAL = { country: 'ZY', currency: 'ZYA', currencyName: 'Zeroland unit', decimals: 0 };
const THREE_DECIMAL = { country: 'ZX', currency: 'ZXB', currencyName: 'Threeland unit', decimals: 3 };

let db: PGlite;
let zeroCompany: string;
let zeroOwner: string;

beforeAll(async () => {
  db = await freshDatabase();
  await installFixturePack(db, ZERO_DECIMAL);
  await installFixturePack(db, THREE_DECIMAL);

  zeroOwner = await newUser(db, 'zeroland@example.test');
  const company = await one<{ id: string }>(
    db,
    `insert into companies (name, country, fiscal_country, currency_code, language)
     select 'Zeroland SRL', $1, $1, d.currency_code, d.language_default
       from country_defaults d where d.country = $1
     returning id`,
    [ZERO_DECIMAL.country],
  );
  zeroCompany = company.id;
  await db.query(
    `insert into company_members (company_id, user_id, role) values ($1, $2, 'owner')`,
    [zeroCompany, zeroOwner],
  );
  await db.query(`select install_country_template($1, $2)`, [zeroCompany, ZERO_DECIMAL.country]);
  await db.query(
    `insert into fiscal_years (company_id, name, start_date, end_date)
     values ($1, 'Exercice 2026', date '2026-01-01', date '2026-12-31')`,
    [zeroCompany],
  );
}, 180_000);

afterAll(async () => {
  await db.close();
});

/** `round_amount(amount, (decimals, method))`, as text so nothing is a float. */
async function roundAmount(value: string, decimals: number, method = 'half_up'): Promise<string> {
  const row = await one<{ r: string }>(
    db,
    `select round_amount($1::numeric, row($2, $3)::money_rounding)::text as r`,
    [value, decimals, method],
  );
  return row.r;
}

describe('the arithmetic', () => {
  it('rounds half away from zero, at the decimals it is given', async () => {
    for (const { text, decimals, expectedText } of ROUNDING_VECTOR) {
      expect(await roundAmount(text, decimals), `${text} at ${decimals}`).toBe(expectedText);
    }
  });

  it('is symmetric, so a credit note is its invoice with the sign flipped', async () => {
    for (const { text, decimals } of ROUNDING_VECTOR) {
      const positive = await roundAmount(text.replace('-', ''), decimals);
      const negative = await roundAmount(`-${text.replace('-', '')}`, decimals);
      expect(negative, `${text} at ${decimals}`).toBe(
        Number(positive) === 0 ? positive : `-${positive}`,
      );
    }
  });

  it('answers the other three methods a pack may declare', async () => {
    // Half to the even neighbour, which is what a country asking for banker's
    // rounding means.
    expect(await roundAmount('1.005', 2, 'half_even')).toBe('1.00');
    expect(await roundAmount('1.015', 2, 'half_even')).toBe('1.02');
    expect(await roundAmount('-1.005', 2, 'half_even')).toBe('-1.00');
    expect(await roundAmount('2.5', 0, 'half_even')).toBe('2');
    expect(await roundAmount('3.5', 0, 'half_even')).toBe('4');
    // Towards zero, and away from it. Both on the absolute value, so a credit
    // note still mirrors its invoice.
    expect(await roundAmount('1.999', 2, 'down')).toBe('1.99');
    expect(await roundAmount('-1.999', 2, 'down')).toBe('-1.99');
    expect(await roundAmount('1.001', 2, 'up')).toBe('1.01');
    expect(await roundAmount('-1.001', 2, 'up')).toBe('-1.01');
    expect(await roundAmount('1.990', 2, 'up')).toBe('1.99');
  });

  it('refuses by name a pair that does not say how to round', async () => {
    expect(
      await expectError(db, `select round_amount(1.5, row(null, 'half_up')::money_rounding)`),
    ).toMatch(/no_rounding_scale/);
    expect(
      await expectError(db, `select round_amount(1.5, row(2, null)::money_rounding)`),
    ).toMatch(/no_rounding_method/);
  });

  it('gives the currency its own unit and its own written form', async () => {
    const row = await one<{ unit0: string; unit2: string; unit3: string; mask0: string; mask2: string }>(
      db,
      `select currency_unit(row(0, 'half_up')::money_rounding)::text     as unit0,
              currency_unit(row(2, 'half_up')::money_rounding)::text     as unit2,
              currency_unit(row(3, 'half_up')::money_rounding)::text     as unit3,
              amount_text_format(row(0, 'half_up')::money_rounding)      as mask0,
              amount_text_format(row(2, 'half_up')::money_rounding)      as mask2`,
    );
    expect(row).toEqual({
      unit0: '1',
      unit2: '0.01',
      unit3: '0.001',
      mask0: 'FM9999999999999990',
      mask2: 'FM9999999999999990.00',
    });
  });
});

describe('SQL and TypeScript', () => {
  it('give the same answer to the same decimal, which is the whole point', async () => {
    // A format brick may not import the core, so the rule lives in four
    // places: three copies of `rounding.ts` and `round_amount`. The copies are
    // checked against each other in `rounding.test.ts`; this is the fourth.
    for (const { text, value, decimals } of ROUNDING_VECTOR) {
      const sql = await roundAmount(text, decimals);
      expect(Number(sql), `${text} at ${decimals}`).toBe(roundCurrency(value, decimals));
    }
  });
});

describe('the lookup', () => {
  it('takes the decimals from the currency and the method from the country pack', async () => {
    const row = await one<{ decimals: number; method: string }>(
      db,
      `select (rounding_of($1)).decimals, (rounding_of($1)).method::text as method`,
      [zeroCompany],
    );
    expect(row).toEqual({ decimals: 0, method: 'half_up' });
  });

  it('answers for a currency that is not the company’s, which is what a foreign document is', async () => {
    const row = await one<{ decimals: number }>(
      db,
      `select (rounding_of($1, $2)).decimals`,
      [zeroCompany, THREE_DECIMAL.currency],
    );
    expect(row.decimals).toBe(3);
  });

  it('refuses a currency, a company and a country it does not know, each by name', async () => {
    expect(await expectError(db, `select rounding_of($1, 'ZZZ')`, [zeroCompany])).toMatch(
      /unknown_currency: ZZZ/,
    );
    expect(
      await expectError(db, `select rounding_of('00000000-0000-0000-0000-000000000000')`),
    ).toMatch(/unknown_company/);

    // A company whose country this installation carries no model for. It gets
    // an error and not somebody else's rounding method.
    await db.exec('begin');
    await db.query(
      `insert into currencies (code, name, decimal_places) values ('ZZQ', 'Nowhere unit', 2)
       on conflict (code) do nothing`,
    );
    const orphan = await one<{ id: string }>(
      db,
      `insert into companies (name, country, fiscal_country, currency_code, language)
       values ('Sans modèle SRL', 'QQ', 'QQ', 'ZZQ', 'en') returning id`,
    );
    expect(await expectError(db, `select rounding_of($1)`, [orphan.id])).toMatch(
      /no_country_model: .* QQ/,
    );
    await db.exec('rollback');
  });

  it('is the only reader of the two columns, and round_amount the only namer of a method', async () => {
    const readers = await rows<{ proname: string }>(
      db,
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public', 'assets', 'budgets')
          and p.prosrc ~ 'decimal_places|\\.rounding_method' order by 1`,
    );
    expect(readers.map((r) => r.proname)).toEqual(['rounding_of']);
  });
});

describe('a whole ledger in a currency with no decimals', () => {
  let documentId: string;

  it('rounds a document line, its tax and its total to the unit', async () => {
    const customer = await newContact(db, zeroCompany, { name: 'Cliente', country: ZERO_DECIMAL.country });
    documentId = await newDocument(db, zeroCompany, {
      docType: 'sale_invoice',
      number: 'SAL-ZY-0001',
      contactId: customer,
      date: '2026-06-15',
      // 1234.5 is the half a two-decimal engine would have kept as 1234.50.
      lines: [{ name: 'Prestation', unitPrice: 1234.5, taxCode: `${ZERO_DECIMAL.country}-S-21`, accountCode: '700000' }],
    });

    const line = await one<{ amount_untaxed: string }>(
      db,
      `select amount_untaxed from document_lines where document_id = $1`,
      [documentId],
    );
    expect(line.amount_untaxed).toBe('1235.00');

    const document = await one<{ untaxed: string; tax: string; total: string; currency_code: string }>(
      db,
      `select amount_untaxed as untaxed, amount_tax as tax, amount_total as total, currency_code
         from documents where id = $1`,
      [documentId],
    );
    // 1235 at 21 % is 259.35, which in this currency is 259.
    expect(document).toEqual({
      untaxed: '1235.00',
      tax: '259.00',
      total: '1494.00',
      currency_code: ZERO_DECIMAL.currency,
    });
  });

  it('books an entry whose every line is a whole unit, and balances', async () => {
    await db.query(`select post_document($1)`, [documentId]);
    expect(await ledgerOf(db, documentId)).toEqual([
      { code: '700000', debit: '0.00', credit: '1235.00', box: '03', box_amount: '1235.00', tax_line: false },
      { code: '451000', debit: '0.00', credit: '259.00', box: '54', box_amount: '259.00', tax_line: true },
      { code: '400000', debit: '1494.00', credit: '0.00', box: null, box_amount: null, tax_line: false },
    ]);
  });

  it('settles it to the unit, matches it, and leaves nothing open', async () => {
    const bank = await one<{ id: string }>(
      db,
      `select id from journals where company_id = $1 and journal_type = 'bank' limit 1`,
      [zeroCompany],
    );
    const customer = await one<{ id: string }>(
      db,
      `select contact_id from documents where id = $1`,
      [documentId],
    );
    const payment = await one<{ id: string }>(
      db,
      `insert into payments (company_id, direction, payment_date, amount, journal_id, contact_id,
                             bank_account_id)
       values ($1, 'inbound', date '2026-06-30', 1494, $2, $3,
               (select id from bank_accounts where company_id = $1 limit 1))
       returning id`,
      [zeroCompany, bank.id, (customer as unknown as { contact_id: string }).contact_id],
    );
    await db.query(`select post_payment($1)`, [payment.id]);

    const receivable = await accountId(db, zeroCompany, '400000');
    const open = await rows<{ id: string }>(
      db,
      `select l.id from entry_lines l
        where l.company_id = $1 and l.account_id = $2
        order by l.debit desc`,
      [zeroCompany, receivable],
    );
    expect(open).toHaveLength(2);
    await db.query(`select reconcile($1, $2)`, [open[0]!.id, open[1]!.id]);

    const document = await one<{ amount_paid: string; amount_residual: string; payment_state: string }>(
      db,
      `select amount_paid, amount_residual, payment_state::text from documents where id = $1`,
      [documentId],
    );
    expect(document).toEqual({
      amount_paid: '1494.00',
      amount_residual: '0.00',
      payment_state: 'paid',
    });

    const ageing = await rows(
      db,
      `select * from aged_balance($1, date '2026-12-31', 'receivable')`,
      [zeroCompany],
    );
    expect(ageing).toEqual([]);
  });

  it('declares whole units, and a trial balance of whole units', async () => {
    const boxes = await rows<{ box: string; amount: string }>(
      db,
      `select box, amount::text from vat_return($1, date '2026-01-01', date '2026-12-31')
        where kind <> 'total' order by box`,
      [zeroCompany],
    );
    expect(boxes).toEqual([
      { box: '03', amount: '1235' },
      { box: '54', amount: '259' },
    ]);

    // Nothing anywhere carries a hundredth of a unit this currency has no name
    // for. `numeric` prints the scale it holds, so a fraction would show.
    const fractions = await rows<{ code: string; balance: string }>(
      db,
      `select account_code as code, closing_balance::text as balance
         from trial_balance($1, date '2026-01-01', date '2026-12-31')
        where closing_balance <> trunc(closing_balance)
           or debit <> trunc(debit) or credit <> trunc(credit)
        order by 1`,
      [zeroCompany],
    );
    expect(fractions).toEqual([]);
  });

  it('closes the year on a whole unit, and says so in the currency’s own shape', async () => {
    const year = await one<{ id: string }>(
      db,
      `select id from fiscal_years where company_id = $1`,
      [zeroCompany],
    );
    const result = await one<{ close: { result: string; result_kind: string } }>(
      db,
      `select close_fiscal_year($1) as close`,
      [year.id],
    );
    // The mask carries no decimals, because the currency has none.
    expect(result.close.result).toBe('1235');
    expect(result.close.result_kind).toBe('profit');
  });
});

describe('a currency with three decimals', () => {
  it('is rounded to the millime by the engine', async () => {
    expect(await roundAmount('1234.5675', 3)).toBe('1234.568');
    expect(await roundAmount('1234.5674', 3)).toBe('1234.567');
  });

  it('is what the fixture pack declares, read back through the company’s country', async () => {
    const row = await one<{ decimals: number; method: string }>(
      db,
      `select (r).decimals, (r).method::text as method
         from (select rounding_of(c.id) as r from companies c where c.id = $1) as q`,
      [zeroCompany],
    );
    expect(row.decimals).toBe(0);

    const three = await one<{ decimals: number }>(
      db,
      `select (rounding_of($1, $2)).decimals`,
      [zeroCompany, THREE_DECIMAL.currency],
    );
    expect(three.decimals).toBe(3);
  });

  it('is held at two decimals by the columns, which is the next piece of work', async () => {
    // Every monetary column of this schema is `numeric(16, 2)`, so a third
    // decimal is rounded away on the way in — by the column, silently, and not
    // by `round_amount`. The engine is right and the storage is not yet, and
    // this test is here so that the gap is visible rather than discovered.
    // Widening the columns rewrites the text of every amount the schema
    // returns, which is a migration of its own; `docs/decisions.md` names it.
    await db.exec('begin');
    await db.query(
      `create temporary table rounding_scale_probe (amount numeric(16, 2)) on commit drop`,
    );
    const stored = await one<{ amount: string }>(
      db,
      `insert into rounding_scale_probe (amount)
       values (round_amount(1.2345, row(3, 'half_up')::money_rounding)) returning amount::text`,
    );
    // 1.235 at two decimals, rounded by the column and not by the rule: the
    // third decimal the engine computed is gone.
    expect(stored.amount).toBe('1.24');
    await db.exec('rollback');
  });
});

describe('no hard-coded rounding is left in the live schema', () => {
  /** Every top-level argument of every `round(` call in a body of SQL. */
  function lastArgumentsOfRound(source: string): string[] {
    const out: string[] = [];
    const call = /(^|[^_a-zA-Z0-9.])round\s*\(/g;
    let match: RegExpExecArray | null;
    while ((match = call.exec(source)) !== null) {
      let depth = 1;
      let start = call.lastIndex;
      let last = start;
      for (let i = start; i < source.length && depth > 0; i += 1) {
        const c = source[i]!;
        if (c === '(') depth += 1;
        else if (c === ')') {
          depth -= 1;
          if (depth === 0) out.push(source.slice(last, i).trim());
        } else if (c === ',' && depth === 1) last = i + 1;
      }
    }
    return out;
  }

  it('finds a two only inside the canonical function, where the scale comes from', async () => {
    const bodies = await rows<{ schema: string; name: string; src: string }>(
      db,
      `select ns.nspname as schema, p.proname as name, p.prosrc as src
         from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
        where ns.nspname in ('public', 'assets', 'budgets')
        order by 1, 2`,
    );
    const guilty = bodies
      .filter((f) => f.name !== 'round_amount')
      .filter((f) => lastArgumentsOfRound(f.src).some((argument) => /^\d+$/.test(argument)))
      .map((f) => `${f.schema}.${f.name}`);
    expect(guilty).toEqual([]);

    // The canonical function does round to a literal — `round(v, v_decimals)`
    // is the whole of it — and never to a literal number.
    const canonical = bodies.find((f) => f.name === 'round_amount')!;
    expect(lastArgumentsOfRound(canonical.src).every((a) => !/^\d+$/.test(a))).toBe(true);
  });

  it('finds none in a view or a generated column either', async () => {
    const views = await rows<{ table_name: string; view_definition: string }>(
      db,
      `select table_name, view_definition from information_schema.views
        where table_schema = 'public'`,
    );
    const guiltyViews = views
      .filter((v) => lastArgumentsOfRound(v.view_definition).some((a) => /^\d+$/.test(a)))
      .map((v) => v.table_name);
    expect(guiltyViews).toEqual([]);

    const generated = await rows<{ table_name: string; column_name: string }>(
      db,
      `select table_name, column_name from information_schema.columns
        where table_schema = 'public' and generation_expression like '%round(%'`,
    );
    expect(generated).toEqual([]);
  });

  it('leaves the three rounding functions closed to the anonymous role', async () => {
    const open = await rows<{ proname: string }>(
      db,
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('round_amount', 'rounding_of', 'currency_unit', 'amount_text_format')
          and (has_function_privilege('anon', p.oid, 'execute')
               or p.proacl is null)
        order by 1`,
    );
    expect(open).toEqual([]);
  });

  it('lets a signed-in member round, because every posting goes through it', async () => {
    const answer = await asUser(db, zeroOwner, () =>
      one<{ r: string }>(
        db,
        `select round_amount(1.5, rounding_of($1))::text as r`,
        [zeroCompany],
      ),
    );
    expect(answer.r).toBe('2');
  });
});
