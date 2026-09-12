import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CbsoInputError,
  checkBnbEquations,
  generateCbsoXbrl,
  unknownCodes,
  XbrlCbso,
  CBSO_26_M01F,
} from '../src/index.js';
import { exampleInput, exampleValues } from './fixtures/example-input.js';

const GOLDEN = new URL('./fixtures/example.xbrl', import.meta.url);

describe('generateCbsoXbrl', () => {
  const xml = generateCbsoXbrl(exampleInput);

  it('is a well-formed XBRL instance of the m01-f model', () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<xbrl xml:lang="fr"')).toBe(true);
    expect(xml).toContain(`<link:schemaRef xlink:type="simple" xlink:href="${CBSO_26_M01F.schemaRef}"/>`);
    expect(xml.trim().endsWith('</xbrl>')).toBe(true);
  });

  it('matches the golden file', () => {
    expect(xml).toBe(readFileSync(GOLDEN, 'utf8'));
  });

  it('identifies the entity with its normalised enterprise number', () => {
    expect(xml).toContain('<identifier scheme="http://www.fgov.be">0123456749</identifier>');
    expect(xml).toContain('>0123456749</met:str2>');
    expect(xml).not.toContain('0123.456.749');
  });

  it('carries the reporting code in the dimensions, not in the element name', () => {
    // 20/58 (total assets) current year → bas:m25 / part:m1 / prd:m1
    const ctx = xml.match(
      /<context id="(c\d+)"><entity>.*?<\/entity><period><instant>2025-12-31<\/instant><\/period><scenario><xbrldi:explicitMember dimension="dim:bas">bas:m25<\/xbrldi:explicitMember><xbrldi:explicitMember dimension="dim:part">part:m1<\/xbrldi:explicitMember><xbrldi:explicitMember dimension="dim:prd">prd:m1<\/xbrldi:explicitMember><\/scenario><\/context>/,
    );
    expect(ctx).not.toBeNull();
    expect(xml).toContain(`<met:am1 contextRef="${ctx?.[1]}" unitRef="EUR" decimals="INF">201500.00</met:am1>`);
  });

  it('only emits facts that have a value', () => {
    expect(xml).not.toContain('bas:m1"'); // no stock (code 3 / 30/36) provided
    const facts = xml.match(/<met:/g) ?? [];
    const provided = Object.values(exampleValues).flatMap((v) => [v.n, v.p]).filter((x) => x != null).length;
    expect(facts.length).toBeGreaterThan(provided);
  });

  it('formats amounts with two decimals, FTEs with one, integers as integers', () => {
    expect(xml).toContain('>3.5</met:dec1>');
    expect(xml).toContain('>215000.00</met:am2>');
    expect(xml).not.toMatch(/>215000<\/met:am/);
  });

  it('lists the codes the model does not know, instead of failing silently', () => {
    // 20/28, 70/74 and 9902 are pre-2016 codes that the current scheme dropped.
    expect(unknownCodes({ '20/58': { n: 1 }, '20/28': { n: 1 }, '9902': { n: 1 } })).toEqual([
      '20/28',
      '9902',
    ]);
    // Sorted, so the answer does not depend on the order of the input keys.
    expect(unknownCodes(exampleValues)).toEqual([]);
  });

  it('deduplicates contexts', () => {
    const ids = [...xml.matchAll(/<context id="(c\d+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
    const referenced = new Set([...xml.matchAll(/contextRef="(c\d+)"/g)].map((m) => m[1]));
    expect([...referenced].sort()).toEqual([...ids].sort());
  });

  it('declares only the namespaces it uses', () => {
    expect(xml).toContain('xmlns:pcd-enum=');
    expect(xml).not.toContain('xmlns:jcc-enum=');
    expect(xml).not.toContain('xmlns:fct-enum=');
  });

  it('encodes a natural person administrator with typed dimensions', () => {
    expect(xml).toContain(
      '<xbrldi:typedMember dimension="dim:afnp"><open:str>Marie</open:str></xbrldi:typedMember><xbrldi:typedMember dimension="dim:annp"><open:str>Dupont</open:str></xbrldi:typedMember>',
    );
    expect(xml).toContain('>pcd:m1180</pcd-enum:list1>');
    expect(xml).toContain('>B</met:str2>'); // box
  });

  it('encodes a Belgian legal entity with its enterprise number and representative', () => {
    expect(xml).toContain('>nmt:m1</nmt-enum:list1>');
    expect(xml).toContain('>0400000086</met:str2>');
    expect(xml).toContain('<xbrldi:typedMember dimension="dim:aprf"><open:str>Pieter</open:str></xbrldi:typedMember>');
  });

  it('encodes a foreign legal entity with free-text postal code, city and identifier label', () => {
    expect(xml).toContain('>KvK (Netherlands)</met:str2>');
    expect(xml).toContain('>1015 AA</met:str2>');
    expect(xml).toContain('>Amsterdam</met:str2>');
    expect(xml).toContain('>cty:mNL</cty-enum:list1>');
    expect(xml).not.toContain('pcd:m1015');
  });

  it('escapes XML special characters', () => {
    const out = generateCbsoXbrl({ ...exampleInput, denomination: 'A & B <Cie>' });
    expect(out).toContain('>A &amp; B &lt;Cie&gt;</met:str2>');
  });

  it('applies the declaration defaults and lets the caller override them', () => {
    expect(xml).toContain('>true</met:bln1>');
    const out = generateCbsoXbrl({ ...exampleInput, declarations: { m1: false } });
    expect(out).not.toContain('>true</met:bln1>');
  });

  it('accepts a custom template through the class API', () => {
    const template = { schemaRef: CBSO_26_M01F.schemaRef, facts: CBSO_26_M01F.facts.slice(0, 1) };
    const out = new XbrlCbso(exampleInput, template).generate();
    expect(out).toContain('0123456749');
    expect(out).not.toContain('201500.00');
  });

  it('example input satisfies the arithmetic identities', () => {
    expect(checkBnbEquations(exampleValues)).toEqual([]);
  });
});

describe('input validation', () => {
  it('rejects an enterprise number with wrong check digits', () => {
    expect(() => generateCbsoXbrl({ ...exampleInput, entityNumber: '0123456748' })).toThrow(CbsoInputError);
    expect(() => generateCbsoXbrl({ ...exampleInput, entityNumber: '0123456748' })).toThrow(/entityNumber/);
  });

  it('rejects a malformed date', () => {
    expect(() => generateCbsoXbrl({ ...exampleInput, gaDate: '15/05/2026' })).toThrow(/gaDate/);
  });

  it('rejects an inconsistent period', () => {
    expect(() => generateCbsoXbrl({ ...exampleInput, prevPeriodEnd: '2025-06-30' })).toThrow(/prevPeriodEnd/);
  });

  it('rejects a Belgian postal code that is not four digits', () => {
    expect(() =>
      generateCbsoXbrl({ ...exampleInput, address: { ...exampleInput.address, postalCode: '10000' } }),
    ).toThrow(/address\.postalCode/);
  });

  it('can be switched off', () => {
    expect(() => generateCbsoXbrl({ ...exampleInput, entityNumber: '0123456748' }, { validate: false })).not.toThrow();
  });
});
