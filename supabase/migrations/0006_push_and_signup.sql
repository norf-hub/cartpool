-- Closes the two pre-UI gaps: push token storage/registration, and signup
-- provisioning so real auth signups get a users row + subscription + solo
-- group (previously only tests calling create_user directly did).
--
-- Runs after 0004, so its blanket revokes don't cover objects created here —
-- grants and lockdown are explicit below. The `alter default privileges`
-- from 0004 already strips PUBLIC execute from new functions.

-------------------------------------------------------------------------------
-- 1. push_tokens
-------------------------------------------------------------------------------

create table push_tokens (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users (id) on delete cascade,
  token        text not null unique,   -- ExponentPushToken[...]
  platform     text not null check (platform in ('ios', 'android')),
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index push_tokens_by_user on push_tokens (user_id);

-- Devices change hands and users re-log-in: registering an existing token
-- re-points it at the current account instead of erroring.
create or replace function register_push_token(
  p_user uuid, p_token text, p_platform text
) returns jsonb language plpgsql as $$
begin
  if p_platform not in ('ios', 'android') then
    return jsonb_build_object('ok', false, 'error', 'bad_platform');
  end if;
  insert into push_tokens (user_id, token, platform)
  values (p_user, p_token, p_platform)
  on conflict (token) do update
    set user_id = excluded.user_id,
        platform = excluded.platform,
        last_seen_at = now();
  return jsonb_build_object('ok', true);
end;
$$;

-- Logout: only the owning user can unregister their token.
create or replace function unregister_push_token(p_user uuid, p_token text)
returns jsonb language plpgsql as $$
begin
  delete from push_tokens where token = p_token and user_id = p_user;
  if found then
    return jsonb_build_object('ok', true);
  end if;
  return jsonb_build_object('ok', false, 'error', 'not_found');
end;
$$;

-- Lockdown: tokens are delivery addresses — service_role (send-push) reads
-- them; clients only mutate through the api wrappers. RLS on, no policies.
alter table push_tokens enable row level security;

create or replace function api.register_push_token(p_token text, p_platform text)
returns jsonb language sql security definer
set search_path = public, api as $$
  select public.register_push_token(api.current_uid(), p_token, p_platform);
$$;

create or replace function api.unregister_push_token(p_token text)
returns jsonb language sql security definer
set search_path = public, api as $$
  select public.unregister_push_token(api.current_uid(), p_token);
$$;

revoke execute on all functions in schema api from public, anon;
grant execute on function api.register_push_token(text, text) to authenticated;
grant execute on function api.unregister_push_token(text) to authenticated;

do $do$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, delete on push_tokens to service_role; -- delete: token GC on Expo receipts
    grant execute on all functions in schema public to service_role;
  end if;
end
$do$;

-------------------------------------------------------------------------------
-- 2. Signup provisioning: auth.users -> create_user
-------------------------------------------------------------------------------

-- Compat shim: bare Postgres (tests/CI) has no auth.users. Create a minimal
-- lookalike so the trigger path is exercised in the test suite too. No-op on
-- Supabase, which owns the real table.
do $do$
begin
  if to_regclass('auth.users') is null then
    create table auth.users (
      id                 uuid primary key default gen_random_uuid(),
      phone              text,
      email              text,
      raw_user_meta_data jsonb not null default '{}'::jsonb,
      created_at         timestamptz not null default now()
    );
  end if;
end
$do$;

-- Provision on signup with users.id = auth.users.id, which is what the api
-- wrappers' auth.uid() binding assumes. Display name comes from signup
-- metadata; the placeholder is replaced in onboarding.
create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer
set search_path = public as $$
begin
  perform create_user(
    new.phone,
    coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), 'New user'),
    new.id
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();
