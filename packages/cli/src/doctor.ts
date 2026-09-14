/**
 * `ekwo doctor` — the checks worth running on a live installation.
 *
 * Each one is something that is true of a healthy database and that nothing
 * in the schema can enforce on its own: a table someone added without row
 * level security, a migration that never landed, a membership row pointing at
 * a user who has since been deleted, a bank statement whose declared closing
 * balance does not match its lines.
 *
 * The doctor reads and reports. It never repairs: the fix for a missing
 * policy is a migration, and the fix for an orphaned membership is a decision
 * about who should have access, not a delete the installer guesses at.
 */

import type { Migration } from './migrations.js';
import { migrationGap } from './migrations.js';
import type { SqlClient } from './sql.js';
import { scalar } from './sql.js';

export type Severity = 'ok' | 'warning' | 'problem';

export interface Check {
  name: string;
  severity: Severity;
  summary: string;
  /** Lines of evidence, printed under the summary. */
  details?: string[];
}

export interface DoctorReport {
  checks: Check[];
  problems: number;
  warnings: number;
}

export async function doctor(db: SqlClient, migrations: Migration[]): Promise<DoctorReport> {
  const checks: Check[] = [];

  checks.push(await checkMigrations(db, migrations));
  checks.push(await checkRowLevelSecurity(db));
  checks.push(await checkPolicies(db));
  checks.push(await checkOrphanMembers(db));
  checks.push(await checkOrphanAdmins(db));
  checks.push(await checkBankAccounts(db));
  checks.push(await checkStatements(db));
  checks.push(await checkPostedEntriesBalance(db));
  checks.push(await checkAuditTrail(db));

  return {
    checks,
    problems: checks.filter((c) => c.severity === 'problem').length,
    warnings: checks.filter((c) => c.severity === 'warning').length,
  };
}

async function checkMigrations(db: SqlClient, migrations: Migration[]): Promise<Check> {
  const gap = await migrationGap(db, migrations);
  if (gap.unknown.length > 0) {
    return {
      name: 'migrations',
      severity: 'warning',
      summary: `the database is ahead of this CLI by ${gap.unknown.length} migration(s)`,
      details: gap.unknown.map((v) => `${v} is applied but not shipped here — upgrade the CLI`),
    };
  }
  if (gap.pending.length > 0) {
    return {
      name: 'migrations',
      severity: 'problem',
      summary: `${gap.pending.length} migration(s) pending`,
      details: gap.pending.map((m) => m.file),
    };
  }
  return {
    name: 'migrations',
    severity: 'ok',
    summary: `${gap.applied.length} applied, none pending`,
  };
}

async function checkRowLevelSecurity(db: SqlClient): Promise<Check> {
  const rows = await db.query<{ tablename: string }>(
    `select c.relname as tablename
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
      order by c.relname`,
  );
  if (rows.length === 0) {
    return { name: 'row level security', severity: 'ok', summary: 'enabled on every table' };
  }
  return {
    name: 'row level security',
    severity: 'problem',
    summary: `${rows.length} table(s) without row level security`,
    details: rows.map((r) => r.tablename),
  };
}

async function checkPolicies(db: SqlClient): Promise<Check> {
  const rows = await db.query<{ tablename: string }>(
    `select c.relname as tablename
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
        and not exists (select 1 from pg_policy p where p.polrelid = c.oid)
      order by c.relname`,
  );
  if (rows.length === 0) {
    return { name: 'policies', severity: 'ok', summary: 'every protected table has a policy' };
  }
  return {
    name: 'policies',
    severity: 'problem',
    summary: `${rows.length} table(s) with row level security and no policy — nobody can read them`,
    details: rows.map((r) => r.tablename),
  };
}

/**
 * `company_members` deliberately has no foreign key to `auth.users`: inviting
 * someone into a company before they have an account is a normal thing to
 * want. The price is that deleting a user leaves a row behind, and this is
 * where that price is paid.
 */
async function checkOrphanMembers(db: SqlClient): Promise<Check> {
  const rows = await db.query<{ company: string; user_id: string }>(
    `select c.name as company, m.user_id
       from company_members m
       join companies c on c.id = m.company_id
      where not exists (select 1 from auth.users u where u.id = m.user_id)
      order by c.name`,
  );
  if (rows.length === 0) {
    return {
      name: 'company members',
      severity: 'ok',
      summary: 'every membership points at a real user',
    };
  }
  return {
    name: 'company members',
    severity: 'warning',
    summary: `${rows.length} membership row(s) whose user no longer exists in Supabase Auth`,
    details: [
      ...rows.map((r) => `${r.company}: ${r.user_id}`),
      'These grant nothing — auth.uid() can never match them — but they misreport who has access.',
      'Delete them, or re-invite the person, once you know which it should be.',
    ],
  };
}

async function checkOrphanAdmins(db: SqlClient): Promise<Check> {
  const rows = await db.query<{ user_id: string }>(
    `select a.user_id from instance_admins a
      where not exists (select 1 from auth.users u where u.id = a.user_id)`,
  );
  if (rows.length === 0) {
    const count = await scalar<string>(db, 'select count(*)::text from instance_admins');
    return {
      name: 'instance administrators',
      severity: count === '0' ? 'warning' : 'ok',
      summary:
        count === '0'
          ? 'no administrator: nobody can create a company here'
          : `${count ?? '0'} administrator(s), all real users`,
    };
  }
  return {
    name: 'instance administrators',
    severity: 'problem',
    summary: `${rows.length} administrator(s) whose user no longer exists`,
    details: [
      ...rows.map((r) => r.user_id),
      'The foreign key to auth.users should have cascaded these away. Check that it is still there.',
    ],
  };
}

/**
 * A company with no bank account has nowhere for a payment to land.
 *
 * `post_payment` resolves the money side from the payment's bank account, or
 * from the default account of its journal — and the country template wires
 * that second one, so this is never an error. It is the configuration an
 * operator meant to finish and did not: without a bank account there is no
 * IBAN on an invoice, no statement to import and nothing to reconcile
 * against. So: a warning, naming the companies and the command that fixes it.
 */
async function checkBankAccounts(db: SqlClient): Promise<Check> {
  const rows = await db.query<{ name: string }>(
    `select c.name
       from companies c
      where not exists (
        select 1 from bank_accounts b where b.company_id = c.id and b.active
      )
      order by c.name`,
  );
  if (rows.length === 0) {
    const count = await scalar<string>(db, 'select count(*)::text from companies');
    return {
      name: 'bank accounts',
      severity: 'ok',
      summary:
        count === '0'
          ? 'no company yet, so nothing to bank'
          : 'every company has at least one bank account',
    };
  }
  return {
    name: 'bank accounts',
    severity: 'warning',
    summary: `${rows.length} company/companies with no bank account`,
    details: [
      ...rows.map((r) => r.name),
      'Payments still book — the bank journal carries a default account — but there is no IBAN to',
      'put on an invoice and no statement to reconcile against.',
      'Add one with `ekwo init --iban …` on the same project, or the create_bank_account tool of the MCP server.',
    ],
  };
}

async function checkStatements(db: SqlClient): Promise<Check> {
  const rows = await db.query<{
    company: string;
    statement_date: string;
    declared: string;
    computed: string;
  }>(
    `select c.name as company, s.statement_date::text,
            s.balance_end_declared::text as declared,
            s.balance_end_computed::text as computed
       from bank_statements s
       join companies c on c.id = s.company_id
      where not s.is_consistent
      order by s.statement_date`,
  );
  if (rows.length === 0) {
    return {
      name: 'bank statements',
      severity: 'ok',
      summary: 'every statement ties to its lines',
    };
  }
  return {
    name: 'bank statements',
    severity: 'warning',
    summary: `${rows.length} statement(s) whose closing balance does not match their lines`,
    details: rows.map(
      (r) => `${r.company} ${r.statement_date}: declared ${r.declared}, lines give ${r.computed}`,
    ),
  };
}

async function checkPostedEntriesBalance(db: SqlClient): Promise<Check> {
  const rows = await db.query<{ number: string | null; entry_date: string }>(
    `select e.number, e.entry_date::text
       from entries e
      where e.state = 'posted' and not e.is_balanced
      order by e.entry_date`,
  );
  if (rows.length === 0) {
    return { name: 'posted entries', severity: 'ok', summary: 'every posted entry balances' };
  }
  return {
    name: 'posted entries',
    severity: 'problem',
    summary: `${rows.length} posted entry/entries do not balance`,
    details: rows.map((r) => `${r.number ?? '(no number)'} on ${r.entry_date}`),
  };
}

/**
 * The audit trail still being what it claims to be.
 *
 * Everything here is read from the catalogue rather than from a list kept by
 * hand: the trail is append-only, so the guard trigger has to be on the table
 * and no policy may let a client write, update or delete a row. A migration
 * added later that put an insert policy on `audit_log` "so the application can
 * log too" would break the one property the table exists for, and nothing else
 * would notice.
 */
async function checkAuditTrail(db: SqlClient): Promise<Check> {
  const installed =
    (await scalar<boolean>(
      db,
      `select exists (
         select 1 from information_schema.tables
          where table_schema = 'public' and table_name = 'audit_log'
       )`,
    )) === true;
  if (!installed) {
    return {
      name: 'audit trail',
      severity: 'problem',
      summary: 'audit_log is not there',
      details: ['The migration that creates it has not been applied. Run `ekwo migrate`.'],
    };
  }

  const faults: string[] = [];

  const guarded = await db.query<{ tgname: string }>(
    `select t.tgname from pg_trigger t
       join pg_class c on c.oid = t.tgrelid
      where c.relname = 'audit_log' and not t.tgisinternal`,
  );
  if (guarded.length === 0) {
    faults.push('no trigger on audit_log: nothing refuses an update or a delete on it any more');
  }

  const rls =
    (await scalar<boolean>(
      db,
      `select relrowsecurity from pg_class where relname = 'audit_log' and relnamespace = 'public'::regnamespace`,
    )) === true;
  if (!rls) faults.push('row level security is off on audit_log: every signed-in user reads every company');

  const writable = await db.query<{ polname: string; cmd: string }>(
    `select p.polname, case p.polcmd
              when 'a' then 'insert' when 'w' then 'update'
              when 'd' then 'delete' when '*' then 'all' else 'select' end as cmd
       from pg_policy p
       join pg_class c on c.oid = p.polrelid
      where c.relname = 'audit_log' and p.polcmd <> 'r'`,
  );
  for (const policy of writable) {
    faults.push(`policy ${policy.polname} allows ${policy.cmd} on audit_log, which is append-only`);
  }

  const purgers = await db.query<{ grantee: string }>(
    `select a.grantee from (
       select (aclexplode(p.proacl)).grantee as grantee
         from pg_proc p
        where p.proname = 'purge_audit_log'
     ) a
     where a.grantee <> 0 and pg_get_userbyid(a.grantee) not in ('service_role', current_user)`,
  );
  for (const grant of purgers) {
    faults.push(`purge_audit_log is executable by a role other than service_role (${grant.grantee})`);
  }

  if (faults.length === 0) {
    const rows = await scalar<string>(db, 'select count(*)::text from audit_log');
    return {
      name: 'audit trail',
      severity: 'ok',
      summary: `append-only, ${rows ?? '0'} row(s) recorded`,
    };
  }
  return {
    name: 'audit trail',
    severity: 'problem',
    summary: `${faults.length} thing(s) the audit trail no longer guarantees`,
    details: faults,
  };
}
