/**
 * `ekwo demo` — the sample company, on explicit request only.
 *
 * `90_demo_company.sql` invents a Belgian consultancy with a quarter of
 * invoices, a matched payment and a bank statement. It is the fastest way to
 * see what the schema does, and it has no place on real books: besides the
 * company it also writes a fictional row into `auth.users` and makes that
 * fictional user an instance administrator, because the seed has to stand
 * alone on an empty database.
 *
 * So the command asks first, and it acts on behalf of a real administrator so
 * the database's own rule — only an administrator appoints another — is
 * satisfied rather than bypassed.
 */

import { boolFlag, rejectUnknownFlags, stringFlag, type ParsedArgs } from '../args.js';
import { seedDir } from '../bundle.js';
import { CONNECTION_FLAGS, openDatabase } from '../context.js';
import { confirm, isInteractive } from '../prompt.js';
import { anyAdminId } from '../registry.js';
import { applyDemoSeed } from '../seeds.js';
import { asUser, scalar } from '../sql.js';
import { dim, heading, line, note, skipped, step, warn } from '../ui.js';

export const DEMO_FLAGS = [...CONNECTION_FLAGS, 'admin-user-id', 'yes'] as const;

export async function demoCommand(args: ParsedArgs): Promise<number> {
  rejectUnknownFlags(args, DEMO_FLAGS);
  const yes = boolFlag(args, 'yes');
  const interactive = !yes && isInteractive();
  const { db } = await openDatabase(args, { interactive });

  try {
    heading('Demo company');

    const already = await scalar<boolean>(
      db,
      `select exists (select 1 from companies where vat_number = 'BE0123456749')`,
    );
    if (already === true) {
      skipped('Exemple Conseil SRL is already here; the seed does nothing twice');
      line();
      return 0;
    }

    const companies = await scalar<string>(db, 'select count(*)::text from companies');
    if (companies !== '0') {
      warn(`this installation already holds ${companies ?? '0'} compan(y/ies).`);
      note(dim('The demo adds a fictional company and a fictional administrator alongside them.'));
      if (!yes) {
        const go = interactive ? await confirm('Add the demo data anyway?', false) : false;
        if (!go) {
          skipped('not applied');
          note(dim('Pass --yes to apply it without being asked.'));
          line();
          return 0;
        }
      }
    }

    const adminUserId = stringFlag(args, 'admin-user-id') ?? (await anyAdminId(db));
    if (adminUserId === undefined) {
      // Nothing claimed yet: the seed can take the first seat itself.
      await applyDemoSeed(db, seedDir());
    } else {
      await asUser(db, adminUserId, () => applyDemoSeed(db, seedDir()));
    }

    step('Exemple Conseil SRL: 6 contacts, 10 documents, a matched payment, a bank statement');
    note(dim('Everything in it is invented. Drop the company when you are done looking.'));
    line();
    return 0;
  } finally {
    await db.close();
  }
}
