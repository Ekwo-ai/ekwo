-- Ekwo module `budgets` — the module names what it lets somebody do.
--
-- Its policies asked `public.can_write_company()`, which is `entries.write`:
-- whoever may draft a journal entry could also write next year's budget. A
-- budget is not a book — it is written by whoever plans, read by whoever
-- reports, and it is the one thing in an installation that is deliberately
-- not the truth. Sharing a lock with the ledger is the wrong shape.
--
--   budgets.read  — see the budgets and their variance.
--   budgets.write — create and change a budget and its lines.
--
-- There is no `budgets.post`: this module writes nothing to the ledger, which
-- its manifest says (`"posts": false`) and a test of the socle enforces.
--
-- The presets follow the socle's. The owner preset was filled with `select
-- 'owner', code from capabilities` at the socle's own migration time, so a
-- code added later has to name the owner itself.

insert into public.capabilities (code, area, description) values
  ('budgets.read',  'budgets', 'Read the budgets of a company and their variance against the ledger.'),
  ('budgets.write', 'budgets', 'Create and change a budget and its lines.')
on conflict (code) do update set area = excluded.area, description = excluded.description;

insert into public.role_capabilities (role, capability) values
  ('viewer'::public.member_role,     'budgets.read'),
  ('accountant'::public.member_role, 'budgets.read'),
  ('accountant'::public.member_role, 'budgets.write'),
  ('owner'::public.member_role,      'budgets.read'),
  ('owner'::public.member_role,      'budgets.write')
on conflict do nothing;

-- `module_enabled()` stays in front of every policy: a capability says what a
-- person may do, and the module being enabled says whether the company has
-- this at all.

drop policy budgets_select on budgets.budgets;
create policy budgets_select on budgets.budgets
  for select using (
    public.module_enabled(company_id, 'budgets')
    and public.has_capability(company_id, 'budgets.read')
  );

drop policy budgets_write on budgets.budgets;
create policy budgets_write on budgets.budgets
  for all using (
    public.module_enabled(company_id, 'budgets')
    and public.has_capability(company_id, 'budgets.write')
  )
  with check (
    public.module_enabled(company_id, 'budgets')
    and public.has_capability(company_id, 'budgets.write')
  );

drop policy budgets_lines_select on budgets.lines;
create policy budgets_lines_select on budgets.lines
  for select using (
    public.module_enabled(company_id, 'budgets')
    and public.has_capability(company_id, 'budgets.read')
  );

drop policy budgets_lines_write on budgets.lines;
create policy budgets_lines_write on budgets.lines
  for all using (
    public.module_enabled(company_id, 'budgets')
    and public.has_capability(company_id, 'budgets.write')
  )
  with check (
    public.module_enabled(company_id, 'budgets')
    and public.has_capability(company_id, 'budgets.write')
  );

revoke execute on all functions in schema budgets from public;
