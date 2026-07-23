// 0004_auth.sql — identity binding, RLS, and lockdown of the internal surface.
// Simulates PostgREST: role `authenticated` + request.jwt.claims GUC.
import { describe, it, expect } from "vitest";
import type { PoolClient } from "pg";
import { pool, q } from "./helpers/db";
import { mkUser, mkGroupWith, addItem, item } from "./helpers/fixtures";

/** Run fn on a dedicated connection impersonating a signed-in (or anonymous) client. */
async function asUser<T>(
  uid: string | null,
  fn: (c: PoolClient) => Promise<T>
): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query(`select set_config('request.jwt.claims', $1, false)`, [
      uid ? JSON.stringify({ sub: uid, role: "authenticated" }) : "",
    ]);
    await c.query(`set role authenticated`);
    return await fn(c);
  } finally {
    await c.query(`reset role`);
    await c.query(`select set_config('request.jwt.claims', '', false)`);
    c.release();
  }
}

describe("api wrappers bind identity to auth.uid()", () => {
  it("the acting user is taken from the JWT, not from parameters", async () => {
    const [a, b] = [await mkUser("adder"), await mkUser("buyer")];
    const g = await mkGroupWith([a, b]);
    const it1 = await addItem(g, a, "eggs");

    const r = await asUser(b, async (c) => {
      const { rows } = await c.query(`select api.mark_purchased($1) as r`, [it1]);
      return rows[0].r;
    });
    expect(r.ok).toBe(true);
    expect((await item(it1)).purchased_by).toBe(b); // b, because b's JWT said so
  });

  it("unauthenticated calls are rejected", async () => {
    const a = await mkUser("a");
    const g = await mkGroupWith([a]);
    const it1 = await addItem(g, a, "milk");

    await expect(
      asUser(null, (c) => c.query(`select api.mark_purchased($1)`, [it1]))
    ).rejects.toThrow(/unauthenticated/);
  });

  it("the internal parameterized functions are not callable by clients", async () => {
    const [a, b] = [await mkUser("a"), await mkUser("b")];
    const g = await mkGroupWith([a, b]);
    const it1 = await addItem(g, a, "butter");

    // A client trying to act as someone else via the internal surface:
    await expect(
      asUser(b, (c) => c.query(`select public.mark_purchased($1, $2)`, [it1, a]))
    ).rejects.toThrow(/permission denied/);
  });

  it("set_large_text (0014): writes only the caller's own row; internal surface locked", async () => {
    const [a, b] = [await mkUser("a"), await mkUser("b")];

    const r = await asUser(a, async (c) => {
      const { rows } = await c.query(`select api.set_large_text(true) as r`);
      return rows[0].r;
    });
    expect(r.ok).toBe(true);

    const flags = await q(
      `select id, large_text_mode from users where id = any($1) order by id`,
      [[a, b].sort()]
    );
    const flagOf = (u: string) => flags.rows.find((x) => x.id === u)!.large_text_mode;
    expect(flagOf(a)).toBe(true); // caller's row flipped
    expect(flagOf(b)).toBe(false); // no one else's

    // The parameterized core can't be used to flip someone else's setting.
    await expect(
      asUser(b, (c) => c.query(`select public.set_large_text($1, true)`, [a]))
    ).rejects.toThrow(/permission denied/);
  });

  it("clients cannot write tables directly", async () => {
    const a = await mkUser("a");
    const g = await mkGroupWith([a]);

    await expect(
      asUser(a, (c) =>
        c.query(
          `insert into items (group_id, added_by, text) values ($1, $2, 'sneaky')`,
          [g, a]
        )
      )
    ).rejects.toThrow(/permission denied/);
  });
});

describe("row level security", () => {
  it("users: a client sees only their own row; co-member names come from the view, without phone numbers", async () => {
    const [a, b] = [await mkUser("me"), await mkUser("neighbor")];
    await mkGroupWith([a, b]);

    await asUser(a, async (c) => {
      const users = await c.query(`select id from users`);
      expect(users.rows.map((r) => r.id)).toEqual([a]);

      const profiles = await c.query(`select * from api.member_profiles order by display_name`);
      const ids = profiles.rows.map((r) => r.id);
      expect(ids).toContain(a);
      expect(ids).toContain(b);
      for (const row of profiles.rows) {
        expect(Object.keys(row).sort()).toEqual(["display_name", "id"]); // no phone, no email
      }
    });
  });

  it("items: visible to group members, invisible to outsiders", async () => {
    const [a, b, outsider] = [await mkUser("a"), await mkUser("b"), await mkUser("x")];
    const g = await mkGroupWith([a, b]);
    const it1 = await addItem(g, a, "visible-to-members");

    await asUser(b, async (c) => {
      const { rows } = await c.query(`select id from items where id = $1`, [it1]);
      expect(rows).toHaveLength(1);
    });
    await asUser(outsider, async (c) => {
      const { rows } = await c.query(`select id from items where id = $1`, [it1]);
      expect(rows).toHaveLength(0);
    });
  });

  it("blocks are invisible to every client, both sides", async () => {
    const [a, b] = [await mkUser("A"), await mkUser("B")];
    await q(`select block_user($1, $2)`, [a, b]);

    for (const u of [a, b]) {
      await expect(
        asUser(u, (c) => c.query(`select * from blocks`))
      ).rejects.toThrow(/permission denied/);
    }
  });

  it("subscriptions: own row only", async () => {
    const [a, b] = [await mkUser("a"), await mkUser("b")];
    await mkGroupWith([a, b]);
    await asUser(a, async (c) => {
      const { rows } = await c.query(`select user_id from subscriptions`);
      expect(rows.map((r) => r.user_id)).toEqual([a]);
    });
  });
});
