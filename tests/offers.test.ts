// v3.2 — "Up for grabs": post surplus units, groupmates claim 1..n of them.
// Claims are per-unit and accumulate per user; the decrement is an atomic
// conditional UPDATE, so racing claims can't oversell the pack.
import { describe, it, expect } from "vitest";
import { rpc, q } from "./helpers/db";
import { mkUser, mkGroupWith, expireTrial } from "./helpers/fixtures";

type R = {
  ok: boolean;
  error?: string;
  offer_id?: string;
  qty_remaining?: number;
};

async function offerRow(id: string) {
  const { rows } = await q(`select * from offers where id = $1`, [id]);
  return rows[0];
}

async function claimOf(offer: string, user: string) {
  const { rows } = await q(
    `select * from offer_claims where offer_id = $1 and user_id = $2`,
    [offer, user]
  );
  return rows[0];
}

/** Joe + Bill in a group; Joe posts 3 spare nail clippers. */
async function joeAndBill(qty = 3, priceCents: number | null = null) {
  const [joe, bill] = [await mkUser("joe"), await mkUser("bill")];
  const g = await mkGroupWith([joe, bill]);
  const r = await rpc<R>("create_offer", [g, joe, "nail clippers", qty, priceCents]);
  if (!r.ok) throw new Error(r.error);
  return { joe, bill, g, offer: r.offer_id! };
}

describe("posting", () => {
  it("a member posts surplus with a quantity; price is optional (null = free)", async () => {
    const { offer } = await joeAndBill(3, null);
    const row = await offerRow(offer);
    expect(row.qty_offered).toBe(3);
    expect(row.qty_remaining).toBe(3);
    expect(row.unit_price_cents).toBeNull();
  });

  it("the price is a label the poster chooses — at-cost or named, same field", async () => {
    const { offer } = await joeAndBill(4, 300);
    expect((await offerRow(offer)).unit_price_cents).toBe(300);
  });

  it("non-members cannot post; zero/negative quantities rejected", async () => {
    const [a, outsider] = [await mkUser("a"), await mkUser("out")];
    const g = await mkGroupWith([a]);
    expect(await rpc<R>("create_offer", [g, outsider, "x", 1, null])).toMatchObject({
      ok: false,
      error: "not_a_member",
    });
    expect(await rpc<R>("create_offer", [g, a, "x", 0, null])).toMatchObject({
      ok: false,
      error: "bad_qty",
    });
  });
});

describe("claiming units", () => {
  it("one person can claim 1, 2, or all 3 — and repeat claims accumulate", async () => {
    const { bill, offer } = await joeAndBill(3);

    let r = await rpc<R>("claim_offer", [offer, bill, 2]);
    expect(r).toMatchObject({ ok: true, qty_remaining: 1 });
    expect((await claimOf(offer, bill)).qty).toBe(2);

    r = await rpc<R>("claim_offer", [offer, bill, 1]); // Bill takes the last one too
    expect(r).toMatchObject({ ok: true, qty_remaining: 0 });
    expect((await claimOf(offer, bill)).qty).toBe(3); // single row, accumulated
  });

  it("claiming more than remains is rejected with the live count", async () => {
    const { bill, offer } = await joeAndBill(3);
    await rpc("claim_offer", [offer, bill, 2]);
    expect(await rpc<R>("claim_offer", [offer, bill, 2])).toMatchObject({
      ok: false,
      error: "not_enough_left",
      qty_remaining: 1,
    });
  });

  it("the poster cannot claim their own offer", async () => {
    const { joe, offer } = await joeAndBill();
    expect(await rpc<R>("claim_offer", [offer, joe, 1])).toMatchObject({
      ok: false,
      error: "own_offer",
    });
  });

  it("racing claims for the last units get exactly one winner", async () => {
    const [joe, b, c, d] = await Promise.all(
      ["joe", "b", "c", "d"].map((x) => mkUser(x))
    );
    const g = await mkGroupWith([joe, b, c, d]);
    const r = await rpc<R>("create_offer", [g, joe, "AA batteries", 1, null]);
    const offer = r.offer_id!;

    const results = await Promise.all(
      [b, c, d, b, c, d].map((u) => rpc<R>("claim_offer", [offer, u, 1]))
    );
    expect(results.filter((x) => x.ok)).toHaveLength(1);
    for (const loser of results.filter((x) => !x.ok)) {
      expect(loser.error).toBe("not_enough_left");
    }
    expect((await offerRow(offer)).qty_remaining).toBe(0);
  });

  it("concurrent multi-unit claims never oversell the pack", async () => {
    const [joe, b, c, d] = await Promise.all(
      ["joe", "b", "c", "d"].map((x) => mkUser(x))
    );
    const g = await mkGroupWith([joe, b, c, d]);
    const r = await rpc<R>("create_offer", [g, joe, "12 sponges", 5, null]);
    const offer = r.offer_id!;

    await Promise.all(
      [b, c, d].flatMap((u) => [
        rpc<R>("claim_offer", [offer, u, 2]),
        rpc<R>("claim_offer", [offer, u, 1]),
      ])
    );

    const row = await offerRow(offer);
    const { rows } = await q(
      `select coalesce(sum(qty), 0)::int as claimed from offer_claims where offer_id = $1`,
      [offer]
    );
    expect(rows[0].claimed + row.qty_remaining).toBe(5); // conservation
    expect(row.qty_remaining).toBeGreaterThanOrEqual(0);
  });
});

describe("unclaiming", () => {
  it("giving back part or all of a claim restores availability", async () => {
    const { bill, offer } = await joeAndBill(3);
    await rpc("claim_offer", [offer, bill, 3]);

    expect(await rpc<R>("unclaim_offer", [offer, bill, 1])).toMatchObject({ ok: true });
    expect((await claimOf(offer, bill)).qty).toBe(2);
    expect((await offerRow(offer)).qty_remaining).toBe(1);

    expect(await rpc<R>("unclaim_offer", [offer, bill, null])).toMatchObject({ ok: true });
    expect(await claimOf(offer, bill)).toBeUndefined();
    expect((await offerRow(offer)).qty_remaining).toBe(3);
  });

  it("cannot give back more than claimed", async () => {
    const { bill, offer } = await joeAndBill(3);
    await rpc("claim_offer", [offer, bill, 1]);
    expect(await rpc<R>("unclaim_offer", [offer, bill, 2])).toMatchObject({
      ok: false,
      error: "bad_qty",
    });
  });
});

describe("closing & lifecycle", () => {
  it("only the poster can close; claims made before the close stand", async () => {
    const { joe, bill, offer } = await joeAndBill(3);
    await rpc("claim_offer", [offer, bill, 2]);

    expect(await rpc<R>("close_offer", [offer, bill])).toMatchObject({
      ok: false,
      error: "not_poster_or_closed",
    });
    expect(await rpc<R>("close_offer", [offer, joe])).toMatchObject({ ok: true });

    expect(await rpc<R>("claim_offer", [offer, bill, 1])).toMatchObject({
      ok: false,
      error: "closed",
    });
    expect((await claimOf(offer, bill)).qty).toBe(2); // record survives
  });

  it("expired offers reject new claims and purge 14 days later", async () => {
    const { bill, offer } = await joeAndBill(3);
    await q(`update offers set expires_at = now() - interval '1 day' where id = $1`, [offer]);
    expect(await rpc<R>("claim_offer", [offer, bill, 1])).toMatchObject({
      ok: false,
      error: "expired",
    });

    await rpc("purge_retention", []);
    expect(await offerRow(offer)).not.toBeUndefined(); // only 1 day expired

    await q(`update offers set expires_at = now() - interval '15 days' where id = $1`, [offer]);
    await rpc("purge_retention", []);
    expect(await offerRow(offer)).toBeUndefined(); // claims cascade with it
  });

  it("leaving the group closes the leaver's offers and releases their claims", async () => {
    const [joe, bill] = [await mkUser("joe"), await mkUser("bill")];
    const g = await mkGroupWith([joe, bill]);
    const joes = await rpc<R>("create_offer", [g, joe, "clippers", 3, null]);
    const bills = await rpc<R>("create_offer", [g, bill, "tape rolls", 2, null]);
    await rpc("claim_offer", [bills.offer_id, joe, 2]); // Joe claimed Bill's tape

    await rpc("leave_group", [g, joe]);

    expect((await offerRow(joes.offer_id!)).closed_at).not.toBeNull(); // his offer closed
    expect(await claimOf(bills.offer_id!, joe)).toBeUndefined(); // his claim released
    expect((await offerRow(bills.offer_id!)).qty_remaining).toBe(2); // back in the pool
  });

  it("a frozen (post-trial, unpaid, over-limit) user can neither post nor claim", async () => {
    const [joe, bill] = [await mkUser("joe"), await mkUser("bill")];
    const g = await mkGroupWith([joe, bill]);
    const r = await rpc<R>("create_offer", [g, joe, "clippers", 3, null]);

    for (let i = 0; i < 3; i++) await rpc("create_group", [bill]);
    await expireTrial(bill);
    await rpc("expire_trials", []);

    expect(await rpc<R>("claim_offer", [r.offer_id, bill, 1])).toMatchObject({
      ok: false,
      error: "read_only",
    });
    expect(await rpc<R>("create_offer", [g, bill, "x", 1, null])).toMatchObject({
      ok: false,
      error: "read_only",
    });
  });
});
