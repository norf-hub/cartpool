// Section 6 — Subscription / downgrade (+ v3 freeze-scope rule)
import { describe, it, expect } from "vitest";
import { rpc } from "./helpers/db";
import {
  mkUser,
  mkGroupWith,
  entitle,
  subscription,
  activeGroups,
  addItem,
  soloGroupOf,
} from "./helpers/fixtures";

type R = { ok: boolean; error?: string };

/** Entitled user in 5 groups (solo + 4 created). */
async function overLimitUser() {
  const u = await mkUser("payer");
  await entitle(u);
  for (let i = 0; i < 4; i++) {
    const r = await rpc<R & { group_id: string }>("create_group", [u]);
    if (!r.ok) throw new Error(r.error);
  }
  return u;
}

describe("entitlement loss", () => {
  for (const event of ["EXPIRATION", "CANCELLATION", "REFUND"]) {
    it(`${event} freezes a user in more than 3 groups`, async () => {
      const u = await overLimitUser();
      await rpc("handle_entitlement_event", [u, event]);
      const s = await subscription(u);
      expect(s.entitlement_active).toBe(false);
      expect(s.frozen_read_only).toBe(true);
    });
  }

  it("entitlement loss with 3 or fewer groups does NOT freeze", async () => {
    const u = await mkUser("small");
    await entitle(u);
    await rpc("handle_entitlement_event", [u, "EXPIRATION"]);
    expect((await subscription(u)).frozen_read_only).toBe(false);
  });

  it("billing grace period does not trigger the downgrade flow", async () => {
    const u = await overLimitUser();
    await rpc("handle_entitlement_event", [u, "BILLING_ISSUE"]);
    const s = await subscription(u);
    expect(s.in_grace_period).toBe(true);
    expect(s.entitlement_active).toBe(true); // no entitlement loss yet
    expect(s.frozen_read_only).toBe(false);

    const [g] = await activeGroups(u);
    await addItem(g, u, "still writable"); // throws if rejected
  });
});

describe("v3 freeze scope", () => {
  it("while frozen, the user is read-only in EVERY group", async () => {
    const u = await overLimitUser();
    await rpc("handle_entitlement_event", [u, "EXPIRATION"]);

    for (const g of await activeGroups(u)) {
      const r = await rpc<R>("add_item", [g, u, "nope", false, null]);
      expect(r).toMatchObject({ ok: false, error: "read_only" });
    }
  });

  it("choosing 3 keepers unfreezes those and leaves the excess read-only", async () => {
    const u = await overLimitUser();
    await rpc("handle_entitlement_event", [u, "EXPIRATION"]);

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

  it("restoring entitlement clears the freeze without re-picking groups", async () => {
    const u = await overLimitUser();
    await rpc("handle_entitlement_event", [u, "EXPIRATION"]);
    expect((await subscription(u)).frozen_read_only).toBe(true);

    await rpc("handle_entitlement_event", [u, "RENEWAL"]);
    const s = await subscription(u);
    expect(s.frozen_read_only).toBe(false);
    expect(s.kept_group_ids).toBeNull(); // no residual restriction

    for (const g of await activeGroups(u)) await addItem(g, u, "all writable");
  });

  it("resubscribing after a pick also restores the excess groups", async () => {
    const u = await overLimitUser();
    await rpc("handle_entitlement_event", [u, "EXPIRATION"]);
    const groups = await activeGroups(u);
    await rpc("choose_kept_groups", [u, groups.slice(0, 3)]);

    await rpc("handle_entitlement_event", [u, "INITIAL_PURCHASE"]);
    for (const g of groups) await addItem(g, u, "restored");
  });
});

describe("free tier limit", () => {
  it("a free user cannot create a 4th group", async () => {
    const u = await mkUser("free");
    await rpc("create_group", [u]);
    await rpc("create_group", [u]); // solo + 2 = 3
    expect(await rpc<R>("create_group", [u])).toMatchObject({
      ok: false,
      error: "group_limit",
    });
  });

  it("the solo group counts as one of the 3 from account creation", async () => {
    const u = await mkUser("counted");
    await soloGroupOf(u); // exists at signup
    expect(await activeGroups(u)).toHaveLength(1);
  });
});
