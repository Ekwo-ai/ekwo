import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshDatabase, migrationFiles, one, rows, seedFiles } from './helpers/db.js';
import { ACCOUNT_TYPES, internalGroup } from '../packages/core/src/types.js';
import { newCompany, newContact, newDocument } from './helpers/factory.js';

let db: PGlite;

beforeAll(async () => {
  db = await freshDatabase();
});

afterAll(async () => {
  await db.close();
});

describe('migrations', () => {
  it('are timestamped and ordered', async () => {
    const files = await migrationFiles();
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(file).toMatch(/^\d{14}_[a-z0-9_]+\.sql$/);
    }
    expect([...files].sort()).toEqual(files);
  });

  it('create every table of the core model', async () => {
    const tables = (
      await rows<{ tablename: string }>(
        db,
        `select tablename from pg_tables where schemaname = 'public' order by 1`,
      )
    ).map((t) => t.tablename);

    for (const expected of [
      'instance', 'instance_admins',
      'companies', 'company_members', 'fiscal_years',
      'accounts', 'journals', 'journal_sequences',
      'contacts', 'taxes', 'tax_postings',
      'entries', 'entry_lines',
      'documents', 'document_lines', 'products',
      'payments', 'reconciliations',
      'bank_accounts', 'bank_statements', 'bank_transactions',
      'currencies', 'currency_rates',
      'analytic_axes', 'analytic_values', 'entry_line_analytics',
      'attachments',
      'account_templates', 'journal_templates', 'tax_templates',
      'tax_posting_templates', 'country_defaults',
      'tax_report_templates', 'tax_report_box_templates',
      'modules', 'company_modules',
    ]) {
      expect(tables).toContain(expected);
    }
  });

  it('expose the accounting functions', async () => {
    const functions = (
      await rows<{ proname: string }>(
        db,
        `select p.proname from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' order by 1`,
      )
    ).map((f) => f.proname);

    for (const expected of [
      'post_document', 'post_entry', 'next_entry_number', 'assert_period_open',
      'reconcile', 'unreconcile', 'next_matching_number',
      'trial_balance', 'general_ledger', 'aged_balance', 'vat_return', 'fec_lines',
      'evaluate_totals', 'financial_statement', 'unmapped_accounts', 'available_statements',
      'install_country_template', 'account_id_by_code', 'commercial_entity',
      'init_instance', 'claim_instance_admin', 'register_instance', 'unregister_instance',
      'is_instance_admin', 'is_any_company_member', 'ekwo_schema_version',
      'enable_module', 'disable_module', 'module_enabled', 'module_is_enabled',
      'post_module_entry', 'module_entry_id',
    ]) {
      expect(functions).toContain(expected);
    }
  });
});

describe('account types', () => {
  it('has the same eighteen values in the database and in TypeScript', async () => {
    const values = (
      await rows<{ label: string }>(
        db,
        `select e.enumlabel as label from pg_enum e
           join pg_type t on t.oid = e.enumtypid
          where t.typname = 'account_type' order by e.enumsortorder`,
      )
    ).map((v) => v.label);

    expect(values).toHaveLength(18);
    expect(values).toEqual([...ACCOUNT_TYPES]);
  });

  it('derives the same balance-sheet group on both sides', async () => {
    const derived = await rows<{ account_type: string; internal_group: string }>(
      db,
      `select distinct account_type::text, internal_group from accounts order by 1`,
    );
    expect(derived.length).toBeGreaterThan(5);
    for (const row of derived) {
      expect(internalGroup(row.account_type as (typeof ACCOUNT_TYPES)[number])).toBe(
        row.internal_group,
      );
    }
  });
});

describe('country templates', () => {
  it('seeds Belgium and France', async () => {
    const files = await seedFiles();
    expect(files.length).toBeGreaterThan(0);

    const counts = await rows<{ country: string; count: number }>(
      db,
      `select country, count(*)::int as count from account_templates group by 1 order by 1`,
    );
    const byCountry = Object.fromEntries(counts.map((c) => [c.country, Number(c.count)]));
    expect(byCountry['BE']).toBeGreaterThan(150);
    expect(byCountry['FR']).toBeGreaterThan(150);
  });

  it('leaves no template account pointing at a parent that does not exist', async () => {
    const orphans = await rows(
      db,
      `select t.country, t.code from account_templates t
        where t.parent_code is not null
          and not exists (select 1 from account_templates p
                           where p.country = t.country and p.code = t.parent_code)`,
    );
    expect(orphans).toEqual([]);
  });

  it('leaves no tax posting pointing at an account that does not exist', async () => {
    const orphans = await rows(
      db,
      `select tp.account_code from tax_posting_templates tp
         join tax_templates t on t.id = tp.tax_template_id
        where tp.account_code is not null
          and not exists (select 1 from account_templates a
                           where a.country = t.country and a.code = tp.account_code)`,
    );
    expect(orphans).toEqual([]);
  });

  it('wires the company roles when installed', async () => {
    const fx = await newCompany(db, { country: 'FR', name: 'Societe Test SAS' });
    const company = await one<{ receivable: string; payable: string; sales: string }>(
      db,
      `select a.code as receivable, b.code as payable, j.code as sales
         from companies c
         join accounts a on a.id = c.receivable_account_id
         join accounts b on b.id = c.payable_account_id
         join journals j on j.id = c.sales_journal_id
        where c.id = $1`,
      [fx.companyId],
    );
    expect(company.receivable).toBe('411000');
    expect(company.payable).toBe('401000');
    expect(company.sales).toBe('SAL');
  });

  it('points the financial journals at their account, per country', async () => {
    // `post_payment` looks for the bank side on the journal's default account
    // when the payment names no bank account. Before this was wired, a freshly
    // installed company refused the first payment with `no_bank_account` and
    // the operator had to discover `journals.default_account_id` themselves.
    const fr = await newCompany(db, { country: 'FR', name: 'Journaux SAS' });
    const be = await newCompany(db, { country: 'BE', name: 'Journaux SRL' });

    const wired = async (companyId: string): Promise<Record<string, string | null>> => {
      const found = await rows<{ code: string; account: string | null }>(
        db,
        `select j.code, a.code as account
           from journals j
           left join accounts a on a.id = j.default_account_id
          where j.company_id = $1 and j.journal_type in ('bank', 'cash')
          order by j.code`,
        [companyId],
      );
      return Object.fromEntries(found.map((row) => [row.code, row.account]));
    };

    expect(await wired(fr.companyId)).toEqual({ BNK: '512000', CSH: '530000' });
    expect(await wired(be.companyId)).toEqual({ BNK: '550000', CSH: '570000' });
  });

  it('leaves a default account the company already chose', async () => {
    const fx = await newCompany(db, { country: 'BE', name: 'Choix SRL' });
    await db.query(
      `update journals set default_account_id = account_id_by_code($1, '550100')
        where company_id = $1 and code = 'BNK'`,
      [fx.companyId],
    );
    await db.query(`select install_country_template($1, 'BE')`, [fx.companyId]);

    const journal = await one<{ account: string }>(
      db,
      `select a.code as account from journals j join accounts a on a.id = j.default_account_id
        where j.company_id = $1 and j.code = 'BNK'`,
      [fx.companyId],
    );
    expect(journal.account).toBe('550100');
  });

  it('books a French 20 % invoice on the French chart', async () => {
    const fx = await newCompany(db, { country: 'FR', name: 'Autre SAS' });
    await db.query(
      `insert into fiscal_years (company_id, name, start_date, end_date)
       values ($1, 'Exercice 2027', date '2027-01-01', date '2027-12-31')`,
      [fx.companyId],
    );
    const customer = await newContact(db, fx.companyId, { name: 'Client FR', country: 'FR' });
    const doc = await newDocument(db, fx.companyId, {
      docType: 'sale_invoice',
      number: 'FA-001',
      contactId: customer,
      date: '2026-05-05',
      lines: [{ unitPrice: 1000, taxCode: 'FR-S-20', accountCode: '706000' }],
    });
    await db.query(`select post_document($1)`, [doc]);

    const lines = await rows<{ code: string; debit: string; credit: string; box: string | null }>(
      db,
      `select a.code, l.debit, l.credit, l.declaration_box as box
         from entry_lines l
         join accounts a on a.id = l.account_id
         join entries e on e.id = l.entry_id
        where e.document_id = $1 order by l.sequence`,
      [doc],
    );
    expect(lines).toEqual([
      { code: '706000', debit: '0.00', credit: '1000.00', box: '08' },
      { code: '445710', debit: '0.00', credit: '200.00', box: '08' },
      { code: '411000', debit: '1200.00', credit: '0.00', box: null },
    ]);
  });
});

// ---------------------------------------------------------------------------
// The audit of 13 September 2026: 85 foreign keys had no index.
//
// Postgres indexes the referenced side of a foreign key and nothing on the
// referencing side, so every delete of a parent and every join written the
// natural way read the whole child table. On the demo company nothing is
// slow, which is why it survived 49 migrations.
//
// The question is asked of the catalogue rather than of a list kept by hand:
// a foreign key added tomorrow arrives with its index, or this fails.
// ---------------------------------------------------------------------------

describe('every foreign key', () => {
  it('has an index that leads with its columns', async () => {
    const missing = await rows<{ schema_name: string; table_name: string; columns: string }>(
      db,
      `select n.nspname as schema_name, t.relname as table_name,
              (select string_agg(a.attname, ', ' order by x.ord)
                 from unnest(c.conkey) with ordinality x(attnum, ord)
                 join pg_attribute a
                   on a.attrelid = c.conrelid and a.attnum = x.attnum) as columns
         from pg_constraint c
         join pg_class t on t.oid = c.conrelid
         join pg_namespace n on n.oid = t.relnamespace
        where c.contype = 'f'
          and n.nspname not in ('pg_catalog', 'information_schema', 'auth')
          and not exists (
            select 1 from pg_index i
             where i.indrelid = c.conrelid
               and (i.indkey::int2[])[0:array_length(c.conkey, 1) - 1] = c.conkey::int2[]
          )
        order by 1, 2, 3`,
    );
    expect(
      missing.map((m) => `${m.schema_name}.${m.table_name} (${m.columns})`),
      'these foreign keys have no index: add one in the migration that added the key',
    ).toEqual([]);
  });

  it('leaves no company_id without one either', async () => {
    // Every policy of this schema filters on `company_id`, so a table that
    // carries one and does not index it is a table every read scans.
    const missing = await rows<{ schema_name: string; table_name: string }>(
      db,
      `select n.nspname as schema_name, c.relname as table_name
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
         join pg_attribute a
           on a.attrelid = c.oid and a.attname = 'company_id' and a.attnum > 0
        where c.relkind = 'r'
          and n.nspname not in ('pg_catalog', 'information_schema', 'auth')
          and not exists (
            select 1 from pg_index i
             where i.indrelid = c.oid and (i.indkey::int2[])[0] = a.attnum
          )
        order by 1, 2`,
    );
    expect(missing.map((m) => `${m.schema_name}.${m.table_name}`)).toEqual([]);
  });
});
