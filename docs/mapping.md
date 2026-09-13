# Mapping: Ekwo ↔ Odoo ↔ EN 16931 ↔ FEC

Nobody publishes this table, so here it is. It lets an integrator write a
connector in a day instead of reading two schemas in parallel for a week.

- **Odoo** columns refer to Odoo Community 17 and 18, module `addons/account`.
  Odoo's Postgres table name is the model name with dots replaced by
  underscores, so `account.move` is `account_move`.
- **EN 16931** references are business term identifiers (`BT-`) and business
  groups (`BG-`) of the European semantic standard for electronic invoicing,
  as used by Peppol BIS Billing 3.0 and Factur-X.
- **FEC** refers to the eighteen columns of the French *fichier des écritures
  comptables*, arrêté du 29 juillet 2013 (art. A. 47 A-1 du LPF). The column
  is produced by `fec_lines()`.

An empty cell means there is no counterpart, which is itself information.

## Instance

| Ekwo | Odoo | EN 16931 | FEC |
|---|---|---|---|
| `instance` | *(no counterpart: Odoo is multi-company inside one deployment, not one deployment per customer)* | | |
| `instance.edition` | Community / Enterprise, switched by `web_enterprise` and a subscription key | | |
| `instance_admins.user_id` | the `base.group_system` group | | |
| *(no counterpart)* | `res.company` as a tenant boundary | | |

## Company and period

| Ekwo | Odoo | EN 16931 | FEC |
|---|---|---|---|
| `companies.name` | `res.company.name` | BT-27 seller name | |
| `companies.legal_name` | `res.partner.name` | BT-27 | |
| `companies.vat_number` | `res.company.vat` | BT-31 seller VAT identifier | |
| `companies.registration_number` | `res.company.company_registry` | BT-30 seller legal registration | |
| `companies.country` | `res.company.country_id` | BT-40 seller country | |
| `companies.fiscal_country` | `res.company.account_fiscal_country_id` | | |
| `companies.address_line1`, `.postal_code`, `.city` | on `res.company.partner_id` | BG-5 seller postal address | |
| `companies.currency_code` | `res.company.currency_id` | BT-5 invoice currency | `Idevise` (when it differs) |
| `companies.lock_date` | `res.company.fiscalyear_lock_date` | | |
| `companies.tax_lock_date` | `res.company.tax_lock_date` | | |
| `companies.receivable_account_id` | `res.partner.property_account_receivable_id` | | |
| `companies.payable_account_id` | `res.partner.property_account_payable_id` | | |
| `fiscal_years.start_date`, `.end_date` | no model; `fiscalyear_last_day` / `_month` on the company | | |
| `fiscal_years.is_closed` | via `fiscalyear_lock_date` | | |
| `company_members.role` | `res.users` groups | | |

## Chart of accounts

| Ekwo | Odoo | EN 16931 | FEC |
|---|---|---|---|
| `accounts.code` | `account.account.code` | | `CompteNum` |
| `accounts.name` | `account.account.name` | | `CompteLib` |
| `accounts.account_type` | `account.account.account_type` | | |
| `accounts.internal_group` | `account.account.internal_group` | | |
| `accounts.reconcilable` | `account.account.reconcile` | | |
| `accounts.currency_code` | `account.account.currency_id` | | |
| `accounts.parent_id` | `account.group` (a separate model) | | |
| `accounts.deprecated` | `account.account.deprecated` | | |
| `accounts.carries_forward` | `account.account.include_initial_balance` | | |

## Journals

| Ekwo | Odoo | EN 16931 | FEC |
|---|---|---|---|
| `journals.code` | `account.journal.code` | | `JournalCode` |
| `journals.name` | `account.journal.name` | | `JournalLib` |
| `journals.journal_type` | `account.journal.type` | | |
| `journals.default_account_id` | `account.journal.default_account_id` | | |
| `journals.suspense_account_id` | `account.journal.suspense_account_id` | | |
| `journals.bank_account_id` | `account.journal.bank_account_id` | | |
| `journal_sequences.last_number` | `account.move.sequence_number`, derived by regex | | |

## Contacts

| Ekwo | Odoo | EN 16931 | FEC |
|---|---|---|---|
| `contacts.name` | `res.partner.name` | BT-44 buyer name / BT-27 seller name | `CompAuxLib` |
| `contacts.contact_type` | `customer_rank` / `supplier_rank` counters | | |
| `contacts.parent_id` | `res.partner.parent_id` | | |
| `commercial_entity(contact)` | `res.partner.commercial_partner_id` | | |
| `contacts.vat_number` | `res.partner.vat` | BT-48 buyer VAT identifier | |
| `contacts.registration_number` | `res.partner.company_registry` | BT-47 buyer legal registration | |
| `contacts.auxiliary_code` | *(no counterpart)* | | `CompAuxNum` |
| `contacts.email` | `res.partner.email` | BT-43 buyer contact email | |
| `contacts.address_line1`, `.postal_code`, `.city`, `.country` | `res.partner` address fields | BG-8 buyer postal address | |
| `contacts.payment_terms_days` | `account.payment.term` and its lines | BT-20 payment terms | |
| `contacts.receivable_account_id` | `property_account_receivable_id` | | |
| `contacts.payable_account_id` | `property_account_payable_id` | | |
| `contacts.iban` | `res.partner.bank_ids` | BT-84 payment account identifier | |
| `contacts.peppol_scheme`, `.peppol_identifier` | `res.partner.peppol_eas`, `.peppol_endpoint` | BT-49 buyer electronic address | |
| `contacts.currency_code` | `res.partner.property_purchase_currency_id` | | |

## Taxes

| Ekwo | Odoo | EN 16931 | FEC |
|---|---|---|---|
| `taxes.code` | `account.tax.name` | | |
| `taxes.amount` | `account.tax.amount` | BT-119 category rate | |
| `taxes.amount_type` | `account.tax.amount_type` | | |
| `taxes.applies_to` | `account.tax.type_tax_use` | | |
| `taxes.treatment` | `account.fiscal.position` | | |
| `taxes.vat_category` | `account.tax.tax_group_id` and country data | BT-118 category code | |
| `taxes.exemption_code` | *(localisation data)* | BT-121 exemption reason code | |
| `taxes.valid_from`, `.valid_to` | *(no counterpart: a rate change is a new tax)* | | |
| `taxes.legal_reference` | *(no counterpart)* | BT-120 exemption reason text | |
| `taxes.price_include` | `account.tax.price_include` | | |
| `tax_postings` | `account.tax.repartition.line` | | |
| `tax_postings.factor_percent` | `.factor_percent` | | |
| `tax_postings.posting_type` | `.repartition_type` | | |
| `tax_postings.account_id` | `.account_id` | | |
| `tax_postings.declaration_box` | `.tag_ids` → `account.account.tag` | | |
| `tax_postings.box_factor_percent` | *(carried by the sign of the tag)* | | |
| `tax_postings.document_kind` | `.document_type` | | |

## Entries and ledger lines

| Ekwo | Odoo | EN 16931 | FEC |
|---|---|---|---|
| `entries` | `account.move` with `move_type = 'entry'` | | |
| `entries.number` | `account.move.name` | | `EcritureNum` |
| `entries.entry_date` | `account.move.date` | | `EcritureDate` |
| `entries.reference` | `account.move.ref` | | `PieceRef` |
| `entries.description` | `account.move.narration` | | `EcritureLib` (fallback) |
| `entries.state` | `account.move.state` | | |
| `entries.posted_at` | *(no counterpart)* | | `ValidDate` |
| `entries.journal_id` | `account.move.journal_id` | | `JournalCode`, `JournalLib` |
| `entries.fiscal_year_id` | *(no model)* | | |
| `entries.document_id` | *(implicit: the invoice is the entry)* | | |
| `entries.reversed_entry_id` | `account.move.reversed_entry_id` | | |
| `entries.total_debit`, `.total_credit` | *(computed, not stored)* | | |
| `entry_lines` | `account.move.line` | | |
| `entry_lines.account_id` | `.account_id` | | `CompteNum`, `CompteLib` |
| `entry_lines.debit`, `.credit` | `.debit`, `.credit` | | `Debit`, `Credit` |
| `entry_lines.balance` | `.balance` | | |
| `entry_lines.name` | `.name` | | `EcritureLib` |
| `entry_lines.contact_id` | `.partner_id` | | `CompAuxNum`, `CompAuxLib` |
| `entry_lines.date_maturity` | `.date_maturity` | BT-9 due date | |
| `entry_lines.tax_id` | `.tax_ids` and `.tax_line_id` | | |
| `entry_lines.tax_line` | `.tax_line_id is not null` | | |
| `entry_lines.declaration_box` | `.tax_tag_ids` | | |
| `entry_lines.box_amount` | *(derived at report time)* | | |
| `entry_lines.matching_number` | `.matching_number` | | `EcritureLet` |
| `entry_lines.matched_amount` | derived from `amount_residual` | | |
| `entry_lines.amount_currency`, `.currency_code` | `.amount_currency`, `.currency_id` | | `Montantdevise`, `Idevise` |
| *(no counterpart)* | `.display_type` (nine values) | | |

## Documents

| Ekwo | Odoo | EN 16931 | FEC |
|---|---|---|---|
| `documents` | `account.move` with a commercial `move_type` | BG-2 process control | |
| `documents.doc_type` | `account.move.move_type` | BT-3 invoice type code | |
| `documents.state` | `account.move.state` | | |
| `documents.payment_state` | `account.move.payment_state` | | |
| `documents.sent_at` | `account.move.is_move_sent` | | |
| `documents.number` | `account.move.name` | BT-1 invoice number | `PieceRef` |
| `documents.supplier_reference` | `account.move.ref` | BT-1 on the supplier's side | |
| `documents.contact_id` | `account.move.partner_id` | BG-7 buyer | |
| `documents.document_date` | `account.move.invoice_date` | BT-2 issue date | `PieceDate` |
| `documents.accounting_date` | `account.move.date` | | `EcritureDate` |
| `documents.due_date` | `account.move.invoice_date_due` | BT-9 due date | |
| `documents.currency_code` | `account.move.currency_id` | BT-5 | `Idevise` |
| `documents.exchange_rate` | `account.move.invoice_currency_rate` | | |
| `documents.buyer_reference` | `account.move.ref` on sales | BT-10 buyer reference | |
| `documents.project_reference` | `account.move.analytic_distribution` | BT-11 project reference | |
| `documents.contract_reference` | *(no standard field)* | BT-12 contract reference | |
| `documents.order_reference` | `account.move.invoice_origin` | BT-13 purchase order reference | |
| `documents.delivery_date` | `account.move.delivery_date` | BT-72 actual delivery date | |
| `documents.delivery_address_line1`, `.delivery_postal_code`, `.delivery_city`, `.delivery_country` | `account.move.partner_shipping_id` | BG-15 deliver-to address | |
| `documents.payment_terms` | `account.move.invoice_payment_term_id` | BT-20 payment terms | |
| `documents.payment_means_code` | `account.move.payment_method_line_id` | BT-81 payment means type code | |
| `documents.payment_reference` | `account.move.payment_reference` | BT-83 remittance information | |
| `documents.payee_iban` | `account.move.partner_bank_id` | BT-84 payment account identifier | |
| `documents.note` | `account.move.narration` | BT-22 invoice note | |
| `documents.amount_untaxed` | `.amount_untaxed` | BT-109 total without VAT | |
| `documents.amount_tax` | `.amount_tax` | BT-110 total VAT | |
| `documents.amount_total` | `.amount_total` | BT-112 total with VAT | |
| `documents.amount_paid` | `.amount_total - .amount_residual` | BT-113 paid amount | |
| `documents.amount_residual` | `.amount_residual` | BT-115 amount due for payment | |
| `documents.reversed_document_id` | `account.move.reversed_entry_id` | BT-25 preceding invoice reference | |
| `documents.entry_id` | *(implicit)* | | |
| `documents.peppol_status`, `.peppol_message_id` | `account.move.peppol_move_state` | | |

## Products

`product.template` is the catalogue row in Odoo and `product.product` the
variant of it; Ekwo has one table, because variants are a commerce feature and
a variant with no distinct price, account or tax is a row that carries
nothing. Nothing here is stock: there is no `qty_available`, no valuation and
no move, and there is deliberately no counterpart to them.

| Ekwo | Odoo | EN 16931 | FEC |
|---|---|---|---|
| `products` | `product.template` / `product.product` | BG-31 item information | |
| `products.code` | `product.template.default_code` | BT-155 item seller identifier | |
| `products.name` | `product.template.name` | BT-153 item name | |
| `products.description` | `product.template.description_sale` | BT-154 item description | |
| `products.kind` | `product.template.type` (`service` / `consu`) | | |
| `products.unit_code` | `product.template.uom_id` | BT-130 unit of measure code | |
| `products.sale_price` | `product.template.list_price` | BT-146 item net price | |
| `products.purchase_price` | `product.template.standard_price` | | |
| `products.sale_account_id` | `property_account_income_id` | | `CompteNum` |
| `products.purchase_account_id` | `property_account_expense_id` | | `CompteNum` |
| `products.sale_tax_id` | `product.template.taxes_id` | | |
| `products.purchase_tax_id` | `product.template.supplier_taxes_id` | | |
| `products.active` | `product.template.active` | | |
| *(no counterpart)* | `product.product` variants, `qty_available`, `stock.move` | | |

## Document lines

| Ekwo | Odoo | EN 16931 | FEC |
|---|---|---|---|
| `document_lines` | `account.move.line` filtered on `display_type = 'product'` | BG-25 invoice line | |
| `document_lines.sequence` | `.sequence` | BT-126 line identifier | |
| `document_lines.line_type` | `.display_type` | | |
| `document_lines.product_id` | `.product_id` | | |
| `document_lines.name` | `.name` | BT-153 item name | |
| `document_lines.description` | `.name`, second line | BT-154 item description | |
| `document_lines.quantity` | `.quantity` | BT-129 invoiced quantity | |
| `document_lines.unit_code` | `.product_uom_id` | BT-130 unit of measure code | |
| `document_lines.unit_price` | `.price_unit` | BT-146 item net price | |
| `document_lines.discount_percent` | `.discount` | BT-138 document level allowance percentage | |
| `document_lines.amount_untaxed` | `.price_subtotal` | BT-131 line net amount | |
| `document_lines.tax_id` | `.tax_ids` | | |
| `document_lines.account_id` | `.account_id` | | `CompteNum` |
| `document_lines.vat_category` | derived from the tax | BT-151 line VAT category code | |
| `document_lines.vat_rate` | derived from the tax | BT-152 line VAT rate | |
| `document_tax_summary` (view) | `account.move.tax_totals` | BG-23 VAT breakdown | |
| `document_tax_summary.base_amount` | | BT-116 category taxable amount | |
| `document_tax_summary.tax_amount` | | BT-117 category tax amount | |
| `document_line_items` (view) | `account.move.invoice_line_ids` | BG-25 with BG-31 | |
| `document_line_items.seller_item_identifier` | `product.default_code` | BT-155 item seller identifier | |

### To the Factur-X invoice object

[`@ekwo-ai/factur-x`](../packages/formats/factur-x/) takes a plain
invoice object and emits EN 16931 CII XML. It lives in this repository under
`packages/formats/`, but `@ekwo-ai/core` does not depend on it: a format is
something you add on top of the ledger, not something the ledger needs. The
mapping is therefore written here and asserted in `tests/mcp/products.test.ts`
without the library.

Read `document_line_items` and build one line per row:

| Factur-X line field | Ekwo | EN 16931 |
|---|---|---|
| `name` | `item_name` | BT-153 |
| `description` | `item_description` | BT-154 |
| `sellerItemId` | `seller_item_identifier` — the product code, null on a free-text line | BT-155 |
| `quantity` | `quantity` | BT-129 |
| `unitCode` | `unit_code` | BT-130 |
| `unitPrice` | `unit_price` | BT-146 |
| `vatRate` | `vat_rate` | BT-152 |
| `vatCategory` | `vat_category` | BT-151 |

The header comes from `documents` and `companies` as the Documents table
above says: `number` → `number` (BT-1), `document_date` → `issueDate` (BT-2),
`due_date` → `dueDate` (BT-9), `buyer_reference` → `buyerReference` (BT-10),
`order_reference` → `orderReference` (BT-13), `payee_iban` → `payment.iban`
(BT-84).

## Payments, matching, bank

| Ekwo | Odoo | EN 16931 | FEC |
|---|---|---|---|
| `payments` | `account.payment` | | |
| `payments.direction` | `.payment_type` | | |
| `payments.amount` | `.amount` | | |
| `payments.journal_id` | `.journal_id` | | |
| `payments.entry_id` | `.move_id` | | |
| `reconciliations` | `account.partial.reconcile` | | |
| `reconciliations.debit_line_id`, `.credit_line_id` | `.debit_move_id`, `.credit_move_id` | | |
| `reconciliations.amount` | `.amount` | | |
| `reconciliations.matched_at` | `.max_date` | | `DateLet` |
| `reconciliations.matching_number` | `account.full.reconcile.name` | | `EcritureLet` |
| `bank_accounts` | `res.partner.bank` | | |
| `bank_accounts.iban` | `.acc_number` | | |
| `bank_statements` | `account.bank.statement` | | |
| `bank_statements.balance_start` | `.balance_start` | | |
| `bank_statements.balance_end_declared` | `.balance_end_real` | | |
| `bank_statements.is_consistent` | `.is_valid` | | |
| `bank_transactions` | `account.bank.statement.line` | | |
| `bank_transactions.transaction_date` | `.date` | | |
| `bank_transactions.amount` | `.amount` | | |
| `bank_transactions.description` | `.payment_ref` | | |
| `bank_transactions.counterpart_name` | `.partner_name` | | |
| `bank_transactions.counterpart_iban` | `.account_number` | | |
| `bank_transactions.structured_reference` | `.payment_ref` (parsed) | | |

## Analytics and attachments

| Ekwo | Odoo | EN 16931 | FEC |
|---|---|---|---|
| `analytic_axes` | `account.analytic.plan` | | |
| `analytic_values` | `account.analytic.account` | | |
| `entry_line_analytics` | `account.move.line.analytic_distribution` (JSON) | | |
| `attachments` | `ir.attachment` | BG-24 additional supporting documents | |

## Deliberately absent

| Odoo | Why not |
|---|---|
| `account.move.display_type` | A consequence of merging documents and entries, which Ekwo does not do. |
| `product.product`, `product.template` | A catalogue is an application concern, not an accounting one. |
| `account.analytic.plan` root columns created at runtime | A schema that alters itself cannot be migrated or secured. |
| `ir.property` / `company_dependent` JSON columns | A plain column per company default is simpler and joinable. |
| `/xmlrpc/2/object`, `/jsonrpc` | Supabase exposes the schema as REST with an OpenAPI description; the Odoo protocols are dated for removal by their own publisher. |

## Producing a FEC

`fec_lines(company_id, from, to)` returns the eighteen columns: the opening
balances of the financial year first, then its movements in chronological
order. `generateFec()` in `@ekwo-ai/fec` turns them into the file, and
`checkFec()` applies the file-level rules — mandatory fields, one side per
line, each entry balancing — before you hand it over.

The opening lines are computed from the ledger and never posted, one per
balance-sheet account, plus one for the result of a year that has not been
closed yet. They appear only when the period is exactly a financial year. The
sources below are those of a movement line; an opening line takes its journal
from `country_defaults.opening_journal_code`, its account and amount from the
cumulative balance of the day before the year opens, and its label from
`country_defaults.opening_entry_label`.

| FEC column | Source |
|---|---|
| `JournalCode`, `JournalLib` | `journals.code`, `journals.name` |
| `EcritureNum` | `entries.number` |
| `EcritureDate` | `entries.entry_date` |
| `CompteNum`, `CompteLib` | `accounts.code`, `accounts.name` |
| `CompAuxNum`, `CompAuxLib` | `contacts.auxiliary_code`, `contacts.name` |
| `PieceRef` | `documents.number`, else `documents.supplier_reference`, else `entries.reference` |
| `PieceDate` | `documents.document_date`, else `entries.entry_date` |
| `EcritureLib` | `entry_lines.name`, else `entries.description`, else `accounts.name` |
| `Debit`, `Credit` | `entry_lines.debit`, `entry_lines.credit` |
| `EcritureLet` | `entry_lines.matching_number` |
| `DateLet` | latest `reconciliations.matched_at` on that line |
| `ValidDate` | `entries.posted_at` |
| `Montantdevise`, `Idevise` | `entry_lines.amount_currency`, `entry_lines.currency_code`, when the currency differs from the company's |
