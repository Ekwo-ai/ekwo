import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, expectError, freshDatabase, rows } from './helpers/db.js';
import { newCompany, newInstanceAdmin, newUser } from './helpers/factory.js';

// The audit of 11 September 2026: what can someone who is not a member of any
// company reach? Two answers were wider than they should have been — every
// function was executable by `anon`, and every signed-in user could list the
// administrators. Migration 20260911210131 narrows both; this file keeps them
// narrow.

let db: PGlite;
let companyId: string;
let ownerId: string;
let adminId: string;
let strangerId: string;

beforeAll(async () => {
  db = await freshDatabase();
  ({ companyId, ownerId } = await newCompany(db));
  adminId = await newInstanceAdmin(db);
  strangerId = await newUser(db, 'stranger@example.com');
});

afterAll(async () => {
  await db.close();
});

describe('the anonymous role', () => {
  it('still reads an empty set, because the policy helpers stay executable', async () => {
    const seen = await asUser(db, strangerId, () => rows(db, `select id from documents`), 'anon');
    expect(seen).toEqual([]);
  });

  it('cannot execute a report', async () => {
    const message = await asUser(
      db,
      strangerId,
      () =>
        expectError(db, `select * from trial_balance($1, date '2026-01-01', date '2026-12-31')`, [
          companyId,
        ]),
      'anon',
    );
    expect(message).toMatch(/permission denied for function trial_balance/);
  });

  it('cannot execute a posting function either', async () => {
    const message = await asUser(
      db,
      strangerId,
      () => expectError(db, `select post_document($1)`, [companyId]),
      'anon',
    );
    expect(message).toMatch(/permission denied for function post_document/);
  });

  it('has execute on nothing but the policy helpers', async () => {
    const callable = await rows<{ proname: string }>(
      db,
      `select p.proname
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prokind = 'f'
          and has_function_privilege('anon', p.oid, 'execute')
        order by 1`,
    );
    // Eight since 20260911210131, nine since modules: `module_enabled` is
    // what a module's policies call, and it answers "this module is on for
    // this company **and** you are a member of it" — so what it gives an
    // anonymous request away is the same word `is_company_member` already
    // does. Without the grant, an anonymous select on a module table would
    // raise "permission denied for function" instead of returning nothing.
    expect(callable.map((r) => r.proname)).toEqual([
      'can_write_company',
      'company_has_no_member',
      'company_role',
      'instance_has_no_admin',
      'is_any_company_member',
      'is_company_member',
      'is_company_owner',
      'is_instance_admin',
      'module_enabled',
    ]);
  });

  it('is not handed a function through PUBLIC by a migration that forgot', async () => {
    // A function created without an explicit revoke comes out executable by
    // PUBLIC — `anon` included — and `alter default privileges … revoke
    // execute on functions from public` does *not* prevent it: PostgreSQL
    // merges the stored default with the built-in one, so the new function
    // still carries `=X`. Migration 20260911210131 believed otherwise and
    // 20260912074712 found out, with `install_country_template` published as
    // an anonymous RPC endpoint for the length of one commit.
    //
    // A null `proacl` is the same failure wearing the built-in default.
    // Every migration that adds a function ends with
    // `revoke execute on all functions in schema public from public;` —
    // from PUBLIC, never from `anon`, which holds the grants above.
    const open = await rows<{ proname: string }>(
      db,
      `select p.proname
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prokind = 'f'
          and (p.proacl is null
               or exists (select 1 from aclexplode(p.proacl) a
                           where a.grantee = 0 and a.privilege_type = 'EXECUTE'))
        order by 1`,
    );
    expect(
      open.map((r) => r.proname),
      'these functions are executable by PUBLIC: add the revoke to the migration that created them',
    ).toEqual([]);
  });
});

describe('a signed-in stranger', () => {
  it('does not see who administers the installation', async () => {
    const seen = await asUser(db, strangerId, () => rows(db, `select user_id from instance_admins`));
    expect(seen).toEqual([]);
  });

  it('can still not read a company', async () => {
    const seen = await asUser(db, strangerId, () => rows(db, `select id from companies`));
    expect(seen).toEqual([]);
  });
});

describe('a member and an administrator', () => {
  it('see the administrators', async () => {
    // The demo seed installs an administrator of its own, so the list has two.
    const byMember = await asUser(db, ownerId, () => rows(db, `select user_id from instance_admins`));
    expect(byMember.map((r) => r['user_id'])).toContain(adminId);
    const byAdmin = await asUser(db, adminId, () => rows(db, `select user_id from instance_admins`));
    expect(byAdmin.map((r) => r['user_id']).sort()).toEqual(byMember.map((r) => r['user_id']).sort());
  });

  it('can run a report as a signed-in member', async () => {
    const balance = await asUser(db, ownerId, () =>
      rows(db, `select * from trial_balance($1, date '2026-01-01', date '2026-12-31')`, [companyId]),
    );
    expect(Array.isArray(balance)).toBe(true);
  });
});
