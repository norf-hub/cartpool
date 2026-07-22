-- 0011: Monetization change (spec v3.1 amendment).
--
-- OLD: $5 / 3-month auto-renewing subscription for >3 groups.
-- NEW: every account gets unlimited groups for 3 months from creation
--      (trial_ends_at, set at signup). After that, holding more than the 3
--      free groups requires a one-time $10 lifetime purchase
--      (entitlement_active becomes permanent once granted).
--
-- Consequences:
--   * No renewals, expirations, cancellations, or billing grace periods.
--     handle_entitlement_event shrinks to purchase + refund.
--   * in_grace_period is dropped (store billing-retry no longer applies to a
--     one-time purchase).
--   * Trial expiry is enforced server-side by expire_trials() (pg_cron,
--     daily), which funnels over-limit users into the existing
--     frozen_read_only -> choose_kept_groups downgrade flow. That machinery
--     is unchanged.
--   * "Entitled" everywhere now means: paid OR still in trial. The three
--     free-tier limit checks (create_group, redeem_invite, promote_waitlist)
--     switch to the shared is_entitled() helper.

-------------------------------------------------------------------------------
-- 1. Schema
-------------------------------------------------------------------------------

alter table subscriptions
  add column trial_ends_at timestamptz not null
    default (now() + interval '3 months');

alter table subscriptions drop column in_grace_period;

-------------------------------------------------------------------------------
-- 2. Shared entitlement predicate
-------------------------------------------------------------------------------

-- Paid (lifetime) or still inside the signup trial. Missing row = not
-- entitled (create_user always inserts one, so this is belt-and-braces).
create or replace function is_entitled(p_user uuid)
returns boolean language sql stable as $$
  select coalesce((
    select s.entitlement_active or s.trial_ends_at > now()
    from subscriptions s where s.user_id = p_user
  ), false);
$$;

-------------------------------------------------------------------------------
-- 3. can_write: same freeze scope, trial-aware entitlement
-------------------------------------------------------------------------------

-- v3 freeze scope unchanged: while frozen_read_only, read-only EVERYWHERE.
-- After the pick, only groups outside kept_group_ids stay read-only while
-- unentitled. (kept_group_ids can only be set after a freeze, and a freeze
-- can only happen after trial end, so the trial term here just keeps the
-- predicate honest.)
create or replace function can_write(p_user uuid, p_group uuid)
returns boolean language sql stable as $$
  select coalesce((
    select case
      when s.frozen_read_only then false
      when not (s.entitlement_active or s.trial_ends_at > now())
           and s.kept_group_ids is not null
           and not (p_group = any (s.kept_group_ids)) then false
      else true
    end
    from subscriptions s where s.user_id = p_user
  ), true);
$$;

-------------------------------------------------------------------------------
-- 4. Free-tier limit checks -> is_entitled()
-------------------------------------------------------------------------------

-- Free tier: 3 groups (solo group included). Beyond that needs the trial or
-- the one-time cartpool_unlimited purchase.
create or replace function create_group(p_user uuid)
returns jsonb language plpgsql as $$
declare
  v_group uuid;
begin
  if active_group_count(p_user) >= 3 and not is_entitled(p_user) then
    return jsonb_build_object('ok', false, 'error', 'group_limit');
  end if;
  v_group := create_solo_group(p_user);
  return jsonb_build_object('ok', true, 'group_id', v_group);
end;
$$;

-- Redemption covers all invite channels (phone, email, link/code) — a full
-- group waitlists the joiner; validation is server-side only.
-- (Body identical to 0003 except the entitlement check.)
create or replace function redeem_invite(p_code text, p_user uuid)
returns jsonb language plpgsql as $$
declare
  inv invites%rowtype;
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

  if v_solo is null
     and active_group_count(p_user) >= 3
     and not is_entitled(p_user) then
    return jsonb_build_object('ok', false, 'error', 'group_limit');
  end if;

  insert into memberships (group_id, user_id) values (inv.group_id, p_user);

  if v_solo is not null then
    perform do_solo_merge(p_user, v_solo, inv.group_id);
  end if;

  return jsonb_build_object('ok', true, 'joined', true, 'group_id', inv.group_id);
end;
$$;

-- Promote the first eligible waitlist entry (FCFS by requested_at, ties by
-- insertion order). Skip rules unchanged from 0003; the free-tier limit at
-- promotion time now respects the trial via is_entitled().
create or replace function promote_waitlist(p_group uuid)
returns uuid language plpgsql as $$
declare
  e record;
  v_solo uuid;
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
    if v_solo is null
       and active_group_count(e.user_id) >= 3
       and not is_entitled(e.user_id) then
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

-------------------------------------------------------------------------------
-- 5. Entitlement lifecycle: purchase + refund only
-------------------------------------------------------------------------------

-- One-time purchase model. RevenueCat reports non-subscription purchases as
-- NON_RENEWING_PURCHASE; INITIAL_PURCHASE is accepted too for robustness.
-- Purchase clears any freeze / pick without a re-pick. REFUND revokes; the
-- downgrade flow triggers only if the user is genuinely unentitled afterwards
-- (a refund during the trial leaves the trial intact) and over the limit.
create or replace function handle_entitlement_event(p_user uuid, p_event text)
returns jsonb language plpgsql as $$
begin
  case upper(p_event)
    when 'INITIAL_PURCHASE', 'NON_RENEWING_PURCHASE' then
      update subscriptions
      set entitlement_active = true,
          frozen_read_only = false, kept_group_ids = null, updated_at = now()
      where user_id = p_user;
    when 'REFUND' then
      update subscriptions
      set entitlement_active = false, updated_at = now()
      where user_id = p_user;
      if not is_entitled(p_user) and active_group_count(p_user) > 3 then
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

-------------------------------------------------------------------------------
-- 6. Trial expiry (run from pg_cron, like purge_retention)
-------------------------------------------------------------------------------

-- Freeze users whose trial has ended, who haven't paid, and who hold more
-- than 3 groups. Users who already went through the pick (kept_group_ids
-- set) are not re-frozen; users at or under the limit are untouched — the
-- limit checks above simply start applying to them. Returns the number of
-- users frozen (observability + tests).
create or replace function expire_trials()
returns int language plpgsql as $$
declare
  v_count int;
begin
  update subscriptions s
  set frozen_read_only = true, updated_at = now()
  where s.trial_ends_at < now()
    and not s.entitlement_active
    and not s.frozen_read_only
    and s.kept_group_ids is null
    and active_group_count(s.user_id) > 3;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Same guarded scheduling pattern as 0005: pg_cron on Supabase, NOTICE on
-- bare Postgres (tests call expire_trials() directly).
do $do$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule(
      'cartpool-trial-expiry',
      '23 3 * * *',
      'select public.expire_trials()'
    );
  else
    raise notice 'pg_cron unavailable — schedule public.expire_trials() with an external scheduler';
  end if;
exception when others then
  raise notice 'pg_cron scheduling skipped: %', sqlerrm;
end
$do$;
