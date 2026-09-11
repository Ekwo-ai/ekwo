/**
 * `ekwo migrate` — bring an existing installation up to this release.
 *
 * It shows the gap before it closes it, so an operator sees what is about to
 * run. The reference seeds are re-applied too: they are idempotent, and a new
 * release that adds an account to a chart would otherwise leave every
 * installation one row short.
 */

import { boolFlag, rejectUnknownFlags, type ParsedArgs } from '../args.js';
import { migrationsDir, seedDir } from '../bundle.js';
import { CONNECTION_FLAGS, openDatabase } from '../context.js';
import { applyMigrations, listMigrations, migrationGap } from '../migrations.js';
import { isInteractive } from '../prompt.js';
import { applySeeds } from '../seeds.js';
import { schemaIsInstalled } from '../bootstrap.js';
import { syncSchemaVersion } from '../status.js';
import { dim, heading, line, note, skipped, step, warn } from '../ui.js';

export const MIGRATE_FLAGS = [...CONNECTION_FLAGS, 'skip-seeds', 'yes'] as const;

export async function migrateCommand(args: ParsedArgs): Promise<number> {
  rejectUnknownFlags(args, MIGRATE_FLAGS);
  const interactive = !boolFlag(args, 'yes') && isInteractive();
  const { db } = await openDatabase(args, { interactive });

  try {
    const migrations = await listMigrations(migrationsDir());
    const gap = await migrationGap(db, migrations);

    heading('Migrations');
    note(dim(`${gap.applied.length} applied, ${gap.pending.length} pending`));

    if (gap.unknown.length > 0) {
      warn(
        `${gap.unknown.length} migration(s) in this database are not in this release — ` +
          'it was installed by a newer version. Upgrade the CLI before migrating.',
      );
      for (const version of gap.unknown) note(dim(`  ${version}`));
      return 1;
    }

    if (gap.pending.length === 0) {
      skipped('nothing to apply');
    } else {
      await applyMigrations(db, migrations, (migration) => {
        step(migration.file);
      });
    }

    if (!boolFlag(args, 'skip-seeds')) {
      heading('Reference data');
      await applySeeds(db, seedDir(), (seed) => {
        step(seed.file);
      });
      note(dim('Seeds are idempotent; re-applying them adds what a new release added.'));
    }

    if (await schemaIsInstalled(db)) {
      const version = await syncSchemaVersion(db);
      if (version !== undefined) {
        heading('Version');
        step(`instance.schema_version is now ${version}`);
      }
    }

    line();
    return 0;
  } finally {
    await db.close();
  }
}
