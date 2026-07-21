-- Convert an existing item to/from bulk, and edit the bulk note (spec §5:
-- "Any item can be tagged as bulk/shared" + the free-text note field).
--
-- 0003's add_item was the only place is_bulk could ever be set, so an item
-- added normally could never become shared — you had to delete and re-add it.
--
-- Guards, in the order they're checked:
--   * adder only, matching edit_item_text (spec §4: the adder owns the item)
--   * writable group (subscription freeze, same can_write() as every mutation)
--   * removed items are not editable
--   * un-bulking is barred once anyone has opted in. Those opt-in rows would
--     otherwise be orphaned against a non-bulk item: invisible in the UI but
--     still returned by bulk_opt_in's unique conflict, so a later re-bulk
--     would silently resurrect commitments nobody re-agreed to. Clearing the
--     item's own opt-in is the adder's call to make explicitly, not a side
--     effect of a toggle.
--
-- Editing the note does NOT trigger reconfirmation. Spec §5 ties
-- reconfirmation to the item *text* changing ("the edit could change what
-- they're agreeing to"); the note is supplementary detail on an item whose
-- identity is unchanged. edit_item_text still owns that path.
create or replace function set_item_bulk(
  p_item uuid, p_user uuid, p_is_bulk boolean, p_bulk_note text default null
) returns jsonb language plpgsql as $$
declare
  v_item items%rowtype;
  v_opt_ins int;
begin
  select * into v_item from items where id = p_item;
  if not found or v_item.status = 'removed' then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if v_item.added_by <> p_user then
    return jsonb_build_object('ok', false, 'error', 'not_adder');
  end if;
  if not can_write(p_user, v_item.group_id) then
    return jsonb_build_object('ok', false, 'error', 'read_only');
  end if;

  if not p_is_bulk then
    select count(*) into v_opt_ins from bulk_opt_ins where item_id = p_item;
    if v_opt_ins > 0 then
      return jsonb_build_object('ok', false, 'error', 'has_opt_ins');
    end if;
  end if;

  update items
  set is_bulk = p_is_bulk,
      -- A non-bulk item carries no note; keep the row self-consistent.
      bulk_note = case when p_is_bulk then p_bulk_note else null end
  where id = p_item;

  return jsonb_build_object('ok', true);
end;
$$;

-- Client surface: binds the acting user to auth.uid() like every other
-- wrapper (0004_auth.sql). Grants are re-applied because 0004's blanket
-- grant ran before this function existed.
create or replace function api.set_item_bulk(
  p_item uuid, p_is_bulk boolean, p_bulk_note text default null
) returns jsonb language sql security definer
set search_path = public, api as $$
  select public.set_item_bulk(p_item, api.current_uid(), p_is_bulk, p_bulk_note);
$$;

revoke execute on function api.set_item_bulk(uuid, boolean, text) from public, anon;
grant execute on function api.set_item_bulk(uuid, boolean, text) to authenticated;
