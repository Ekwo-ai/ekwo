/**
 * How a pack describes what anyone has read.
 *
 * One sentence, written once, printed by `ekwo init`, by `ekwo status` and in
 * the header of every generated seed — so the three cannot say three
 * different things about the same pack.
 *
 * The scale is `community`, `maintained`, `reviewed`, and the distinction it
 * carries is the whole point: Ekwo writes a pack and tests that it is
 * internally coherent, which is not an accountant reading it against the law.
 * *Certified* describes a review by a named professional, and nothing else.
 * The value `ekwo` is deprecated; it is still translated here because a
 * database installed before September 2026 may hold it until its seeds are
 * re-applied.
 */

export type Certification = 'community' | 'maintained' | 'reviewed' | 'ekwo';

export interface CertificationFacts {
  status: string;
  /** The professional who read it. Only ever set on a reviewed pack. */
  by?: string | null | undefined;
  on?: string | null | undefined;
}

/** One line, in plain words, about how much anyone has read this pack. */
export function describeCertification(facts: CertificationFacts): string {
  const by = facts.by === null || facts.by === undefined || facts.by === '' ? undefined : facts.by;
  const on = facts.on === null || facts.on === undefined || facts.on === '' ? undefined : facts.on;

  switch (facts.status) {
    case 'reviewed':
      return by === undefined
        ? 'reviewed by an accountant'
        : `reviewed by ${by}${on === undefined ? '' : ` on ${on}`}`;
    case 'maintained':
    case 'ekwo':
      return 'maintained by Ekwo — not yet reviewed by an accountant';
    case 'community':
      return 'community pack — not reviewed';
    default:
      return `certification ${facts.status}`;
  }
}

/** Whether the operator should be warned rather than merely informed. */
export function needsWarning(status: string): boolean {
  return status !== 'reviewed';
}
