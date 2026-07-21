# Infra / account track (human steps, roughly in lead-time order)

1. **Apple Developer Program** — enroll now; longest lead time (D-U-N-S /
   verification can take weeks). Then: App Store Connect listing draft,
   APNs key (also needed for Expo push).
2. **Google Play Console** — register; new-account review + required
   closed-testing period before production. Draft listing early.
3. **Supabase** — three projects (dev / staging / prod). Enable phone/OTP auth
   (Twilio credentials), apply `supabase/migrations`, enable pg_cron and
   schedule `purge_retention()` daily.
4. **Expo / EAS** — org + project, EAS Build/Submit configured for the three
   channels; register the APNs key and FCM server key with Expo push.
5. **RevenueCat** — separate project/API keys per environment; two store
   products ($5 / 3-month auto-renew) mapped to one `cartpool_unlimited`
   entitlement; enable store billing grace periods; point the webhook at the
   deployed `supabase/functions/revenuecat-webhook` URL and set the same
   Authorization value as the `REVENUECAT_WEBHOOK_AUTH` function secret.
6. **GitHub** — repo + branch protection; CI already in `.github/workflows`.
   After the first `npm install`, commit `package-lock.json` and switch CI to
   `npm ci`.
7. **cartpool.app domain** — register it and serve the two association files
   that make invite links (`https://cartpool.app/i/{code}`) open the app:
   `/.well-known/apple-app-site-association` (appID
   `<TEAM_ID>.app.cartpool`, paths `/i/*`; needs the Apple team ID from
   step 1) and `/.well-known/assetlinks.json` (package `app.cartpool` +
   the release signing cert's SHA-256 from EAS, step 4). Both must be served
   as JSON over HTTPS with no redirect. Until then the `cartpool://i/{code}`
   scheme works for dev testing, and the code-entry field is the fallback on
   any device. `/i/{code}` should also render a small web page ("get the
   app") for people without it installed.
