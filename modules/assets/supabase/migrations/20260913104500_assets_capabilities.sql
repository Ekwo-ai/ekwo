-- Ekwo module `assets` — the module names what it lets somebody do.
--
-- Its policies asked `public.can_write_company()`, which is `entries.write`:
-- whoever may draft a journal entry may also create a fixed asset, change its
-- cost, rewrite its schedule and record its disposal. That is one lock for two
-- doors, and the wrong one — the register that explains a depreciation entry
-- is not the entry, and the person who keeps it is often not the person who
-- posts the books.
--
-- So the module declares its own vocabulary, in its own migration, which is
-- where it belongs: a migration of the socle that named `assets` would be the
-- socle knowing what is built beside it. `capabilities.area` is the module
-- code, exactly as the socle's comment says it should be.
--
--   assets.read   — see the register.
--   assets.write  — create an asset, change it, plan its depreciation.
--   assets.post   — put a period or a disposal into the ledger.
--
-- `assets.post` is not the same as `entries.post`, and both are asked: this
-- one says the module may send *this* to the ledger, and `post_entry()` still
-- asks the socle's own question afterwards. Neither is redundant — an
-- accountant who may post the books may be deliberately kept off the asset
-- register, and somebody who keeps the register is not thereby allowed to
-- post anything else.
--
-- The presets follow the socle's: a viewer reads, an accountant does the work,
-- an owner holds everything. The socle filled the owner preset with `select
-- 'owner', code from capabilities` at its own migration time, so a code added
-- later has to name the owner itself.

insert into public.capabilities (code, area, description) values
  ('assets.read',  'assets', 'Read the fixed asset register, its depreciation schedules and its disposals.'),
  ('assets.write', 'assets', 'Create and change fixed assets and plan their depreciation.'),
  ('assets.post',  'assets', 'Book a depreciation period or a disposal to the ledger. Cannot be undone.')
on conflict (code) do update set area = excluded.area, description = excluded.description;

insert into public.role_capabilities (role, capability) values
  ('viewer'::public.member_role,     'assets.read'),
  ('accountant'::public.member_role, 'assets.read'),
  ('accountant'::public.member_role, 'assets.write'),
  ('accountant'::public.member_role, 'assets.post'),
  ('owner'::public.member_role,      'assets.read'),
  ('owner'::public.member_role,      'assets.write'),
  ('owner'::public.member_role,      'assets.post')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The policies, on the module's own words
--
-- `module_enabled()` stays in front of every one of them: a capability says
-- what a person may do, and the module being enabled says whether the company
-- has this at all. The two questions are not the same and neither replaces
-- the other.
-- ---------------------------------------------------------------------------

drop policy assets_select on assets.assets;
create policy assets_select on assets.assets
  for select using (
    public.module_enabled(company_id, 'assets')
    and public.has_capability(company_id, 'assets.read')
  );

drop policy assets_write on assets.assets;
create policy assets_write on assets.assets
  for all using (
    public.module_enabled(company_id, 'assets')
    and public.has_capability(company_id, 'assets.write')
  )
  with check (
    public.module_enabled(company_id, 'assets')
    and public.has_capability(company_id, 'assets.write')
  );

drop policy assets_lines_select on assets.depreciation_lines;
create policy assets_lines_select on assets.depreciation_lines
  for select using (
    public.module_enabled(company_id, 'assets')
    and public.has_capability(company_id, 'assets.read')
  );

drop policy assets_lines_write on assets.depreciation_lines;
create policy assets_lines_write on assets.depreciation_lines
  for all using (
    public.module_enabled(company_id, 'assets')
    and public.has_capability(company_id, 'assets.write')
  )
  with check (
    public.module_enabled(company_id, 'assets')
    and public.has_capability(company_id, 'assets.write')
  );

drop policy assets_disposals_select on assets.disposals;
create policy assets_disposals_select on assets.disposals
  for select using (
    public.module_enabled(company_id, 'assets')
    and public.has_capability(company_id, 'assets.read')
  );

drop policy assets_disposals_write on assets.disposals;
create policy assets_disposals_write on assets.disposals
  for all using (
    public.module_enabled(company_id, 'assets')
    and public.has_capability(company_id, 'assets.write')
  )
  with check (
    public.module_enabled(company_id, 'assets')
    and public.has_capability(company_id, 'assets.write')
  );

-- ---------------------------------------------------------------------------
-- What `assets.post` actually guards
--
-- Guards on the transition rather than inside `run_depreciation()` and
-- `dispose_asset()`, for the reason the socle gives for its own three: a
-- guard on the transition holds for every path into it, including a client
-- that writes the column itself, and it does not require republishing four
-- hundred lines of depreciation arithmetic for four lines of permission.
--
-- `is_installer()` for the same reason as everywhere else: the seeds and the
-- CLI hold a connection and no session.
-- ---------------------------------------------------------------------------

create or replace function assets.assert_may_post()
returns trigger
language plpgsql
as $$
begin
  if not public.is_installer() and not public.has_capability(new.company_id, 'assets.post') then
    raise exception 'not_allowed: booking this to the ledger needs assets.post'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger assets_lines_assert_may_post
  before update of posted_at on assets.depreciation_lines
  for each row when (new.posted_at is not null and old.posted_at is null)
  execute function assets.assert_may_post();

create trigger assets_disposals_assert_may_post
  before insert on assets.disposals
  for each row execute function assets.assert_may_post();

revoke execute on all functions in schema assets from public;
