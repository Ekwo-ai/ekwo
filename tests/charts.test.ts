import type { PGlite } from '@electric-sql/pglite';
import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readPack } from '../packages/cli/src/index.js';
import { asUser, expectError, freshDatabase, one, repoRoot, rows } from './helpers/db.js';
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
    expect(charts).toEqual([
      {
        country: 'BE',
        code: 'asbl',
        name: 'PCMN — associations et fondations',
        is_default: false,
        audience: 'nonprofits',
        accounts: 349,
      },
      {
        country: 'BE',
        code: 'default',
        name: 'PCMN — plan comptable minimum normalisé',
        is_default: true,
        audience: 'companies',
        accounts: 353,
      },
      {
        country: 'FR',
        code: 'default',
        name: 'PCG — plan comptable général',
        is_default: true,
        audience: 'companies',
        accounts: 394,
      },
    ]);
  });

  it('carry a certification of their own only where it differs from the pack', async () => {
    // The Belgian association chart is contributed, not maintained: the pack
    // says so on the chart rather than dragging the whole country down to it.
    const seen = await rows<{ code: string; status: string | null }>(
      db,
      `select code, certification_status::text as status
         from chart_templates where country = 'BE' order by code`,
    );
    expect(seen).toEqual([
      { code: 'asbl', status: 'community' },
      { code: 'default', status: null },
    ]);
  });

  it('let one country hold the same code twice, which is the whole point', async () => {
    const both = await rows<{ chart_code: string; name: string }>(
      db,
      `select chart_code, name from account_templates
        where country = 'BE' and code = '100000' order by chart_code`,
    );
    expect(both).toEqual([
      { chart_code: 'asbl', name: 'Patrimoine de départ' },
      { chart_code: 'default', name: 'Capital souscrit' },
    ]);
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
      expect(seen.n).toBe(3);

      const message = await expectError(
        db,
        `insert into chart_templates (country, code, name) values ('BE', 'mine', 'À moi')`,
      );
      expect(message).toMatch(/row-level security|permission denied/);

      const changed = await db.query(`update chart_templates set name = 'Changé' where code = 'asbl'`);
      expect(changed.affectedRows ?? 0).toBe(0);
    });
  });

  it('is invisible to a request that carries no user', async () => {
    await db.exec(`select set_config('request.jwt.claims', '', false); set role anon;`);
    try {
      expect(await rows(db, 'select code from chart_templates')).toEqual([]);
    } finally {
      await db.exec('reset role;');
    }
  });
});

describe('what `ekwo pack check` refuses about charts', () => {
  const packs = join(repoRoot, 'packs');

  /** `packs/be` in a temporary directory, with its manifest edited. */
  async function packWith(edit: (manifest: Record<string, unknown>) => void): Promise<void> {
    const dir = await mkdtemp(join(tmpdir(), 'ekwo-chart-'));
    await cp(join(packs, 'schema'), join(dir, 'schema'), { recursive: true });
    await cp(join(packs, 'be'), join(dir, 'be'), { recursive: true });
    const manifest = JSON.parse(await readFile(join(packs, 'be', 'pack.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    edit(manifest);
    await writeFile(join(dir, 'be', 'pack.json'), JSON.stringify(manifest), 'utf8');
    await readPack('be', dir);
  }

  it('accepts the packs of this repository as they are', async () => {
    const be = await readPack('be', packs);
    expect(be.charts.map((c) => c.code)).toEqual(['default', 'asbl']);
    expect(be.accounts).toHaveLength(353);
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
