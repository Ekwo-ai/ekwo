/**
 * `ekwo pack` — the country packs of this repository.
 *
 *   ekwo pack build <cc>|--all   compile packs/<cc> into supabase/seed/
 *   ekwo pack check <cc>|--all   recompile in memory and refuse a stale seed
 *   ekwo pack list               what this checkout carries
 *
 * No database and no network: a pack is files in, one SQL file out. The
 * command only runs in a checkout, because a published installation has the
 * compiled seeds and no pack to compile.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { rejectUnknownFlags, boolFlag, UsageError, type ParsedArgs } from '../args.js';
import {
  compileFrameworkPack,
  compileModuleSeeds,
  compilePack,
  frameworkSeedFileName,
  seedFileName,
} from '../pack/compile.js';
import { GENERIC_PACK, listPacks, packsDir, readFrameworkPack, readPack, seedOutputDir } from '../pack/read.js';
import { bold, dim, fail, heading, line, note, step, warn } from '../ui.js';

export const PACK_FLAGS = ['all', 'yes'] as const;

export async function packCommand(args: ParsedArgs): Promise<number> {
  rejectUnknownFlags(args, PACK_FLAGS);
  const action = args.positional[0];

  if (action === undefined || action === 'help') {
    line(usage());
    return action === undefined ? 2 : 0;
  }
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

function usage(): string {
  return `${bold('ekwo pack')} — compile a country pack into a seed.

  ekwo pack build <cc>     Write supabase/seed/<n>_pack_<cc>.sql from packs/<cc>.
  ekwo pack build --all    Every pack of this checkout.
  ekwo pack check --all    Refuse a seed that is not the output of its pack.
  ekwo pack list           What this checkout carries, and its certification.
`;
}
