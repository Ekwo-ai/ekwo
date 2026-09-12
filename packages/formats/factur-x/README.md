# @ekwo-ai/factur-x

Factur-X / ZUGFeRD electronic invoices in TypeScript.

- **CII XML from a plain invoice object.** EN 16931 semantic model, UN/CEFACT CII D16B
  syntax, element order of the schema, VAT breakdown rules (`BR-S`, `BR-Z`, `BR-E`, `BR-AE`,
  `BR-IC`, `BR-G`, `BR-O`). Profiles MINIMUM, BASIC WL, BASIC (default), EN 16931, EXTENDED.
- **PDF/A-3 embedding.** Attaches the XML as `factur-x.xml` with `AFRelationship /Alternative`
  and writes the XMP packet with the Factur-X extension schema.
- **Extraction.** Reads `factur-x.xml` or `zugferd-invoice.xml` back from any PDF.
- **Totals you can trust.** One VAT group per category and rate, VAT computed on the rounded
  basis, prepayments, credit notes referencing the original invoice.
- Zero dependencies for the XML part; `pdf-lib` only for the PDF part (separate entry point).

## Install

```sh
npm install @ekwo-ai/factur-x
```

## Usage

```ts
import { generateCiiXml, computeTotals } from '@ekwo-ai/factur-x';
import { embedFacturX, extractFacturX } from '@ekwo-ai/factur-x/pdf';

const invoice = {
  number: 'INV-2026-0042',
  issueDate: '2026-03-31',
  dueDate: '2026-04-30',
  seller: {
    name: 'Exemple Conseil SA',
    vatId: 'BE0123456749',
    legalId: { scheme: '0208', value: '0123456749' },   // Belgian enterprise number
    address: { line1: "Rue de l'Exemple 1", postalCode: '1000', city: 'Bruxelles', country: 'BE' },
  },
  buyer: {
    name: 'Société Fictive SAS',
    vatId: 'FR12345678901',
    legalId: { scheme: '0002', value: '345678901' },    // SIREN
    address: { line1: '10 avenue des Tests', postalCode: '75001', city: 'Paris', country: 'FR' },
  },
  buyerReference: 'SERVICE-EXEC-42',
  lines: [
    { name: 'Consulting days', quantity: 3, unitCode: 'day', unitPrice: 950, vatRate: 0 },
    { name: 'Software licence', quantity: 1, unitPrice: 1200, vatRate: 0 },
  ],
  payment: { iban: 'BE71 0961 2345 6769' },
};

const xml = generateCiiXml(invoice);                       // BASIC profile
const totals = computeTotals(invoice);                     // { lineTotal, taxTotal, grandTotal, duePayable, breakdown }

const pdf = await embedFacturX(visualPdfBytes, xml, { title: 'Invoice INV-2026-0042' });
const back = await extractFacturX(pdf);                    // { filename: 'factur-x.xml', xml }
```

`npm run example` runs [`examples/basic.ts`](examples/basic.ts) end to end.

### VAT categories

Each line carries a `vatRate`. The category (BT-151) is derived when you do not state it:
positive rate → `S`; zero rate at home → `Z`; zero rate to an EU business with a VAT id → `K`
(intra-community); to an EU buyer without one → `E`; outside the EU → `G`. Set `vatCategory`
on the line to override (`AE` reverse charge, `O` not subject to VAT…). Exempt groups get a
reason text (BT-120, override with `invoice.exemptionReasons`) and the VATEX code where one
exists.

### Identifiers

| Field | Example | XML |
|---|---|---|
| `vatId` | `BE0123456749`, `FR12345678901` | `SpecifiedTaxRegistration/ID[@schemeID="VA"]` |
| `legalId` | `{ scheme: '0208', value: '0123456749' }` (BE), `{ scheme: '0002', value: '345678901' }` (FR SIREN) | `SpecifiedLegalOrganization/ID[@schemeID]` |
| `buyerReference` | French « service exécutant » code | `BuyerReference` (BT-10) |
| `orderReference` | purchase order | `BuyerOrderReferencedDocument` (BT-13) |

### Units

`unitCode` accepts a UN/ECE Recommendation 20 code (`HUR`, `DAY`, `KWH`…) or an everyday
word in French, Dutch, English or German (`heures`, `dagen`, `m²`, `Stück`). Unknown values fall
back to `C62` (unit). See `UNIT_CODES` and `toUnitCode`.

## API

| Export | Description |
|---|---|
| `generateCiiXml(invoice, { profile?, businessProcess? })` | CII XML string. |
| `computeTotals(invoice)` | VAT breakdown and document totals (BT-106 … BT-117). |
| `defaultVatCategory`, `EXEMPTION_REASON_CODES`, `DEFAULT_EXEMPTION_REASONS` | VAT helpers. |
| `toUnitCode`, `UNIT_CODES` | Unit helpers. |
| `buildXmpMetadata`, `CONFORMANCE_LEVELS`, `GUIDELINES`, `DOCUMENT_TYPE_CODES` | Constants of the specification. |
| `embedFacturX(pdf, xml, { profile?, title?, creator?, producer?, date? })` *(`/pdf`)* | Returns a new PDF with the XML attached and the PDF/A-3 XMP packet. |
| `extractFacturX(pdf)` *(`/pdf`)* | `{ filename, xml }` or `null`. |

## Scope and limitations

- Allowances and charges (BG-20, BG-21, BG-27, BG-28), gross prices with discounts and
  multiple deliveries are not modelled yet.
- The PDF part embeds the data and declares PDF/A-3; it does not convert the visual PDF to
  PDF/A (fonts, colour profiles, output intent). Validate the result with the tool of your
  platform before going live.
- No XSD or Schematron validation is performed. Test against a validator such as the FNFE
  Factur-X validator or the Mustang project.

## Development

```sh
npm install
npm run typecheck
npm test
npm run build
```

## License

[MIT](LICENSE) © Ekwo AI
