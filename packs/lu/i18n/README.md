# `packs/lu/i18n/` — the Luxembourg pack in German and in English

`pack.json` declares `"languages": ["de", "en"]`, and that declaration is a
promise: `ekwo pack check` fails, naming every missing key, if either language
stops covering the chart, the journals, the taxes, the boxes of the VAT return,
the lines of the two abridged schemes or the sentences an invoice prints. The
pack's own files are written in French, which is what `defaults.language` says.

French is not a default chosen for convenience. It is the language the
*règlement grand-ducal du 12 septembre 2019* publishes the chart of accounts
in, and the language the eCDF forms name as their reference.

## Where the wording comes from

**Most of it is not a translation.** Luxembourg publishes its accounting and
tax forms in three languages, and this pack transcribes them rather than
rendering them:

| Section | German and English come from |
|---|---|
| `accounts` — all 1 026 of them | the eCDF deposit form for the standard chart of accounts, published in French, German and English |
| `tax_report_boxes` | the field list of the eCDF periodic VAT return, `TVA_DECM`, published in the same three languages |
| `statement_lines` | the eCDF forms `CA_BILANABR` and `CA_COMPPABR`, each published in the three languages |

So *Fournisseurs* is **Lieferanten** and **Suppliers** because the State says
so on the form a company files, not because somebody chose those words here.
Where a rate row of the VAT return carries no wording of its own — the form
prints `17%` in a column and nothing else — the label is composed from the
section heading and the rate, in the three languages the form gives for that
heading.

**Four things are translated here, and are marked as such.** The names of the
journals, the name of the chart, the names of the tax codes and the sentences
of `legal_mentions` have no official German or English version, because no
Luxembourg text prescribes one. They were written for this pack.

That matters most for the legal mentions. The wording an invoice must carry is
prescribed in French by article 63, paragraph 8, of the VAT law; the German and
the English here say the same thing and have no legal standing of their own. An
invoice that has to be right in German should carry the wording its recipient's
administration expects, and a renderer that prints these is printing a
convenience.

**Where a form's own languages disagree, the French is the reference.** The
eCDF forms say so themselves, on the abridged balance sheet in as many words:
the French version is the reference, the German and English versions are
available and not binding. Nothing in this pack changes that.

## Adding a language

A label is a translation of the same concept and never a second rule. The code,
the account type, the rate, the box and the formula are the same in every
language. Write `<lang>.json` with every key — `ekwo pack check` tells you which
are missing, and counts them — and add the code to `languages` in `pack.json`.
A file that is not declared may be partial, and a key it does not carry falls
back to the French label.

Luxembourgish would be the obvious fourth. There is no official Luxembourgish
version of the chart or of the forms, so it would be a translation throughout,
and it should say so here before it is declared.
