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
import { asUser, expectError, freshDatabase, one, rows } from './helpers/db.js';
import {
  expectedNumber,
  newCompany,
  newContact,
  newDocument,
  newUser,
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

describe('entries.import', () => {
  // The exception the gapless rule needed the moment it shipped: a company
  // arriving from another system carries three years of entries whose numbers
  // its VAT returns, its filings and its auditor already know.
  let importerId: string;

  beforeAll(async () => {
    importerId = await newUser(db, 'importer@numbering.test');
    await db.query(
      `insert into company_members (company_id, user_id, role) values ($1, $2, 'accountant')`,
      [companyId, importerId],
    );
  });

  async function draftWithNumber(number: string, date = '2026-08-10'): Promise<string> {
    const entry = await one<{ id: string }>(
      db,
      `insert into entries (company_id, journal_id, entry_date, number, description, state)
       values ($1, (select id from journals where company_id = $1 and code = 'MISC'),
               $2::date, $3, 'Reprise', 'draft')
       returning id`,
      [companyId, date, number],
    );
    await db.query(
      `insert into entry_lines (entry_id, company_id, account_id, sequence, name, debit, credit)
       values ($1, $2, account_id_by_code($2, '550000'), 10, 'Debit', 100, 0),
              ($1, $2, account_id_by_code($2, '704000'), 20, 'Credit', 0, 100)`,
      [entry.id, companyId],
    );
    return entry.id;
  }

  it('is in no preset, so nobody holds it by accident', async () => {
    const presets = await rows<{ role: string }>(
      db,
      `select role::text from role_capabilities where capability = 'entries.import'`,
    );
    expect(presets).toEqual([]);

    const held = await asUser(db, importerId, () =>
      rows<{ member_capabilities: string }>(db, `select member_capabilities($1)`, [companyId]),
    );
    expect(held.map((row) => row.member_capabilities)).not.toContain('entries.import');
  });

  it('refuses a number chosen by hand without it', async () => {
    const entry = await draftWithNumber('REPRISE-0001');
    const message = await asUser(db, importerId, () =>
      expectError(db, `select post_entry($1)`, [entry]),
    );
    expect(message).toMatch(/numbering_gapless/);
    expect(message).toMatch(/entries\.import/);
  });

  it('lets it through when the capability is granted, and catches the counter up', async () => {
    await db.query(
      `update company_members set capabilities_granted = array['entries.import']
        where company_id = $1 and user_id = $2`,
      [companyId, importerId],
    );

    // A number written in the country's own pattern, well ahead of the
    // counter: the series it belongs to has to be continued, not restarted.
    const ahead = await expectedNumber(db, companyId, 'MISC', '2026-08-10', 250);
    const entry = await draftWithNumber(ahead);
    const posted = await asUser(db, importerId, () =>
      one<{ number: string; state: string }>(db, `select number, state from post_entry($1)`, [entry]),
    );
    expect(posted.state).toBe('posted');
    expect(posted.number).toBe(ahead);

    const counter = await one<{ last_number: number }>(
      db,
      `select s.last_number from journal_sequences s join journals j on j.id = s.journal_id
        where j.company_id = $1 and j.code = 'MISC' and s.year = 2026`,
      [companyId],
    );
    expect(counter.last_number).toBe(250);

    // And the next automatic number continues the series rather than
    // colliding with what was imported.
    const journal = await one<{ id: string }>(
      db,
      `select id from journals where company_id = $1 and code = 'MISC'`,
      [companyId],
    );
    const next = await asUser(db, importerId, () =>
      one<{ n: string }>(db, `select next_entry_number($1, date '2026-08-11') as n`, [journal.id]),
    );
    expect(next.n).toBe(await expectedNumber(db, companyId, 'MISC', '2026-08-11', 251));
  });

  it('leaves the counter alone for a number written in another shape', async () => {
    const before = await one<{ last_number: number }>(
      db,
      `select s.last_number from journal_sequences s join journals j on j.id = s.journal_id
        where j.company_id = $1 and j.code = 'MISC' and s.year = 2026`,
      [companyId],
    );
    const entry = await draftWithNumber('ANCIEN-SYSTEME-000042');
    await asUser(db, importerId, () => one(db, `select post_entry($1)`, [entry]));
    const after = await one<{ last_number: number }>(
      db,
      `select s.last_number from journal_sequences s join journals j on j.id = s.journal_id
        where j.company_id = $1 and j.code = 'MISC' and s.year = 2026`,
      [companyId],
    );
    expect(after.last_number).toBe(before.last_number);
  });

  it('refuses a duplicate even to somebody holding it, and refuses it earlier', async () => {
    // `entries_company_number_idx` is unique on `(company_id, number)` and
    // has been since the first release — stricter than per journal, and it
    // catches a repeated number when the entry is written rather than when it
    // is posted. The capability relaxes who may choose a number, and nothing
    // about which numbers are free.
    const taken = await expectedNumber(db, companyId, 'MISC', '2026-08-10', 250);
    const message = await asUser(db, importerId, () =>
      expectError(
        db,
        `insert into entries (company_id, journal_id, entry_date, number, description, state)
         values ($1, (select id from journals where company_id = $1 and code = 'MISC'),
                 date '2026-08-12', $2, 'Doublon', 'draft')`,
        [companyId, taken],
      ),
    );
    expect(message).toMatch(/entries_company_number_idx|duplicate key/i);

    await db.query(
      `update company_members set capabilities_granted = '{}'
        where company_id = $1 and user_id = $2`,
      [companyId, importerId],
    );
  });
});
