/**
 * `ekwo status` — what is on the other end of the connection string.
 */

import { boolFlag, rejectUnknownFlags, type ParsedArgs } from '../args.js';
import { migrationsDir } from '../bundle.js';
import { describeCertification } from '../pack/certification.js';
import { CONNECTION_FLAGS, openDatabase } from '../context.js';
import { listMigrations, type Migration } from '../migrations.js';
import { allModuleMigrations, listModules } from '../module/read.js';
import { isInteractive } from '../prompt.js';
import { SCHEMA_MIN } from '../schema.js';
import { status } from '../status.js';
import { dim, heading, line, note, pairs, warn, yellow } from '../ui.js';

export const STATUS_FLAGS = [...CONNECTION_FLAGS, 'json', 'yes'] as const;

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

export async function statusCommand(args: ParsedArgs): Promise<number> {
  rejectUnknownFlags(args, STATUS_FLAGS);
  const interactive = !boolFlag(args, 'yes') && isInteractive();
  const { db, connection } = await openDatabase(args, { interactive });

  try {
    const migrations = await everything();
    const report = await status(db, migrations);

    if (boolFlag(args, 'json')) {
      line(JSON.stringify(report, null, 2));
      return report.pending.length > 0 ? 1 : 0;
    }

    if (!report.schemaInstalled) {
      heading('Schema');
      warn('not installed on this project. Run `ekwo init`.');
      return 1;
    }

    heading('Schema');
    pairs([
      ['project', connection.supabaseUrl ?? connection.projectRef ?? '(from --db-url)'],
      ['installed version', report.installedVersion ?? 'unknown'],
      ['available version', report.availableVersion ?? 'unknown'],
      ['this CLI needs', `${SCHEMA_MIN} or newer`],
      ['migrations', `${report.appliedCount} applied, ${report.pending.length} pending`],
    ]);
    if (report.pending.length > 0) {
      line();
      for (const migration of report.pending) note(yellow(`pending  ${migration.file}`));
      note(dim('Run `ekwo migrate` to apply them.'));
    }
    if (report.unknown.length > 0) {
      line();
      warn(`${report.unknown.length} migration(s) applied here are not in this release.`);
    }

    heading('Instance');
    if (report.instance === undefined) {
      note(dim('the schema is there but init_instance() has not run — `ekwo init` finishes it'));
    } else {
      pairs([
        ['organisation', report.instance.organization_name],
        ['country', report.instance.country],
        ['edition', report.instance.edition],
        ['instance id', report.instance.instance_id],
        ['administrators', String(report.admins)],
        [
          'registered',
          report.instance.registered_at === null
            ? 'no'
            : `${report.instance.contact_email ?? ''} since ${report.instance.registered_at}`,
        ],
      ]);
    }

    heading(`Country packs (${report.packs.length})`);
    if (report.packs.length === 0) {
      note(dim('none recorded — this installation was seeded before packs, or the seeds have not run'));
    } else {
      pairs(
        report.packs.map((p) => [
          `${p.country} ${p.name}`,
          `${p.version} · ${describeCertification({
            status: p.certificationStatus,
            by: p.certifiedBy,
            on: p.certifiedAt,
          })} · charts: ${
            p.charts.length === 0
              ? 'none recorded'
              : p.charts.map((c) => `${c.code}${c.isDefault ? ' (default)' : ''}`).join(', ')
          }${p.einvoiceProfile === null ? '' : ` · e-invoicing: ${p.einvoiceProfile}`}`,
        ]),
      );
    }

    heading(`Companies (${report.companies.length})`);
    if (report.companies.length === 0) {
      note(dim('none yet'));
    } else {
      pairs(
        report.companies.map((c) => [
          c.name,
          `${c.country} · pack ${c.packVersion ?? 'unknown'} · chart ${c.chartCode ?? 'unknown'} · ` +
            `files ${c.vatPeriod === null ? 'on no recorded cadence' : `every ${c.vatPeriod}`} · ` +
            `${c.accounts} accounts · ${c.entries} entries · ` +
            `${c.fiscalYears} financial year(s), ${c.fiscalYears - c.closedFiscalYears} open` +
            (c.liveShares === 0 ? '' : ` · ${c.liveShares} document(s) published behind a link`),
        ]),
      );
      const behind = report.companies.filter((c) => {
        const loaded = report.packs.find((p) => p.country === c.country);
        return loaded !== undefined && c.packVersion !== null && c.packVersion !== loaded.version;
      });
      for (const company of behind) {
        const loaded = report.packs.find((p) => p.country === company.country);
        line();
        warn(
          `${company.name} copied ${company.country} pack ${company.packVersion}, this installation holds ` +
            `${loaded?.version}. \`ekwo pack upgrade\` will show the difference.`,
        );
      }
    }

    line();
    return report.pending.length > 0 ? 1 : 0;
  } finally {
    await db.close();
  }
}
