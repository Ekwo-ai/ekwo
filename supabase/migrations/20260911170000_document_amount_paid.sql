-- Ekwo OS — a document's settlement is derived from its matching.
--
-- `documents.amount_paid` was a column somebody had to remember to write, while
-- the truth of what has been settled lived in `reconciliations`. That is the
-- rule of this schema broken on its own terms: totals are derived, never keyed
-- in. Matching a third-party line now moves the document, and `payment_state`
-- follows from there as it already did.
--
-- The recomputation is folded into the existing reconciliation trigger rather
-- than added as a second one, because two AFTER ROW triggers on the same table
-- fire in name order, and this one has to run after the line residuals have
-- been updated, not before.

create or replace function documents_refresh_amount_paid(p_document_id uuid)
returns void
language plpgsql
as $$
begin
  -- The statement names amount_paid so that documents_refresh_payment_state,
  -- which watches that column, fires in turn.
  update documents d
     set amount_paid = coalesce((
           select sum(l.matched_amount)
             from entry_lines l
             join accounts a on a.id = l.account_id
            where l.entry_id = d.entry_id
              and a.reconcilable
              and a.account_type in ('asset_receivable', 'liability_payable')
         ), 0)
   where d.id = p_document_id
     and d.entry_id is not null;
end;
$$;

comment on function documents_refresh_amount_paid(uuid) is
  'Recomputes what a document has been settled by, from the matched amounts on its third-party lines.';

comment on column documents.amount_paid is
  'Derived from reconciliations on the third-party lines of the document''s entry. A value written by hand is replaced at the next matching.';

create or replace function reconciliations_refresh_lines()
returns trigger
language plpgsql
as $$
declare
  v_ids uuid[];
  v_id  uuid;
  v_doc uuid;
begin
  v_ids := array_remove(array[
    coalesce(new.debit_line_id, old.debit_line_id),
    coalesce(new.credit_line_id, old.credit_line_id)
  ], null);

  foreach v_id in array v_ids loop
    update entry_lines l
       set matched_amount = coalesce((
             select sum(r.amount) from reconciliations r
              where r.debit_line_id = l.id or r.credit_line_id = l.id
           ), 0),
           matching_number = (
             select r.matching_number from reconciliations r
              where r.debit_line_id = l.id or r.credit_line_id = l.id
              order by r.created_at
              limit 1
           )
     where l.id = v_id;
  end loop;

  -- Then the documents those lines belong to, now that the residuals are right.
  for v_doc in
    select distinct d.id
      from entry_lines l
      join documents d on d.entry_id = l.entry_id
     where l.id = any (v_ids)
  loop
    perform documents_refresh_amount_paid(v_doc);
  end loop;

  return null;
end;
$$;
