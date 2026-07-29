-- Purchase notifications (spec §6): tell the person an item was bought FOR
-- that someone has bought it.
--
-- send-push has existed since 0006 and nothing has ever invoked it, so no
-- notification could ever fire. For a SHARED list that is not a missing
-- feature but the missing value proposition: without it, "I'll add it and
-- Rosa will see it" degrades to "I'll add it and then text Rosa to go look",
-- at which point the group may as well use the text thread.
--
-- Two things are decided here rather than in the edge function:
--
--   * WHO gets notified. send-push fanned out to every active member of the
--     item's group_id, which is stale as of v3.3 (0013): group_id is now
--     provenance only, and an item belongs to its ADDER. The person who needs
--     to know is the one whose groceries somebody else is holding — the same
--     signal the "To pick up" section is built on. Notifying the rest of the
--     group tells four people about a transaction between two of them.
--
--   * WHETHER they are muted. The §6 rules (per-group override beating the
--     global toggle) are correctness, and the test suite runs against real
--     Postgres — so they belong where they can be proven, not in a Deno
--     function no test touches.
--
-- The edge function is left as the dumb sender: tokens in, Expo request out.

-------------------------------------------------------------------------------
-- 1. The decision, as a pure function.
-------------------------------------------------------------------------------

-- Null means "notify nobody", which is a normal outcome, not an error:
-- the item isn't purchased, the adder bought it themselves, or they're muted.
-- Returning the whole payload (rather than just a user id) keeps the edge
-- function from re-deriving anything and lets the tests assert the exact
-- wording a user will see.
create or replace function purchase_notice(p_item uuid)
returns jsonb language sql stable as $$
  select case
    -- Not a purchase to announce.
    when i.status <> 'purchased' or i.purchased_by is null then null
    -- Checking off your own item is the normal solo flow (v3 §4). Telling you
    -- about something you just did yourself is noise.
    when i.purchased_by = i.added_by then null
    -- §6: the per-group override wins when set; null falls through to global.
    when coalesce(m.mute_override, u.global_mute) then null
    else jsonb_build_object(
      'item_id',   i.id,
      -- The recipient: the adder, NOT the group (v3.3).
      'user_id',   i.added_by,
      -- Provenance only, but it is the §4.2 stacking key: the OS collapses
      -- a Costco run into one per-group stack via channelId / APNs thread-id.
      'group_id',  i.group_id,
      'buyer_id',  i.purchased_by,
      'item_text', i.text,
      'title',     'Cartpool',
      'body',      coalesce(b.display_name, 'Someone') || ' bought ' || i.text
    )
  end
  from items i
  join users u on u.id = i.added_by
  left join users b on b.id = i.purchased_by
  -- Left join: an adder whose item was re-homed out of a group they have
  -- since left has no membership row here, and should follow their global
  -- setting rather than drop out of the result entirely.
  left join memberships m
    on m.user_id = i.added_by
   and m.group_id = i.group_id
   and m.left_at is null
  where i.id = p_item;
$$;

revoke execute on function purchase_notice(uuid) from public, anon, authenticated;

-------------------------------------------------------------------------------
-- 2. Delivery.
-------------------------------------------------------------------------------

-- pg_net queues the request and returns immediately, so the buyer's tap is
-- never waiting on Expo. Guarded exactly like pg_cron in 0005/0011: absent on
-- bare Postgres (CI/tests), where the notice is the point.
do $do$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net;
  else
    raise notice 'pg_net unavailable — purchase notifications will not be delivered';
  end if;
exception when others then
  raise notice 'pg_net setup skipped: %', sqlerrm;
end
$do$;

-- Endpoint and service-role key come from database settings, NOT from this
-- file — a migration is committed to git and the key is a credential. Set them
-- once per environment, out of band:
--
--   alter database postgres
--     set cartpool.push_endpoint = 'https://<ref>.supabase.co/functions/v1/send-push';
--   alter database postgres
--     set cartpool.service_role_key = '<service role key>';
--
-- Until both are set the trigger is inert, which is the correct state for
-- local dev and CI: purchases work, nothing is sent.
create or replace function notify_item_purchased()
returns trigger language plpgsql as $$
declare
  v_notice jsonb;
  v_url    text := current_setting('cartpool.push_endpoint', true);
  v_key    text := current_setting('cartpool.service_role_key', true);
begin
  v_notice := purchase_notice(new.id);
  if v_notice is null then
    return null;                       -- muted, self-purchase, nothing to say
  end if;

  if coalesce(v_url, '') = '' or coalesce(v_key, '') = '' then
    return null;                       -- unconfigured (local dev, CI)
  end if;

  -- Resolved at runtime, so this function creates cleanly on a database with
  -- no pg_net; the guard is what keeps it from ever being reached there.
  if to_regproc('net.http_post') is null then
    return null;
  end if;

  perform net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
                 'content-type', 'application/json',
                 'authorization', 'Bearer ' || v_key
               ),
    body    := v_notice
  );
  return null;
exception when others then
  -- A notification is not worth losing a purchase over. The trigger runs
  -- inside mark_purchased's transaction, so an unhandled error here would
  -- roll back the buy itself and show the shopper a failure for something
  -- that already succeeded.
  raise notice 'purchase notification skipped: %', sqlerrm;
  return null;
end;
$$;

-- `update of status` narrows the trigger to statements that touch the column;
-- the WHEN clause pins it to the actual open -> purchased transition, so
-- unmarking, re-marking and every unrelated edit stay silent.
drop trigger if exists on_item_purchased on items;
create trigger on_item_purchased
  after update of status on items
  for each row
  when (new.status = 'purchased' and old.status is distinct from 'purchased')
  execute function notify_item_purchased();

do $do$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on all functions in schema public to service_role;
  end if;
end
$do$;
