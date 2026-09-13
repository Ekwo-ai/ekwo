-- Ekwo OS — inviting somebody who does not have an account yet.
--
-- `company_members.user_id` deliberately carries no foreign key to
-- `auth.users`, precisely so that a membership can be written before the
-- person has signed up. What was missing is the act that produces it: until
-- now somebody had to know the invitee's `auth.users.id` — which means the
-- invitee had to exist, and somebody had to go and read it out of the Auth
-- dashboard.
--
-- An invitation is the missing half. It names an address, a preset and any
-- capability granted on top of it, and it carries a secret that is handed over
-- once and stored only as a hash. The person signs up with their own address
-- in the customer's Supabase Auth, and `accept_invitation()` turns the
-- invitation into a membership — after checking that the address they signed
-- in with is the one that was invited.
--
-- **Three rules and their reasons.**
--
-- The token is never stored. `token_hash` is a sha256 of it, computed by
-- Postgres' own `sha256()` — core since PostgreSQL 11, so no extension, which
-- `pgcrypto` would have been and PGlite does not carry. A database backup
-- therefore hands nobody an invitation.
--
-- The address is matched, not trusted. A token alone would let whoever
-- receives a forwarded e-mail join the books; `auth.email()` has to equal the
-- address the invitation was written for, case-insensitively.
--
-- An invitation is used once and expires. Accepting sets `accepted_at`, and
-- every later attempt is refused rather than silently re-adding a member
-- somebody may have removed on purpose.

create table company_invitations (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references companies(id) on delete cascade,
  -- Lower-cased on the way in: an address is not case-sensitive in its domain
  -- and, in practice, not in its local part either. `citext` would have said
  -- the same thing and is an extension.
  email                text not null,
  role                 member_role not null default 'viewer',
  capabilities_granted text[] not null default '{}',
  token_hash           text not null unique,
  invited_by           uuid,
  created_at           timestamptz not null default now(),
  expires_at           timestamptz not null,
  accepted_at          timestamptz,
  accepted_by          uuid,
  revoked_at           timestamptz,
  constraint company_invitations_email_lowercase check (email = lower(email)),
  constraint company_invitations_email_shape check (email like '%_@_%'),
  constraint company_invitations_expiry check (expires_at > created_at),
  constraint company_invitations_accepted_together
    check ((accepted_at is null) = (accepted_by is null))
);

comment on table company_invitations is
  'Pending and past invitations into a company. The token is handed over once and kept only as a sha256 hash.';
comment on column company_invitations.email is
  'The address the invitation is for, lower-cased. accept_invitation() refuses anyone signed in with another.';
comment on column company_invitations.capabilities_granted is
  'Capabilities the new member holds on top of their preset, written onto company_members when the invitation is accepted.';
comment on column company_invitations.invited_by is
  'auth.users.id of whoever issued it. No foreign key, for the same reason company_members has none.';

create index company_invitations_company_idx on company_invitations (company_id, created_at desc);
create index company_invitations_email_idx on company_invitations (lower(email));

-- ---------------------------------------------------------------------------
-- Issuing one
--
-- The secret is two `gen_random_uuid()` with their dashes removed: 256 bits
-- from the same source the primary keys come from, and no extension. It is
-- returned by this call and by nothing else, ever.
-- ---------------------------------------------------------------------------

create or replace function invite_member(
  p_company_id   uuid,
  p_email        text,
  p_role         member_role default 'viewer',
  -- A list crosses as JSON, the way `opening_balance` takes its lines: over
  -- PostgREST an argument is a JSON body, and a Postgres driver handed a
  -- JavaScript array builds an array literal instead. One spelling that both
  -- routes read the same way.
  p_capabilities jsonb default '[]'::jsonb,
  p_valid_for    interval default interval '14 days'
)
returns table (invitation_id uuid, token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email   text := lower(trim(p_email));
  v_token   text;
  v_unknown text;
  v_caps    text[] := coalesce(
    (select array_agg(value) from jsonb_array_elements_text(coalesce(p_capabilities, '[]'::jsonb)) as value),
    '{}');
  v_row     company_invitations%rowtype;
begin
  if auth.uid() is not null and not has_capability(p_company_id, 'members.manage')
     and not is_instance_admin() then
    raise exception 'not_allowed: inviting somebody into this company needs members.manage'
      using errcode = '42501';
  end if;

  if v_email is null or v_email not like '%_@_%' then
    raise exception 'bad_email: % is not an address an invitation can be sent to', p_email;
  end if;

  select c into v_unknown
    from unnest(v_caps) as c
   where c not in (select code from capabilities)
   limit 1;
  if v_unknown is not null then
    raise exception 'unknown_capability: % is not a capability of this installation', v_unknown;
  end if;

  -- Re-inviting the same address replaces the pending invitation rather than
  -- leaving two tokens alive for one seat.
  update company_invitations
     set revoked_at = now()
   where company_id = p_company_id
     and email = v_email
     and accepted_at is null
     and revoked_at is null;

  v_token := replace(gen_random_uuid()::text, '-', '') ||
             replace(gen_random_uuid()::text, '-', '');

  insert into company_invitations (company_id, email, role, capabilities_granted,
                                   token_hash, invited_by, expires_at)
  values (p_company_id, v_email, p_role, v_caps,
          encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), auth.uid(), now() + p_valid_for)
  returning * into v_row;

  return query select v_row.id, v_token, v_row.expires_at;
end;
$$;

comment on function invite_member(uuid, text, member_role, jsonb, interval) is
  'Invites an address into a company and returns the token once. Only the hash is stored; re-inviting the same address revokes the pending invitation.';

-- ---------------------------------------------------------------------------
-- Accepting one
--
-- Definer, because the invitee is nobody yet: they cannot read
-- `company_invitations` and cannot write `company_members`. What the function
-- checks is everything the policies would have: a live invitation, and the
-- address it was written for.
-- ---------------------------------------------------------------------------

create or replace function accept_invitation(p_token text)
returns company_members
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_invitation company_invitations%rowtype;
  v_member     company_members%rowtype;
begin
  if auth.uid() is null then
    raise exception 'no_user: accepting an invitation is something a signed-in user does';
  end if;

  select * into v_invitation
    from company_invitations
   where token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex');

  if v_invitation.id is null then
    raise exception 'unknown_invitation: that is not an invitation of this installation';
  end if;
  if v_invitation.revoked_at is not null then
    raise exception 'invitation_revoked: that invitation was withdrawn on %', v_invitation.revoked_at;
  end if;
  if v_invitation.accepted_at is not null then
    raise exception 'invitation_already_accepted: that invitation was used on %', v_invitation.accepted_at;
  end if;
  if v_invitation.expires_at <= now() then
    raise exception 'invitation_expired: that invitation expired on %', v_invitation.expires_at;
  end if;
  if lower(coalesce(auth.email(), '')) <> v_invitation.email then
    raise exception 'invitation_not_yours: that invitation was sent to another address'
      using errcode = '42501';
  end if;

  insert into company_members (company_id, user_id, role, capabilities_granted)
  values (v_invitation.company_id, auth.uid(), v_invitation.role,
          v_invitation.capabilities_granted)
  on conflict (company_id, user_id) do nothing
  returning * into v_member;

  if v_member.user_id is null then
    select * into v_member
      from company_members
     where company_id = v_invitation.company_id and user_id = auth.uid();
  end if;

  update company_invitations
     set accepted_at = now(), accepted_by = auth.uid()
   where id = v_invitation.id;

  return v_member;
end;
$$;

comment on function accept_invitation(text) is
  'Turns an invitation into a membership for the signed-in user, whose address has to be the one invited. Single use, and refused once expired.';

create or replace function revoke_invitation(p_invitation_id uuid)
returns company_invitations
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row company_invitations%rowtype;
begin
  select * into v_row from company_invitations where id = p_invitation_id;
  if v_row.id is null then
    raise exception 'unknown_invitation: no invitation with that id';
  end if;

  if auth.uid() is not null and not has_capability(v_row.company_id, 'members.manage')
     and not is_instance_admin() then
    raise exception 'not_allowed: withdrawing an invitation needs members.manage'
      using errcode = '42501';
  end if;

  if v_row.accepted_at is not null then
    raise exception 'invitation_already_accepted: it became a membership on %; remove the member instead',
      v_row.accepted_at;
  end if;

  update company_invitations set revoked_at = coalesce(revoked_at, now())
   where id = p_invitation_id
  returning * into v_row;

  return v_row;
end;
$$;

comment on function revoke_invitation(uuid) is
  'Withdraws an invitation that has not been accepted. An accepted one is a member, and members are removed from company_members.';

-- ---------------------------------------------------------------------------
-- Row level security
--
-- Reading an invitation is administering members, so it is `members.manage`
-- and the instance administrator. Nothing writes through the API: the three
-- functions above are the only way in, and each one checks what a policy
-- would have.
-- ---------------------------------------------------------------------------

alter table company_invitations enable row level security;

create policy company_invitations_select on company_invitations
  for select using (
    has_capability(company_id, 'members.manage') or is_instance_admin()
  );

revoke execute on all functions in schema public from public;
