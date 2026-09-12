/**
 * Each case below pins one reporting code to the fact the CBSO taxonomy gives
 * it — metric plus explicit dimension members — for framework 26.0, model
 * `m01-f`. Sources are listed in `docs/sources.md`; the whole table is checked
 * against the taxonomy package by `scripts/build-taxonomy.mjs --check`.
 *
 * The codes marked "was swapped" were wrong before this file existed: the
 * library filed them under each other's fact.
 */
import { describe, expect, it } from 'vitest';
import { CBSO_26_M01F, generateCbsoXbrl } from '../src/index.js';
import type { TemplateFact } from '../src/index.js';
import { exampleInput } from './fixtures/example-input.js';

const factOf = (code: string, column: 'N' | 'P' = 'N'): TemplateFact | undefined =>
  CBSO_26_M01F.facts.find((f) => f.role === `rubrique:${code}:${column}`);

const dimsOf = (code: string, column: 'N' | 'P' = 'N'): Record<string, string | undefined> => {
  const fact = factOf(code, column);
  expect(fact, `${code}:${column} is not in the template`).toBeDefined();
  const { 'dim:prd': prd, ...rest } = fact!.dims;
  expect(prd).toBe(column === 'P' ? 'prd:m2' : 'prd:m1');
  return { elem: fact!.elem, ...rest };
};

describe('balance sheet — assets', () => {
  it('21/28 ACTIFS IMMOBILISÉS is the fixed-assets base with no nature', () => {
    expect(dimsOf('21/28')).toEqual({ elem: 'met:am1', 'dim:bas': 'bas:m2', 'dim:part': 'part:m1' });
  });

  it('21 Immobilisations incorporelles is the intangible nature of that base', () => {
    expect(dimsOf('21')).toEqual({
      elem: 'met:am1',
      'dim:bas': 'bas:m2',
      'dim:ntr': 'ntr:m1',
      'dim:part': 'part:m1',
    });
  });

  it('22/27 Immobilisations corporelles is the tangible nature of that base (was swapped with 24)', () => {
    expect(dimsOf('22/27')).toEqual({
      elem: 'met:am1',
      'dim:bas': 'bas:m2',
      'dim:ntr': 'ntr:m2',
      'dim:part': 'part:m1',
    });
    expect(dimsOf('22/27', 'P')['dim:bas']).toBe('bas:m2');
  });

  it('24 Mobilier et matériel roulant is a base of its own (was swapped with 22/27)', () => {
    expect(dimsOf('24')).toEqual({
      elem: 'met:am1',
      'dim:bas': 'bas:m5',
      'dim:ntr': 'ntr:m2',
      'dim:part': 'part:m1',
    });
  });

  it('28 Immobilisations financières is the financial nature of that base', () => {
    expect(dimsOf('28')['dim:ntr']).toBe('ntr:m3');
  });

  it('29 Créances à plus d’un an is a receivable, which the library filed under 902', () => {
    expect(dimsOf('29')).toEqual({
      elem: 'met:am1',
      'dim:bas': 'bas:m9',
      'dim:part': 'part:m1',
      'dim:rst': 'rst:m1',
    });
    // 902 exists, but it is "Autres emprunts" of the annex on amounts payable.
    expect(dimsOf('902')['dim:bas']).toBe('bas:m51');
    expect(dimsOf('902')['dim:part']).toBe('part:m6');
  });

  it('40/41 Créances à un an au plus is the other term of the same base', () => {
    expect(dimsOf('40/41')['dim:rst']).toBe('rst:m2');
  });

  it('20/58 TOTAL DE L’ACTIF is on the assets side (was swapped with 10/49)', () => {
    expect(dimsOf('20/58')).toEqual({ elem: 'met:am1', 'dim:bas': 'bas:m25', 'dim:part': 'part:m1' });
  });
});

describe('balance sheet — equity and liabilities', () => {
  it('10/11 Apport is the contribution base (was swapped with 10)', () => {
    expect(dimsOf('10/11')['dim:bas']).toBe('bas:m38');
  });

  it('10 Capital is the capital base (was swapped with 10/11)', () => {
    expect(dimsOf('10')['dim:bas']).toBe('bas:m39');
  });

  it('44 Dettes commerciales is the heading, 440/4 Fournisseurs the line under it', () => {
    expect(dimsOf('44')).toEqual({
      elem: 'met:am1',
      'dim:bas': 'bas:m50',
      'dim:part': 'part:m3',
      'dim:rst': 'rst:m2',
      'dim:typ': 'typ:m3',
    });
    expect(dimsOf('440/4')['dim:spec']).toBe('spec:m3');
  });

  it('10/49 TOTAL DU PASSIF is on the liabilities side (was swapped with 20/58)', () => {
    expect(dimsOf('10/49')).toEqual({ elem: 'met:am1', 'dim:bas': 'bas:m25', 'dim:part': 'part:m3' });
  });
});

describe('income statement and appropriation', () => {
  it('62 Rémunérations is a personnel cost, not the social-balance code 1023', () => {
    expect(dimsOf('62')).toEqual({
      elem: 'met:am2',
      'dim:bas': 'bas:m1',
      'dim:ntr': 'ntr:m7',
      'dim:part': 'part:m4',
    });
  });

  it('65/66B Charges financières is the heading, 65 the recurring part (they were swapped)', () => {
    expect(dimsOf('65/66B')['dim:typ']).toBeUndefined();
    expect(dimsOf('65')['dim:typ']).toBe('typ:m8');
  });

  it('66A Charges d’exploitation non récurrentes is an operating cost, not the code 29', () => {
    expect(dimsOf('66A')).toEqual({
      elem: 'met:am2',
      'dim:bas': 'bas:m1',
      'dim:ntr': 'ntr:m6',
      'dim:part': 'part:m4',
      'dim:typ': 'typ:m7',
    });
  });

  it('9906 Bénéfice à affecter and 14 Bénéfice à reporter are two lines (they were swapped)', () => {
    expect(dimsOf('9906')).toEqual({
      elem: 'met:am2',
      'dim:bas': 'bas:m44',
      'dim:part': 'part:m5',
      'dim:sts': 'sts:m11',
    });
    expect(dimsOf('14')).toEqual({
      elem: 'met:am2',
      'dim:bas': 'bas:m44',
      'dim:ntr': 'ntr:m4',
      'dim:part': 'part:m3',
      'dim:sts': 'sts:m8',
    });
  });

  it('14P is a line of its own, not the previous year of 14', () => {
    expect(dimsOf('14P')['dim:bas']).toBe('bas:m61');
    expect(dimsOf('14P', 'P')['dim:bas']).toBe('bas:m61');
  });
});

describe('annexes', () => {
  it('8179 Cessions et désaffectations and 8309 Annulés are two movements (they were swapped)', () => {
    expect(dimsOf('8179')['dim:mdp']).toBe('mdp:m8');
    expect(dimsOf('8179')['dim:bkd']).toBe('bkd:m4');
    expect(dimsOf('8309')['dim:mdp']).toBe('mdp:m12');
    expect(dimsOf('8309')['dim:bkd']).toBe('bkd:m1');
  });

  it('the NBB “P” boxes of the annexes are the p column of the same code', () => {
    for (const code of ['8059', '8129', '8199', '8329', '8395', '1003']) {
      expect(dimsOf(code, 'P'), code).toBeDefined();
      expect(factOf(`${code}P`), `${code}P`).toBeUndefined();
    }
  });

  it('the social balance sheet counts men, women and total in that order', () => {
    expect(dimsOf('1001')['dim:wrg']).toBe('wrg:m1');
    expect(dimsOf('1002')['dim:wrg']).toBe('wrg:m2');
    expect(dimsOf('1003')['dim:wrg']).toBe('wrg:m3');
  });
});

describe('the template as a whole', () => {
  it('gives every reporting code exactly one fact per column', () => {
    const seen = new Set<string>();
    for (const fact of CBSO_26_M01F.facts) {
      if (!fact.role.startsWith('rubrique:')) continue;
      expect(seen.has(fact.role), fact.role).toBe(false);
      seen.add(fact.role);
    }
    expect(seen.size).toBeGreaterThan(400);
  });

  it('puts the reporting code in the dimensions, never in the element name', () => {
    const metrics = new Set(CBSO_26_M01F.facts.map((f) => f.elem));
    expect([...metrics].every((m) => m.startsWith('met:'))).toBe(true);
    expect(metrics.size).toBeLessThanOrEqual(12);
  });

  it('files 22/27 and 24 on their own facts, not on each other’s', () => {
    const xml = generateCbsoXbrl(exampleInput);
    const contextOf = (base: string) => {
      const scenario =
        `<xbrldi:explicitMember dimension="dim:bas">${base}</xbrldi:explicitMember>` +
        '<xbrldi:explicitMember dimension="dim:ntr">ntr:m2</xbrldi:explicitMember>' +
        '<xbrldi:explicitMember dimension="dim:part">part:m1</xbrldi:explicitMember>' +
        '<xbrldi:explicitMember dimension="dim:prd">prd:m1</xbrldi:explicitMember>';
      const line = xml
        .split('\n')
        .find((l) => l.startsWith('<context ') && l.includes(scenario) && l.includes('2025-12-31'));
      expect(line, base).toBeDefined();
      return line!.slice('<context id="'.length, line!.indexOf('"', '<context id="'.length));
    };
    // 22/27 "Immobilisations corporelles" = the tangible nature of the fixed
    // assets base; 24 "Mobilier et matériel roulant" = a base of its own.
    expect(xml).toContain(
      `<met:am1 contextRef="${contextOf('bas:m2')}" unitRef="EUR" decimals="INF">12000.00</met:am1>`,
    );
    expect(xml).toContain(
      `<met:am1 contextRef="${contextOf('bas:m5')}" unitRef="EUR" decimals="INF">8000.00</met:am1>`,
    );
  });
});
