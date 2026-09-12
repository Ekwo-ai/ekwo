/**
 * @deprecated The FEC left this package. It is a file format, and a file
 * format is MIT: install [`@ekwo-ai/fec`](https://www.npmjs.com/package/@ekwo-ai/fec)
 * and import from there.
 *
 * This module re-exports it unchanged so that `@ekwo-ai/core` and
 * `@ekwo-ai/core/fec` keep working for one version. It goes away in the next.
 *
 * `IsoDate` and `Decimal` are deliberately *not* re-exported here: they are
 * types of the schema and this package already exports its own.
 */
export {
  checkFec,
  FEC_COLUMNS,
  FecError,
  fecFileName,
  formatFecAmount,
  formatFecDate,
  fromQueryRow,
  generateFec,
} from '@ekwo-ai/fec';
export type {
  FecColumn,
  FecLine,
  FecOptions,
  FecQueryRow,
  FecViolation,
} from '@ekwo-ai/fec';
