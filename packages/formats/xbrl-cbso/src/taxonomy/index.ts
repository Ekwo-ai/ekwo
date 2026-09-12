import type { CbsoTemplate } from '../types.js';
import { CBSO_26_M01F_FACTS } from './cbso-26-m01-f.js';
import { IDENTIFICATION_FACTS } from './identification.js';

/** Framework of the CBSO taxonomy this package targets. */
export const FRAMEWORK = '26.0';

/** XML namespaces of the CBSO 26.0 taxonomy, keyed by prefix (`''` = default). */
export const NAMESPACES: Readonly<Record<string, string>> = {
  '': 'http://www.xbrl.org/2003/instance',
  link: 'http://www.xbrl.org/2003/linkbase',
  xbrldi: 'http://xbrl.org/2006/xbrldi',
  xlink: 'http://www.w3.org/1999/xlink',
  iso4217: 'http://www.xbrl.org/2003/iso4217',
  met: 'http://www.nbb.be/be/fr/cbso/dict/met',
  dim: 'http://www.nbb.be/be/fr/cbso/dict/dim',
  open: 'http://www.nbb.be/be/fr/cbso/dict/dom/open',
  aln: 'http://www.nbb.be/be/fr/cbso/dict/dom/aln',
  atc: 'http://www.nbb.be/be/fr/cbso/dict/dom/atc',
  bas: 'http://www.nbb.be/be/fr/cbso/dict/dom/bas',
  bkd: 'http://www.nbb.be/be/fr/cbso/dict/dom/bkd',
  cct: 'http://www.nbb.be/be/fr/cbso/dict/dom/cct',
  ctc: 'http://www.nbb.be/be/fr/cbso/dict/dom/ctc',
  cty: 'http://www.nbb.be/be/fr/cbso/dict/dom/cty',
  dcl: 'http://www.nbb.be/be/fr/cbso/dict/dom/dcl',
  dgl: 'http://www.nbb.be/be/fr/cbso/dict/dom/dgl',
  epc: 'http://www.nbb.be/be/fr/cbso/dict/dom/epc',
  evt: 'http://www.nbb.be/be/fr/cbso/dict/dom/evt',
  fct: 'http://www.nbb.be/be/fr/cbso/dict/dom/fct',
  gdr: 'http://www.nbb.be/be/fr/cbso/dict/dom/gdr',
  hrs: 'http://www.nbb.be/be/fr/cbso/dict/dom/hrs',
  jcc: 'http://www.nbb.be/be/fr/cbso/dict/dom/jcc',
  lgf: 'http://www.nbb.be/be/fr/cbso/dict/dom/lgf',
  mdp: 'http://www.nbb.be/be/fr/cbso/dict/dom/mdp',
  mmt: 'http://www.nbb.be/be/fr/cbso/dict/dom/mmt',
  nmt: 'http://www.nbb.be/be/fr/cbso/dict/dom/nmt',
  ntr: 'http://www.nbb.be/be/fr/cbso/dict/dom/ntr',
  part: 'http://www.nbb.be/be/fr/cbso/dict/dom/part',
  pcd: 'http://www.nbb.be/be/fr/cbso/dict/dom/pcd',
  pfc: 'http://www.nbb.be/be/fr/cbso/dict/dom/pfc',
  prd: 'http://www.nbb.be/be/fr/cbso/dict/dom/prd',
  psn: 'http://www.nbb.be/be/fr/cbso/dict/dom/psn',
  qlt: 'http://www.nbb.be/be/fr/cbso/dict/dom/qlt',
  rls: 'http://www.nbb.be/be/fr/cbso/dict/dom/rls',
  rsn: 'http://www.nbb.be/be/fr/cbso/dict/dom/rsn',
  rst: 'http://www.nbb.be/be/fr/cbso/dict/dom/rst',
  rut: 'http://www.nbb.be/be/fr/cbso/dict/dom/rut',
  spec: 'http://www.nbb.be/be/fr/cbso/dict/dom/spec',
  sts: 'http://www.nbb.be/be/fr/cbso/dict/dom/sts',
  typ: 'http://www.nbb.be/be/fr/cbso/dict/dom/typ',
  wkr: 'http://www.nbb.be/be/fr/cbso/dict/dom/wkr',
  wrg: 'http://www.nbb.be/be/fr/cbso/dict/dom/wrg',
  'atc-enum': 'http://www.nbb.be/be/fr/cbso/26.0/enum/atc-enum',
  'cct-enum': 'http://www.nbb.be/be/fr/cbso/26.0/enum/cct-enum',
  'cty-enum': 'http://www.nbb.be/be/fr/cbso/26.0/enum/cty-enum',
  'fct-enum': 'http://www.nbb.be/be/fr/cbso/26.0/enum/fct-enum',
  'jcc-enum': 'http://www.nbb.be/be/fr/cbso/26.0/enum/jcc-enum',
  'lgf-enum': 'http://www.nbb.be/be/fr/cbso/26.0/enum/lgf-enum',
  'nmt-enum': 'http://www.nbb.be/be/fr/cbso/26.0/enum/nmt-enum',
  'pcd-enum': 'http://www.nbb.be/be/fr/cbso/26.0/enum/pcd-enum',
};

/**
 * Template of the abridged model for companies with capital
 * (framework 26.0, model `m01-f`).
 */
export const CBSO_26_M01F: CbsoTemplate = {
  schemaRef: `http://www.nbb.be/be/fr/cbso/fws/${FRAMEWORK}/mod/m01/m01-f.xsd`,
  facts: [...IDENTIFICATION_FACTS, ...CBSO_26_M01F_FACTS],
};

/**
 * Legal forms (`lgf` domain). Only identifiers verified against a filing
 * accepted by the NBB are listed; any other `lgf:mXXX` member of the taxonomy
 * can be passed as a plain string.
 */
export const LegalForm = {
  /** Société anonyme / Naamloze vennootschap. */
  SA_NV: 'lgf:m014',
} as const;

/**
 * Enterprise courts (`cct` domain). Same rule as {@link LegalForm}.
 */
export const EnterpriseCourt = {
  /** Tribunal de l'entreprise francophone de Bruxelles. */
  BRUSSELS_FR: 'cct:m31',
} as const;
