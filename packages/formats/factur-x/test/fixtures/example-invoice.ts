/**
 * A fictional invoice between two fictional companies. Identifiers are
 * syntactically plausible but belong to nobody.
 */
import type { Invoice } from '../../src/index.js';

export const exampleInvoice: Invoice = {
  number: 'INV-2026-0042',
  issueDate: '2026-03-31',
  dueDate: '2026-04-30',
  currency: 'EUR',
  seller: {
    name: 'Exemple Conseil SA',
    vatId: 'BE0123456749',
    legalId: { scheme: '0208', value: '0123456749' },
    address: { line1: "Rue de l'Exemple 1", postalCode: '1000', city: 'Bruxelles', country: 'BE' },
    contact: { name: 'Marie Dupont', email: 'facturation@exemple-conseil.example' },
  },
  buyer: {
    name: 'Société Fictive SAS',
    vatId: 'FR12345678901',
    legalId: { scheme: '0002', value: '345678901' },
    address: { line1: '10 avenue des Tests', line2: 'Bâtiment B', postalCode: '75001', city: 'Paris', country: 'FR' },
  },
  buyerReference: 'SERVICE-EXEC-42',
  orderReference: 'PO-7781',
  lines: [
    { name: 'Consulting days', description: 'On-site workshop, March 2026', quantity: 3, unitCode: 'day', unitPrice: 950, vatRate: 0 },
    { name: 'Software licence', quantity: 1, unitPrice: 1200, vatRate: 0, sellerItemId: 'LIC-STD' },
  ],
  payment: { iban: 'BE71 0961 2345 6769', bic: 'GKCCBEBB', reference: 'INV-2026-0042' },
  note: 'Thank you for your business.',
};

/** A domestic Belgian invoice with two VAT rates and a prepayment. */
export const domesticInvoice: Invoice = {
  number: 'INV-2026-0043',
  issueDate: '2026-04-02',
  dueDate: '2026-05-02',
  seller: exampleInvoice.seller,
  buyer: {
    name: 'Klant Voorbeeld BV',
    vatId: 'BE0400000086',
    legalId: { scheme: '0208', value: '0400000086' },
    address: { line1: 'Kerkstraat 7', postalCode: '9000', city: 'Gent', country: 'BE' },
  },
  lines: [
    { name: 'Hardware', quantity: 2, unitPrice: 199.99, vatRate: 21 },
    { name: 'Books', quantity: 3, unitPrice: 12.5, vatRate: 6 },
    { name: 'Installation', quantity: 1.5, unitCode: 'HUR', unitPrice: 80, vatRate: 21 },
  ],
  prepaidAmount: 100,
  payment: { iban: 'BE71096123456769' },
};
