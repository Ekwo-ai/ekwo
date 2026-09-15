/**
 * What this server needs of the database it is pointed at.
 *
 * An MCP client is installed by whoever wants an assistant, and the database
 * it reaches was installed by whoever runs the books — two decisions, two
 * dates. So the server asks the schema its version before it answers anything,
 * and refuses one it is too new for, by name. The alternative is what an
 * assistant does with a missing column: it improvises, and the improvisation
 * is an accounting entry.
 *
 * Declared in `package.json` under `ekwo.schemaMin`, as a country pack
 * declares it in its manifest, and repeated here as a constant so a bundle
 * that never reads a manifest still carries it.
 */

import { schemaIsAtLeast } from '@ekwo-ai/core';
import { EkwoMcpError, type Backend } from './backend.js';

/** The oldest schema this server speaks to. */
export const SCHEMA_MIN = '0.3.0';

/** The version the migrations of that database define. */
export async function installedSchemaVersion(backend: Backend): Promise<string | undefined> {
  try {
    const rows = await backend.rpc<string>('ekwo_schema_version');
    const version = rows[0];
    return typeof version === 'string' ? version : undefined;
  } catch {
    // A database that has no such function is not an Ekwo database at this
    // version — which is exactly what the caller is about to say.
    return undefined;
  }
}

/**
 * Refuses a database older than this server, and says which way to fix it.
 *
 * A database that cannot answer at all is refused too: `ekwo_schema_version()`
 * has existed since the first migration, so a silence means the schema is not
 * installed rather than that it is old.
 */
export async function assertSchemaSupported(backend: Backend): Promise<string> {
  const installed = await installedSchemaVersion(backend);
  if (installed === undefined) {
    throw new EkwoMcpError(
      `schema_not_found: this database does not answer ekwo_schema_version(), so it does not carry the Ekwo schema. Run \`npx ekwo init\` against it first.`,
    );
  }
  if (!schemaIsAtLeast(installed, SCHEMA_MIN)) {
    throw new EkwoMcpError(
      `schema_too_old: this database is at ${installed} and @ekwo-ai/mcp needs ${SCHEMA_MIN} or newer. Run \`npx ekwo migrate\` against it, then start this server again.`,
      {
        hint: 'Upgrading the database is the fix, never pinning this server: the schema moves forward only, and an older client would be reading rows that no longer mean what it thinks.',
      },
    );
  }
  return installed;
}
