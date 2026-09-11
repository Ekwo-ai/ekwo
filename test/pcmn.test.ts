import { describe, expect, it } from 'vitest';
import { checkBnbEquations } from '../src/index.js';
import {
  computeAppropriation,
  computeBalanceSheet,
  computeIncomeStatement,
  valuesFromTrialBalance,
  type AccountBalance,
} from '../src/pcmn/index.js';

/** Tiny balanced trial balance (debit − credit), invented figures. */
const trialBalance: AccountBalance[] = [
  // Assets (debit balances)
  { account: '211000', balance: 30000, priorBalance: 40000 },
  { account: '240000', balance: 12000, priorBalance: 15000 },
  { account: '400000', balance: 52000, priorBalance: 41000 },
  { account: '550000', balance: 112000, priorBalance: 72000 },
  // Equity and liabilities (credit balances), after appropriation
  { account: '100000', balance: -61500, priorBalance: -61500 },
  { account: '130000', balance: -6150, priorBalance: -6150 },
  { account: '140000', balance: -58350, priorBalance: -32850 },
  { account: '440000', balance: -31000, priorBalance: -28000 },
  { account: '450000', balance: -19500, priorBalance: -21500 },
  { account: '454000', balance: -22000, priorBalance: -18000 },
  { account: '480000', balance: -7500, priorBalance: 0 },
  // Income statement
  { account: '700000', balance: -320000, priorBalance: -270000 },
  { account: '610000', balance: 10000, priorBalance: 5000 },
  { account: '620000', balance: 215000, priorBalance: 190000 },
  { account: '630000', balance: 13000, priorBalance: 12000 },
  { account: '640000', balance: 4200, priorBalance: 3900 },
  { account: '750000', balance: -400, priorBalance: -250 },
  { account: '650000', balance: 1200, priorBalance: 1100 },
  { account: '670000', balance: 19500, priorBalance: 14650 },
  // Appropriation
  { account: '694000', balance: 32000, priorBalance: 32000 },
];

describe('computeBalanceSheet', () => {
  it('sums leaf lines by account prefix and resolves nested subtotals', () => {
    const assets = computeBalanceSheet('assets', trialBalance);
    expect(assets.get('21')).toEqual({ current: 30000, prior: 40000 });
    expect(assets.get('24')).toEqual({ current: 12000, prior: 15000 });
    expect(assets.get('22/27')).toEqual({ current: 12000, prior: 15000 });
    expect(assets.get('21/28')).toEqual({ current: 42000, prior: 55000 });
    expect(assets.get('29/58')).toEqual({ current: 164000, prior: 113000 });
    expect(assets.get('20/58')).toEqual({ current: 206000, prior: 168000 });
  });

  it('shows credit balances of liabilities as positive amounts', () => {
    const liabilities = computeBalanceSheet('liabilities', trialBalance);
    expect(liabilities.get('100')).toEqual({ current: 61500, prior: 61500 });
    expect(liabilities.get('14')).toEqual({ current: 58350, prior: 32850 });
    expect(liabilities.get('45')).toEqual({ current: 41500, prior: 39500 });
    expect(liabilities.get('47/48')).toEqual({ current: 7500, prior: 0 });
    expect(liabilities.get('10/15')).toEqual({ current: 126000, prior: 100500 });
    expect(liabilities.get('17/49')).toEqual({ current: 80000, prior: 67500 });
    expect(liabilities.get('10/49')).toEqual({ current: 206000, prior: 168000 });
  });
});

describe('computeIncomeStatement', () => {
  const income = computeIncomeStatement(trialBalance);

  it('shows revenue as positive and derives the result chain', () => {
    expect(income.get('70')).toEqual({ current: 320000, prior: 270000 });
    expect(income.get('9900')).toEqual({ current: 310000, prior: 265000 });
    expect(income.get('9901')).toEqual({ current: 77800, prior: 59100 });
    expect(income.get('9903')).toEqual({ current: 77000, prior: 58250 });
    expect(income.get('9904')).toEqual({ current: 57500, prior: 43600 });
    expect(income.get('9905')).toEqual({ current: 57500, prior: 43600 });
  });

  it('feeds the appropriation with the previous-year carry-forward', () => {
    const appropriation = computeAppropriation(trialBalance, income);
    expect(appropriation.get('14P')).toEqual({ current: 32850, prior: 0 });
    expect(appropriation.get('9906')).toEqual({ current: 90350, prior: 43600 });
    expect(appropriation.get('694/7')).toEqual({ current: 32000, prior: 32000 });
  });
});

describe('valuesFromTrialBalance', () => {
  it('produces generator values that satisfy the reporting identities', () => {
    const values = valuesFromTrialBalance(trialBalance);
    expect(values['9904']).toEqual({ n: 57500, p: 43600 });
    expect(checkBnbEquations(values)).toEqual([]);
  });
});
