/**
 * The chart, through the tools.
 *
 * `list_accounts` used to answer with the whole chart of accounts, which on
 * the packs this release carries is between three hundred and a thousand rows
 * — a transcription of the regulation, offered to a model looking for the one
 * account a purchase invoice goes on. It now answers with the working chart
 * and says so, and the whole thing is one flag away.
 *
 * Everything runs under `set role authenticated` with real claims: the
 * function behind this is `security invoker`, so the part worth testing is
 * exactly the part a read as the owner of the database would not see.
 */

import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readTools, writeTools, type Backend } from '../../packages/mcp/src/index.js';
import { freshDatabase, one, rows } from '../helpers/db.js';
import { newCompany, newContact, newDocument, type Fixture } from '../helpers/factory.js';
import { backendFor, list, record } from './helpers.js';

let db: PGlite;
let company: Fixture;
let owner: Backend;
let stranger: Backend;
let spareCode: string;

beforeAll(async () => {
  db = await freshDatabase();
  company = await newCompany(db, { country: 'BE', name: 'Plan Comptable SRL' });
  await db.query(`insert into auth.users (id, email) values ($1, $2) on conflict do nothing`, [
    company.ownerId,
    `${company.ownerId}@example.test`,
  ]);
  owner = backendFor(db, company.ownerId);

  const other = await newCompany(db, { country: 'BE', name: 'Ailleurs SRL' });
  await db.query(`insert into auth.users (id, email) values ($1, $2) on conflict do nothing`, [
    other.ownerId,
    `${other.ownerId}@example.test`,
  ]);
  stranger = backendFor(db, other.ownerId);

  // An expense account of this chart that nothing points at. Picked from the
  // chart rather than written down: a code is a country literal.
  spareCode = (
    await one<{ code: string }>(
      db,
      `select code from accounts
        where company_id = $1 and account_type = 'expense' and not pinned and not deprecated
          and not exists (select 1 from accounts child where child.parent_id = accounts.id)
        order by code limit 1`,
      [company.companyId],
    )
  ).code;
}, 120_000);

afterAll(async () => {
  await db.close();
});

describe('list_accounts', () => {
  it('answers with the working chart by default, and says which scope it used', async () => {
    const answer = record(await readTools.listAccounts(owner, { company_id: company.companyId }));
    expect(answer['scope']).toBe('in_use');

    const accounts = list(answer['accounts']);
    const total = await one<{ n: number }>(
      db,
      `select count(*)::int as n from accounts where company_id = $1`,
      [company.companyId],
    );
    expect(accounts.length).toBeGreaterThan(5);
    expect(accounts.length).toBeLessThan(total.n / 10);

    // Nothing has been booked yet, so the working chart is exactly what the
    // installation pinned.
    const pinned = await rows<{ code: string }>(
      db,
      `select code from accounts where company_id = $1 and pinned order by code`,
      [company.companyId],
    );
    expect(accounts.map((account) => account['code'])).toEqual(pinned.map((row) => row.code));
  });

  it('returns the whole chart on include_all, and the retired accounts on include_deprecated', async () => {
    const whole = record(
      await readTools.listAccounts(owner, {
        company_id: company.companyId,
        include_all: true,
        limit: 2000,
      }),
    );
    expect(whole['scope']).toBe('whole_chart');

    const total = await one<{ n: number }>(
      db,
      `select count(*)::int as n from accounts where company_id = $1 and not deprecated`,
      [company.companyId],
    );
    expect(list(whole['accounts'])).toHaveLength(total.n);

    const withRetired = record(
      await readTools.listAccounts(owner, {
        company_id: company.companyId,
        include_deprecated: true,
        limit: 2000,
      }),
    );
    expect(withRetired['scope']).toBe('whole_chart');
  });

  it('keeps every filter it had, on the working chart as on the whole one', async () => {
    // A word taken from the chart rather than written down, for the same
    // reason a code is: a label belongs to the pack and its language.
    const word = (
      await one<{ word: string }>(
        db,
        `select split_part(name, ' ', 1) as word from accounts
          where company_id = $1 and pinned and length(split_part(name, ' ', 1)) > 4
          order by code limit 1`,
        [company.companyId],
      )
    ).word;

    const searched = record(
      await readTools.listAccounts(owner, {
        company_id: company.companyId,
        include_all: true,
        search: word,
        limit: 2000,
      }),
    );
    expect(list(searched['accounts']).length).toBeGreaterThan(0);

    const typed = record(
      await readTools.listAccounts(owner, {
        company_id: company.companyId,
        account_type: 'asset_receivable',
      }),
    );
    const rowsBack = list(typed['accounts']);
    expect(rowsBack.length).toBeGreaterThan(0);
    expect(rowsBack.every((account) => account['account_type'] === 'asset_receivable')).toBe(true);
  });

  it('takes in an account the moment something is booked on it', async () => {
    const before = list(
      record(await readTools.listAccounts(owner, { company_id: company.companyId }))['accounts'],
    );
    expect(before.some((account) => account['code'] === spareCode)).toBe(false);

    const contact = await newContact(db, company.companyId, { type: 'supplier' });
    const document = await newDocument(db, company.companyId, {
      docType: 'purchase_invoice',
      number: 'PI-MCP-1',
      contactId: contact,
      date: '2026-06-15',
      lines: [{ unitPrice: 120, accountCode: spareCode, taxCode: null }],
    });
    await db.query(`select post_document($1)`, [document]);

    const after = list(
      record(await readTools.listAccounts(owner, { company_id: company.companyId }))['accounts'],
    );
    expect(after.some((account) => account['code'] === spareCode)).toBe(true);

    // And a period that the entry falls outside of leaves it out again.
    const elsewhere = list(
      record(
        await readTools.listAccounts(owner, {
          company_id: company.companyId,
          in_use_from: '2026-09-01',
          in_use_to: '2026-09-30',
        }),
      )['accounts'],
    );
    expect(elsewhere.some((account) => account['code'] === spareCode)).toBe(false);
  });

  it('shows a stranger nothing of a company they are not a member of', async () => {
    const answer = record(
      await readTools.listAccounts(stranger, { company_id: company.companyId }),
    );
    expect(list(answer['accounts'])).toEqual([]);
  });
});

describe('pin_accounts', () => {
  it('adds an account to the working chart and takes it back out', async () => {
    const spare = (
      await one<{ code: string }>(
        db,
        `select code from accounts
          where company_id = $1 and account_type = 'expense' and not pinned and not deprecated
            and code <> $2
          order by code limit 1`,
        [company.companyId, spareCode],
      )
    ).code;

    const pinned = record(
      await writeTools.pinAccounts(owner, {
        company_id: company.companyId,
        account_codes: [spare],
      }),
    );
    expect(pinned['pinned']).toBe(true);
    expect(list(pinned['accounts'])).toHaveLength(1);

    const listed = list(
      record(await readTools.listAccounts(owner, { company_id: company.companyId }))['accounts'],
    );
    expect(listed.some((account) => account['code'] === spare)).toBe(true);

    await writeTools.pinAccounts(owner, {
      company_id: company.companyId,
      account_codes: [spare],
      pinned: false,
    });
    const again = list(
      record(await readTools.listAccounts(owner, { company_id: company.companyId }))['accounts'],
    );
    expect(again.some((account) => account['code'] === spare)).toBe(false);
  });

  it('names the code it did not find rather than pinning the rest', async () => {
    await expect(
      writeTools.pinAccounts(owner, {
        company_id: company.companyId,
        account_codes: ['no-such-code'],
      }),
    ).rejects.toThrow(/unknown_account_code/);
  });

  it('is refused to somebody who is not a member of the company', async () => {
    // Row level security hides the chart of a company you are not in, so the
    // code cannot even be resolved: the refusal names the code rather than the
    // permission, which is the same answer every other tool gives a stranger.
    await expect(
      writeTools.pinAccounts(stranger, {
        company_id: company.companyId,
        account_codes: [spareCode],
      }),
    ).rejects.toThrow(/unknown_account_code/);
  });

  it('restricts nothing: an unpinned account still takes a line', async () => {
    const unpinned = await rows<{ code: string }>(
      db,
      `select code from accounts where company_id = $1 and not pinned and account_type = 'expense'
        order by code limit 1`,
      [company.companyId],
    );
    const code = unpinned[0]?.code;
    expect(code).toBeDefined();

    const contact = await newContact(db, company.companyId, { type: 'supplier' });
    const document = await newDocument(db, company.companyId, {
      docType: 'purchase_invoice',
      number: 'PI-MCP-2',
      contactId: contact,
      date: '2026-06-16',
      lines: [{ unitPrice: 40, accountCode: String(code), taxCode: null }],
    });
    await db.query(`select post_document($1)`, [document]);
    const booked = await one<{ n: number }>(
      db,
      `select count(*)::int as n from entry_lines l join accounts a on a.id = l.account_id
        where a.company_id = $1 and a.code = $2`,
      [company.companyId, String(code)],
    );
    expect(booked.n).toBe(1);
  });
});
