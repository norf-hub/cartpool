// 0019 — account deletion (App Store guideline 5.1.1(v)).
//
// The policy here is a HARD delete: the account and everything it touched go
// at once, rather than the account being anonymised with its history left
// standing. These tests pin both halves of that — what must disappear, and
// what must survive because it belongs to somebody else.
import { describe, it, expect } from "vitest";
import { rpc, q } from "./helpers/db";
import { mkUser, mkGroupWith, addItem, activeGroups, item } from "./helpers/fixtures";

type R = { ok: boolean; error?: string };

const count = async (sql: string, args: unknown[] = []) =>
  Number((await q(sql, args)).rows[0].c);

describe("delete_account (0019)", () => {
  it("removes the user and every row that referenced them", async () => {
    const u = await mkUser("goner");
    const g = (await activeGroups(u))[0];
    await addItem(g, u, "milk");
    await q(
      `insert into push_tokens (user_id, token, platform) values ($1, $2, 'ios')`,
      [u, `ExponentPushToken[del-${Date.now()}]`]
    );

    expect(await rpc<R>("delete_account", [u])).toMatchObject({ ok: true });

    // Every table that references users(id) — none of them cascade (0001), so
    // a missed one would have raised a foreign key error above rather than
    // leaving a row behind. This asserts the delete really ran, not just that
    // it returned ok.
    expect(await count(`select count(*) c from users where id = $1`, [u])).toBe(0);
    expect(await count(`select count(*) c from items where added_by = $1`, [u])).toBe(0);
    expect(await count(`select count(*) c from memberships where user_id = $1`, [u])).toBe(0);
    expect(await count(`select count(*) c from subscriptions where user_id = $1`, [u])).toBe(0);
    expect(await count(`select count(*) c from push_tokens where user_id = $1`, [u])).toBe(0);
    expect(await count(`select count(*) c from auth.users where id = $1`, [u])).toBe(0);
  });

  it("hands back items other people added that the leaver had bought", async () => {
    const [owner, buyer] = [await mkUser("owner"), await mkUser("buyer")];
    const g = await mkGroupWith([owner, buyer]);
    const theirs = await addItem(g, owner, "bread");
    expect(await rpc<R>("mark_purchased", [theirs, buyer])).toMatchObject({ ok: true });

    expect(await rpc<R>("delete_account", [buyer])).toMatchObject({ ok: true });

    // The item belongs to owner, so it survives — but back on the list, since
    // purchased_has_buyer forbids a purchased row with no buyer.
    const row = await item(theirs);
    expect(row.status).toBe("open");
    expect(row.purchased_by).toBeNull();
    expect(row.purchased_at).toBeNull();
  });

  it("takes the leaver's own items with it, bought or not", async () => {
    const [gone, other] = [await mkUser("gone"), await mkUser("other")];
    const g = await mkGroupWith([gone, other]);
    const open = await addItem(g, gone, "eggs");
    const bought = await addItem(g, gone, "butter");
    await rpc("mark_purchased", [bought, other]); // other paid for it

    expect(await rpc<R>("delete_account", [gone])).toMatchObject({ ok: true });

    // Both gone. This is the sharp edge of the hard-delete policy: `other`
    // paid for `butter` and now has no record of it — deliberate, not a bug.
    expect(await count(`select count(*) c from items where id = any($1)`, [[open, bought]])).toBe(0);
    // The other member is untouched.
    expect(await count(`select count(*) c from users where id = $1`, [other])).toBe(1);
  });

  it("soft-deletes a group left with nobody, and leaves shared groups alone", async () => {
    const solo = await mkUser("solo");
    const soloGroup = (await activeGroups(solo))[0];

    const [a, b] = [await mkUser("a"), await mkUser("b")];
    const shared = await mkGroupWith([a, b]);

    expect(await rpc<R>("delete_account", [solo])).toMatchObject({ ok: true });
    expect(await rpc<R>("delete_account", [a])).toMatchObject({ ok: true });

    const deletedAt = async (gid: string) =>
      (await q(`select deleted_at from groups where id = $1`, [gid])).rows[0].deleted_at;
    expect(await deletedAt(soloGroup)).not.toBeNull(); // emptied
    expect(await deletedAt(shared)).toBeNull(); // b is still in it
    expect(await count(`select count(*) c from memberships where group_id=$1 and left_at is null`, [shared])).toBe(1);
  });

  it("clears blocks in both directions", async () => {
    const [a, b] = [await mkUser("a"), await mkUser("b")];
    await mkGroupWith([a, b]);
    await rpc("block_user", [a, b]); // a blocks b, which also makes a leave

    expect(await rpc<R>("delete_account", [b])).toMatchObject({ ok: true });
    // The block row references b as the blocked party; it must not survive and
    // strand a foreign key at the users row.
    expect(
      await count(`select count(*) c from blocks where blocker_id = $1 or blocked_id = $1`, [b])
    ).toBe(0);
  });

  it("is a no-op for an account that isn't there", async () => {
    const u = await mkUser("twice");
    expect(await rpc<R>("delete_account", [u])).toMatchObject({ ok: true });
    expect(await rpc<R>("delete_account", [u])).toMatchObject({
      ok: false,
      error: "not_found",
    });
  });
});
