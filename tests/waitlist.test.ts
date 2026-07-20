// Section 6 — Joining, waitlist FCFS promotion, and the v3 solo-merge rule
import { describe, it, expect } from "vitest";
import { rpc, q } from "./helpers/db";
import {
  mkUser,
  mkGroupWith,
  mkInvite,
  addItem,
  activeGroups,
  soloGroupOf,
  item,
  entitle,
} from "./helpers/fixtures";

type R = { ok: boolean; error?: string; waitlisted?: boolean; joined?: boolean };

const isActive = async (g: string, u: string) =>
  (
    await q(
      `select 1 from memberships where group_id=$1 and user_id=$2 and left_at is null`,
      [g, u]
    )
  ).rows.length > 0;

const entry = async (g: string, u: string) =>
  (await q(`select * from waitlist_entries where group_id=$1 and user_id=$2`, [g, u]))
    .rows[0];

async function fullGroup() {
  const members = await Promise.all(["a", "b", "c", "d"].map((x) => mkUser(x)));
  const g = await mkGroupWith(members);
  return { g, members };
}

describe("invite redemption", () => {
  it("expired and revoked invites are rejected server-side", async () => {
    const a = await mkUser("a");
    const g = await soloGroupOf(a);

    const expired = await mkInvite(g, a);
    await q(`update invites set expires_at = now() - interval '1 minute' where code=$1`, [expired]);
    expect(await rpc<R>("redeem_invite", [expired, await mkUser("x")])).toMatchObject({
      ok: false,
      error: "expired",
    });

    const revoked = await mkInvite(g, a);
    await q(`update invites set revoked_at = now() where code=$1`, [revoked]);
    expect(await rpc<R>("redeem_invite", [revoked, await mkUser("y")])).toMatchObject({
      ok: false,
      error: "expired",
    });
  });

  it("v3 merge: first invite moves the joiner's solo open items in and deletes the solo group", async () => {
    const host = await mkUser("host");
    const hostGroup = await soloGroupOf(host);
    const u = await mkUser("joiner");
    const solo = await soloGroupOf(u);
    const open = await addItem(solo, u, "to-move");
    const bought = await addItem(solo, u, "already-bought");
    await rpc("mark_purchased", [bought, u]); // v3 self-purchase

    const code = await mkInvite(hostGroup, host);
    const r = await rpc<R>("redeem_invite", [code, u]);
    expect(r).toMatchObject({ ok: true, joined: true });

    expect((await item(open)).group_id).toBe(hostGroup); // open item moved
    const boughtRow = await item(bought);
    expect(boughtRow.group_id).toBe(solo); // history stays behind...
    expect(boughtRow.source_left_at).not.toBeNull(); // ...but enters the 2-day grace purge
    const { rows } = await q(`select deleted_at from groups where id=$1`, [solo]);
    expect(rows[0].deleted_at).not.toBeNull(); // emptied solo group deleted
    expect(await activeGroups(u)).toEqual([hostGroup]);
  });

  it("free tier: joining a 4th group without entitlement is rejected", async () => {
    const u = await mkUser("u");
    await rpc("create_group", [u]);
    await rpc("create_group", [u]); // solo + 2 = 3 groups
    const host = await mkUser("host");
    const code = await mkInvite(await soloGroupOf(host), host);
    expect(await rpc<R>("redeem_invite", [code, u])).toMatchObject({
      ok: false,
      error: "group_limit",
    });
  });

  it("invite codes are 8 chars from the unambiguous base32 alphabet (no 0/O/1/I)", async () => {
    const a = await mkUser("a");
    const g = await soloGroupOf(a);
    for (let i = 0; i < 5; i++) {
      const code = await mkInvite(g, a);
      expect(code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    }
  });
});

describe("full groups & waitlist", () => {
  it("a valid code against a full group waitlists the joiner", async () => {
    const { g, members } = await fullGroup();
    const e = await mkUser("e");
    const code = await mkInvite(g, members[0]);

    const r = await rpc<R>("redeem_invite", [code, e]);
    expect(r).toMatchObject({ ok: true, waitlisted: true });
    expect(await isActive(g, e)).toBe(false);
    expect(await entry(g, e)).toBeDefined();
  });

  it("promotes strictly by requested_at when a slot opens", async () => {
    const { g, members } = await fullGroup();
    const [e, f] = [await mkUser("e"), await mkUser("f")];
    const code = await mkInvite(g, members[0]);
    await rpc("redeem_invite", [code, f]); // f asks first by insertion...
    await rpc("redeem_invite", [code, e]);
    // ...but e's request timestamp is earlier: timestamp wins.
    await q(`update waitlist_entries set requested_at = now() - interval '1 hour'
             where group_id=$1 and user_id=$2`, [g, e]);

    await rpc("leave_group", [g, members[3]]);

    expect(await isActive(g, e)).toBe(true);
    expect((await entry(g, e)).promoted_at).not.toBeNull();
    expect(await isActive(g, f)).toBe(false); // still waiting
    expect((await entry(g, f)).promoted_at).toBeNull();
  });

  it("breaks requested_at ties by insertion order", async () => {
    const { g, members } = await fullGroup();
    const [e, f] = [await mkUser("e"), await mkUser("f")];
    const code = await mkInvite(g, members[0]);
    await rpc("redeem_invite", [code, e]); // inserted first
    await rpc("redeem_invite", [code, f]);
    await q(`update waitlist_entries set requested_at = date_trunc('hour', now())
             where group_id=$1`, [g]); // identical timestamps

    await rpc("leave_group", [g, members[3]]);

    expect(await isActive(g, e)).toBe(true);
    expect(await isActive(g, f)).toBe(false);
  });

  it("skips a blocked entry (waitlisted user blocked a member) and promotes the next", async () => {
    const { g, members } = await fullGroup();
    const [e, f] = [await mkUser("e"), await mkUser("f")];
    const code = await mkInvite(g, members[0]);
    await rpc("redeem_invite", [code, e]);
    await rpc("redeem_invite", [code, f]);
    await q(`update waitlist_entries set requested_at = now() - interval '1 hour'
             where group_id=$1 and user_id=$2`, [g, e]); // e is first in line

    await rpc("block_user", [e, members[0]]); // e blocked a sitting member

    await rpc("leave_group", [g, members[3]]);

    expect(await isActive(g, e)).toBe(false); // skipped, not promoted
    expect((await entry(g, e)).promoted_at).toBeNull();
    expect(await isActive(g, f)).toBe(true); // next eligible promoted instead
  });

  it("skips a blocked entry in the other direction too (member blocked the waitlisted user)", async () => {
    const { g, members } = await fullGroup();
    const [e, f] = [await mkUser("e"), await mkUser("f")];
    const code = await mkInvite(g, members[0]);
    await rpc("redeem_invite", [code, e]);
    await rpc("redeem_invite", [code, f]);
    await q(`update waitlist_entries set requested_at = now() - interval '1 hour'
             where group_id=$1 and user_id=$2`, [g, e]);

    await rpc("block_user", [members[0], e]); // sitting member blocked e

    await rpc("leave_group", [g, members[3]]);

    expect(await isActive(g, e)).toBe(false);
    expect(await isActive(g, f)).toBe(true);
  });

  it("skips a free-tier entry already at the 3-group limit and promotes the next", async () => {
    const { g, members } = await fullGroup();
    const [e, f] = [await mkUser("e"), await mkUser("f")];
    // e now has 3 groups (solo + 2 created) with no entitlement.
    await rpc("create_group", [e]);
    await rpc("create_group", [e]);
    const code = await mkInvite(g, members[0]);
    await rpc("redeem_invite", [code, e]); // waitlisted (group is full)
    await rpc("redeem_invite", [code, f]);
    await q(`update waitlist_entries set requested_at = now() - interval '1 hour'
             where group_id=$1 and user_id=$2`, [g, e]); // e is first in line

    await rpc("leave_group", [g, members[3]]);

    expect(await isActive(g, e)).toBe(false); // over the limit: not promoted
    expect((await entry(g, e)).promoted_at).toBeNull(); // but still queued
    expect(await isActive(g, f)).toBe(true); // next eligible promoted instead
  });

  it("an entitled entry at the limit IS promoted", async () => {
    const { g, members } = await fullGroup();
    const e = await mkUser("e");
    await rpc("create_group", [e]);
    await rpc("create_group", [e]);
    await entitle(e);
    const code = await mkInvite(g, members[0]);
    await rpc("redeem_invite", [code, e]);

    await rpc("leave_group", [g, members[3]]);

    expect(await isActive(g, e)).toBe(true);
  });

  it("v3 merge applies at promotion time too: solo open items move in, solo group deleted", async () => {
    const { g, members } = await fullGroup();
    const e = await mkUser("e");
    const solo = await soloGroupOf(e);
    const open = await addItem(solo, e, "to-move");
    const code = await mkInvite(g, members[0]);
    await rpc("redeem_invite", [code, e]); // waitlisted with only a solo group

    await rpc("leave_group", [g, members[3]]);

    expect(await isActive(g, e)).toBe(true);
    expect((await item(open)).group_id).toBe(g);
    const { rows } = await q(`select deleted_at from groups where id=$1`, [solo]);
    expect(rows[0].deleted_at).not.toBeNull();
    expect(await activeGroups(e)).toEqual([g]);
  });

  it("the 4-member cap holds even for direct inserts (trigger, not app code)", async () => {
    const { g } = await fullGroup();
    const x = await mkUser("x");
    await expect(
      q(`insert into memberships (group_id, user_id) values ($1, $2)`, [g, x])
    ).rejects.toThrow(/group_full/);
  });
});
