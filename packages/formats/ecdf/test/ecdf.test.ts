import { describe, expect, it } from 'vitest';
import {
  FORMS,
  fileReference,
  formatAmount,
  generateEcdf,
  type EcdfOptions,
  type StatementRow,
} from '../src/index.js';

const party = { matrNbr: '19999999999', rcsNbr: 'B999999', vatNbr: '99999999' } as const;

const options: EcdfOptions = {
  prefix: '000000',
  interfaceId: 'DEMO',
  agent: party,
  declarer: party,
  cadence: 'quarter',
  year: 2026,
  period: 3,
  createdAt: new Date(Date.UTC(2026, 8, 30, 10, 15, 44)),
};

function row(over: Partial<StatementRow> = {}): StatementRow {
  return {
    vat_country: 'DE',
    vat_number: '999999999',
    nature: 'goods',
    amount: '7000.00',
    currency_code: 'EUR',
    issue: null,
    contact_names: ['Werkstatt Nordlicht GmbH'],
    ...over,
  };
}

describe('the four forms', () => {
  it('are the ones eCDF names, one per nature and per cadence', () => {
    expect(FORMS).toEqual({
      goods: { month: 'TVA_LICM', quarter: 'TVA_LICT' },
      services: { month: 'TVA_PSIM', quarter: 'TVA_PSIT' },
    });
  });
});

describe('the envelope', () => {
  it('writes the header in the order the schema fixes', () => {
    const { file } = generateEcdf([row()], options);
    const order = [
      '<eCDFDeclarations',
      '<FileReference>',
      '<eCDFFileVersion>',
      '<Interface>',
      '<Agent>',
      '<Declarations>',
      '<Declarer>',
      '<Declaration ',
    ].map((tag) => file.indexOf(tag));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order.every((position) => position >= 0)).toBe(true);
    expect(file).toContain('xmlns="http://www.ctie.etat.lu/2011/ecdf"');
    expect(file).toContain('<eCDFFileVersion>2.0</eCDFFileVersion>');
  });

  it('names the file after its own reference', () => {
    const { filename, fileReference: reference } = generateEcdf([row()], options);
    expect(reference).toBe('000000X20260930T10154401');
    expect(filename).toBe('000000X20260930T10154401.xml');
  });

  it('builds a reference the schema pattern accepts', () => {
    const reference = fileReference('00AB12', new Date(Date.UTC(2026, 0, 2, 3, 4, 5)), 7);
    expect(reference).toBe('00AB12X20260102T03040507');
    expect(reference).toMatch(/^[0-9A-Z]{6}[XB][0-9]{4}[0-1][0-9][0-3][0-9]T[0-2][0-9][0-5][0-9][0-5][0-9][0-9]{2}$/);
  });
});

describe('the declarations', () => {
  it('writes one form per nature, and only the ones that have something', () => {
    const goodsOnly = generateEcdf([row()], options);
    expect(goodsOnly.declarations).toEqual(['TVA_LICT']);

    const both = generateEcdf([row(), row({ nature: 'services', amount: '3500.00' })], options);
    expect(both.declarations).toEqual(['TVA_LICT', 'TVA_PSIT']);
    expect(both.file).toContain('<Declaration type="TVA_LICT" model="1" language="FR">');
    expect(both.file).toContain('<Declaration type="TVA_PSIT" model="1" language="FR">');
  });

  it('takes the monthly forms when the cadence is a month', () => {
    const { declarations } = generateEcdf(
      [row(), row({ nature: 'services' })],
      { ...options, cadence: 'month', period: 8 },
    );
    expect(declarations).toEqual(['TVA_LICM', 'TVA_PSIM']);
  });

  it('puts every simple field before the first table', () => {
    const { file } = generateEcdf([row()], options);
    const lastField = file.lastIndexOf('<NumericField id="16">');
    expect(lastField).toBeGreaterThan(-1);
    expect(lastField).toBeLessThan(file.indexOf('<Table>'));
  });

  it('writes the country and the number as two fields, never joined', () => {
    const { file } = generateEcdf([row()], options);
    expect(file).toContain('<TextField id="01">DE</TextField>');
    expect(file).toContain('<TextField id="02">999999999</TextField>');
    expect(file).not.toContain('DE999999999');
  });

  it('totals each state in the field that prints above it', () => {
    const { file } = generateEcdf(
      [row({ amount: '7000.00' }), row({ nature: 'triangular', amount: '500.00' })],
      options,
    );
    expect(file).toContain('<NumericField id="04">7000,00</NumericField>');
    expect(file).toContain('<NumericField id="08">500,00</NumericField>');
    expect(file).toContain('<NumericField id="07">500,00</NumericField>');
  });

  it('leaves out an empty table and keeps its total at zero', () => {
    const { file } = generateEcdf([row()], options);
    expect(file).toContain('<NumericField id="08">0,00</NumericField>');
    expect(file).not.toContain('<TextField id="05">');
  });

  it('numbers the lines of a table from one', () => {
    const { file } = generateEcdf(
      [row(), row({ vat_country: 'BE', vat_number: '0999999999' })],
      options,
    );
    expect(file).toContain('<Line num="1">');
    expect(file).toContain('<Line num="2">');
  });
});

describe('amounts', () => {
  it('uses a comma and two decimals, never a point', () => {
    expect(formatAmount('7000')).toBe('7000,00');
    expect(formatAmount(1234.5)).toBe('1234,50');
    expect(formatAmount(-300)).toBe('-300,00');
  });

  it('writes no thousands separator', () => {
    const { file } = generateEcdf([row({ amount: '1234567.89' })], options);
    expect(file).toContain('>1234567,89<');
  });
});

describe('what it reports rather than declares', () => {
  it('passes on the reason the producer already gave', () => {
    const { violations } = generateEcdf(
      [row({ issue: 'no_vat_number', vat_country: null, vat_number: null, contact_names: ['Nameless'] })],
      options,
    );
    expect(violations[0]?.code).toBe('no_vat_number');
    expect(violations[0]?.message).toContain('Nameless');
  });

  it('refuses a customer registered under the declarer own number', () => {
    const { violations } = generateEcdf(
      [row({ vat_country: 'LU', vat_number: '99999999' })],
      options,
    );
    expect(violations[0]?.code).toBe('vat_number_is_the_declarer');
  });

  it('says so when no form came out at all', () => {
    const { declarations, violations } = generateEcdf(
      [row({ issue: 'no_vat_number' })],
      options,
    );
    expect(declarations).toEqual([]);
    expect(violations.map((v) => v.code)).toContain('nothing_to_declare');
  });

  it('refuses a nature no state of the forms carries', () => {
    const { violations } = generateEcdf([row({ nature: 'call_off_stock' })], options);
    expect(violations[0]?.code).toBe('unknown_nature');
  });

  it('refuses a currency the forms have no field for', () => {
    const { violations } = generateEcdf([row({ currency_code: 'CHF' })], options);
    expect(violations[0]?.code).toBe('wrong_currency');
  });
});

describe('what it refuses outright', () => {
  it('will not write a file without an interface identifier', () => {
    expect(() => generateEcdf([], { ...options, interfaceId: '' })).toThrow(/interface identifier/);
  });

  it('will not write a prefix of the wrong length', () => {
    expect(() => generateEcdf([], { ...options, prefix: '123' })).toThrow(/six characters/);
  });

  it('will not write a quarter numbered like a month', () => {
    expect(() => generateEcdf([], { ...options, period: 8 })).toThrow(/quarter is 1 to 4/);
  });

  it('will not write a VAT number that still carries its country prefix', () => {
    expect(() =>
      generateEcdf([], { ...options, declarer: { ...party, vatNbr: 'LU99999999' } }),
    ).toThrow(/eight digits without LU/);
  });

  it('takes NE where a party has no registration', () => {
    const { file } = generateEcdf([row()], {
      ...options,
      declarer: { matrNbr: '19999999999', rcsNbr: 'NE', vatNbr: 'NE' },
    });
    expect(file).toContain('<RCSNbr>NE</RCSNbr>');
  });
});
