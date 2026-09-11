export { generateCbsoXbrl, unknownCodes, XbrlCbso, formatNumber, escapeXml } from './generator.js';
export { checkBnbEquations, ABRIDGED_IDENTITIES } from './equations.js';
export type { EquationViolation } from './equations.js';
export { validateInput } from './validate.js';
export { CbsoInputError } from './errors.js';
export { normalizeEnterpriseNumber, isValidEnterpriseNumber } from './enterprise-number.js';
export { CBSO_25_M01F, NAMESPACES, LegalForm, EnterpriseCourt } from './taxonomy/index.js';
export type {
  Administrator,
  BnbCode,
  CbsoInput,
  CbsoTemplate,
  Declarations,
  GenerateOptions,
  IsoDate,
  LegalEntityAdministrator,
  NaturalPersonAdministrator,
  PostalAddress,
  TemplateFact,
  YearValues,
} from './types.js';
