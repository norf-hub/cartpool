// 0006 — signup provisioning trigger + push token registration.
// The auth.users shim in 0006 lets the real trigger path run on bare Postgres.
//
// These inserts supply auth.users.id explicitly. The 0006 shim defaults it,
// but Supabase's real gotrue-owned auth.users does not (gotrue always
// supplies the id), so an id-less insert passes on bare Postgres and fails
// against a local Supabase stack. Passing it keeps the suite honest on both,
// and mirrors what gotrue does at signup.
import { describe, it, expect } from "vitest";
import { rpc, q } from "./helpers/db";
import { mkUser, activeGroups, subscription } from "./helpers/fixtures";

let n = 0;
const phone = () => `+1555${Date.now() % 1_000_000}${++n}`;

describe("signup provisioning (auth.users trigger)", () => {
  it("an auth signup provisions users row (same id), subscription, and solo group", async () => {
    const p = phone();
    const { rows } = await q(
      `insert into auth.users (id, phone, raw_user_meta_data)
       values (gen_random_uuid(), $1, '{"display_name":"Norf"}') returning id`,
      [p]
    );
    const authId = rows[0].id;

    const u = (await q(`select * from users where id = $1`, [authId])).rows[0];
    expect(u).toBeDefined(); // users.id = auth id — required by the api wrappers
    expect(u.phone_number).toBe(p);
    expect(u.display_name).toBe("Norf");
    expect(await subscription(authId)).toBeDefined();
    expect((await activeGroups(authId)).length).toBe(1); // solo group from day one
  });

  it("missing display_name metadata falls back to a placeholder", async () => {
    const { rows } = await q(
      `insert into auth.users (id, phone) values (gen_random_uuid(), $1) returning id`,
      [phone()]
    );
    const u = (await q(`select display_name from users where id = $1`, [rows[0].id]))
      .rows[0];
    expect(u.display_name).toBe("New user");
  });
});

describe("push token registration", () => {
  type R = { ok: boolean; error?: string };
  const tok = () => `ExponentPushToken[test-${Date.now()}-${++n}]`;

  it("registers a token and bumps last_seen_at on re-register", async () => {
    const u = await mkUser("u");
    const t = tok();
    expect(await rpc<R>("register_push_token", [u, t, "ios"])).toMatchObject({ ok: true });

    await q(`update push_tokens set last_seen_at = now() - interval '1 day' where token=$1`, [t]);
    expect(await rpc<R>("register_push_token", [u, t, "ios"])).toMatchObject({ ok: true });

    const { rows } = await q(`select * from push_tokens where token = $1`, [t]);
    expect(rows.length).toBe(1); // upsert, not duplicate
    expect(new Date(rows[0].last_seen_at).getTime()).toBeGreaterThan(
      Date.now() - 60_000
    );
  });

  it("re-registering an existing token re-points it at the new account", async () => {
    const [a, b] = [await mkUser("a"), await mkUser("b")];
    const t = tok();
    await rpc("register_push_token", [a, t, "android"]);
    await rpc("register_push_token", [b, t, "android"]); // device handed off / re-login

    const { rows } = await q(`select user_id from push_tokens where token = $1`, [t]);
    expect(rows.length).toBe(1);
    expect(rows[0].user_id).toBe(b);
  });

  it("rejects unknown platforms", async () => {
    const u = await mkUser("u");
    expect(await rpc<R>("register_push_token", [u, tok(), "web"])).toMatchObject({
      ok: false,
      error: "bad_platform",
    });
  });

  it("unregister only works for the owning user", async () => {
    const [a, b] = [await mkUser("a"), await mkUser("b")];
    const t = tok();
    await rpc("register_push_token", [a, t, "ios"]);

    expect(await rpc<R>("unregister_push_token", [b, t])).toMatchObject({
      ok: false,
      error: "not_found",
    });
    expect(await rpc<R>("unregister_push_token", [a, t])).toMatchObject({ ok: true });
    expect((await q(`select 1 from push_tokens where token=$1`, [t])).rows.length).toBe(0);
  });
});
