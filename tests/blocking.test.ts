// Section 6 — Blocking (v3: removal one-directional, co-placement bar bidirectional)
import { describe, it, expect } from "vitest";
import { rpc, q } from "./helpers/db";
import {
  activeGroups,
  addItem,
  item,
  mkGroupWith,
  mkInvite,
  mkUser,
} from "./helpers/fixtures";

type R = { ok: boolean; error?: string };

describe("A blocks B", () => {
  // 0013 cross-group model: blocking makes A leave shared groups (via
  // leave_group), so A's open items there re-home to A's own list rather than
  // being deleted — and, sharing no group with B any longer, simply stop
  // being visible to B. Mirrors the leave.test.ts re-home change.
  it("removes A from every shared group (open items re-home); non-shared groups untouched; B unaffected", async () => {
    const [A, B, C] = [await mkUser("A"), await mkUser("B"), await mkUser("C")];
    const shared = await mkGroupWith([A, B]);
    const unshared = await mkGroupWith([A, C]);

    const aOpenShared = await addItem(shared, A, "A-open-shared");
    const aOpenUnshared = await addItem(unshared, A, "A-open-unshared");
    const bOpen = await addItem(shared, B, "B-open");

    const r = await rpc<R>("block_user", [A, B]);
    expect(r.ok).toBe(true);

    const active = async (g: string, u: string) =>
      (
        await q(
          `select 1 from memberships where group_id=$1 and user_id=$2 and left_at is null`,
          [g, u]
        )
      ).rows.length > 0;

    expect(await active(shared, A)).toBe(false); // A left the shared group
    expect(await active(unshared, A)).toBe(true); // only shared groups
    expect(await active(shared, B)).toBe(true); // B is not removed from anything

    const reHomed = await item(aOpenShared);
    expect(reHomed.status).toBe("open"); // A keeps their own item
    expect(reHomed.group_id).not.toBe(shared); // moved off the blocked group
    // home_group() re-homes to A's OLDEST active group — the solo list every
    // user gets at signup, not necessarily `unshared`.
    expect(await activeGroups(A)).toContain(reHomed.group_id);
    expect(await item(aOpenUnshared)).toBeDefined();
    expect((await item(bOpen)).status).toBe("open"); // B's items untouched
  });

  it("bars A from joining a group containing B — invite and link/code redemption", async () => {
    const [A, B, D] = [await mkUser("A"), await mkUser("B"), await mkUser("D")];
    await rpc("block_user", [A, B]);

    const bGroup = await mkGroupWith([B, D]);
    for (const channel of ["phone", "link"] as const) {
      const code = await mkInvite(bGroup, B, channel);
      const r = await rpc<R>("redeem_invite", [code, A]);
      expect(r).toMatchObject({ ok: false, error: "not_available" }); // silent to B
    }
  });

  it("v3: also bars B from joining a group containing A (bidirectional)", async () => {
    const [A, B, D] = [await mkUser("A"), await mkUser("B"), await mkUser("D")];
    await rpc("block_user", [A, B]);

    const aGroup = await mkGroupWith([A, D]);
    const code = await mkInvite(aGroup, A, "link");
    const r = await rpc<R>("redeem_invite", [code, B]);
    expect(r).toMatchObject({ ok: false, error: "not_available" });
  });

  it("membership trigger is a backstop at every entry point, both directions", async () => {
    const [A, B] = [await mkUser("A"), await mkUser("B")];
    await rpc("block_user", [A, B]);
    const aGroup = await mkGroupWith([A]);
    const bGroup = await mkGroupWith([B]);

    await expect(
      q(`insert into memberships (group_id, user_id) values ($1, $2)`, [bGroup, A])
    ).rejects.toThrow(/blocked_coplacement/);
    await expect(
      q(`insert into memberships (group_id, user_id) values ($1, $2)`, [aGroup, B])
    ).rejects.toThrow(/blocked_coplacement/);
  });

  it("blocking twice is idempotent; blocking yourself is rejected", async () => {
    const [A, B] = [await mkUser("A"), await mkUser("B")];
    expect((await rpc<R>("block_user", [A, B])).ok).toBe(true);
    expect((await rpc<R>("block_user", [A, B])).ok).toBe(true);
    expect((await rpc<R>("block_user", [A, A])).ok).toBe(false);
  });
});
