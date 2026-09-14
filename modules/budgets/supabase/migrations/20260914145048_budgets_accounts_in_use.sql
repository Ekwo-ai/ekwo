-- The `budgets` module answers which accounts of a company it holds.
--
-- Same convention as `assets`: `public.accounts_in_use()` asks each module the
-- company has enabled for `<schema>.accounts_in_use(uuid)` rather than naming
-- the schema itself, so the socle keeps ignoring what is built beside it.
--
-- A budget line is a planned amount on an account, and an account somebody has
-- budgeted for is an account they mean to use — which is the whole case for
-- counting it before anything is booked on it.
--
-- Security invoker: the policies of `budgets.lines` decide, and a caller who
-- is not a member of the company sees nothing.

create or replace function budgets.accounts_in_use(p_company_id uuid)
returns setof uuid
language sql
stable
as $$
  select distinct l.account_id
    from budgets.lines l
   where l.company_id = p_company_id;
$$;

comment on function budgets.accounts_in_use(uuid) is
  'The accounts this module points at for one company: every account a budget line plans an amount on. Read by public.accounts_in_use() through the module convention.';

revoke execute on function budgets.accounts_in_use(uuid) from public, anon;
grant execute on function budgets.accounts_in_use(uuid) to authenticated, service_role;

revoke execute on all functions in schema budgets from public;
