import type { PGlite } from '@electric-sql/pglite';
import { cp, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PackError, readPack, resolveBoxRef } from '../packages/cli/src/index.js';
import { asUser, expectError, freshDatabase, one, repoRoot, rows } from './helpers/db.js';
import { demoCompanyId, newCompany, newContact, newDocument } from './helpers/factory.js';

// A declaration form is data. `vat_return()` used to sum the ledger
// boxes — which never knew a country — and then hard-code the Belgian frame
// VI behind `fiscal_country = 'BE'`. The boxes and their formulas now come
// from `packs/<cc>/tax_report.json`, and this file holds the two things that
// matters: Belgium answers exactly what it answered before, and France, which
// had no total at all, now has all four.

let db: PGlite;
let companyId: string;

beforeAll(async () => {
  db = await freshDatabase();
  companyId = await demoCompanyId(db);
}, 120_000);

afterAll(async () => {
  await db.close();
});

const n = (value: string | null | undefined): number => Number(value ?? 0);

interface Box {
  box: string;
  kind: string;
  amount: string;
  computed: boolean;
  name: string | null;
  sequence: number | null;
  hidden: boolean;
  report_code: string | null;
}

async function vatReturn(company: string, from: string, to: string, code?: string): Promise<Box[]> {
  return rows<Box>(
    db,
    code === undefined
      ? `select * from vat_return($1, $2, $3)`
      : `select * from vat_return($1, $2, $3, $4)`,
    code === undefined ? [company, from, to] : [company, from, to, code],
  );
}

describe('the forms the packs carry', () => {
  it('are seeded with their boxes, and belong to nobody', async () => {
    const forms = await rows<{ country: string; code: string; period: string; boxes: number }>(
      db,
      `select t.country, t.code, t.period,
              (select count(*)::int from tax_report_box_templates b
                where b.country = t.country and b.report_code = t.code) as boxes
         from tax_report_templates t order by t.country`,
    );
    expect(forms).toEqual([
      { country: 'BE', code: 'BE-VAT-PERIODIC', period: 'month_or_quarter', boxes: 31 },
      { country: 'FR', code: 'FR-CA3', period: 'month_or_quarter', boxes: 22 },
    ]);
  });

  it('refuse a formula on a box that is summed from the ledger', async () => {
    const message = await expectError(
      db,
      `insert into tax_report_box_templates (country, report_code, box, kind, name, plus_boxes)
       values ('BE', 'BE-VAT-PERIODIC', '99', 'tax', 'Essai', array['54'])`,
    );
    expect(message).toMatch(/tax_report_box_templates_formula_is_a_total/);
  });

  it('refuse a box on a form that does not exist', async () => {
    const message = await expectError(
      db,
      `insert into tax_report_box_templates (country, report_code, box, kind, name)
       values ('BE', 'BE-VAT-NOPE', '99', 'tax', 'Essai')`,
    );
    expect(message).toMatch(/foreign key/i);
  });
});

describe('vat_return on the demo company, Belgium', () => {
  it('answers what the hard-coded rule answered, box by box', async () => {
    const boxes = await vatReturn(companyId, '2026-07-01', '2026-09-30');
    const byBox = Object.fromEntries(boxes.map((b) => [b.box, n(b.amount)]));

    const due = ['54', '55', '56', '57', '61', '63'].reduce((s, b) => s + (byBox[b] ?? 0), 0);
    const deductible = ['59', '62', '64'].reduce((s, b) => s + (byBox[b] ?? 0), 0);

    expect(due).toBeCloseTo(1176.9, 2);
    expect(deductible).toBeCloseTo(1331.4, 2);
    expect(byBox['71'] ?? 0).toBeCloseTo(Math.max(due - deductible, 0), 2);
    expect(byBox['72'] ?? 0).toBeCloseTo(Math.max(deductible - due, 0), 2);
    expect(byBox['72']).toBeCloseTo(154.5, 2);
  });

  it('returns the two intermediate totals, flagged as the form does not print them', async () => {
    const boxes = await vatReturn(companyId, '2026-07-01', '2026-09-30');
    const xx = boxes.find((b) => b.box === 'XX');
    const yy = boxes.find((b) => b.box === 'YY');

    expect(n(xx?.amount)).toBeCloseTo(1176.9, 2);
    expect(n(yy?.amount)).toBeCloseTo(1331.4, 2);
    expect(xx?.hidden).toBe(true);
    expect(yy?.hidden).toBe(true);
    expect(boxes.filter((b) => b.hidden).map((b) => b.box)).toEqual(['XX', 'YY']);
    expect(boxes.find((b) => b.box === '72')?.hidden).toBe(false);
  });

  it('names every box and says which form it is on', async () => {
    const boxes = await vatReturn(companyId, '2026-07-01', '2026-09-30');
    expect(boxes.every((b) => b.report_code === 'BE-VAT-PERIODIC')).toBe(true);
    expect(boxes.find((b) => b.box === '59')?.name).toBe('TVA déductible');
    expect(boxes.find((b) => b.box === '72')?.name).toBe('Sommes dues par l’État'.replace('’', "'"));
    expect(boxes.every((b) => b.sequence !== null)).toBe(true);
  });

  it('gives the same answer when the form is named, and refuses one that is not in force', async () => {
    const implied = await vatReturn(companyId, '2026-07-01', '2026-09-30');
    const named = await vatReturn(companyId, '2026-07-01', '2026-09-30', 'BE-VAT-PERIODIC');
    expect(named).toEqual(implied);

    const message = await expectError(
      db,
      `select * from vat_return($1, '2026-07-01', '2026-09-30', 'FR-CA3-2050')`,
      [companyId],
    );
    expect(message).toMatch(/unknown_tax_report/);
  });

  it('drops a total that is nil, as it has always dropped a nil box', async () => {
    const boxes = await vatReturn(companyId, '2026-07-01', '2026-09-30');
    expect(boxes.map((b) => b.box)).not.toContain('71');
    expect(boxes.every((b) => n(b.amount) !== 0)).toBe(true);
  });
});

describe('vat_return on a French company', () => {
  let french: string;

  beforeAll(async () => {
    const fx = await newCompany(db, { country: 'FR', name: 'Déclarante SAS' });
    french = fx.companyId;

    const customer = await newContact(db, french, { name: 'Client FR', country: 'FR' });
    const supplier = await newContact(db, french, {
      name: 'Fournisseur FR',
      type: 'supplier',
      country: 'FR',
    });

    const sale = await newDocument(db, french, {
      docType: 'sale_invoice',
      number: 'FA-2026-0001',
      contactId: customer,
      date: '2026-06-15',
      lines: [{ unitPrice: 1000, taxCode: 'FR-S-20', accountCode: '706000' }],
    });
    await db.query(`select post_document($1)`, [sale]);

    const purchase = await newDocument(db, french, {
      docType: 'purchase_invoice',
      number: 'ACH-2026-0001',
      contactId: supplier,
      date: '2026-06-20',
      lines: [{ unitPrice: 500, taxCode: 'FR-P-20', accountCode: '606300' }],
    });
    await db.query(`select post_document($1)`, [purchase]);
  }, 60_000);

  it('fills the CA3 to the cent, totals included', async () => {
    const boxes = await vatReturn(french, '2026-06-01', '2026-06-30');
    const byBox = Object.fromEntries(boxes.map((b) => [`${b.box}:${b.kind}`, n(b.amount)]));

    // What the postings wrote.
    expect(byBox['08:base']).toBeCloseTo(1000, 2); // the 20 % sale, net of tax
    expect(byBox['08:tax']).toBeCloseTo(200, 2); // the VAT it owes
    expect(byBox['20:tax']).toBeCloseTo(100, 2); // the VAT on the purchase

    // What the form derives, in the order it declares them.
    expect(byBox['01:total']).toBeCloseTo(1000, 2); // sales, from the bases
    expect(byBox['16:total']).toBeCloseTo(200, 2); // gross VAT due
    expect(byBox['23:total']).toBeCloseTo(100, 2); // deductible VAT
    expect(byBox['28:total']).toBeCloseTo(100, 2); // net VAT due
    expect(byBox['25:total'] ?? 0).toBeCloseTo(0, 2); // and no credit
    expect(boxes.map((b) => b.box)).not.toContain('25');
  });

  it('turns the pair over when the purchases are the bigger side', async () => {
    const supplier = await newContact(db, french, {
      name: 'Gros fournisseur',
      type: 'supplier',
      country: 'FR',
    });
    const purchase = await newDocument(db, french, {
      docType: 'purchase_invoice',
      number: 'ACH-2026-0002',
      contactId: supplier,
      date: '2026-07-10',
      lines: [{ unitPrice: 2000, taxCode: 'FR-P-20', accountCode: '606300' }],
    });
    await db.query(`select post_document($1)`, [purchase]);

    const boxes = await vatReturn(french, '2026-07-01', '2026-07-31');
    const byBox = Object.fromEntries(boxes.map((b) => [b.box, n(b.amount)]));
    expect(byBox['23']).toBeCloseTo(400, 2);
    expect(byBox['25']).toBeCloseTo(400, 2); // the credit
    expect(byBox['28'] ?? 0).toBeCloseTo(0, 2); // floored, not negative
    expect(boxes.map((b) => b.box)).not.toContain('28');
  });

  it('reads a total that names a total computed before it', async () => {
    // 28 is 16 less 23, and both are themselves totals. The evaluation order
    // is the sequence of the form, which is what makes this work at all.
    const boxes = await vatReturn(french, '2026-06-01', '2026-06-30');
    const twentyEight = boxes.find((b) => b.box === '28');
    const sixteen = boxes.find((b) => b.box === '16');
    const twentyThree = boxes.find((b) => b.box === '23');
    expect(n(twentyEight?.amount)).toBeCloseTo(n(sixteen?.amount) - n(twentyThree?.amount), 2);
    expect(twentyEight?.computed).toBe(true);
    expect(twentyEight?.sequence ?? 0).toBeGreaterThan(sixteen?.sequence ?? 0);
  });
});

describe('no country lives in the core any more', () => {
  // A country is data: a pack. So a country code has no business being
  // written down in a function, in a migration, or in the CLI — only in
  // `packs/`, in the seeds compiled from them, and in a test that picks one.
  const COUNTRY_LITERAL = /'(BE|FR|UK|US|CA|GB|IE|NL|DE|LU)'|"(BE|FR|UK|US|CA|GB|IE|NL|DE|LU)"/;

  // The same rule one step further out: a currency and a language are what a
  // country decides, so a literal one in the code is a country in the code
  // wearing a different hat. The answer comes from the pack, or from the
  // company row, or the caller is asked — never from a euro written here.
  const LOCALE_LITERAL = /'(EUR|USD|GBP|CAD|CHF)'|'(fr|en|nl|de)'|"(EUR|USD|GBP|CAD|CHF)"/;

  /**
   * The file without the lines that are purely a comment. A comment may quote
   * the country rule it replaced — that is documentation, and this guard is
   * about what runs. A trailing comment on a line of code is *not* stripped,
   * which makes the guard stricter rather than looser.
   */
  function code(text: string, marker: '--' | '//'): string {
    return text
      .split('\n')
      .filter((line) => {
        const trimmed = line.trimStart();
        return !trimmed.startsWith(marker) && !trimmed.startsWith('*') && !trimmed.startsWith('/*');
      })
      .join('\n');
  }

  async function filesUnder(dir: string, ending: string): Promise<string[]> {
    const out: string[] = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) out.push(...(await filesUnder(path, ending)));
      else if (entry.name.endsWith(ending)) out.push(path);
    }
    return out.sort();
  }

  it('has no SQL function holding a country code', async () => {
    const guilty = await rows<{ proname: string }>(
      db,
      `select p.proname
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.prosrc ~ '''(BE|FR|UK|US|CA|GB|IE|NL|DE|LU)'''
        order by 1`,
    );
    expect(guilty.map((r) => r.proname)).toEqual([]);
  });

  it('has no migration holding a country code', async () => {
    // The seeds are excluded on purpose: one seed per country is the whole
    // design, and the demo company is Belgian because sample data has to be
    // from somewhere. A migration is the core, and the core has no country.
    const guilty: string[] = [];
    for (const file of await filesUnder(join(repoRoot, 'supabase', 'migrations'), '.sql')) {
      const match = COUNTRY_LITERAL.exec(code(await readFile(file, 'utf8'), '--'));
      if (match !== null) guilty.push(`${file.split('/').at(-1)}: ${match[0]}`);
    }
    expect(guilty).toEqual([]);
  });

  it('has no country code in the source of the CLI, the MCP server or the core', async () => {
    expect(await literalsIn(COUNTRY_LITERAL)).toEqual([]);
  });

  it('has no currency or language written into that source either', async () => {
    expect(await literalsIn(LOCALE_LITERAL)).toEqual([]);
  });

  // The audit of 13 September 2026. The rule stopped at the three packages,
  // and the schema itself was carrying eight `default 'EUR'` / `default 'fr'`
  // columns — a Canadian installation that named no currency got euros in its
  // documents, its payments, its catalogue and its bank lines, and found out
  // at the first report. 20260913102758 drops all eight and replaces them with
  // a lookup: a row takes the currency of the company above it, and a company
  // takes the currency and the language of its country's pack.
  //
  // Two guards, because a published migration cannot be edited. The file rule
  // allows a locale literal **only** where it is a column default — the shape
  // those eight had — and the schema rule then says no such default survives.
  // A new migration writing one in a function, a policy or a backfill is
  // refused by the first; one writing a new column default is refused by the
  // second. There is no gap between them.
  it('has no currency or language in a migration, except a default the schema no longer has', async () => {
    const dirs = [
      join(repoRoot, 'supabase', 'migrations'),
      join(repoRoot, 'modules'),
    ];
    const guilty: string[] = [];
    for (const dir of dirs) {
      for (const file of await filesUnder(dir, '.sql')) {
        for (const line of code(await readFile(file, 'utf8'), '--').split('\n')) {
          const match = LOCALE_LITERAL.exec(line);
          if (match === null) continue;
          if (/default\s+'[A-Za-z]{2,3}'/.test(line)) continue;
          guilty.push(`${file.split('/').at(-1)}: ${line.trim()}`);
        }
      }
    }
    expect(guilty).toEqual([]);
  });

  it('keeps no column default that is a currency or a language', async () => {
    const defaults = await rows<{ table_name: string; column_name: string; expression: string }>(
      db,
      `select c.relname as table_name, a.attname as column_name,
              pg_get_expr(d.adbin, d.adrelid) as expression
         from pg_attrdef d
         join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
         join pg_class c on c.oid = d.adrelid
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and pg_get_expr(d.adbin, d.adrelid) ~ '^''(EUR|USD|GBP|CAD|CHF|fr|en|nl|de)'''
        order by 1, 2`,
    );
    expect(
      defaults.map((d) => `${d.table_name}.${d.column_name} = ${d.expression}`),
      'a currency or a language as a column default is a country in the core',
    ).toEqual([]);
  });

  async function literalsIn(pattern: RegExp): Promise<string[]> {
    const guilty: string[] = [];
    // The three packages that are the core. `packages/formats/*` is judged by
    // its own rule, in `formats.test.ts`: a format brick may name the country
    // whose format it implements — the NBB scheme is Belgian by nature, and a
    // format is code — so what is checked there is that it stays MIT, imports
    // nothing of ours, and depends on nothing its format does not need.
    for (const pkg of ['cli', 'mcp', 'core']) {
      const dir = join(repoRoot, 'packages', pkg, 'src');
      for (const file of await filesUnder(dir, '.ts')) {
        const match = pattern.exec(code(await readFile(file, 'utf8'), '//'));
        if (match !== null) guilty.push(`${pkg}/${file.split('/').at(-1)}: ${match[0]}`);
      }
    }
    return guilty;
  }
});

describe('the form tables under row level security', () => {
  it('let a signed-in user read them, and nobody write them', async () => {
    const { ownerId } = await newCompany(db, { country: 'BE', name: 'Lectrice SRL' });

    await asUser(db, ownerId, async () => {
      const seen = await one<{ n: number }>(
        db,
        `select count(*)::int as n from tax_report_box_templates`,
      );
      expect(seen.n).toBeGreaterThan(40);

      // An insert is refused outright.
      for (const statement of [
        `insert into tax_report_templates (country, code, name) values ('BE', 'BE-MINE', 'À moi')`,
        `insert into tax_report_box_templates (country, report_code, box, kind, name)
         values ('BE', 'BE-VAT-PERIODIC', '99', 'tax', 'À moi')`,
      ]) {
        const message = await expectError(db, statement);
        expect(message, statement).toMatch(/row-level security|permission denied/);
      }

      // An update or a delete finds no row at all: there is no policy that
      // shows one for writing, which is the quieter half of the same refusal.
      for (const statement of [
        `update tax_report_box_templates set name = 'Changé' where box = '59'`,
        `delete from tax_report_box_templates where box = '59'`,
      ]) {
        const result = await db.query(statement);
        expect(result.affectedRows ?? 0, statement).toBe(0);
      }
    });

    const intact = await one<{ name: string }>(
      db,
      `select name from tax_report_box_templates
        where country = 'BE' and box = '59' and kind = 'tax'`,
    );
    expect(intact.name).toBe('TVA déductible');
  });

  it('are invisible to a request that carries no user', async () => {
    // A Supabase `anon` key carries no `sub`, so `auth.uid()` is null and the
    // policy is false — the same answer `account_templates` gives.
    await db.exec(`select set_config('request.jwt.claims', '', false); set role anon;`);
    try {
      expect(await rows(db, `select code from tax_report_templates`)).toEqual([]);
      expect(await rows(db, `select box from tax_report_box_templates`)).toEqual([]);
    } finally {
      await db.exec(`reset role;`);
    }
  });
});

describe('what `ekwo pack check` refuses in a formula', () => {
  const packs = join(repoRoot, 'packs');

  /** `packs/fr` in a temporary directory, with its form replaced. */
  async function packWith(boxes: unknown[]): Promise<void> {
    const dir = await mkdtemp(join(tmpdir(), 'ekwo-pack-'));
    await cp(join(packs, 'schema'), join(dir, 'schema'), { recursive: true });
    await cp(join(packs, 'fr'), join(dir, 'fr'), { recursive: true });
    const form = JSON.parse(await readFile(join(packs, 'fr', 'tax_report.json'), 'utf8')) as {
      boxes: unknown[];
    };
    form.boxes = boxes;
    await writeFile(join(dir, 'fr', 'tax_report.json'), JSON.stringify(form), 'utf8');
    await readPack('fr', dir);
  }

  const base = { kind: 'base', name: 'Base', sequence: 10 } as const;
  const total = { kind: 'total', name: 'Total' } as const;

  it('accepts the packs of this repository as they are', async () => {
    for (const slug of ['be', 'fr']) {
      const pack = await readPack(slug, packs);
      expect(pack.report?.boxes.length, slug).toBeGreaterThan(20);
      expect(pack.report?.code, slug).toBe(slug === 'be' ? 'BE-VAT-PERIODIC' : 'FR-CA3');
    }
  });

  it('refuses a reference to a box the form does not carry', async () => {
    await expect(
      packWith([
        { ...base, box: '08' },
        { ...total, box: '16', sequence: 20, plus: ['08:base', '77'] },
      ]),
    ).rejects.toThrow(/77 is not a box of this form/);
  });

  it('refuses a bare reference that could mean two boxes', async () => {
    await expect(
      packWith([
        { ...base, box: '08' },
        { box: '08', kind: 'tax', name: 'Taxe', sequence: 20 },
        { ...total, box: '16', sequence: 30, plus: ['08'] },
      ]),
    ).rejects.toThrow(/08 is ambiguous.*08:base or 08:tax/s);
  });

  it('refuses a total that names itself', async () => {
    await expect(
      packWith([
        { ...base, box: '08' },
        { ...total, box: '16', sequence: 20, plus: ['08:base', '16'] },
      ]),
    ).rejects.toThrow(/16 is the box itself/);
  });

  it('refuses a total that names a total computed after it', async () => {
    await expect(
      packWith([
        { ...base, box: '08' },
        { ...total, box: '28', sequence: 20, plus: ['16'] },
        { ...total, box: '16', sequence: 30, plus: ['08:base'] },
      ]),
    ).rejects.toThrow(/16 is a total computed at sequence 30, after this one at 20/);
  });

  it('refuses a formula on a box that is summed from the ledger', async () => {
    await expect(
      packWith([
        { ...base, box: '08' },
        { box: '09', kind: 'tax', name: 'Taxe', sequence: 20, plus: ['08:base'] },
      ]),
    ).rejects.toThrow(/only a total is computed from other boxes/);
  });

  it('refuses the same box declared twice with the same kind', async () => {
    await expect(
      packWith([
        { ...base, box: '08' },
        { ...base, box: '08', sequence: 20 },
      ]),
    ).rejects.toThrow(/duplicate base box/);
  });

  it('refuses a tax that posts to a box the form does not carry', async () => {
    // FR-S-20 posts its base and its tax to box 08; a form without it is a
    // return that would silently lose the amount.
    await expect(packWith([{ ...base, box: '99' }])).rejects.toThrow(
      /box 08:base is not a base box of this form/,
    );
  });

  it('names the file and the box when it refuses', async () => {
    const error = await packWith([
      { ...base, box: '08' },
      { ...total, box: '16', sequence: 20, plus: ['08:base', '77'] },
    ]).catch((e: unknown) => e as PackError);
    expect((error as PackError).message).toMatch(/tax_report\.json 16\.plus/);
  });
});

describe('resolveBoxRef', () => {
  const boxes = [
    { box: '08', kind: 'base' as const, name: 'Base', sequence: 10, plus: [], minus: [], floor_zero: false, hidden: false, xml_element: null, legal_reference: null },
    { box: '08', kind: 'tax' as const, name: 'Taxe', sequence: 20, plus: [], minus: [], floor_zero: false, hidden: false, xml_element: null, legal_reference: null },
    { box: '19', kind: 'tax' as const, name: 'Immobilisations', sequence: 30, plus: [], minus: [], floor_zero: false, hidden: false, xml_element: null, legal_reference: null },
  ];

  it('takes a bare code when only one box carries it', () => {
    expect(resolveBoxRef('19', boxes)).toBe(boxes[2]);
  });

  it('takes a qualified code when two do', () => {
    expect(resolveBoxRef('08:tax', boxes)).toBe(boxes[1]);
    expect(resolveBoxRef('08', boxes)).toMatch(/ambiguous/);
  });

  it('says so when nothing carries it', () => {
    expect(resolveBoxRef('44', boxes)).toMatch(/not a box of this form/);
    expect(resolveBoxRef('19:base', boxes)).toMatch(/not a base box of this form/);
  });
});

// ---------------------------------------------------------------------------
// Where a currency comes from now that nothing writes one down.
// ---------------------------------------------------------------------------

describe('a row that names no currency', () => {
  it('takes the currency of its company, and a company takes its pack’s', async () => {
    const company = await one<{ id: string; currency_code: string; language: string }>(
      db,
      `insert into companies (name, country, fiscal_country)
       values ('Sans Devise SRL', 'FR', 'FR') returning id, currency_code, language`,
    );
    const pack = await one<{ currency_code: string; language_default: string }>(
      db,
      `select currency_code, language_default from country_defaults where country = 'FR'`,
    );
    expect(company.currency_code).toBe(pack.currency_code);
    expect(company.language).toBe(pack.language_default);

    await db.query(`select install_country_template($1, 'FR')`, [company.id]);
    const contact = await one<{ id: string }>(
      db,
      `insert into contacts (company_id, name) values ($1, 'Cliente') returning id`,
      [company.id],
    );

    const document = await one<{ currency_code: string }>(
      db,
      `insert into documents (company_id, doc_type, contact_id, document_date)
       values ($1, 'sale_invoice', $2, date '2026-05-05') returning currency_code`,
      [company.id, contact.id],
    );
    expect(document.currency_code).toBe(company.currency_code);

    const product = await one<{ currency_code: string }>(
      db,
      `insert into products (company_id, code, name) values ($1, 'ART-1', 'Article')
       returning currency_code`,
      [company.id],
    );
    expect(product.currency_code).toBe(company.currency_code);

    const payment = await one<{ currency_code: string }>(
      db,
      `insert into payments (company_id, direction, payment_date, amount, journal_id)
       values ($1, 'inbound', date '2026-05-06', 100,
               (select id from journals where company_id = $1 and journal_type = 'bank' limit 1))
       returning currency_code`,
      [company.id],
    );
    expect(payment.currency_code).toBe(company.currency_code);

    await db.query(`delete from companies where id = $1`, [company.id]);
  });

  it('is refused outright when no pack answers, instead of being given euros', async () => {
    // A country this installation carries no pack for. There used to be an
    // answer for it — the euro, written into the column — and now there is
    // none, which is the correct answer.
    const message = await expectError(
      db,
      `insert into companies (name, country, fiscal_country) values ('Muette SRL', 'ZZ', 'ZZ')`,
    );
    expect(message).toMatch(/currency_code|not-null|null value/i);
  });
});
