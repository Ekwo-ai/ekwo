/**
 * What a person prefers, and the one way a label is chosen.
 *
 * The two halves are tested together because they are the same design: a
 * preference that is null is not a gap to fill with a default, it is a
 * question passed to the company and then to the country pack, which is
 * exactly the chain `label_for` walks.
 */

import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, expectError, freshDatabase, one, rows } from './helpers/db.js';
import { newCompany, newUser } from './helpers/factory.js';

let db: PGlite;
let companyId: string;
let ownerId: string;
let otherId: string;

beforeAll(async () => {
  db = await freshDatabase();
  ({ companyId, ownerId } = await newCompany(db, { name: 'Preferences SRL' }));
  await db.query(`insert into auth.users (id, email) values ($1, $2) on conflict do nothing`, [
    ownerId,
    'owner@preferences.test',
  ]);
  otherId = await newUser(db, 'other@preferences.test');
  await db.query(
    `insert into company_members (company_id, user_id, role) values ($1, $2, 'accountant')`,
    [companyId, otherId],
  );
});

afterAll(async () => {
  await db.close();
});

describe('label_for', () => {
  it('takes the first language of the list that has a label', async () => {
    const answer = await one<{ label: string }>(
      db,
      `select label_for('Fournisseurs', $1::jsonb, array['de', 'nl', 'en']) as label`,
      [JSON.stringify({ nl: 'Leveranciers', en: 'Suppliers' })],
    );
    expect(answer.label).toBe('Leveranciers');
  });

  it('falls back to the row’s own name, and never to a language nobody asked for', async () => {
    const answer = await one<{ label: string }>(
      db,
      `select label_for('Fournisseurs', $1::jsonb, array['de']) as label`,
      [JSON.stringify({ nl: 'Leveranciers', en: 'Suppliers' })],
    );
    expect(answer.label).toBe('Fournisseurs');

    const empty = await one<{ label: string }>(
      db,
      `select label_for('Fournisseurs', '{}'::jsonb, null) as label`,
    );
    expect(empty.label).toBe('Fournisseurs');
  });

  it('is what the chart of accounts is copied through', async () => {
    // The company keeps its books in the pack's language, so every account
    // came out under `label_for` in that language — not in the language of
    // whoever ran the installer, and not in the pack's own if the two differ.
    const wrong = await rows<{ code: string }>(
      db,
      `select a.code
         from accounts a
         join companies c on c.id = a.company_id
        where a.company_id = $1
          and a.name is distinct from label_for(a.name, a.name_i18n, array[c.language])
        order by a.code`,
      [companyId],
    );
    expect(wrong).toEqual([]);
  });
});

describe('preferred_languages', () => {
  it('is the user, then the company, then the pack', async () => {
    const company = await one<{ language: string }>(
      db,
      `select language from companies where id = $1`,
      [companyId],
    );

    const withoutPreference = await asUser(db, ownerId, () =>
      one<{ chain: string[] }>(db, `select preferred_languages($1) as chain`, [companyId]),
    );
    // No preference yet: the company's language, then the pack's, which for a
    // company installed from its own pack are the same answer twice.
    expect(withoutPreference.chain[0]).toBe(company.language);

    await asUser(db, ownerId, () =>
      one(db, `select * from set_preferences($1::jsonb)`, [JSON.stringify({ language: 'nl' })]),
    );
    const withPreference = await asUser(db, ownerId, () =>
      one<{ chain: string[] }>(db, `select preferred_languages($1) as chain`, [companyId]),
    );
    expect(withPreference.chain[0]).toBe('nl');
    expect(withPreference.chain).toContain(company.language);
  });

  it('is the user alone when no company is named', async () => {
    const chain = await asUser(db, ownerId, () =>
      one<{ chain: string[] }>(db, `select preferred_languages() as chain`),
    );
    expect(chain.chain).toEqual(['nl']);
  });
});

describe('a preference', () => {
  it('is written key by key, and an absent key is left alone', async () => {
    await asUser(db, ownerId, async () => {
      await one(db, `select * from set_preferences($1::jsonb)`, [
        JSON.stringify({ timezone: 'Europe/Brussels', theme: 'dark' }),
      ]);
      const after = await one<{ language: string; timezone: string; theme: string }>(
        db,
        `select language, timezone, theme from set_preferences($1::jsonb)`,
        [JSON.stringify({ theme: 'light' })],
      );
      expect(after).toEqual({ language: 'nl', timezone: 'Europe/Brussels', theme: 'light' });
    });
  });

  it('is cleared by naming it null, which is not the same as leaving it out', async () => {
    const after = await asUser(db, ownerId, () =>
      one<{ theme: string | null; timezone: string }>(
        db,
        `select theme, timezone from set_preferences($1::jsonb)`,
        [JSON.stringify({ theme: null })],
      ),
    );
    expect(after.theme).toBeNull();
    expect(after.timezone).toBe('Europe/Brussels');
  });

  it('refuses a key nobody declared rather than dropping it', async () => {
    const message = await asUser(db, ownerId, () =>
      expectError(db, `select * from set_preferences($1::jsonb)`, [
        JSON.stringify({ favourite_colour: 'blue' }),
      ]),
    );
    expect(message).toMatch(/unknown_preference: favourite_colour/);
  });

  it('refuses a language that is not one', async () => {
    const message = await asUser(db, ownerId, () =>
      expectError(db, `select * from set_preferences($1::jsonb)`, [
        JSON.stringify({ language: 'Nederlands' }),
      ]),
    );
    expect(message).toMatch(/user_preferences_language_shape|violates check/i);
  });

  it('belongs to its owner and to nobody else', async () => {
    await asUser(db, otherId, () =>
      one(db, `select * from set_preferences($1::jsonb)`, [JSON.stringify({ theme: 'system' })]),
    );

    const mine = await asUser(db, ownerId, () =>
      rows<{ user_id: string }>(db, `select user_id from user_preferences`),
    );
    expect(mine.map((row) => row.user_id)).toEqual([ownerId]);

    const theirs = await asUser(db, otherId, () =>
      rows<{ user_id: string }>(db, `select user_id from user_preferences`),
    );
    expect(theirs.map((row) => row.user_id)).toEqual([otherId]);
  });

  it('is refused to nobody in particular', async () => {
    const message = await expectError(db, `select * from set_preferences('{}'::jsonb)`);
    expect(message).toMatch(/no_user/);
  });
});
