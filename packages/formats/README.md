# Format libraries

One npm package per file format, organised **by format and never by country**.
Factur-X is French and German, UBL is universal, camt.053 is European: a format
is not a country. Which formats a country uses is said by its pack, in
`einvoice_profile` and in the bank format lists — never by the shape of this
directory.

Each package here:

- is **MIT**, with its own `LICENSE` file, so it can end up inside a
  competitor, a software house or an administration;
- **imports nothing from the core** — not `@ekwo-ai/core`, not the schema, not
  another brick;
- reads the **flat row shapes** the core's `financial_statement()`,
  `vat_return()`, `ec_sales_list()`, `fec_lines()` and `document_*` views
  return, and declares them in its own types rather than importing them from
  anywhere;
- produces the bytes, the name the administration expects and what does not add
  up — `{ file, filename, violations[] }`, under whatever names the format
  gives them;
- declares no `schema_min`: the contract is the shape of the rows, and the
  end-to-end test in `tests/` is what breaks when it moves.

There is no shared abstraction between them and there will not be one: no
`Filing` interface, no plugin registry, no common `xml` package. Two formats
that look alike are two formats.

`tests/formats.test.ts` enforces the licence, the isolation and the
dependencies of every package in this directory, and `tests/` carries one
end-to-end test per package: a country pack's golden year of books, through the
real engine, into the file — which is the only place a pack and a brick meet,
and the only test that notices when either moves.

Four of them read the same rows, from `ec_sales_list()`, and write four
different files, which is what "by format and never by country" buys. They do
not agree on much: Belgium prints one line per customer **and per nature** with
a letter code, Estonia prints one line per customer with three amount columns,
Luxembourg wants the country and the number in two fields and France wants them
joined, three of the four write decimals and two write whole euros. Two formats
that look alike are two formats.
