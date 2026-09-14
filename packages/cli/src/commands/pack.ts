/**
 * `ekwo pack` — the country packs, in this repository and in an installation.
 *
 *   ekwo pack build <cc>|--all   compile packs/<cc> into supabase/seed/
 *   ekwo pack check <cc>|--all   recompile in memory and refuse a stale seed
 *   ekwo pack list               what this checkout carries
 *   ekwo pack status             what an installation holds, company by company
 *   ekwo pack upgrade <company>  move a company to the version loaded here
 *
 * The first three are files in, one SQL file out: no database, no network, and
 * they only run in a checkout, because a published installation has the
 * compiled seeds and no pack to compile. The last two are the opposite — they
 * need a connection and know nothing about `packs/`.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { rejectUnknownFlags, boolFlag, stringFlag, UsageError, type ParsedArgs } from '../args.js';
import { CONNECTION_FLAGS, openDatabase } from '../context.js';
import { isInteractive } from '../prompt.js';
import { packDiff, packStatus, packUpgrade, resolveCompany, type PackChange } from '../pack/upgrade.js';
import {
  compileFrameworkPack,
  compileModuleSeeds,
  compilePack,
  frameworkSeedFileName,
  seedFileName,
} from '../pack/compile.js';
import { GENERIC_PACK, listPacks, packsDir, readFrameworkPack, readPack, seedOutputDir } from '../pack/read.js';
import { bold, dim, fail, heading, line, note, pairs, skipped, step, warn, yellow } from '../ui.js';

export const PACK_FLAGS = [...CONNECTION_FLAGS, 'all', 'yes', 'apply', 'country', 'json'] as const;

export async function packCommand(args: ParsedArgs): Promise<number> {
  rejectUnknownFlags(args, PACK_FLAGS);
  const action = args.positional[0];

  if (action === undefined || action === 'help') {
    line(usage());
    return action === undefined ? 2 : 0;
  }
  if (action === 'status') return await statusSubcommand(args);
  if (action === 'upgrade') return await upgradeSubcommand(args);

  if (action !== 'build' && action !== 'check' && action !== 'list') {
    throw new UsageError(`unknown subcommand: pack ${action}\n${usage()}`);
  }

  const dir = packsDir();
  const available = await listPacks(dir);

  if (action === 'list') {
    heading(`Packs (${available.length + 1})`);
    const framework = await readFrameworkPack(GENERIC_PACK, dir);
    note(
      `${bold(GENERIC_PACK)}  ${framework.manifest.name} ${framework.manifest.version} · ` +
        `${framework.statements.length} statements · no country · ` +
        `certification ${framework.manifest.certification?.status ?? 'none'}`,
    );
    for (const slug of available) {
      const pack = await readPack(slug, dir);
      note(
        `${bold(slug)}  ${pack.manifest.name} ${pack.manifest.version} · ` +
          `${pack.charts.length} chart(s), ${pack.charts.reduce((n, c) => n + c.accounts.length, 0)} accounts · ` +
          `${pack.taxes.length} taxes · ${pack.statements.length} statements · ` +
          `${pack.languages.join(', ')} · ` +
          `certification ${pack.manifest.certification?.status ?? 'none'}`,
      );
      for (const chart of pack.charts) {
        note(
          dim(
            `        ${chart.code}${chart.is_default ? ' (default)' : ''} — ${chart.name}, ` +
              `${chart.accounts.length} accounts, ` +
              `${chart.statements.length === 0 ? 'generic statements only' : chart.statements.join(', ')}`,
          ),
        );
      }
    }
    return 0;
  }

  const wanted = selection(args, available);
  const seedDir = seedOutputDir();
  let stale = 0;

  heading(action === 'build' ? 'Compiling' : 'Checking');

  // The framework pack first: a chart may name one of its statements, and it
  // is the fallback for a country that ships none.
  if (boolFlag(args, 'all') || wanted.includes(GENERIC_PACK)) {
    const framework = await readFrameworkPack(GENERIC_PACK, dir);
    const file = frameworkSeedFileName(GENERIC_PACK);
    const sql = compileFrameworkPack(framework);
    const path = join(seedDir, file);
    const current = await readFile(path, 'utf8').catch(() => undefined);
    if (action === 'build') {
      if (current === sql) note(dim(`${file} — already the output of packs/${GENERIC_PACK}`));
      else {
        await writeFile(path, sql, 'utf8');
        step(`${file} — ${framework.statements.length} statements`);
      }
    } else if (current !== sql) {
      stale += 1;
      fail(`${file} is not the output of packs/${GENERIC_PACK}${current === undefined ? ' (it does not exist)' : ''}`);
    } else {
      step(file);
    }
  }

  for (const slug of wanted.filter((s) => s !== GENERIC_PACK)) {
    const pack = await readPack(slug, dir);
    const file = seedFileName(slug, available);
    const sql = compilePack(pack);
    const path = join(seedDir, file);
    const current = await readFile(path, 'utf8').catch(() => undefined);

    if (action === 'build') {
      if (current === sql) {
        note(dim(`${file} — already the output of packs/${slug}`));
      } else {
        await writeFile(path, sql, 'utf8');
        step(
          `${file} — ${pack.charts.length} chart(s), ` +
            `${pack.charts.reduce((n, c) => n + c.accounts.length, 0)} accounts, ` +
            `${pack.taxes.length} taxes, ${pack.statements.length} statements`,
        );
      }
    } else if (current !== sql) {
      stale += 1;
      fail(`${file} is not the output of packs/${slug}${current === undefined ? ' (it does not exist)' : ''}`);
    } else {
      step(`${file}`);
    }

    // The sections of a module compile beside the pack seed, under the module's
    // own folder: `assets.category_templates` exists only on an installation
    // that carries `assets`, and a seed applied where its tables are missing is
    // a seed nobody can re-run.
    for (const [module, moduleSql] of compileModuleSeeds(pack)) {
      const modulePath = join(seedDir, 'modules', module, file);
      const moduleCurrent = await readFile(modulePath, 'utf8').catch(() => undefined);
      if (action === 'build') {
        if (moduleCurrent === moduleSql) {
          note(dim(`modules/${module}/${file} — already the output of packs/${slug}/${module}.json`));
        } else {
          await mkdir(join(seedDir, 'modules', module), { recursive: true });
          await writeFile(modulePath, moduleSql, 'utf8');
          step(`modules/${module}/${file}`);
        }
      } else if (moduleCurrent !== moduleSql) {
        stale += 1;
        fail(
          `modules/${module}/${file} is not the output of packs/${slug}/${module}.json` +
            (moduleCurrent === undefined ? ' (it does not exist)' : ''),
        );
      } else {
        step(`modules/${module}/${file}`);
      }
    }

    for (const section of pack.deferred) {
      warn(`packs/${slug}: ${section}`);
    }
  }

  if (stale > 0) {
    line();
    note(dim('Run `ekwo pack build --all` and commit the result.'));
    return 1;
  }
  return 0;
}

function selection(args: ParsedArgs, available: string[]): string[] {
  const all = [GENERIC_PACK, ...available];
  if (boolFlag(args, 'all')) return all;
  const asked = args.positional[1];
  if (asked === undefined) {
    throw new UsageError(`name a country or pass --all. This checkout carries: ${all.join(', ')}`);
  }
  const slug = asked.toLowerCase();
  if (!all.includes(slug)) {
    throw new UsageError(`unknown pack: ${asked}. This checkout carries: ${all.join(', ')}`);
  }
  return [slug];
}

/**
 * `ekwo pack status` — what each company copied, against what is loaded here.
 *
 * Read-only. It is the question `ekwo pack upgrade` answers by acting on, so
 * an operator can ask it as often as they like and on a company they have no
 * intention of moving.
 */
async function statusSubcommand(args: ParsedArgs): Promise<number> {
  const interactive = !boolFlag(args, 'yes') && isInteractive();
  const { db } = await openDatabase(args, { interactive });
  try {
    const report = await packStatus(db);

    if (boolFlag(args, 'json')) {
      line(JSON.stringify(report, null, 2));
      return report.companies.some((c) => c.behind) ? 1 : 0;
    }

    heading(`Packs loaded here (${report.packs.length})`);
    if (report.packs.length === 0) {
      note(dim('none — this installation was seeded before packs, or the seeds have not run'));
    } else {
      pairs(report.packs.map((p) => [`${p.country} ${p.name}`, p.version]));
    }

    heading(`Companies (${report.companies.length})`);
    if (report.companies.length === 0) {
      note(dim('none yet'));
      return 0;
    }

    for (const company of report.companies) {
      const held = company.heldVersion ?? 'none recorded';
      const loaded = company.packVersion ?? 'no pack loaded';
      const head = `${bold(company.name)}  ${company.country}${
        company.chartCode === null ? '' : `/${company.chartCode}`
      }  copied ${held}, loaded ${loaded}`;
      if (!company.behind) {
        skipped(`${head} — up to date`);
        continue;
      }
      step(head);
      const d = company.differences;
      if (d !== undefined) {
        note(
          dim(
            `        ${d.additions} addition(s), ${d.closures} closure(s) — applied by rule; ` +
              `${d.review} to review`,
          ),
        );
      }
    }

    const behind = report.companies.filter((c) => c.behind);
    if (behind.length > 0) {
      line();
      note(dim('Run `ekwo pack upgrade <company>` to see the difference and apply the two rules.'));
    }
    return behind.length > 0 ? 1 : 0;
  } finally {
    await db.close();
  }
}

/**
 * `ekwo pack upgrade <company>` — the three rules, out loud.
 *
 * Additions and closed validities are applied; everything else is printed and
 * left exactly where it was. `--apply` is the operator saying they have read
 * that list.
 */
async function upgradeSubcommand(args: ParsedArgs): Promise<number> {
  const wanted = args.positional[1];
  if (wanted === undefined) {
    throw new UsageError('name the company to upgrade: `ekwo pack upgrade "<name>"`, or its id.');
  }
  const interactive = !boolFlag(args, 'yes') && isInteractive();
  const { db } = await openDatabase(args, { interactive });
  try {
    const company = await resolveCompany(db, wanted);
    const country = stringFlag(args, 'country');
    const apply = boolFlag(args, 'apply');

    const before = await packDiff(db, company.id, country);
    if (before.length === 0) {
      heading(company.name);
      skipped('already the version this installation holds');
      return 0;
    }

    const result = await packUpgrade(db, company.id, {
      apply,
      ...(country === undefined ? {} : { country }),
    });

    if (boolFlag(args, 'json')) {
      line(JSON.stringify(result, null, 2));
      return result.listed.length > 0 ? 1 : 0;
    }

    heading(`${company.name} — ${result.country} pack ${result.from_version} → ${result.to_version}`);

    if (result.applied.length === 0) {
      skipped('nothing applied');
    } else {
      for (const change of result.applied) step(describe(change));
      note(dim(`${result.applied.length} change(s) applied: an addition and a closed validity take nothing away.`));
    }

    if (result.listed.length > 0) {
      heading(`To review (${result.listed.length})`);
      note(dim('Not applied. Read them, then run again with --apply if the pack is right.'));
      for (const change of result.listed) warn(describe(change));
    }

    if (result.never_applied.length > 0) {
      heading(`Yours, not the pack's (${result.never_applied.length})`);
      note(dim('Never applied by an upgrade: nothing is removed from a company\'s books.'));
      for (const change of result.never_applied) note(dim(describe(change)));
    }

    heading('Version');
    if (result.version_moved) {
      step(`company_packs now records ${result.to_version}`);
    } else {
      note(
        yellow(
          `still ${result.from_version}: ${result.listed.length} difference(s) are waiting to be decided.`,
        ),
      );
    }
    line();
    return result.listed.length > 0 ? 1 : 0;
  } finally {
    await db.close();
  }
}

/** One difference, in one line. */
function describe(change: PackChange): string {
  const what = `${change.object} ${bold(change.key)}`;
  switch (change.change) {
    case 'missing':
      return `${what} — added from the pack`;
    case 'valid_to':
      return `${what} — validity closed on ${String(
        (change.detail['pack'] as Record<string, unknown> | undefined)?.['valid_to'] ?? '?',
      )}`;
    case 'company_only':
      return `${what} — held here, not in the pack`;
    default:
      return `${what} — ${change.change}: ${JSON.stringify(change.detail)}`;
  }
}

function usage(): string {
  return `${bold('ekwo pack')} — compile a country pack into a seed, and move a company onto it.

  ekwo pack build <cc>     Write supabase/seed/<n>_pack_<cc>.sql from packs/<cc>.
  ekwo pack build --all    Every pack of this checkout.
  ekwo pack check --all    Refuse a seed that is not the output of its pack.
  ekwo pack list           What this checkout carries, and its certification.

  ekwo pack status         What each company of an installation copied, against
                           what is loaded there. Read-only.
  ekwo pack upgrade <company>
                           Move it to the version loaded there. Additions and
                           closed validities are applied; everything else is
                           listed and left alone.
      --apply              Also apply what was listed for review.
      --country <cc>       A second pack the company holds, rather than its own.
`;
}
