-- 0012: "Up for grabs" — post surplus from an over-sized pack and let
-- groupmates claim units of it (spec v3.2 amendment).
--
-- Joe bought a 4-pack of nail clippers and needs one: he posts 3. Bill can
-- claim 1, 2, or 3 of them — claims are per-UNIT, and one person may claim
-- more than one (repeat claims accumulate). Claiming decrements
-- qty_remaining atomically (same conditional-UPDATE discipline as
-- mark_purchased), so two people racing for the last unit get exactly one
-- winner; the loser is told how many are left (possibly 0).
--
-- Deliberately non-financial, same as everywhere else: unit_price_cents is a
-- LABEL the poster chooses (null = free; at-cost and name-a-price are both
-- just a number). Money changes hands offline; nothing tracks who paid.
--
-- Offers expire 14 days after posting (claims already made stand); the
-- poster can close early. Expired/closed offers purge after a further 14
-- days via purge_retention.

-------------------------------------------------------------------------------
-- 1. Tables
-------------------------------------------------------------------------------

create table offers (
  id               uuid primary key default gen_random_uuid(),
  group_id         uuid not null references groups (id),
  posted_by        uuid not null references users (id),
  text             text not null,               -- "nail clippers"
  qty_offered      int  not null check (qty_offered > 0),  -- units up for grabs
  qty_remaining    int  not null check (qty_remaining >= 0),
  unit_price_cents int  check (unit_price_cents >= 0),     -- null = free
  created_at       timestamptz not null default now(),
  expires_at       timestamptz not null default now() + interval '14 days',
  closed_at        timestamptz,                 -- poster withdrew it early
  constraint remaining_le_offered check (qty_remaining <= qty_offered)
);

create index offers_by_group on offers (group_id) where closed_at is null;

create table offer_claims (
  id         uuid primary key default gen_random_uuid(),
  offer_id   uuid not null references offers (id) on delete cascade,
  user_id    uuid not null references users (id),
  qty        int  not null check (qty > 0),
  updated_at timestamptz not null default now(),
  unique (offer_id, user_id)  -- one row per claimer; repeat claims accumulate qty
);

-------------------------------------------------------------------------------
-- 2. Functions
-------------------------------------------------------------------------------

create or replace function create_offer(
  p_group uuid, p_user uuid, p_text text, p_qty int,
  p_unit_price_cents int default null
) returns jsonb language plpgsql as $$
declare
  v_offer uuid;
begin
  if not is_active_member(p_user, p_group) then
    return jsonb_build_object('ok', false, 'error', 'not_a_member');
  end if;
  if not can_write(p_user, p_group) then
    return jsonb_build_object('ok', false, 'error', 'read_only');
  end if;
  if p_qty is null or p_qty < 1 then
    return jsonb_build_object('ok', false, 'error', 'bad_qty');
  end if;
  if p_text is null or length(trim(p_text)) = 0 then
    return jsonb_build_object('ok', false, 'error', 'empty_text');
  end if;
  insert into offers (group_id, posted_by, text, qty_offered, qty_remaining,
                      unit_price_cents)
  values (p_group, p_user, trim(p_text), p_qty, p_qty, p_unit_price_cents)
  returning id into v_offer;
  return jsonb_build_object('ok', true, 'offer_id', v_offer);
end;
$$;

-- Claim p_qty units. The conditional UPDATE is the atomic gate: it only
-- succeeds if that many units are still unclaimed, so concurrent claims
-- serialize on the row lock and cannot oversell. A repeat claim by the same
-- user adds to their existing count (Bill takes 1 now, 2 more later).
create or replace function claim_offer(p_offer uuid, p_user uuid, p_qty int)
returns jsonb language plpgsql as $$
declare
  o offers%rowtype;
  v_remaining int;
begin
  if p_qty is null or p_qty < 1 then
    return jsonb_build_object('ok', false, 'error', 'bad_qty');
  end if;

  select * into o from offers where id = p_offer;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;
  if not is_active_member(p_user, o.group_id) then
    return jsonb_build_object('ok', false, 'error', 'not_a_member');
  end if;
  if not can_write(p_user, o.group_id) then
    return jsonb_build_object('ok', false, 'error', 'read_only');
  end if;
  if o.posted_by = p_user then
    return jsonb_build_object('ok', false, 'error', 'own_offer');
  end if;
  if o.closed_at is not null then
    return jsonb_build_object('ok', false, 'error', 'closed');
  end if;
  if o.expires_at < now() then
    return jsonb_build_object('ok', false, 'error', 'expired');
  end if;

  -- The atomic gate. Re-checks closed/expired inside the UPDATE so a close
  -- or expiry racing with this claim can't slip through.
  update offers
  set qty_remaining = qty_remaining - p_qty
  where id = p_offer
    and qty_remaining >= p_qty
    and closed_at is null
    and expires_at >= now()
  returning qty_remaining into v_remaining;

  if not found then
    select qty_remaining into v_remaining from offers where id = p_offer;
    return jsonb_build_object('ok', false, 'error', 'not_enough_left',
                              'qty_remaining', coalesce(v_remaining, 0));
  end if;

  insert into offer_claims (offer_id, user_id, qty)
  values (p_offer, p_user, p_qty)
  on conflict (offer_id, user_id)
  do update set qty = offer_claims.qty + excluded.qty, updated_at = now();

  return jsonb_build_object('ok', true, 'qty_remaining', v_remaining);
end;
$$;

-- Give back p_qty units (null = the caller's whole claim). Open offers only —
-- once the offer is closed or expired, existing claims stand as the record of
-- who's taking what.
create or replace function unclaim_offer(
  p_offer uuid, p_user uuid, p_qty int default null
) returns jsonb language plpgsql as $$
declare
  o offers%rowtype;
  v_claim offer_claims%rowtype;
  v_give int;
begin
  select * into o from offers where id = p_offer;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;
  if o.closed_at is not null or o.expires_at < now() then
    return jsonb_build_object('ok', false, 'error', 'closed');
  end if;

  select * into v_claim from offer_claims
  where offer_id = p_offer and user_id = p_user;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'no_claim');
  end if;

  v_give := coalesce(p_qty, v_claim.qty);
  if v_give < 1 or v_give > v_claim.qty then
    return jsonb_build_object('ok', false, 'error', 'bad_qty');
  end if;

  -- Guarded partial-then-full release: exactly one path succeeds, and only
  -- if the claim still holds enough units — a concurrent unclaim by the same
  -- user can't double-restore.
  update offer_claims set qty = qty - v_give, updated_at = now()
  where id = v_claim.id and qty > v_give;
  if not found then
    delete from offer_claims where id = v_claim.id and qty = v_give;
    if not found then
      return jsonb_build_object('ok', false, 'error', 'bad_qty');
    end if;
  end if;

  update offers set qty_remaining = qty_remaining + v_give
  where id = p_offer;

  return jsonb_build_object('ok', true);
end;
$$;

-- Poster withdraws the offer. Existing claims stand.
create or replace function close_offer(p_offer uuid, p_user uuid)
returns jsonb language plpgsql as $$
begin
  update offers set closed_at = now()
  where id = p_offer and posted_by = p_user and closed_at is null;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_poster_or_closed');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-------------------------------------------------------------------------------
-- 3. Leaving a group: offers housekeeping
-------------------------------------------------------------------------------

-- Body identical to 0003 plus two offer rules:
--   * the leaver's open offers close (the person holding the goods is gone);
--   * the leaver's claims on still-open offers are released back.
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

  -- Open items the leaver added vanish for everyone.
  delete from items
  where group_id = p_group and added_by = p_user and status = 'open';

  -- Purchased items the leaver added survive 2 days (name intact) so the
  -- buyer isn't left holding an untracked, unpaid item.
  update items set source_left_at = now()
  where group_id = p_group and added_by = p_user and status = 'purchased';

  -- Offers (v3.2): close the leaver's open offers; release their claims on
  -- other members' still-open offers.
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
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

-------------------------------------------------------------------------------
-- 4. Retention: purge dead offers after 14 days
-------------------------------------------------------------------------------

-- Body identical to 0003 plus the offers rule (claims cascade).
create or replace function purge_retention()
returns void language plpgsql as $$
begin
  delete from items
  where status = 'removed' and removed_at < now() - interval '14 days';
  delete from invites
  where expires_at < now() - interval '14 days'
     or (revoked_at is not null and revoked_at < now() - interval '14 days');
  delete from items
  where source_left_at is not null
    and source_left_at < now() - interval '2 days';
  -- Offers: gone 14 days after closing or expiring, whichever came first.
  delete from offers
  where least(coalesce(closed_at, 'infinity'), expires_at)
        < now() - interval '14 days';
end;
$$;

-------------------------------------------------------------------------------
-- 5. RLS: read-only visibility for group members; writes via functions only
-------------------------------------------------------------------------------

alter table offers enable row level security;
alter table offer_claims enable row level security;

grant select on public.offers to authenticated;
create policy offers_select on offers for select to authenticated
  using (user_in_group(group_id));

grant select on public.offer_claims to authenticated;
create policy offer_claims_select on offer_claims for select to authenticated
  using (exists (select 1 from offers o
                 where o.id = offer_claims.offer_id and user_in_group(o.group_id)));

-------------------------------------------------------------------------------
-- 6. api wrappers (0004 pattern: identity bound to auth.uid())
-------------------------------------------------------------------------------

create or replace function api.create_offer(
  p_group uuid, p_text text, p_qty int, p_unit_price_cents int default null
) returns jsonb language sql security definer
set search_path = public, api as $$
  select public.create_offer(p_group, api.current_uid(), p_text, p_qty,
                             p_unit_price_cents);
$$;

create or replace function api.claim_offer(p_offer uuid, p_qty int)
returns jsonb language sql security definer
set search_path = public, api as $$
  select public.claim_offer(p_offer, api.current_uid(), p_qty);
$$;

create or replace function api.unclaim_offer(p_offer uuid, p_qty int default null)
returns jsonb language sql security definer
set search_path = public, api as $$
  select public.unclaim_offer(p_offer, api.current_uid(), p_qty);
$$;

create or replace function api.close_offer(p_offer uuid)
returns jsonb language sql security definer
set search_path = public, api as $$
  select public.close_offer(p_offer, api.current_uid());
$$;

grant execute on function api.create_offer(uuid, text, int, int) to authenticated;
grant execute on function api.claim_offer(uuid, int) to authenticated;
grant execute on function api.unclaim_offer(uuid, int) to authenticated;
grant execute on function api.close_offer(uuid) to authenticated;

-------------------------------------------------------------------------------
-- 7. Realtime (guarded like 0007/0009; liveness, not correctness)
-------------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public'
        and tablename = 'offers'
    ) then
      alter publication supabase_realtime add table public.offers;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public'
        and tablename = 'offer_claims'
    ) then
      alter publication supabase_realtime add table public.offer_claims;
    end if;
  else
    raise notice 'supabase_realtime publication not found; skipping (bare Postgres)';
  end if;
end $$;
