-- Cross-group items ("one item, all groups").
--
-- Model change: an item no longer lives inside one group's list. It is a
-- single canonical row, owned by its adder, VISIBLE to everyone who shares
-- any active group with the adder. Consequences, all by construction:
--   * Adding once puts the item on the list of every group you're in — and
--     of any group you join later.
--   * The first person in ANY of the adder's groups to mark it purchased
--     clears it everywhere: there is only one row, so the existing atomic
--     conditional UPDATE still settles the race.
--   * The buyer's name travels with the item, which feeds the client's
--     "To pick up" view (your items, bought by someone else).
--
-- items.group_id remains as the item's HOME group (provenance + the 2-day
-- grace window after the adder leaves a group), but no longer gates
-- visibility of open items.

-------------------------------------------------------------------------------
-- 1. Helpers
-------------------------------------------------------------------------------

-- Do two users share any active, non-deleted group? True for p_a = p_b
-- (a membership row joins itself), so "the adder's pool" includes the adder.
create or replace function users_share_group(p_a uuid, p_b uuid)
returns boolean language sql stable as $$
  select exists (
    select 1
    from memberships a
    join memberships b on b.group_id = a.group_id
    join groups g on g.id = a.group_id
    where a.user_id = p_a and a.left_at is null
      and b.user_id = p_b and b.left_at is null
      and g.deleted_at is null
  );
$$;

-- Write-eligibility against another user's items: the pair must share at
-- least one group in which p_user can write (frozen/kept-groups rules from
-- can_write, 0003/0011). Splitting this from users_share_group keeps the
-- typed errors distinct: no shared group -> not_a_member; shared but all
-- read-only -> read_only.
create or replace function can_interact(p_user uuid, p_adder uuid)
returns boolean language sql stable as $$
  select exists (
    select 1
    from memberships a
    join memberships b on b.group_id = a.group_id
    join groups g on g.id = a.group_id
    where a.user_id = p_user and a.left_at is null
      and b.user_id = p_adder and b.left_at is null
      and g.deleted_at is null
      and can_write(p_user, a.group_id)
  );
$$;

-- The user's oldest active group — re-home target for items whose grace
-- window expired. Always exists: v3 guarantees at least a solo group.
create or replace function home_group(p_user uuid)
returns uuid language sql stable as $$
  select m.group_id
  from memberships m
  join groups g on g.id = m.group_id
  where m.user_id = p_user and m.left_at is null and g.deleted_at is null
  order by m.joined_at, m.id
  limit 1;
$$;

-------------------------------------------------------------------------------
-- 2. Purchase across groups: same atomic UPDATE, pool-scoped eligibility.
-------------------------------------------------------------------------------

create or replace function mark_purchased(p_item uuid, p_user uuid)
returns jsonb language plpgsql as $$
declare
  v_adder uuid;
  v_status item_status;
  v_buyer uuid;
  v_buyer_name text;
begin
  update items i
  set status = 'purchased', purchased_by = p_user, purchased_at = now()
  where i.id = p_item
    and i.status = 'open'
    and users_share_group(p_user, i.added_by)
    and can_interact(p_user, i.added_by)
  returning i.added_by into v_adder;

  if found then
    return jsonb_build_object('ok', true);
  end if;

  -- Lost or ineligible: report why, typed.
  select status, purchased_by, added_by into v_status, v_buyer, v_adder
  from items where id = p_item;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if v_status = 'purchased' then
    select display_name into v_buyer_name from users where id = v_buyer;
    return jsonb_build_object(
      'ok', false, 'error', 'already_purchased',
      'purchased_by', v_buyer, 'purchased_by_name', v_buyer_name
    );
  end if;
  if not users_share_group(p_user, v_adder) then
    return jsonb_build_object('ok', false, 'error', 'not_a_member');
  end if;
  if not can_interact(p_user, v_adder) then
    return jsonb_build_object('ok', false, 'error', 'read_only');
  end if;
  return jsonb_build_object('ok', false, 'error', 'not_open');
end;
$$;

-------------------------------------------------------------------------------
-- 3. Bulk opt-ins: scoped to the adder's pool instead of one group.
-------------------------------------------------------------------------------

create or replace function bulk_opt_in(p_item uuid, p_user uuid)
returns jsonb language plpgsql as $$
declare
  v_item items%rowtype;
begin
  select * into v_item from items where id = p_item;
  if not found or not v_item.is_bulk or v_item.status = 'removed' then
    return jsonb_build_object('ok', false, 'error', 'not_a_bulk_item');
  end if;
  if not users_share_group(p_user, v_item.added_by) then
    return jsonb_build_object('ok', false, 'error', 'not_a_member');
  end if;
  insert into bulk_opt_ins (item_id, user_id, committed_before_purchase)
  values (p_item, p_user, v_item.status = 'open')
  on conflict (item_id, user_id) do nothing;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'already_opted_in');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function bulk_assign(p_item uuid, p_buyer uuid, p_target uuid)
returns jsonb language plpgsql as $$
declare
  v_item items%rowtype;
begin
  select * into v_item from items where id = p_item;
  if not found or not v_item.is_bulk then
    return jsonb_build_object('ok', false, 'error', 'not_a_bulk_item');
  end if;
  if v_item.status <> 'purchased' or v_item.purchased_by <> p_buyer then
    return jsonb_build_object('ok', false, 'error', 'not_buyer');
  end if;
  if not users_share_group(p_target, v_item.added_by) then
    return jsonb_build_object('ok', false, 'error', 'target_not_a_member');
  end if;
  insert into bulk_opt_ins (item_id, user_id, committed_before_purchase)
  values (p_item, p_target, false)
  on conflict (item_id, user_id) do nothing;
  return jsonb_build_object('ok', true);
end;
$$;

-------------------------------------------------------------------------------
-- 4. Leaving a group no longer destroys the leaver's items.
--
-- The leaver's items are theirs; they stay on their own list and on the
-- lists of every group they're still in (visibility keys off shared
-- membership, so ex-groupmates simply stop seeing the open ones). Purchased
-- items keep the 2-day grace: they stay visible to the OLD group's members
-- via group_id (RLS below) so the buyer isn't left holding an untracked,
-- unpaid item — then purge re-homes them instead of deleting, so the
-- adder's own purchase history survives.
-------------------------------------------------------------------------------

create or replace function leave_group(p_group uuid, p_user uuid)
returns jsonb language plpgsql as $$
declare
  v_remaining int;
  c record;
begin
  update memberships set left_at = now()
  where group_id = p_group and user_id = p_user and left_at is null;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_a_member');
  end if;

  -- Purchased items homed here enter the grace window for the old group.
  update items set source_left_at = now()
  where group_id = p_group and added_by = p_user and status = 'purchased';

  -- Open items homed here move with their owner immediately (group_id is
  -- provenance only, but a stale home group would extend the purchased-
  -- grace read to future purchases).
  update items set group_id = coalesce(home_group(p_user), group_id)
  where group_id = p_group and added_by = p_user and status = 'open';

  -- Offers (v3.2): close the leaver's open offers; release their claims on
  -- other members' still-open offers. Carried over from 0012 — the offer
  -- lifecycle is per-group and unchanged by the cross-group item model.
  update offers set closed_at = now()
  where group_id = p_group and posted_by = p_user and closed_at is null;

  for c in
    select oc.id, oc.offer_id, oc.qty
    from offer_claims oc
    join offers o on o.id = oc.offer_id
    where oc.user_id = p_user and o.group_id = p_group
      and o.closed_at is null and o.expires_at >= now()
  loop
    delete from offer_claims where id = c.id;
    update offers set qty_remaining = qty_remaining + c.qty
    where id = c.offer_id;
  end loop;

  select count(*) into v_remaining
  from memberships where group_id = p_group and left_at is null;

  if v_remaining = 0 then
    update groups set deleted_at = now() where id = p_group;
  else
    perform promote_waitlist(p_group);
  end if;

  if active_group_count(p_user) = 0 then
    perform create_solo_group(p_user);
    -- The fresh solo group is the new home for the open items just orphaned.
    update items set group_id = home_group(p_user)
    where added_by = p_user and status = 'open' and group_id = p_group;
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

-- Grace expiry: re-home instead of delete. The old group's members lose the
-- read (group_id changes); the adder keeps their history. Deleting remains
-- only for removed-item retention.
create or replace function purge_retention()
returns void language plpgsql as $$
begin
  delete from items
  where status = 'removed' and removed_at < now() - interval '14 days';
  delete from invites
  where expires_at < now() - interval '14 days'
     or (revoked_at is not null and revoked_at < now() - interval '14 days');
  update items i
  set group_id = home_group(i.added_by), source_left_at = null
  where i.source_left_at is not null
    and i.source_left_at < now() - interval '2 days'
    and home_group(i.added_by) is not null;
  -- Adder gone entirely (no active group — cannot happen post-v3, but be
  -- safe): fall back to the old delete so grace rows can't linger forever.
  delete from items
  where source_left_at is not null
    and source_left_at < now() - interval '2 days'
    and home_group(added_by) is null;
  -- Offers (v3.2): gone 14 days after closing or expiring, whichever came
  -- first. Carried over from 0012 — dropped by an earlier 0013 rewrite.
  delete from offers
  where least(coalesce(closed_at, 'infinity'), expires_at)
        < now() - interval '14 days';
end;
$$;

-------------------------------------------------------------------------------
-- 5. RLS: visibility follows the adder's pool, not the home group.
--    Open items: anyone sharing an active group with the adder (incl. self).
--    Purchased items: additionally the home group's current members, which
--    is exactly the 2-day grace read after the adder leaves.
-------------------------------------------------------------------------------

drop policy if exists items_select on items;
create policy items_select on items for select to authenticated
  using (
    shares_group_with(added_by)
    or (status = 'purchased' and user_in_group(group_id))
  );

drop policy if exists bulk_opt_ins_select on bulk_opt_ins;
create policy bulk_opt_ins_select on bulk_opt_ins for select to authenticated
  using (exists (
    select 1 from items i
    where i.id = bulk_opt_ins.item_id
      and (shares_group_with(i.added_by)
           or (i.status = 'purchased' and user_in_group(i.group_id)))
  ));

-- Keep the new helpers unreachable from clients, same as the rest of 0003's
-- parameterized core (0004 revoked execute broadly; re-assert for these).
revoke execute on function users_share_group(uuid, uuid) from public, anon, authenticated;
revoke execute on function can_interact(uuid, uuid) from public, anon, authenticated;
revoke execute on function home_group(uuid) from public, anon, authenticated;

do $do$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on all functions in schema public to service_role;
  end if;
end
$do$;
