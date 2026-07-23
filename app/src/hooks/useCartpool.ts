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
  /** True while any pre-commit opt-in is awaiting reconfirmation after an edit. */
  bulk_needs_reconfirm: boolean;
  created_at: string;
};

/**
 * My subscription row (spec §9). Absent row = free tier, nothing frozen.
 * frozen_read_only: entitlement lapsed with >3 groups; read-only EVERYWHERE
 * until choose_kept_groups succeeds. After that, kept_group_ids is set and
 * only groups outside it stay read-only (until the one-time purchase clears it).
 */
export type Subscription = {
  /** v3.1: lifetime cartpool_unlimited, granted by the one-time $10 purchase. */
  entitlement_active: boolean;
  /** Unlimited groups until this instant (3 months from signup). */
  trial_ends_at: string;
  frozen_read_only: boolean;
  kept_group_ids: string[] | null;
};

/** One member's share of a bulk item (spec §5): binary in, no quantity. */
export type BulkOptIn = {
  item_id: string;
  user_id: string;
  /** true = pre-commit while open; false = joined/assigned after purchase. */
  committed_before_purchase: boolean;
  /** The adder edited the text after this pre-commit; it needs re-agreeing. */
  needs_reconfirmation: boolean;
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
 * "Up for grabs" (spec v3.2): surplus units from an over-sized pack, posted
 * for groupmates to claim. unit_price_cents is a label only (null = free) —
 * money changes hands offline and is never tracked.
 */
export type Offer = {
  id: string;
  group_id: string;
  posted_by: string;
  text: string;
  qty_offered: number;
  qty_remaining: number;
  unit_price_cents: number | null;
  created_at: string;
  expires_at: string;
  closed_at: string | null;
};

/** One member's claim on an offer; qty accumulates across repeat claims. */
export type OfferClaim = {
  offer_id: string;
  user_id: string;
  qty: number;
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
  const [optIns, setOptIns] = useState<Record<string, BulkOptIn[]>>({});
  const [offers, setOffers] = useState<Offer[]>([]);
  const [claims, setClaims] = useState<Record<string, OfferClaim[]>>({});
  const [subscription, setSubscription] = useState<Subscription | null>(null);
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

      // My subscription row (RLS-scoped to self). The freeze check must run
      // on every refresh: the spec wants the pick-3 screen back on every app
      // open until resolved, and the flag flips server-side via webhook.
      const { data: sub, error: eS } = await pub()
        .from("subscriptions")
        .select("entitlement_active, trial_ends_at, frozen_read_only, kept_group_ids")
        .eq("user_id", userId)
        .maybeSingle();
      if (eS) throw eS;
      setSubscription((sub as Subscription) ?? null);

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
        setOffers([]);
        setClaims({});
        return;
      }

      const [membersRes, itemsRes, profilesRes, myProfile] = await Promise.all([
        pub()
          .from("memberships")
          .select("group_id, user_id")
          .in("group_id", groupIds)
          .is("left_at", null),
        // 0013: no group filter — RLS scopes items to "shares a group with the
        // adder" (plus the purchased-grace read), which IS the cross-group
        // merged list. Filtering by my group ids here would hide items whose
        // home group I'm not in.
        pub()
          .from("items")
          .select(
            "id, group_id, added_by, text, status, purchased_by, purchased_at, is_bulk, bulk_note, bulk_needs_reconfirm, created_at"
          )
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
      const loadedItems = (itemsRes.data ?? []) as Item[];
      setItems(loadedItems);

      // Opt-ins for the visible bulk items. A second round trip keyed on item
      // ids (rather than a join) keeps the RLS story simple: the
      // bulk_opt_ins_select policy already scopes rows to my groups' items.
      const bulkIds = loadedItems.filter((i) => i.is_bulk).map((i) => i.id);
      if (bulkIds.length > 0) {
        const { data: ins, error: eB } = await pub()
          .from("bulk_opt_ins")
          .select("item_id, user_id, committed_before_purchase, needs_reconfirmation")
          .in("item_id", bulkIds)
          .order("created_at", { ascending: true });
        if (eB) throw eB;
        const byItem: Record<string, BulkOptIn[]> = {};
        for (const o of (ins ?? []) as BulkOptIn[]) {
          (byItem[o.item_id] ??= []).push(o);
        }
        setOptIns(byItem);
      } else {
        setOptIns({});
      }
      // Open offers in my groups (v3.2). Expired ones drop out client-side
      // too so the section self-cleans between purges.
      const { data: offs, error: eO } = await pub()
        .from("offers")
        .select(
          "id, group_id, posted_by, text, qty_offered, qty_remaining, unit_price_cents, created_at, expires_at, closed_at"
        )
        .in("group_id", groupIds)
        .is("closed_at", null)
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: true });
      if (eO) throw eO;
      const openOffers = (offs ?? []) as Offer[];
      setOffers(openOffers);

      if (openOffers.length > 0) {
        const { data: cls, error: eC } = await pub()
          .from("offer_claims")
          .select("offer_id, user_id, qty")
          .in("offer_id", openOffers.map((o) => o.id));
        if (eC) throw eC;
        const byOffer: Record<string, OfferClaim[]> = {};
        for (const c of (cls ?? []) as OfferClaim[]) {
          (byOffer[c.offer_id] ??= []).push(c);
        }
        setClaims(byOffer);
      } else {
        setClaims({});
      }

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
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "bulk_opt_ins" },
        queueRefresh
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "offers" },
        queueRefresh
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "offer_claims" },
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
    optIns,
    offers,
    /** Claims per offer id; each user appears once with an accumulated qty. */
    offerClaims: claims,
    subscription,
    /** Read-only everywhere: lapsed with >3 groups, keepers not yet chosen. */
    frozen: subscription?.frozen_read_only ?? false,
    /**
     * Per-group read-only after the pick: outside the kept 3 while
     * unentitled. Mirrors can_write() server-side — the server still
     * enforces; this is for honest UI.
     */
    isGroupReadOnly: (groupId: string) => {
      if (!subscription) return false;
      if (subscription.frozen_read_only) return true;
      const entitled =
        subscription.entitlement_active ||
        new Date(subscription.trial_ends_at) > new Date();
      return (
        !entitled &&
        subscription.kept_group_ids !== null &&
        !subscription.kept_group_ids.includes(groupId)
      );
    },
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
    /** Convert an existing item to/from bulk, or edit its note (spec §5). */
    setItemBulk: (itemId: string, isBulk: boolean, note?: string) =>
      act(() => rpc.setItemBulk(itemId, isBulk, note)),
    /** One-tap bulk share (spec §5). Pre-commit if open, self-serve if bought. */
    bulkOptIn: (itemId: string) => act(() => rpc.bulkOptIn(itemId)),
    /** Buyer adds someone to an already-purchased bulk item. */
    bulkAssign: (itemId: string, targetUserId: string) =>
      act(() => rpc.bulkAssign(itemId, targetUserId)),
    /** Re-agree to a bulk item whose text changed after my pre-commit. */
    bulkReconfirm: (itemId: string) => act(() => rpc.bulkReconfirm(itemId)),
    /** The required downgrade pick: exactly 3 group ids (spec §9). */
    chooseKeptGroups: (groupIds: string[]) => act(() => rpc.chooseKeptGroups(groupIds)),
    /** Leave a list: open items vanish, purchased get 2-day grace (spec §3). */
    leaveGroup: (groupId: string) => act(() => rpc.leaveGroup(groupId)),
    /**
     * Block someone. Server-side this makes ME leave every shared group; the
     * other person is untouched, unnotified, and the block itself is
     * unreadable by any client (spec §3).
     */
    blockUser: (targetUserId: string) => act(() => rpc.blockUser(targetUserId)),
    /** Mint a 7-day invite code for a group the user belongs to (spec §3). */
    createInvite: (groupId: string) => rpc.createInvite(groupId, "link"),
    /**
     * Accept an invite. On success this may join the group outright or queue
     * the user behind a full one; either way the membership and waitlist reads
     * need to re-run, hence act().
     */
    redeemInvite: (code: string) => act(() => rpc.redeemInvite(code)),
    /** Post surplus units "up for grabs" (spec v3.2). Price is a label. */
    createOffer: (groupId: string, text: string, qty: number, priceCents: number | null) =>
      act(() => rpc.createOffer(groupId, text, qty, priceCents)),
    /** Claim units — one person may take 1..all of what's left. */
    claimOffer: (offerId: string, qty: number) => act(() => rpc.claimOffer(offerId, qty)),
    /** Give back part or all of my claim while the offer is open. */
    unclaimOffer: (offerId: string, qty?: number) =>
      act(() => rpc.unclaimOffer(offerId, qty)),
    /** Poster withdraws the offer; existing claims stand. */
    closeOffer: (offerId: string) => act(() => rpc.closeOffer(offerId)),
  };
}
