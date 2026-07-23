-- Persist the in-app large-text toggle (addendum §4.1). The column has been
-- on users since 0001; the You tab needs a setter so the choice survives
-- reinstalls and follows the account across devices.
--
-- Same shape as every other client mutation: a parameterized core in public
-- (unreachable by clients) and an api wrapper bound to auth.uid(). Runs
-- after 0004, whose `alter default privileges` already strips PUBLIC
-- execute from new functions; grants below are explicit.

create or replace function set_large_text(p_user uuid, p_on boolean)
returns jsonb language plpgsql as $$
begin
  update users set large_text_mode = p_on where id = p_user;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function api.set_large_text(p_on boolean)
returns jsonb language sql security definer
set search_path = public, api as $$
  select public.set_large_text(api.current_uid(), p_on);
$$;

revoke execute on function set_large_text(uuid, boolean) from public, anon, authenticated;
grant execute on function api.set_large_text(boolean) to authenticated;

do $do$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on all functions in schema public to service_role;
  end if;
end
$do$;
