import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, expectError, freshDatabase, one, rows } from './helpers/db.js';
import { DEMO_OWNER, newInstanceAdmin, newUser } from './helpers/factory.js';

let db: PGlite;

beforeAll(async () => {
  db = await freshDatabase();
});

afterAll(async () => {
  await db.close();
});

describe('the instance row', () => {
  it('is a singleton', async () => {
    const count = await one<{ count: number }>(db, `select count(*)::int as count from instance`);
    expect(Number(count.count)).toBe(1);

    const second = await expectError(
      db,
      `insert into instance (id, organization_name, country) values (2, 'Autre', 'FR')`,
    );
    expect(second).toMatch(/instance_singleton/);

    const duplicate = await expectError(
      db,
      `insert into instance (organization_name, country) values ('Autre', 'FR')`,
    );
    expect(duplicate).toMatch(/duplicate key|instance_pkey/i);
  });

  it('records who installed it, where and at which version', async () => {
    const row = await one<{
      instance_id: string;
      organization_name: string;
      country: string;
      edition: string;
      schema_version: string;
      installed_at: Date;
    }>(db, `select * from instance where id = 1`);

    expect(row.instance_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(row.organization_name).toBe('Exemple Conseil');
    // country-literal: the demo seed installs a Belgian practice, and this
    // reads back what `supabase/seed/90_demo_company.sql` wrote.
    expect(row.country).toBe('BE');
    expect(row.edition).toBe('community');
    // Whatever the release defines, and not a number written here: the column
    // default calls the function, which is the property under test. What the
    // number is for a given release is pinned in `tests/cli/schema-version.test.ts`.
    const defined = await one<{ version: string }>(db, `select ekwo_schema_version() as version`);
    expect(row.schema_version).toBe(defined.version);
    expect(row.installed_at).toBeInstanceOf(Date);
  });

  it('leaves the registration fields empty', async () => {
    const row = await one<{ contact_email: string | null; registered_at: Date | null }>(
      db,
      `select contact_email, registered_at from instance where id = 1`,
    );
    expect(row.contact_email).toBeNull();
    expect(row.registered_at).toBeNull();
  });

  it('refuses to be registered without an address', async () => {
    const message = await expectError(db, `update instance set registered_at = now() where id = 1`);
    expect(message).toMatch(/instance_registration_needs_an_address/);
  });

  it('registers and unregisters on demand, as the administrator', async () => {
    await asUser(db, DEMO_OWNER, async () => {
      await db.query(`select register_instance('ops@exemple-conseil.example')`);
    });
    let row = await one<{ contact_email: string | null; registered_at: Date | null }>(
      db,
      `select contact_email, registered_at from instance where id = 1`,
    );
    expect(row.contact_email).toBe('ops@exemple-conseil.example');
    expect(row.registered_at).not.toBeNull();

    await asUser(db, DEMO_OWNER, async () => {
      await db.query(`select unregister_instance()`);
    });
    row = await one(db, `select contact_email, registered_at from instance where id = 1`);
    expect(row.contact_email).toBeNull();
    expect(row.registered_at).toBeNull();
  });

  it('refuses registration by anyone else', async () => {
    const message = await asUser(db, crypto.randomUUID(), async () =>
      expectError(db, `select register_instance('someone@example.test')`),
    );
    expect(message).toMatch(/not_instance_admin/);
  });

  it('refuses a second initialisation', async () => {
    const message = await expectError(db, `select init_instance('Autre', 'FR')`);
    expect(message).toMatch(/instance_already_initialised/);
  });
});

describe('instance administrators', () => {
  it('holds one row per administrator, keyed on the customer auth.users', async () => {
    const admins = await rows<{ user_id: string }>(db, `select user_id from instance_admins`);
    expect(admins).toEqual([{ user_id: DEMO_OWNER }]);

    // The table name is the role, so there is no role column to get wrong.
    const columns = await rows<{ column_name: string }>(
      db,
      `select a.attname as column_name from pg_attribute a
         join pg_class c on c.oid = a.attrelid
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = 'instance_admins'
          and a.attnum > 0 and not a.attisdropped`,
    );
    expect(columns.map((c) => c.column_name)).not.toContain('role');
  });

  it('refuses an administrator who is not a user of this installation', async () => {
    const message = await expectError(db, `insert into instance_admins (user_id) values ($1)`, [
      crypto.randomUUID(),
    ]);
    expect(message).toMatch(/instance_admins_user_fkey|foreign key/i);
  });

  it('keeps the instance role out of company membership', async () => {
    const company = await one<{ id: string }>(db, `select id from companies limit 1`);
    const message = await expectError(
      db,
      `insert into company_members (company_id, user_id, role) values ($1, $2, 'instance_admin')`,
      [company.id, crypto.randomUUID()],
    );
    expect(message).toMatch(/company_members_role_is_company_level/);
  });

  it('refuses a second claim from someone who is not an administrator', async () => {
    const stranger = await newUser(db);
    const message = await asUser(db, stranger, async () =>
      expectError(db, `select claim_instance_admin()`),
    );
    expect(message).toMatch(/instance_already_claimed/);
  });

  it('lets an administrator appoint another', async () => {
    const second = await newUser(db);
    await asUser(db, DEMO_OWNER, async () => {
      await db.query(`select claim_instance_admin($1)`, [second]);
    });
    const admins = await rows<{ user_id: string }>(db, `select user_id from instance_admins`);
    expect(admins.map((a) => a.user_id)).toContain(second);
    await db.query(`delete from instance_admins where user_id = $1`, [second]);
  });

  it('lets only an administrator create a company', async () => {
    const stranger = await newUser(db);
    const refused = await asUser(db, stranger, async () =>
      expectError(
        db,
        `insert into companies (name, country, fiscal_country) values ('Interdite', 'BE', 'BE')`,
      ),
    );
    expect(refused).toMatch(/row-level security|violates/i);

    const created = await asUser(db, DEMO_OWNER, async () =>
      one<{ id: string }>(
        db,
        `insert into companies (name, country, fiscal_country) values ('Permise', 'BE', 'BE')
         returning id`,
      ),
    );
    expect(created.id).toBeTruthy();
    await db.query(`delete from companies where id = $1`, [created.id]);
  });

  it('lets an administrator invite a member into a company', async () => {
    const company = await one<{ id: string }>(
      db,
      `select id from companies where vat_number = 'BE0123456749'`,
    );
    const invited = await newUser(db);
    await asUser(db, DEMO_OWNER, async () => {
      await db.query(
        `insert into company_members (company_id, user_id, role) values ($1, $2, 'accountant')`,
        [company.id, invited],
      );
    });
    const member = await one<{ role: string }>(
      db,
      `select role from company_members where company_id = $1 and user_id = $2`,
      [company.id, invited],
    );
    expect(member.role).toBe('accountant');
    await db.query(`delete from company_members where user_id = $1`, [invited]);
  });

  it('does not let an administrator read a company ledger they were not invited to', async () => {
    // Administering the installation is not the same as being on the books.
    const admin = await newInstanceAdmin(db);
    const seen = await asUser(db, admin, async () => rows(db, `select id from entry_lines`));
    expect(seen).toEqual([]);
    await db.query(`delete from instance_admins where user_id = $1`, [admin]);
  });
});

describe('who may read the instance row', () => {
  it('lets a viewer of any company read it', async () => {
    const company = await one<{ id: string }>(
      db,
      `select id from companies where vat_number = 'BE0123456749'`,
    );
    const viewer = await newUser(db);
    await db.query(
      `insert into company_members (company_id, user_id, role) values ($1, $2, 'viewer')`,
      [company.id, viewer],
    );

    const seen = await asUser(db, viewer, async () =>
      rows<{ organization_name: string }>(db, `select organization_name from instance`),
    );
    expect(seen).toEqual([{ organization_name: 'Exemple Conseil' }]);
  });

  it('does not let a viewer write it', async () => {
    const company = await one<{ id: string }>(
      db,
      `select id from companies where vat_number = 'BE0123456749'`,
    );
    const viewer = await newUser(db);
    await db.query(
      `insert into company_members (company_id, user_id, role) values ($1, $2, 'viewer')`,
      [company.id, viewer],
    );

    await asUser(db, viewer, async () => {
      await db.query(`update instance set organization_name = 'Renommee' where id = 1`);
    });
    const row = await one<{ organization_name: string }>(
      db,
      `select organization_name from instance where id = 1`,
    );
    expect(row.organization_name).toBe('Exemple Conseil');

    const refused = await asUser(db, viewer, async () =>
      expectError(db, `insert into instance (id, organization_name, country)
                       values (1, 'Doublon', 'FR')`),
    );
    expect(refused).toMatch(/row-level security|duplicate key|violates/i);
  });

  it('hides it from someone who is on no company and administers nothing', async () => {
    const stranger = await newUser(db);
    const seen = await asUser(db, stranger, async () => rows(db, `select id from instance`));
    expect(seen).toEqual([]);
  });

  it('shows it to an administrator before they join any company', async () => {
    const admin = await newInstanceAdmin(db);
    const seen = await asUser(db, admin, async () => rows(db, `select id from instance`));
    expect(seen).toHaveLength(1);
    await db.query(`delete from instance_admins where user_id = $1`, [admin]);
  });
});

describe('no tenant column anywhere', () => {
  it('has company_id and never tenant_id', async () => {
    const offenders = await rows<{ table_name: string; column_name: string }>(
      db,
      `select c.relname as table_name, a.attname as column_name
         from pg_attribute a
         join pg_class c on c.oid = a.attrelid
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'
          and a.attnum > 0 and not a.attisdropped
          and a.attname in ('tenant_id', 'tenant', 'org_id')`,
    );
    expect(offenders).toEqual([]);
  });
});
