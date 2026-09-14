-- The `budgets` module grants its own rights, by name.
--
-- Same change as `20260914151207` for the socle and
-- `20260914151530` for `assets`: the privileges a module schema hands out are
-- written down, table by table, instead of being taken from a wildcard or
-- from the project's default privileges.
--
-- `20260913083012` granted `select on all tables in schema budgets to anon`.
-- Row level security answered every such read with an empty set, so nothing
-- leaked, and the doctrine of `20260911210131` still says the anonymous role
-- reaches the policy helpers and nothing else. Published migrations are never
-- edited, so it is corrected here.

revoke all on all tables    in schema budgets from anon, authenticated, service_role;
revoke all on all sequences in schema budgets from anon, authenticated, service_role;

alter default privileges in schema budgets revoke all on tables    from anon, authenticated, service_role;
alter default privileges in schema budgets revoke all on sequences from anon, authenticated, service_role;
alter default privileges in schema budgets revoke execute on functions from public, anon, authenticated, service_role;

-- Both tables carry a policy `for all`: a budget and its lines are written by
-- the people who plan the year, and read by everyone who may read the books.
grant select, insert, update, delete on table
  budgets.budgets,
  budgets.lines
to authenticated, service_role;

-- `budgets.variance` keeps the grant its own migration gave it. The schema
-- has no trigger function and no sequence.

revoke execute on all functions in schema budgets from public;
