# `docs/` — the long-form reference

| File | What it is | Edited how |
|---|---|---|
| [`schema.md`](schema.md) | Every table, column, enum and function, with their comments | **Generated** by `npm run docs:schema` from `supabase/migrations/`. Do not edit by hand; it would be overwritten |
| [`schema.intro.md`](schema.intro.md) | The prose at the top of `schema.md` | By hand; it is spliced in at generation time |
| [`mapping.md`](mapping.md) | Each Ekwo table and column lined up against Odoo's `account.*` models, the EN 16931 business terms (BT-xx) and the FEC columns | By hand, when the schema or a standard changes |
| [`packs.md`](packs.md) | The country pack format file by file, how it is compiled into a seed, every rule `ekwo pack check` applies, how a pack is versioned, who may call one reviewed, and a walkthrough for adding a country in a day | By hand, when the format, the compiler or the certification policy changes |
| [`modules.md`](modules.md) | What a module is, the six rules it follows, how its migrations and its country data are applied, and how to write one in a day | By hand, when the mechanism changes |
| [`international.md`](international.md) | The plan for any country: the country pack as data, four phases, the order of countries, what is out of scope | By hand, when a phase is decided or delivered |
| [`languages.md`](languages.md) | How a label reaches a reader in their own language: what stays English, what is data, how `label_for` chooses, and what a pack owes a language it declares | By hand, when the mechanism changes |
| [`sharing.md`](sharing.md) | How a document is published behind a link a customer opens without an account: the three functions, what may be shared and the refusal each other case gets, the exact shape `shared_document()` answers with, and why there is no access code and no IP address | By hand, when the functions or the payload change |
| [`releasing.md`](releasing.md) | How a release is cut: the schema-version migration, the package versions and the schema floor, the changelog, the tag and the GitHub Release | By hand, when the procedure changes |
| [`decisions.md`](decisions.md) | One paragraph per design decision and the reason behind it | By hand, **append**; a decision that is reversed gets a dated note, not a deletion |

The short version of each folder lives in that folder's own README. Start
there; come here when you need every column. Two of those folder READMEs are
worth naming: [`supabase/seed/`](../supabase/seed/README.md) says which
reference data is generated from a pack and who applies it, and
[`packages/cli/`](../packages/cli/README.md) is the installation guide,
including the four things an operator has to do on their own Supabase project
that no installer can do for them.

`mapping.md` is the contract for integrators: it is what lets someone write
a connector from Odoo, a Peppol platform or a French tax portal in a day,
without an Odoo-compatible RPC layer.
