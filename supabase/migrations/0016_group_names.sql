-- Named groups. Until now a group's title was derived client-side from its
-- members ("With Rosa, Bill"), which is fine for a pair but useless once you
-- have several overlapping groups — "Household", "Beach trip", "Mum & Dad"
-- are what people actually call them.
--
-- name is NULLABLE by design: existing groups keep the derived member-name
-- fallback until someone renames them, so nothing changes for anyone who
-- doesn't care. The client only overrides its fallback when name is present.

alter table groups add column if not exists name text;

-- Any active member can rename a shared group — same footing as every other
-- group action in the spec (no owner/admin role exists; membership is the
-- only authority). Frozen/read-only accounts are barred via can_write, so a
-- lapsed account can't edit a group it's been told is read-only.
create or replace function rename_group(p_user uuid, p_group uuid, p_name text)
returns jsonb language plpgsql as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
begin
  if not exists (
    select 1 from memberships m
    join groups g on g.id = m.group_id
    where m.group_id = p_group and m.user_id = p_user
      and m.left_at is null and g.deleted_at is null
  ) then
    return jsonb_build_object('ok', false, 'error', 'not_a_member');
  end if;

  if not can_write(p_user, p_group) then
    return jsonb_build_object('ok', false, 'error', 'read_only');
  end if;

  if length(v_name) > 40 then
    v_name := left(v_name, 40);
  end if;

  -- Empty clears the name, restoring the member-name fallback. That's the
  -- only way back, so it's a feature rather than a validation error.
  update groups set name = nullif(v_name, '') where id = p_group;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function api.rename_group(p_group uuid, p_name text)
returns jsonb language sql security definer
set search_path = public, api as $$
  select public.rename_group(api.current_uid(), p_group, p_name);
$$;

revoke execute on function rename_group(uuid, uuid, text) from public, anon, authenticated;
grant execute on function api.rename_group(uuid, text) to authenticated;

do $do$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on all functions in schema public to service_role;
  end if;
end
$do$;
