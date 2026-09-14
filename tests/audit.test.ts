/**
 * The audit trail.
 *
 * Three claims are made here and each has its own group. The trail records
 * what was changed and by whom, on every table that decides how a future
 * entry is booked. It records the *acts* — posted, cancelled, reversed,
 * matched, closed — without recording the ledger itself. And it is
 * append-only for everybody, table owner included, which is the part a policy
 * alone cannot give.
 */

import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, expectError, freshDatabase, one, rows } from './helpers/db.js';
import {
  accountId,
  newCompany,
  newContact,
  newDocument,
  newInstanceAdmin,
  newUser,
  taxId,
} from './helpers/factory.js';

let db: PGlite;
let companyId: string;
let ownerId: string;

interface AuditRow {
  table_name: string;
  record_key: string;
  operation: string;
  action: string | null;
  actor_id: string | null;
  company_id: string | null;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
}

/** The trail of this company, newest last, as the owner sees it. */
async function trail(where = '', params: unknown[] = []): Promise<AuditRow[]> {
  return rows<AuditRow>(
    db,
    `select table_name, record_key, operation, action, actor_id, company_id,
            old_values, new_values
       from audit_log
      where company_id = $1 ${where}
      order by id`,
    [companyId, ...params],
  );
}

beforeAll(async () => {
  db = await freshDatabase();
  ({ companyId, ownerId } = await newCompany(db));
  await db.query(`insert into auth.users (id, email) values ($1, $2)`, [
    ownerId,
    'owner@example.test',
  ]);
}, 120_000);

afterAll(async () => {
  await db.close();
});

describe('what the trail records', () => {
  it('records an account created by a person, with who and what', async () => {
    await asUser(db, ownerId, async () => {
      await db.query(
        `insert into accounts (company_id, code, name, account_type)
         values ($1, '999001', 'Compte de test', 'expense')`,
        [companyId],
      );
    });

    const written = await trail(`and table_name = 'accounts' and record_key = '999001'`);
    expect(written).toHaveLength(1);
    expect(written[0]?.operation).toBe('insert');
    expect(written[0]?.actor_id).toBe(ownerId);
    expect(written[0]?.old_values).toBeNull();
    expect(written[0]?.new_values?.['name']).toBe('Compte de test');
  });

  it('records both sides of a change to the chart of accounts', async () => {
    await asUser(db, ownerId, async () => {
      await db.query(`update accounts set name = 'Renommé' where company_id = $1 and code = '999001'`, [
        companyId,
      ]);
    });

    const written = await trail(`and table_name = 'accounts' and record_key = '999001'`);
    expect(written).toHaveLength(2);
    expect(written[1]?.operation).toBe('update');
    expect(written[1]?.old_values?.['name']).toBe('Compte de test');
    expect(written[1]?.new_values?.['name']).toBe('Renommé');
  });

  it('writes nothing for an update that changed nothing', async () => {
    const before = (await trail(`and table_name = 'accounts' and record_key = '999001'`)).length;
    await asUser(db, ownerId, async () => {
      await db.query(`update accounts set name = 'Renommé' where company_id = $1 and code = '999001'`, [
        companyId,
      ]);
    });
    const after = (await trail(`and table_name = 'accounts' and record_key = '999001'`)).length;
    expect(after).toBe(before);
  });

  it('records a deletion, keeping the row that is gone', async () => {
    await asUser(db, ownerId, async () => {
      await db.query(`delete from accounts where company_id = $1 and code = '999001'`, [companyId]);
    });

    const written = await trail(`and table_name = 'accounts' and record_key = '999001'`);
    expect(written.at(-1)?.operation).toBe('delete');
    expect(written.at(-1)?.new_values).toBeNull();
    expect(written.at(-1)?.old_values?.['name']).toBe('Renommé');
  });

  it('covers every table of a company that decides how an entry is booked', async () => {
    const bank = await accountId(db, companyId, '550000');
    const journal = await one<{ id: string }>(
      db,
      `select id from journals where company_id = $1 and code = 'BNK'`,
      [companyId],
    );
    const stranger = await newUser(db);

    await asUser(db, ownerId, async () => {
      await db.query(`update journals set name = 'Banque principale' where company_id = $1 and code = 'BNK'`, [companyId]);
      await db.query(`update taxes set description = 'revue' where company_id = $1 and code = 'BE-S-21'`, [companyId]);
      await db.query(
        `update tax_postings set sequence = sequence where company_id = $1 and tax_id = $2`,
        [companyId, await taxId(db, companyId, 'BE-S-21')],
      );
      await db.query(
        `insert into contacts (company_id, name, contact_type, country)
         values ($1, 'Nouveau client', 'customer', 'BE')`,
        [companyId],
      );
      await db.query(
        `insert into products (company_id, code, name) values ($1, 'P-AUDIT', 'Produit')`,
        [companyId],
      );
      await db.query(
        `insert into bank_accounts (company_id, name, iban, account_id, journal_id)
         values ($1, 'Compte courant', 'BE00000000000001', $2, $3)`,
        [companyId, bank, journal.id],
      );
      await db.query(`update companies set name = 'Renamed Company' where id = $1`, [companyId]);
      await db.query(
        `insert into company_members (company_id, user_id, role) values ($1, $2, 'viewer')`,
        [companyId, stranger],
      );
      await db.query(
        `insert into fiscal_years (company_id, name, start_date, end_date)
         values ($1, 'Exercice 2027', date '2027-01-01', date '2027-12-31')`,
        [companyId],
      );
    });

    const tables = new Set((await trail()).map((row) => row.table_name));
    for (const table of [
      'accounts',
      'journals',
      'taxes',
      'contacts',
      'products',
      'bank_accounts',
      'companies',
      'company_members',
      'fiscal_years',
    ]) {
      expect(tables, `${table} is audited`).toContain(table);
    }
  });

  it('never copies a secret into the trail', async () => {
    await asUser(db, ownerId, async () => {
      await db.query(`select create_api_key($1, 'Robot', '["documents.read"]'::jsonb)`, [companyId]);
    });

    const written = await trail(`and table_name = 'api_keys'`);
    expect(written).toHaveLength(1);
    expect(written[0]?.new_values).toHaveProperty('key_hash');
    expect(written[0]?.new_values?.['key_hash']).toBeNull();
    expect(written[0]?.new_values?.['name']).toBe('Robot');
  });

  it('leaves the installer alone: a country pack is one row, not a thousand', async () => {
    const { companyId: otherId } = await newCompany(db, { name: 'Installed by the CLI' });
    const written = await rows<AuditRow>(
      db,
      `select table_name, record_key, operation, action, actor_id, company_id,
              old_values, new_values
         from audit_log where company_id = $1`,
      [otherId],
    );
    expect(written).toHaveLength(0);

    const accounts = await one<{ count: string }>(
      db,
      `select count(*)::text as count from accounts where company_id = $1`,
      [otherId],
    );
    expect(Number(accounts.count)).toBeGreaterThan(100);
  });
});

describe('the acts', () => {
  let documentId: string;

  it('records that a document was posted, and the entry it produced', async () => {
    const contactId = await newContact(db, companyId);
    documentId = await newDocument(db, companyId, {
      docType: 'sale_invoice',
      contactId,
      lines: [{ unitPrice: 1000, accountCode: '700000', taxCode: 'BE-S-21' }],
    });

    await asUser(db, ownerId, async () => {
      await db.query(`select post_document($1)`, [documentId]);
    });

    const posted = (await trail(`and action = 'document_posted'`)).at(-1);
    expect(posted?.table_name).toBe('documents');
    expect(posted?.old_values?.['state']).toBe('draft');
    expect(posted?.new_values?.['state']).toBe('posted');
    expect(posted?.new_values?.['entry_id']).not.toBeNull();
    expect(posted?.actor_id).toBe(ownerId);

    const entry = (await trail(`and action = 'entry_posted'`)).at(-1);
    expect(entry?.table_name).toBe('entries');
    expect(entry?.new_values?.['kind']).toBe('normal');
  });

  it('records that a document was cancelled', async () => {
    const contactId = await newContact(db, companyId, { name: 'Cancelled' });
    const draft = await newDocument(db, companyId, {
      docType: 'sale_invoice',
      contactId,
      lines: [{ unitPrice: 10, accountCode: '700000' }],
    });
    await asUser(db, ownerId, async () => {
      await db.query(`update documents set state = 'cancelled' where id = $1`, [draft]);
    });

    const cancelled = (await trail(`and action = 'document_cancelled'`)).at(-1);
    expect(cancelled?.table_name).toBe('documents');
    expect(cancelled?.new_values?.['state']).toBe('cancelled');
  });

  it('records a payment booked and the matching that follows, then its undoing', async () => {
    const bankJournal = await one<{ id: string }>(
      db,
      `select id from journals where company_id = $1 and code = 'BNK'`,
      [companyId],
    );
    const contactId = await one<{ contact_id: string }>(
      db,
      `select contact_id from documents where id = $1`,
      [documentId],
    );
    const total = await one<{ amount_total: string }>(
      db,
      `select amount_total::text from documents where id = $1`,
      [documentId],
    );

    let paymentId = '';
    let reconciliationId = '';
    await asUser(db, ownerId, async () => {
      const payment = await one<{ id: string }>(
        db,
        `insert into payments (company_id, direction, payment_date, amount, currency_code,
                               contact_id, journal_id)
         values ($1, 'inbound', date '2026-06-30', $2,
                 (select currency_code from companies where id = $1), $3, $4)
         returning id`,
        [companyId, total.amount_total, contactId.contact_id, bankJournal.id],
      );
      paymentId = payment.id;
      await db.query(`select post_payment($1)`, [paymentId]);

      const receivable = await one<{ id: string }>(
        db,
        `select l.id from entry_lines l
           join entries e on e.id = l.entry_id
          where e.document_id = $1 and l.debit > 0
          order by l.sequence limit 1`,
        [documentId],
      );
      const credit = await one<{ id: string }>(
        db,
        `select l.id from entry_lines l
           join entries e on e.id = l.entry_id
           join payments p on p.entry_id = e.id
          where p.id = $1 and l.credit > 0
          order by l.sequence limit 1`,
        [paymentId],
      );
      const matched = await one<{ id: string }>(
        db,
        `select (reconcile($1, $2, $3)).id`,
        [receivable.id, credit.id, total.amount_total],
      );
      reconciliationId = matched.id;
    });

    expect((await trail(`and action = 'payment_posted'`)).at(-1)?.table_name).toBe('payments');
    expect((await trail(`and action = 'payment_reconciled'`)).at(-1)?.operation).toBe('insert');

    await asUser(db, ownerId, async () => {
      await db.query(`select unreconcile($1)`, [reconciliationId]);
    });

    const undone = (await trail(`and action = 'payment_unreconciled'`)).at(-1);
    expect(undone?.operation).toBe('delete');
    expect(undone?.old_values?.['id']).toBe(reconciliationId);
  });

  it('records a financial year closed and reopened, and the reversal that reopening writes', async () => {
    const year = await one<{ id: string }>(
      db,
      `select id from fiscal_years where company_id = $1 and name = 'Exercice 2026'`,
      [companyId],
    );

    await asUser(db, ownerId, async () => {
      await db.query(`select close_fiscal_year($1)`, [year.id]);
    });
    const closed = (await trail(`and action = 'fiscal_year_closed'`)).at(-1);
    expect(closed?.table_name).toBe('fiscal_years');
    expect(closed?.record_key).toBe('Exercice 2026');

    await asUser(db, ownerId, async () => {
      await db.query(`select reopen_fiscal_year($1)`, [year.id]);
    });
    expect((await trail(`and action = 'fiscal_year_reopened'`)).at(-1)?.record_key).toBe(
      'Exercice 2026',
    );
    // Reopening reverses the entries the close wrote; a reversal is its own act
    // and is not called "posted".
    expect((await trail(`and action = 'entry_reversed'`)).length).toBeGreaterThan(0);
  });

  it('does not record the content of the ledger', async () => {
    const written = await trail();
    expect(written.map((row) => row.table_name)).not.toContain('entry_lines');
    for (const row of written.filter((r) => r.table_name === 'entries')) {
      expect(Object.keys(row.new_values ?? {}).sort()).toEqual([
        'entry_date',
        'kind',
        'number',
        'reversed_entry_id',
        'state',
      ]);
    }
  });
});

describe('who may read it', () => {
  it('is readable by a member of the company', async () => {
    const seen = await asUser(db, ownerId, async () =>
      rows<{ count: string }>(db, `select count(*)::text as count from audit_log`),
    );
    expect(Number(seen[0]?.count)).toBeGreaterThan(0);
  });

  it('shows a signed-in stranger nothing at all', async () => {
    const stranger = await newUser(db);
    const seen = await asUser(db, stranger, async () =>
      rows<{ count: string }>(db, `select count(*)::text as count from audit_log`),
    );
    expect(seen[0]?.count).toBe('0');
  });

  it('is not even readable by the anonymous role: no grant, no policy to read', async () => {
    const message = await asUser(
      db,
      '00000000-0000-0000-0000-000000000000',
      () => expectError(db, `select count(*) from audit_log`),
      'anon',
    );
    expect(message).toMatch(/permission denied for table audit_log/);
  });

  it('keeps the rows of the installation itself for an instance administrator', async () => {
    const admin = await newInstanceAdmin(db);
    const member = await asUser(db, ownerId, async () =>
      rows<{ count: string }>(
        db,
        `select count(*)::text as count from audit_log where company_id is null`,
      ),
    );
    expect(member[0]?.count).toBe('0');

    const seen = await asUser(db, admin, async () =>
      rows<{ count: string }>(
        db,
        `select count(*)::text as count from audit_log where company_id is null`,
      ),
    );
    expect(Number(seen[0]?.count)).toBeGreaterThan(0);
  });
});

describe('append-only', () => {
  it('refuses a member an update and a delete, at the privilege', async () => {
    // Two layers say no, and this is the outer one. `20260914151207` grants
    // `authenticated` SELECT on `audit_log` and nothing else, so the statement
    // never reaches the policies — which have no INSERT, UPDATE or DELETE of
    // their own either. The trigger below is the third, and the one that holds
    // for the roles no policy applies to.
    const before = await one<{ count: string }>(db, `select count(*)::text as count from audit_log`);
    await asUser(db, ownerId, async () => {
      expect(
        await expectError(db, `update audit_log set action = 'rewritten' where company_id = $1`, [
          companyId,
        ]),
      ).toMatch(/permission denied for table audit_log/);
      expect(
        await expectError(db, `delete from audit_log where company_id = $1`, [companyId]),
      ).toMatch(/permission denied for table audit_log/);
    });
    const after = await one<{ count: string }>(db, `select count(*)::text as count from audit_log`);
    expect(after.count).toBe(before.count);
    const rewritten = await one<{ count: string }>(
      db,
      `select count(*)::text as count from audit_log where action = 'rewritten'`,
    );
    expect(rewritten.count).toBe('0');
  });

  it('refuses an update and a delete to the table owner too', async () => {
    expect(await expectError(db, `update audit_log set action = 'rewritten'`)).toContain(
      'audit_log_append_only',
    );
    expect(await expectError(db, `delete from audit_log`)).toContain('audit_log_append_only');
  });

  it('refuses a delete to service_role, which bypasses row level security', async () => {
    // On Supabase `service_role` holds the table grants and BYPASSRLS, so no
    // policy can stop it. The test harness does not grant it, so the grant is
    // made here first: what is under test is the trigger, not the grant.
    await db.exec(`grant select, delete on audit_log to service_role;`);
    const message = await asUser(
      db,
      '00000000-0000-0000-0000-000000000000',
      async () => expectError(db, `delete from audit_log`),
      'service_role',
    );
    expect(message).toContain('audit_log_append_only');
  });
});

describe('the purge', () => {
  it('is closed to the anonymous role and to a signed-in user', async () => {
    const anonymous = await asUser(
      db,
      ownerId,
      async () => expectError(db, `select purge_audit_log(current_date - 1)`),
      'anon',
    );
    expect(anonymous).toMatch(/permission denied for function/);

    // `freshDatabase` grants execute on every function to `authenticated` so
    // that the policy tests can call the schema; that blanket grant is the
    // harness's, not the migration's. This puts back what the migration
    // leaves behind, and then asks.
    await db.exec(`revoke execute on function purge_audit_log(date) from authenticated;`);
    const member = await asUser(db, ownerId, async () =>
      expectError(db, `select purge_audit_log(current_date - 1)`),
    );
    expect(member).toMatch(/permission denied for function/);
  });

  it('refuses a date it was not given, and one in the future', async () => {
    expect(await expectError(db, `select purge_audit_log(null)`)).toContain(
      'audit_purge_needs_a_date',
    );
    expect(await expectError(db, `select purge_audit_log(current_date + 1)`)).toContain(
      'audit_purge_in_the_future',
    );
  });

  it('drops what is older than the date it is given, and records that it did', async () => {
    const kept = await one<{ count: string }>(db, `select count(*)::text as count from audit_log`);

    // A row from before the cutoff. `occurred_at` defaults to now(), so the
    // only way to have an old one here is to write it old — which the
    // append-only trigger allows, because it is an insert.
    await db.query(
      `insert into audit_log (occurred_at, company_id, table_name, record_key, operation)
       values (now() - interval '400 days', $1, 'accounts', '999999', 'insert')`,
      [companyId],
    );

    const dropped = await one<{ purge_audit_log: string }>(
      db,
      `select purge_audit_log((current_date - 30)::date)`,
    );
    expect(Number(dropped.purge_audit_log)).toBe(1);

    const after = await one<{ count: string }>(db, `select count(*)::text as count from audit_log`);
    // Everything that was there stays, and the purge wrote its own row.
    expect(Number(after.count)).toBe(Number(kept.count) + 1);
    const purged = await one<{ action: string; new_values: Record<string, unknown> }>(
      db,
      `select action, new_values from audit_log order by id desc limit 1`,
    );
    expect(purged.action).toBe('audit_log_purged');
    expect(purged.new_values['rows']).toBe(1);
  });
});
