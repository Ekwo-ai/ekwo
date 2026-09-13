/**
 * The module tools, over the protocol and against the real schema.
 *
 * What is checked here is the loader as much as the tools: a module that is
 * not installed is not offered, one that is installed is, and every tool name
 * is the prefix its `module.json` declares. The handlers themselves are thin —
 * the arithmetic is tested in `modules/assets/tests` — so what they are held to
 * is the shape a model receives.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  MODULE_TOOLSETS,
  buildServer,
  installedModules,
  type Backend,
} from '../../packages/mcp/src/index.js';
import { listModules } from '../../packages/cli/src/module/read.js';
import { asUser, freshDatabase, one, repoRoot, rows } from '../helpers/db.js';
import { newCompany } from '../helpers/factory.js';
import { backendFor, record } from './helpers.js';
import { join } from 'node:path';

let db: PGlite;
let backend: Backend;
let companyId: string;
let ownerId: string;

async function connect(modules: readonly string[]): Promise<Client> {
  const client = new Client({ name: 'test', version: '0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([buildServer(backend, { modules }).connect(b), client.connect(a)]);
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown>): Promise<unknown> {
  const result = (await client.callTool({ name, arguments: args })) as {
    isError?: boolean;
    content: { text: string }[];
  };
  const text = result.content[0]?.text ?? '';
  if (result.isError === true) throw new Error(text);
  return JSON.parse(text);
}

beforeAll(async () => {
  db = await freshDatabase();
  ({ companyId, ownerId } = await newCompany(db, { country: 'BE', name: 'Outils SRL' }));
  await asUser(db, ownerId, async () => {
    await db.query(`select enable_module($1, 'assets')`, [companyId]);
    await db.query(`select enable_module($1, 'budgets')`, [companyId]);
  });
  await db.query(
    `insert into fiscal_years (company_id, name, start_date, end_date)
     values ($1, 'Exercice 2027', date '2027-01-01', date '2027-12-31')`,
    [companyId],
  );
  backend = backendFor(db, ownerId);
});

afterAll(async () => {
  await db.close();
});

describe('the loader', () => {
  it('offers nothing when no module is installed', async () => {
    const client = await connect([]);
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    expect(names.filter((name) => name.startsWith('assets_') || name.startsWith('budgets_'))).toEqual([]);
    await client.close();
  });

  it('offers a module\'s tools under the prefix its manifest declares', async () => {
    const manifests = new Map(
      (await listModules(join(repoRoot, 'modules'))).map((module) => [
        module.manifest.code,
        module.manifest,
      ]),
    );
    const client = await connect(['assets', 'budgets']);
    const names = (await client.listTools()).tools.map((tool) => tool.name);

    for (const toolset of MODULE_TOOLSETS) {
      const manifest = manifests.get(toolset.code);
      expect(manifest?.mcp?.prefix, `${toolset.code}/module.json declares no mcp prefix`).toBe(
        toolset.prefix,
      );
      for (const tool of toolset.tools) {
        expect(names).toContain(`${toolset.prefix}_${tool.verb}`);
      }
    }

    expect(names.filter((name) => name.startsWith('assets_')).sort()).toEqual([
      'assets_create',
      'assets_dispose',
      'assets_list',
      'assets_run_depreciation',
      'assets_schedule',
    ]);
    expect(names.filter((name) => name.startsWith('budgets_')).sort()).toEqual([
      'budgets_list',
      'budgets_upsert_lines',
      'budgets_variance',
    ]);
    await client.close();
  });

  it('reads the installed modules off the registry, leaving a draft out', async () => {
    expect(await installedModules(backend)).toEqual(['assets', 'budgets']);
    await db.query(`update modules set status = 'draft' where code = 'budgets'`);
    expect(await installedModules(backend)).toEqual(['assets']);
    await db.query(`update modules set status = 'available' where code = 'budgets'`);
  });
});

describe('the assets tools', () => {
  let client: Client;

  beforeAll(async () => {
    client = await connect(['assets', 'budgets']);
  });

  afterAll(async () => {
    await client.close();
  });

  it('create an asset, read its schedule, book it and dispose of it', async () => {
    const created = record(
      await call(client, 'assets_create', {
        company_id: companyId,
        code: 'IT-01',
        name: 'Portable',
        acquisition_date: '2026-01-01',
        cost: 3600,
        asset_account: '241000',
        depreciation_account: '241900',
        expense_account: '630200',
        category_code: 'it-equipment',
      }),
    );
    expect(created['asset_id']).toBeTruthy();

    const schedule = record(
      await call(client, 'assets_schedule', {
        company_id: companyId,
        asset_id: created['asset_id'],
      }),
    );
    const lines = schedule['lines'] as { amount: string }[];
    expect(lines.map((line) => line.amount)).toEqual(['1200.00', '1200.00', '1200.00']);

    const run = record(
      await call(client, 'assets_run_depreciation', {
        company_id: companyId,
        period_end: '2026-12-31',
      }),
    );
    expect((run['entries'] as { amount: string }[]).map((e) => e.amount)).toEqual(['1200.00']);

    const register = record(await call(client, 'assets_list', { company_id: companyId, at: '2026-12-31' }));
    expect(register['assets']).toEqual([
      {
        code: 'IT-01',
        name: 'Portable',
        category_code: 'it-equipment',
        acquisition_date: '2026-01-01',
        cost: '3600.00',
        accumulated: '1200.00',
        net_book_value: '2400.00',
        state: 'active',
      },
    ]);

    const disposal = record(
      await call(client, 'assets_dispose', {
        company_id: companyId,
        asset_id: created['asset_id'],
        disposal_date: '2027-01-10',
        proceeds: 2000,
        counterpart_account: '400000',
      }),
    );
    expect(disposal['entry_id']).toBeTruthy();

    const ledger = await rows<{ code: string; debit: string; credit: string }>(
      db,
      `select a.code, l.debit, l.credit from entry_lines l
         join accounts a on a.id = l.account_id where l.entry_id = $1 order by l.sequence`,
      [disposal['entry_id'] as string],
    );
    // 1 200 written off, 2 400 left, sold for 2 000: a loss of 400 on 663.
    expect(ledger).toEqual([
      { code: '241900', debit: '1200.00', credit: '0.00' },
      { code: '241000', debit: '0.00', credit: '3600.00' },
      { code: '400000', debit: '2000.00', credit: '0.00' },
      { code: '663000', debit: '400.00', credit: '0.00' },
    ]);
  });

  it('report the socle refusal rather than paraphrasing it', async () => {
    await db.query(`update companies set lock_date = date '2027-12-31' where id = $1`, [companyId]);
    await db.query(
      `select assets.create_asset($1, 'IT-02', 'Ecran', date '2027-01-01', 600,
              '241000', '241900', '630200', 'it-equipment')`,
      [companyId],
    );
    await expect(
      call(client, 'assets_run_depreciation', { company_id: companyId, period_end: '2027-12-31' }),
    ).rejects.toThrow(/period_locked/);
    await db.query(`update companies set lock_date = null where id = $1`, [companyId]);
  });
});

describe('the budgets tools', () => {
  let client: Client;
  let budgetId: string;

  beforeAll(async () => {
    client = await connect(['assets', 'budgets']);
    const budget = await one<{ id: string }>(
      db,
      `insert into budgets.budgets (company_id, code, name) values ($1, 'B2026', 'Budget 2026')
       returning id`,
      [companyId],
    );
    budgetId = budget.id;
  });

  afterAll(async () => {
    await client.close();
  });

  it('list the budgets, write lines and read the variance', async () => {
    const listed = record(await call(client, 'budgets_list', { company_id: companyId }));
    expect((listed['budgets'] as { code: string }[]).map((b) => b.code)).toEqual(['B2026']);

    const written = record(
      await call(client, 'budgets_upsert_lines', {
        company_id: companyId,
        budget_id: budgetId,
        lines: [
          {
            account_code: '630200',
            period_start: '2026-01-01',
            period_end: '2026-12-31',
            amount: 1500,
          },
        ],
      }),
    );
    expect(written).toEqual({ written: 1 });

    // Writing the same account and period again replaces the figure rather
    // than adding a second one: a revision of one line is not two lines.
    await call(client, 'budgets_upsert_lines', {
      company_id: companyId,
      budget_id: budgetId,
      lines: [
        {
          account_code: '630200',
          period_start: '2026-01-01',
          period_end: '2026-12-31',
          amount: 1000,
        },
      ],
    });

    const variance = record(
      await call(client, 'budgets_variance', {
        company_id: companyId,
        budget_id: budgetId,
        from: '2026-01-01',
        to: '2026-12-31',
      }),
    );
    // The depreciation booked above is 1 200 against a plan of 1 000.
    expect(variance['lines']).toEqual([
      { account_code: '630200', account_name: 'Dotations aux amortissements sur immobilisations corporelles', budget: '1000.00', actual: '1200.00', variance: '200.00' },
    ]);
  });

  it('refuse an account the company does not have, by name', async () => {
    await expect(
      call(client, 'budgets_upsert_lines', {
        company_id: companyId,
        budget_id: budgetId,
        lines: [
          { account_code: '999999', period_start: '2026-01-01', period_end: '2026-12-31', amount: 1 },
        ],
      }),
    ).rejects.toThrow(/unknown_account: 999999/);
  });
});
