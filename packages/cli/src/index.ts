/**
 * The CLI as a library.
 *
 * Exported so the tests can drive the same code paths a terminal would, and
 * so another tool can reuse the migration runner and the installation
 * sequence without shelling out.
 */

export { parseArgs, UsageError, type ParsedArgs } from './args.js';
export {
  createAuthUser,
  findAuthUserByEmail,
  type AuthUser,
  type CreateAuthUser,
  type CreateAuthUserOptions,
  type FetchLike,
} from './auth.js';
export {
  availableCountries,
  bootstrap,
  schemaIsInstalled,
  type BootstrapOptions,
  type BootstrapResult,
  type Step,
} from './bootstrap.js';
export { DEMO_SEED, migrationsDir, resolveBundleDir, seedDir } from './bundle.js';
export { COMMANDS, help, run, version } from './cli.js';
export { CONFIG_FILE, readConfig, writeConfig, type EkwoConfig } from './config.js';
export {
  NoPoolerHostError,
  POOLER_GENERATIONS,
  directUrl,
  hostOf,
  pickPoolerUrl,
  poolerCandidates,
  poolerUrl,
  projectRefFrom,
  supabaseUrlFor,
  withSsl,
  type Connection,
  type Probe,
} from './connection.js';
export { doctor, type Check, type DoctorReport, type Severity } from './doctor.js';
export {
  applyMigration,
  applyMigrations,
  appliedVersions,
  ensureHistory,
  listMigrations,
  migrationGap,
  parseMigrationFile,
  splitStatements,
  type Gap,
  type Migration,
} from './migrations.js';
export {
  DEFAULT_REGISTRY_URL,
  anyAdminId,
  announce,
  payloadFor,
  readInstance,
  register,
  registryUrl,
  unregister,
  type InstanceRow,
  type RegisterResult,
  type RegistrationPayload,
} from './registry.js';
export { applyDemoSeed, applySeed, applySeeds, listSeeds, type Seed } from './seeds.js';
export { asUser, connect, first, scalar, type SqlClient } from './sql.js';
export { status, syncSchemaVersion, type Status } from './status.js';
