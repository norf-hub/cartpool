// Typed client wrappers for the server RPCs. These call the `api` schema
// wrappers (0004_auth.sql), which bind the acting user to auth.uid() — the
// user id is never passed from the client. Unauthenticated calls throw.
import { supabase } from "@/lib/supabase";

type Ok<T = {}> = { ok: true } & T;
type Err = {
  ok: false;
  error:
    | "already_purchased"
    | "not_a_member"
    | "not_open"
    | "not_found"
    | "read_only"
    | "not_adder"
    | "not_buyer_or_not_purchased"
    | "group_limit"
    | "expired"
    | "invalid"
    | "not_available"
    | "already_member"
    | string;
  purchased_by_name?: string;
};
export type RpcResult<T = {}> = Ok<T> | Err;

const api = () => supabase.schema("api");

async function call<T>(fn: string, args?: Record<string, unknown>): Promise<RpcResult<T>> {
  const { data, error } = await api().rpc(fn, args);
  if (error) throw error; // includes 'unauthenticated'
  return data as RpcResult<T>;
}

export const createGroup = () => call<{ group_id: string }>("create_group");
export const createInvite = (
  groupId: string,
  channel: "phone" | "email" | "link",
  target?: string
) =>
  call<{ code: string; link: string }>("create_invite", {
    p_group: groupId,
    p_channel: channel,
    p_target: target ?? null,
  });

/** Own full profile — the only way to read your own phone number/settings. */
export async function myProfile() {
  const { data, error } = await api().rpc("my_profile");
  if (error) throw error;
  return data;
}

/** Groupmate display names via api.member_profiles — never phone or email. */
export async function memberProfiles() {
  const { data, error } = await api().from("member_profiles").select("id, display_name");
  if (error) throw error;
  return data;
}

export const markPurchased = (itemId: string) =>
  call("mark_purchased", { p_item: itemId });
export const unmarkPurchased = (itemId: string) =>
  call("unmark_purchased", { p_item: itemId });
export const addItem = (groupId: string, text: string, isBulk = false, note?: string) =>
  call<{ item_id: string }>("add_item", {
    p_group: groupId,
    p_text: text,
    p_is_bulk: isBulk,
    p_bulk_note: note ?? null,
  });
export const editItemText = (itemId: string, text: string) =>
  call("edit_item_text", { p_item: itemId, p_text: text });
/** Convert an existing item to/from bulk, or edit its note (0010). */
export const setItemBulk = (itemId: string, isBulk: boolean, note?: string) =>
  call("set_item_bulk", {
    p_item: itemId,
    p_is_bulk: isBulk,
    p_bulk_note: note ?? null,
  });
export const removeItem = (itemId: string) => call("remove_item", { p_item: itemId });
export const bulkOptIn = (itemId: string) => call("bulk_opt_in", { p_item: itemId });
export const bulkAssign = (itemId: string, targetUserId: string) =>
  call("bulk_assign", { p_item: itemId, p_target: targetUserId });
export const bulkReconfirm = (itemId: string) =>
  call("bulk_reconfirm", { p_item: itemId });
export const leaveGroup = (groupId: string) => call("leave_group", { p_group: groupId });
export const blockUser = (userId: string) => call("block_user", { p_blocked: userId });
export const redeemInvite = (code: string) =>
  call<{ joined?: boolean; waitlisted?: boolean; group_id?: string }>("redeem_invite", {
    p_code: code,
  });
export const chooseKeptGroups = (groupIds: string[]) =>
  call("choose_kept_groups", { p_groups: groupIds });
export const registerPushToken = (token: string, platform: "ios" | "android") =>
  call("register_push_token", { p_token: token, p_platform: platform });
export const unregisterPushToken = (token: string) =>
  call("unregister_push_token", { p_token: token });
