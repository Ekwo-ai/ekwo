import { describe, expect, it } from 'vitest';
import { COLUMNS, generateVd, roundToEuro, vdFileName, type StatementRow } from '../src/index.js';

const options = { registryCode: '19999999', year: 2026, month: 2 } as const;

function row(over: Partial<StatementRow> = {}): StatementRow {
  return {
    vat_country: 'FI',
    vat_number: '99999999',
    nature: 'goods',
    amount: '4200.00',
    currency_code: 'EUR',
    issue: null,
    contact_names: ['Aurinkolahden Kauppa Oy'],
    ...over,
  };
}

describe('the three columns', () => {
  it('are the ones the form prints', () => {
    expect(COLUMNS).toEqual({ goods: 'kaup', triangular: 'kolmnurktehing', services: 'teenusteMyyk' });
  });
});

describe('the report', () => {
  it('writes the header the schema fixes, with only the root qualified', () => {
    const { file } = generateVd([row()], options);
    expect(file).toContain('<v1:VD_deklaratsioon xmlns:v1="http://www.emta.ee/VD/xsd/webimport/v1">');
    expect(file).toContain('<deklareerijaKood>19999999</deklareerijaKood>');
    expect(file).toContain('<perioodAasta>2026</perioodAasta>');
    expect(file).toContain('<perioodKuu>2</perioodKuu>');
    // The children are bare: elementFormDefault is unqualified.
    expect(file).not.toContain('<v1:aruandeRida>');
  });

  it('carries the country as an attribute and the number without its prefix', () => {
    const { file } = generateVd([row()], options);
    expect(file).toContain('<kmkrKood riik="FI">99999999</kmkrKood>');
  });

  it('writes whole euros, no decimals', () => {
    const { file } = generateVd([row({ amount: '4200.49' })], options);
    expect(file).toContain('<kaup>4200</kaup>');
    expect(file).not.toMatch(/<kaup>[^<]*[.,]/);
  });

  it('reports a credit note as a negative value', () => {
    const { file, violations } = generateVd([row({ amount: '-1500' })], options);
    expect(violations).toEqual([]);
    expect(file).toContain('<kaup>-1500</kaup>');
  });
});

describe('one row per acquirer', () => {
  it('merges goods and services for the same number onto one row', () => {
    const { file } = generateVd(
      [row({ amount: '4200' }), row({ nature: 'services', amount: '1800' })],
      options,
    );
    expect(file.match(/<aruandeRida>/g)).toHaveLength(1);
    expect(file).toContain('<kaup>4200</kaup>');
    expect(file).toContain('<teenusteMyyk>1800</teenusteMyyk>');
  });

  it('writes the three columns in the order the schema fixes', () => {
    const { file } = generateVd(
      [
        row({ nature: 'services', amount: '1800' }),
        row({ nature: 'triangular', amount: '15' }),
        row({ amount: '4200' }),
      ],
      options,
    );
    const order = ['<kaup>', '<kolmnurktehing>', '<teenusteMyyk>'].map((tag) => file.indexOf(tag));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('leaves out the columns that came to nothing', () => {
    const { file } = generateVd([row()], options);
    expect(file).not.toContain('<teenusteMyyk>');
    expect(file).not.toContain('<kolmnurktehing>');
  });

  it('adds up two supplies of the same nature to the same acquirer', () => {
    const { file } = generateVd([row({ amount: '1000' }), row({ amount: '200' })], options);
    expect(file.match(/<aruandeRida>/g)).toHaveLength(1);
    expect(file).toContain('<kaup>1200</kaup>');
  });

  it('keeps two acquirers apart, in order', () => {
    const { file } = generateVd(
      [row({ vat_country: 'LT', vat_number: '1111111' }), row()],
      options,
    );
    expect(file.match(/<aruandeRida>/g)).toHaveLength(2);
    expect(file.indexOf('riik="FI"')).toBeLessThan(file.indexOf('riik="LT"'));
  });
});

describe('rounding', () => {
  it('drops what is below half a euro and counts half a euro for one', () => {
    expect(roundToEuro('0.49')).toBe(0);
    expect(roundToEuro('0.50')).toBe(1);
  });

  it('rounds a credit note away from zero', () => {
    expect(roundToEuro('-0.50')).toBe(-1);
  });
});

describe('what it reports rather than files', () => {
  it('passes on the reason the producer already gave', () => {
    const { violations } = generateVd(
      [row({ issue: 'no_vat_number', vat_country: null, vat_number: null, contact_names: ['Nimeta'] })],
      options,
    );
    expect(violations[0]?.code).toBe('no_vat_number');
    expect(violations[0]?.message).toContain('Nimeta');
  });

  it('refuses an acquirer registered under the declarer own code', () => {
    const { violations } = generateVd(
      [row({ vat_country: 'EE', vat_number: '19999999' })],
      options,
    );
    expect(violations[0]?.code).toBe('vat_number_is_the_declarer');
  });

  it('refuses a number the schema cannot hold', () => {
    const { violations } = generateVd([row({ vat_number: '9999999999999' })], options);
    expect(violations[0]?.code).toBe('vat_number_shape');
  });

  it('keeps a number with the + and * the schema allows', () => {
    const { file, violations } = generateVd([row({ vat_number: 'X99+99*9' })], options);
    expect(violations).toEqual([]);
    expect(file).toContain('>X99+99*9<');
  });

  it('leaves out an acquirer whose every amount rounds to nothing', () => {
    const { file, violations } = generateVd([row({ amount: '0.4' })], options);
    expect(violations[0]?.code).toBe('nil_amounts');
    expect(file).not.toContain('<aruandeRida>');
  });

  it('refuses a nature the form has no column for', () => {
    const { violations } = generateVd([row({ nature: 'call_off_stock' })], options);
    expect(violations[0]?.code).toBe('unknown_nature');
  });

  it('refuses a currency the form has no field for', () => {
    const { violations } = generateVd([row({ currency_code: 'SEK' })], options);
    expect(violations[0]?.code).toBe('wrong_currency');
  });
});

describe('what it refuses outright', () => {
  it('will not write a month outside the year', () => {
    expect(() => generateVd([], { ...options, month: 0 })).toThrow(/month out of range/);
  });

  it('will not write a registry code the schema cannot hold', () => {
    expect(() => generateVd([], { ...options, registryCode: '123456789012' })).toThrow(
      /one to eleven characters/,
    );
  });
});

describe('the file name', () => {
  it('is ours, and says which month it covers', () => {
    expect(vdFileName('19999999', 2026, 2)).toBe('VD-19999999-202602.xml');
  });
});
