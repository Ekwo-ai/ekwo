# `packs/fr/i18n/` — the French labels in English

`en.json` carries every label of the French pack: the chart of accounts, the
journals, the VAT codes, the lines of the CA3 return, the balance sheet and
income statement of the tax return, the sentences an invoice has to print and
the fixed-asset categories.

`pack.json` declares `"languages": ["en"]`, and that declaration is a promise:
`ekwo pack check` fails, naming every missing key, if English stops covering
the pack. The pack's own files are written in French, which is what
`defaults.language` says.

## Where the wording comes from

**No administration publishes an English version of the plan comptable
général.** There is nothing to transcribe, so these labels are the wording the
profession uses — the one found in the English-language accounts of French
subsidiaries of foreign groups, and in the English forms the tax administration
publishes for non-resident filers. `Clients` is *Trade receivables*,
`Fournisseurs` is *Trade payables*, `Dotations aux amortissements` is a
*Depreciation charge*.

Two rules held throughout. The wording is consistent with the `account_type`
vocabulary of the core, so that an account called *Trade receivables* is one
the schema also calls receivable. And a French term with no English equivalent
is translated by what it does rather than by a false friend: `amortissements
dérogatoires` is *accelerated tax depreciation*, not "derogatory depreciation",
because that is the thing itself.

Where the French label is the name of a French institution or levy, the English
says what it is: `Contribution économique territoriale` is *Local business tax*,
and `URSSAF — cotisations à payer` is *Social security contributions payable*.

## Adding a language

A label is a translation of the same concept and never a second rule. The code,
the account type, the rate, the box and the formula are the same in every
language. Write `<lang>.json` with every key — `ekwo pack check` tells you which
— and add the code to `languages` in `pack.json`. A file that is not declared
may be partial, and a key it does not carry falls back to the French label.
