/** Thrown by {@link generateCbsoXbrl} when the input cannot produce a valid filing. */
export class CbsoInputError extends Error {
  constructor(
    message: string,
    /** Dotted path of the offending field, e.g. `"address.postalCode"`. */
    public readonly path: string,
  ) {
    super(`${path}: ${message}`);
    this.name = 'CbsoInputError';
  }
}
