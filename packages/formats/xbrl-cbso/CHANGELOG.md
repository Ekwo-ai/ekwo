# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.2.0] — 2026-09-14

Released with Ekwo OS `v0.2.0`, the first tagged release of the repository this
package lives in.

### Fixed
- **A negative half was rounded the wrong way.** The equations and the PCMN
  mapping used `Math.round(v * 100) / 100`, which goes towards positive
  infinity and turns `-0.005` into `-0.00`, and which reads `2.675` as `2.67`
  because `2.675 * 100` is really `267.49999999999994`. The new `roundCurrency`
  rounds half up on the absolute value, and is the same file in the three
  packages that hold a copy.
- **53 reporting codes were filed under the wrong fact**, among them nine pairs that were
  swapped with each other: `22/27` (Immobilisations corporelles) with `24` (Mobilier et
  matériel roulant), `20/58` (TOTAL DE L'ACTIF) with `10/49` (TOTAL DU PASSIF), `10`
  (Capital) with `10/11` (Apport), `65` with `65/66B` (Charges financières), `14`
  (Bénéfice à reporter) with `9906` (Bénéfice à affecter), `8179` with `8309` in the
  fixed-assets annex, and nine rows of the social balance sheet. `29` (Créances à plus d'un
  an), `44` (Dettes commerciales), `62` (Rémunérations) and `66A` were filed under `902`,
  `440/4`, `1023` and `29`. Every correction is sourced in
  [`docs/sources.md`](docs/sources.md) and pinned by `test/rubrics.test.ts`.

### Changed
- **Target framework is now CBSO 26.0**, in use by the Central Balance Sheet Office since
  2 January 2026: `link:schemaRef` points at `fws/26.0/mod/m01/m01-f.xsd` and the
  enumeration namespaces move to `26.0`. The abridged model itself did not change between
  25.0 and 26.0 — the generator produces the same 430 facts against either framework — but
  the postal-code enumeration follows the municipality mergers of 1 January 2025.
- The reporting-code table is **generated** from the NBB taxonomy package by
  `scripts/build-taxonomy.mjs`, no longer transcribed by hand, and covers the whole model:
  297 codes and 430 cells, against 106 codes before. `--check` verifies the committed table
  against a package.
- The previous-year boxes the NBB suffixes with `P` in the annexes (`8059P`, `1003P`) stay
  the `p` column of their base code; `14P`, which is a line of its own, keeps its own code.
- `CBSO_25_M01F` is renamed `CBSO_26_M01F`; `FRAMEWORK` is exported.
- `CbsoInput.values` becomes optional, and `unknownCodes` returns a sorted array.

### Added
- `CbsoInput.lines`: statement lines keyed by their fact signature
  (`met:am1|bas:m9|rst:m2`) instead of by a reporting code, so the mapping can live in the
  system that produced the statement rather than being copied here. `CbsoInput.values`
  remains supported as the legacy path, and the two can be combined.
- `resolveFactKey`, `valuesFromFactKeys`, `parseFactKey`, `factKeyOf`, `mergeValues` and
  `CbsoFactKeyError`, which names the candidate codes when a key fits more than one line.
- `unfiledValues(input)`: figures that would be dropped, because the code is unknown or
  because the model has no such column.
- `docs/sources.md`: where every assertion comes from, and what still needs a filing to
  confirm it.

## [0.1.0] — 2026-09-11

### Added
- `generateCbsoXbrl` / `XbrlCbso`: XBRL instance generator for the CBSO taxonomy,
  abridged model for companies with capital (m01-f), with board members (natural persons,
  legal entities, permanent representatives, foreign addresses).
- `checkBnbEquations`: arithmetic identities of the abridged model.
- `validateInput`, `CbsoInputError`, enterprise-number helpers.
- `@ekwo-ai/xbrl-cbso/pcmn`: Belgian minimum chart of accounts → reporting codes.
