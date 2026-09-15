# Languages

Accounting is done in a language. A Belgian company keeps its books in French,
in Dutch or in German; its accountant reads the chart of accounts in one of
them, and the National Bank expects the annual accounts in the one the company
files in. Software that picks a language for the user, or that translates only
half of what is on screen, is software that a firm cannot hand to a client.

Ekwo OS separates two things that are usually confused. **What a program
identifies things by is English and never changes.** **What a person reads is
data, and exists in as many languages as the country pack publishes.**

## The rule in one line

Identifiers are English. Labels are data. A label is chosen by the reader's
preference, then the company's, then the pack's.

## What is English, permanently

Table names, column names, enum values, function names and error codes are
English `snake_case`, and they are part of the interface. `accounts`,
`entry_lines`, `account_type`, `post_document()`, `period_locked`: a program
tests those strings, a migration renames nothing, and a translation of them
would be a second vocabulary that one day disagrees with the first.

Error **codes** are stable English. Error **messages** are English too — one
language for the people who read a log and file a bug report:

```
period_locked: 2026-03-15 falls in a period closed on 2026-03-31
```

A client that wants to show that to an end user in Dutch matches on
`period_locked`, which is the part that will not move, and writes its own
sentence. That is why the code comes first and is separated by a colon.

## What is data, and therefore translated

Everything a person reads off the screen because a country said so:

| What | Where the label lives |
|---|---|
| The chart of accounts | `accounts.name` and `accounts.name_i18n` |
| The charts a country offers | `chart_templates.name` / `name_i18n` |
| Journals | `journals.name` / `name_i18n` |
| Taxes | `taxes.name` / `name_i18n` |
| Boxes of a declaration | `tax_report_box_templates.name` / `name_i18n` |
| Lines of a financial statement | `statement_line_templates.name` / `name_i18n` |
| Sentences an invoice must print | `legal_mention_templates.text` / `text_i18n` |
| Fixed-asset categories | `assets.category_templates.name` / `name_i18n` |
| The country's own name | `country_defaults.name` / `name_i18n` |

The shape is always the same. `name` holds the label in one language, and
`name_i18n` is a JSON object keyed by two-letter language code holding the
others:

```json
{ "nl": "Handelsdebiteuren", "de": "Kunden", "en": "Customers" }
```

On a template, `name` is the language the pack itself is written in. On a
company's own row, `name` is the language that company keeps its books in,
because `install_country_template()` copies the chosen label into it — and the
other languages travel along in `name_i18n`, so a German-speaking colleague of
a French-speaking company is answered without going back to the template.

## How one label is chosen

One function, and only one:

```sql
select label_for(name, name_i18n, preferred_languages(:company)) from accounts;
```

`preferred_languages(company)` builds the chain, in this order:

1. **the reader's own preference** — `user_preferences.language`, which the
   person sets for themselves and which applies in every company they work in;
2. **the company's language** — `companies.language`, what these books are
   kept in;
3. **the pack's language** — `country_defaults.language_default`, what the
   country's own files are written in.

Every one of the three may be null, and null means "ask the next one" rather
than a default the software picked. `label_for` walks the list and returns the
first language that has a label, falling back to `name` when none of them does.

That is the whole mechanism, and it is deliberately the only spelling of it.
The expression used to be written out wherever it was needed —
`coalesce(nullif(x.name_i18n ->> lang, ''), x.name)` — and a formula written
twice is a formula that will one day disagree with itself.

## The chain starts where the caller says

There is a second form, and it is the general one:

```sql
select label_for(text, text_i18n, preferred_languages(:language, :company));
```

`preferred_languages(language, company)` takes the first link explicitly and
falls back to the company and then to the pack exactly as above.
`preferred_languages(company)` is one line on top of it, supplying the
signed-in reader's preference as that first link.

The distinction matters the moment a reader has no session. Somebody holding
the link to an invoice has no `user_preferences` row and no membership, so a
chain that begins at `auth.uid()` begins at null for them — and the one
published way of choosing a language was unavailable to the one reader who is
outside the installation. The chain was never about a *user*; it was about
where it starts. A person reading their own books starts at their preference,
and a document being rendered starts at its own language.

## A document knows what it was written in

`documents.language` is a column of the document, and that is the difference
between a language and a preference. It is filled when the document is created,
from the customer's language, then the company's, then the pack's — the same
chain, walked once — and it is frozen the moment the document is posted, the
way `document_lines.vat_category` and `vat_rate` are frozen against a later
rate change.

While a document is a draft it keeps following the chain: it carries no number
and no entry, the customer on it may still change, and so may that customer's
own language. A draft may also be given a language by hand. Once it is posted,
an update that moves it is refused by name:

```
document_language_frozen: FAC-2026-0007 was sent in nl, so it stays in nl.
```

The reason is the legal mentions. A customer who switches to another language
switches what they are sent next, not what they were sent: an invoice reprinted
in a language it was never written in is a different document on the one part
of it a country actually legislates.

`document_legal_mentions` reads that column. Each row carries `language` — the
one the document was written in — and `text` already in it, with `text_i18n`
beside it for a renderer printing a second language. `document_header` carries
`language` too, so the three reads a renderer makes agree by construction
rather than by each of them re-deriving a chain.

## What a pack must provide

A country pack declares the languages it publishes, and that declaration is a
promise rather than a description:

```json
{
  "country": "BE",
  "defaults": { "language": "fr" },
  "languages": ["nl", "de", "en"]
}
```

The pack's own files — `accounts.csv`, `taxes.json`, `tax_report.json`,
`statements.json` and the manifest — are written in `defaults.language`. Every
other language is one file, `i18n/<lang>.json`, and that file is the only place
a translation lives:

```json
{
  "language": "nl",
  "pack_name": "België",
  "charts":           { "default": "MAR — minimum algemeen rekeningenstelsel" },
  "accounts":         { "400000": "Handelsdebiteuren" },
  "journals":         { "SAL": "Verkoopdagboek" },
  "taxes":            { "BE-S-21": "Verkoop 21 %" },
  "tax_report_boxes": { "54": "Btw op de handelingen van de roosters 01, 02 en 03" },
  "statement_lines":  { "BE-BNB-ABBR-BS:10/15": "EIGEN VERMOGEN" },
  "legal_mentions":   { "reverse_charge": "Btw verlegd — belasting te voldoen door de medecontractant." },
  "asset_categories": { "machinery": "Installaties, machines en uitrusting" }
}
```

**A declared language must be complete.** `ekwo pack check` counts every
account of every chart, every journal, every tax, every box, every statement
line, every legal mention and every asset category, and fails naming what is
missing:

```
✗ pack_invalid: packs/be — 2 problem(s)
  i18n/nl.json accounts: 2 of 354 missing: 400000, 440000
  i18n/nl.json journals: 6 of 6 missing: SAL, PUR, BNK, CSH, MISC, OPN
```

The reason for the strictness is what a half-translated pack looks like in
practice: a chart of accounts in Dutch under a VAT return in French, which is
worse than French throughout, because nobody can tell whether the software is
incomplete or the rule is different.

**A language file that is not declared may be partial.** A key it does not
carry falls back to the pack's own label. That is how a language gets
contributed one section at a time: write what you are sure of, leave the rest
absent, and add the code to `languages` on the day it is complete.

A label under a code the pack does not carry is refused, in any file, declared
or not — it is a label nobody would ever see.

## Adding a language to a pack

1. Copy an existing `i18n/<lang>.json` and change the labels. Keep the codes.
2. Run `ekwo pack check <cc>`. It names every key you still owe.
3. When nothing is missing, add the code to `languages` in `pack.json` and
   raise the minor version — a translation that arrives without the version
   moving is a pack nobody can upgrade to.
4. Run `ekwo pack build <cc>` and commit the regenerated seed alongside.

Three rules hold while you write.

**A translation is the same concept, never a different rule.** The code, the
account type, the rate, the box and the formula are identical in every
language; only the wording changes. If a label would only be correct under a
different rule, the pack is wrong in the original too, and that is an issue
rather than a translation.

**Use the official wording where a country publishes one.** Several do: the
Belgian minimum chart of accounts exists in four languages, the Belgian VAT
return boxes in three, the models of the National Bank in four. Cite the source
in `packs/<cc>/i18n/README.md`. Where no administration publishes one — there
is no official English plan comptable général — use the wording the profession
uses, and say so.

**Leave a key absent rather than guess.** An absent key falls back and is
visibly untranslated; a guessed one is wrong and looks right.

## What the language is *not*

`companies.language` is the language of the books. It is not a locale, and it
decides nothing else: how a date or a number is written is
`user_preferences.date_display_format` and `number_display_format`, which
belong to a person and not to a company, and the currency is
`companies.currency_code`. A country that keeps its books in one language and
writes its dates in three is an ordinary country, so the two questions are
asked separately and stored separately.

Translating an **application** — the buttons, the menus, the help — is not the
core's job and never will be. The core hands a client the label a country gave
an account and the language chain to choose it with; everything around it
belongs to whoever built the interface. The managed edition at
[ekwo.ai](https://ekwo.ai) translates its own screens on top of exactly the
data described here, with no private column and no second mechanism.
