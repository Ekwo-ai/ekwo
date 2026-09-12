/**
 * A fictional company, "Exemple Conseil SA", used by the tests and the
 * example. Every figure is invented; the enterprise numbers are syntactically
 * valid but do not belong to any real entity.
 */
import type { BnbCode, CbsoInput, YearValues } from '../../src/index.js';
import { EnterpriseCourt, LegalForm } from '../../src/index.js';

const V = (n: number | null, p: number | null) => ({ n, p });

/** Figures of the abridged form, keyed by reporting code. */
export const exampleValues: Record<BnbCode, YearValues> = {
  // Assets
  '21': V(30000, 40000),
  '23': V(4000, 5000),
  '24': V(8000, 10000),
  '22/27': V(12000, 15000),
  '28': V(1000, 1000),
  '21/28': V(43000, 56000),
  '40': V(52000, 41000),
  '41': V(8000, 6500),
  '40/41': V(60000, 47500),
  '54/58': V(97000, 66500),
  '490/1': V(1500, 1000),
  '29/58': V(158500, 115000),
  '20/58': V(201500, 171000),
  // Equity and liabilities
  '100': V(61500, 61500),
  '10': V(61500, 61500),
  '10/11': V(61500, 61500),
  '130': V(6150, 6150),
  '130/1': V(6150, 6150),
  '13': V(6150, 6150),
  '14': V(58350, 32850),
  '10/15': V(126000, 100500),
  '440/4': V(29000, 26000),
  '441': V(2000, 2000),
  '44': V(31000, 28000),
  '450/3': V(19500, 21500),
  '454/9': V(22000, 18000),
  '45': V(41500, 39500),
  '47/48': V(3000, 3000),
  '42/48': V(75500, 70500),
  '17/49': V(75500, 70500),
  '10/49': V(201500, 171000),
  // Income statement
  '9900': V(310000, 265000),
  '62': V(215000, 190000),
  '630': V(13000, 12000),
  '640/8': V(4200, 3900),
  '9901': V(77800, 59100),
  '75': V(400, 250),
  '75/76B': V(400, 250),
  '65': V(1200, 1100),
  '65/66B': V(1200, 1100),
  '9903': V(77000, 58250),
  '67/77': V(19500, 14650),
  '9904': V(57500, 43600),
  '9905': V(57500, 43600),
  // Appropriation
  '14P': V(32850, 21250),
  '9906': V(90350, 64850),
  '694': V(32000, 32000),
  '694/7': V(32000, 32000),
  // Fixed assets annex — the NBB's own "P" boxes (8059P…) are the previous
  // year of the same measure, so they are the `p` column of the same code.
  '8059': V(80000, 80000),
  '8129': V(50000, 40000),
  '8199': V(30000, 30000),
  '8329': V(18000, 15000),
  '8395': V(1000, 1000),
  // Staff
  '9087': V(3.5, 3),
};

export const exampleInput: CbsoInput = {
  entityNumber: '0123.456.749',
  denomination: 'Exemple Conseil',
  legalForm: LegalForm.SA_NV,
  court: EnterpriseCourt.BRUSSELS_FR,
  address: { street: "Rue de l'Exemple", number: '1', postalCode: '1000', city: 'Bruxelles' },
  periodStart: '2025-01-01',
  periodEnd: '2025-12-31',
  prevPeriodStart: '2024-01-01',
  prevPeriodEnd: '2024-12-31',
  gaDate: '2026-05-15',
  deedDate: '2019-03-04',
  values: exampleValues,
  administrators: [
    {
      kind: 'person',
      lastName: 'Dupont',
      firstName: 'Marie',
      street: 'Avenue des Tilleuls',
      number: '12',
      box: 'B',
      postalCode: '1180',
      city: 'Uccle',
    },
    {
      kind: 'company',
      name: 'Gestion Exemple',
      enterpriseNumber: '0400.000.086',
      street: 'Kerkstraat',
      number: '7',
      postalCode: '9000',
      city: 'Gent',
      representative: { lastName: 'Janssens', firstName: 'Pieter' },
    },
    {
      kind: 'company',
      name: 'Voorbeeld Holding B.V.',
      enterpriseNumber: '12345678',
      identifierLabel: 'KvK (Netherlands)',
      street: 'Keizersgracht',
      number: '100',
      postalCode: '1015 AA',
      city: 'Amsterdam',
      country: 'NL',
      representative: { lastName: 'de Vries', firstName: 'Anna' },
    },
  ],
};
