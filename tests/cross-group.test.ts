// 0013 — Cross-group items: one canonical row, visible to everyone who
// shares an active group with the adder; the first buyer anywhere clears it
// everywhere; leaving hides open items from ex-groupmates without deleting
// the adder's own record.
import { describe, it, expect } from "vitest";
import type { PoolClient } from "pg";
import { pool, rpc, q } from "./helpers/db";
import { mkUser, mkGroupWith, addItem, item } from "./helpers/fixtures";

async function asUser<T>(uid: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query(`select set_config('request.jwt.claims', $1, false)`, [
      JSON.stringify({ sub: uid, role: "authenticated" }),
    ]);
    await c.query(`set role authenticated`);
    return await fn(c);
  } finally {
    await c.query(`reset role`);
    await c.query(`select set_config('request.jwt.claims', '', false)`);
    c.release();
  }
}

const canSee = (uid: string, itemId: string) =>
  asUser(uid, async (c) => {
    const { rows } = await c.query(`select id from items where id = $1`, [itemId]);
    return rows.length === 1;
  });

describe("cross-group visibility", () => {
  it("an item added in one group is visible to members of the adder's other groups", async () => {
    const [me, a, b] = [await mkUser("me"), await mkUser("groupA"), await mkUser("groupB")];
    const gA = await mkGroupWith([me, a]);
    await mkGroupWith([me, b]);
    const it1 = await addItem(gA, me, "rice"); // homed in group A

    expect(await canSee(a, it1)).toBe(true); // same group
    expect(await canSee(b, it1)).toBe(true); // different group, same adder
    expect(await canSee(me, it1)).toBe(true); // my own list
  });

  it("two groupmates of mine who don't share a group can't see each other's items", async () => {
    const [me, a, b] = [await mkUser("me"), await mkUser("a"), await mkUser("b")];
    const gA = await mkGroupWith([me, a]);
    await mkGroupWith([me, b]);
    const aItem = await addItem(gA, a, "a's oat milk");

    expect(await canSee(me, aItem)).toBe(true); // I share a group with a
    expect(await canSee(b, aItem)).toBe(false); // b doesn't
  });
});

describe("cross-group purchase", () => {
  it("a member of a different group can buy my item, and it clears everywhere", async () => {
    const [me, a, b] = [await mkUser("me"), await mkUser("a"), await mkUser("b")];
    const gA = await mkGroupWith([me, a]);
    await mkGroupWith([me, b]);
    const it1 = await addItem(gA, me, "coffee beans");

    // b is NOT in the item's home group — the adder's pool is what counts.
    const r = await rpc<{ ok: boolean }>("mark_purchased", [it1, b]);
    expect(r.ok).toBe(true);

    // Single canonical row: one purchase clears it for every list at once,
    // and the buyer is recorded for the "To pick up" view.
    const row = await item(it1);
    expect(row.status).toBe("purchased");
    expect(row.purchased_by).toBe(b);

    // The race across groups still has exactly one winner.
    const late = await rpc<{ ok: boolean; error?: string; purchased_by?: string }>(
      "mark_purchased",
      [it1, a]
    );
    expect(late).toMatchObject({ ok: false, error: "already_purchased", purchased_by: b });
  });

  it("a frozen (read-only) user cannot buy across groups", async () => {
    const [me, b] = [await mkUser("me"), await mkUser("frozenbuyer")];
    await mkGroupWith([me, b]);
    const gSolo = (await q(
      `select m.group_id from memberships m join groups g on g.id = m.group_id
       where m.user_id = $1 and m.left_at is null and g.deleted_at is null
       order by m.joined_at limit 1`,
      [me]
    )).rows[0].group_id;
    const it1 = await addItem(gSolo, me, "detergent");

    await q(`update subscriptions set frozen_read_only = true where user_id = $1`, [b]);
    const r = await rpc<{ ok: boolean; error?: string }>("mark_purchased", [it1, b]);
    expect(r).toMatchObject({ ok: false, error: "read_only" });
  });

  it("bulk opt-in works from any of the adder's groups", async () => {
    const [me, b] = [await mkUser("me"), await mkUser("b")];
    const gB = await mkGroupWith([me, b]);
    const gOther = await mkGroupWith([me, await mkUser("c")]);
    const it1 = await addItem(gOther, me, "48 eggs", { isBulk: true });

    // b shares gB with me, not the item's home group gOther.
    const r = await rpc<{ ok: boolean }>("bulk_opt_in", [it1, b]);
    expect(r.ok).toBe(true);
    void gB;
  });
});

describe("leaving under the cross-group model", () => {
  it("ex-groupmates stop seeing the leaver's open items; the leaver keeps them", async () => {
    const [a, b] = [await mkUser("leaver"), await mkUser("stayer")];
    const g = await mkGroupWith([a, b]);
    const it1 = await addItem(g, a, "a-open");
    expect(await canSee(b, it1)).toBe(true);

    await rpc("leave_group", [g, a]);

    expect(await canSee(b, it1)).toBe(false); // hidden from the old group
    expect(await canSee(a, it1)).toBe(true); // still on a's own list
    expect((await item(it1)).status).toBe("open");
  });

  it("the buyer keeps seeing a purchased item for the grace window after the adder leaves", async () => {
    const [a, b] = [await mkUser("leaver"), await mkUser("buyer")];
    const g = await mkGroupWith([a, b]);
    const it1 = await addItem(g, a, "seltzer");
    await rpc("mark_purchased", [it1, b]);

    await rpc("leave_group", [g, a]);
    expect(await canSee(b, it1)).toBe(true); // grace read via the home group
    expect(await canSee(a, it1)).toBe(true); // adder's own history

    // Grace over: re-homed, old group loses the read, adder keeps history.
    await q(`update items set source_left_at = now() - interval '3 days' where id = $1`, [it1]);
    await rpc("purge_retention");
    expect(await canSee(b, it1)).toBe(false);
    expect(await canSee(a, it1)).toBe(true);
  });

  it("items keep following the adder into groups joined later", async () => {
    const [a, b] = [await mkUser("a"), await mkUser("later")];
    const gSolo = (await q(
      `select m.group_id from memberships m join groups g on g.id = m.group_id
       where m.user_id = $1 and m.left_at is null and g.deleted_at is null
       order by m.joined_at limit 1`,
      [a]
    )).rows[0].group_id;
    const it1 = await addItem(gSolo, a, "added before we met");

    expect(await canSee(b, it1)).toBe(false);
    await mkGroupWith([a, b]); // now they share a group
    expect(await canSee(b, it1)).toBe(true);
  });
});
