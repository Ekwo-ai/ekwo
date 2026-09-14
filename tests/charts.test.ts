import type { PGlite } from '@electric-sql/pglite';
import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readPack } from '../packages/cli/src/index.js';
import { asUser, expectError, freshDatabase, one, repoRoot, rows } from './helpers/db.js';
import { allPacks, packWhere, packsRoot } from './helpers/packs.js';
import { newCompany } from './helpers/factory.js';

// A country has charts of accounts, not one chart. The key
// of `account_templates` was `(country, code)`, which says a Belgian ASBL and a
// Belgian company keep the same books. They do not — and Germany has two, and
// every country with a regulated profession has more.

let db: PGlite;

beforeAll(async () => {
  db = await freshDatabase();
}, 120_000);

afterAll(async () => {
  await db.close();
});

describe('the charts the packs carry', () => {
  it('are seeded, one of them the default of its country', async () => {
    const charts = await rows<{
      country: string;
      code: string;
      name: string;
      is_default: boolean;
      audience: string | null;
      accounts: number;
    }>(
      db,
      `select c.country, c.code, c.name, c.is_default, c.audience,
              (select count(*)::int from account_templates a
                where a.country = c.country and a.chart_code = c.code) as accounts
         from chart_templates c order by c.country, c.code`,
    );
    // Every chart of every pack, with the name and the audience the pack gives
    // it and the accounts its own CSV holds. A country that adds a second chart
    // is in this list without a line being added to it.
    expect(charts).toEqual(
      allPacks
        .flatMap((pack) =>
          pack.charts.map((chart) => ({
            country: pack.manifest.country,
            code: chart.code,
            name: chart.name,
            is_default: chart.is_default,
            audience: chart.audience,
            accounts: chart.accounts.length,
          })),
        )
        .sort((a, b) => (`${a.country}${a.code}` < `${b.country}${b.code}` ? -1 : 1)),
    );
    // Exactly one chart of each pack is the one a company gets by default.
    for (const pack of allPacks) {
      expect(pack.charts.filter((chart) => chart.is_default), pack.slug).toHaveLength(1);
    }
  });

  it('carry a certification of their own only where it differs from the pack', async () => {
    // A chart contributed to a maintained pack says so on the chart rather
    // than dragging the whole country down to it, and a chart that says
    // nothing carries null — the pack's own status answers for it.
    for (const pack of allPacks) {
      const seen = await rows<{ code: string; status: string | null }>(
        db,
        `select code, certification_status::text as status
           from chart_templates where country = $1 order by code`,
        [pack.manifest.country],
      );
      expect(seen, pack.slug).toEqual(
        [...pack.charts]
          .sort((a, b) => (a.code < b.code ? -1 : 1))
          .map((chart) => ({ code: chart.code, status: chart.certification?.status ?? null })),
      );
    }
  });

  it('let one country hold the same code twice, which is the whole point', async () => {
    // A pack with two charts gives the same account code two meanings, and
    // both are loaded under the chart that gives it.
    const several = packWhere('carries more than one chart', (pack) => pack.charts.length > 1);
    const shared = several.charts[0]!.accounts
      .map((account) => account.code)
      .filter((code) => several.charts.every((chart) => chart.accounts.some((a) => a.code === code)))
      .find((code) => {
        const names = new Set(
          several.charts.map((chart) => chart.accounts.find((a) => a.code === code)!.name),
        );
        return names.size === several.charts.length;
      })!;
    expect(shared, `${several.slug} names no account differently in two charts`).toBeDefined();

    const both = await rows<{ chart_code: string; name: string }>(
      db,
      `select chart_code, name from account_templates
        where country = $1 and code = $2 order by chart_code`,
      [several.manifest.country, shared],
    );
    expect(both).toEqual(
      [...several.charts]
        .sort((a, b) => (a.code < b.code ? -1 : 1))
        .map((chart) => ({
          chart_code: chart.code,
          name: chart.accounts.find((a) => a.code === shared)!.name,
        })),
    );
  });

  it('refuse an account pointing at a chart that does not exist', async () => {
    const message = await expectError(
      db,
      `insert into account_templates (country, chart_code, code, name, account_type)
       values ('BE', 'nope', '999999', 'Essai', 'expense')`,
    );
    expect(message).toMatch(/account_templates_chart_fk|foreign key/i);
  });

  it('refuse a second default chart in one country', async () => {
    const message = await expectError(
      db,
      `insert into chart_templates (country, code, name, is_default)
       values ('BE', 'second', 'Deuxième', true)`,
    );
    expect(message).toMatch(/chart_templates_one_default_idx|unique/i);
  });
});

describe('installing a company on a chart', () => {
  it('takes the default chart when nobody names one', async () => {
    const { companyId } = await newCompany(db, { country: 'BE', name: 'Par défaut SRL' });
    const copied = await one<{ chart_code: string; accounts: number }>(
      db,
      `select p.chart_code,
              (select count(*)::int from accounts a where a.company_id = p.company_id) as accounts
         from company_packs p where p.company_id = $1`,
      [companyId],
    );
    expect(copied).toEqual({ chart_code: 'default', accounts: 353 });

    const capital = await one<{ name: string }>(
      db,
      `select name from accounts where company_id = $1 and code = '100000'`,
      [companyId],
    );
    expect(capital.name).toBe('Capital souscrit');
  });

  it('takes the one it is given, with the country taxes and journals of the country', async () => {
    const company = await one<{ id: string }>(
      db,
      `insert into companies (name, country, fiscal_country, currency_code)
       values ('Association Test ASBL', 'BE', 'BE', 'EUR') returning id`,
    );
    await db.query(`select install_country_template($1, 'BE', null, 'asbl')`, [company.id]);

    const copied = await one<{ chart_code: string; accounts: number; taxes: number; journals: number }>(
      db,
      `select p.chart_code,
              (select count(*)::int from accounts a where a.company_id = p.company_id) as accounts,
              (select count(*)::int from taxes t where t.company_id = p.company_id) as taxes,
              (select count(*)::int from journals j where j.company_id = p.company_id) as journals
         from company_packs p where p.company_id = $1`,
      [company.id],
    );
    expect(copied).toEqual({ chart_code: 'asbl', accounts: 349, taxes: 22, journals: 6 });

    // The association chart calls 100000 something else, and the roles and the
    // VAT accounts still resolve — which is the constraint `pack check` keeps.
    const fonds = await one<{ name: string }>(
      db,
      `select name from accounts where company_id = $1 and code = '100000'`,
      [company.id],
    );
    expect(fonds.name).toBe('Patrimoine de départ');

    const wired = await one<{ receivable: string; payable: string; vat: number }>(
      db,
      `select ar.code as receivable, ap.code as payable,
              (select count(*)::int from tax_postings tp
                where tp.company_id = c.id and tp.account_id is null
                  and tp.posting_type = 'tax') as vat
         from companies c
         join accounts ar on ar.id = c.receivable_account_id
         join accounts ap on ap.id = c.payable_account_id
        where c.id = $1`,
      [company.id],
    );
    expect(wired).toEqual({ receivable: '400000', payable: '440000', vat: 0 });
  });

  it('refuses a chart the country does not have, and says what it has', async () => {
    const { companyId } = await newCompany(db, { country: 'BE', name: 'Mauvais plan SRL' });
    const message = await expectError(
      db,
      `select install_country_template($1, 'BE', null, 'skr04')`,
      [companyId],
    );
    expect(message).toMatch(/unknown_chart/);
    expect(message).toMatch(/asbl, default/);
  });

  it('leaves a company installed before this change on the chart it had', async () => {
    // The column landed with a default, so every row of an existing
    // installation says `default` — which is the chart that was the only one.
    const behind = await rows(
      db,
      `select company_id from company_packs where chart_code is null`,
    );
    expect(behind).toEqual([]);

    const { companyId } = await newCompany(db, { country: 'FR', name: 'Ancienne SAS' });
    await db.query(`select install_country_template($1, 'FR')`, [companyId]);
    const copied = await one<{ chart_code: string }>(
      db,
      'select chart_code from company_packs where company_id = $1',
      [companyId],
    );
    expect(copied.chart_code).toBe('default');
  });
});

describe('chart_templates under row level security', () => {
  it('is readable by a signed-in user and writable by nobody', async () => {
    const { ownerId } = await newCompany(db, { country: 'BE', name: 'Lectrice de plans SRL' });
    await asUser(db, ownerId, async () => {
      const seen = await one<{ n: number }>(db, 'select count(*)::int as n from chart_templates');
      expect(seen.n).toBe(allPacks.reduce((n, pack) => n + pack.charts.length, 0));

      const message = await expectError(
        db,
        `insert into chart_templates (country, code, name) values ('BE', 'mine', 'À moi')`,
      );
      expect(message).toMatch(/row-level security|permission denied/);

      // Since `20260914151207` the grant says the same thing as the policy:
      // `authenticated` holds SELECT on this table and nothing else, so an
      // update is refused before a row is looked at.
      expect(
        await expectError(db, `update chart_templates set name = 'Changé' where code = 'asbl'`),
      ).toMatch(/permission denied for table chart_templates/);
    });
  });

  it('is refused to a request that carries no user', async () => {
    await db.exec(`select set_config('request.jwt.claims', '', false); set role anon;`);
    try {
      expect(await expectError(db, 'select code from chart_templates')).toMatch(
        /permission denied for table chart_templates/,
      );
    } finally {
      await db.exec('reset role;');
    }
  });
});

describe('what `ekwo pack check` refuses about charts', () => {
  const packs = packsRoot;

  // A pack that declares several charts is what these refusals need: the rules
  // they break are about the set of charts, so a pack with one would prove
  // nothing. Which pack that is comes from the packs themselves.
  const several = packWhere('declares more than one chart', (pack) => pack.charts.length > 1);

  /** A copy of that pack in a temporary directory, with its manifest edited. */
  async function packWith(edit: (manifest: Record<string, unknown>) => void): Promise<void> {
    const dir = await mkdtemp(join(tmpdir(), 'ekwo-chart-'));
    await cp(join(packs, 'schema'), join(dir, 'schema'), { recursive: true });
    await cp(join(packs, several.slug), join(dir, several.slug), { recursive: true });
    const manifest = JSON.parse(
      await readFile(join(packs, several.slug, 'pack.json'), 'utf8'),
    ) as Record<string, unknown>;
    edit(manifest);
    await writeFile(join(dir, several.slug, 'pack.json'), JSON.stringify(manifest), 'utf8');
    await readPack(several.slug, dir);
  }

  it('accepts the packs of this repository as they are', async () => {
    for (const pack of allPacks) {
      // The default chart comes first, and `accounts` is that chart's accounts.
      expect(pack.charts[0]!.is_default, pack.slug).toBe(true);
      expect(pack.accounts, pack.slug).toEqual(pack.charts[0]!.accounts);
      expect(pack.accounts.length, pack.slug).toBeGreaterThan(0);
    }
  });

  it('refuses a pack with no default chart', async () => {
    await expect(
      packWith((m) => {
        for (const chart of m['charts'] as Record<string, unknown>[]) delete chart['default'];
      }),
    ).rejects.toThrow(/no chart is the default/);
  });

  it('refuses two default charts', async () => {
    await expect(
      packWith((m) => {
        for (const chart of m['charts'] as Record<string, unknown>[]) chart['default'] = true;
      }),
    ).rejects.toThrow(/2 charts are the default/);
  });

  it('refuses a chart whose file is not there', async () => {
    await expect(
      packWith((m) => {
        (m['charts'] as Record<string, unknown>[])[1]!['accounts'] = 'accounts.sprl.csv';
      }),
    ).rejects.toThrow(/accounts\.sprl\.csv does not exist/);
  });

  it('refuses a role code that is missing from one chart', async () => {
    // The taxes, the journals and the roles of a country are common to its
    // charts. A chart that does not carry the payable account installs a
    // company with no payable account, and nothing says so until a bill.
    await expect(
      packWith((m) => {
        (m['defaults'] as { roles: Record<string, string> }).roles['payable'] = '441000';
      }),
    ).rejects.toThrow(/441000 is not in chart (default|asbl)/);
  });

  it('refuses a statement a chart names and the pack does not carry', async () => {
    await expect(
      packWith((m) => {
        (m['charts'] as Record<string, unknown>[])[0]!['statements'] = ['BE-BNB-FULL-BS'];
      }),
    ).rejects.toThrow(/BE-BNB-FULL-BS is not a statement of this pack/);
  });
});
