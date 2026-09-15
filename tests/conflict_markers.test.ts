/**
 * The guard that refuses a conflict marker, on a repository built to carry one.
 *
 * `scripts/check-no-conflict-markers.mjs` exists because two `|||||||` lines
 * sat in `CHANGELOG.md` for a day. A guard that is never run against something
 * faulty is a guard nobody knows the shape of, so this builds a throwaway git
 * repository, puts the four markers in a file it tracks, and reads the refusal
 * back.
 *
 * The script is copied into that repository rather than pointed at it: it
 * resolves the tree it reads from its own location — `scripts/..` — which is
 * what makes it correct in the CI and what makes it need a repository of its
 * own here. What runs is the file itself, byte for byte, the way the hygiene
 * job runs it.
 *
 * Every marker below is built by repeating a character. Writing one out would
 * put it at the start of a line of this file, which the guard tracks and would
 * refuse — the test would fail the thing it is testing.
 */

import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, describe, expect, it } from 'vitest';
import { repoRoot } from './helpers/db.js';

const run = promisify(execFile);

const GUARD = join('scripts', 'check-no-conflict-markers.mjs');

/** The four lines git writes into a file it could not merge. */
const OPEN = '<'.repeat(7);
const BASE = '|'.repeat(7);
const SEPARATOR = '='.repeat(7);
const CLOSE = '>'.repeat(7);

/** Directories to remove when the suite is done. */
const made: string[] = [];

interface Result {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * A git repository holding the given files, with the guard copied into it.
 *
 * `files` are written and staged; `untracked` are written and left alone,
 * which is how the claim about `git ls-files` is put to the test. Nothing is
 * committed: `git ls-files` reads the index, so staging is the whole of what
 * "tracked" means here.
 */
async function guardOver(
  files: Record<string, string>,
  untracked: Record<string, string> = {},
): Promise<Result> {
  const dir = await mkdtemp(join(tmpdir(), 'ekwo-markers-'));
  made.push(dir);
  await run('git', ['init', '-q', '-b', 'main'], { cwd: dir });

  await mkdir(join(dir, 'scripts'), { recursive: true });
  await cp(join(repoRoot, GUARD), join(dir, GUARD));

  for (const [name, text] of Object.entries(files)) {
    await writeFile(join(dir, name), text, 'utf8');
  }
  await run('git', ['add', '-A'], { cwd: dir });

  for (const [name, text] of Object.entries(untracked)) {
    await writeFile(join(dir, name), text, 'utf8');
  }

  return run('node', [GUARD], { cwd: dir }).then(
    ({ stdout, stderr }) => ({ code: 0, stdout, stderr }),
    (error: Error & { code?: number; stdout?: string; stderr?: string }) => ({
      code: error.code ?? 1,
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? '',
    }),
  );
}

afterAll(async () => {
  for (const dir of made) await rm(dir, { recursive: true, force: true });
});

describe('what the guard refuses', () => {
  it('names every one of the four lines a merge leaves behind, with its number', async () => {
    const conflicted = [
      '# Changelog',
      `${OPEN} HEAD`,
      '- what this side says',
      SEPARATOR,
      '- what the other side says',
      `${CLOSE} a-branch`,
      '',
      `${BASE} parent of 1234567 (a commit somebody rebased)`,
      '- what the ancestor said',
      '',
    ].join('\n');

    const result = await guardOver({ 'CHANGELOG.md': conflicted });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('CHANGELOG.md:2');
    expect(result.stderr).toContain('CHANGELOG.md:4');
    expect(result.stderr).toContain('CHANGELOG.md:6');
    expect(result.stderr).toContain('CHANGELOG.md:8');
    expect(result.stderr).toContain('4 line(s)');
    // Each refusal says which side of the merge the line came from, because
    // "conflict marker" alone does not tell somebody what to keep.
    expect(result.stderr).toContain('the side being merged into');
    expect(result.stderr).toContain('the separator between the two sides');
    expect(result.stderr).toContain('the incoming side');
    expect(result.stderr).toContain('the common ancestor');
  });

  it('is content once the conflict is actually resolved', async () => {
    const resolved = ['# Changelog', '', '- what this side says', ''].join('\n');
    const result = await guardOver({ 'CHANGELOG.md': resolved });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('No conflict marker');
  });

  it('reads the two lines that were actually committed, from the file that held them', async () => {
    // The case the guard was written for: `CHANGELOG.md` as it stood on
    // 15 September 2026, with two `|||||||` lines and nothing else wrong.
    const asItStood = [
      '## [Unreleased]',
      '',
      '- **A first entry.** Something a branch appended.',
      `${BASE} parent of feaa972 (a commit somebody rebased)`,
      '- **A second entry.** Something another branch appended.',
      '',
      '## [0.3.0]',
      `${BASE} parent of 5d6ff05 (the same commit)`,
      '',
    ].join('\n');

    const result = await guardOver({ 'CHANGELOG.md': asItStood });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('CHANGELOG.md:4');
    expect(result.stderr).toContain('CHANGELOG.md:8');
    expect(result.stderr).toContain('2 line(s)');
  });
});

describe('what the guard deliberately leaves alone', () => {
  it('does not mistake a Markdown heading or a rule for the separator', async () => {
    // A setext underline is as long as the title above it, and people draw
    // rules of `=` in a README. The separator is a line of exactly seven and
    // nothing else, which is why neither of these is caught.
    const prose = [
      'A title',
      '='.repeat(7 + 1),
      '',
      'A shorter one',
      '='.repeat(7 - 1),
      '',
      '='.repeat(40),
      '',
      '| a | b |',
      '|---|---|',
      '',
    ].join('\n');

    const result = await guardOver({ 'README.md': prose });
    expect(result.code, result.stderr).toBe(0);
  });

  it('says nothing about a merge somebody is in the middle of', async () => {
    // A marker in the working copy is work in progress, not a fault. Only what
    // git tracks is read, so an untracked file carrying all four is silent.
    const inProgress = [`${OPEN} HEAD`, 'a', SEPARATOR, 'b', `${CLOSE} other`, ''].join('\n');

    const result = await guardOver({ 'README.md': 'nothing wrong\n' }, { 'NOTES.md': inProgress });
    expect(result.code, result.stderr).toBe(0);
  });
});

describe('this repository', () => {
  it('carries no conflict marker of its own', async () => {
    // The guard run the way the hygiene job runs it, on the tree it ships in.
    const result = await run('node', [GUARD], { cwd: repoRoot }).then(
      ({ stdout }) => ({ code: 0, stdout, stderr: '' }),
      (error: Error & { code?: number; stderr?: string }) => ({
        code: error.code ?? 1,
        stdout: '',
        stderr: error.stderr ?? '',
      }),
    );
    expect(result.code, result.stderr).toBe(0);
  });
});
