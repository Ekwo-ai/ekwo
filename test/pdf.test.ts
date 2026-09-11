import { PDFDocument, StandardFonts } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { generateCiiXml } from '../src/index.js';
import { embedFacturX, extractFacturX } from '../src/pdf.js';
import { exampleInvoice } from './fixtures/example-invoice.js';

async function blankInvoicePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('Invoice INV-2026-0042', { x: 50, y: 780, size: 18, font });
  return doc.save();
}

describe('embedFacturX / extractFacturX', () => {
  it('round-trips the XML through a PDF', async () => {
    const xml = generateCiiXml(exampleInvoice);
    const pdf = await embedFacturX(await blankInvoicePdf(), xml, { date: new Date('2026-03-31T10:00:00Z'), title: 'Invoice INV-2026-0042' });
    const text = new TextDecoder('latin1').decode(pdf);

    expect(text).toContain('/AFRelationship /Alternative');
    expect(text).toContain('factur-x.xml');
    expect(text).toContain('<fx:ConformanceLevel>BASIC</fx:ConformanceLevel>');
    expect(text).toContain('<pdfaid:part>3</pdfaid:part>');
    expect(text).toContain('urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#');

    const extracted = await extractFacturX(pdf);
    expect(extracted?.filename).toBe('factur-x.xml');
    expect(extracted?.xml).toBe(xml);
  });

  it('writes the conformance level of the requested profile', async () => {
    const pdf = await embedFacturX(await blankInvoicePdf(), '<x/>', { profile: 'en16931' });
    expect(new TextDecoder('latin1').decode(pdf)).toContain('<fx:ConformanceLevel>EN 16931</fx:ConformanceLevel>');
  });

  it('returns null for a PDF without invoice data', async () => {
    expect(await extractFacturX(await blankInvoicePdf())).toBeNull();
  });
});
