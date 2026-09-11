/**
 * `ekwo doctor` — the checks, printed.
 *
 * Exit code 1 when something is a problem, 0 otherwise. Warnings do not fail
 * the command: an orphaned membership is worth knowing about and is not a
 * reason for a CI job to go red.
 */

import { boolFlag, rejectUnknownFlags, type ParsedArgs } from '../args.js';
import { migrationsDir } from '../bundle.js';
import { CONNECTION_FLAGS, openDatabase } from '../context.js';
import { doctor } from '../doctor.js';
import { listMigrations } from '../migrations.js';
import { isInteractive } from '../prompt.js';
import { schemaIsInstalled } from '../bootstrap.js';
import { dim, green, heading, line, red, warn, yellow } from '../ui.js';

export const DOCTOR_FLAGS = [...CONNECTION_FLAGS, 'json', 'yes'] as const;

export async function doctorCommand(args: ParsedArgs): Promise<number> {
  rejectUnknownFlags(args, DOCTOR_FLAGS);
  const interactive = !boolFlag(args, 'yes') && isInteractive();
  const { db } = await openDatabase(args, { interactive });

  try {
    if (!(await schemaIsInstalled(db))) {
      heading('Doctor');
      warn('the schema is not installed on this project. Run `ekwo init`.');
      return 1;
    }

    const migrations = await listMigrations(migrationsDir());
    const report = await doctor(db, migrations);

    if (boolFlag(args, 'json')) {
      line(JSON.stringify(report, null, 2));
      return report.problems > 0 ? 1 : 0;
    }

    heading('Doctor');
    for (const check of report.checks) {
      const mark =
        check.severity === 'ok' ? green('ok') : check.severity === 'warning' ? yellow('warn') : red('fail');
      line(`  ${mark.padEnd(check.severity === 'ok' ? 6 : 8)} ${check.name}: ${check.summary}`);
      for (const detail of check.details ?? []) line(`         ${dim(detail)}`);
    }

    line();
    if (report.problems > 0) {
      line(`  ${red(`${report.problems} problem(s)`)}, ${report.warnings} warning(s).`);
      return 1;
    }
    line(`  ${green('No problems.')} ${report.warnings} warning(s).`);
    return 0;
  } finally {
    await db.close();
  }
}
