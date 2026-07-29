// 0020 — purchase notifications (spec §6).
//
// The decision of who hears about a purchase lives in Postgres precisely so
// it can be tested; the edge function only turns the result into an Expo
// request. These pin the recipient rule (v3.3: the adder, not the group) and
// the mute precedence (per-group override beats the global toggle).
import { describe, it, expect } from "vitest";
import { rpc, q } from "./helpers/db";
import { mkUser, mkGroupWith, addItem, activeGroups } from "./helpers/fixtures";

type R = { ok: boolean; error?: string };
type Notice = {
  item_id: string;
  user_id: string;
  group_id: string;
  buyer_id: string;
  item_text: string;
  title: string;
  body: string;
} | null;

const notice = async (item: string): Promise<Notice> =>
  (await q(`select purchase_notice($1) as n`, [item])).rows[0].n;

// mkUser uniquifies display names ("Bill" -> "Bill7"), so the expected body is
// built from what was actually stored rather than hardcoded.
const nameOf = async (user: string): Promise<string> =>
  (await q(`select display_name from users where id = $1`, [user])).rows[0].display_name;

describe("purchase_notice (0020)", () => {
  it("addresses the adder, and names the buyer and the item", async () => {
    const [wants, buys] = [await mkUser("Rosa"), await mkUser("Bill")];
    const g = await mkGroupWith([wants, buys]);
    const it_ = await addItem(g, wants, "milk");
    expect(await rpc<R>("mark_purchased", [it_, buys])).toMatchObject({ ok: true });

    const n = await notice(it_);
    // The person whose groceries somebody else is now holding.
    expect(n?.user_id).toBe(wants);
    expect(n?.buyer_id).toBe(buys);
    expect(n?.item_text).toBe("milk");
    expect(n?.body).toBe(`${await nameOf(buys)} bought milk`);
    // §4.2 stacking key.
    expect(n?.group_id).toBe(g);
  });

  it("says nothing about an item that is still open", async () => {
    const u = await mkUser("solo");
    const g = (await activeGroups(u))[0];
    expect(await notice(await addItem(g, u, "bread"))).toBeNull();
  });

  it("says nothing when you check off your own item", async () => {
    const u = await mkUser("shopper");
    const g = (await activeGroups(u))[0];
    const it_ = await addItem(g, u, "eggs");
    // v3 §4 explicitly allows this, and it is the whole solo flow.
    expect(await rpc<R>("mark_purchased", [it_, u])).toMatchObject({ ok: true });
    expect(await notice(it_)).toBeNull();
  });

  it("respects the global mute", async () => {
    const [wants, buys] = [await mkUser("quiet"), await mkUser("buyer")];
    const g = await mkGroupWith([wants, buys]);
    const it_ = await addItem(g, wants, "butter");
    expect(await rpc<R>("set_global_mute", [wants, true])).toMatchObject({ ok: true });
    await rpc("mark_purchased", [it_, buys]);

    expect(await notice(it_)).toBeNull();
  });

  it("lets a per-group mute silence one group while the rest stay audible", async () => {
    const [wants, buys] = [await mkUser("Rosa"), await mkUser("Bill")];
    const noisy = await mkGroupWith([wants, buys]);
    const quiet = await mkGroupWith([wants, buys]);
    const inNoisy = await addItem(noisy, wants, "apples");
    const inQuiet = await addItem(quiet, wants, "pears");

    expect(await rpc<R>("set_group_mute", [wants, quiet, true])).toMatchObject({ ok: true });
    await rpc("mark_purchased", [inNoisy, buys]);
    await rpc("mark_purchased", [inQuiet, buys]);

    expect((await notice(inNoisy))?.item_text).toBe("apples");
    expect(await notice(inQuiet)).toBeNull();
  });

  it("lets a per-group unmute override a global mute", async () => {
    const [wants, buys] = [await mkUser("Rosa"), await mkUser("Bill")];
    const g = await mkGroupWith([wants, buys]);
    const it_ = await addItem(g, wants, "coffee");

    // "Quiet by default, but not for this group" — the §6 reason the override
    // is nullable three-state rather than a boolean.
    expect(await rpc<R>("set_global_mute", [wants, true])).toMatchObject({ ok: true });
    expect(await rpc<R>("set_group_mute", [wants, g, false])).toMatchObject({ ok: true });
    await rpc("mark_purchased", [it_, buys]);

    expect((await notice(it_))?.body).toBe(`${await nameOf(buys)} bought coffee`);
  });

  it("clearing a per-group override falls back to the global setting", async () => {
    const [wants, buys] = [await mkUser("Rosa"), await mkUser("Bill")];
    const g = await mkGroupWith([wants, buys]);
    const it_ = await addItem(g, wants, "tea");
    await rpc("set_global_mute", [wants, true]);
    await rpc("set_group_mute", [wants, g, false]);
    await rpc("mark_purchased", [it_, buys]);
    expect(await notice(it_)).not.toBeNull();

    // Back to following global, which is muted.
    expect(await rpc<R>("set_group_mute", [wants, g, null])).toMatchObject({ ok: true });
    expect(await notice(it_)).toBeNull();
  });
});

describe("on_item_purchased trigger (0020)", () => {
  it("does not break the purchase when push is unconfigured", async () => {
    // Local dev and CI have no endpoint and no pg_net. A notification is not
    // worth losing a purchase over, so the trigger must stay inert rather
    // than roll back the buy.
    const [wants, buys] = [await mkUser("Rosa"), await mkUser("Bill")];
    const g = await mkGroupWith([wants, buys]);
    const it_ = await addItem(g, wants, "flour");

    expect(await rpc<R>("mark_purchased", [it_, buys])).toMatchObject({ ok: true });
    const row = (await q(`select status, purchased_by from items where id = $1`, [it_])).rows[0];
    expect(row.status).toBe("purchased");
    expect(row.purchased_by).toBe(buys);
  });

  it("stays silent on unmark, and speaks again on re-purchase", async () => {
    const [wants, buys] = [await mkUser("Rosa"), await mkUser("Bill")];
    const g = await mkGroupWith([wants, buys]);
    const it_ = await addItem(g, wants, "sugar");

    await rpc("mark_purchased", [it_, buys]);
    expect(await notice(it_)).not.toBeNull();

    // Mistake recovery (§4): back to open, nothing to announce.
    expect(await rpc<R>("unmark_purchased", [it_, buys])).toMatchObject({ ok: true });
    expect(await notice(it_)).toBeNull();

    // And the transition fires cleanly a second time.
    expect(await rpc<R>("mark_purchased", [it_, buys])).toMatchObject({ ok: true });
    expect((await notice(it_))?.body).toBe(`${await nameOf(buys)} bought sugar`);
  });
});
