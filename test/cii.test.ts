import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { computeTotals, generateCiiXml } from '../src/index.js';
import { domesticInvoice, exampleInvoice } from './fixtures/example-invoice.js';

const golden = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

describe('generateCiiXml', () => {
  const xml = generateCiiXml(exampleInvoice);

  it('matches the golden file (intra-community invoice, BASIC)', () => {
    expect(xml).toBe(golden('example-invoice.xml'));
  });

  it('matches the golden file (domestic invoice, EN 16931)', () => {
    expect(generateCiiXml(domesticInvoice, { profile: 'en16931' })).toBe(golden('domestic-invoice.xml'));
  });

  it('declares the BASIC guideline by default and EN 16931 on request', () => {
    expect(xml).toContain('<ram:ID>urn:cen.eu:en16931:2017#compliant#urn:factur-x.eu:1p0:basic</ram:ID>');
    expect(generateCiiXml(exampleInvoice, { profile: 'en16931' })).toContain('<ram:ID>urn:cen.eu:en16931:2017</ram:ID>');
  });

  it('classifies a zero-rated sale to an EU business as intra-community (K) with reason and code', () => {
    expect(xml).toContain('<ram:CategoryCode>K</ram:CategoryCode>');
    expect(xml).toContain('<ram:ExemptionReason>Intra-community supply, exempt from VAT</ram:ExemptionReason>');
    expect(xml).toContain('<ram:ExemptionReasonCode>VATEX-EU-IC</ram:ExemptionReasonCode>');
    expect(xml).toContain('<ram:RateApplicablePercent>0.00</ram:RateApplicablePercent>');
  });

  it('writes dates in format 102 and the parties with their identifiers', () => {
    expect(xml).toContain('<udt:DateTimeString format="102">20260331</udt:DateTimeString>');
    expect(xml).toContain('<ram:ID schemeID="0208">0123456749</ram:ID>');
    expect(xml).toContain('<ram:ID schemeID="0002">345678901</ram:ID>');
    expect(xml).toContain('<ram:ID schemeID="VA">FR12345678901</ram:ID>');
    expect(xml).toContain('<ram:LineTwo>Bâtiment B</ram:LineTwo>');
  });

  it('maps unit words to UN/ECE codes', () => {
    expect(xml).toContain('<ram:BilledQuantity unitCode="DAY">3.0000</ram:BilledQuantity>');
    expect(xml).toContain('<ram:BilledQuantity unitCode="C62">1.0000</ram:BilledQuantity>');
  });

  it('cleans the IBAN and omits the BIC below EN 16931', () => {
    expect(xml).toContain('<ram:IBANID>BE71096123456769</ram:IBANID>');
    expect(xml).not.toContain('BICID');
    expect(generateCiiXml(exampleInvoice, { profile: 'en16931' })).toContain('<ram:BICID>GKCCBEBB</ram:BICID>');
  });

  it('adds up the totals', () => {
    expect(xml).toContain('<ram:LineTotalAmount>4050.00</ram:LineTotalAmount>');
    expect(xml).toContain('<ram:TaxTotalAmount currencyID="EUR">0.00</ram:TaxTotalAmount>');
    expect(xml).toContain('<ram:GrandTotalAmount>4050.00</ram:GrandTotalAmount>');
    expect(xml).toContain('<ram:DuePayableAmount>4050.00</ram:DuePayableAmount>');
  });

  it('groups the VAT breakdown by rate and computes VAT on the rounded basis', () => {
    const totals = computeTotals(domesticInvoice);
    expect(totals.breakdown).toEqual([
      { category: 'S', rate: 21, basis: 519.98, tax: 109.2 },
      { category: 'S', rate: 6, basis: 37.5, tax: 2.25 },
    ]);
    expect(totals).toMatchObject({ lineTotal: 557.48, taxTotal: 111.45, grandTotal: 668.93, prepaid: 100, duePayable: 568.93 });
    const domestic = generateCiiXml(domesticInvoice);
    expect(domestic).toContain('<ram:TotalPrepaidAmount>100.00</ram:TotalPrepaidAmount>');
    expect(domestic).toContain('<ram:DuePayableAmount>568.93</ram:DuePayableAmount>');
  });

  it('encodes a credit note with its preceding invoice', () => {
    const credit = generateCiiXml({
      ...domesticInvoice,
      number: 'CN-2026-0001',
      type: 'credit-note',
      precedingInvoice: { number: 'INV-2026-0043', issueDate: '2026-04-02' },
    });
    expect(credit).toContain('<ram:TypeCode>381</ram:TypeCode>');
    expect(credit).toContain('<ram:IssuerAssignedID>INV-2026-0043</ram:IssuerAssignedID>');
    expect(credit).toContain('<qdt:DateTimeString format="102">20260402</qdt:DateTimeString>');
  });

  it('omits the rate for "not subject to VAT" and honours explicit categories and reasons', () => {
    const out = generateCiiXml({
      ...domesticInvoice,
      lines: [{ name: 'Deposit', quantity: 1, unitPrice: 50, vatRate: 0, vatCategory: 'O' }],
      exemptionReasons: { O: 'Hors champ' },
    });
    expect(out).toContain('<ram:CategoryCode>O</ram:CategoryCode>');
    expect(out).toContain('<ram:ExemptionReason>Hors champ</ram:ExemptionReason>');
    expect(out).toContain('<ram:ExemptionReasonCode>VATEX-EU-O</ram:ExemptionReasonCode>');
    expect(out).not.toContain('RateApplicablePercent');
  });

  it('escapes XML special characters', () => {
    const out = generateCiiXml({ ...exampleInvoice, note: 'Terms & conditions <v2>' });
    expect(out).toContain('<ram:Content>Terms &amp; conditions &lt;v2&gt;</ram:Content>');
  });
});
