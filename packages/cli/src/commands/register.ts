/**
 * `ekwo register` and `ekwo unregister`.
 *
 * Registering is an opt-in and it is reversible, which is the only thing that
 * makes it a choice. Neither command is ever required, and nothing in the
 * schema or the CLI reads the result to decide what you may do.
 *
 * `register` also serves as the retry: the endpoint at Ekwo does not exist
 * yet, so an installation that opted in during `ekwo init` may have recorded
 * the intent locally and failed to announce it. Running this again sends it.
 */

import { boolFlag, rejectUnknownFlags, stringFlag, type ParsedArgs } from '../args.js';
import { CONNECTION_FLAGS, openDatabase } from '../context.js';
import { askRequired, isInteractive } from '../prompt.js';
import {
  anyAdminId,
  announce,
  payloadFor,
  readInstance,
  register,
  registryUrl,
  unregister,
} from '../registry.js';
import { dim, heading, line, note, skipped, step, warn } from '../ui.js';

export const REGISTER_FLAGS = [
  ...CONNECTION_FLAGS,
  'email',
  'org',
  'country',
  'registry-url',
  'admin-user-id',
  'yes',
] as const;

export const UNREGISTER_FLAGS = [...CONNECTION_FLAGS, 'admin-user-id', 'yes'] as const;

export async function registerCommand(
  args: ParsedArgs,
  deps: { fetchImpl?: typeof globalThis.fetch } = {},
): Promise<number> {
  rejectUnknownFlags(args, REGISTER_FLAGS);
  const interactive = !boolFlag(args, 'yes') && isInteractive();
  const { db } = await openDatabase(args, { interactive });

  try {
    const instance = await readInstance(db);
    if (instance === undefined) {
      warn('this installation has no instance row yet. Run `ekwo init` first.');
      return 1;
    }

    const adminUserId = stringFlag(args, 'admin-user-id') ?? (await anyAdminId(db));
    if (adminUserId === undefined) {
      warn('no instance administrator on this installation; there is nobody to register as.');
      return 1;
    }

    const url = stringFlag(args, 'registry-url') ?? registryUrl();

    // Already registered and only the announcement is missing: just send it.
    const email =
      stringFlag(args, 'email') ??
      instance.contact_email ??
      (interactive ? await askRequired('Contact address?') : undefined);
    if (email === undefined) {
      warn('an address is needed: pass --email.');
      return 1;
    }

    heading('Registration');
    if (instance.registered_at !== null && stringFlag(args, 'email') === undefined) {
      skipped(`already registered as ${instance.contact_email ?? email}; re-sending the announcement`);
      const result = await announce(payloadFor(instance, email), {
        url,
        ...(deps.fetchImpl !== undefined ? { fetchImpl: deps.fetchImpl } : {}),
      });
      report(result.announced, url, result.reason);
      return 0;
    }

    const result = await register(db, {
      adminUserId,
      email,
      url,
      ...(stringFlag(args, 'org') !== undefined ? { organization: stringFlag(args, 'org') } : {}),
      ...(stringFlag(args, 'country') !== undefined
        ? { country: stringFlag(args, 'country') }
        : {}),
      ...(deps.fetchImpl !== undefined ? { fetchImpl: deps.fetchImpl } : {}),
    });
    step(`recorded on the instance row: ${email}`);
    note(dim(`Sent: ${JSON.stringify(result.payload)}`));
    report(result.announced, url, result.reason);
    return 0;
  } finally {
    await db.close();
  }
}

function report(announced: boolean, url: string, reason?: string): void {
  if (announced) {
    step(`announced to ${url}`);
  } else {
    warn(`could not reach ${url} (${reason ?? 'unknown'}).`);
    note(dim('The local registration stands. Run `ekwo register` again when you can.'));
  }
  line();
}

export async function unregisterCommand(args: ParsedArgs): Promise<number> {
  rejectUnknownFlags(args, UNREGISTER_FLAGS);
  const interactive = !boolFlag(args, 'yes') && isInteractive();
  const { db } = await openDatabase(args, { interactive });

  try {
    const instance = await readInstance(db);
    if (instance === undefined) {
      warn('this installation has no instance row. Nothing to undo.');
      return 1;
    }

    heading('Registration');
    if (instance.registered_at === null) {
      skipped('this installation is not registered');
      line();
      return 0;
    }

    const adminUserId = stringFlag(args, 'admin-user-id') ?? (await anyAdminId(db));
    if (adminUserId === undefined) {
      warn('no instance administrator on this installation.');
      return 1;
    }

    await unregister(db, adminUserId);
    step('the address and the date are cleared on the instance row');
    note(
      dim(
        'Nothing is sent to Ekwo: the CLI only clears the local row. ' +
          'Write to privacy@ekwo.ai to have a registration deleted at our end.',
      ),
    );
    line();
    return 0;
  } finally {
    await db.close();
  }
}
