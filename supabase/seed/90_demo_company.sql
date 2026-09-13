-- Ekwo OS — demo data.
--
-- A fictional Belgian consultancy, its customers and suppliers, a quarter of
-- invoices, a payment, a matching and a bank statement. Everything here is
-- invented: no real company, person, VAT number or bank account.
--
-- It also stands in for the installer: it records the instance and claims the
-- first instance administrator, which is what `init_instance()` and
-- `claim_instance_admin()` do on a real install.
--
-- Drop this file from `supabase/seed/` before installing on a real project.

do $$
declare
  v_owner      uuid := '00000000-0000-0000-0000-000000000001';
  v_company    uuid;
  v_bank       uuid;
  v_bank_jrnl  uuid;
  v_stmt       uuid;
  v_entry      entries%rowtype;
  -- contacts
  c_dumont     uuid;
  c_verhoeven  uuid;
  c_northwind  uuid;
  s_lelievre   uuid;
  s_hollandia  uuid;
  s_immo       uuid;
  -- products
  p_conseil    uuid;
  p_atelier    uuid;
  p_support    uuid;
  p_brochure   uuid;
  -- documents
  d            uuid;
  v_doc_ids    uuid[] := '{}';
  v_line_debit uuid;
  v_line_credit uuid;
begin
  if exists (select 1 from companies where vat_number = 'BE0123456749') then
    return;
  end if;

  -- A real installation calls init_instance() from the installer; the demo
  -- stands in for it so the seeded database looks like an installed one.
  if not exists (select 1 from instance) then
    perform init_instance('Exemple Conseil', 'BE', 'community');
  end if;

  -- The demo administrator is a fictional account. On a real installation the
  -- user already exists in Supabase Auth and simply calls
  -- claim_instance_admin(); this insert only exists so the demo stands alone.
  insert into auth.users (id, email)
  values (v_owner, 'admin@exemple-conseil.example')
  on conflict (id) do nothing;

  perform claim_instance_admin(v_owner);

  -- The currency and the language come from the pack of the country this
  -- company is in, which is where they come from for a real one too. Since
  -- 20260913102758 the columns carry no default, so naming them is the only
  -- way, and reading them off `country_defaults` keeps the demo honest about
  -- where the answer lives.
  insert into companies (name, legal_name, legal_form, country, fiscal_country,
                         vat_number, registration_number, address_line1,
                         postal_code, city, email, website, currency_code, language)
  select 'Exemple Conseil', 'Exemple Conseil SRL', 'SRL', 'BE', 'BE',
         'BE0123456749', '0123.456.749', 'Rue de l''Exemple 1',
         '1000', 'Bruxelles', 'compta@exemple-conseil.example',
         'https://exemple-conseil.example', d.currency_code, d.language_default
    from country_defaults d where d.country = 'BE'
  returning id into v_company;

  insert into company_members (company_id, user_id, role) values (v_company, v_owner, 'owner');

  -- From here the sample books are kept by the fictional owner, and not by
  -- whoever happens to be running the installer. `ekwo demo` acts as the real
  -- administrator so that `claim_instance_admin()` is satisfied rather than
  -- circumvented — and that administrator is not a member of this fictional
  -- company, so posting as them is exactly what the capability guards refuse.
  -- Transaction-local, so the claim the caller set comes back when this block
  -- commits.
  perform set_config('request.jwt.claims',
                     json_build_object('sub', v_owner, 'role', 'authenticated')::text,
                     true);

  perform install_country_template(v_company, 'BE');

  insert into fiscal_years (company_id, name, start_date, end_date, is_closed) values
    (v_company, 'Exercice 2025', date '2025-01-01', date '2025-12-31', true),
    (v_company, 'Exercice 2026', date '2026-01-01', date '2026-12-31', false);

  -- Nothing may be booked in 2025 any more.
  update companies set lock_date = date '2025-12-31' where id = v_company;

  -- ---------------------------------------------------------------- contacts
  insert into contacts (company_id, name, contact_type, vat_number, auxiliary_code,
                        email, address_line1, postal_code, city, country,
                        payment_terms_days, peppol_scheme, peppol_identifier)
  values (v_company, 'Atelier Dumont SRL', 'customer', 'BE0400000086', 'C0001',
          'facturation@atelier-dumont.example', 'Chaussee de Wavre 210', '1050', 'Ixelles', 'BE',
          30, '0208', '0400000086')
  returning id into c_dumont;

  insert into contacts (company_id, name, contact_type, vat_number, auxiliary_code,
                        email, address_line1, postal_code, city, country, payment_terms_days)
  values (v_company, 'Studio Verhoeven BV', 'customer', 'NL001234567B01', 'C0002',
          'admin@studio-verhoeven.example', 'Keizersgracht 12', '1015 CJ', 'Amsterdam', 'NL', 30)
  returning id into c_verhoeven;

  insert into contacts (company_id, name, contact_type, vat_number, auxiliary_code,
                        email, address_line1, postal_code, city, country, payment_terms_days)
  values (v_company, 'Northwind Systems Inc', 'customer', null, 'C0003',
          'ap@northwind-systems.example', '500 Market Street', 'WA 98101', 'Seattle', 'US', 45)
  returning id into c_northwind;

  insert into contacts (company_id, name, contact_type, vat_number, auxiliary_code,
                        email, address_line1, postal_code, city, country, payment_terms_days)
  values (v_company, 'Bureau Lelievre SA', 'supplier', 'BE0400000185', 'F0001',
          'compta@bureau-lelievre.example', 'Rue Haute 45', '1000', 'Bruxelles', 'BE', 30)
  returning id into s_lelievre;

  insert into contacts (company_id, name, contact_type, vat_number, auxiliary_code,
                        email, address_line1, postal_code, city, country, payment_terms_days)
  values (v_company, 'Hollandia Software BV', 'supplier', 'NL009876543B01', 'F0002',
          'billing@hollandia-software.example', 'Stationsplein 8', '3511 ED', 'Utrecht', 'NL', 15)
  returning id into s_hollandia;

  insert into contacts (company_id, name, contact_type, vat_number, auxiliary_code,
                        email, address_line1, postal_code, city, country, payment_terms_days)
  values (v_company, 'Immo Central SA', 'supplier', 'BE0400000284', 'F0003',
          'loyers@immo-central.example', 'Avenue Louise 100', '1050', 'Ixelles', 'BE', 10)
  returning id into s_immo;

  -- --------------------------------------------------------------- products
  -- Four catalogue rows, so the demo shows what a product does: it fills a
  -- line in — name, unit, price, account, tax — and constrains nothing.
  -- `on conflict do nothing` keeps the file re-appliable, like the rest.
  insert into products (company_id, code, name, description, kind, unit_code,
                        sale_price, sale_account_id, sale_tax_id) values
    (v_company, 'CONS-JOUR', 'Journee de conseil',
     'Accompagnement sur site ou a distance, par journee de sept heures.',
     'service', 'DAY', 500,
     account_id_by_code(v_company, '704000'),
     (select id from taxes where company_id = v_company and code = 'BE-S-21')),
    (v_company, 'CONS-ATELIER', 'Atelier de cadrage',
     'Demi-journee de cadrage, jusqu''a huit participants.',
     'service', 'C62', 1200,
     account_id_by_code(v_company, '704000'),
     (select id from taxes where company_id = v_company and code = 'BE-S-21')),
    (v_company, 'SUPPORT-M', 'Support mensuel',
     'Assistance par courriel, un mois, temps de reponse un jour ouvrable.',
     'service', 'MON', 800,
     account_id_by_code(v_company, '704000'),
     (select id from taxes where company_id = v_company and code = 'BE-S-21')),
    (v_company, 'BROCHURE', 'Brochure imprimee',
     'Brochure seize pages, quadrichromie, taux reduit.',
     'goods', 'C62', 1,
     account_id_by_code(v_company, '700100'),
     (select id from taxes where company_id = v_company and code = 'BE-S-06'))
  on conflict (company_id, code) do nothing;

  select id into p_conseil  from products where company_id = v_company and code = 'CONS-JOUR';
  select id into p_atelier  from products where company_id = v_company and code = 'CONS-ATELIER';
  select id into p_support  from products where company_id = v_company and code = 'SUPPORT-M';
  select id into p_brochure from products where company_id = v_company and code = 'BROCHURE';

  -- ------------------------------------------------------------------- bank
  select id into v_bank_jrnl from journals where company_id = v_company and code = 'BNK';

  insert into bank_accounts (company_id, name, iban, bic, bank_name, currency_code,
                             account_id, journal_id)
  values (v_company, 'Compte courant', 'BE71096123456769', 'GKCCBEBB', 'Banque Exemple',
          'EUR', account_id_by_code(v_company, '550000'), v_bank_jrnl)
  returning id into v_bank;

  update journals set bank_account_id = v_bank, default_account_id = account_id_by_code(v_company, '550000')
   where id = v_bank_jrnl;

  -- -------------------------------------------------------------- documents
  -- 1. Two-line consultancy invoice, 21 %.
  insert into documents (company_id, doc_type, number, contact_id, document_date, due_date,
                         buyer_reference, payment_reference, note)
  values (v_company, 'sale_invoice', 'FAC-2026-0001', c_dumont, date '2026-07-03', date '2026-08-02',
          'PO-DUM-118', '+++010/1234/56789+++', 'Mission d''accompagnement, juin 2026')
  returning id into d;
  v_doc_ids := v_doc_ids || d;
  insert into document_lines (document_id, company_id, sequence, product_id, name, description,
                              quantity, unit_code, unit_price, tax_id, account_id,
                              vat_category, vat_rate) values
    (d, v_company, 10, p_conseil, 'Journees de conseil',
     'Accompagnement sur site ou a distance, par journee de sept heures.', 5, 'DAY', 500,
     (select id from taxes where company_id = v_company and code = 'BE-S-21'),
     account_id_by_code(v_company, '704000'), 'S', 21),
    (d, v_company, 20, p_atelier, 'Atelier de cadrage', null, 1, 'C62', 1200,
     (select id from taxes where company_id = v_company and code = 'BE-S-21'),
     account_id_by_code(v_company, '704000'), 'S', 21);

  -- 2. Single-line invoice, 21 %.
  insert into documents (company_id, doc_type, number, contact_id, document_date, due_date)
  values (v_company, 'sale_invoice', 'FAC-2026-0002', c_dumont, date '2026-07-24', date '2026-08-23')
  returning id into d;
  v_doc_ids := v_doc_ids || d;
  insert into document_lines (document_id, company_id, sequence, product_id, name, quantity,
                              unit_code, unit_price, tax_id, account_id, vat_category, vat_rate)
  values (d, v_company, 10, p_support, 'Support mensuel', 1, 'MON', 800,
          (select id from taxes where company_id = v_company and code = 'BE-S-21'),
          account_id_by_code(v_company, '704000'), 'S', 21);

  -- 3. Reduced rate, 6 %.
  insert into documents (company_id, doc_type, number, contact_id, document_date, due_date)
  values (v_company, 'sale_invoice', 'FAC-2026-0003', c_dumont, date '2026-08-05', date '2026-09-04')
  returning id into d;
  v_doc_ids := v_doc_ids || d;
  insert into document_lines (document_id, company_id, sequence, product_id, name, quantity,
                              unit_price, tax_id, account_id, vat_category, vat_rate)
  values (d, v_company, 10, p_brochure, 'Brochure imprimee', 400, 1,
          (select id from taxes where company_id = v_company and code = 'BE-S-06'),
          account_id_by_code(v_company, '700100'), 'S', 6);

  -- 4. Intra-community service, reverse charged by the customer.
  insert into documents (company_id, doc_type, number, contact_id, document_date, due_date, note)
  values (v_company, 'sale_invoice', 'FAC-2026-0004', c_verhoeven, date '2026-08-12', date '2026-09-11',
          'Autoliquidation, article 21 par. 2 du Code de la TVA')
  returning id into d;
  v_doc_ids := v_doc_ids || d;
  insert into document_lines (document_id, company_id, sequence, name, quantity, unit_code,
                              unit_price, tax_id, account_id, vat_category, vat_rate)
  values (d, v_company, 10, 'Audit technique', 8, 'DAY', 400,
          (select id from taxes where company_id = v_company and code = 'BE-S-ICS'),
          account_id_by_code(v_company, '700200'), 'AE', 0);

  -- 5. Export outside the EU.
  insert into documents (company_id, doc_type, number, contact_id, document_date, due_date,
                         currency_code, order_reference)
  values (v_company, 'sale_invoice', 'FAC-2026-0005', c_northwind, date '2026-08-28', date '2026-10-12',
          'EUR', 'NW-2026-441')
  returning id into d;
  v_doc_ids := v_doc_ids || d;
  insert into document_lines (document_id, company_id, sequence, name, quantity, unit_price,
                              tax_id, account_id, vat_category, vat_rate)
  values (d, v_company, 10, 'Licence annuelle', 1, 5400,
          (select id from taxes where company_id = v_company and code = 'BE-S-EXP'),
          account_id_by_code(v_company, '700300'), 'G', 0);

  -- 6. Credit note on invoice 2.
  insert into documents (company_id, doc_type, number, contact_id, document_date, due_date,
                         reversed_document_id, note)
  values (v_company, 'sale_credit_note', 'NCC-2026-0001', c_dumont, date '2026-08-30', date '2026-08-30',
          v_doc_ids[2], 'Geste commercial sur FAC-2026-0002')
  returning id into d;
  v_doc_ids := v_doc_ids || d;
  insert into document_lines (document_id, company_id, sequence, name, quantity, unit_price,
                              tax_id, account_id, vat_category, vat_rate)
  values (d, v_company, 10, 'Remise sur support mensuel', 1, 300,
          (select id from taxes where company_id = v_company and code = 'BE-S-21'),
          account_id_by_code(v_company, '704000'), 'S', 21);

  -- 7. Domestic purchase of services, 21 %.
  insert into documents (company_id, doc_type, number, supplier_reference, contact_id,
                         document_date, due_date)
  values (v_company, 'purchase_invoice', 'ACH-2026-0001', 'BL-2026-3312', s_lelievre,
          date '2026-07-09', date '2026-08-08')
  returning id into d;
  v_doc_ids := v_doc_ids || d;
  insert into document_lines (document_id, company_id, sequence, name, quantity, unit_price,
                              tax_id, account_id, vat_category, vat_rate)
  values (d, v_company, 10, 'Honoraires comptables T2', 1, 1450,
          (select id from taxes where company_id = v_company and code = 'BE-P-21-S'),
          account_id_by_code(v_company, '613000'), 'S', 21);

  -- 8. Intra-community service received: self-assessed.
  insert into documents (company_id, doc_type, number, supplier_reference, contact_id,
                         document_date, due_date, note)
  values (v_company, 'purchase_invoice', 'ACH-2026-0002', 'HS-99120', s_hollandia,
          date '2026-07-31', date '2026-08-15', 'Report de perception, grilles 88 / 55 / 59')
  returning id into d;
  v_doc_ids := v_doc_ids || d;
  insert into document_lines (document_id, company_id, sequence, name, quantity, unit_price,
                              tax_id, account_id, vat_category, vat_rate)
  values (d, v_company, 10, 'Abonnement plateforme, un an', 1, 990,
          (select id from taxes where company_id = v_company and code = 'BE-P-ICS-21'),
          account_id_by_code(v_company, '612400'), 'AE', 0);

  -- 9. Rent, 21 %.
  insert into documents (company_id, doc_type, number, supplier_reference, contact_id,
                         document_date, due_date)
  values (v_company, 'purchase_invoice', 'ACH-2026-0003', 'IC-2026-0807', s_immo,
          date '2026-08-01', date '2026-08-11')
  returning id into d;
  v_doc_ids := v_doc_ids || d;
  insert into document_lines (document_id, company_id, sequence, name, quantity, unit_price,
                              tax_id, account_id, vat_category, vat_rate)
  values (d, v_company, 10, 'Loyer du bureau, aout', 1, 1200,
          (select id from taxes where company_id = v_company and code = 'BE-P-21-S'),
          account_id_by_code(v_company, '610000'), 'S', 21);

  -- 10. Capital goods, 21 %: box 83, not 82.
  insert into documents (company_id, doc_type, number, supplier_reference, contact_id,
                         document_date, due_date)
  values (v_company, 'purchase_invoice', 'ACH-2026-0004', 'BL-2026-3401', s_lelievre,
          date '2026-08-20', date '2026-09-19')
  returning id into d;
  v_doc_ids := v_doc_ids || d;
  insert into document_lines (document_id, company_id, sequence, name, quantity, unit_price,
                              tax_id, account_id, vat_category, vat_rate)
  values (d, v_company, 10, 'Poste de travail', 2, 1200,
          (select id from taxes where company_id = v_company and code = 'BE-P-21-I'),
          account_id_by_code(v_company, '241000'), 'S', 21);

  -- Book them all.
  for i in 1 .. array_length(v_doc_ids, 1) loop
    perform post_document(v_doc_ids[i]);
  end loop;

  -- ------------------------------------------------------------- settlement
  -- Invoice 1 (4 477,00) paid in full on 5 August.
  insert into entries (company_id, journal_id, entry_date, reference, description, state)
  values (v_company, v_bank_jrnl, date '2026-08-05', 'FAC-2026-0001',
          'Reglement FAC-2026-0001', 'draft')
  returning * into v_entry;

  insert into entry_lines (entry_id, company_id, account_id, sequence, name, debit, credit)
  values (v_entry.id, v_company, account_id_by_code(v_company, '550000'), 10,
          'Reglement Atelier Dumont', 4477.00, 0);

  insert into entry_lines (entry_id, company_id, account_id, sequence, name, debit, credit,
                           contact_id, date_maturity)
  values (v_entry.id, v_company, account_id_by_code(v_company, '400000'), 20,
          'FAC-2026-0001', 0, 4477.00, c_dumont, date '2026-08-02')
  returning id into v_line_credit;

  perform post_entry(v_entry.id);

  insert into payments (company_id, direction, payment_date, amount, contact_id,
                        journal_id, bank_account_id, entry_id, reference, state)
  values (v_company, 'inbound', date '2026-08-05', 4477.00, c_dumont, v_bank_jrnl,
          v_bank, v_entry.id, 'FAC-2026-0001', 'posted');

  select l.id into v_line_debit
    from entry_lines l
    join entries e on e.id = l.entry_id
   where e.document_id = v_doc_ids[1] and l.debit > 0
     and l.account_id = account_id_by_code(v_company, '400000');

  -- No amount_paid to write: matching the customer line moves the document.
  perform reconcile(v_line_debit, v_line_credit, null);

  -- ------------------------------------------------------- bank statement
  insert into bank_statements (company_id, bank_account_id, name, statement_date,
                               balance_start, balance_end_declared, state, source)
  values (v_company, v_bank, 'Extrait 2026/08', date '2026-08-31',
          12500.00, 14813.00, 'confirmed', 'demo')
  returning id into v_stmt;

  insert into bank_transactions (company_id, statement_id, bank_account_id, sequence,
                                 transaction_date, value_date, amount, description,
                                 counterpart_name, counterpart_iban, structured_reference,
                                 contact_id, entry_id, state) values
    (v_company, v_stmt, v_bank, 10, date '2026-08-05', date '2026-08-05', 4477.00,
     'Virement en votre faveur', 'Atelier Dumont SRL', 'BE68539007547034',
     '+++010/1234/56789+++', c_dumont, v_entry.id, 'reconciled'),
    (v_company, v_stmt, v_bank, 20, date '2026-08-11', date '2026-08-11', -1452.00,
     'Virement Immo Central SA', 'Immo Central SA', 'BE62510007547061',
     null, s_immo, null, 'pending'),
    (v_company, v_stmt, v_bank, 30, date '2026-08-20', date '2026-08-20', -712.00,
     'Paiement carte, fournitures', null, null, null, null, null, 'pending');
end
$$;
