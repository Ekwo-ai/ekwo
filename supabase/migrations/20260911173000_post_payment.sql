-- Ekwo OS — booking a payment.
--
-- `post_document` turned an invoice into an entry from the first release;
-- money moving had no equivalent, so every client had to assemble the two
-- ledger lines of a payment itself. That is the one thing a client must never
-- do: the moment a caller writes `entry_lines`, the rules about sides,
-- accounts and locks live in whichever client happens to be writing them, and
-- there are as many answers as there are clients. So the rule moves here,
-- next to the other one.
--
-- What it books, and nothing else:
--
--   inbound  — money in.  debit the bank, credit the receivable.
--   outbound — money out. credit the bank, debit the payable.
--
-- The third-party account is resolved by role, the same way `post_document`
-- resolves it: the contact's override first, the company default second,
-- never by matching a code prefix. The bank side comes from the payment's
-- bank account, or from the default account of its journal.
--
-- What it deliberately does not do: match anything. A payment is money
-- arriving; which invoices it settles is a separate decision, taken by
-- `reconcile`, and conflating the two is how a payment ends up silently
-- allocated to the wrong invoice.

create or replace function post_payment(p_payment_id uuid)
returns entries
language plpgsql
as $$
declare
  v_pay        payments%rowtype;
  v_entry      entries%rowtype;
  v_money      uuid;
  v_third      uuid;
  v_contact    uuid;
  v_inbound    boolean;
  v_label      text;
begin
  select * into v_pay from payments where id = p_payment_id for update;
  if not found then
    raise exception 'unknown_payment: payment % does not exist', p_payment_id;
  end if;
  if v_pay.entry_id is not null then
    raise exception 'payment_already_booked: payment % already points at entry %',
      p_payment_id, v_pay.entry_id;
  end if;
  if v_pay.state = 'cancelled' then
    raise exception 'payment_cancelled: payment % cannot be booked', p_payment_id;
  end if;

  v_inbound := v_pay.direction = 'inbound';

  -- The bank side: the account behind the payment's bank account, or the
  -- default account of the journal it goes through.
  select b.account_id into v_money
    from bank_accounts b
   where b.id = v_pay.bank_account_id;

  if v_money is null then
    select coalesce(j.default_account_id, b.account_id) into v_money
      from journals j
      left join bank_accounts b on b.id = j.bank_account_id
     where j.id = v_pay.journal_id;
  end if;

  -- A bank account wired to the journal from its own side counts too: that is
  -- the direction an operator fills in first.
  if v_money is null then
    select b.account_id into v_money
      from bank_accounts b
     where b.journal_id = v_pay.journal_id
       and b.active
       and b.account_id is not null
     order by b.created_at
     limit 1;
  end if;

  if v_money is null then
    raise exception 'no_bank_account: set bank_account_id on the payment, or default_account_id on journal %',
      v_pay.journal_id;
  end if;

  -- The third-party side, by role.
  v_contact := commercial_entity(v_pay.contact_id);
  v_third   := resolve_counterpart_account(v_pay.company_id, v_contact, v_inbound);

  v_label := coalesce(v_pay.reference, v_pay.memo, 'payment');

  insert into entries (company_id, journal_id, fiscal_year_id, entry_date, reference,
                       description, state, currency_code)
  values (v_pay.company_id, v_pay.journal_id,
          fiscal_year_at(v_pay.company_id, v_pay.payment_date), v_pay.payment_date,
          v_pay.reference, v_label, 'draft', v_pay.currency_code)
  returning * into v_entry;

  insert into entry_lines (entry_id, company_id, account_id, sequence, name,
                           debit, credit, currency_code)
  values (v_entry.id, v_pay.company_id, v_money, 10, v_label,
          case when v_inbound then v_pay.amount else 0 end,
          case when v_inbound then 0 else v_pay.amount end,
          v_pay.currency_code);

  insert into entry_lines (entry_id, company_id, account_id, sequence, name,
                           debit, credit, contact_id, currency_code)
  values (v_entry.id, v_pay.company_id, v_third, 20, v_label,
          case when v_inbound then 0 else v_pay.amount end,
          case when v_inbound then v_pay.amount else 0 end,
          v_contact, v_pay.currency_code);

  v_entry := post_entry(v_entry.id);

  update payments
     set entry_id = v_entry.id,
         state    = 'posted'
   where id = p_payment_id;

  return v_entry;
end;
$$;

comment on function post_payment(uuid) is
  'Books a payment: the bank side from the payment''s bank account or its journal, the third-party side by role. Matches nothing.';
