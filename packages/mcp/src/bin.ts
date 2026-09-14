#!/usr/bin/env node
/**
 * `npx @ekwo-ai/mcp`, over stdio.
 *
 * Everything comes from the environment, because that is how an MCP client
 * launches a server: a command and a block of variables in
 * `claude_desktop_config.json` or `.mcp.json`. Nothing is read from a file
 * and nothing is written to one — a credential cache would save one paste and
 * turn the first accidental `git add .` into a disclosure.
 *
 * stdout belongs to the protocol. Anything this process has to say to a human
 * goes to stderr, or the client sees a parse error instead of a server.
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { openBackend, readConfig } from './config.js';
import { assertSchemaSupported } from './schema.js';
import { SERVER_VERSION, buildServer } from './server.js';
import { installedModules } from './tools/modules.js';

async function main(): Promise<void> {
  const argument = process.argv[2];
  if (argument === '--help' || argument === '-h') {
    process.stderr.write(HELP);
    return;
  }
  if (argument === '--version' || argument === '-v') {
    process.stderr.write(`${SERVER_VERSION}\n`);
    return;
  }

  const config = readConfig(process.env);
  const backend = await openBackend(config);
  // Before anything else: a database older than this server is refused by
  // name rather than answered from wrong assumptions.
  const schemaVersion = await assertSchemaSupported(backend);
  // What this installation carries, from the registry table. A database that
  // predates the module framework answers with nothing, and the socle's own
  // tools are all a client then sees.
  const modules = await installedModules(backend);
  const server = buildServer(backend, { modules });

  const shutdown = async (): Promise<void> => {
    await server.close().catch(() => {});
    await backend.close().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());

  await server.connect(new StdioServerTransport());
  process.stderr.write(
    `ekwo-mcp: connected over ${config.mode === 'sql' ? 'a direct Postgres connection' : 'PostgREST as the signed-in user'}` +
      `, schema ${schemaVersion}` +
      `${modules.length > 0 ? `, modules: ${modules.join(', ')}` : ''}\n`,
  );
}

const HELP = `ekwo-mcp — the Model Context Protocol server for Ekwo OS.

It speaks MCP over stdio and is started by a client, not by hand. Configure it
in claude_desktop_config.json or .mcp.json with:

  SUPABASE_URL            https://<ref>.supabase.co
  SUPABASE_ANON_KEY       the anon (publishable) key — never the service_role key
  EKWO_EMAIL              the user this assistant acts as
  EKWO_PASSWORD           their password
  EKWO_ACCESS_TOKEN       an access token, instead of the two above

For a self-hosted database, without PostgREST in front of it:

  EKWO_DB_URL             postgresql://…
  EKWO_ACT_AS_USER_ID     the auth.users id this server acts for — required,
                          because a database connection is nobody

Row level security applies either way. This server has no privileges of its
own and refuses a service_role key.
`;

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
