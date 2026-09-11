/**
 * The command line surface: parsing, refusals, and what the help promises.
 */

import { describe, expect, it } from 'vitest';
import {
  COMMANDS,
  UsageError,
  help,
  parseArgs,
  run,
  version,
} from '../../packages/cli/src/index.js';
import {
  boolFlag,
  numberFlag,
  rejectUnknownFlags,
  stringFlag,
} from '../../packages/cli/src/args.js';
import {
  databaseUrlFor,
  projectRefFrom,
  supabaseUrlFor,
  withSsl,
} from '../../packages/cli/src/index.js';
import { maskUrl } from '../../packages/cli/src/ui.js';

describe('parsing', () => {
  it('reads a command, its flags in both spellings, and switches', () => {
    const args = parseArgs(['init', '--country', 'BE', '--org=Example', '--demo', '-y']);
    expect(args.command).toBe('init');
    expect(stringFlag(args, 'country')).toBe('BE');
    expect(stringFlag(args, 'org')).toBe('Example');
    expect(boolFlag(args, 'demo')).toBe(true);
    expect(boolFlag(args, 'yes')).toBe(true);
    expect(boolFlag(args, 'register')).toBe(false);
  });

  it('reads a whole number and refuses one that is not', () => {
    expect(numberFlag(parseArgs(['init', '--fiscal-year', '2026']), 'fiscal-year')).toBe(2026);
    expect(() => numberFlag(parseArgs(['init', '--fiscal-year', 'next']), 'fiscal-year')).toThrow(
      UsageError,
    );
  });

  it('keeps a value that starts with a dash out of the next flag', () => {
    const args = parseArgs(['init', '--org', '--country', 'BE']);
    // `--org` was given no value, so it is a switch and `--country` stands.
    expect(() => stringFlag(args, 'org')).toThrow(/--org needs a value/);
    expect(stringFlag(args, 'country')).toBe('BE');
  });

  it('refuses an unknown short option', () => {
    expect(() => parseArgs(['init', '-Z'])).toThrow(UsageError);
  });

  it('refuses a misspelled flag instead of ignoring it', () => {
    const args = parseArgs(['init', '--fiscal-yr', '2026']);
    expect(() => rejectUnknownFlags(args, ['fiscal-year'])).toThrow(/--fiscal-yr/);
  });
});

describe('the connection helpers', () => {
  it('finds the project ref in every shape it arrives in', () => {
    expect(projectRefFrom('https://abcdefghijklmnopqrst.supabase.co')).toBe(
      'abcdefghijklmnopqrst',
    );
    expect(
      projectRefFrom(
        'postgresql://postgres.abcdefghijklmnopqrst:pw@aws-0-eu-central-1.pooler.supabase.com:5432/postgres',
      ),
    ).toBe('abcdefghijklmnopqrst');
    expect(
      projectRefFrom('postgresql://postgres:pw@db.abcdefghijklmnopqrst.supabase.co:5432/postgres'),
    ).toBe('abcdefghijklmnopqrst');
    expect(projectRefFrom('abcdefghijklmnopqrst')).toBe('abcdefghijklmnopqrst');
    expect(projectRefFrom('not a ref')).toBeUndefined();
  });

  it('escapes the password when it builds a URL', () => {
    const url = databaseUrlFor('abcdefghijklmnopqrst', 'p@ss w/ord');
    expect(url).toContain('p%40ss%20w%2Ford');
    expect(url).toContain('db.abcdefghijklmnopqrst.supabase.co');
  });

  it('uses the pooler when a region is given', () => {
    expect(databaseUrlFor('abcdefghijklmnopqrst', 'pw', 'eu-central-1')).toBe(
      'postgresql://postgres.abcdefghijklmnopqrst:pw@aws-0-eu-central-1.pooler.supabase.com:5432/postgres',
    );
  });

  it('asks for TLS unless the string already says otherwise', () => {
    expect(withSsl('postgresql://u:p@host/db')).toContain('sslmode=require');
    expect(withSsl('postgresql://u:p@host/db?sslmode=disable')).not.toContain('sslmode=require');
    expect(withSsl('postgresql://u:p@localhost:5432/db')).toBe(
      'postgresql://u:p@localhost:5432/db',
    );
  });

  it('never prints a password back', () => {
    expect(maskUrl('postgresql://postgres:hunter2@db.example.supabase.co:5432/postgres')).toBe(
      'postgresql://postgres:••••••@db.example.supabase.co:5432/postgres',
    );
  });

  it('builds the project URL from a ref', () => {
    expect(supabaseUrlFor('abcdefghijklmnopqrst')).toBe('https://abcdefghijklmnopqrst.supabase.co');
  });
});

describe('help', () => {
  it('lists every command it dispatches', () => {
    const text = help();
    for (const command of COMMANDS) expect(text).toContain(command);
  });

  it('says there is no eject, and why', () => {
    expect(help()).toMatch(/no .*eject.* command, because there is nothing to eject from/s);
    expect(help()).toContain('supabase db push');
  });

  it('says the CLI creates no Supabase project and writes no secret', () => {
    expect(help()).toContain('It does not create or pay for a Supabase project');
    expect(help()).toContain('It never writes a secret to disk');
  });

  it('is what an empty invocation prints, and that is a success', async () => {
    expect(await quiet(() => run([]))).toBe(0);
    expect(await quiet(() => run(['--help']))).toBe(0);
  });

  it('exits 2 on a command nobody defined', async () => {
    expect(await quiet(() => run(['eject']))).toBe(2);
  });

  it('reports the package version', async () => {
    expect(version()).toMatch(/^\d+\.\d+\.\d+/);
    expect(await quiet(() => run(['--version']))).toBe(0);
  });
});

/** Runs something that prints, without printing. */
async function quiet<T>(fn: () => Promise<T>): Promise<T> {
  const out = process.stdout.write.bind(process.stdout);
  const err = process.stderr.write.bind(process.stderr);
  process.stdout.write = (() => true) as typeof process.stdout.write;
  process.stderr.write = (() => true) as typeof process.stderr.write;
  try {
    return await fn();
  } finally {
    process.stdout.write = out;
    process.stderr.write = err;
  }
}
