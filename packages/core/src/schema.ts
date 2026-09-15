/**
 * The schema version this package is written against.
 *
 * A country pack declares `schema_min` in its manifest, and for the same
 * reason a published npm package has to: the rows it reads and the functions
 * it calls are a contract with a version of the database, and installing a
 * newer client against an older database is the one upgrade order nobody
 * plans for. The number is declared in `package.json` under `ekwo.schemaMin`
 * and repeated here as a constant, so a bundler that never reads a manifest
 * still carries it; a test keeps the two equal.
 *
 * Forward only. A release of Ekwo is a tag carrying migrations, packs and
 * packages together; there is no "down" migration and there never will be,
 * because undoing a schema change on a database with a year of entries in it
 * is not a script, it is a restore.
 */

/** The oldest schema `@ekwo-ai/core` reads. */
export const SCHEMA_MIN = '0.3.0';

/** `-1`, `0` or `1`, comparing two `major.minor.patch` versions numerically. */
export function compareSchemaVersions(left: string, right: string): number {
  const parse = (version: string): number[] =>
    version
      .trim()
      .split('.')
      .map((part) => Number.parseInt(part, 10));
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const one = a[index] ?? 0;
    const other = b[index] ?? 0;
    if (Number.isNaN(one) || Number.isNaN(other)) {
      throw new Error(`bad_schema_version: ${left} and ${right} are not both major.minor.patch`);
    }
    if (one !== other) return one < other ? -1 : 1;
  }
  return 0;
}

/** Whether a database at `installed` is new enough for a package needing `minimum`. */
export function schemaIsAtLeast(installed: string, minimum: string): boolean {
  return compareSchemaVersions(installed, minimum) >= 0;
}
