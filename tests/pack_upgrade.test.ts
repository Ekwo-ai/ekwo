/**
 * Upgrading a company from the country pack it copied to the one this
 * installation now holds.
 *
 * The first upgrade is the risk, and it is the one nobody can rehearse twice:
 * a company installed at 1.0.0 has been booking on those accounts ever since,
 * and an upgrade that silently rewrites them destroys a year of bookkeeping.
 * So this file does not construct a difference and check the rules against it.
 * It replays the published 1.0.0 seeds — the four hand-written files kept in
 * `tests/fixtures/seeds-before-packs/` since the pack format replaced them —
 * installs a company from them, loads the packs of this release on top, and
 * asks what an upgrade would do. The replay itself is
 * `helpers/installed-at-1-0-0.ts`, because the end-to-end test carries the
 * same company through a whole financial year afterwards and the two must
 * start from one definition of "the previous version".
 *
 * The claim is: nothing silent. Every difference is either applied by one of
 * the two rules that cannot lose anything, or listed and left alone.
 */

import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, one, rows } from './helpers/db.js';
import { companyInstalledAtOneZeroZero } from './helpers/installed-at-1-0-0.js';

interface Difference {
  object: string;
  key: string;
  change: string;
  rule: string;
  detail: Record<string, unknown>;
}

interface Upgrade {
  country: string;
  from_version: string;
  to_version: string;
  version_moved: boolean;
  applied: Difference[];
  listed: Difference[];
  never_applied: Difference[];
}

let db: PGlite;
let companyId: string;
let ownerId: string;
let packVersion: string;

beforeAll(async () => {
  ({ db, companyId, ownerId } = await companyInstalledAtOneZeroZero({ country: 'BE' }));
  packVersion = (
    await one<{ version: string }>(db, `select version from country_packs where country = 'BE'`)
  ).version;
}, 180_000);

afterAll(async () => {
  await db.close();
});

describe('a company installed at 1.0.0, against the pack this release carries', () => {
  it('knows it is behind, and by how much', async () => {
    const held = await one<{ version: string; chart_code: string }>(
      db,
      `select version, chart_code from company_packs where company_id = $1`,
      [companyId],
    );
    expect(held.version).toBe('1.0.0');
    expect(held.chart_code).toBe('default');
    expect(packVersion).not.toBe('1.0.0');
  });

  it('names every difference, each carrying the rule that decides its fate', async () => {
    const diff = await rows<Difference>(db, `select * from pack_upgrade_diff($1)`, [companyId]);
    expect(diff.length).toBeGreaterThan(0);
    for (const row of diff) {
      expect(['addition', 'closure', 'review']).toContain(row.rule);
      expect(['account', 'journal', 'tax', 'tax_posting']).toContain(row.object);
      expect(row.key.length).toBeGreaterThan(0);
    }
  });

  it('finds the taxes the pack has gained since 1.0.0, as additions', async () => {
    const diff = await rows<Difference>(db, `select * from pack_upgrade_diff($1)`, [companyId]);
    const additions = diff.filter((d) => d.object === 'tax' && d.rule === 'addition');
    expect(additions.length).toBeGreaterThan(0);

    // The same claim `packs.test.ts` makes from the other side: what the pack
    // gained is new codes, not edits to the ones that were there.
    const held = await rows<{ code: string }>(
      db,
      `select code from taxes where company_id = $1 order by code`,
      [companyId],
    );
    for (const addition of additions) {
      expect(held.map((t) => t.code)).not.toContain(addition.key);
    }
  });

  it('applies the additions and the closures, and leaves the rest listed', async () => {
    const before = await one<{ count: string }>(
      db,
      `select count(*)::text as count from taxes where company_id = $1`,
      [companyId],
    );
    const before_diff = (await rows(db, `select 1 from pack_upgrade_diff($1)`, [companyId])).length;

    const result = await asUser(db, ownerId, async () =>
      one<{ pack_upgrade: Upgrade }>(db, `select pack_upgrade($1)`, [companyId]),
    );
    const upgrade = result.pack_upgrade;

    expect(upgrade.from_version).toBe('1.0.0');
    expect(upgrade.to_version).toBe(packVersion);
    for (const applied of upgrade.applied) {
      expect(['addition', 'closure']).toContain(applied.rule);
    }
    for (const listed of upgrade.listed) {
      expect(listed.rule).toBe('review');
    }
    // Nothing fell between the two lists: every difference the diff named is
    // either in `applied`, in `listed`, or in the one bucket that is never
    // applied at all.
    expect(upgrade.applied.length).toBeGreaterThan(0);
    expect(upgrade.applied.length + upgrade.listed.length + upgrade.never_applied.length).toBe(
      before_diff,
    );

    const after = await one<{ count: string }>(
      db,
      `select count(*)::text as count from taxes where company_id = $1`,
      [companyId],
    );
    expect(Number(after.count)).toBeGreaterThan(Number(before.count));
  });

  it('holds the version back while a difference is still waiting to be decided', async () => {
    const listed = await rows<Difference>(
      db,
      `select * from pack_upgrade_diff($1) where rule = 'review'`,
      [companyId],
    );
    const held = await one<{ version: string }>(
      db,
      `select version from company_packs where company_id = $1`,
      [companyId],
    );
    if (listed.length > 0) {
      expect(held.version).toBe('1.0.0');
    } else {
      expect(held.version).toBe(packVersion);
    }
  });

  it('applies what was listed only when asked, and then moves the version', async () => {
    const result = await asUser(db, ownerId, async () =>
      one<{ pack_upgrade: Upgrade }>(db, `select pack_upgrade($1, null, true)`, [companyId]),
    );
    const upgrade = result.pack_upgrade;
    expect(upgrade.listed).toHaveLength(0);
    expect(upgrade.version_moved).toBe(true);

    const held = await one<{ version: string; upgraded_at: string | null }>(
      db,
      `select version, upgraded_at::text from company_packs where company_id = $1`,
      [companyId],
    );
    expect(held.version).toBe(packVersion);
    expect(held.upgraded_at).not.toBeNull();
  });

  it('leaves nothing behind: a second run finds only what it may never apply', async () => {
    const diff = await rows<Difference>(db, `select * from pack_upgrade_diff($1)`, [companyId]);
    for (const row of diff) {
      expect(row.change).toBe('company_only');
    }
  });

  it('never removes a row the company holds and the pack does not', async () => {
    const codes = await rows<{ code: string }>(
      db,
      `select code from accounts where company_id = $1 order by code`,
      [companyId],
    );
    expect(codes.length).toBeGreaterThan(100);

    const result = await asUser(db, ownerId, async () =>
      one<{ pack_upgrade: Upgrade }>(db, `select pack_upgrade($1, null, true)`, [companyId]),
    );
    for (const refused of result.pack_upgrade.never_applied) {
      expect(refused.change).toBe('company_only');
    }
    const after = await rows<{ code: string }>(
      db,
      `select code from accounts where company_id = $1 order by code`,
      [companyId],
    );
    expect(after.map((a) => a.code)).toEqual(codes.map((a) => a.code));
  });

  it('records the upgrade in the audit trail, with what it applied and what it did not', async () => {
    const written = await rows<{
      action: string;
      actor_id: string | null;
      old_values: Record<string, unknown>;
      new_values: Record<string, unknown>;
    }>(
      db,
      `select action, actor_id, old_values, new_values from audit_log
        where company_id = $1 and action = 'pack_upgraded' order by id`,
      [companyId],
    );
    expect(written.length).toBeGreaterThan(0);
    expect(written[0]?.actor_id).toBe(ownerId);
    expect(written[0]?.old_values['version']).toBe('1.0.0');
    expect(written[0]?.new_values).toHaveProperty('applied');
    expect(written[0]?.new_values).toHaveProperty('listed');
    expect(written.at(-1)?.new_values['version']).toBe(packVersion);
  });
});

describe('what it refuses', () => {
  it('names the company it cannot find', async () => {
    const message = await db
      .query(`select pack_upgrade_diff('00000000-0000-0000-0000-000000000009')`)
      .then(() => '', (error: Error) => error.message);
    expect(message).toContain('unknown_company');
  });

  it('refuses a country this company never installed', async () => {
    const message = await db
      .query(`select pack_upgrade_diff($1, 'FR')`, [companyId])
      .then(() => '', (error: Error) => error.message);
    expect(message).toContain('no_pack_installed');
  });

  it('refuses a member who may not write the company', async () => {
    const viewer = crypto.randomUUID();
    await db.query(`insert into auth.users (id, email) values ($1, $2)`, [
      viewer,
      `${viewer}@example.test`,
    ]);
    await db.query(
      `insert into company_members (company_id, user_id, role) values ($1, $2, 'viewer')`,
      [companyId, viewer],
    );
    const message = await asUser(db, viewer, async () =>
      db.query(`select pack_upgrade($1)`, [companyId]).then(
        () => '',
        (error: Error) => error.message,
      ),
    );
    expect(message).toContain('not_allowed');
  });
});
