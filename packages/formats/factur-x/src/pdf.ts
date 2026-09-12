/**
 * PDF side of Factur-X: attach the CII XML to a PDF as `factur-x.xml` with
 * `AFRelationship /Alternative`, declare the document as PDF/A-3 in XMP, and
 * read the XML back from an existing Factur-X / ZUGFeRD file.
 *
 * Only this module depends on `pdf-lib`; import it from `@ekwo-ai/factur-x/pdf`.
 */
import {
  AFRelationship,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRawStream,
  PDFString,
  decodePDFRawStream,
} from 'pdf-lib';
import type { Profile } from './types.js';
import { buildXmpMetadata } from './xmp.js';

export const FACTURX_FILENAME = 'factur-x.xml';
/** File name used by ZUGFeRD 2.x documents; accepted when reading. */
export const ZUGFERD_FILENAME = 'zugferd-invoice.xml';

export interface EmbedOptions {
  /** Defaults to `"basic"`. Must match the guideline used for the XML. */
  profile?: Profile;
  title?: string;
  creator?: string;
  producer?: string;
  /** Timestamp for the attachment and the XMP packet. Defaults to now. */
  date?: Date;
}

/**
 * Returns a copy of `pdf` carrying `xml` as `factur-x.xml`.
 *
 * The visual PDF itself is left untouched: fonts, colour profiles and output
 * intents are the responsibility of the producer of the original file. Strict
 * PDF/A-3 validators may still flag those; the invoice data is embedded and
 * readable, which is what e-invoicing platforms check.
 */
export async function embedFacturX(
  pdf: Uint8Array | ArrayBuffer,
  xml: string,
  options: EmbedOptions = {},
): Promise<Uint8Array> {
  const profile = options.profile ?? 'basic';
  const date = options.date ?? new Date();
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });

  await doc.attach(new TextEncoder().encode(xml), FACTURX_FILENAME, {
    mimeType: 'text/xml',
    description: 'Factur-X invoice data (CII)',
    creationDate: date,
    modificationDate: date,
    afRelationship: AFRelationship.Alternative,
  });

  const xmp = new TextEncoder().encode(buildXmpMetadata({ profile, ...options, date }));
  const stream = doc.context.stream(xmp, { Type: 'Metadata', Subtype: 'XML', Length: xmp.length });
  doc.catalog.set(PDFName.of('Metadata'), doc.context.register(stream));

  if (options.title) doc.setTitle(options.title);
  if (options.creator) doc.setCreator(options.creator);
  doc.setProducer(options.producer ?? '@ekwo-ai/factur-x');
  doc.setModificationDate(date);

  return doc.save({ useObjectStreams: false });
}

export interface ExtractedInvoice {
  filename: string;
  xml: string;
}

/**
 * Reads the embedded invoice XML (`factur-x.xml` or `zugferd-invoice.xml`)
 * from a PDF. Returns `null` when the file carries none.
 */
export async function extractFacturX(pdf: Uint8Array | ArrayBuffer): Promise<ExtractedInvoice | null> {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false, ignoreEncryption: true });
  const names = doc.catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
  const embedded = names?.lookupMaybe(PDFName.of('EmbeddedFiles'), PDFDict);
  if (!embedded) return null;

  const wanted = new Set([FACTURX_FILENAME, ZUGFERD_FILENAME]);
  for (const [name, spec] of walkNameTree(doc, embedded)) {
    if (!wanted.has(name)) continue;
    const ef = spec.lookupMaybe(PDFName.of('EF'), PDFDict);
    const candidate = ef?.lookup(PDFName.of('UF')) ?? ef?.lookup(PDFName.of('F'));
    if (!(candidate instanceof PDFRawStream)) continue;
    const stream = candidate;
    const bytes = decodePDFRawStream(stream).decode();
    return { filename: name, xml: new TextDecoder('utf-8').decode(bytes) };
  }
  return null;
}

/** Yields `[fileName, fileSpecification]` pairs of an EmbeddedFiles name tree. */
function* walkNameTree(doc: PDFDocument, node: PDFDict): Generator<[string, PDFDict]> {
  const names = node.lookupMaybe(PDFName.of('Names'), PDFArray);
  if (names) {
    for (let i = 0; i + 1 < names.size(); i += 2) {
      const spec = names.lookup(i + 1);
      if (!(spec instanceof PDFDict)) continue;
      const text = (o: unknown) => (o instanceof PDFString || o instanceof PDFHexString ? o.decodeText() : undefined);
      const name = text(spec.lookup(PDFName.of('UF'))) ?? text(spec.lookup(PDFName.of('F'))) ?? text(names.lookup(i)) ?? '';
      yield [name, spec];
    }
  }
  const kids = node.lookupMaybe(PDFName.of('Kids'), PDFArray);
  if (kids) {
    for (let i = 0; i < kids.size(); i++) {
      const kid = kids.lookupMaybe(i, PDFDict);
      if (kid) yield* walkNameTree(doc, kid);
    }
  }
}
