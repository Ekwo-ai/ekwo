# Where each language of the Estonian pack comes from

The pack itself is written in Estonian, which is `defaults.language`. Estonian
is the language the Accounting Act, the VAT Act and form KMD are enacted in, so
the labels in `accounts.csv`, `taxes.json`, `tax_report.json`,
`statements.json` and the legal mentions of `pack.json` are the statutory
wording and not a translation of anything.

## `en.json`

English is declared in `pack.json`, so it covers every label of the pack and
`ekwo pack check` fails if it stops doing so.

Three of its sections are **not** translations. They are the official English
wordings published beside the Estonian ones, and they are used verbatim so that
a reader comparing an Ekwo statement with a filed annual report sees the same
sentence:

| Section | Source of the English wording |
|---|---|
| `statement_lines` | Riigi Teataja's official English translation of the annexes to the Accounting Act — annex 1, the balance sheet scheme, and annex 2, the income statement schemes |
| `tax_report_boxes` | The Estonian Tax and Customs Board's English edition of form KMD and its completion instructions, published beside the Estonian form |
| `legal_mentions` | The official English translation of the VAT Act, § 37 (8), for the notations the Act prescribes, with the reference each one carries |

The Tax and Customs Board prints a disclaimer on its English form: the original
Estonian form is the one that must be filled in. The English labels here are
therefore for a reader, never for a filing.

The rest — the account names, the tax names, the chart name — is translated,
because nothing official exists to copy: Estonia prescribes no chart of
accounts, so no administration publishes English names for one.

## Adding a language

One file, `i18n/<lang>.json`, and it is the only place that language's wording
lives. A file that `pack.json` does not declare may be partial, and a key it
does not carry falls back to the Estonian label; declaring the language in the
manifest is a promise that it covers everything, and `ekwo pack check` holds
you to it.

Russian is the language most often asked for next in Estonia. It is not here
because nobody has written it, not because it does not belong.
