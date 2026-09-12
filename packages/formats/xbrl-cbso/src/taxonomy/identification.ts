/**
 * Identification facts of the CBSO model `m01-f` — the fields of section 1
 * (enterprise number, name, registered office, dates, declarations), which
 * carry no reporting code and are therefore absent from the tables the
 * reporting codes are generated from.
 *
 * Every signature below reproduces a filing accepted by the NBB Filing
 * application. Sections 1 and 2 did not change between frameworks 25.0 and 26.0
 * (see `docs/sources.md`).
 */
import type { TemplateFact } from '../types.js';

export const IDENTIFICATION_FACTS: readonly TemplateFact[] = [
  {"elem":"met:str2","dims":{"dim:bas":"bas:m26","dim:part":"part:m2","dim:psn":"psn:m1","dim:qlt":"qlt:m1"},"period":{"type":"instant","ref":"N"},"role":"ident:entity_number"},
  {"elem":"met:dte1","dims":{"dim:bas":"bas:m27","dim:evt":"evt:m1","dim:part":"part:m2"},"period":{"type":"instant","ref":"N"},"role":"ident:ga_date"},
  {"elem":"met:dte1","dims":{"dim:bas":"bas:m27","dim:mmt":"mmt:m1","dim:part":"part:m2","dim:prd":"prd:m1"},"period":{"type":"instant","ref":"N"},"role":"ident:period_start"},
  {"elem":"met:dte1","dims":{"dim:bas":"bas:m27","dim:mmt":"mmt:m2","dim:part":"part:m2","dim:prd":"prd:m1"},"period":{"type":"instant","ref":"N"},"role":"ident:period_end"},
  {"elem":"met:dte1","dims":{"dim:bas":"bas:m27","dim:mmt":"mmt:m1","dim:part":"part:m2","dim:prd":"prd:m2"},"period":{"type":"instant","ref":"N"},"role":"ident:prev_period_start"},
  {"elem":"met:dte1","dims":{"dim:bas":"bas:m27","dim:mmt":"mmt:m2","dim:part":"part:m2","dim:prd":"prd:m2"},"period":{"type":"instant","ref":"N"},"role":"ident:prev_period_end"},
  {"elem":"met:str2","dims":{"dim:bas":"bas:m29","dim:part":"part:m2","dim:psn":"psn:m1"},"period":{"type":"instant","ref":"N"},"role":"ident:denomination"},
  {"elem":"met:str2","dims":{"dim:bas":"bas:m31","dim:ctc":"ctc:m1","dim:part":"part:m2","dim:psn":"psn:m1"},"period":{"type":"instant","ref":"N"},"role":"ident:street"},
  {"elem":"met:str2","dims":{"dim:bas":"bas:m31","dim:ctc":"ctc:m2","dim:part":"part:m2","dim:psn":"psn:m1"},"period":{"type":"instant","ref":"N"},"role":"ident:number"},
  {"elem":"met:dte1","dims":{"dim:bas":"bas:m27","dim:evt":"evt:m2","dim:part":"part:m2"},"period":{"type":"instant","ref":"N"},"role":"ident:deed_date"},
  {"elem":"met:bln1","dims":{"dim:bas":"bas:m28","dim:dcl":"dcl:m1","dim:part":"part:m2"},"period":{"type":"instant","ref":"N"},"role":"ident:decl:dcl:m1"},
  {"elem":"met:bln1","dims":{"dim:bas":"bas:m28","dim:dcl":"dcl:m39","dim:part":"part:m2"},"period":{"type":"instant","ref":"N"},"role":"ident:decl:dcl:m39"},
  {"elem":"met:bln1","dims":{"dim:bas":"bas:m28","dim:dcl":"dcl:m2","dim:part":"part:m2"},"period":{"type":"instant","ref":"N"},"role":"ident:decl:dcl:m2"},
];
