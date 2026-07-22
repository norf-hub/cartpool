import { q, rpc } from "./db";

let n = 0;
const uniquePhone = () =>
  `+1${Date.now() % 1_000_000_000}${++n}${Math.floor(Math.random() * 900) + 100}`;

/** Create a user; create_user() also creates their solo group + subscription row. */
export async function mkUser(name = "user"): Promise<string> {
  n += 1;
  return rpc<string>("create_user", [uniquePhone(), `${name}${n}`]);
}

export async function activeGroups(user: string): Promise<string[]> {
  const { rows } = await q(
    `select m.group_id from memberships m
     join groups g on g.id = m.group_id
     where m.user_id = $1 and m.left_at is null and g.deleted_at is null
     order by m.joined_at`,
    [user]
  );
  return rows.map((r) => r.group_id);
}

export async function soloGroupOf(user: string): Promise<string> {
  const gs = await activeGroups(user);
  if (gs.length !== 1) throw new Error(`expected exactly 1 group, got ${gs.length}`);
  return gs[0];
}

/**
 * Create a group containing `members` (first member creates it; the rest are
 * inserted directly — fixtures bypass the invite flow for speed, but still go
 * through the membership trigger).
 */
export async function mkGroupWith(members: string[]): Promise<string> {
  const r = await rpc<{ ok: boolean; group_id: string; error?: string }>(
    "create_group",
    [members[0]]
  );
  if (!r.ok) throw new Error(`create_group failed: ${r.error}`);
  for (const u of members.slice(1)) {
    await q(`insert into memberships (group_id, user_id) values ($1, $2)`, [
      r.group_id,
      u,
    ]);
  }
  return r.group_id;
}

export async function addItem(
  group: string,
  user: string,
  text: string,
  opts: { isBulk?: boolean; note?: string } = {}
): Promise<string> {
  const r = await rpc<{ ok: boolean; item_id: string; error?: string }>("add_item", [
    group,
    user,
    text,
    opts.isBulk ?? false,
    opts.note ?? null,
  ]);
  if (!r.ok) throw new Error(`add_item failed: ${r.error}`);
  return r.item_id;
}

export async function mkInvite(
  group: string,
  byUser: string,
  channel: "phone" | "email" | "link" = "link"
): Promise<string> {
  const r = await rpc<{ ok: boolean; code: string; error?: string }>("create_invite", [
    group,
    byUser,
    channel,
    null,
  ]);
  if (!r.ok) throw new Error(`create_invite failed: ${r.error}`);
  return r.code;
}

/** Grant the lifetime entitlement (v3.1: one-time $10 purchase). */
export const entitle = (user: string) =>
  rpc("handle_entitlement_event", [user, "NON_RENEWING_PURCHASE"]);

/** Put the user past their 3-month signup trial (v3.1). */
export const expireTrial = (user: string) =>
  q(`update subscriptions set trial_ends_at = now() - interval '1 day'
     where user_id = $1`, [user]);

export async function subscription(user: string) {
  const { rows } = await q(`select * from subscriptions where user_id = $1`, [user]);
  return rows[0];
}

export async function item(id: string) {
  const { rows } = await q(`select * from items where id = $1`, [id]);
  return rows[0];
}
