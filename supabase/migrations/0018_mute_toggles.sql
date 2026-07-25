-- Notification mutes (spec §6): a global toggle, plus a per-group override for
-- anyone who finds one group's pings overwhelming.
--
-- Both columns have existed since 0001 and supabase/functions/send-push already
-- reads them to pick recipients — but nothing could ever write them, so every
-- account was permanently unmuted. This adds the setters.
--
-- memberships.mute_override is nullable and means "follow the global setting"
-- while untouched. Once a member uses the per-group toggle it becomes an
-- explicit true/false for that group, which is what the column comment in 0001
-- describes. clear_group_mute puts a group back on the global setting so the
-- three states stay reachable.
--
-- Same shape as every other client mutation (cf. 0014): a parameterized core in
-- public that clients can't reach, and an api wrapper bound to auth.uid().

create or replace function set_global_mute(p_user uuid, p_on boolean)
returns jsonb language plpgsql as $$
begin
  update users set global_mute = p_on where id = p_user;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- p_on null clears the override, putting the group back on the global setting.
create or replace function set_group_mute(p_user uuid, p_group uuid, p_on boolean)
returns jsonb language plpgsql as $$
begin
  update memberships
     set mute_override = p_on
   where user_id = p_user and group_id = p_group and left_at is null;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_a_member');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function api.set_global_mute(p_on boolean)
returns jsonb language sql security definer
set search_path = public, api as $$
  select public.set_global_mute(api.current_uid(), p_on);
$$;

create or replace function api.set_group_mute(p_group uuid, p_on boolean)
returns jsonb language sql security definer
set search_path = public, api as $$
  select public.set_group_mute(api.current_uid(), p_group, p_on);
$$;

create or replace function api.clear_group_mute(p_group uuid)
returns jsonb language sql security definer
set search_path = public, api as $$
  select public.set_group_mute(api.current_uid(), p_group, null);
$$;

revoke execute on function set_global_mute(uuid, boolean) from public, anon, authenticated;
revoke execute on function set_group_mute(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function api.set_global_mute(boolean) to authenticated;
grant execute on function api.set_group_mute(uuid, boolean) to authenticated;
grant execute on function api.clear_group_mute(uuid) to authenticated;

do $do$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on all functions in schema public to service_role;
  end if;
end
$do$;
