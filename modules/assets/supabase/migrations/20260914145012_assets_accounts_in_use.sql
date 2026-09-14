-- The `assets` module answers which accounts of a company it holds.
--
-- `public.accounts_in_use()` builds the working chart of a company and has to
-- count the accounts a module points at — an asset booked on 240000 belongs
-- in the list whether or not a depreciation has been run yet. It does not name
-- this schema to find out: it asks, by the convention `disable_module()`
-- already reads, `<schema>.accounts_in_use(uuid)`. A module that references no
-- account writes no such function and `to_regprocedure` answers null.
--
-- Four columns of this schema carry an account: the three an asset is booked
-- on, and the counterpart a disposal is settled against.
--
-- Security invoker, so row level security answers: a caller who is not a
-- member of the company, or a company that has not enabled this module, gets
-- an empty set from the policies rather than a refusal from here.

create or replace function assets.accounts_in_use(p_company_id uuid)
returns setof uuid
language sql
stable
as $$
  select unnest(array[a.asset_account_id, a.depreciation_account_id, a.expense_account_id])
    from assets.assets a
   where a.company_id = p_company_id
  union
  select d.counterpart_account_id
    from assets.disposals d
   where d.company_id = p_company_id and d.counterpart_account_id is not null;
$$;

comment on function assets.accounts_in_use(uuid) is
  'The accounts this module points at for one company: what its assets are booked, depreciated and charged on, and what a disposal was settled against. Read by public.accounts_in_use() through the module convention.';

revoke execute on function assets.accounts_in_use(uuid) from public, anon;
grant execute on function assets.accounts_in_use(uuid) to authenticated, service_role;

revoke execute on all functions in schema assets from public;
