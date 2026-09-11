import type { Invoice, InvoiceLine, InvoiceTotals, VatBreakdown, VatCategory } from './types.js';
import { defaultVatCategory } from './vat.js';

export function round2(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

/** The VAT category of a line, explicit or derived from the parties. */
export function lineVatCategory(line: InvoiceLine, invoice: Invoice): VatCategory {
  return (
    line.vatCategory ??
    defaultVatCategory({
      rate: line.vatRate,
      sellerCountry: invoice.seller.address.country,
      buyerCountry: invoice.buyer.address.country,
      buyerHasVatId: !!invoice.buyer.vatId,
    })
  );
}

/** Line net amount (BT-131): explicit, or quantity × unit price rounded to the cent. */
export function lineNetAmount(line: InvoiceLine): number {
  return round2(line.netAmount ?? line.quantity * line.unitPrice);
}

/**
 * VAT breakdown and document totals, computed the way EN 16931 expects them:
 * one group per category and rate, VAT computed on the rounded group basis.
 */
export function computeTotals(invoice: Invoice): InvoiceTotals {
  const groups = new Map<string, VatBreakdown>();
  let lineTotal = 0;
  for (const line of invoice.lines) {
    const category = lineVatCategory(line, invoice);
    const rate = category === 'S' ? line.vatRate : 0;
    const net = lineNetAmount(line);
    lineTotal = round2(lineTotal + net);
    const key = `${category}:${rate}`;
    const group = groups.get(key) ?? { category, rate, basis: 0, tax: 0 };
    group.basis = round2(group.basis + net);
    groups.set(key, group);
  }
  let taxTotal = 0;
  for (const group of groups.values()) {
    group.tax = round2((group.basis * group.rate) / 100);
    taxTotal = round2(taxTotal + group.tax);
  }
  const grandTotal = round2(lineTotal + taxTotal);
  const prepaid = round2(invoice.prepaidAmount ?? 0);
  return {
    lineTotal,
    taxBasisTotal: lineTotal,
    taxTotal,
    grandTotal,
    prepaid,
    duePayable: round2(grandTotal - prepaid),
    breakdown: [...groups.values()],
  };
}
