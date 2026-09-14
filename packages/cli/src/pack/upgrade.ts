/**
 * `ekwo pack status` and `ekwo pack upgrade` — the database half of `pack`.
 *
 * `build`, `check` and `list` read a checkout and touch no database. These two
 * do the opposite: they read an installation and know nothing about `packs/`.
 * The difference between what a company copied and what the installation now
 * holds is computed by the schema — `pack_upgrade_diff()` — and not here, so
 * that an application, a module or an assistant asking the same question gets
 * the same answer.
 */

import type { SqlClient } from '../sql.js';

/** One company, and how far it is from the pack this installation holds. */
export interface CompanyPackStatus {
  companyId: string;
  name: string;
  country: string;
  chartCode: string | null;
  /** What the company copied. */
  heldVersion: string | null;
  /** What `country_packs` holds for that country, or null if no pack is loaded. */
  packVersion: string | null;
  behind: boolean;
  /** Differences by rule. Undefined when the pack for that country is missing. */
  differences?: { additions: number; closures: number; review: number };
}

export interface PackStatusReport {
  packs: { country: string; version: string; name: string }[];
  companies: CompanyPackStatus[];
}

/** One difference the upgrade names. */
export interface PackChange {
  object: string;
  key: string;
  change: string;
  rule: 'addition' | 'closure' | 'review';
  detail: Record<string, unknown>;
}

export interface PackUpgradeResult {
  company_id: string;
  country: string;
  chart_code: string;
  from_version: string;
  to_version: string;
  version_moved: boolean;
  applied: PackChange[];
  listed: PackChange[];
  never_applied: PackChange[];
}

/**
 * Where every company stands against the packs this installation holds.
 *
 * The differences are counted per company, which is one query each. A company
 * whose country has no pack loaded gets no count rather than a zero: nothing
 * is known about it, and a zero would read as "up to date".
 */
export async function packStatus(db: SqlClient): Promise<PackStatusReport> {
  const packs = await db.query<{ country: string; version: string; name: string }>(
    'select country, version, name from country_packs order by country',
  );

  const companies = await db.query<{
    company_id: string;
    name: string;
    country: string;
    chart_code: string | null;
    held_version: string | null;
    pack_version: string | null;
  }>(
    `select c.id as company_id, c.name, c.country, cp.chart_code,
            cp.version as held_version, p.version as pack_version
       from companies c
       left join company_packs cp on cp.company_id = c.id and cp.country = c.country
       left join country_packs p on p.country = c.country
      order by c.name`,
  );

  const report: CompanyPackStatus[] = [];
  for (const row of companies) {
    const entry: CompanyPackStatus = {
      companyId: row.company_id,
      name: row.name,
      country: row.country,
      chartCode: row.chart_code,
      heldVersion: row.held_version,
      packVersion: row.pack_version,
      behind: row.held_version !== null && row.pack_version !== null && row.held_version !== row.pack_version,
    };
    if (row.held_version !== null && row.pack_version !== null) {
      const counts = await db.query<{ rule: string; count: string }>(
        `select rule::text as rule, count(*)::text as count
           from pack_upgrade_diff($1) group by rule`,
        [row.company_id],
      );
      const at = (rule: string): number => Number(counts.find((c) => c.rule === rule)?.count ?? '0');
      entry.differences = {
        additions: at('addition'),
        closures: at('closure'),
        review: at('review'),
      };
    }
    report.push(entry);
  }

  return { packs, companies: report };
}

/**
 * The company a name or an id refers to.
 *
 * A name is what an operator types and a uuid is what a script passes, so both
 * are accepted; an ambiguous name is refused rather than resolved to the first
 * match, because upgrading the wrong company is not a mistake anybody notices
 * the same day.
 */
export async function resolveCompany(db: SqlClient, wanted: string): Promise<{ id: string; name: string }> {
  const matches = await db.query<{ id: string; name: string }>(
    `select id, name from companies
      where id::text = $1 or lower(name) = lower($1)
      order by name`,
    [wanted],
  );
  if (matches.length === 0) {
    const known = await db.query<{ name: string }>('select name from companies order by name');
    throw new Error(
      `unknown_company: no company called ${wanted}. This installation has: ${
        known.length === 0 ? 'none' : known.map((c) => c.name).join(', ')
      }`,
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `ambiguous_company: ${matches.length} companies are called ${wanted}. Name one by its id: ${matches
        .map((c) => c.id)
        .join(', ')}`,
    );
  }
  return matches[0] as { id: string; name: string };
}

export interface UpgradeOptions {
  /** Also apply the differences the three rules leave for review. */
  apply?: boolean;
  /** Upgrade a second pack the company holds — a foreign VAT registration. */
  country?: string;
}

export async function packUpgrade(
  db: SqlClient,
  companyId: string,
  options: UpgradeOptions = {},
): Promise<PackUpgradeResult> {
  const rows = await db.query<{ pack_upgrade: PackUpgradeResult }>(
    'select pack_upgrade($1, $2, $3) as pack_upgrade',
    [companyId, options.country ?? null, options.apply === true],
  );
  const result = rows[0]?.pack_upgrade;
  if (result === undefined) throw new Error('pack_upgrade returned nothing');
  return result;
}

/** What would change, without changing it. */
export async function packDiff(
  db: SqlClient,
  companyId: string,
  country?: string,
): Promise<PackChange[]> {
  return db.query<PackChange>(
    'select object, key, change, rule::text as rule, detail from pack_upgrade_diff($1, $2)',
    [companyId, country ?? null],
  );
}
