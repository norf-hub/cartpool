// Section 6 — Leave / grace period (+ v3 always-one-group rule)
import { describe, it, expect } from "vitest";
import { rpc, q } from "./helpers/db";
import {
  mkUser,
  mkGroupWith,
  addItem,
  activeGroups,
  soloGroupOf,
  item,
} from "./helpers/fixtures";

describe("leaving a group", () => {
  it("vanishes the leaver's open items for everyone; others' items survive", async () => {
    const [a, b] = [await mkUser("leaver"), await mkUser("stayer")];
    const g = await mkGroupWith([a, b]);
    const aOpen = await addItem(g, a, "a-open");
    const bOpen = await addItem(g, b, "b-open");

    const r = await rpc<{ ok: boolean }>("leave_group", [g, a]);
    expect(r.ok).toBe(true);

    expect(await item(aOpen)).toBeUndefined();
    expect((await item(bOpen)).status).toBe("open");
  });

  it("keeps the leaver's purchased items (name intact) for a 2-day grace period", async () => {
    const [a, b] = [await mkUser("leaver"), await mkUser("buyer")];
    const g = await mkGroupWith([a, b]);
    const it1 = await addItem(g, a, "case of seltzer");
    await rpc("mark_purchased", [it1, b]);

    await rpc("leave_group", [g, a]);

    let row = await item(it1);
    expect(row.status).toBe("purchased");
    expect(row.added_by).toBe(a); // departed member's name still shows
    expect(row.source_left_at).not.toBeNull();

    // Inside the window: purge keeps it.
    await q(`update items set source_left_at = now() - interval '1 day' where id = $1`, [it1]);
    await rpc("purge_retention");
    expect(await item(it1)).toBeDefined();

    // Past 2 days: purged.
    await q(`update items set source_left_at = now() - interval '3 days' where id = $1`, [it1]);
    await rpc("purge_retention");
    expect(await item(it1)).toBeUndefined();
  });

  it("buyer leaving during the grace period doesn't disturb the purchase record", async () => {
    const [a, b, c] = [await mkUser("leaver"), await mkUser("buyer"), await mkUser("c")];
    const g = await mkGroupWith([a, b, c]);
    const it1 = await addItem(g, a, "olive oil");
    await rpc("mark_purchased", [it1, b]);

    await rpc("leave_group", [g, a]); // adder leaves -> grace window starts
    await rpc("leave_group", [g, b]); // buyer also leaves

    const row = await item(it1);
    expect(row).toBeDefined();
    expect(row.purchased_by).toBe(b); // history, not live membership state
    expect(row.added_by).toBe(a);
  });

  it("last member leaving soft-deletes the group", async () => {
    const [a, b] = [await mkUser("a"), await mkUser("b")];
    const g = await mkGroupWith([a, b]);
    await rpc("leave_group", [g, a]);
    await rpc("leave_group", [g, b]);

    const { rows } = await q(`select deleted_at from groups where id = $1`, [g]);
    expect(rows[0].deleted_at).not.toBeNull();
  });

  it("v3: a user who leaves their last group gets a fresh solo group automatically", async () => {
    const u = await mkUser("solo");
    const g = await soloGroupOf(u);

    await rpc("leave_group", [g, u]);

    const groups = await activeGroups(u);
    expect(groups).toHaveLength(1);
    expect(groups[0]).not.toBe(g); // a new group, not the old one
  });

  it("leaving a group you're not in is a typed error", async () => {
    const [u, other] = [await mkUser("u"), await mkUser("other")];
    const g = await soloGroupOf(other);
    const r = await rpc<{ ok: boolean; error?: string }>("leave_group", [g, u]);
    expect(r).toMatchObject({ ok: false, error: "not_a_member" });
  });
});
