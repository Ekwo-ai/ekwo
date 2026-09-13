/**
 * The number a country asked for, instead of the one the core built.
 *
 * Two halves. The renderer, which is a pure function of a pattern and a
 * counter and can be tested without burning either. And the engine, which has
 * to keep producing exactly what it produced the day before for the two packs
 * that ship — because both of them declare the pattern it used to hard-code,
 * and a change nobody asked for is the failure mode here.
 */

import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectError, freshDatabase, one, rows } from './helpers/db.js';
import {
  expectedNumber,
  newCompany,
  newContact,
  newDocument,
  numberFormatOf,
  numberShape,
} from './helpers/factory.js';

let db: PGlite;
let companyId: string;
let contactId: string;

beforeAll(async () => {
  db = await freshDatabase();
  ({ companyId } = await newCompany(db, { name: 'Numerotation SRL' }));
  contactId = await newContact(db, companyId, { name: 'Cliente' });
});

afterAll(async () => {
  await db.close();
});

async function render(format: string, code: string, date: string, counter: number): Promise<string> {
  const row = await one<{ number: string }>(
    db,
    `select format_number($1, $2, $3::date, $4) as number`,
    [format, code, date, counter],
  );
  return row.number;
}

describe('the renderer', () => {
  it('reads every token of the published grammar', async () => {
    expect(await render('{CODE}/{YYYY}/{NNNN}', 'SAL', '2026-06-15', 7)).toBe('SAL/2026/0007');
    expect(await render('INV-{YY}{MM}-{NNNNNN}', 'SAL', '2026-06-15', 7)).toBe('INV-2606-000007');
    expect(await render('{CODE}{NN}', 'A', '2026-01-31', 3)).toBe('A03');
  });

  it('pads to the width the pattern asks for, and never truncates to it', async () => {
    // A counter that has outgrown its padding is a longer number, not a wrong
    // one: `lpad` would have cut it to four digits and produced a duplicate.
    expect(await render('{CODE}-{NNN}', 'SAL', '2026-06-15', 12345)).toBe('SAL-12345');
  });

  it('refuses a pattern with no counter, because every document would share a number', async () => {
    const message = await expectError(db, `select format_number('{CODE}/{YYYY}', 'SAL', date '2026-06-15', 1)`);
    expect(message).toMatch(/number_format_without_counter/);
  });

  it('refuses a token nobody declared rather than printing it', async () => {
    const message = await expectError(
      db,
      `select format_number('{CODE}/{QUARTER}/{NNNN}', 'SAL', date '2026-06-15', 1)`,
    );
    expect(message).toMatch(/unknown_number_token: \{QUARTER\}/);
  });

  it('refuses an empty pattern with the name of the field to fill', async () => {
    const message = await expectError(db, `select format_number(null, 'SAL', date '2026-06-15', 1)`);
    expect(message).toMatch(/no_number_format/);
    expect(message).toMatch(/documents\.number_format/);
  });
});

describe('the engine', () => {
  it('numbers a posted entry on the pattern the pack declares', async () => {
    const doc = await newDocument(db, companyId, {
      docType: 'sale_invoice',
      number: 'FAC-NUM-001',
      contactId,
      date: '2026-06-15',
      lines: [{ unitPrice: 100, taxCode: 'BE-S-21', accountCode: '704000' }],
    });
    await db.query(`select post_document($1)`, [doc]);

    const entry = await one<{ number: string }>(
      db,
      `select e.number from entries e where e.document_id = $1`,
      [doc],
    );
    expect(entry.number).toBe(await expectedNumber(db, companyId, 'SAL', '2026-06-15', 1));
    expect(entry.number).toMatch(await numberShape(db, companyId, 'SAL', '2026-06-15'));
  });

  it('restarts the counter with the year, because the pattern carries one', async () => {
    const format = await numberFormatOf(db, companyId);
    expect(format).toMatch(/\{YY(YY)?\}/);

    await db.query(
      `insert into fiscal_years (company_id, name, start_date, end_date)
       values ($1, 'Exercice 2027', date '2027-01-01', date '2027-12-31')`,
      [companyId],
    );
    const doc = await newDocument(db, companyId, {
      docType: 'sale_invoice',
      number: 'FAC-NUM-2027',
      contactId,
      date: '2027-02-01',
      lines: [{ unitPrice: 100, taxCode: 'BE-S-21', accountCode: '704000' }],
    });
    await db.query(`select post_document($1)`, [doc]);

    const entry = await one<{ number: string }>(
      db,
      `select number from entries where document_id = $1`,
      [doc],
    );
    expect(entry.number).toBe(await expectedNumber(db, companyId, 'SAL', '2027-02-01', 1));

    const counters = await rows<{ year: number; last_number: number }>(
      db,
      `select s.year, s.last_number from journal_sequences s
         join journals j on j.id = s.journal_id
        where j.company_id = $1 and j.code = 'SAL' order by s.year`,
      [companyId],
    );
    expect(counters.map((row) => row.year)).toEqual([2026, 2027]);
  });

  it('counts on without a period when the pattern carries no year', async () => {
    // Nothing in this release declares such a pattern; the engine has to
    // answer for one anyway, and the series it keeps is under the period that
    // is not a year.
    const journal = await one<{ id: string }>(
      db,
      `select id from journals where company_id = $1 and code = 'MISC'`,
      [companyId],
    );
    await db.query(
      `update country_defaults set number_format = '{CODE}{NNNNN}'
        where country = (select fiscal_country from companies where id = $1)`,
      [companyId],
    );
    try {
      const first = await one<{ n: string }>(db, `select next_entry_number($1, date '2026-03-01') as n`, [journal.id]);
      const second = await one<{ n: string }>(db, `select next_entry_number($1, date '2027-03-01') as n`, [journal.id]);
      expect(first.n).toBe('MISC00001');
      expect(second.n).toBe('MISC00002');

      const period = await rows<{ year: number }>(
        db,
        `select s.year from journal_sequences s join journals j on j.id = s.journal_id
          where j.id = $1`,
        [journal.id],
      );
      expect(period.map((row) => row.year)).toEqual([0]);
    } finally {
      await db.query(
        `update country_defaults set number_format = '{CODE}/{YYYY}/{NNNN}'
          where country = (select fiscal_country from companies where id = $1)`,
        [companyId],
      );
    }
  });

  it('refuses to number at all where the pack declares no format', async () => {
    const silent = await newCompany(db, { name: 'Sans modele SRL' });
    await db.query(
      `update country_defaults set number_format = null
        where country = (select fiscal_country from companies where id = $1)`,
      [silent.companyId],
    );
    try {
      const journal = await one<{ id: string }>(
        db,
        `select id from journals where company_id = $1 and code = 'SAL'`,
        [silent.companyId],
      );
      const message = await expectError(db, `select next_entry_number($1, date '2026-06-15')`, [
        journal.id,
      ]);
      expect(message).toMatch(/no_number_format/);
      expect(message).toMatch(/documents\.number_format/);
    } finally {
      await db.query(
        `update country_defaults set number_format = '{CODE}/{YYYY}/{NNNN}'
          where country = (select fiscal_country from companies where id = $1)`,
        [silent.companyId],
      );
    }
  });
});

describe('numbering_gapless', () => {
  it('refuses a number chosen by hand where the law forbids a hole', async () => {
    const gapless = await one<{ numbering_gapless: boolean }>(
      db,
      `select numbering_gapless from numbering_rules($1)`,
      [companyId],
    );
    expect(gapless.numbering_gapless).toBe(true);

    const entry = await one<{ id: string }>(
      db,
      `insert into entries (company_id, journal_id, entry_date, number, description, state)
       values ($1, (select id from journals where company_id = $1 and code = 'MISC'),
               date '2026-06-20', 'A LA MAIN 42', 'Numero choisi', 'draft')
       returning id`,
      [companyId],
    );
    await db.query(
      `insert into entry_lines (entry_id, company_id, account_id, sequence, name, debit, credit)
       values ($1, $2, account_id_by_code($2, '550000'), 10, 'Debit', 100, 0),
              ($1, $2, account_id_by_code($2, '704000'), 20, 'Credit', 0, 100)`,
      [entry.id, companyId],
    );

    const message = await expectError(db, `select post_entry($1)`, [entry.id]);
    expect(message).toMatch(/numbering_gapless/);

    // And where the country says nothing about holes, the same entry posts.
    await db.query(
      `update country_defaults set numbering_gapless = false
        where country = (select fiscal_country from companies where id = $1)`,
      [companyId],
    );
    try {
      const posted = await one<{ number: string; state: string }>(db, `select number, state from post_entry($1)`, [
        entry.id,
      ]);
      expect(posted.state).toBe('posted');
      expect(posted.number).toBe('A LA MAIN 42');
    } finally {
      await db.query(
        `update country_defaults set numbering_gapless = true
          where country = (select fiscal_country from companies where id = $1)`,
        [companyId],
      );
    }
  });
});
