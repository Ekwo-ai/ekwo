# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] — 2026-09-11

### Added
- `generateCbsoXbrl` / `XbrlCbso`: XBRL instance generator for the CBSO 25.0 taxonomy,
  abridged model for companies with capital (m01-f), with board members (natural persons,
  legal entities, permanent representatives, foreign addresses).
- `checkBnbEquations`: arithmetic identities of the abridged model.
- `validateInput`, `CbsoInputError`, enterprise-number helpers.
- `@ekwo-ai/xbrl-cbso/pcmn`: Belgian minimum chart of accounts → reporting codes.
