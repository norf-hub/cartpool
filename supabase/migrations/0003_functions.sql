-- Core state-transition logic, exposed as Postgres functions (Supabase RPCs).
--
-- Testability note: these functions take the acting user as an explicit
-- parameter so the Section 6 suite can exercise them against bare Postgres
-- (no GoTrue). In production each is wrapped by a thin SECURITY DEFINER RPC
-- that binds the parameter to auth.uid() — clients can never pass an
-- arbitrary user id. Mutating results are jsonb: { ok, ... } or
-- { ok:false, error: '<typed_code>', ... }.

-------------------------------------------------------------------------------
-- Helpers
-------------------------------------------------------------------------------

create or replace function is_active_member(p_user uuid, p_group uuid)
returns boolean language sql stable as $$
  select exists (
    select 1 from memberships
    where group_id = p_group and user_id = p_user and left_at is null
  );
$$;

create or replace function active_group_count(p_user uuid)
returns int language sql stable as $$
  select count(*)::int
  from memberships m
  join groups g on g.id = m.group_id
  where m.user_id = p_user and m.left_at is null and g.deleted_at is null;
$$;

-- v3 freeze scope: while frozen_read_only, the user is read-only EVERYWHERE.
-- After they choose their 3 keepers (frozen lifts), only excess groups —
-- those outside kept_group_ids while unentitled — stay read-only.
create or replace function can_write(p_user uuid, p_group uuid)
returns boolean language sql stable as $$
  select coalesce((
    select case
      when s.frozen_read_only then false
      when not s.entitlement_active
           and s.kept_group_ids is not null
           and not (p_group = any (s.kept_group_ids)) then false
      else true
    end
    from subscriptions s where s.user_id = p_user
  ), true);
$$;

create or replace function create_solo_group(p_user uuid)
returns uuid language plpgsql as $$
declare
  v_group uuid;
begin
  insert into groups default values returning id into v_group;
  insert into memberships (group_id, user_id) values (v_group, p_user);
  return v_group;
end;
$$;

-- Signup: the personal solo list is a real one-member group from day one (v3)
-- and counts as one of the 3 free groups.
-- p_id lets the auth.users signup trigger (0006) provision with the auth id,
-- so users.id = auth.uid(); tests omit it and get a generated id.
create or replace function create_user(p_phone text, p_display_name text, p_id uuid default null)
returns uuid language plpgsql as $$
declare
  v_user uuid;
begin
  insert into users (id, phone_number, display_name)
  values (coalesce(p_id, gen_random_uuid()), p_phone, p_display_name)
  returning id into v_user;
  insert into subscriptions (user_id) values (v_user);
  perform create_solo_group(v_user);
  return v_user;
end;
$$;

-- Free tier: 3 groups (solo group included). Creating beyond that needs the
-- cartpool_unlimited entitlement.
create or replace function create_group(p_user uuid)
returns jsonb language plpgsql as $$
declare
  v_entitled boolean;
  v_group uuid;
begin
  select entitlement_active into v_entitled from subscriptions where user_id = p_user;
  if active_group_count(p_user) >= 3 and not coalesce(v_entitled, false) then
    return jsonb_build_object('ok', false, 'error', 'group_limit');
  end if;
  v_group := create_solo_group(p_user);
  return jsonb_build_object('ok', true, 'group_id', v_group);
end;
$$;

-------------------------------------------------------------------------------
-- Items
-------------------------------------------------------------------------------

create or replace function add_item(
  p_group uuid, p_user uuid, p_text text,
  p_is_bulk boolean default false, p_bulk_note text default null
) returns jsonb language plpgsql as $$
declare
  v_item uuid;
begin
  if not is_active_member(p_user, p_group) then
    return jsonb_build_object('ok', false, 'error', 'not_a_member');
  end if;
  if not can_write(p_user, p_group) then
    return jsonb_build_object('ok', false, 'error', 'read_only');
  end if;
  insert into items (group_id, added_by, text, is_bulk, bulk_note)
  values (p_group, p_user, p_text, p_is_bulk, p_bulk_note)
  returning id into v_item;
  return jsonb_build_object('ok', true, 'item_id', v_item);
end;
$$;

-- The purchase race: a single atomic conditional UPDATE. Exactly one
-- concurrent caller wins; the loser gets a typed "already purchased by
-- {name}" result, never a duplicate write.
-- v3: no adder restriction — buying/checking off your own item is normal.
create or replace function mark_purchased(p_item uuid, p_user uuid)
returns jsonb language plpgsql as $$
declare
  v_group uuid;
  v_status item_status;
  v_buyer uuid;
  v_buyer_name text;
begin
  update items i
  set status = 'purchased', purchased_by = p_user, purchased_at = now()
  where i.id = p_item
    and i.status = 'open'
    and is_active_member(p_user, i.group_id)
    and can_write(p_user, i.group_id)
  returning i.group_id into v_group;

  if found then
    return jsonb_build_object('ok', true);
  end if;

  -- Lost or ineligible: report why, typed.
  select status, purchased_by, group_id into v_status, v_buyer, v_group
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
  if not is_active_member(p_user, v_group) then
    return jsonb_build_object('ok', false, 'error', 'not_a_member');
  end if;
  if not can_write(p_user, v_group) then
    return jsonb_build_object('ok', false, 'error', 'read_only');
  end if;
  return jsonb_build_object('ok', false, 'error', 'not_open');
end;
$$;

-- Only the original buyer can revert a purchase.
create or replace function unmark_purchased(p_item uuid, p_user uuid)
returns jsonb language plpgsql as $$
begin
  update items
  set status = 'open', purchased_by = null, purchased_at = null
  where id = p_item and status = 'purchased' and purchased_by = p_user;
  if found then
    return jsonb_build_object('ok', true);
  end if;
  return jsonb_build_object('ok', false, 'error', 'not_buyer_or_not_purchased');
end;
$$;

-- Only the adder may edit. Editing a bulk item's text invalidates existing
-- pre-commits: those opt-ins must be reconfirmed.
create or replace function edit_item_text(p_item uuid, p_user uuid, p_text text)
returns jsonb language plpgsql as $$
declare
  v_is_bulk boolean;
  v_flagged int;
begin
  update items set text = p_text
  where id = p_item and added_by = p_user and status <> 'removed'
  returning is_bulk into v_is_bulk;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_adder');
  end if;
  if v_is_bulk then
    update bulk_opt_ins
    set needs_reconfirmation = true
    where item_id = p_item and committed_before_purchase;
    get diagnostics v_flagged = row_count;
    if v_flagged > 0 then
      update items set bulk_needs_reconfirm = true where id = p_item;
    end if;
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function remove_item(p_item uuid, p_user uuid)
returns jsonb language plpgsql as $$
begin
  update items set status = 'removed', removed_at = now()
  where id = p_item and added_by = p_user and status <> 'removed';
  if found then
    return jsonb_build_object('ok', true);
  end if;
  return jsonb_build_object('ok', false, 'error', 'not_adder_or_removed');
end;
$$;

-------------------------------------------------------------------------------
-- Bulk opt-ins
-------------------------------------------------------------------------------

-- Self opt-in: pre-commit while open, or opt into an already-purchased item.
create or replace function bulk_opt_in(p_item uuid, p_user uuid)
returns jsonb language plpgsql as $$
declare
  v_item items%rowtype;
begin
  select * into v_item from items where id = p_item;
  if not found or not v_item.is_bulk or v_item.status = 'removed' then
    return jsonb_build_object('ok', false, 'error', 'not_a_bulk_item');
  end if;
  if not is_active_member(p_user, v_item.group_id) then
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

-- The buyer retroactively assigns someone to a bulk item already purchased.
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
  if not is_active_member(p_target, v_item.group_id) then
    return jsonb_build_object('ok', false, 'error', 'target_not_a_member');
  end if;
  insert into bulk_opt_ins (item_id, user_id, committed_before_purchase)
  values (p_item, p_target, false)
  on conflict (item_id, user_id) do nothing;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function bulk_reconfirm(p_item uuid, p_user uuid)
returns jsonb language plpgsql as $$
begin
  update bulk_opt_ins set needs_reconfirmation = false
  where item_id = p_item and user_id = p_user and needs_reconfirmation;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'nothing_to_reconfirm');
  end if;
  update items set bulk_needs_reconfirm = false
  where id = p_item and not exists (
    select 1 from bulk_opt_ins
    where item_id = p_item and needs_reconfirmation
  );
  return jsonb_build_object('ok', true);
end;
$$;

-------------------------------------------------------------------------------
-- Leaving, waitlist promotion, blocking
-------------------------------------------------------------------------------

-- The joiner's solo group, if the v3 first-join merge applies: it must be
-- their ONLY active group and contain only them.
create or replace function mergeable_solo(p_user uuid)
returns uuid language sql stable as $$
  select m.group_id
  from memberships m
  join groups g on g.id = m.group_id
  where m.user_id = p_user and m.left_at is null and g.deleted_at is null
    and 1 = (select count(*) from memberships
             where group_id = m.group_id and left_at is null)
    and 1 = (select count(*) from memberships mm
             join groups gg on gg.id = mm.group_id
             where mm.user_id = p_user and mm.left_at is null
               and gg.deleted_at is null);
$$;

-- v3 first-join merge: open items move to the destination; purchased items
-- stay behind as history but get source_left_at so the 2-day grace purge
-- reaches them (they'd otherwise sit in a soft-deleted group forever); the
-- emptied solo group is soft-deleted.
create or replace function do_solo_merge(p_user uuid, p_solo uuid, p_dest uuid)
returns void language plpgsql as $$
begin
  update items set group_id = p_dest
  where group_id = p_solo and status = 'open';
  update items set source_left_at = now()
  where group_id = p_solo and status = 'purchased';
  update memberships set left_at = now()
  where group_id = p_solo and user_id = p_user and left_at is null;
  update groups set deleted_at = now() where id = p_solo;
end;
$$;

-- Promote the first eligible waitlist entry (FCFS by requested_at, ties by
-- insertion order). Skipped in favor of the next eligible entry:
--   * entries whose promotion would co-place a blocked pair, in either
--     direction (v3);
--   * free-tier users already at the 3-group limit — the limit applies at
--     promotion time too, not just at redemption (a mergeable solo group
--     doesn't count, same as redeem_invite). Skipped entries stay queued.
create or replace function promote_waitlist(p_group uuid)
returns uuid language plpgsql as $$
declare
  e record;
  v_solo uuid;
  v_entitled boolean;
begin
  for e in
    select * from waitlist_entries
    where group_id = p_group and promoted_at is null
    order by requested_at, seq
  loop
    if (select count(*) from memberships
        where group_id = p_group and left_at is null) >= 4 then
      return null; -- no open slot
    end if;

    -- v3 bidirectional co-placement bar.
    if exists (
      select 1
      from memberships m
      join blocks b
        on (b.blocker_id = e.user_id and b.blocked_id = m.user_id)
        or (b.blocked_id = e.user_id and b.blocker_id = m.user_id)
      where m.group_id = p_group and m.left_at is null
    ) then
      continue;
    end if;

    -- Free-tier limit at promotion time.
    v_solo := mergeable_solo(e.user_id);
    select entitlement_active into v_entitled
    from subscriptions where user_id = e.user_id;
    if v_solo is null
       and active_group_count(e.user_id) >= 3
       and not coalesce(v_entitled, false) then
      continue;
    end if;

    begin
      insert into memberships (group_id, user_id) values (p_group, e.user_id);
    exception
      when unique_violation then continue; -- already active somehow
      when raise_exception then continue;  -- trigger backstop lost a race
                                           -- (group_full / blocked_coplacement)
    end;

    if v_solo is not null then
      perform do_solo_merge(e.user_id, v_solo, p_group);
    end if;

    update waitlist_entries set promoted_at = now() where id = e.id;
    return e.user_id; -- caller sends "A spot opened in {group} — you're in!"
  end loop;
  return null;
end;
$$;

-- Leaving: open items vanish; purchased items enter the 2-day grace window;
-- an emptied group is soft-deleted; a freed slot promotes the waitlist.
-- v3: a user always has at least one group — leaving the last one recreates
-- a fresh solo group.
create or replace function leave_group(p_group uuid, p_user uuid)
returns jsonb language plpgsql as $$
declare
  v_remaining int;
begin
  update memberships set left_at = now()
  where group_id = p_group and user_id = p_user and left_at is null;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_a_member');
  end if;

  -- Open items the leaver added vanish for everyone.
  delete from items
  where group_id = p_group and added_by = p_user and status = 'open';

  -- Purchased items the leaver added survive 2 days (name intact) so the
  -- buyer isn't left holding an untracked, unpaid item.
  update items set source_left_at = now()
  where group_id = p_group and added_by = p_user and status = 'purchased';

  select count(*) into v_remaining
  from memberships where group_id = p_group and left_at is null;

  if v_remaining = 0 then
    update groups set deleted_at = now() where id = p_group;
  else
    perform promote_waitlist(p_group);
  end if;

  if active_group_count(p_user) = 0 then
    perform create_solo_group(p_user);
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

-- A blocks B: A leaves every shared group (normal vanish rules). B is not
-- removed and never notified. From then on, co-placement is barred in both
-- directions (enforced at every entry point + the membership trigger).
create or replace function block_user(p_blocker uuid, p_blocked uuid)
returns jsonb language plpgsql as $$
declare
  g record;
begin
  if p_blocker = p_blocked then
    return jsonb_build_object('ok', false, 'error', 'cannot_block_self');
  end if;
  insert into blocks (blocker_id, blocked_id) values (p_blocker, p_blocked)
  on conflict (blocker_id, blocked_id) do nothing;

  for g in
    select ma.group_id
    from memberships ma
    join memberships mb on mb.group_id = ma.group_id
    join groups grp on grp.id = ma.group_id
    where ma.user_id = p_blocker and ma.left_at is null
      and mb.user_id = p_blocked and mb.left_at is null
      and grp.deleted_at is null
  loop
    perform leave_group(g.group_id, p_blocker);
  end loop;

  return jsonb_build_object('ok', true);
end;
$$;

-------------------------------------------------------------------------------
-- Invites
-------------------------------------------------------------------------------

create or replace function create_invite(
  p_group uuid, p_user uuid, p_channel invite_channel, p_target text default null
) returns jsonb language plpgsql as $$
declare
  v_code text;
  v_bytes bytea;
  i int;
begin
  if not is_active_member(p_user, p_group) then
    return jsonb_build_object('ok', false, 'error', 'not_a_member');
  end if;
  -- 8 chars, base32 minus ambiguous 0/O/1/I. gen_random_bytes (CSPRNG), not
  -- random() — codes must not be predictable. Retry on the rare collision
  -- with the unique index instead of surfacing it as an error.
  loop
    v_bytes := gen_random_bytes(8);
    v_code := '';
    for i in 0..7 loop
      v_code := v_code || substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
                                 1 + (get_byte(v_bytes, i) & 31), 1);
    end loop;
    begin
      insert into invites (group_id, code, channel, target)
      values (p_group, v_code, p_channel, p_target);
      exit;
    exception when unique_violation then
      null; -- collision: regenerate
    end;
  end loop;
  return jsonb_build_object('ok', true, 'code', v_code,
                            'link', 'https://cartpool.app/i/' || v_code);
end;
$$;

-- Redemption covers all invite channels (phone, email, link/code) — a full
-- group waitlists the joiner; validation is server-side only.
create or replace function redeem_invite(p_code text, p_user uuid)
returns jsonb language plpgsql as $$
declare
  inv invites%rowtype;
  v_entitled boolean;
  v_active int;
  v_solo uuid;
begin
  select * into inv from invites where code = p_code;
  if not found or exists (select 1 from groups
                          where id = inv.group_id and deleted_at is not null) then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;
  if inv.revoked_at is not null or inv.expires_at < now() then
    return jsonb_build_object('ok', false, 'error', 'expired');
  end if;
  if is_active_member(p_user, inv.group_id) then
    return jsonb_build_object('ok', false, 'error', 'already_member');
  end if;

  -- v3: bidirectional co-placement bar, silently rejected.
  if exists (
    select 1
    from memberships m
    join blocks b
      on (b.blocker_id = p_user and b.blocked_id = m.user_id)
      or (b.blocked_id = p_user and b.blocker_id = m.user_id)
    where m.group_id = inv.group_id and m.left_at is null
  ) then
    return jsonb_build_object('ok', false, 'error', 'not_available');
  end if;

  -- Serialize with other joins to this group (same lock as the trigger).
  perform pg_advisory_xact_lock(hashtextextended(inv.group_id::text, 42));

  select count(*) into v_active
  from memberships where group_id = inv.group_id and left_at is null;
  if v_active >= 4 then
    insert into waitlist_entries (group_id, user_id)
    values (inv.group_id, p_user)
    on conflict (group_id, user_id) do nothing;
    return jsonb_build_object('ok', true, 'waitlisted', true);
  end if;

  -- First-invite merge (v3): if the joiner's only group is their solo group
  -- it merges into the joined group, so the free-tier count check must
  -- ignore it. Same helpers as promote_waitlist.
  v_solo := mergeable_solo(p_user);

  select entitlement_active into v_entitled
  from subscriptions where user_id = p_user;
  if v_solo is null
     and active_group_count(p_user) >= 3
     and not coalesce(v_entitled, false) then
    return jsonb_build_object('ok', false, 'error', 'group_limit');
  end if;

  insert into memberships (group_id, user_id) values (inv.group_id, p_user);

  if v_solo is not null then
    perform do_solo_merge(p_user, v_solo, inv.group_id);
  end if;

  return jsonb_build_object('ok', true, 'joined', true, 'group_id', inv.group_id);
end;
$$;

-------------------------------------------------------------------------------
-- Subscription lifecycle (RevenueCat webhook -> entitlement state)
-------------------------------------------------------------------------------

create or replace function handle_entitlement_event(p_user uuid, p_event text)
returns jsonb language plpgsql as $$
begin
  case upper(p_event)
    when 'INITIAL_PURCHASE', 'RENEWAL', 'UNCANCELLATION' then
      -- Restoring entitlement clears the freeze without a re-pick.
      update subscriptions
      set entitlement_active = true, in_grace_period = false,
          frozen_read_only = false, kept_group_ids = null, updated_at = now()
      where user_id = p_user;
    when 'BILLING_ISSUE' then
      -- Store retry window (~16-21 days): no entitlement loss, no downgrade.
      update subscriptions
      set in_grace_period = true, updated_at = now()
      where user_id = p_user;
    when 'EXPIRATION', 'CANCELLATION', 'REFUND' then
      update subscriptions
      set entitlement_active = false, in_grace_period = false, updated_at = now()
      where user_id = p_user;
      -- Only actual entitlement loss triggers the downgrade flow, and only
      -- when over the free limit.
      if active_group_count(p_user) > 3 then
        update subscriptions
        set frozen_read_only = true, updated_at = now()
        where user_id = p_user;
      end if;
    else
      return jsonb_build_object('ok', false, 'error', 'unknown_event');
  end case;
  return jsonb_build_object('ok', true);
end;
$$;

-- The required "Keep these 3" selection. Until this succeeds the user is
-- read-only everywhere (v3); afterwards only the excess groups stay frozen.
create or replace function choose_kept_groups(p_user uuid, p_groups uuid[])
returns jsonb language plpgsql as $$
declare
  v_frozen boolean;
  g uuid;
begin
  select frozen_read_only into v_frozen
  from subscriptions where user_id = p_user;
  if not coalesce(v_frozen, false) then
    return jsonb_build_object('ok', false, 'error', 'not_frozen');
  end if;
  if p_groups is null
     or (select count(distinct x) from unnest(p_groups) x) <> 3 then
    return jsonb_build_object('ok', false, 'error', 'must_pick_exactly_3');
  end if;
  foreach g in array p_groups loop
    if not is_active_member(p_user, g) then
      return jsonb_build_object('ok', false, 'error', 'not_a_member', 'group_id', g);
    end if;
  end loop;
  update subscriptions
  set kept_group_ids = p_groups, frozen_read_only = false, updated_at = now()
  where user_id = p_user;
  return jsonb_build_object('ok', true);
end;
$$;

-------------------------------------------------------------------------------
-- Retention (run from a scheduled job, e.g. pg_cron)
-------------------------------------------------------------------------------

create or replace function purge_retention()
returns void language plpgsql as $$
begin
  -- Removed items and expired invites: purged after 2 weeks.
  delete from items
  where status = 'removed' and removed_at < now() - interval '14 days';
  delete from invites
  where expires_at < now() - interval '14 days'
     or (revoked_at is not null and revoked_at < now() - interval '14 days');
  -- Grace-period purchased items from a departed member: 2 days.
  delete from items
  where source_left_at is not null
    and source_left_at < now() - interval '2 days';
end;
$$;
