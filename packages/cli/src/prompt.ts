/**
 * Asking questions, on `node:readline` alone.
 *
 * A masked prompt is the reason this is written out rather than installed:
 * the database password and the service_role key pass through it, and the
 * fewer packages that can see them the better. Node has everything needed —
 * the masking trick is a writable stream that drops what readline echoes.
 */

import { createInterface, type Interface } from 'node:readline';
import { Writable } from 'node:stream';
import { cyan, dim } from './ui.js';

export function isInteractive(): boolean {
  return process.stdin.isTTY === true && process.stdout.isTTY === true;
}

/** Thrown when a question has to be asked and there is nobody to answer it. */
export class NotInteractiveError extends Error {
  constructor(what: string, flag: string) {
    super(
      `missing_input: ${what} was not given and this is not a terminal. ` +
        `Pass ${flag}, or set the matching environment variable.`,
    );
  }
}

function withInterface<T>(fn: (rl: Interface) => Promise<T>): Promise<T> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return fn(rl).finally(() => {
    rl.close();
  });
}

/** A free-text question. `defaultValue` is offered in brackets and accepted on Enter. */
export async function ask(question: string, defaultValue?: string): Promise<string> {
  const suffix = defaultValue !== undefined ? dim(` [${defaultValue}]`) : '';
  const answer = await withInterface(
    (rl) =>
      new Promise<string>((resolve) => {
        rl.question(`${cyan('?')} ${question}${suffix} `, resolve);
      }),
  );
  const trimmed = answer.trim();
  if (trimmed.length > 0) return trimmed;
  return defaultValue ?? '';
}

/** Keeps asking until the answer is not empty. */
export async function askRequired(question: string, defaultValue?: string): Promise<string> {
  for (;;) {
    const answer = await ask(question, defaultValue);
    if (answer.length > 0) return answer;
    process.stdout.write(`  ${dim('An answer is needed.')}\n`);
  }
}

/** A stream that forwards to stdout until it is muted, then swallows. */
class MutableOutput extends Writable {
  muted = false;

  override _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    if (!this.muted) process.stdout.write(chunk);
    callback();
  }
}

/** A question whose answer is not echoed. */
export async function askSecret(question: string): Promise<string> {
  const output = new MutableOutput();
  const rl = createInterface({ input: process.stdin, output, terminal: true });
  try {
    const answer = await new Promise<string>((resolve) => {
      rl.question(`${cyan('?')} ${question} `, resolve);
      output.muted = true;
    });
    process.stdout.write('\n');
    return answer.trim();
  } finally {
    rl.close();
  }
}

/** A yes/no question. The default is what Enter means. */
export async function confirm(question: string, defaultValue = false): Promise<boolean> {
  const hint = defaultValue ? 'Y/n' : 'y/N';
  const answer = (await ask(`${question} ${dim(`(${hint})`)}`)).toLowerCase();
  if (answer.length === 0) return defaultValue;
  return answer === 'y' || answer === 'yes';
}

/**
 * One of a short list. Returns the chosen value, not its index.
 *
 * `defaultValue` is optional on purpose: a question whose answer decides what
 * the books are — the country — has no right answer to preselect, and Enter
 * on it would be a choice nobody made.
 */
export async function choose(
  question: string,
  options: { value: string; label: string }[],
  defaultValue?: string,
): Promise<string> {
  const labels = options.map((o) => `${o.value} (${o.label})`).join(', ');
  for (;;) {
    const answer = (await ask(`${question} ${dim(labels)}`, defaultValue)).toUpperCase();
    const match = options.find((o) => o.value.toUpperCase() === answer);
    if (match !== undefined) return match.value;
    process.stdout.write(`  ${dim(`Choose one of: ${options.map((o) => o.value).join(', ')}`)}\n`);
  }
}
