-- Serialized enforcement of the 4-active-member cap and the bidirectional
-- block co-placement bar. Neither can be a plain declarative constraint:
-- two concurrent inserts each see 3 members and both commit. The trigger
-- takes a per-group advisory transaction lock so joins to one group are
-- serialized; the count is then race-free.
--
-- This is a backstop as well as the primary guard: every join path
-- (invite/link/code redemption, waitlist promotion) goes through an
-- INSERT on memberships and therefore through this trigger.

create or replace function enforce_membership_rules() returns trigger
language plpgsql as $$
declare
  active_count int;
begin
  if new.left_at is not null then
    return new; -- historical row, nothing to enforce
  end if;

  -- Serialize concurrent joins to this group.
  perform pg_advisory_xact_lock(hashtextextended(new.group_id::text, 42));

  select count(*) into active_count
  from memberships
  where group_id = new.group_id and left_at is null;

  if active_count >= 4 then
    raise exception 'group_full' using errcode = 'P0001';
  end if;

  -- v3: co-placement barred in BOTH directions — the joiner may neither
  -- have blocked, nor be blocked by, any active member.
  if exists (
    select 1
    from memberships m
    join blocks b
      on (b.blocker_id = new.user_id and b.blocked_id = m.user_id)
      or (b.blocked_id = new.user_id and b.blocker_id = m.user_id)
    where m.group_id = new.group_id and m.left_at is null
  ) then
    raise exception 'blocked_coplacement' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create trigger memberships_enforce
  before insert on memberships
  for each row execute function enforce_membership_rules();
