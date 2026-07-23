-- Onboarding: let a new user set the display name their lists show, and track
-- whether they've finished first-run so the client knows to show it.
--
-- Phone signups provision with display_name = 'New user' (0006). The ob3 name
-- step replaces that and marks onboarding complete. `onboarded` defaults false
-- so genuinely new accounts see the flow; existing accounts are backfilled to
-- true below so no one already using Cartpool is sent back through it.

alter table users add column if not exists onboarded boolean not null default false;

-- Everyone who exists at migration time has already been using the app.
update users set onboarded = true where onboarded = false;

-- Parameterized core (client-unreachable, per 0004). Trims and length-caps the
-- name; an empty result is rejected rather than stored. Setting the name is
-- what completes onboarding, so it flips the flag in the same write.
create or replace function set_display_name(p_user uuid, p_name text)
returns jsonb language plpgsql as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
begin
  if v_name = '' then
    return jsonb_build_object('ok', false, 'error', 'empty_name');
  end if;
  if length(v_name) > 40 then
    v_name := left(v_name, 40);
  end if;
  update users set display_name = v_name, onboarded = true where id = p_user;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function api.set_display_name(p_name text)
returns jsonb language sql security definer
set search_path = public, api as $$
  select public.set_display_name(api.current_uid(), p_name);
$$;

revoke execute on function set_display_name(uuid, text) from public, anon, authenticated;
grant execute on function api.set_display_name(text) to authenticated;

do $do$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on all functions in schema public to service_role;
  end if;
end
$do$;
