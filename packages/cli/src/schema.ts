/**
 * The schema version this CLI is written against.
 *
 * It is the one package of the three that also *carries* the migrations, so
 * the number below is a floor and not a requirement it could fail: `ekwo
 * migrate` moves a database up to what this release defines. What it buys is
 * an installation that was set up by a much older release being named as such
 * by `ekwo status`, instead of failing later in a query nobody can place.
 *
 * Declared in `package.json` under `ekwo.schemaMin` and repeated here, as in
 * every package of this repository; `tests/cli/package.test.ts` keeps the two
 * equal.
 */

export const SCHEMA_MIN = '0.3.0';
