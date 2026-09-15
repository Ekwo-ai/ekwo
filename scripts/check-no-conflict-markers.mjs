#!/usr/bin/env node
/**
 * Refuses a commit that carries the leftovers of a merge conflict.
 *
 * Git writes four kinds of line into a file it could not merge by itself: the
 * opening marker with the name of the side being merged into, the separator,
 * the closing marker with the name of the incoming side, and — under
 * `diff3`/`zdiff3`, which is what `merge.conflictStyle` is usually set to —
 * a fourth naming the common ancestor. A resolution deletes all of them.
 *
 * One of them being left behind is not hypothetical here: two `|||||||` lines
 * sat in `CHANGELOG.md` from 15 September 2026 until somebody happened to read
 * the file with their eyes. They cost nothing at runtime, which is exactly why
 * nothing noticed — no test reads the changelog, no build parses it, and the
 * rendered Markdown shows a line of pipes that looks like a typo. In a `.sql`
 * or a `.ts` the same mistake would have broken the build on the first push;
 * in prose it is invisible, and prose is where a conflict is most likely,
 * because a changelog and a design note are what every branch appends to.
 *
 * Run with `npm run check:no-conflict-markers`; the CI's *hygiene* job runs it
 * on every push and every pull request.
 *
 * **Only files git tracks are read.** A marker in a working copy is somebody
 * in the middle of a merge, which is not a fault; a marker in a tracked file
 * is one that was committed. The list comes from `git ls-files`, so an
 * untracked scratch file, a build output and everything under `.gitignore`
 * are outside the question by construction rather than by a list of
 * directories this file would have to keep up to date.
 *
 * **The markers are built from repeated characters rather than written out**,
 * so this file does not contain a single line that it would have to exempt
 * itself for. A guard with an exception for its own directory is a guard that
 * stops covering the day somebody puts a real one there.
 */

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * What each marker is, and how a line is recognised as one.
 *
 * The three that carry a label are matched on their prefix: git writes the
 * seven characters, a space and the name of the side. The separator carries
 * no label, so it is matched whole — a line of seven `=` and nothing else.
 * That distinction is what keeps a Markdown heading underlined with `=` out of
 * this: a setext underline is as long as the title above it, and a line of
 * exactly seven that is nothing else is the separator.
 */
const MARKERS = [
  { of: '<', label: true, what: 'the side being merged into' },
  { of: '|', label: true, what: 'the common ancestor, under the diff3 style' },
  { of: '=', label: false, what: 'the separator between the two sides' },
  { of: '>', label: true, what: 'the incoming side' },
].map((marker) => ({
  ...marker,
  run: marker.of.repeat(7),
}));

/** The marker a line is, or null. */
function markerOf(line) {
  for (const marker of MARKERS) {
    if (marker.label ? line.startsWith(marker.run) : line === marker.run) return marker;
  }
  return null;
}

/** Every path git tracks, relative to the root of the working tree. */
async function trackedFiles() {
  const { stdout } = await run('git', ['ls-files', '-z'], {
    cwd: root,
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout.split('\0').filter((path) => path !== '');
}

const found = [];

for (const path of await trackedFiles()) {
  // A file git cannot hand back as UTF-8 is an image, a font or an archive,
  // and none of them is a file a conflict is resolved in by hand.
  const text = await readFile(join(root, path), 'utf8').catch(() => null);
  if (text === null) continue;

  const lines = text.split('\n');
  for (const [index, line] of lines.entries()) {
    const marker = markerOf(line);
    if (marker === null) continue;
    found.push(`${path}:${index + 1}  ${marker.run} — ${marker.what}`);
  }
}

if (found.length > 0) {
  console.error('Conflict markers found in files this repository tracks:\n');
  for (const hit of found) console.error(`  ${hit}`);
  console.error(
    `\n${found.length} line(s). A resolved conflict leaves none of them behind:\n` +
      '  keep the text that is right, delete every marker, and commit that.',
  );
  process.exit(1);
}

console.log('No conflict marker in any tracked file.');
