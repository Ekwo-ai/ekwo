/**
 * `ekwo.json` — the one file the CLI writes, and what is deliberately not in it.
 *
 * It holds three things: which Supabase project this installation is on, which
 * country's rules it was set up for, and which schema version it was at. That
 * is enough for the next `ekwo status` or `ekwo migrate` to know where it is
 * pointed without being told again.
 *
 * It holds no password, no service_role key and no connection string with
 * credentials in it. Those are given per invocation, by flag, environment
 * variable or prompt, and they are never written down here. A file that is
 * safe to commit is a file that stays useful; a file with a key in it becomes
 * a leak the first time somebody commits it.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const CONFIG_FILE = 'ekwo.json';

export interface EkwoConfig {
  project_url?: string;
  country?: string;
  schema_version?: string;
}

const HEADER =
  'No secrets live here. The database password and the service_role key are ' +
  'given per command, through --flags, the environment or a prompt.';

export function configPath(cwd = process.cwd()): string {
  return join(cwd, CONFIG_FILE);
}

export async function readConfig(cwd = process.cwd()): Promise<EkwoConfig | undefined> {
  try {
    const text = await readFile(configPath(cwd), 'utf8');
    const parsed = JSON.parse(text) as Record<string, unknown>;
    return {
      ...(typeof parsed['project_url'] === 'string' ? { project_url: parsed['project_url'] } : {}),
      ...(typeof parsed['country'] === 'string' ? { country: parsed['country'] } : {}),
      ...(typeof parsed['schema_version'] === 'string'
        ? { schema_version: parsed['schema_version'] }
        : {}),
    };
  } catch {
    return undefined;
  }
}

export async function writeConfig(config: EkwoConfig, cwd = process.cwd()): Promise<string> {
  const path = configPath(cwd);
  const body = {
    $comment: HEADER,
    ...(config.project_url !== undefined ? { project_url: config.project_url } : {}),
    ...(config.country !== undefined ? { country: config.country } : {}),
    ...(config.schema_version !== undefined ? { schema_version: config.schema_version } : {}),
  };
  await writeFile(path, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
  return path;
}
