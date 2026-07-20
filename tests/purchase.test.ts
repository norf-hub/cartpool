// Section 6 — Purchase race condition (+ v3 self-purchase rule)
import { describe, it, expect } from "vitest";
import { rpc, q } from "./helpers/db";
import { mkUser, mkGroupWith, addItem, soloGroupOf, item } from "./helpers/fixtures";

type MarkResult = {
  ok: boolean;
  error?: string;
  purchased_by?: string;
  purchased_by_name?: string;
};

describe("mark purchased", () => {
  it("any member can mark another member's open item; buyer and time recorded", async () => {
    const [a, b] = [await mkUser("adder"), await mkUser("buyer")];
    const g = await mkGroupWith([a, b]);
    const it1 = await addItem(g, a, "broccoli");

    const r = await rpc<MarkResult>("mark_purchased", [it1, b]);
    expect(r.ok).toBe(true);

    const row = await item(it1);
    expect(row.status).toBe("purchased");
    expect(row.purchased_by).toBe(b);
    expect(row.purchased_at).not.toBeNull();
  });

  it("v3: the adder can purchase their own item (solo list depends on this)", async () => {
    const u = await mkUser("solo");
    const g = await soloGroupOf(u);
    const it1 = await addItem(g, u, "milk");

    const r = await rpc<MarkResult>("mark_purchased", [it1, u]);
    expect(r.ok).toBe(true);
    expect((await item(it1)).purchased_by).toBe(u);
  });

  it("concurrent marks resolve to exactly one winner, losers get a typed result", async () => {
    const [a, b, c, d] = await Promise.all(
      ["a", "b", "c", "d"].map((x) => mkUser(x))
    );
    const g = await mkGroupWith([a, b, c, d]);
    const it1 = await addItem(g, a, "24-pack paper towels");

    const callers = [a, b, c, d, a, b, c, d]; // 8 simultaneous attempts
    const results = await Promise.all(
      callers.map((u) => rpc<MarkResult>("mark_purchased", [it1, u]))
    );

    const winners = results.filter((r) => r.ok);
    const losers = results.filter((r) => !r.ok);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(7);
    for (const l of losers) {
      expect(l.error).toBe("already_purchased");
      expect(l.purchased_by_name).toBeTruthy();
    }

    // Exactly one purchased_by/purchased_at pair, regardless of arrival order.
    const row = await item(it1);
    expect(row.status).toBe("purchased");
    expect(row.purchased_by).not.toBeNull();
    expect(row.purchased_at).not.toBeNull();
  });

  it("a late arrival gets 'already purchased by {name}', not a generic error", async () => {
    const [a, b] = [await mkUser("first"), await mkUser("second")];
    const g = await mkGroupWith([a, b]);
    const it1 = await addItem(g, a, "eggs");

    await rpc("mark_purchased", [it1, a]);
    const late = await rpc<MarkResult>("mark_purchased", [it1, b]);

    expect(late.ok).toBe(false);
    expect(late.error).toBe("already_purchased");
    expect(late.purchased_by).toBe(a);
    expect(late.purchased_by_name).toMatch(/^first/);
  });

  it("non-members cannot mark items", async () => {
    const [a, outsider] = [await mkUser("a"), await mkUser("outsider")];
    const g = await mkGroupWith([a]);
    const it1 = await addItem(g, a, "bread");

    const r = await rpc<MarkResult>("mark_purchased", [it1, outsider]);
    expect(r).toMatchObject({ ok: false, error: "not_a_member" });
  });
});

describe("unmark (mistake recovery)", () => {
  it("only the buyer can unmark, and the item returns to open", async () => {
    const [a, b] = [await mkUser("a"), await mkUser("b")];
    const g = await mkGroupWith([a, b]);
    const it1 = await addItem(g, a, "butter");
    await rpc("mark_purchased", [it1, b]);

    // The adder is not the buyer here — rejected.
    const wrong = await rpc<MarkResult>("unmark_purchased", [it1, a]);
    expect(wrong.ok).toBe(false);

    const right = await rpc<MarkResult>("unmark_purchased", [it1, b]);
    expect(right.ok).toBe(true);

    const row = await item(it1);
    expect(row.status).toBe("open");
    expect(row.purchased_by).toBeNull();
    expect(row.purchased_at).toBeNull();

    // Reopened item is purchasable again, by anyone — including the adder.
    expect((await rpc<MarkResult>("mark_purchased", [it1, a])).ok).toBe(true);
  });

  it("unmarking an open item fails", async () => {
    const a = await mkUser("a");
    const g = await soloGroupOf(a);
    const it1 = await addItem(g, a, "salt");
    const r = await rpc<MarkResult>("unmark_purchased", [it1, a]);
    expect(r.ok).toBe(false);
  });
});
