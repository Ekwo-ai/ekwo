import type { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compilePack, listPacks, readPack } from '../packages/cli/src/index.js';
import { asUser, expectError, freshDatabase, one, repoRoot, rows } from './helpers/db.js';
import { newCompany, newUser } from './helpers/factory.js';

// What the pack migration added: an installation that knows which version of
// which pack it holds, a company that knows which one it copied, labels in
// more than one language, and seeds that may now correct a template instead
// of silently doing nothing.

const packs = join(repoRoot, 'packs');

/**
 * The version a pack declares, read from the pack itself. A literal here
 * would make every minor version of Belgium or France a test edit, and the
 * assertion is not "the version is 1.1.0" — it is "the database holds the
 * version the pack announces", which is what `ekwo pack upgrade` diffs on.
 */
async function versionOf(country: string): Promise<string> {
  return (await readPack(country.toLowerCase(), packs)).manifest.version;
}

let db: PGlite;

beforeAll(async () => {
  db = await freshDatabase();
}, 120_000);

afterAll(async () => {
  await db.close();
});

describe('country_packs', () => {
  it('holds one row per pack the seeds loaded, with its certification', async () => {
    const loaded = await rows<{ country: string; version: string; certification_status: string; certified_by: string | null; checksum: string }>(
      db,
      `select country, version, certification_status::text, certified_by, checksum
         from country_packs order by country`,
    );
    expect(loaded.map((p) => p.country)).toEqual(['BE', 'FR']);
    for (const pack of loaded) {
      // Both packs have moved in minor steps since they were extracted —
      // taxes, a second chart, financial statements, document rules — and
      // each of those is what the format calls a minor version. `ekwo pack
      // upgrade` diffs on this number, so a pack that grows without
      // announcing it is a pack nobody can upgrade to.
      expect(pack.version).toBe(await versionOf(pack.country));
      // `maintained`, never `ekwo`: Ekwo maintains these two packs and no
      // accountant has read them. Certified describes a review, or nothing.
      expect(pack.certification_status).toBe('maintained');
      expect(pack.certified_by).toBeNull();
      expect(pack.checksum).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('carries the checksum of the files on disk, so a changed pack is visible', async () => {
    for (const slug of await listPacks(packs)) {
      const pack = await readPack(slug, packs);
      const row = await one<{ checksum: string }>(
        db,
        'select checksum from country_packs where country = $1',
        [pack.manifest.country],
      );
      expect(row.checksum, slug).toBe(pack.checksum);
    }
  });
});

describe('a pack that used to call itself certified', () => {
  it('is maintained now, and the migration moves an installation that holds the old value', async () => {
    // The statement is the migration's own, read from it rather than retyped.
    const migration = await readFile(
      join(repoRoot, 'supabase', 'migrations', '20260912081015_pack_certification_backfill.sql'),
      'utf8',
    );
    const [backfill] = migration
      .split(';')
      .map((statement) => statement.replace(/^(\s*--[^\n]*\n)+/, '').trim())
      .filter((statement) => /^update country_packs\b/.test(statement));
    expect(backfill).toBeDefined();

    await db.exec('begin');
    await db.exec(
      `update country_packs set certification_status = 'ekwo', certified_by = 'Ekwo AI',
                                certified_at = date '2026-09-12'`,
    );
    await db.exec(`${backfill};`);
    const after = await rows<{ certification_status: string; certified_by: string | null; certified_at: string | null }>(
      db,
      'select certification_status::text, certified_by, certified_at::text from country_packs order by country',
    );
    for (const pack of after) {
      expect(pack.certification_status).toBe('maintained');
      // "Ekwo AI" in certified_by was the claim this change exists to stop
      // making; only a review names anyone.
      expect(pack.certified_by).toBeNull();
      expect(pack.certified_at).toBeNull();
    }
    await db.exec('rollback');
  });

  it('keeps the deprecated value in the type, because an enum never loses one', async () => {
    const values = await rows<{ enumlabel: string }>(
      db,
      `select e.enumlabel
         from pg_enum e join pg_type t on t.oid = e.enumtypid
        where t.typname = 'pack_certification'
        order by e.enumsortorder`,
    );
    expect(values.map((v) => v.enumlabel)).toEqual(['community', 'maintained', 'reviewed', 'ekwo']);
  });
});

describe('installing a company', () => {
  it('records the pack version it copied', async () => {
    const { companyId } = await newCompany(db, { name: 'Pack version SRL' });
    const row = await one<{ country: string; version: string; upgraded_at: string | null }>(
      db,
      'select country, version, upgraded_at from company_packs where company_id = $1',
      [companyId],
    );
    expect(row).toMatchObject({ version: await versionOf(row.country), upgraded_at: null });
  });

  it('changes nothing the second time', async () => {
    const { companyId } = await newCompany(db, { name: 'Twice SRL' });
    const before = await one(db, 'select * from company_packs where company_id = $1', [companyId]);
    await db.query('select install_country_template($1, $2)', [companyId, 'BE']);
    expect(await one(db, 'select * from company_packs where company_id = $1', [companyId])).toEqual(before);
  });

  it('falls back to 1.0.0 when the instance declares no pack — the backfill case', async () => {
    // An installation seeded before `country_packs` existed: the chart is
    // there, the manifest is not. The migration backfills 1.0.0 for the
    // companies, and the function reaches the same answer for a new one.
    await db.exec('begin');
    await db.exec(`delete from country_packs where country = 'FR'`);
    const { companyId } = await newCompany(db, { country: 'FR', name: 'Sans manifeste SARL' });
    const row = await one<{ version: string }>(
      db,
      'select version from company_packs where company_id = $1',
      [companyId],
    );
    expect(row.version).toBe('1.0.0');
    await db.exec('rollback');
  });

  it('copies the labels in the language the company keeps its books in', async () => {
    // The Belgian pack is written in French and publishes Dutch, German and
    // English, so a company that keeps its books in Dutch reads Dutch — from
    // the seed, with nothing arranged by this test.
    await db.exec('begin');
    const company = await one<{ id: string }>(
      db,
      `insert into companies (name, country, fiscal_country, currency_code, language)
       values ('Nederlandstalig BV', 'BE', 'BE', 'EUR', 'nl') returning id`,
    );
    await db.query('select install_country_template($1, $2)', [company.id, 'BE']);

    const account = await one<{ name: string; name_i18n: Record<string, string> }>(
      db,
      `select name, name_i18n from accounts where company_id = $1 and code = '400000'`,
      [company.id],
    );
    expect(account.name).toBe('Handelsdebiteuren');
    expect(account.name_i18n['en']).toBe('Customers');

    // The other languages travel with the row, so a reader who prefers German
    // is answered without going back to the template.
    expect(account.name_i18n['de']).toBe('Kunden');

    // A label the pack does not translate keeps the pack's own. Every account
    // of Belgium is translated, so the case is made rather than found.
    await db.query(`update account_templates set name_i18n = '{}'::jsonb
                     where country = 'BE' and code = '440000'`);
    const untranslated = await one<{ id: string }>(
      db,
      `insert into companies (name, country, fiscal_country, currency_code, language)
       values ('Tweede BV', 'BE', 'BE', 'EUR', 'nl') returning id`,
    );
    await db.query('select install_country_template($1, $2)', [untranslated.id, 'BE']);
    const other = await one<{ name: string }>(
      db,
      `select name from accounts where company_id = $1 and code = '440000'`,
      [untranslated.id],
    );
    expect(other.name).toBe('Fournisseurs');
    await db.exec('rollback');
  });

  it('copies the journals and the taxes in that language too', async () => {
    // The chart of accounts was translated before the journals and the taxes
    // were, which left a company reading "Journal des ventes" over a chart in
    // Dutch. Both now carry name_i18n, and both are picked the same way.
    await db.exec('begin');
    const company = await one<{ id: string }>(
      db,
      `insert into companies (name, country, fiscal_country, currency_code, language)
       values ('Derde BV', 'BE', 'BE', 'EUR', 'nl') returning id`,
    );
    await db.query('select install_country_template($1, $2)', [company.id, 'BE']);

    const journal = await one<{ name: string; name_i18n: Record<string, string> }>(
      db,
      `select name, name_i18n from journals where company_id = $1 and code = 'SAL'`,
      [company.id],
    );
    expect(journal.name).toBe('Verkoopdagboek');
    expect(journal.name_i18n['de']).toBe('Verkaufsjournal');

    const tax = await one<{ name: string; name_i18n: Record<string, string> }>(
      db,
      `select name, name_i18n from taxes where company_id = $1 and code = 'BE-S-21'`,
      [company.id],
    );
    expect(tax.name).toBe('Verkoop 21 %');
    expect(tax.name_i18n['en']).toBe('Sale 21%');
    await db.exec('rollback');
  });

  it('takes the language of the call over the language of the company', async () => {
    await db.exec('begin');
    await db.query(
      `update account_templates set name_i18n = '{"en": "Trade receivables"}'::jsonb
        where country = 'BE' and code = '400000'`,
    );
    const company = await one<{ id: string }>(
      db,
      `insert into companies (name, country, fiscal_country, currency_code, language)
       values ('English Ltd', 'BE', 'BE', 'EUR', 'fr') returning id`,
    );
    await db.query('select install_country_template($1, $2, $3)', [company.id, 'BE', 'en']);
    const account = await one<{ name: string }>(
      db,
      `select name from accounts where company_id = $1 and code = '400000'`,
      [company.id],
    );
    expect(account.name).toBe('Trade receivables');
    await db.exec('rollback');
  });
});

describe('a seed applied again', () => {
  it('corrects a template and leaves the company that copied it alone', async () => {
    await db.exec('begin');
    const { companyId } = await newCompany(db, { name: 'Upsert SRL' });

    // The pack changes: one label, recompiled and re-applied. This is what
    // `on conflict do nothing` used to swallow entirely — an instance
    // installed yesterday received no correction, ever.
    const pack = await readPack('be', packs);
    const edited = {
      ...pack,
      charts: pack.charts.map((chart) => ({
        ...chart,
        accounts: chart.accounts.map((a) =>
          a.code === '700000' ? { ...a, name: 'Ventes de marchandises ou de services (corrigé)' } : a,
        ),
      })),
    };
    await db.exec(compilePack(edited));

    const template = await one<{ name: string }>(
      db,
      `select name from account_templates
        where country = 'BE' and chart_code = 'default' and code = '700000'`,
    );
    expect(template.name).toBe('Ventes de marchandises ou de services (corrigé)');

    const copied = await one<{ name: string }>(
      db,
      `select name from accounts where company_id = $1 and code = '700000'`,
      [companyId],
    );
    expect(copied.name).toBe('Ventes de marchandises ou de services');
    await db.exec('rollback');
  });

  it('leaves every template table as it found it when the pack has not changed', async () => {
    const tables = ['account_templates', 'journal_templates', 'tax_templates', 'tax_posting_templates', 'country_defaults', 'country_packs'];
    const snapshot = async (): Promise<Record<string, unknown>> => {
      const out: Record<string, unknown> = {};
      for (const table of tables) {
        out[table] = await rows(db, `select * from ${table} order by 1, 2`);
      }
      return out;
    };
    const before = await snapshot();
    for (const file of ['10_pack_be.sql', '11_pack_fr.sql']) {
      await db.exec(await readFile(join(repoRoot, 'supabase', 'seed', file), 'utf8'));
    }
    expect(await snapshot()).toEqual(before);
  });
});

describe('report_code, and the province a party sits in', () => {
  it('names the declaration form on every posting the packs carry', async () => {
    const missing = await rows<{ country: string; code: string }>(
      db,
      `select t.country, t.code
         from tax_posting_templates p
         join tax_templates t on t.id = p.tax_template_id
        where p.declaration_box is not null and p.report_code is null`,
    );
    expect(missing).toEqual([]);

    const forms = await rows<{ country: string; report_code: string; n: number }>(
      db,
      `select t.country, p.report_code, count(*)::int as n
         from tax_posting_templates p
         join tax_templates t on t.id = p.tax_template_id
        group by 1, 2 order by 1`,
    );
    // 72 + 16 and 56 + 2, from the Belgian vehicle and non-deductible taxes
    // and the French fuel tax. The two French postings with no form are the
    // `tax_on_base` share of the fuel tax: the CA3 carries no grid for the
    // base of a purchase, so that amount is ledger only — which is why the
    // test above asks for a form on a *boxed* posting and not on every one.
    expect(forms).toEqual([
      { country: 'BE', report_code: 'BE-VAT-PERIODIC', n: 88 },
      { country: 'FR', report_code: 'FR-CA3', n: 76 },
      { country: 'FR', report_code: null, n: 2 },
    ]);
  });

  it('carries it into a company, so a posted line knows which return it feeds', async () => {
    const { companyId } = await newCompany(db, { name: 'Report code SRL' });
    const postings = await rows<{ report_code: string | null }>(
      db,
      `select distinct report_code from tax_postings where company_id = $1`,
      [companyId],
    );
    expect(postings).toEqual([{ report_code: 'BE-VAT-PERIODIC' }]);
  });

  it('reads a posting that names no form as the periodic return of its country', async () => {
    // Nothing backfills `report_code` on a company's postings, deliberately:
    // null is documented as "the periodic return of the country", and that is
    // how `vat_return()` reads it. An installation seeded before the column
    // existed therefore files the same return as one seeded today, and no
    // migration ever had to name a country to make that true.
    const demo = await one<{ id: string }>(
      db,
      `select id from companies where vat_number = 'BE0123456749'`,
    );
    const before = await rows<{ box: string; amount: string }>(
      db,
      `select box, amount::text from vat_return($1, date '2026-07-01', date '2026-09-30')`,
      [demo.id],
    );
    expect(before.length).toBeGreaterThan(0);

    await db.exec('begin');
    try {
      await db.query(`update tax_postings set report_code = null where company_id = $1`, [demo.id]);
      const orphaned = await one<{ n: number }>(
        db,
        `select count(*)::int as n from tax_postings
          where company_id = $1 and report_code is not null`,
        [demo.id],
      );
      expect(orphaned.n).toBe(0);

      const after = await rows<{ box: string; amount: string }>(
        db,
        `select box, amount::text from vat_return($1, date '2026-07-01', date '2026-09-30')`,
        [demo.id],
      );
      expect(after).toEqual(before);
    } finally {
      await db.exec('rollback');
    }
  });

  it('gives a company and a contact a province, empty in Europe', async () => {
    const { companyId } = await newCompany(db, { name: 'Region SRL' });
    const company = await one<{ region: string | null }>(
      db,
      'select region from companies where id = $1',
      [companyId],
    );
    expect(company.region).toBeNull();

    // Nothing reads it before the Canadian pack; what has to be true today is
    // that it exists on both sides of a sale, because the tax follows the
    // buyer's province and not the seller's.
    await db.exec('begin');
    await db.query(`update companies set region = 'QC' where id = $1`, [companyId]);
    const contact = await one<{ region: string }>(
      db,
      `insert into contacts (company_id, name, contact_type, country, region)
       values ($1, 'Client de Colombie-Britannique', 'customer', 'CA', 'BC')
       returning region`,
      [companyId],
    );
    expect(contact.region).toBe('BC');
    await db.exec('rollback');
  });
});

describe('row level security on the two new tables', () => {
  it('lets a member read the packs of the installation and refuses a stranger', async () => {
    const ownerId = await newUser(db);
    await newCompany(db, { name: 'RLS pack SRL', ownerId });
    const strangerId = await newUser(db);

    const seen = await asUser(db, ownerId, () => rows(db, 'select country from country_packs'));
    expect(seen.map((r) => (r as { country: string }).country)).toEqual(['BE', 'FR']);

    const nothing = await asUser(db, strangerId, () => rows(db, 'select country from country_packs'));
    expect(nothing).toEqual([]);
  });

  it('shows a company its own pack and not another company\'s', async () => {
    const viewerId = await newUser(db);
    const mine = await newCompany(db, { name: 'Mine SRL' });
    const theirs = await newCompany(db, { name: 'Theirs SRL' });
    await db.query(
      `insert into company_members (company_id, user_id, role) values ($1, $2, 'viewer')`,
      [mine.companyId, viewerId],
    );

    const seen = await asUser(db, viewerId, () =>
      rows<{ company_id: string }>(db, 'select company_id from company_packs'),
    );
    expect(seen.map((r) => r.company_id)).toEqual([mine.companyId]);
    expect(seen.map((r) => r.company_id)).not.toContain(theirs.companyId);
  });

  it('leaves a viewer unable to rewrite the version their company holds', async () => {
    const viewerId = await newUser(db);
    const { companyId } = await newCompany(db, { name: 'Viewer SRL' });
    await db.query(
      `insert into company_members (company_id, user_id, role) values ($1, $2, 'viewer')`,
      [companyId, viewerId],
    );
    // An UPDATE a policy does not select simply matches no row, as everywhere
    // else in this schema; an INSERT is the one that raises.
    await asUser(db, viewerId, async () => {
      await db.query(`update company_packs set version = '9.9.9' where company_id = $1`, [companyId]);
    });
    const after = await one<{ country: string; version: string }>(
      db,
      'select country, version from company_packs where company_id = $1',
      [companyId],
    );
    expect(after.version).toBe(await versionOf(after.country));

    const message = await asUser(db, viewerId, () =>
      expectError(
        db,
        `insert into company_packs (company_id, country, version) values ($1, 'FR', '1.0.0')`,
        [companyId],
      ),
    );
    expect(message).toMatch(/row-level security|violates/i);
  });

  it('refuses a signed-in stranger writing a pack into the installation', async () => {
    const strangerId = await newUser(db);
    const message = await asUser(db, strangerId, () =>
      expectError(db, `insert into country_packs (country, name, version) values ('XX', 'Nowhere', '1.0.0')`),
    );
    expect(message).toMatch(/row-level security|permission denied/i);
  });
});
