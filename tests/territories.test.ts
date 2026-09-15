import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectError, freshDatabase, one, rows } from './helpers/db.js';
import { newCompany } from './helpers/factory.js';
import { allPacks } from './helpers/packs.js';

/**
 * `territories` — where the core keeps what it used to guess.
 *
 * Two questions were asked of every line of a recapitulative statement and had
 * no answer anywhere in this repository: whether the customer's country is
 * inside the common system of VAT, and which two letters their VAT
 * identification numbers carry. `docs/international.md` recorded both, and the
 * answer to both is this table.
 *
 * What is proved here is the table and the three functions that read it, and
 * not the countries: almost nothing below names one. Where a row is named it
 * is because the row *is* the claim — that Greece identifies under a prefix
 * that is not its ISO code is a fact about Greece and about nothing else — and
 * the line says so.
 *
 * Four groups:
 *
 *   1. the rows are there, and they are there without a seed file;
 *   2. they are internally consistent — a parent that exists, a window that is
 *      ordered, a source on every one of them;
 *   3. the functions answer the questions they were written for, including at
 *      a date that is not today;
 *   4. the table is reference data with the rights of reference data.
 */

interface Row {
  code: string;
  code_source: string;
  name: string;
  parent_code: string | null;
  eu_vat_scope: string;
  eu_vat_from: string | null;
  eu_vat_to: string | null;
  vat_prefix: string | null;
  legal_reference: string;
}

describe('the territories of the common system of VAT', () => {
  let db: PGlite;
  let all: Row[];

  beforeAll(async () => {
    db = await freshDatabase({ modules: false });
    all = await rows<Row>(db, `select * from territories order by code`);
  }, 300_000);

  afterAll(async () => {
    await db.close();
  });

  // -------------------------------------------------------------------------
  // 1. They are there
  // -------------------------------------------------------------------------

  it('is filled by the seed the release ships, beside the currencies', () => {
    expect(all.length).toBeGreaterThan(40);
  });

  it('carries every country the packs of this repository book in, and says which are in the Union', async () => {
    // Read from the packs rather than counted: a pack whose country this table
    // did not carry would produce a statement in which every one of its own
    // customers was outside the Union.
    //
    // Being *in* the table is what every pack needs. Being a Member State is
    // what only a pack that makes intra-Community supplies needs, and the two
    // were the same assertion until the first pack of a country outside the
    // Union arrived — one that is in the table, with the day it left. So the
    // membership is asked of the pack's own taxes: a pack whose treatments are
    // intra-Community has to be inside the system, and one whose treatments
    // are not has to be outside it.
    for (const pack of allPacks) {
      const row = await one<{ known: boolean; member: boolean }>(
        db,
        `select exists (select 1 from territories where code = $1) as known,
                is_eu_member($1) as member`,
        [pack.manifest.country],
      );
      expect(row.known, `${pack.slug} is not in territories`).toBe(true);

      const intracom = pack.taxes.some((tax) => tax.treatment.startsWith('intracom_'));
      expect(
        row.member,
        `${pack.slug} ${intracom ? 'carries intra-Community taxes and is outside the common system' : 'carries none and is inside it'}`,
      ).toBe(intracom);
    }
  });

  it('holds the whole Union and no more States than it has', () => {
    const states = all.filter(
      (row) => row.parent_code === null && row.eu_vat_scope === 'full' && row.eu_vat_to === null,
    );
    // Twenty-seven, and a number rather than a list: the claim is the size of
    // the Union on the day this was written, and a twenty-eighth accession is
    // one row and one line here.
    expect(states).toHaveLength(27);
  });

  // -------------------------------------------------------------------------
  // 2. The rows hold together
  // -------------------------------------------------------------------------

  it('gives every territory a parent that exists, and none its own', () => {
    const codes = new Set(all.map((row) => row.code));
    for (const row of all.filter((r) => r.parent_code !== null)) {
      expect(codes.has(row.parent_code as string), row.code).toBe(true);
      expect(row.parent_code).not.toBe(row.code);
    }
  });

  it('gives every row a source somebody can go and read', () => {
    for (const row of all) {
      expect(row.legal_reference, row.code).toMatch(/\S/);
      expect(row.legal_reference.length, row.code).toBeGreaterThan(10);
    }
  });

  it('opens a window wherever the system applied, and none where it did not', () => {
    for (const row of all) {
      if (row.eu_vat_scope === 'none') {
        expect(row.eu_vat_from, row.code).toBeNull();
        expect(row.eu_vat_to, row.code).toBeNull();
      } else {
        expect(row.eu_vat_from, row.code).not.toBeNull();
        if (row.eu_vat_to !== null) {
          expect(row.eu_vat_to >= (row.eu_vat_from as string), row.code).toBe(true);
        }
      }
    }
  });

  it('records a prefix only where it differs from the code', () => {
    // The column holds a difference and never a copy, which is what lets
    // `vat_prefix_of()` fall back to the code without asking twice.
    for (const row of all.filter((r) => r.vat_prefix !== null)) {
      expect(row.vat_prefix, row.code).not.toBe(row.code);
    }
  });

  it('says which register each code comes from', async () => {
    const sources = await rows<{ code_source: string }>(
      db,
      `select distinct code_source::text from territories order by 1`,
    );
    expect(sources.length).toBeGreaterThan(1);
    for (const row of all) {
      // A two-letter code claims to be ISO 3166-1 or the Union's own; anything
      // longer claims ISO 3166-2 or nothing at all. A row that got that the
      // wrong way round is a row a reader cannot look up.
      const short = /^[A-Z]{2}$/.test(row.code);
      expect(['iso_3166_1', 'eu'].includes(row.code_source), row.code).toBe(short);
    }
  });

  it('refuses a row whose window ends before it begins', async () => {
    await expect(
      db.query(
        `insert into territories (code, code_source, name, eu_vat_scope, eu_vat_from, eu_vat_to, legal_reference)
         values ('QQ', 'named', 'Backwards', 'full', date '2020-01-01', date '2010-01-01', 'none, this is a test')`,
      ),
    ).rejects.toThrow(/territories_window_ordered/);
  });

  it('refuses a territory the system never reached that claims a window', async () => {
    await expect(
      db.query(
        `insert into territories (code, code_source, name, eu_vat_scope, eu_vat_from, legal_reference)
         values ('QQ', 'named', 'Contradiction', 'none', date '2020-01-01', 'none, this is a test')`,
      ),
    ).rejects.toThrow(/territories_scope_matches_window/);
  });

  // -------------------------------------------------------------------------
  // 3. The three functions
  // -------------------------------------------------------------------------

  it('resolves a code, a prefix, and neither', async () => {
    const under = all.find((row) => row.vat_prefix !== null) as Row;
    const byCode = await one<{ code: string }>(
      db,
      `select code from territory_of($1) where code is not null`,
      [under.code],
    );
    const byPrefix = await one<{ code: string }>(
      db,
      `select code from territory_of($1) where code is not null`,
      [under.vat_prefix],
    );
    expect(byCode.code).toBe(under.code);
    expect(byPrefix.code).toBe(under.code);

    // Lower case too: a VAT number is typed by a person.
    const loose = await one<{ code: string }>(
      db,
      `select code from territory_of($1) where code is not null`,
      [` ${under.code.toLowerCase()} `],
    );
    expect(loose.code).toBe(under.code);

    expect(
      await rows(db, `select code from territory_of('QQ') where code is not null`),
    ).toHaveLength(0);
  });

  it('lets a code win over a prefix another territory borrows', async () => {
    // Monaco identifies under France's prefix, so two rows answer to `FR` and
    // exactly one of them may be the answer. Asked of the data: the territory
    // whose code some other territory uses as its prefix.
    const borrowed = all.find((row) =>
      all.some((other) => other.code !== row.code && other.vat_prefix === row.code),
    );
    expect(borrowed, 'no territory borrows another one code as its prefix').toBeDefined();
    const answer = await one<{ code: string }>(
      db,
      `select code from territory_of($1) where code is not null`,
      [(borrowed as Row).code],
    );
    expect(answer.code).toBe((borrowed as Row).code);
  });

  it('answers the prefix a territory identifies under, and the code where there is none', async () => {
    const under = all.find((row) => row.vat_prefix !== null) as Row;
    const plain = all.find(
      (row) => row.vat_prefix === null && /^[A-Z]{2}$/.test(row.code),
    ) as Row;
    const answers = await one<{ a: string; b: string; c: string | null; d: string | null }>(
      db,
      `select vat_prefix_of($1) as a, vat_prefix_of($2) as b,
              vat_prefix_of($3) as c, vat_prefix_of('QQ') as d`,
      [under.code, plain.code, all.find((r) => !/^[A-Z]{2}$/.test(r.code))?.code],
    );
    expect(answers.a).toBe(under.vat_prefix);
    expect(answers.b).toBe(plain.code);
    // A subdivision issues no VAT number of its own.
    expect(answers.c).toBeNull();
    // A territory this table does not carry keeps its own two letters, so a
    // third country is still readable on a statement that then refuses it.
    expect(answers.d).toBe('QQ');
  });

  it('answers membership as at a date, and not as at today', async () => {
    const left = all.find((row) => row.eu_vat_to !== null) as Row;
    expect(left, 'no territory has left the common system').toBeDefined();
    const day = left.eu_vat_to as string;
    const answers = await one<{ during: boolean; last: boolean; after: boolean; before: boolean }>(
      db,
      `select is_eu_member($1, ($2::date - interval '1 year')::date) as during,
              is_eu_member($1, $2::date)                             as last,
              is_eu_member($1, ($2::date + interval '1 day')::date)  as after,
              is_eu_member($1, ($3::date - interval '1 day')::date)  as before`,
      [left.code, day, left.eu_vat_from],
    );
    expect(answers).toEqual({ during: true, last: true, after: false, before: false });
  });

  it('answers none for a territory it does not carry', async () => {
    const answer = await one<{ scope: string; member: boolean }>(
      db,
      `select eu_vat_scope_of('QQ')::text as scope, is_eu_member('QQ') as member`,
    );
    expect(answer).toEqual({ scope: 'none', member: false });
  });

  it('holds one territory inside the system for goods and outside it for services', async () => {
    const partly = all.filter((row) => row.eu_vat_scope === 'goods');
    expect(partly).toHaveLength(1);
    const it_ = partly[0] as Row;
    // It is a territory of a State, not a State: that is the whole modelling
    // decision, and a column on the parent would have said the parent was
    // partly inside the system, which is false.
    expect(it_.parent_code).not.toBeNull();
    const parent = all.find((row) => row.code === it_.parent_code) as Row;
    expect(parent.eu_vat_to).not.toBeNull();
    // And it is not a Member State, which is what `is_eu_member` has to say.
    const answer = await one<{ member: boolean; scope: string }>(
      db,
      `select is_eu_member($1) as member, eu_vat_scope_of($1)::text as scope`,
      [it_.code],
    );
    expect(answer).toEqual({ member: false, scope: 'goods' });
  });

  // -------------------------------------------------------------------------
  // The two rows that are themselves the claim
  // -------------------------------------------------------------------------

  it('says that Greece identifies under a prefix that is not its ISO code', async () => {
    // country-literal: the claim is about Greece and about nothing else. The
    // gap docs/international.md recorded was that the core could not say EL,
    // and a test that read the answer out of the same table would prove
    // nothing at all.
    const greece = await one<{ prefix: string; member: boolean }>(
      db,
      `select vat_prefix_of('GR') as prefix, is_eu_member('GR') as member`,
    );
    expect(greece).toEqual({ prefix: 'EL', member: true });
    // And the number itself resolves back to the same territory.
    const back = await one<{ code: string }>(
      db,
      `select code from territory_of('EL') where code is not null`,
    );
    expect(back.code).toBe('GR');
  });

  it('says that Northern Ireland is XI, is not the United Kingdom, and is in for goods', async () => {
    // country-literal: the Protocol on Ireland/Northern Ireland is about these
    // two territories and no others, and the point of the row is the answer it
    // gives for them.
    const answers = await one<{
      xi: string;
      gb_then: boolean;
      gb_now: boolean;
      xi_member: boolean;
    }>(
      db,
      `select eu_vat_scope_of('XI', date '2026-01-01')::text as xi,
              is_eu_member('GB', date '2019-06-01')          as gb_then,
              is_eu_member('GB', date '2021-06-01')          as gb_now,
              is_eu_member('XI', date '2026-01-01')          as xi_member`,
    );
    expect(answers).toEqual({ xi: 'goods', gb_then: true, gb_now: false, xi_member: false });
  });

  it('dates the United Kingdom from the end of the transition and says why on the row', async () => {
    // country-literal: which of the two withdrawal dates this table keeps is a
    // decision about one State, and it is the decision the rest of the schema
    // depends on.
    const uk = await one<{ eu_vat_to: string; legal_reference: string }>(
      db,
      `select eu_vat_to::text, legal_reference from territories where code = 'GB'`,
    );
    expect(uk.eu_vat_to).toBe('2020-12-31');
    // The other date is not lost: it is on the row, because a reader who knows
    // the United Kingdom left on 31 January 2020 has to be told why this column
    // says something else.
    expect(uk.legal_reference).toContain('31 January 2020');
  });

  // -------------------------------------------------------------------------
  // 4. The rights of reference data
  // -------------------------------------------------------------------------

  it('is read by anyone signed in and written by nobody', async () => {
    const policies = await rows<{ policyname: string; cmd: string }>(
      db,
      `select policyname, cmd from pg_policies where tablename = 'territories'`,
    );
    expect(policies.map((p) => p.cmd)).toEqual(['SELECT']);

    const secured = await one<{ enabled: boolean }>(
      db,
      `select c.relrowsecurity as enabled from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = 'territories'`,
    );
    expect(secured.enabled).toBe(true);
  });

  it('grants select to a session and nothing at all to anon', async () => {
    const grants = await one<{
      auth_select: boolean;
      auth_insert: boolean;
      service_select: boolean;
      anon_select: boolean;
    }>(
      db,
      `select has_table_privilege('authenticated', 'territories', 'select') as auth_select,
              has_table_privilege('authenticated', 'territories', 'insert') as auth_insert,
              has_table_privilege('service_role',  'territories', 'select') as service_select,
              has_table_privilege('anon',          'territories', 'select') as anon_select`,
    );
    expect(grants).toEqual({
      auth_select: true,
      auth_insert: false,
      service_select: true,
      anon_select: false,
    });
  });

  it('keeps its readers out of the reach of anon', async () => {
    const open = await rows<{ name: string }>(
      db,
      `select p.proname as name
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('territory_of', 'eu_vat_scope_of', 'is_eu_member', 'vat_prefix_of')
          and has_function_privilege('anon', p.oid, 'execute')`,
    );
    expect(open).toEqual([]);

    const reachable = await rows<{ name: string }>(
      db,
      `select p.proname as name
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('territory_of', 'eu_vat_scope_of', 'is_eu_member', 'vat_prefix_of')
          and has_function_privilege('authenticated', p.oid, 'execute')
        order by p.proname`,
    );
    expect(reachable.map((r) => r.name)).toEqual([
      'eu_vat_scope_of',
      'is_eu_member',
      'territory_of',
      'vat_prefix_of',
    ]);
  });
});

// ---------------------------------------------------------------------------
// The one thing a seeded reference table has to answer for
// ---------------------------------------------------------------------------

describe('a database with the table and not the rows', () => {
  /**
   * `territories` ships as `supabase/seed/00_territories.sql`, the way the
   * currencies do, so an installation can have the shape and not the data.
   * Silently, that would produce a recapitulative statement in which every
   * customer in the world is a violation and the total is nothing — and no
   * sign anywhere that a file had not been applied. So the statement refuses
   * first, by name.
   */
  it('is refused by the statement, by name, instead of answering nothing', async () => {
    const db = await freshDatabase({ modules: false });
    try {
      const pack = allPacks[0]!;
      const { companyId } = await newCompany(db, {
        country: pack.manifest.country,
        chart: pack.golden?.chart ?? null,
      });
      await db.query(`delete from territories`);
      const message = await expectError(
        db,
        `select * from ec_sales_list($1, $2::date, $3::date)`,
        [companyId, '2026-01-01', '2026-12-31'],
      );
      expect(message).toContain('no_territories');
    } finally {
      await db.close();
    }
  }, 300_000);
});
