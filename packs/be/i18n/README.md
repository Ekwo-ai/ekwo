# `packs/be/i18n/` — the Belgian labels in Dutch, German and English

Belgium keeps its books in three languages, and the law is published in three.
This folder is what makes that true of the software: `nl.json`, `de.json` and
`en.json` each carry every label of the pack — the two charts of accounts, the
journals, the VAT codes, the boxes of the periodic return, the lines of the
annual accounts, the sentences an invoice has to print and the fixed-asset
categories.

`pack.json` declares `"languages": ["nl", "de", "en"]`, and that declaration is
a promise: `ekwo pack check` fails, naming every missing key, if any of the
three stops covering the pack. The pack's own files are written in French,
which is what `defaults.language` says; French is therefore not a file here.

## Where the wording comes from

| What | Source |
|---|---|
| Both charts of accounts | The minimum chart of accounts published by the Belgian Accounting Standards Commission (CNC/CBN), in its four-language edition — annex 1 for companies, annex 3 for associations and foundations, under the Royal Decree of 21 October 2018. |
| Accounts the minimum chart does not itself divide | Translated here. The minimum chart stops at three digits in most classes; the working sub-accounts of this pack — `550000 Banque — compte courant`, `615100 Frais de voiture` — have no statutory wording in any language, so they are a faithful translation of the French label and nothing more. |
| VAT return boxes | The periodic VAT return as Intervat presents it. |
| Annual accounts | The abbreviated model of the Central Balance Sheet Office of the National Bank of Belgium. |
| Legal mentions | The wording the VAT Code and its implementing decrees prescribe, in the language of the version concerned. |

Two things to know before you rely on the German. The Commission publishes its
German chart of accounts as an **unofficial translation** — it says so itself —
so German is authoritative in the same way the Commission's own document is,
and no further. And **no administration publishes an English chart of accounts
for Belgium**: the English file is the Commission's own four-language edition
where it reaches, and the wording the profession uses elsewhere.

## Adding to a language, or adding one

A label is a translation of the same concept and never a second rule. The code,
the account type, the rate, the box and the formula are the same in every
language; only the wording changes. If a translation would only be right under
a different rule, the pack is wrong in the original too, and that is an issue
rather than a translation.

To add a language, write `<lang>.json` with every key — the check tells you
which — and add the code to `languages` in `pack.json`. A file that is not
declared may be partial: a key it does not carry falls back to the French
label, which is how a language can be contributed a section at a time.
