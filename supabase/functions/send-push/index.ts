// Purchase push delivery with the §4.2 stacking behavior: instant per-item
// delivery, grouped presentation keyed by group_id.
//
// Invoked by the on_item_purchased trigger (0020) via pg_net. WHO to notify
// and WHETHER they are muted are decided in Postgres by purchase_notice(),
// not here — those are §6 correctness rules and the test suite runs against
// real Postgres, so they belong somewhere they can be proven. This function
// is the dumb sender: a resolved recipient in, an Expo request out.
//
// It used to fan out to every active member of the item's group_id. That was
// stale as of v3.3 (0013), which made group_id provenance only and gave items
// to their adder — so it told four people about a transaction between two.
//
// TODO(verify): confirm the current Expo Push API field for APNs thread-id.
// If it is not exposed, either patch it via a Notification Service Extension
// or send iOS pushes through bare APNs; grouping is a §4.2 requirement, not a
// nice-to-have.
import { createClient } from "npm:@supabase/supabase-js@2";

// Exactly the payload purchase_notice() returns.
type PurchaseNotice = {
  item_id: string;
  user_id: string; // the recipient: the item's adder
  group_id: string; // stacking key only
  buyer_id: string;
  item_text: string;
  title: string;
  body: string;
};

Deno.serve(async (req) => {
  const notice: PurchaseNotice = await req.json();
  if (!notice?.user_id || !notice?.body) {
    return new Response("bad request", { status: 400 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // One message per registered device — a user may have several.
  const { data: tokens, error } = await supabase
    .from("push_tokens")
    .select("token")
    .eq("user_id", notice.user_id);
  if (error) return new Response("error", { status: 500 });

  const messages = (tokens ?? []).map((t: { token: string }) => ({
    to: t.token,
    title: notice.title,
    body: notice.body,
    channelId: `group-${notice.group_id}`, // Android: per-group channel = stacked tray
    // iOS grouping: apns thread-id = group_id (see TODO above)
    data: { item_id: notice.item_id, group_id: notice.group_id },
  }));
  // No device registered yet is the normal state until EAS exists, not a fault.
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