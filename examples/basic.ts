/**
 * Generate the XML, draw a one-page PDF, embed the XML, read it back.
 *
 *   npm run example   → writes ./INV-2026-0042.pdf and ./INV-2026-0042.xml
 */
import { writeFileSync } from 'node:fs';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { computeTotals, generateCiiXml } from '../src/index.js';
import { embedFacturX, extractFacturX } from '../src/pdf.js';
import { exampleInvoice } from '../test/fixtures/example-invoice.js';

const xml = generateCiiXml(exampleInvoice);
writeFileSync(`${exampleInvoice.number}.xml`, xml);

const doc = await PDFDocument.create();
const page = doc.addPage([595, 842]);
const font = await doc.embedFont(StandardFonts.Helvetica);
const totals = computeTotals(exampleInvoice);
page.drawText(`Invoice ${exampleInvoice.number}`, { x: 50, y: 780, size: 18, font });
page.drawText(`${exampleInvoice.seller.name} to ${exampleInvoice.buyer.name}`, { x: 50, y: 750, size: 11, font });
page.drawText(`Total due: ${totals.duePayable.toFixed(2)} EUR`, { x: 50, y: 720, size: 11, font });

const pdf = await embedFacturX(await doc.save(), xml, { title: `Invoice ${exampleInvoice.number}` });
writeFileSync(`${exampleInvoice.number}.pdf`, pdf);

const back = await extractFacturX(pdf);
console.log(`✓ ${exampleInvoice.number}.pdf — ${pdf.length} bytes, embedded ${back?.filename} (${back?.xml.length} chars)`);
