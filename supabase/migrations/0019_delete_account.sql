-- Account deletion (App Store guideline 5.1.1(v): an app that creates accounts
-- must let the user delete one from inside the app).
--
-- This is a HARD delete, by product decision: the account row and everything
-- the user touched go immediately, rather than the account being anonymised
-- and its purchase history left standing. The trade-off is deliberate — a
-- groupmate who bought something for this person loses that record with no
-- settle-up window, which is a bigger erasure than leave_group performs.
--
-- Nothing referencing users(id) cascades (see 0001: memberships, items.added_by
-- NOT NULL, items.purchased_by, bulk_opt_ins, waitlist_entries, blocks,
-- subscriptions are all plain references), so every table is cleared here in
-- FK-safe order. Getting this wrong fails loudly rather than half-deleting: it
-- is one statement-level transaction, so any FK violation rolls the whole
-- thing back.
--
-- leave_group is deliberately NOT reused. It grants purchased items a 2-day
-- grace, which this policy overrides, and it recreates a solo group for anyone
-- left with none — which would resurrect an account we are erasing.

create or replace function delete_account(p_user uuid)
returns jsonb language plpgsql as $$
declare
  v_groups uuid[];
  v_group  uuid;
begin
  if not exists (select 1 from users where id = p_user) then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  -- Groups they were active in, captured before the memberships go, so the
  -- emptied-group and waitlist handling below still knows where to look.
  select coalesce(array_agg(group_id), '{}')
    into v_groups
    from memberships
   where user_id = p_user and left_at is null;

  -- Items SOMEONE ELSE added that this user had marked bought: hand them back
  -- rather than destroying another member's item. The check constraint
  -- purchased_has_buyer forbids clearing the buyer while status stays
  -- 'purchased', so status goes back to 'open' in the same statement.
  update items
     set status = 'open', purchased_by = null, purchased_at = null
   where purchased_by = p_user and added_by <> p_user;

  -- Their claims on other people's offers, then their own offers (whose
  -- claims, including other members', cascade with the offer).
  delete from offer_claims where user_id = p_user;
  delete from offers where posted_by = p_user;

  -- Their bulk opt-ins on other people's items. Opt-ins ON their items go
  -- with the items below, via bulk_opt_ins.item_id's cascade.
  delete from bulk_opt_ins where user_id = p_user;

  -- Everything they added, open or purchased.
  delete from items where added_by = p_user;

  delete from waitlist_entries where user_id = p_user;
  delete from blocks where blocker_id = p_user or blocked_id = p_user;
  delete from push_tokens where user_id = p_user;
  delete from memberships where user_id = p_user;
  delete from subscriptions where user_id = p_user;
  delete from users where id = p_user;

  -- Emptied groups are soft-deleted, matching leave_group; groups that still
  -- have members get the freed seat offered to whoever is waiting.
  foreach v_group in array v_groups loop
    if not exists (
      select 1 from memberships where group_id = v_group and left_at is null
    ) then
      update groups set deleted_at = now() where id = v_group;
    else
      perform promote_waitlist(v_group);
    end if;
  end loop;

  -- The sign-in identity itself. Without this the account could be signed into
  -- again, and the 0006 provisioning trigger only fires on INSERT, so they'd
  -- land in a session with no users row — worse than a failed delete. If this
  -- statement is not permitted the whole function rolls back, which is the
  -- outcome we want: a visible failure, not a zombie account.
  delete from auth.users where id = p_user;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function api.delete_account()
returns jsonb language sql security definer
set search_path = public, api as $$
  select public.delete_account(api.current_uid());
$$;

revoke execute on function delete_account(uuid) from public, anon, authenticated;
grant execute on function api.delete_account() to authenticated;

do $do$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on all functions in schema public to service_role;
  end if;
end
$do$;
