/**
 * Amounts as decimal strings, everywhere, in both directions.
 *
 * Postgres holds `numeric` exactly and hands it over as text; a table read
 * asks for `amount::text` so that is what arrives. The one place a float can
 * appear is a function result crossing PostgREST as JSON, where `1210.00`
 * becomes a number before any code of ours sees it. `money()` puts it back to
 * two decimals, which is exact for every amount a ledger holds, and a model
 * reading `"1210.00"` never has to wonder whether `1210.0000000001` was the
 * VAT rounding or the transport.
 */

import { EkwoMcpError } from './backend.js';
import { roundCurrency } from './rounding.js';

export type Decimal = string;

/** A numeric, as the decimal string the ledger holds. */
export function money(value: unknown): Decimal | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return roundCurrency(value, 2).toFixed(2);
  const text = String(value);
  return text.length === 0 ? null : text;
}

/** The same, for a quantity or a rate, where two decimals would be a lie. */
export function decimal(value: unknown): Decimal | null {
  if (value === null || value === undefined) return null;
  const text = String(value);
  return text.length === 0 ? null : text;
}

/** Applies `money()` to the named keys of every row. */
export function moneyFields<T extends Record<string, unknown>>(rows: T[], keys: string[]): T[] {
  return rows.map((row) => {
    const out: Record<string, unknown> = { ...row };
    for (const key of keys) {
      if (key in out) out[key] = money(out[key]);
    }
    return out as T;
  });
}

/** An amount on its way into the database: `"1210.00"`, never 1210.0000001. */
export function amountIn(value: string | number): string {
  const text = typeof value === 'number' ? roundCurrency(value, 2).toFixed(2) : value.trim();
  if (!/^-?\d+(\.\d+)?$/.test(text)) {
    throw new EkwoMcpError(`bad_amount: ${String(value)} is not a decimal amount`);
  }
  return text;
}
