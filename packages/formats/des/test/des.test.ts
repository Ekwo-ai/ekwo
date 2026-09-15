import { describe, expect, it } from 'vitest';
import { desFileName, generateDes, roundToEuro, type StatementRow } from '../src/index.js';

const options = { vatNumber: 'FRKK999999999', year: 2026, month: 8 } as const;

function row(over: Partial<StatementRow> = {}): StatementRow {
  return {
    vat_country: 'BE',
    vat_number: '0999999999',
    nature: 'services',
    amount: '3500.00',
    currency_code: 'EUR',
    issue: null,
    contact_names: ['Studio Cobalt SRL'],
    ...over,
  };
}

describe('the declaration', () => {
  it('writes the tags in the order the cahier des charges fixes', () => {
    const { file, violations } = generateDes([row()], options);
    expect(violations).toEqual([]);

    const order = [
      '<fichier_des>',
      '<declaration_des>',
      '<num_des>',
      '<num_tvaFr>',
      '<mois_des>',
      '<an_des>',
      '<ligne_des>',
      '<numlin_des>',
      '<valeur>',
      '<partner_des>',
    ].map((tag) => file.indexOf(tag));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order.every((position) => position >= 0)).toBe(true);
  });

  it('writes the header the format asks for', () => {
    const { file } = generateDes([row()], options);
    expect(file).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(file).toContain('<num_tvaFr>FRKK999999999</num_tvaFr>');
    expect(file).toContain('<mois_des>08</mois_des>');
    expect(file).toContain('<an_des>2026</an_des>');
    expect(file).toContain('<numlin_des>000001</numlin_des>');
  });

  it('carries the customer number with its country prefix, which the listing splits off', () => {
    const { file } = generateDes([row()], options);
    expect(file).toContain('<partner_des>BE0999999999</partner_des>');
  });

  it('writes whole euros and no decimals', () => {
    const { file } = generateDes([row({ amount: '3500.49' })], options);
    expect(file).toContain('<valeur>3500</valeur>');
    expect(file).not.toMatch(/<valeur>[^<]*[.,]/);
  });

  it('declares a minoration as a negative value', () => {
    const { file, violations } = generateDes([row({ amount: '-5000.00' })], options);
    expect(violations).toEqual([]);
    expect(file).toContain('<valeur>-5000</valeur>');
  });

  it('numbers its lines from one, in sequence', () => {
    const { file } = generateDes(
      [row(), row({ vat_country: 'DE', vat_number: '999999999' })],
      options,
    );
    expect(file).toContain('<numlin_des>000001</numlin_des>');
    expect(file).toContain('<numlin_des>000002</numlin_des>');
  });
});

describe('rounding', () => {
  it('drops what is below half a euro and counts half a euro for one', () => {
    expect(roundToEuro('0.49')).toBe(0);
    expect(roundToEuro('0.50')).toBe(1);
    expect(roundToEuro('1.49')).toBe(1);
    expect(roundToEuro('1.50')).toBe(2);
  });

  it('rounds a minoration away from zero, not towards it', () => {
    expect(roundToEuro('-0.50')).toBe(-1);
    expect(roundToEuro('-1.50')).toBe(-2);
  });
});

describe('what it reports rather than declares', () => {
  it('sends goods to the other file, by name', () => {
    const { file, violations } = generateDes([row({ nature: 'goods' })], options);
    expect(violations[0]?.code).toBe('not_a_service');
    expect(violations[0]?.message).toContain('état récapitulatif TVA');
    expect(file).not.toContain('<ligne_des>');
  });

  it('sends a triangular operation there too', () => {
    const { violations } = generateDes([row({ nature: 'triangular' })], options);
    expect(violations[0]?.code).toBe('not_a_service');
  });

  it('passes on the reason the producer already gave', () => {
    const { violations } = generateDes(
      [row({ issue: 'no_vat_number', vat_country: null, vat_number: null, contact_names: ['Nameless'] })],
      options,
    );
    expect(violations[0]?.code).toBe('no_vat_number');
    expect(violations[0]?.message).toContain('Nameless');
  });

  it('refuses a customer in the declarant country', () => {
    const { violations } = generateDes(
      [row({ vat_country: 'FR', vat_number: 'KK999999998' })],
      options,
    );
    expect(violations[0]?.code).toBe('vat_country_is_the_declarant_country');
  });

  it('refuses a value that rounds to nothing', () => {
    const { violations } = generateDes([row({ amount: '0.40' })], options);
    expect(violations[0]?.code).toBe('nil_value');
  });

  it('refuses a customer number the format cannot hold', () => {
    const { violations } = generateDes([row({ vat_number: '9' })], options);
    expect(violations[0]?.code).toBe('partner_length');
  });

  it('refuses a currency the form has no field for', () => {
    const { violations } = generateDes([row({ currency_code: 'CHF' })], options);
    expect(violations[0]?.code).toBe('wrong_currency');
  });

  it('files the lines it can and reports the rest', () => {
    const { file, violations } = generateDes(
      [row({ amount: '1000' }), row({ nature: 'goods' }), row({ amount: '500' })],
      options,
    );
    expect(violations).toHaveLength(1);
    expect(file.match(/<ligne_des>/g)).toHaveLength(2);
  });
});

describe('what it refuses outright', () => {
  it('will not write a month outside the year', () => {
    expect(() => generateDes([], { ...options, month: 13 })).toThrow(/month out of range/);
  });

  it('will not write a year the format does not accept', () => {
    expect(() => generateDes([], { ...options, year: 2009 })).toThrow(/year out of range/);
  });

  it('will not write a declarant number of the wrong shape', () => {
    expect(() => generateDes([], { ...options, vatNumber: 'FR123' })).toThrow(/thirteen characters/);
  });

  it('takes a declarant number typed with spaces', () => {
    const { file } = generateDes([], { ...options, vatNumber: 'FR KK 999 999 999' });
    expect(file).toContain('<num_tvaFr>FRKK999999999</num_tvaFr>');
  });
});

describe('the file name', () => {
  it('is ours, and says which month it covers', () => {
    expect(desFileName('FRKK999999999', 2026, 8)).toBe('DES-FRKK999999999-202608.xml');
  });
});
