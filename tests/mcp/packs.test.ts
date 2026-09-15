/**
 * `describe_pack` — where a country's rules come from, through the tools.
 *
 * A pack is a transcription of a régime, and a transcription is worth what its
 * sources are worth. Until the register existed there was nothing an
 * application could show beside a rate but the rate: `get_company` reports
 * which version of a pack a company copied and says nothing about the texts it
 * was written from.
 *
 * What is tested here is what a signed-in user actually gets back — the
 * register, and the certification status that says how much anyone has read the
 * pack — and that it is visible under the policy `country_packs` carries rather
 * than to the owner of the database. The countries come from the packs of the
 * repository, never from a list written here.
 */

import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sourcesOf } from '../../packages/cli/src/index.js';
import { readTools, type Backend } from '../../packages/mcp/src/index.js';
import { freshDatabase } from '../helpers/db.js';
import { newCompany, type Fixture } from '../helpers/factory.js';
import { allPacks, somePack } from '../helpers/packs.js';
import { backendFor, list, record } from './helpers.js';

let db: PGlite;
let company: Fixture;
let member: Backend;

beforeAll(async () => {
  db = await freshDatabase();
  // A company has to exist for anyone to be a member of one, which is what the
  // policy on `country_packs` asks. Which country it keeps its books in does
  // not matter to any assertion below; it is the first pack of the checkout.
  company = await newCompany(db, { country: somePack.manifest.country, name: 'Lectrice SRL' });
  await db.query(`insert into auth.users (id, email) values ($1, $2) on conflict do nothing`, [
    company.ownerId,
    `${company.ownerId}@example.test`,
  ]);
  member = backendFor(db, company.ownerId);
}, 120_000);

afterAll(async () => {
  await db.close();
});

describe('describe_pack', () => {
  it('gives back every pack this installation holds, with its register', async () => {
    const answer = record(await readTools.describePack(member, {}));
    expect(answer['count']).toBe(allPacks.length);

    const held = list(answer['packs']);
    expect(held.map((pack) => pack['country'])).toEqual(
      allPacks.map((pack) => pack.manifest.country).sort(),
    );

    for (const row of held) {
      const pack = allPacks.find((candidate) => candidate.manifest.country === row['country'])!;
      expect(row['version'], pack.slug).toBe(pack.manifest.version);
      expect(row['certification_status'], pack.slug).toBe(pack.manifest.certification?.status);

      const register = (
        typeof row['sources'] === 'string' ? JSON.parse(row['sources']) : row['sources']
      ) as Record<string, string>[];
      expect(register.map((source) => source['key']), pack.slug).toEqual(
        sourcesOf(pack.manifest.certification).map((source) => source.key),
      );
      // Every entry is somewhere a reader can be sent, which is the whole
      // difference between the register and the list of titles it replaced.
      for (const source of register) {
        expect(source['url'], `${pack.slug} ${String(source['key'])}`).toMatch(/^https:\/\//);
        expect(source['publisher'], `${pack.slug} ${String(source['key'])}`).toBeTruthy();
        expect(source['consulted_on'], `${pack.slug} ${String(source['key'])}`).toMatch(
          /^\d{4}-\d{2}-\d{2}$/,
        );
      }
    }
  });

  it('answers for one country, and says so plainly for a country nobody seeded', async () => {
    const one = record(await readTools.describePack(member, { country: somePack.manifest.country }));
    expect(one['count']).toBe(1);
    expect(list(one['packs'])[0]!['name']).toBe(somePack.manifest.name);

    // `ZZ` is user-assigned under ISO 3166-1 and is no country's code, so it
    // names no pack of this repository and never will.
    const none = record(await readTools.describePack(member, { country: 'ZZ' }));
    expect(none['count']).toBe(0);
    expect(String(none['note'])).toMatch(/No pack is loaded for ZZ/);
  });

  it('is read under the policy of the table, not as the owner of the database', async () => {
    // Somebody signed in who is a member of nothing sees no pack at all: the
    // policy on `country_packs` is any company member or an instance
    // administrator, and reference data about an installation is not public.
    const outsiderId = '00000000-0000-4000-8000-0000000000ff';
    await db.query(`insert into auth.users (id, email) values ($1, $2) on conflict do nothing`, [
      outsiderId,
      `${outsiderId}@example.test`,
    ]);
    const outsider = backendFor(db, outsiderId);
    const answer = record(await readTools.describePack(outsider, {}));
    expect(answer['count']).toBe(0);
    expect(String(answer['note'])).toMatch(/holds no country pack/);
  });
});
