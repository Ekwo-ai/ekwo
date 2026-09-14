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
import { listMigrations, type Migration } from '../migrations.js';
import { allModuleMigrations, listModules } from '../module/read.js';
import { isInteractive } from '../prompt.js';
import { schemaIsInstalled } from '../bootstrap.js';
import { dim, green, heading, line, red, warn, yellow } from '../ui.js';

export const DOCTOR_FLAGS = [...CONNECTION_FLAGS, 'json', 'yes'] as const;

/**
 * The migrations this release carries, the socle's and the modules'.
 *
 * `ekwo migrate` installs the modules by default — a module is a schema whose
 * tables are empty until a company enables it — and records their versions in
 * the same history table as the socle's. So a gap computed against the socle
 * alone reads eight module versions as history this CLI has no file for, and
 * an installation that was merely kept up to date is reported as "ahead of
 * this CLI: upgrade the CLI before migrating" — advice to upgrade something
 * that is already current. Found by the end-to-end run of 14 September 2026
 * against a real project, where `ekwo migrate` and `ekwo doctor` disagreed
 * about the same database one command apart.
 */
async function everything(): Promise<Migration[]> {
  const modules = await listModules();
  return [...(await listMigrations(migrationsDir())), ...allModuleMigrations(modules)].sort((a, b) =>
    a.version.localeCompare(b.version),
  );
}

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

    const migrations = await everything();
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
