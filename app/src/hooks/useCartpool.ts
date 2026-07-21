// Core-loop data: the merged list across every group the user belongs to,
// kept fresh by Supabase Realtime, plus the item actions.
//
// Reads go to the `public` schema (RLS read-only policies, 0004_auth.sql);
// every mutation goes through the `api` RPC wrappers in src/api/rpc.ts.
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import * as rpc from "@/api/rpc";
import type { RpcResult } from "@/api/rpc";

export type Item = {
  id: string;
  group_id: string;
  added_by: string;
  text: string;
  status: "open" | "purchased" | "removed";
  purchased_by: string | null;
  purchased_at: string | null;
  is_bulk: boolean;
  bulk_note: string | null;
  created_at: string;
};

export type GroupInfo = {
  id: string;
  /** Active member user ids, including me. */
  memberIds: string[];
};

export type Profile = {
  id: string;
  display_name: string;
  large_text_mode: boolean;
};

/**
 * A pending join: the group was full at redemption, so redeem_invite queued
 * the user instead (spec §3). Visible via the waitlist_select RLS policy,
 * which is scoped to the user's own rows — the queue itself is not readable.
 */
export type WaitlistEntry = {
  group_id: string;
  requested_at: string;
};

const pub = () => supabase.schema("public");

export function useCartpool(userId: string | null) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [groups, setGroups] = useState<GroupInfo[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [waitlist, setWaitlist] = useState<WaitlistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    if (!userId) return;
    try {
      // My active memberships -> my group ids.
      const { data: mine, error: e1 } = await pub()
        .from("memberships")
        .select("group_id")
        .eq("user_id", userId)
        .is("left_at", null);
      if (e1) throw e1;
      const groupIds = (mine ?? []).map((m) => m.group_id as string).sort();

      // Pending joins are for groups the user is NOT in, so this can't be
      // scoped by groupIds and must run even when they have no groups.
      // promote_waitlist stamps promoted_at rather than deleting the row, so
      // an unfiltered read would keep showing "you're on the waitlist" to
      // someone who has already been let in. Ordering matches the server's
      // FCFS key (requested_at, then seq for same-instant ties).
      const { data: queued, error: eW } = await pub()
        .from("waitlist_entries")
        .select("group_id, requested_at")
        .eq("user_id", userId)
        .is("promoted_at", null)
        .order("requested_at", { ascending: true })
        .order("seq", { ascending: true });
      if (eW) throw eW;
      setWaitlist((queued ?? []) as WaitlistEntry[]);

      if (groupIds.length === 0) {
        setGroups([]);
        setItems([]);
        return;
      }

      const [membersRes, itemsRes, profilesRes, myProfile] = await Promise.all([
        pub()
          .from("memberships")
          .select("group_id, user_id")
          .in("group_id", groupIds)
          .is("left_at", null),
        pub()
          .from("items")
          .select(
            "id, group_id, added_by, text, status, purchased_by, purchased_at, is_bulk, bulk_note, created_at"
          )
          .in("group_id", groupIds)
          .neq("status", "removed")
          .order("created_at", { ascending: true }),
        supabase.from("member_profiles").select("id, display_name"),
        rpc.myProfile(),
      ]);
      if (membersRes.error) throw membersRes.error;
      if (itemsRes.error) throw itemsRes.error;
      if (profilesRes.error) throw profilesRes.error;

      setGroups(
        groupIds.map((id) => ({
          id,
          memberIds: (membersRes.data ?? [])
            .filter((m) => m.group_id === id)
            .map((m) => m.user_id as string),
        }))
      );
      setItems((itemsRes.data ?? []) as Item[]);
      setNames(
        Object.fromEntries(
          (profilesRes.data ?? []).map((p) => [p.id as string, p.display_name as string])
        )
      );
      if (myProfile) setProfile(myProfile as Profile);
      setError(null);
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [userId]);

  // Initial load + realtime. Any change to items or memberships triggers a
  // debounced refetch — simpler and safer than patching local state, and the
  // spec's race handling lives server-side anyway.
  useEffect(() => {
    if (!userId) return;
    refresh();
    const queueRefresh = () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(refresh, 250);
    };
    const channel = supabase
      .channel("cartpool-core")
      .on("postgres_changes", { event: "*", schema: "public", table: "items" }, queueRefresh)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "memberships" },
        queueRefresh
      )
      .subscribe();
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      supabase.removeChannel(channel);
    };
  }, [userId, refresh]);

  // Actions. Each returns the typed RpcResult so the screen can surface the
  // graceful failure states ("already purchased by {name}", read_only, …).
  const act = useCallback(
    async <T,>(fn: () => Promise<RpcResult<T>>): Promise<RpcResult<T>> => {
      const res = await fn();
      refresh(); // realtime will also catch it; this covers dev setups without it
      return res;
    },
    [refresh]
  );

  return {
    profile,
    groups,
    items,
    names,
    waitlist,
    loading,
    error,
    refresh,
    nameOf: (id: string | null) =>
      id ? (id === userId ? "You" : names[id] ?? "Someone") : "Someone",
    addItem: (groupId: string, text: string, isBulk = false, note?: string) =>
      act(() => rpc.addItem(groupId, text, isBulk, note)),
    markPurchased: (itemId: string) => act(() => rpc.markPurchased(itemId)),
    unmarkPurchased: (itemId: string) => act(() => rpc.unmarkPurchased(itemId)),
    removeItem: (itemId: string) => act(() => rpc.removeItem(itemId)),
    editItemText: (itemId: string, text: string) => act(() => rpc.editItemText(itemId, text)),
    /** Mint a 7-day invite code for a group the user belongs to (spec §3). */
    createInvite: (groupId: string) => rpc.createInvite(groupId, "link"),
    /**
     * Accept an invite. On success this may join the group outright or queue
     * the user behind a full one; either way the membership and waitlist reads
     * need to re-run, hence act().
     */
    redeemInvite: (code: string) => act(() => rpc.redeemInvite(code)),
  };
}
