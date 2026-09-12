# `docs/` — the long-form reference

| File | What it is | Edited how |
|---|---|---|
| [`schema.md`](schema.md) | Every table, column, enum and function, with their comments | **Generated** by `npm run docs:schema` from `supabase/migrations/`. Do not edit by hand; it would be overwritten |
| [`schema.intro.md`](schema.intro.md) | The prose at the top of `schema.md` | By hand; it is spliced in at generation time |
| [`mapping.md`](mapping.md) | Each Ekwo table and column lined up against Odoo's `account.*` models, the EN 16931 business terms (BT-xx) and the FEC columns | By hand, when the schema or a standard changes |
| [`international.md`](international.md) | The plan for any country: the country pack as data, four phases, the order of countries, what is out of scope | By hand, when a phase is decided or delivered |
| [`decisions/`](decisions/) | Long-form analyses behind a decision, in the language they were written in; `decisions.md` carries the English summary | Added, never edited |
| [`decisions.md`](decisions.md) | One paragraph per design decision and the reason behind it | By hand, **append**; a decision that is reversed gets a dated note, not a deletion |

The short version of each folder lives in that folder's own README. Start
there; come here when you need every column.

`mapping.md` is the contract for integrators: it is what lets someone write
a connector from Odoo, a Peppol platform or a French tax portal in a day,
without an Odoo-compatible RPC layer.
