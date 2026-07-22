// RevenueCat webhook -> public.handle_entitlement_event()
// Deploy: supabase functions deploy revenuecat-webhook --no-verify-jwt
// Configure the same URL + Authorization value in the RevenueCat dashboard.
//
// RevenueCat authenticates webhooks with a static Authorization header you
// choose (set it as the REVENUECAT_WEBHOOK_AUTH secret), not an HMAC
// signature — constant-time compare and reject anything else.
import { createClient } from "npm:@supabase/supabase-js@2";

// v3.1: one-time lifetime purchase — no renewals, expirations, or billing
// grace. RevenueCat reports one-time purchases as NON_RENEWING_PURCHASE.
const HANDLED = new Set([
  "INITIAL_PURCHASE",
  "NON_RENEWING_PURCHASE",
  "REFUND",
]);

function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

Deno.serve(async (req) => {
  const expected = Deno.env.get("REVENUECAT_WEBHOOK_AUTH");
  const got = req.headers.get("authorization") ?? "";
  if (!expected || !timingSafeEqual(got, expected)) {
    return new Response("unauthorized", { status: 401 });
  }

  let event: { type?: string; app_user_id?: string };
  try {
    ({ event } = await req.json());
  } catch {
    return new Response("bad payload", { status: 400 });
  }
  if (!event?.type || !event.app_user_id) {
    return new Response("bad payload", { status: 400 });
  }

  // app_user_id IS the internal user id (set at login; spec §9) — no mapping.
  // Events we don't model (TRANSFER, PRODUCT_CHANGE, TEST, ...) are ack'd so
  // RevenueCat stops retrying; entitlement re-syncs on app foreground anyway.
  if (!HANDLED.has(event.type)) {
    return new Response(JSON.stringify({ ignored: event.type }), { status: 200 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")! // service_role: core fn access
  );
  const { data, error } = await supabase.rpc("handle_entitlement_event", {
    p_user: event.app_user_id,
    p_event: event.type,
  });
  if (error) {
    console.error("handle_entitlement_event failed", error);
    return new Response("error", { status: 500 }); // 5xx -> RevenueCat retries
  }
  return new Response(JSON.stringify(data), { status: 200 });
});
