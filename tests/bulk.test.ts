// Section 6 — Bulk items: pre-commit vs retroactive opt-ins, edit reconfirmation
import { describe, it, expect } from "vitest";
import { rpc, q } from "./helpers/db";
import { mkUser, mkGroupWith, addItem, item } from "./helpers/fixtures";

type R = { ok: boolean; error?: string };

const optIn = async (itemId: string, u: string) =>
  (await q(`select * from bulk_opt_ins where item_id=$1 and user_id=$2`, [itemId, u]))
    .rows[0];

describe("bulk opt-ins", () => {
  it("opting in while the item is open records a pre-commit", async () => {
    const [a, b] = [await mkUser("buyer"), await mkUser("b")];
    const g = await mkGroupWith([a, b]);
    const it1 = await addItem(g, a, "24-pack broccoli", {
      isBulk: true,
      note: "the unsalted kind",
    });

    expect((await rpc<R>("bulk_opt_in", [it1, b])).ok).toBe(true);
    expect((await optIn(it1, b)).committed_before_purchase).toBe(true);
  });

  it("editing the text after a pre-commit flags that opt-in for reconfirmation", async () => {
    const [a, b] = [await mkUser("buyer"), await mkUser("b")];
    const g = await mkGroupWith([a, b]);
    const it1 = await addItem(g, a, "24-pack", { isBulk: true });
    await rpc("bulk_opt_in", [it1, b]);

    await rpc("edit_item_text", [it1, a, "36-pack"]); // changes what b agreed to

    expect((await optIn(it1, b)).needs_reconfirmation).toBe(true);
    expect((await item(it1)).bulk_needs_reconfirm).toBe(true);

    // b reconfirms; both flags clear.
    expect((await rpc<R>("bulk_reconfirm", [it1, b])).ok).toBe(true);
    expect((await optIn(it1, b)).needs_reconfirmation).toBe(false);
    expect((await item(it1)).bulk_needs_reconfirm).toBe(false);
  });

  it("retroactive assignment by the buyer is recorded as committed_before_purchase = false", async () => {
    const [a, b, c] = [await mkUser("buyer"), await mkUser("b"), await mkUser("c")];
    const g = await mkGroupWith([a, b, c]);
    const it1 = await addItem(g, a, "case of seltzer", { isBulk: true });
    await rpc("mark_purchased", [it1, a]); // buyer buys own bulk item (v3)

    // Opt-in after purchase, self-service:
    await rpc("bulk_opt_in", [it1, b]);
    expect((await optIn(it1, b)).committed_before_purchase).toBe(false);

    // Retroactive assignment by the buyer:
    expect((await rpc<R>("bulk_assign", [it1, a, c])).ok).toBe(true);
    expect((await optIn(it1, c)).committed_before_purchase).toBe(false);
  });

  it("only the buyer can retroactively assign", async () => {
    const [a, b, c] = [await mkUser("buyer"), await mkUser("b"), await mkUser("c")];
    const g = await mkGroupWith([a, b, c]);
    const it1 = await addItem(g, a, "flour", { isBulk: true });
    await rpc("mark_purchased", [it1, a]);

    expect(await rpc<R>("bulk_assign", [it1, b, c])).toMatchObject({
      ok: false,
      error: "not_buyer",
    });
  });

  it("only the adder can edit item text", async () => {
    const [a, b] = [await mkUser("a"), await mkUser("b")];
    const g = await mkGroupWith([a, b]);
    const it1 = await addItem(g, a, "rice");
    expect(await rpc<R>("edit_item_text", [it1, b, "brown rice"])).toMatchObject({
      ok: false,
      error: "not_adder",
    });
  });
});
