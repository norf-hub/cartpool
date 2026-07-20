// Purchase push fan-out with the §4.2 stacking behavior:
// instant per-item delivery, grouped presentation keyed by group_id.
//
// Invoked by a database webhook on items UPDATE (status -> 'purchased'), or
// directly from other functions. Sends one push per recipient per item —
// the OS collapses them into a per-group stack via channelId (Android) and
// the APNs thread-id (iOS).
//
// TODO(verify): confirm the current Expo Push API field for APNs
// thread-id. If it is not exposed, either patch it via a Notification
// Service Extension or send iOS pushes through bare APNs; grouping is a
// §4.2 requirement, not a nice-to-have.
import { createClient } from "npm:@supabase/supabase-js@2";

type PurchaseEvent = {
  item_id: string;
  group_id: string;
  buyer_id: string;
  item_text: string;
};

Deno.serve(async (req) => {
  const { item_id, group_id, buyer_id, item_text }: PurchaseEvent = await req.json();

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // Recipients: active members except the buyer, minus mutes
  // (mute_override, else global_mute).
  const { data: recipients, error } = await supabase
    .from("memberships")
    .select("user_id, mute_override, users!inner(global_mute)")
    .eq("group_id", group_id)
    .is("left_at", null)
    .neq("user_id", buyer_id);
  if (error) return new Response("error", { status: 500 });

  const unmuted = (recipients ?? []).filter((r: any) =>
    r.mute_override !== null ? !r.mute_override : !r.users.global_mute
  );
  if (unmuted.length === 0) return new Response("ok", { status: 200 });

  const { data: buyer } = await supabase
    .from("users")
    .select("display_name")
    .eq("id", buyer_id)
    .single();

  // One message per registered device (a user may have several).
  const { data: tokens, error: tokenErr } = await supabase
    .from("push_tokens")
    .select("user_id, token")
    .in("user_id", unmuted.map((r: any) => r.user_id));
  if (tokenErr) return new Response("error", { status: 500 });

  const messages = (tokens ?? []).map((t: any) => ({
    to: t.token,
    title: "Cartpool",
    body: `${buyer?.display_name ?? "Someone"} bought ${item_text}`,
    channelId: `group-${group_id}`, // Android: per-group channel = stacked tray
    // iOS grouping: apns thread-id = group_id (see TODO above)
    data: { item_id, group_id },
  }));
  if (messages.length === 0) return new Response("ok", { status: 200 });
  // TODO: parse Expo push receipts; delete push_tokens rows that come back
  // DeviceNotRegistered (service_role has delete for exactly this).

  const res = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(messages),
  });
  return new Response(await res.text(), { status: res.status });
});
