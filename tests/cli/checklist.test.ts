/**
 * What an installation leaves for the operator to do.
 *
 * Three settings of a Supabase project and one piece of reading, none of which
 * a connection string reaches. They are printed at the end of `ekwo init` and
 * written in the installation documentation, and the second test here is the
 * one that matters over time: a checklist that lives in two places drifts, and
 * the terminal and the README are exactly the two places somebody edits one of.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  OPERATOR_CHECKLIST,
  printOperatorChecklist,
} from '../../packages/cli/src/index.js';
import { repoRoot } from '../helpers/db.js';

/** Runs `fn` with stdout captured, and gives back everything it wrote. */
function captured(fn: () => void): string {
  const written: string[] = [];
  const out = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((text: string) => {
    written.push(text);
    return true;
  }) as typeof process.stdout.write;
  try {
    fn();
  } finally {
    process.stdout.write = out;
  }
  return written.join('');
}

describe('the four things only the operator can do', () => {
  it('are printed, each of them, with the reason it is there', () => {
    const printed = captured(printOperatorChecklist);

    expect(OPERATOR_CHECKLIST).toHaveLength(4);
    for (const [index, item] of OPERATOR_CHECKLIST.entries()) {
      expect(printed).toContain(`${index + 1}.`);
      expect(printed).toContain(item.instruction);
      expect(printed).toContain(item.because);
    }
  });

  it('name the sign-up setting, a second administrator, the key and the disclaimer', () => {
    const printed = captured(printOperatorChecklist);

    // The wording may be improved; what each line is about may not quietly
    // change, because each of the four is a different way of losing control of
    // an installation.
    expect(printed).toMatch(/Allow new users to sign up/);
    expect(printed).toMatch(/two administrators/i);
    expect(printed).toMatch(/service_role/);
    expect(printed).toMatch(/DISCLAIMER\.md/);
  });

  it('say plainly that they are the operator\'s own actions on their own project', () => {
    const printed = captured(printOperatorChecklist);

    expect(printed).toMatch(/this installer cannot do for you/i);
    expect(printed).toMatch(/It is your project/);
  });

  it('are in the installation documentation in the same words', async () => {
    const readme = await readFile(join(repoRoot, 'packages', 'cli', 'README.md'), 'utf8');

    for (const item of OPERATOR_CHECKLIST) {
      expect(readme, `packages/cli/README.md is missing: ${item.instruction}`).toContain(
        item.instruction,
      );
    }
  });
});
