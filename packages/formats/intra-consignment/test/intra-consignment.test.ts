import { describe, expect, it } from 'vitest';
import {
  CURRENCY,
  OPERATION_CODES,
  generateIntraConsignment,
  intraConsignmentFileName,
  type StatementRow,
} from '../src/index.js';

const declarant = {
  vatNumber: '0999999999',
  name: 'Demo SRL',
  street: 'Rue de la Demo 1',
  postCode: '1000',
  city: 'Bruxelles',
  countryCode: 'BE',
} as const;

const period = { year: 2026, quarter: 3 } as const;

function row(over: Partial<StatementRow> = {}): StatementRow {
  return {
    vat_country: 'NL',
    vat_number: '999999999B01',
    nature: 'goods',
    amount: '8000.00',
    currency_code: 'EUR',
    issue: null,
    contact_names: ['Studio Cobalt BV'],
    ...over,
  };
}

describe('the codes are the ones the directives fix', () => {
  it('has L, T and S, and nothing else', () => {
    expect(OPERATION_CODES).toEqual({ goods: 'L', triangular: 'T', services: 'S' });
  });
});

describe('the listing', () => {
  it('writes one client element per line, in the schema order', () => {
    const { file, violations } = generateIntraConsignment(
      [row(), row({ nature: 'services', amount: '3500.00' })],
      { declarant, period, declarantReference: 'T3-2026' },
    );

    expect(violations).toEqual([]);
    expect(file).toContain('<ns2:IntraConsignment');
    expect(file).toContain('xmlns:ns2="http://www.minfin.fgov.be/IntraConsignment"');
    expect(file).toContain('xmlns="http://www.minfin.fgov.be/InputCommon"');
    expect(file).toContain('IntraListingsNbr="1"');
    expect(file).toContain('ClientsNbr="2"');
    expect(file).toContain('AmountSum="11500.00"');
    expect(file).toContain('DeclarantReference="T3-2026"');
    // The declarant's own children are unprefixed, so they fall in the
    // InputCommon default namespace declared on the root.
    expect(file).toContain('<VATNumber>0999999999</VATNumber>');
    expect(file).toContain('<ns2:Quarter>3</ns2:Quarter>');
    expect(file).toContain('<ns2:Year>2026</ns2:Year>');
    expect(file).toContain('<ns2:CompanyVATNumber issuedBy="NL">999999999B01</ns2:CompanyVATNumber>');
    expect(file).toContain('<ns2:Code>L</ns2:Code>');
    expect(file).toContain('<ns2:Code>S</ns2:Code>');
    expect(file).toContain('<ns2:Amount>8000.00</ns2:Amount>');

    // The sequence the schema fixes: Declarant, Period, then the clients.
    const order = ['<ns2:Declarant>', '<ns2:Period>', '<ns2:IntraClient'].map((tag) =>
      file.indexOf(tag),
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('writes amounts with a point and two decimals, whatever the input looked like', () => {
    const { file } = generateIntraConsignment([row({ amount: 8000 })], { declarant, period });
    expect(file).toContain('<ns2:Amount>8000.00</ns2:Amount>');
    expect(file).not.toContain('8000,00');
  });

  it('strips punctuation and case from a number somebody typed by hand', () => {
    const { file } = generateIntraConsignment(
      [row({ vat_number: ' 9999 99999 b01 ', vat_country: 'nl' })],
      { declarant, period },
    );
    expect(file).toContain('issuedBy="NL"');
    expect(file).toContain('>999999999B01<');
  });

  it('reports a number that still carries its country prefix rather than guessing', () => {
    // The rows this reads carry the prefix in `vat_country` and the number
    // without it. A number that kept its prefix overflows the twelve
    // characters the schema holds, and saying so is better than stripping two
    // characters that might be part of the number.
    const { violations } = generateIntraConsignment(
      [row({ vat_number: 'NL999999999B01' })],
      { declarant, period },
    );
    expect(violations[0]?.code).toBe('vat_number_too_long');
  });

  it('keeps the same number on two lines when two categories were supplied', () => {
    const { file } = generateIntraConsignment(
      [row({ nature: 'services', amount: '1000.00' }), row({ nature: 'goods', amount: '2000.00' })],
      { declarant, period },
    );
    expect(file.match(/999999999B01/g)).toHaveLength(2);
    // Sorted by customer then by code, so L comes before S.
    expect(file.indexOf('<ns2:Code>L</ns2:Code>')).toBeLessThan(file.indexOf('<ns2:Code>S</ns2:Code>'));
  });

  it('escapes what a name can carry', () => {
    const { file } = generateIntraConsignment([row()], {
      declarant: { ...declarant, name: 'Demo & Co <SRL>' },
      period,
    });
    expect(file).toContain('<Name>Demo &amp; Co &lt;SRL&gt;</Name>');
  });

  it('names a month when the listing is monthly', () => {
    const { file, filename } = generateIntraConsignment([row()], {
      declarant,
      period: { year: 2026, month: 8 },
    });
    expect(file).toContain('<ns2:Month>8</ns2:Month>');
    expect(filename).toBe('IntraConsignment-0999999999-2026M08.xml');
  });
});

describe('what it reports rather than files', () => {
  it('passes on the reason the producer already gave', () => {
    const { file, violations } = generateIntraConsignment(
      [row({ issue: 'no_vat_number', vat_country: null, vat_number: null, contact_names: ['Nameless BV'] })],
      { declarant, period },
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.code).toBe('no_vat_number');
    expect(violations[0]?.message).toContain('Nameless BV');
    expect(file).toContain('ClientsNbr="0"');
    expect(file).toContain('AmountSum="0.00"');
  });

  it('refuses a customer in the declarant country', () => {
    const { violations } = generateIntraConsignment(
      [row({ vat_country: 'BE', vat_number: '0999999998' })],
      { declarant, period },
    );
    expect(violations[0]?.code).toBe('vat_country_is_the_declarant_country');
  });

  it('refuses a number longer than the schema holds', () => {
    const { violations } = generateIntraConsignment(
      [row({ vat_number: '9999999999999' })],
      { declarant, period },
    );
    expect(violations[0]?.code).toBe('vat_number_too_long');
  });

  it('leaves out a customer whose balance is nil, and says so', () => {
    const { file, violations } = generateIntraConsignment([row({ amount: '0.00' })], {
      declarant,
      period,
    });
    expect(violations[0]?.code).toBe('nil_balance');
    expect(file).toContain('ClientsNbr="0"');
  });

  it('refuses a nature it has no code for', () => {
    const { violations } = generateIntraConsignment([row({ nature: 'call_off_stock' })], {
      declarant,
      period,
    });
    expect(violations[0]?.code).toBe('unknown_nature');
  });

  it('refuses a currency the form has no field for', () => {
    const { violations } = generateIntraConsignment([row({ currency_code: 'CHF' })], {
      declarant,
      period,
    });
    expect(violations[0]?.code).toBe('wrong_currency');
    expect(violations[0]?.message).toContain(CURRENCY);
  });

  it('keeps the total of what it did file, so the file balances against itself', () => {
    const { file, violations } = generateIntraConsignment(
      [row({ amount: '1000.00' }), row({ issue: 'no_vat_number' }), row({ amount: '500.00' })],
      { declarant, period },
    );
    expect(violations).toHaveLength(1);
    expect(file).toContain('ClientsNbr="2"');
    expect(file).toContain('AmountSum="1500.00"');
  });
});

describe('what it refuses outright', () => {
  it('will not write a listing that is neither a month nor a quarter', () => {
    expect(() => generateIntraConsignment([], { declarant, period: { year: 2026 } })).toThrow(
      /one month or one quarter/,
    );
    expect(() =>
      generateIntraConsignment([], { declarant, period: { year: 2026, month: 3, quarter: 1 } }),
    ).toThrow(/one month or one quarter/);
  });

  it('will not write a listing for a declarant number the schema cannot hold', () => {
    expect(() =>
      generateIntraConsignment([], { declarant: { vatNumber: '999' }, period }),
    ).toThrow(/ten digits/);
  });

  it('takes the declarant number with or without its country prefix', () => {
    const { file } = generateIntraConsignment([], {
      declarant: { ...declarant, vatNumber: 'BE 0999.999.999' },
      period,
    });
    expect(file).toContain('<VATNumber>0999999999</VATNumber>');
  });
});

describe('the file name', () => {
  it('is ours, and says which period it covers', () => {
    expect(intraConsignmentFileName('BE0999999999', { year: 2026, quarter: 4 })).toBe(
      'IntraConsignment-BE0999999999-2026Q4.xml',
    );
  });
});
