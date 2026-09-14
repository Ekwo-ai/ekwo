-- Ekwo OS — the code of an account stops moving once something is booked on it.
--
-- Every reference to an account inside a company is a foreign key on
-- `accounts(id)`: the roles of the company, the overrides of a contact, the
-- journals, the tax postings, the lines of a document, the lines of the
-- ledger, and the tables of the modules. Renaming an account therefore breaks
-- nothing, and renumbering one appears to break nothing either — the keys
-- follow.
--
-- The rules do not follow. A financial statement maps an account to a line by
-- its code (`statement_line_rules` carries `account_code` rules, and on the
-- Belgian chart a rubric code *is* a range of codes), a declaration box is
-- reached through a tax posting whose account is one the pack named by code,
-- and `account_id_by_code()` is how half the schema finds an account at all.
-- So moving `700000` to `701000` moves the account to a different line of the
-- balance sheet or the profit and loss account, and the year already booked
-- on it moves with it — silently, and in a statement somebody has filed.
--
-- `accounts_write` let that happen: the policy judges which company a row
-- belongs to and has nothing to say about which column changes. This adds the
-- guard the policy cannot express.
--
--   `account_code_frozen`  the code may not change once the account carries a
--                          line of the ledger, is named by a tax posting, or
--                          plays one of the company's roles.
--   `account_type_frozen`  neither may the type, for the same reason: the
--                          eighteen types are what puts an account on one side
--                          of the balance sheet or in the income statement,
--                          and `internal_group` and `carries_forward` are
--                          generated from it.
--
-- Everything else about an account stays editable at any time: its name, its
-- translations, its notes, its parent, whether it is reconcilable, whether it
-- is deprecated, whether it is pinned. Renaming an account is ordinary work —
-- it is what an operator does to a chart they have just installed — and
-- `pack_upgrade` does it too, on the `review` rule, when a pack changes a
-- label.
--
-- One consequence is deliberate: `pack_upgrade(…, p_apply => true)` now fails
-- by name rather than moving a used account between statements. A pack that
-- changes the type of an account a company has been booking on is a difference
-- a person has to look at, which is what the `review` rule was already for.
--
-- Deprecating is the way out, and it always was: an account that was wrong is
-- deprecated and a new one takes the entries from here on. Nothing is deleted
-- from a chart, for the same reason nothing is deleted from a pack.

create or replace function accounts_guard_frozen()
returns trigger
language plpgsql
as $$
declare
  v_used boolean;
begin
  if new.code = old.code and new.account_type = old.account_type then
    return new;
  end if;

  select exists (select 1 from entry_lines l where l.account_id = old.id)
      or exists (select 1 from tax_postings tp where tp.account_id = old.id)
      or exists (
           select 1 from companies c
            where c.id = old.company_id
              and old.id in (c.receivable_account_id, c.payable_account_id,
                             c.suspense_account_id, c.rounding_account_id,
                             c.retained_earnings_account_id,
                             c.default_sales_account_id, c.default_purchase_account_id)
         )
    into v_used;

  if not v_used then
    return new;
  end if;

  if new.code <> old.code then
    raise exception 'account_code_frozen: % carries entries, a tax posting or a company role, so its code stays %. Deprecate it and open the new code instead.',
      old.code, old.code
      using errcode = '55006';
  end if;

  raise exception 'account_type_frozen: % is in use, so it stays %. Its type is what puts it on a line of the statements, and the entries already booked would move with it.',
    old.code, old.account_type
    using errcode = '55006';
end;
$$;

comment on function accounts_guard_frozen() is
  'Refuses a change of code or of account_type on an account that carries ledger lines, is named by a tax posting or plays a company role. The label, the translations, the parent, reconcilable, deprecated and pinned stay editable.';

create trigger accounts_guard_frozen
  before update on accounts
  for each row execute function accounts_guard_frozen();

-- A trigger body is invoked by its table, never called: PostgreSQL checks
-- EXECUTE when the trigger is created, so taking it away removes an RPC
-- endpoint and changes nothing else.
revoke execute on function accounts_guard_frozen() from public, anon, authenticated, service_role;

revoke execute on all functions in schema public from public;
