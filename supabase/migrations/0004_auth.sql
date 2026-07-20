-- Client-facing security layer.
--
-- Core functions (0003) take the acting user as a parameter so they are
-- testable against bare Postgres. This migration makes them unreachable from
-- clients and exposes thin SECURITY DEFINER wrappers in the `api` schema that
-- bind that parameter to auth.uid(). It also enables RLS on every table:
-- clients read via policies (lists, Realtime) and write ONLY via api.* RPCs.
--
-- Server-only functions (create_user, handle_entitlement_event,
-- purge_retention, promote_waitlist) get no wrapper — service_role only.

-------------------------------------------------------------------------------
-- 0. Compat shims so this migration also runs on bare Postgres (tests).
--    All of these are no-ops on Supabase, which pre-defines the roles and
--    auth.uid().
-------------------------------------------------------------------------------

do $do$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end
$do$;

create schema if not exists auth;

do $do$
begin
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'auth' and p.proname = 'uid'
  ) then
    -- Same claims Supabase's auth.uid() reads; tests set them with set_config().
    execute $fn$
      create function auth.uid() returns uuid
      language sql stable
      as $body$
        select coalesce(
          nullif(current_setting('request.jwt.claim.sub', true), ''),
          nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
        )::uuid
      $body$
    $fn$;
  end if;
end
$do$;

grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;

-- Schema-level visibility for the core tables. Hosted Supabase pre-grants this
-- at project bootstrap, so it is a no-op there; on bare Postgres it is
-- required, because the test harness recreates `public` and a freshly created
-- schema carries no privileges beyond its owner. Without it, `authenticated`
-- silently fails to resolve unqualified names ("relation does not exist")
-- instead of hitting the RLS policies below. USAGE only -- never CREATE, and
-- this grants no table privileges on its own (see the revokes in section 1).
grant usage on schema public to anon, authenticated;

-------------------------------------------------------------------------------
-- 1. Lock down the core layer: no direct execute, no direct writes.
-------------------------------------------------------------------------------

revoke execute on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public revoke execute on functions from public;

revoke all on all tables in schema public from anon;
revoke insert, update, delete, truncate, references, trigger
  on all tables in schema public from authenticated;

-------------------------------------------------------------------------------
-- 2. Policy helpers (SECURITY DEFINER so membership checks don't recurse
--    through the memberships policy itself).
-------------------------------------------------------------------------------

create or replace function public.user_in_group(p_group uuid)
returns boolean language sql stable security definer
set search_path = public as $$
  select exists (
    select 1 from memberships
    where group_id = p_group and user_id = auth.uid() and left_at is null
  );
$$;

create or replace function public.shares_group_with(p_other uuid)
returns boolean language sql stable security definer
set search_path = public as $$
  select exists (
    select 1
    from memberships a
    join memberships b on b.group_id = a.group_id
    where a.user_id = auth.uid() and a.left_at is null
      and b.user_id = p_other and b.left_at is null
  );
$$;

grant execute on function public.user_in_group(uuid) to authenticated;
grant execute on function public.shares_group_with(uuid) to authenticated;

-------------------------------------------------------------------------------
-- 3. Row Level Security. Reads only — there are no write policies at all;
--    every mutation goes through api.* (whose definer bypasses RLS and does
--    its own authorization).
-------------------------------------------------------------------------------

alter table users            enable row level security;
alter table groups           enable row level security;
alter table memberships      enable row level security;
alter table items            enable row level security;
alter table bulk_opt_ins     enable row level security;
alter table invites          enable row level security;
alter table waitlist_entries enable row level security;
alter table blocks           enable row level security;
alter table subscriptions    enable row level security;

-- users: clients see only their own row, and phone_number/email are never
-- selectable (column privileges). Co-members' display names come exclusively
-- from the api.member_profiles view below.
revoke select on public.users from anon, authenticated;
grant select (id, display_name, created_at) on public.users to authenticated;
create policy users_select on users for select to authenticated
  using (id = auth.uid());

grant select on public.groups to authenticated;
create policy groups_select on groups for select to authenticated
  using (user_in_group(id));

grant select on public.memberships to authenticated;
create policy memberships_select on memberships for select to authenticated
  using (user_id = auth.uid() or user_in_group(group_id));

grant select on public.items to authenticated;
create policy items_select on items for select to authenticated
  using (user_in_group(group_id));

grant select on public.bulk_opt_ins to authenticated;
create policy bulk_opt_ins_select on bulk_opt_ins for select to authenticated
  using (exists (select 1 from items i
                 where i.id = bulk_opt_ins.item_id and user_in_group(i.group_id)));

grant select on public.invites to authenticated;
create policy invites_select on invites for select to authenticated
  using (user_in_group(group_id));

grant select on public.waitlist_entries to authenticated;
create policy waitlist_select on waitlist_entries for select to authenticated
  using (user_id = auth.uid());

-- blocks: deliberately NO grant and NO policy — invisible to every client,
-- both directions (spec: no UI surface; support reads the audit trail
-- server-side).

grant select on public.subscriptions to authenticated;
create policy subscriptions_select on subscriptions for select to authenticated
  using (user_id = auth.uid());

-------------------------------------------------------------------------------
-- 4. api schema: the only client-callable surface. Every wrapper binds the
--    acting user to auth.uid(); clients can never pass a user id.
-------------------------------------------------------------------------------

create schema if not exists api;
grant usage on schema api to authenticated;

create or replace function api.current_uid()
returns uuid language plpgsql stable as $$
declare
  v uuid;
begin
  v := auth.uid();
  if v is null then
    raise exception 'unauthenticated';
  end if;
  return v;
end;
$$;

-- Groupmate identities, minus anything private: exactly (id, display_name).
-- Owned by the migration role, so it reads past the self-only users policy;
-- rows are still limited to the caller's active co-members.
create view api.member_profiles as
  select u.id, u.display_name
  from public.users u
  where u.id = auth.uid() or public.shares_group_with(u.id);

grant select on api.member_profiles to authenticated;

create or replace function api.my_profile()
returns public.users language sql stable security definer
set search_path = public as $$
  select * from users where id = auth.uid();
$$;

create or replace function api.create_group()
returns jsonb language sql security definer
set search_path = public, api as $$
  select public.create_group(api.current_uid());
$$;

create or replace function api.add_item(
  p_group uuid, p_text text,
  p_is_bulk boolean default false, p_bulk_note text default null
) returns jsonb language sql security definer
set search_path = public, api as $$
  select public.add_item(p_group, api.current_uid(), p_text, p_is_bulk, p_bulk_note);
$$;

create or replace function api.mark_purchased(p_item uuid)
returns jsonb language sql security definer
set search_path = public, api as $$
  select public.mark_purchased(p_item, api.current_uid());
$$;

create or replace function api.unmark_purchased(p_item uuid)
returns jsonb language sql security definer
set search_path = public, api as $$
  select public.unmark_purchased(p_item, api.current_uid());
$$;

create or replace function api.edit_item_text(p_item uuid, p_text text)
returns jsonb language sql security definer
set search_path = public, api as $$
  select public.edit_item_text(p_item, api.current_uid(), p_text);
$$;

create or replace function api.remove_item(p_item uuid)
returns jsonb language sql security definer
set search_path = public, api as $$
  select public.remove_item(p_item, api.current_uid());
$$;

create or replace function api.bulk_opt_in(p_item uuid)
returns jsonb language sql security definer
set search_path = public, api as $$
  select public.bulk_opt_in(p_item, api.current_uid());
$$;

create or replace function api.bulk_assign(p_item uuid, p_target uuid)
returns jsonb language sql security definer
set search_path = public, api as $$
  select public.bulk_assign(p_item, api.current_uid(), p_target);
$$;

create or replace function api.bulk_reconfirm(p_item uuid)
returns jsonb language sql security definer
set search_path = public, api as $$
  select public.bulk_reconfirm(p_item, api.current_uid());
$$;

create or replace function api.leave_group(p_group uuid)
returns jsonb language sql security definer
set search_path = public, api as $$
  select public.leave_group(p_group, api.current_uid());
$$;

create or replace function api.block_user(p_blocked uuid)
returns jsonb language sql security definer
set search_path = public, api as $$
  select public.block_user(api.current_uid(), p_blocked);
$$;

create or replace function api.create_invite(
  p_group uuid, p_channel public.invite_channel, p_target text default null
) returns jsonb language sql security definer
set search_path = public, api as $$
  select public.create_invite(p_group, api.current_uid(), p_channel, p_target);
$$;

create or replace function api.redeem_invite(p_code text)
returns jsonb language sql security definer
set search_path = public, api as $$
  select public.redeem_invite(p_code, api.current_uid());
$$;

create or replace function api.choose_kept_groups(p_groups uuid[])
returns jsonb language sql security definer
set search_path = public, api as $$
  select public.choose_kept_groups(api.current_uid(), p_groups);
$$;

revoke execute on all functions in schema api from public, anon;
grant execute on all functions in schema api to authenticated;
alter default privileges in schema api revoke execute on functions from public;

-------------------------------------------------------------------------------
-- 5. Server-side access (RevenueCat webhook, signup provisioning, cron):
--    Supabase's service_role keeps full function access; absent on bare
--    Postgres, where tests run as a superuser anyway.
-------------------------------------------------------------------------------

do $do$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant usage on schema public to service_role;
    grant usage on schema api to service_role;
    grant execute on all functions in schema public to service_role;
  end if;
end
$do$;
