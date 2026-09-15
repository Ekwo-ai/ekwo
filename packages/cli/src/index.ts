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
  countryCharts,
  countryLanguage,
  countryPack,
  installedPacks,
  schemaIsInstalled,
  type ChartChoice,
  type InstalledPack,
  type PackSummary,
  type BootstrapOptions,
  type BootstrapResult,
  type Step,
} from './bootstrap.js';
export { DEMO_SEED, migrationsDir, resolveBundleDir, seedDir } from './bundle.js';
export {
  OPERATOR_CHECKLIST,
  printOperatorChecklist,
  type OperatorInstruction,
} from './checklist.js';
export { describeCertification, needsWarning, type Certification, type CertificationFacts } from './pack/certification.js';
export {
  compileAssetsSeed,
  compileFrameworkPack,
  compileModuleSeeds,
  compilePack,
  frameworkSeedFileName,
  moduleSeedFileName,
  seedFileName,
  seedFileNames,
} from './pack/compile.js';
export {
  DEFAULT_CHART,
  GENERIC_PACK,
  declaredSeedSequences,
  listPacks,
  packsDir,
  parseCsv,
  readFrameworkPack,
  readPack,
  readSchema,
  repoRootDir,
  resolveBoxRef,
  seedOutputDir,
  sourcesOf,
  PackError,
  type FrameworkManifest,
  type FrameworkPack,
  type Manifest,
  type Pack,
  type PackAccount,
  type PackChart,
  type PackPosting,
  type PackReport,
  type PackReportBox,
  type PackStatement,
  type PackStatementLine,
  type PackStatementRule,
  type PackTax,
  type PackCertification,
  type PackSource,
  type PackAssets,
  type PackAssetCategory,
  type PackGolden,
  type PackGoldenContact,
  type PackGoldenDocument,
  type PackGoldenPayment,
} from './pack/read.js';
export {
  CATEGORY_CODES,
  TREATMENT_CODES,
  taxCodes,
  type CodeIssue,
  type TaxCodes,
  type TreatmentCodes,
} from './pack/vat-codes.js';
export { validate, type Issue } from './pack/schema.js';
export {
  packDiff,
  packStatus,
  packUpgrade,
  resolveCompany,
  type CompanyPackStatus,
  type PackChange,
  type PackStatusReport,
  type PackUpgradeResult,
  type UpgradeOptions,
} from './pack/upgrade.js';
export {
  allModuleMigrations,
  exposeSchemaNote,
  listModules,
  moduleMigrations,
  moduleSeeds,
  readModule,
  readModuleSchema,
  resolveModulesDir,
  ModuleError,
  type EkwoModule,
  type ModuleManifest,
} from './module/read.js';
export { applyModuleMigrations, moduleCommand, MODULE_FLAGS } from './commands/module.js';
export { snapshotRecommendation } from './commands/migrate.js';
export { SCHEMA_MIN } from './schema.js';
export { COMMANDS, help, run, version } from './cli.js';
export { CONFIG_FILE, readConfig, writeConfig, type EkwoConfig } from './config.js';
export {
  NoPoolerHostError,
  POOLER_GENERATIONS,
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
export { doctor, type Check, type DoctorOptions, type DoctorReport, type Severity } from './doctor.js';
export {
  compareCatalogue,
  describeDifferences,
  installedSections,
  readExpectedObjects,
  readGrants,
  resolveInventoryPath,
  InventoryError,
  type CatalogueComparison,
  type CategoryDiff,
  type ExpectedObjects,
  type ExpectedSchema,
  type ExpectedModule,
  type SectionComparison,
} from './inventory.js';
export {
  GRANT_ROLES,
  compareSection,
  describeFinding,
  describeGrants,
  type Difference,
  type GrantFinding,
  type GrantRole,
  type GrantedObject,
  type GrantsSection,
  type HeldBy,
  type QueryRows,
} from './grants.js';
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
