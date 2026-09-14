/**
 * The protocol surface: what a client actually sees.
 *
 * A real MCP client is connected to the server over the in-memory transport,
 * so the tool list, the JSON Schemas, the resources and the prompts are the
 * ones the SDK serialises — not the zod objects this package holds. A schema
 * that fails to convert is a tool a model cannot call, and it fails here
 * rather than in somebody's Claude Desktop.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SERVER_NAME, SERVER_VERSION, buildServer, type Backend } from '../../packages/mcp/src/index.js';
import { freshDatabase, repoRoot } from '../helpers/db.js';
import { newCompany, type Fixture } from '../helpers/factory.js';
import { backendFor } from './helpers.js';

const READ_TOOLS = [
  'list_companies',
  'get_company',
  'list_accounts',
  'search_contacts',
  'search_products',
  'list_documents',
  'get_document',
  'list_bank_accounts',
  'list_bank_transactions',
  'get_preferences',
  'list_api_keys',
  'list_invitations',
  'trial_balance',
  'general_ledger',
  'aged_balance',
  'vat_return',
  'list_statements',
  'financial_statement',
  'generate_fec',
  'read_audit_log',
  'status',
];

const WRITE_TOOLS = [
  'create_contact',
  'create_product',
  'update_product',
  'create_document',
  'update_document_lines',
  'post_document',
  'record_payment',
  'reconcile',
  'unreconcile',
  'create_bank_account',
  'create_bank_transaction',
  'create_company',
  'update_company_profile',
  'set_preferences',
  'invite_member',
  'create_api_key',
  'revoke_api_key',
  'revoke_invitation',
  'lock_period',
  'opening_balance',
  'close_fiscal_year',
  'reopen_fiscal_year',
];

let db: PGlite;
let fx: Fixture;
let backend: Backend;
let client: Client;

beforeAll(async () => {
  db = await freshDatabase();
  fx = await newCompany(db, { country: 'BE', name: 'Surface SRL' });
  backend = backendFor(db, fx.ownerId);

  const server = buildServer(backend);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
});

afterAll(async () => {
  await client.close();
  await db.close();
});

describe('what the server says it is', () => {
  it('names itself and its version in the handshake, and the version is the package', async () => {
    const info = client.getServerVersion();
    expect(info?.name).toBe(SERVER_NAME);
    expect(info?.version).toBe(SERVER_VERSION);

    // The constant is repeated in the source so a bundle carries it without a
    // manifest; this is what keeps the two from drifting at a release.
    const manifest = JSON.parse(
      await readFile(join(repoRoot, 'packages', 'mcp', 'package.json'), 'utf8'),
    ) as { name: string; version: string };
    expect(manifest.name).toBe(SERVER_NAME);
    expect(manifest.version).toBe(SERVER_VERSION);
  });
});

describe('the tools a client is offered', () => {
  it('are the ones this release ships, and nothing else', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([...READ_TOOLS, ...WRITE_TOOLS].sort());
  });

  it('each carry a JSON Schema a model can fill in', async () => {
    const { tools } = await client.listTools();
    for (const tool of tools) {
      const schema = JSON.parse(JSON.stringify(tool.inputSchema)) as {
        type: string;
        properties?: Record<string, unknown>;
        required?: string[];
      };
      expect(schema.type, tool.name).toBe('object');
      expect(typeof schema.properties, tool.name).toBe('object');
      expect(tool.description?.length ?? 0, tool.name).toBeGreaterThan(80);
    }
  });

  it('say which of them only read, and which cannot be undone', async () => {
    const { tools } = await client.listTools();
    const byName = new Map(tools.map((tool) => [tool.name, tool]));

    for (const name of READ_TOOLS) {
      expect(byName.get(name)?.annotations?.readOnlyHint, name).toBe(true);
    }
    for (const name of WRITE_TOOLS) {
      expect(byName.get(name)?.annotations?.readOnlyHint, name).toBe(false);
    }
    // The ones a model must ask about before calling.
    for (const name of [
      'post_document',
      'lock_period',
      'opening_balance',
      'close_fiscal_year',
      'reopen_fiscal_year',
    ]) {
      expect(byName.get(name)?.annotations?.destructiveHint, name).toBe(true);
    }
  });

  it('ask for a company on every write', async () => {
    const { tools } = await client.listTools();
    const needsCompany = [
      'create_contact',
      'create_product',
      'create_document',
      'record_payment',
      'create_bank_account',
      'create_bank_transaction',
      'lock_period',
      'opening_balance',
    ];
    for (const name of needsCompany) {
      const schema = tools.find((tool) => tool.name === name)?.inputSchema as {
        required?: string[];
      };
      expect(schema.required, name).toContain('company_id');
    }
  });
});

describe('calling a tool', () => {
  it('answers with JSON', async () => {
    const result = await client.callTool({ name: 'list_companies', arguments: {} });
    const content = result.content as { type: string; text: string }[];
    expect(content[0]?.type).toBe('text');
    const payload = JSON.parse(content[0]?.text ?? '{}') as { companies: { id: string }[] };
    expect(payload.companies.map((company) => company.id)).toEqual([fx.companyId]);
  });

  it('reports a refusal as a tool error, not as a broken connection', async () => {
    const result = await client.callTool({
      name: 'get_document',
      arguments: { document_id: '11111111-1111-4111-8111-111111111111' },
    });
    expect(result.isError).toBe(true);
    const content = result.content as { text: string }[];
    expect(content[0]?.text).toMatch(/not_found/);
  });

  it('refuses arguments that do not fit the schema', async () => {
    const result = await client.callTool({
      name: 'trial_balance',
      arguments: { company_id: fx.companyId, from: '15 June 2026', to: '2026-12-31' },
    });
    expect(result.isError).toBe(true);
  });
});

describe('resources and prompts', () => {
  it('offers the chart of accounts and the taxes as resources', async () => {
    const { resourceTemplates } = await client.listResourceTemplates();
    expect(resourceTemplates.map((template) => template.uriTemplate).sort()).toEqual([
      'ekwo://companies/{companyId}/chart',
      'ekwo://companies/{companyId}/taxes',
    ]);
  });

  it('reads the chart of accounts of a company', async () => {
    const result = await client.readResource({
      uri: `ekwo://companies/${fx.companyId}/chart`,
    });
    const first = result.contents[0] as { mimeType: string; text: string };
    expect(first.mimeType).toBe('application/json');
    const payload = JSON.parse(first.text) as { accounts: { code: string }[] };
    expect(payload.accounts.length).toBeGreaterThan(300);
    expect(payload.accounts.some((account) => account.code === '400000')).toBe(true);
  });

  it('reads the taxes with the postings that say where they land', async () => {
    const result = await client.readResource({
      uri: `ekwo://companies/${fx.companyId}/taxes`,
    });
    const first = result.contents[0] as { text: string };
    const payload = JSON.parse(first.text) as {
      taxes: {
        code: string;
        amount: string;
        tax_kind: string;
        recoverable: boolean;
        price_include: boolean;
        cash_basis: boolean;
        jurisdiction: string | null;
        postings: { posting_type: string; account_id: string | null; declaration_box: string | null }[];
      }[];
    };
    const sale = payload.taxes.find((tax) => tax.code === 'BE-S-21');
    expect(sale?.amount).toBe('21.0000');
    expect(sale?.postings.some((posting) => posting.declaration_box === '54')).toBe(true);
    // What the tax is, not only how much: a client that has to choose one
    // should not be reading the code to find out.
    expect(sale).toMatchObject({
      tax_kind: 'vat',
      recoverable: true,
      price_include: false,
      cash_basis: false,
      jurisdiction: null,
    });

    // A partially deductible tax, with the posting that carries no account
    // because its share lands on the account of the document line.
    const car = payload.taxes.find((tax) => tax.code === 'BE-P-21-50-I');
    const onBase = car?.postings.filter((posting) => posting.posting_type === 'tax_on_base') ?? [];
    expect(onBase.length).toBeGreaterThan(0);
    for (const posting of onBase) expect(posting.account_id).toBeNull();
  });

  it('offers the two prompts, and they carry a checklist', async () => {
    const { prompts } = await client.listPrompts();
    expect(prompts.map((prompt) => prompt.name).sort()).toEqual([
      'close_month',
      'prepare_vat_return',
    ]);

    const close = await client.getPrompt({
      name: 'close_month',
      arguments: { company_id: fx.companyId, from: '2026-06-01', to: '2026-06-30' },
    });
    const text = (close.messages[0]?.content as { text: string }).text;
    expect(text).toContain(fx.companyId);
    expect(text).toContain('list_bank_transactions');
    expect(text).toContain('vat_return');

    const vat = await client.getPrompt({
      name: 'prepare_vat_return',
      arguments: { company_id: fx.companyId, from: '2026-04-01', to: '2026-06-30' },
    });
    expect((vat.messages[0]?.content as { text: string }).text).toContain('files nothing');
  });
});
