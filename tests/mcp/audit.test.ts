/**
 * The audit trail through the server, and the schema floor in front of it.
 *
 * Two things are proved here. An assistant can read who changed what, under
 * the same row level security as everything else — a member of one company
 * sees that company and nothing beside it. And a database older than this
 * server is refused by name before a single tool is offered, rather than
 * answered from assumptions about columns that are not there.
 */

import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  SCHEMA_MIN,
  assertSchemaSupported,
  readTools,
  writeTools,
  type Backend,
} from '../../packages/mcp/src/index.js';
import { asUser, freshDatabase, one } from '../helpers/db.js';
import { newCompany, newUser, type Fixture } from '../helpers/factory.js';
import { backendFor, list, record } from './helpers.js';

let db: PGlite;
let fx: Fixture;
let other: Fixture;
let backend: Backend;

beforeAll(async () => {
  db = await freshDatabase();
  fx = await newCompany(db, { country: 'BE', name: 'Audited SRL' });
  other = await newCompany(db, { country: 'BE', name: 'Somebody Else SRL' });
  backend = backendFor(db, fx.ownerId);

  // Something to read back. The tools write as the signed-in user, which is
  // the whole point: the trail records them and not the installer.
  await writeTools.createContact(backend, {
    company_id: fx.companyId,
    name: 'Cliente Dumont',
    contact_type: 'customer',
    country: 'BE',
  });
  await asUser(db, other.ownerId, async () => {
    await db.query(
      `insert into contacts (company_id, name, contact_type, country)
       values ($1, 'Not yours', 'customer', 'BE')`,
      [other.companyId],
    );
  });
}, 180_000);

afterAll(async () => {
  await db.close();
});

describe('read_audit_log', () => {
  it('gives back what this user changed, with both sides of it', async () => {
    const answer = record(
      await readTools.readAuditLog(backend, { company_id: fx.companyId, table: 'contacts' }),
    );
    const changes = list(answer['changes']);
    expect(changes.length).toBe(1);
    expect(changes[0]?.['operation']).toBe('insert');
    expect(changes[0]?.['actor_id']).toBe(fx.ownerId);
    expect(record(changes[0]?.['new_values'])['name']).toBe('Cliente Dumont');
    expect(answer['count']).toBe(1);
  });

  it('filters by user and by act', async () => {
    const mine = record(
      await readTools.readAuditLog(backend, { company_id: fx.companyId, actor_id: fx.ownerId }),
    );
    expect(list(mine['changes']).length).toBeGreaterThan(0);

    const stranger = await newUser(db);
    const theirs = record(
      await readTools.readAuditLog(backend, { company_id: fx.companyId, actor_id: stranger }),
    );
    expect(list(theirs['changes'])).toHaveLength(0);

    const acts = record(
      await readTools.readAuditLog(backend, { company_id: fx.companyId, action: 'document_posted' }),
    );
    expect(list(acts['changes'])).toHaveLength(0);
  });

  it('takes a period, and a date means the whole of that day', async () => {
    const today = (await one<{ day: string }>(db, `select current_date::text as day`)).day;
    const inRange = record(
      await readTools.readAuditLog(backend, { company_id: fx.companyId, from: today, to: today }),
    );
    expect(list(inRange['changes']).length).toBeGreaterThan(0);

    const before = record(
      await readTools.readAuditLog(backend, {
        company_id: fx.companyId,
        to: '2020-01-01',
      }),
    );
    expect(list(before['changes'])).toHaveLength(0);
  });

  it('shows nothing of a company this user is not a member of', async () => {
    const answer = record(
      await readTools.readAuditLog(backend, { company_id: other.companyId, table: 'contacts' }),
    );
    expect(list(answer['changes'])).toHaveLength(0);
  });

  it('is the only tool that touches the trail: nothing writes it', () => {
    const writers = Object.keys(writeTools).filter((name) => name.toLowerCase().includes('audit'));
    expect(writers).toHaveLength(0);
  });
});

describe('the schema this server needs', () => {
  it('accepts the database of this release and reports its version', async () => {
    const version = await assertSchemaSupported(backend);
    expect(version).toBe(
      (await one<{ version: string }>(db, `select ekwo_schema_version() as version`)).version,
    );
  });

  it('refuses a database older than the floor it declares, by name', async () => {
    const older: Backend = {
      ...backend,
      rpc: async <T>(fn: string): Promise<T[]> =>
        (fn === 'ekwo_schema_version' ? ['0.0.9'] : []) as T[],
    };
    await expect(assertSchemaSupported(older)).rejects.toThrow(/schema_too_old/);
    await expect(assertSchemaSupported(older)).rejects.toThrow(new RegExp(SCHEMA_MIN));
  });

  it('refuses a database that is not an Ekwo database at all', async () => {
    const nothing: Backend = {
      ...backend,
      rpc: async <T>(): Promise<T[]> => {
        throw new Error('function ekwo_schema_version() does not exist');
      },
    };
    await expect(assertSchemaSupported(nothing)).rejects.toThrow(/schema_not_found/);
  });
});
