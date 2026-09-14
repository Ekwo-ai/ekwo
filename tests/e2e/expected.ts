/**
 * What the figures should be, worked out without the functions that produce
 * them.
 *
 * A test that reads `financial_statement()` and compares it to
 * `financial_statement()` proves that the database is deterministic. The claim
 * of an end-to-end test is stronger: that the numbers are right. So everything
 * here starts from the ledger — `sum(debit) - sum(credit)`, an aggregate no
 * function of this schema takes part in — and from the pack's own rows, and
 * rebuilds the answer in TypeScript.
 *
 * It is a reimplementation and not a second opinion, which is worth saying
 * plainly: it follows the same rules, because the rules are the specification.
 * What it cannot do is share a bug with the SQL, which is the whole point. The
 * rounding is the one exception, and deliberately so: `roundCurrency` is the
 * TypeScript half of the rule `tests/currency_rounding.test.ts` already pins
 * against the SQL half, so using it here compares two engines that agree on
 * rounding rather than two that disagree about everything at once.
 */

import type { PGlite } from '@electric-sql/pglite';
import { roundCurrency } from '../../packages/mcp/src/rounding.js';

export type StatementKind = 'balance_sheet' | 'income_statement' | 'allocation' | 'cash_flow';

export interface AccountBalance {
  id: string;
  code: string;
  account_type: string;
  /** `asset | liability | equity | income | expense | off_balance`. */
  internal_group: string;
  balance: number;
}

/**
 * The balance of every account, straight from the lines.
 *
 * A balance sheet is cumulative and an income statement is the period; both
 * leave the closing entry out except the balance sheet, which needs it to put
 * the result where it belongs. Same convention as the schema's, because it is
 * the convention of accounting and not an implementation detail.
 */
export async function rawBalances(
  pg: PGlite,
  companyId: string,
  kind: StatementKind,
  from: string,
  to: string,
  decimals: number,
): Promise<AccountBalance[]> {
  const rows = (
    await pg.query<{
      id: string;
      code: string;
      account_type: string;
      internal_group: string;
      balance: string;
    }>(
      `select a.id, a.code, a.account_type::text as account_type, a.internal_group,
              (sum(l.debit) - sum(l.credit))::text as balance
         from accounts a
         join entry_lines l on l.account_id = a.id
         join entries e on e.id = l.entry_id
        where a.company_id = $1
          and e.state = 'posted'
          and case when $2 = 'balance_sheet'
                   then e.entry_date <= $4::date
                   else e.entry_date between $3::date and $4::date end
          and case when $2 in ('income_statement', 'allocation')
                   then e.kind::text <> 'closing'
                   else true end
        group by a.id, a.code, a.account_type, a.internal_group`,
      [companyId, kind, from, to],
    )
  ).rows;
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    account_type: r.account_type,
    internal_group: r.internal_group,
    balance: roundCurrency(Number(r.balance), decimals),
  }));
}

interface Rule {
  line_code: string;
  sequence: number;
  rule_kind: string;
  code_from: string | null;
  code_to: string | null;
  account_type: string | null;
  balance_side: string;
}

interface LineTemplate {
  code: string;
  sequence: number;
  sign: number;
  is_total: boolean;
  plus_lines: string[] | null;
  minus_lines: string[] | null;
}

function matches(rule: Rule, account: AccountBalance): boolean {
  const from = rule.code_from ?? '';
  const to = rule.code_to ?? '';
  const hit =
    rule.rule_kind === 'account_code'
      ? account.code === rule.code_from
      : rule.rule_kind === 'code_prefix'
        ? account.code.slice(0, from.length) === from
        : rule.rule_kind === 'code_range'
          ? account.code.slice(0, from.length) >= from && account.code.slice(0, to.length) <= to
          : account.account_type === rule.account_type;
  if (!hit) return false;
  if (rule.balance_side === 'debit') return account.balance > 0;
  if (rule.balance_side === 'credit') return account.balance < 0;
  return true;
}

function priority(rule: Rule): number {
  if (rule.rule_kind === 'account_code') return 1;
  if (rule.rule_kind === 'code_range' || rule.rule_kind === 'code_prefix') return 2;
  return 3;
}

/** The line of the scheme an account falls on, or `undefined` for none. */
export function lineFor(rules: Rule[], account: AccountBalance): string | undefined {
  const candidates = rules.filter((r) => matches(r, account));
  if (candidates.length === 0) return undefined;
  candidates.sort(
    (a, b) =>
      priority(a) - priority(b) ||
      (b.code_from ?? '').length - (a.code_from ?? '').length ||
      a.sequence - b.sequence ||
      a.line_code.localeCompare(b.line_code),
  );
  return candidates[0]?.line_code;
}

export interface Formula {
  key: string;
  plus: string[];
  minus: string[];
  floorZero: boolean;
  factor: number;
  sequence: number;
}

/**
 * The evaluator the declaration forms and the statements share, in TypeScript.
 *
 * A reference is a key (`"81"`, or a line code) or a key and a kind
 * (`"08:tax"`). The unqualified form sums every value whose key begins with
 * it — which is how a Belgian grid adds a base and its tax — and a formula
 * waits until every formula it names has been worked out.
 */
export function evaluateTotals(
  values: Record<string, number>,
  formulas: Formula[],
  decimals: number,
  keepZero: boolean,
): Record<string, number> {
  const working = { ...values };
  const out: Record<string, number> = {};
  const done = new Set<string>();
  const ordered = formulas
    .map((f, index) => ({ f, index }))
    .sort((a, b) => a.f.sequence - b.f.sequence || a.index - b.index)
    .map((x) => x.f);

  const hits = (ref: string, key: string): boolean =>
    ref.includes(':') ? key === ref.replace(':', '|') : key.split('|')[0] === ref;

  let left = ordered.length;
  while (left > 0) {
    let settled = 0;
    for (const formula of ordered) {
      if (done.has(formula.key)) continue;
      const refs = [...formula.plus, ...formula.minus];
      const waiting = refs.some((ref) =>
        ordered.some((other) => other.key !== formula.key && !done.has(other.key) && hits(ref, other.key)),
      );
      if (waiting) continue;

      const sum = (refList: string[]): number =>
        refList.reduce(
          (total, ref) =>
            total +
            Object.entries(working).reduce((part, [key, value]) => (hits(ref, key) ? part + value : part), 0),
          0,
        );
      let amount = sum(formula.plus) - sum(formula.minus);
      if (formula.floorZero) amount = Math.max(amount, 0);
      amount = roundCurrency(amount * formula.factor, decimals);

      working[formula.key] = amount;
      done.add(formula.key);
      if (keepZero || amount !== 0) out[formula.key] = amount;
      settled += 1;
      left -= 1;
    }
    if (settled === 0) throw new Error(`formula_cycle: ${ordered.filter((f) => !done.has(f.key)).map((f) => f.key).join(', ')}`);
  }
  return out;
}

export interface StatementLine {
  line_code: string;
  is_total: boolean;
  amount: number;
}

/**
 * A whole financial statement, line by line, rebuilt from the ledger.
 *
 * Returns every line of the scheme including the nil ones, which is what
 * `financial_statement()` does and what makes a statement tie out on paper.
 */
export async function expectedStatement(
  pg: PGlite,
  companyId: string,
  statementCode: string,
  from: string,
  to: string,
  decimals: number,
): Promise<{ lines: StatementLine[]; unmapped: AccountBalance[] }> {
  const kindRow = (
    await pg.query<{ kind: StatementKind }>(
      `select kind from statement_templates where code = $1`,
      [statementCode],
    )
  ).rows[0];
  if (kindRow === undefined) throw new Error(`unknown statement: ${statementCode}`);

  const balances = await rawBalances(pg, companyId, kindRow.kind, from, to, decimals);
  const rules = (
    await pg.query<Rule>(
      `select line_code, sequence, rule_kind, code_from, code_to,
              account_type::text as account_type, balance_side
         from statement_line_rules where statement_code = $1`,
      [statementCode],
    )
  ).rows;
  const templates = (
    await pg.query<LineTemplate>(
      `select code, sequence, sign, is_total, plus_lines, minus_lines
         from statement_line_templates where statement_code = $1`,
      [statementCode],
    )
  ).rows;

  // `unmapped_accounts()` reports only the groups the scheme is meant to show:
  // an expense account has no line on a balance sheet and is not an omission.
  const reported =
    kindRow.kind === 'balance_sheet'
      ? ['asset', 'liability', 'equity']
      : kindRow.kind === 'income_statement'
        ? ['income', 'expense']
        : [];

  const perLine = new Map<string, number>();
  const unmapped: AccountBalance[] = [];
  for (const account of balances) {
    const line = lineFor(rules, account);
    if (line === undefined) {
      if (account.balance !== 0 && reported.includes(account.internal_group)) unmapped.push(account);
      continue;
    }
    perLine.set(line, (perLine.get(line) ?? 0) + account.balance);
  }

  const values: Record<string, number> = {};
  for (const template of templates) {
    if (template.is_total) continue;
    const summed = roundCurrency(perLine.get(template.code) ?? 0, decimals);
    values[template.code] = roundCurrency(summed * template.sign, decimals);
  }

  const formulas: Formula[] = templates
    .filter((t) => t.is_total)
    .map((t) => ({
      key: t.code,
      plus: t.plus_lines ?? [],
      minus: t.minus_lines ?? [],
      floorZero: false,
      factor: t.sign,
      sequence: t.sequence,
    }));
  const totals = evaluateTotals(values, formulas, decimals, true);

  const lines = templates
    .sort((a, b) => a.sequence - b.sequence || a.code.localeCompare(b.code))
    .map((t) => ({
      line_code: t.code,
      is_total: t.is_total,
      amount: t.is_total ? (totals[t.code] ?? 0) : (values[t.code] ?? 0),
    }));
  return { lines, unmapped };
}

export interface VatBox {
  box: string;
  kind: string;
  amount: number;
}

/**
 * The declaration, rebuilt: the boxes the test's own documents write, plus the
 * totals the form derives from them.
 *
 * `ledger` is keyed `box|kind` and holds what the tax postings put on the
 * ledger — computed by the caller from the invoices it created and the pack's
 * postings, never read back from `entry_lines`.
 */
export async function expectedVatReturn(
  pg: PGlite,
  country: string,
  reportCode: string,
  at: string,
  ledger: Record<string, number>,
  decimals: number,
): Promise<VatBox[]> {
  const boxes = (
    await pg.query<{
      box: string;
      sequence: number;
      plus_boxes: string[] | null;
      minus_boxes: string[] | null;
      floor_zero: boolean;
    }>(
      `select box, sequence, plus_boxes, minus_boxes, floor_zero
         from tax_report_box_templates
        where country = $1 and report_code = $2 and kind = 'total'
          and (valid_from is null or valid_from <= $3::date)
          and (valid_to is null or valid_to >= $3::date)
        order by sequence, box`,
      [country, reportCode, at],
    )
  ).rows;

  const values: Record<string, number> = {};
  for (const [key, amount] of Object.entries(ledger)) {
    if (amount !== 0) values[key] = amount;
  }

  const totals = evaluateTotals(
    values,
    boxes.map((b) => ({
      key: `${b.box}|total`,
      plus: b.plus_boxes ?? [],
      minus: b.minus_boxes ?? [],
      floorZero: b.floor_zero,
      factor: 1,
      sequence: b.sequence,
    })),
    decimals,
    false,
  );

  const out: VatBox[] = Object.entries(values).map(([key, amount]) => ({
    box: key.split('|')[0] as string,
    kind: key.split('|')[1] as string,
    amount,
  }));
  for (const box of boxes) {
    const amount = totals[`${box.box}|total`];
    if (amount !== undefined) out.push({ box: box.box, kind: 'total', amount });
  }
  return out.sort((a, b) => a.box.localeCompare(b.box) || a.kind.localeCompare(b.kind));
}
