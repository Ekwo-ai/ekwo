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

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { rejectUnknownFlags, boolFlag, UsageError, type ParsedArgs } from '../args.js';
import { compilePack, seedFileName } from '../pack/compile.js';
import { listPacks, packsDir, readPack, seedOutputDir } from '../pack/read.js';
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
    heading(`Packs (${available.length})`);
    for (const slug of available) {
      const pack = await readPack(slug, dir);
      note(
        `${bold(slug)}  ${pack.manifest.name} ${pack.manifest.version} · ` +
          `${pack.accounts.length} accounts · ${pack.taxes.length} taxes · ` +
          `certification ${pack.manifest.certification?.status ?? 'none'}`,
      );
    }
    return 0;
  }

  const wanted = selection(args, available);
  const seedDir = seedOutputDir();
  let stale = 0;

  heading(action === 'build' ? 'Compiling' : 'Checking');
  for (const slug of wanted) {
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
        step(`${file} — ${pack.accounts.length} accounts, ${pack.taxes.length} taxes`);
      }
    } else if (current !== sql) {
      stale += 1;
      fail(`${file} is not the output of packs/${slug}${current === undefined ? ' (it does not exist)' : ''}`);
    } else {
      step(`${file}`);
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
  if (boolFlag(args, 'all')) return available;
  const asked = args.positional[1];
  if (asked === undefined) {
    throw new UsageError(`name a country or pass --all. This checkout carries: ${available.join(', ')}`);
  }
  const slug = asked.toLowerCase();
  if (!available.includes(slug)) {
    throw new UsageError(`unknown pack: ${asked}. This checkout carries: ${available.join(', ')}`);
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
