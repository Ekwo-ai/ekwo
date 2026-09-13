/**
 * A thin client over the Ekwo schema.
 *
 * It is deliberately small: Supabase already exposes every table as REST with
 * an OpenAPI description, so there is nothing to wrap there. What is worth
 * wrapping is the handful of functions that carry the accounting rules, and
 * the FEC export.
 *
 * `@supabase/supabase-js` is an optional peer dependency; only the two
 * methods used here are required, so any structurally compatible client
 * works and this package keeps zero runtime dependencies.
 */

import { fromQueryRow, generateFec, type FecOptions, type FecQueryRow } from '@ekwo-ai/fec';
import type {
  AgedBalanceRow,
  Entry,
  Instance,
  InstanceEdition,
  InstanceAdmin,
  IsoDate,
  TrialBalanceRow,
  Uuid,
  VatReturnRow,
} from './types.js';

export interface RpcResult<T> {
  data: T | null;
  error: { message: string; code?: string; details?: string } | null;
}

/** The slice of `@supabase/supabase-js` this client needs. */
export interface SupabaseLike {
  rpc<T = unknown>(fn: string, args?: Record<string, unknown>): PromiseLike<RpcResult<T>>;
}

export class EkwoError extends Error {
  override name = 'EkwoError';
  readonly code: string | undefined;

  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

function unwrap<T>(result: RpcResult<T>, call: string): T {
  if (result.error !== null) {
    throw new EkwoError(`${call} failed: ${result.error.message}`, result.error.code);
  }
  if (result.data === null) {
    throw new EkwoError(`${call} returned nothing`);
  }
  return result.data;
}

export interface PeriodRange {
  companyId: Uuid;
  from: IsoDate;
  to: IsoDate;
}

export class EkwoClient {
  constructor(private readonly db: SupabaseLike) {}

  /** Books a document and returns the entry it produced. */
  async postDocument(documentId: Uuid): Promise<Entry> {
    const result = await this.db.rpc<Entry>('post_document', { p_document_id: documentId });
    return unwrap(result, 'post_document');
  }

  /** Numbers and posts an entry that was built by hand. */
  async postEntry(entryId: Uuid): Promise<Entry> {
    const result = await this.db.rpc<Entry>('post_entry', { p_entry_id: entryId });
    return unwrap(result, 'post_entry');
  }

  /**
   * Matches a debit line against a credit line. With no amount, the smaller
   * of the two open amounts is used.
   */
  async reconcile(debitLineId: Uuid, creditLineId: Uuid, amount?: number): Promise<unknown> {
    const result = await this.db.rpc('reconcile', {
      p_line_a: debitLineId,
      p_line_b: creditLineId,
      p_amount: amount ?? null,
    });
    return unwrap(result, 'reconcile');
  }

  async trialBalance(range: PeriodRange): Promise<TrialBalanceRow[]> {
    const result = await this.db.rpc<TrialBalanceRow[]>('trial_balance', {
      p_company_id: range.companyId,
      p_from: range.from,
      p_to: range.to,
    });
    return unwrap(result, 'trial_balance');
  }

  async vatReturn(range: PeriodRange): Promise<VatReturnRow[]> {
    const result = await this.db.rpc<VatReturnRow[]>('vat_return', {
      p_company_id: range.companyId,
      p_from: range.from,
      p_to: range.to,
    });
    return unwrap(result, 'vat_return');
  }

  async agedBalance(
    companyId: Uuid,
    at: IsoDate,
    group: 'receivable' | 'payable' = 'receivable',
  ): Promise<AgedBalanceRow[]> {
    const result = await this.db.rpc<AgedBalanceRow[]>('aged_balance', {
      p_company_id: companyId,
      p_at: at,
      p_group: group,
    });
    return unwrap(result, 'aged_balance');
  }

  /** The French FEC for a period, ready to be written to disk. */
  async generateFec(range: PeriodRange, options?: FecOptions): Promise<string> {
    const result = await this.db.rpc<FecQueryRow[]>('fec_lines', {
      p_company_id: range.companyId,
      p_from: range.from,
      p_to: range.to,
    });
    return generateFec(unwrap(result, 'fec_lines').map(fromQueryRow), options);
  }

  /**
   * Records the installation. Called once, by the installer; raises if this
   * database has already been set up.
   */
  async initInstance(
    organizationName: string,
    country: string,
    edition: InstanceEdition = 'community',
  ): Promise<Instance> {
    const result = await this.db.rpc<Instance>('init_instance', {
      p_organization_name: organizationName,
      p_country: country,
      p_edition: edition,
    });
    return unwrap(result, 'init_instance');
  }

  /**
   * Makes a user an instance administrator. The first claim is open; after
   * that only an administrator may appoint another.
   */
  async claimInstanceAdmin(userId?: Uuid): Promise<InstanceAdmin> {
    const result = await this.db.rpc<InstanceAdmin>('claim_instance_admin', {
      p_user_id: userId ?? null,
    });
    return unwrap(result, 'claim_instance_admin');
  }

  /**
   * Opt-in: records an address so Ekwo can reach the operator. Never
   * required, and `unregisterInstance()` undoes it.
   */
  async registerInstance(contactEmail: string): Promise<Instance> {
    const result = await this.db.rpc<Instance>('register_instance', {
      p_contact_email: contactEmail,
    });
    return unwrap(result, 'register_instance');
  }

  async unregisterInstance(): Promise<Instance> {
    const result = await this.db.rpc<Instance>('unregister_instance', {});
    return unwrap(result, 'unregister_instance');
  }

  /** Installs a country chart of accounts, journals and taxes into a company. */
  async installCountryTemplate(companyId: Uuid, country: string): Promise<void> {
    const result = await this.db.rpc('install_country_template', {
      p_company_id: companyId,
      p_country: country,
    });
    if (result.error !== null) {
      throw new EkwoError(`install_country_template failed: ${result.error.message}`);
    }
  }
}
