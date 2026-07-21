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

// 0010 — converting an existing item to/from bulk, and editing the note.
describe("set_item_bulk", () => {
  it("converts a plain item to bulk, with a note", async () => {
    const a = await mkUser("a");
    const g = await mkGroupWith([a]);
    const it1 = await addItem(g, a, "seltzer");
    expect(await item(it1)).toMatchObject({ is_bulk: false, bulk_note: null });

    expect(await rpc<R>("set_item_bulk", [it1, a, true, "lime, not lemon"])).toMatchObject({
      ok: true,
    });
    expect(await item(it1)).toMatchObject({
      is_bulk: true,
      bulk_note: "lime, not lemon",
    });
  });

  it("converts back to plain and drops the note while no one has opted in", async () => {
    const a = await mkUser("a");
    const g = await mkGroupWith([a]);
    const it1 = await addItem(g, a, "flour", { isBulk: true, note: "wholemeal" });

    expect(await rpc<R>("set_item_bulk", [it1, a, false])).toMatchObject({ ok: true });
    expect(await item(it1)).toMatchObject({ is_bulk: false, bulk_note: null });
  });

  it("refuses to un-bulk once someone has opted in", async () => {
    const [a, b] = [await mkUser("a"), await mkUser("b")];
    const g = await mkGroupWith([a, b]);
    const it1 = await addItem(g, a, "24-pack", { isBulk: true });
    await rpc("bulk_opt_in", [it1, b]);

    // Orphaned opt-in rows would survive invisibly and resurrect on re-bulk.
    expect(await rpc<R>("set_item_bulk", [it1, a, false])).toMatchObject({
      ok: false,
      error: "has_opt_ins",
    });
    expect(await item(it1)).toMatchObject({ is_bulk: true });

    // Editing the note is still fine while opted in.
    expect(await rpc<R>("set_item_bulk", [it1, a, true, "the big one"])).toMatchObject({
      ok: true,
    });
    expect(await item(it1)).toMatchObject({ bulk_note: "the big one" });
  });

  it("editing the note does not trigger reconfirmation (only text edits do)", async () => {
    const [a, b] = [await mkUser("a"), await mkUser("b")];
    const g = await mkGroupWith([a, b]);
    const it1 = await addItem(g, a, "case of oat milk", { isBulk: true });
    await rpc("bulk_opt_in", [it1, b]);

    await rpc("set_item_bulk", [it1, a, true, "barista edition"]);
    const optIn = (
      await q(`select * from bulk_opt_ins where item_id=$1 and user_id=$2`, [it1, b])
    ).rows[0];
    expect(optIn.needs_reconfirmation).toBe(false);
    expect((await item(it1)).bulk_needs_reconfirm).toBe(false);
  });

  it("only the adder can change bulk status", async () => {
    const [a, b] = [await mkUser("a"), await mkUser("b")];
    const g = await mkGroupWith([a, b]);
    const it1 = await addItem(g, a, "rice");
    expect(await rpc<R>("set_item_bulk", [it1, b, true])).toMatchObject({
      ok: false,
      error: "not_adder",
    });
  });

  it("is blocked in a read-only group", async () => {
    const a = await mkUser("a");
    const g = await mkGroupWith([a]);
    const it1 = await addItem(g, a, "rice");
    await q(`update subscriptions set frozen_read_only = true where user_id = $1`, [a]);

    expect(await rpc<R>("set_item_bulk", [it1, a, true])).toMatchObject({
      ok: false,
      error: "read_only",
    });
  });

  it("refuses removed and unknown items", async () => {
    const a = await mkUser("a");
    const g = await mkGroupWith([a]);
    const it1 = await addItem(g, a, "rice");
    await rpc("remove_item", [it1, a]);

    expect(await rpc<R>("set_item_bulk", [it1, a, true])).toMatchObject({
      ok: false,
      error: "not_found",
    });
    expect(
      await rpc<R>("set_item_bulk", ["00000000-0000-0000-0000-000000000000", a, true])
    ).toMatchObject({ ok: false, error: "not_found" });
  });
});
