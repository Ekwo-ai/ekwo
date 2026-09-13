/**
 * The tools of the modules, and the loader that puts them on the server.
 *
 * A module is a schema of its own, so its tools are named after it —
 * `assets_list`, `budgets_variance` — and a model reading a tool list can tell
 * which module answers for what. The prefix is in `module.json`, and a test
 * holds the tool names to it.
 *
 * **Nothing here decides what is installed.** `public.modules` does, and the
 * server asks it at startup: a module whose migrations have never run has no
 * row, so its tools are not offered, and a tool a model cannot use is worse
 * than a tool it cannot see. What the registry below carries is the other
 * half — the handlers this release knows how to write — and a module installed
 * in the database that this release has no handlers for is simply not exposed.
 *
 * **PostgREST has to be told.** A schema other than `public` is served only
 * once the project lists it under its exposed schemas, which no migration can
 * set. The refusal that comes back is a 406 about a profile, which says
 * nothing useful to a model, so every module tool turns it into the sentence
 * that names the setting.
 */

import { z } from 'zod';
import { EkwoMcpError, type Backend, type Row } from '../backend.js';
import { money } from '../format.js';
import { companyId, isoDate, uuid } from './read.js';

/** One module's tools, as the loader sees them. */
export interface ModuleToolset {
  /** The module code, and the key of `public.modules`. */
  code: string;
  /** Every tool of this module is `<prefix>_<verb>`. */
  prefix: string;
  /** The schema its objects live in, for the message when it is not exposed. */
  schema: string;
  tools: ModuleTool[];
}

export interface ModuleTool {
  /** Without the prefix: `list`, `create`, `variance`. */
  verb: string;
  title: string;
  description: string;
  input: z.ZodObject<z.ZodRawShape>;
  readOnly: boolean;
  run(backend: Backend, args: Record<string, never>): Promise<unknown>;
}

/**
 * A schema the project has not exposed answers with a profile error, which
 * reads like a bug in this server. It is a setting, so say which one.
 */
export async function inSchema<T>(schema: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/profile|schema must be one of|PGRST106|acceptable/i.test(message)) {
      throw new EkwoMcpError(
        `schema_not_exposed: the \`${schema}\` schema is not served by this project's API. ` +
          `Add it in Supabase → Project Settings → API → Exposed schemas, or to \`[api] schemas\` ` +
          `in supabase/config.toml, and try again. ${message}`,
      );
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// assets
// ---------------------------------------------------------------------------

const ASSETS: ModuleToolset = {
  code: 'assets',
  prefix: 'assets',
  schema: 'assets',
  tools: [
    {
      verb: 'list',
      title: 'Fixed assets',
      readOnly: true,
      description:
        'The register of fixed assets of a company at a date: what each one cost, what has been written off it and what is left. It reads what has been *booked*, so it ties back to the accumulated depreciation account on the balance sheet. An asset disposed of before that date is not in it.',
      input: z.object({
        company_id: companyId,
        at: isoDate.describe('The date to read the register at.'),
      }),
      async run(backend, args) {
        const at = args['at'] as unknown as string;
        const rows = await inSchema('assets', () =>
          backend.rpc<Row>('register', { p_company_id: args['company_id'], p_at: at }, 'assets'),
        );
        return {
          at,
          assets: rows.map((row) => ({
            ...row,
            cost: money(row['cost']),
            accumulated: money(row['accumulated']),
            net_book_value: money(row['net_book_value']),
          })),
        };
      },
    },
    {
      verb: 'create',
      title: 'Record a fixed asset',
      readOnly: false,
      description:
        'Creates a fixed asset and writes its depreciation schedule in one call. Give a `category_code` from the country pack — assets_categories lists them — and the method, the duration and the coefficient come from it; anything you pass yourself wins over the category. The three accounts are the asset account, the accumulated depreciation account and the depreciation charge. Nothing is booked here: assets_run_depreciation is what posts.',
      input: z.object({
        company_id: companyId,
        code: z.string().min(1).describe('Your own reference for the asset. Unique in the company.'),
        name: z.string().min(1),
        acquisition_date: isoDate,
        cost: z.number().positive().describe('What it cost, excluding recoverable tax.'),
        asset_account: z.string().describe('Account code the asset itself sits on.'),
        depreciation_account: z.string().describe('Account code of the accumulated depreciation.'),
        expense_account: z.string().describe('Account code the depreciation charge lands on.'),
        category_code: z.string().optional().describe('A category of the country pack.'),
        duration_months: z.number().int().positive().optional(),
        method: z.enum(['straight_line', 'declining_balance']).optional(),
        coefficient: z.number().positive().optional().describe('Required by a declining balance.'),
        residual_value: z.number().min(0).optional(),
        in_service_date: isoDate.optional().describe('When it started being used, if not the day it was bought.'),
        description: z.string().optional(),
      }),
      async run(backend, args) {
        // A function returning a scalar comes back as the scalar, on either
        // backend: `opening_balance` is read the same way.
        const created = await inSchema('assets', () =>
          backend.rpc<string>(
            'create_asset',
            {
              p_company_id: args['company_id'],
              p_code: args['code'],
              p_name: args['name'],
              p_acquisition_date: args['acquisition_date'],
              p_cost: args['cost'],
              p_asset_account: args['asset_account'],
              p_depreciation_account: args['depreciation_account'],
              p_expense_account: args['expense_account'],
              p_category_code: args['category_code'] ?? null,
              p_duration_months: args['duration_months'] ?? null,
              p_method: args['method'] ?? null,
              p_coefficient: args['coefficient'] ?? null,
              p_residual_value: args['residual_value'] ?? 0,
              p_in_service_date: args['in_service_date'] ?? null,
              p_description: args['description'] ?? null,
            },
            'assets',
          ),
        );
        return { asset_id: created[0] ?? null };
      },
    },
    {
      verb: 'schedule',
      title: 'Depreciation schedule',
      readOnly: true,
      description:
        'The planned depreciation of one asset, period by period, with the amount, the accumulated total and the net book value after each one, and the entry that booked it where it has been booked. The schedule always sums to exactly the cost less the residual value: the last line takes the remainder.',
      input: z.object({ company_id: companyId, asset_id: uuid }),
      async run(backend, args) {
        const lines = await inSchema('assets', () =>
          backend.select<Row>({
            schema: 'assets',
            table: 'depreciation_lines',
            columns: [
              'sequence',
              'period_start',
              'period_end',
              'amount::text',
              'accumulated::text',
              'net_book_value::text',
              'entry_id',
              'posted_at',
            ],
            where: [
              { column: 'company_id', op: 'eq', value: args['company_id'] as unknown as string },
              { column: 'asset_id', op: 'eq', value: args['asset_id'] as unknown as string },
            ],
            order: [{ column: 'sequence' }],
          }),
        );
        return { lines };
      },
    },
    {
      verb: 'run_depreciation',
      title: 'Book the depreciation',
      readOnly: false,
      description:
        'Books every planned period that ends on or before a date, one ledger entry per period, through the socle\'s own posting function. It is idempotent: a period already booked is skipped, and the database refuses a second entry for it anyway. A closed financial year or a locked period refuses the posting — report the refusal, do not move the date.',
      input: z.object({
        company_id: companyId,
        period_end: isoDate.describe('Book everything up to and including this date.'),
      }),
      async run(backend, args) {
        const result = await inSchema('assets', () =>
          backend.rpc<{ entries: unknown[] }>(
            'run_depreciation',
            { p_company_id: args['company_id'], p_period_end: args['period_end'] },
            'assets',
          ),
        );
        return result[0] ?? { entries: [] };
      },
    },
    {
      verb: 'dispose',
      title: 'Dispose of a fixed asset',
      readOnly: false,
      description:
        'Takes an asset off the books on a date: clears its cost and its accumulated depreciation, books the proceeds against the account you name, and presents the result the way the country pack says — one gain or loss line, or the value sold and the proceeds in full. Run assets_run_depreciation first: a disposal is refused while a period that has already ended is still unbooked. There is no undo.',
      input: z.object({
        company_id: companyId,
        asset_id: uuid,
        disposal_date: isoDate,
        proceeds: z.number().min(0).default(0).describe('What it was sold for, excluding tax. Zero when it was scrapped.'),
        counterpart_account: z
          .string()
          .optional()
          .describe('Account code the proceeds are owed on. The receivable account of the company by default.'),
        contact_id: uuid.optional().describe('Who bought it.'),
      }),
      async run(backend, args) {
        const result = await inSchema('assets', () =>
          backend.rpc<string>(
            'dispose_asset',
            {
              p_asset_id: args['asset_id'],
              p_date: args['disposal_date'],
              p_proceeds: args['proceeds'] ?? 0,
              p_counterpart_account: args['counterpart_account'] ?? null,
              p_contact_id: args['contact_id'] ?? null,
            },
            'assets',
          ),
        );
        return { entry_id: result[0] ?? null };
      },
    },
  ],
};

// ---------------------------------------------------------------------------
// budgets
// ---------------------------------------------------------------------------

const BUDGETS: ModuleToolset = {
  code: 'budgets',
  prefix: 'budgets',
  schema: 'budgets',
  tools: [
    {
      verb: 'list',
      title: 'Budgets',
      readOnly: true,
      description:
        'The budgets of a company, with the financial year each one is for and whether it is a draft, approved or closed. Start here: budgets_variance needs a budget_id.',
      input: z.object({ company_id: companyId }),
      async run(backend, args) {
        const budgets = await inSchema('budgets', () =>
          backend.select<Row>({
            schema: 'budgets',
            table: 'budgets',
            columns: ['id', 'code', 'name', 'state', 'fiscal_year_id', 'notes'],
            where: [{ column: 'company_id', op: 'eq', value: args['company_id'] as unknown as string }],
            order: [{ column: 'code' }],
          }),
        );
        return { budgets };
      },
    },
    {
      verb: 'upsert_lines',
      title: 'Write budget lines',
      readOnly: false,
      description:
        'Adds lines to a budget: one figure per account and per period. State the amount the way a business says it out loud — an income and a cost are both positive — and the comparison flips the ledger, not you. A line already there for the same account and period is replaced.',
      input: z.object({
        company_id: companyId,
        budget_id: uuid,
        lines: z
          .array(
            z.object({
              account_code: z.string(),
              period_start: isoDate,
              period_end: isoDate,
              amount: z.number(),
              note: z.string().optional(),
            }),
          )
          .min(1),
      }),
      async run(backend, args) {
        const companyIdValue = args['company_id'] as unknown as string;
        const budgetIdValue = args['budget_id'] as unknown as string;
        const lines = args['lines'] as unknown as {
          account_code: string;
          period_start: string;
          period_end: string;
          amount: number;
          note?: string;
        }[];

        const codes = [...new Set(lines.map((line) => line.account_code))];
        const accounts = await backend.select<{ id: string; code: string }>({
          table: 'accounts',
          columns: ['id', 'code'],
          where: [
            { column: 'company_id', op: 'eq', value: companyIdValue },
            { column: 'code', op: 'in', value: codes },
          ],
        });
        const byCode = new Map(accounts.map((account) => [account.code, account.id]));
        const missing = codes.filter((code) => !byCode.has(code));
        if (missing.length > 0) {
          throw new EkwoMcpError(
            `unknown_account: ${missing.join(', ')} — not an account of this company. Use list_accounts to find the right code.`,
          );
        }

        return inSchema('budgets', async () => {
          for (const line of lines) {
            await backend.remove(
              'lines',
              [
                { column: 'budget_id', op: 'eq', value: budgetIdValue },
                { column: 'account_id', op: 'eq', value: byCode.get(line.account_code) as string },
                { column: 'period_start', op: 'eq', value: line.period_start },
                { column: 'period_end', op: 'eq', value: line.period_end },
              ],
              'budgets',
            );
          }
          const written = await backend.insert<Row>(
            'lines',
            lines.map((line) => ({
              budget_id: budgetIdValue,
              company_id: companyIdValue,
              account_id: byCode.get(line.account_code) as string,
              period_start: line.period_start,
              period_end: line.period_end,
              amount: line.amount,
              note: line.note ?? null,
            })),
            ['id'],
            'budgets',
          );
          return { written: written.length };
        });
      },
    },
    {
      verb: 'variance',
      title: 'Budget against ledger',
      readOnly: true,
      description:
        'What was planned against what was booked, per account, over a period. Both figures are in the sign a business states them in, and the variance is the actual less the plan — so a negative figure on an income account is revenue that did not arrive, and a positive one on a cost account is overspending. It reads posted entries of kind `normal`: a closing or appropriation entry is not what a period earned. A budget line is taken whole or not at all, so ask for a window that contains the periods the budget was written in.',
      input: z.object({
        company_id: companyId,
        budget_id: uuid,
        from: isoDate,
        to: isoDate,
      }),
      async run(backend, args) {
        const rows = await inSchema('budgets', () =>
          backend.rpc<Row>(
            'variance',
            {
              p_company_id: args['company_id'],
              p_budget_id: args['budget_id'],
              p_from: args['from'],
              p_to: args['to'],
            },
            'budgets',
          ),
        );
        return {
          from: args['from'],
          to: args['to'],
          lines: rows.map((row) => ({
            ...row,
            budget: money(row['budget']),
            actual: money(row['actual']),
            variance: money(row['variance']),
          })),
        };
      },
    },
  ],
};

/** Every module this release knows how to expose, by module code. */
export const MODULE_TOOLSETS: readonly ModuleToolset[] = [ASSETS, BUDGETS];

/** The toolsets for a set of installed module codes, in a fixed order. */
export function toolsetsFor(installed: readonly string[]): ModuleToolset[] {
  const wanted = new Set(installed);
  return MODULE_TOOLSETS.filter((toolset) => wanted.has(toolset.code));
}

/**
 * Which modules this installation carries.
 *
 * `public.modules` is the registry, and it is readable by anyone signed in —
 * it says what exists here, not what any company holds. A database that
 * predates the module framework has no such table, and the answer is then no
 * modules rather than an error.
 */
export async function installedModules(backend: Backend): Promise<string[]> {
  try {
    const rows = await backend.select<{ code: string; status: string }>({
      table: 'modules',
      columns: ['code', 'status'],
      order: [{ column: 'code' }],
    });
    return rows.filter((row) => row.status !== 'draft').map((row) => row.code);
  } catch {
    return [];
  }
}
