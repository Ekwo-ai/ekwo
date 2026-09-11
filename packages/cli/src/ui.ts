/**
 * Everything the CLI prints.
 *
 * Colour only when the output is a terminal and `NO_COLOR` is unset, because
 * `ekwo status > report.txt` should not contain escape codes.
 */

const useColour =
  process.stdout.isTTY === true &&
  process.env['NO_COLOR'] === undefined &&
  process.env['TERM'] !== 'dumb';

function paint(code: string, text: string): string {
  return useColour ? `[${code}m${text}[0m` : text;
}

export const bold = (text: string): string => paint('1', text);
export const dim = (text: string): string => paint('2', text);
export const green = (text: string): string => paint('32', text);
export const yellow = (text: string): string => paint('33', text);
export const red = (text: string): string => paint('31', text);
export const cyan = (text: string): string => paint('36', text);

export function line(text = ''): void {
  process.stdout.write(`${text}\n`);
}

export function heading(text: string): void {
  line();
  line(bold(text));
}

export function step(text: string): void {
  line(`  ${green('·')} ${text}`);
}

export function skipped(text: string): void {
  line(`  ${dim('·')} ${dim(text)}`);
}

export function note(text: string): void {
  line(`  ${text}`);
}

export function warn(text: string): void {
  line(`  ${yellow('!')} ${text}`);
}

export function fail(text: string): void {
  process.stderr.write(`${red('✗')} ${text}\n`);
}

/** A two-column table with the keys right-padded to the widest one. */
export function pairs(rows: [string, string][], indent = '  '): void {
  const width = rows.reduce((max, [key]) => Math.max(max, key.length), 0);
  for (const [key, value] of rows) {
    line(`${indent}${dim(key.padEnd(width))}  ${value}`);
  }
}

/**
 * Redacts a secret for display. Never print one in full: terminal history and
 * CI logs outlive the session.
 */
export function mask(secret: string): string {
  if (secret.length <= 8) return '•'.repeat(secret.length);
  return `${secret.slice(0, 4)}${'•'.repeat(Math.min(20, secret.length - 8))}${secret.slice(-4)}`;
}

/** A connection string with its password replaced. */
export function maskUrl(url: string): string {
  return url.replace(/(postgres(?:ql)?:\/\/[^:/@]+:)[^@]*(@)/i, '$1••••••$2');
}
