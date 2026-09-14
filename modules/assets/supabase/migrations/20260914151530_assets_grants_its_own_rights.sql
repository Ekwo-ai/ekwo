-- The `assets` module grants its own rights, by name.
--
-- The socle stopped borrowing the project's default privileges in
-- `20260914151207`; this is the same change for a module schema, where the
-- starting point was different and wrong in its own way.
--
-- `20260913081447` opened the schema with three wildcards:
--
--   grant select on all tables in schema assets to anon;
--   grant select, insert, update, delete on all tables in schema assets
--     to authenticated, service_role;
--
-- The first contradicts the doctrine of `20260911210131` — `anon` reaches the
-- policy helpers and nothing else — and it was the only place in the whole
-- schema where the anonymous role held a privilege on a table. Row level
-- security answered every one of those reads with an empty set, so nothing
-- leaked; the surface should be closed rather than merely empty, which is the
-- same sentence that migration wrote about functions.
--
-- The second is too wide by two tables. `category_templates` and
-- `country_rules` are what the module's pack section installs — the
-- depreciation categories of a country and the rules that pick a method —
-- and their only policy is a SELECT. A grant that offers three verbs no
-- policy will ever accept is a grant that describes the schema incorrectly,
-- and from here the inventory test reads it as the declaration it is.
--
-- Published migrations are never edited, so the wildcards stand in their file
-- and are corrected here.

-- `usage` stays as it is for all three roles. A schema nobody holds an object
-- privilege in reaches nothing, and PostgREST needs it for the roles that do.

revoke all on all tables    in schema assets from anon, authenticated, service_role;
revoke all on all sequences in schema assets from anon, authenticated, service_role;

alter default privileges in schema assets revoke all on tables    from anon, authenticated, service_role;
alter default privileges in schema assets revoke all on sequences from anon, authenticated, service_role;
alter default privileges in schema assets revoke execute on functions from public, anon, authenticated, service_role;

-- The register and what it produces: a policy `for all` governs each, so the
-- four verbs are the ones row level security is prepared to judge. Posting is
-- guarded by `assets.assert_may_post`, not by a withheld privilege, so DELETE
-- on a draft line stays possible and DELETE on a posted one stays refused.
grant select, insert, update, delete on table
  assets.assets,
  assets.depreciation_lines,
  assets.disposals
to authenticated, service_role;

-- What the country pack installs. SELECT only, on both sides of the grant and
-- of the policy.
grant select on table
  assets.category_templates,
  assets.country_rules
to authenticated, service_role;

-- The fourteen callable functions keep the nominative grants their own
-- migration gave them. The trigger body does not: it is fired by the table,
-- never called, and PostgreSQL checks EXECUTE when a trigger is created
-- rather than when it fires.
revoke execute on function assets.assert_may_post() from public, anon, authenticated, service_role;

revoke execute on all functions in schema assets from public;
