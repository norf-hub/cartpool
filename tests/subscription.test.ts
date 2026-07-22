// Section 6 — Entitlement / downgrade, v3.1 monetization:
// 3-month unlimited trial from signup, then a one-time $10 lifetime purchase
// (cartpool_unlimited) for more than the 3 free groups. Freeze/pick-3
// machinery is unchanged; it now triggers on trial expiry and refunds.
import { describe, it, expect } from "vitest";
import { rpc, q } from "./helpers/db";
import {
  mkUser,
  entitle,
  expireTrial,
  subscription,
  activeGroups,
  addItem,
  soloGroupOf,
} from "./helpers/fixtures";

type R = { ok: boolean; error?: string };

/** User in 5 groups (solo + 4 created during the trial). */
async function overLimitUser() {
  const u = await mkUser("heavy");
  for (let i = 0; i < 4; i++) {
    const r = await rpc<R & { group_id: string }>("create_group", [u]);
    if (!r.ok) throw new Error(r.error);
  }
  return u;
}

describe("signup trial", () => {
  it("a new account gets ~3 months of trial", async () => {
    const u = await mkUser("fresh");
    const { rows } = await q(
      `select trial_ends_at > now() + interval '89 days'
          and trial_ends_at < now() + interval '93 days' as sane
       from subscriptions where user_id = $1`,
      [u]
    );
    expect(rows[0].sane).toBe(true);
  });

  it("during the trial a 4th group is allowed without paying", async () => {
    const u = await overLimitUser(); // would have thrown on group_limit
    expect(await activeGroups(u)).toHaveLength(5);
    expect((await subscription(u)).entitlement_active).toBe(false);
  });

  it("expire_trials freezes an unpaid over-limit user; ≤3 groups untouched", async () => {
    const heavy = await overLimitUser();
    const light = await mkUser("light");
    await expireTrial(heavy);
    await expireTrial(light);

    const frozen = await rpc<number>("expire_trials", []);
    expect(frozen).toBeGreaterThanOrEqual(1);
    expect((await subscription(heavy)).frozen_read_only).toBe(true);
    expect((await subscription(light)).frozen_read_only).toBe(false);
    await addItem(await soloGroupOf(light), light, "still writable");
  });

  it("expire_trials does not touch paid users or re-freeze after a pick", async () => {
    const paid = await overLimitUser();
    await entitle(paid);
    await expireTrial(paid);

    const picked = await overLimitUser();
    await expireTrial(picked);
    await rpc("expire_trials", []);
    const groups = await activeGroups(picked);
    await rpc("choose_kept_groups", [picked, groups.slice(0, 3)]);

    await rpc("expire_trials", []);
    expect((await subscription(paid)).frozen_read_only).toBe(false);
    expect((await subscription(picked)).frozen_read_only).toBe(false); // no re-freeze
  });
});

describe("refund", () => {
  it("REFUND after the trial freezes a user in more than 3 groups", async () => {
    const u = await overLimitUser();
    await entitle(u);
    await expireTrial(u);
    await rpc("handle_entitlement_event", [u, "REFUND"]);
    const s = await subscription(u);
    expect(s.entitlement_active).toBe(false);
    expect(s.frozen_read_only).toBe(true);
  });

  it("REFUND during the trial does not freeze — the trial still covers them", async () => {
    const u = await overLimitUser();
    await entitle(u);
    await rpc("handle_entitlement_event", [u, "REFUND"]);
    const s = await subscription(u);
    expect(s.entitlement_active).toBe(false);
    expect(s.frozen_read_only).toBe(false);
  });

  it("REFUND with 3 or fewer groups does NOT freeze", async () => {
    const u = await mkUser("small");
    await entitle(u);
    await expireTrial(u);
    await rpc("handle_entitlement_event", [u, "REFUND"]);
    expect((await subscription(u)).frozen_read_only).toBe(false);
  });

  it("subscription-era events are no longer modeled", async () => {
    const u = await mkUser("legacy");
    for (const ev of ["RENEWAL", "EXPIRATION", "CANCELLATION", "BILLING_ISSUE"]) {
      expect(await rpc<R>("handle_entitlement_event", [u, ev])).toMatchObject({
        ok: false,
        error: "unknown_event",
      });
    }
  });
});

describe("v3 freeze scope (unchanged machinery)", () => {
  async function frozenUser() {
    const u = await overLimitUser();
    await expireTrial(u);
    await rpc("expire_trials", []);
    return u;
  }

  it("while frozen, the user is read-only in EVERY group", async () => {
    const u = await frozenUser();
    for (const g of await activeGroups(u)) {
      const r = await rpc<R>("add_item", [g, u, "nope", false, null]);
      expect(r).toMatchObject({ ok: false, error: "read_only" });
    }
  });

  it("choosing 3 keepers unfreezes those and leaves the excess read-only", async () => {
    const u = await frozenUser();
    const groups = await activeGroups(u); // 5
    const kept = groups.slice(0, 3);
    const excess = groups.slice(3);

    // Wrong count rejected; nothing is auto-selected.
    expect(await rpc<R>("choose_kept_groups", [u, kept.slice(0, 2)])).toMatchObject({
      ok: false,
      error: "must_pick_exactly_3",
    });

    expect((await rpc<R>("choose_kept_groups", [u, kept])).ok).toBe(true);
    expect((await subscription(u)).frozen_read_only).toBe(false);

    for (const g of kept) await addItem(g, u, "writable again");
    for (const g of excess) {
      expect(await rpc<R>("add_item", [g, u, "nope", false, null])).toMatchObject({
        ok: false,
        error: "read_only",
      });
    }
  });

  it("the one-time purchase clears the freeze without re-picking groups", async () => {
    const u = await frozenUser();
    expect((await subscription(u)).frozen_read_only).toBe(true);

    await rpc("handle_entitlement_event", [u, "NON_RENEWING_PURCHASE"]);
    const s = await subscription(u);
    expect(s.frozen_read_only).toBe(false);
    expect(s.kept_group_ids).toBeNull(); // no residual restriction

    for (const g of await activeGroups(u)) await addItem(g, u, "all writable");
  });

  it("purchasing after a pick also restores the excess groups", async () => {
    const u = await frozenUser();
    const groups = await activeGroups(u);
    await rpc("choose_kept_groups", [u, groups.slice(0, 3)]);

    await rpc("handle_entitlement_event", [u, "INITIAL_PURCHASE"]);
    for (const g of groups) await addItem(g, u, "restored");
  });
});

describe("free tier limit (post-trial)", () => {
  it("past the trial, an unpaid user cannot create a 4th group", async () => {
    const u = await mkUser("free");
    await rpc("create_group", [u]);
    await rpc("create_group", [u]); // solo + 2 = 3
    await expireTrial(u);
    expect(await rpc<R>("create_group", [u])).toMatchObject({
      ok: false,
      error: "group_limit",
    });
  });

  it("a paid user past the trial can exceed 3 groups", async () => {
    const u = await mkUser("payer");
    await expireTrial(u);
    await entitle(u);
    await rpc("create_group", [u]);
    await rpc("create_group", [u]);
    expect((await rpc<R>("create_group", [u])).ok).toBe(true); // 4th
  });

  it("the solo group counts as one of the 3 from account creation", async () => {
    const u = await mkUser("counted");
    await soloGroupOf(u); // exists at signup
    expect(await activeGroups(u)).toHaveLength(1);
  });
});
