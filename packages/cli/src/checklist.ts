/**
 * The four things an operator has to do on their own Supabase project, which
 * no installer can do for them.
 *
 * Three of the four are settings of the project rather than of the database —
 * whether strangers may sign themselves up, who holds the `service_role` key —
 * and a connection string reaches none of them. The fourth is a piece of
 * reading. So they are printed at the end of a successful `ekwo init`, where
 * the person running it still has the dashboard open, and they are written in
 * the installation documentation in the same words.
 *
 * `ekwo doctor` does not check them, and says nothing about them: it holds a
 * database connection, and the answers are not in the database. The day the
 * CLI accepts a Supabase management token it could ask the API instead, and
 * that is a phase 1 question with an obvious cost — a token that can read a
 * project's settings can change them.
 */

import { bold, dim, heading, line, note } from './ui.js';

export interface OperatorInstruction {
  /** What to do, in one sentence. */
  instruction: string;
  /** Why it matters, or where the setting is. */
  because: string;
}

/**
 * Kept as data rather than as four calls to `line()` so that a test can read
 * them, and so the documentation and the terminal cannot drift into saying
 * different things.
 */
export const OPERATOR_CHECKLIST: readonly OperatorInstruction[] = [
  {
    instruction: 'Turn off self sign-up on your project.',
    because:
      'Supabase dashboard → Authentication → Sign In / Providers → "Allow new users to sign up". ' +
      'An Ekwo installation is closed: the people who keep the books are invited to it, ' +
      'and a stranger who signs themselves up is a row in auth.users nobody asked for.',
  },
  {
    instruction: 'Keep two administrators.',
    because:
      'An administrator invites the others and claims the instance. One lost account, ' +
      'one person on holiday, and a set of books has nobody who can let anyone in.',
  },
  {
    instruction: 'Keep the service_role key off every machine that does not need it.',
    because:
      'It bypasses row level security completely: it is not an administrator, it is the ' +
      'absence of a door. This installer reads it from a flag or a prompt, uses it to create ' +
      'the first account, and writes it nowhere.',
  },
  {
    instruction: 'Read DISCLAIMER.md before you file anything.',
    because:
      'A country pack is a reading of a country\'s rules at the date of its version, not a ' +
      'legal opinion, and the golden test proves that a pack agrees with itself rather than ' +
      'with the law. The books are yours, in every country where you file.',
  },
];

/**
 * Prints the checklist. Called at the end of a successful installation, and
 * exported so a test can read what it writes.
 */
export function printOperatorChecklist(): void {
  heading('Four things on your project, which this installer cannot do for you');
  for (const [index, item] of OPERATOR_CHECKLIST.entries()) {
    line();
    line(`  ${bold(`${index + 1}.`)} ${item.instruction}`);
    line(`     ${dim(item.because)}`);
  }
  line();
  note(
    dim(
      'None of these is something Ekwo does to your project. It is your project: ' +
        'the settings are yours to change and the key is yours to hold.',
    ),
  );
}
