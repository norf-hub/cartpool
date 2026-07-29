# Infra / account track (human steps, roughly in lead-time order)

1. **Apple Developer Program** — enroll now; longest lead time (D-U-N-S /
   verification can take weeks). Then: App Store Connect listing draft,
   APNs key (also needed for Expo push).
2. **Google Play Console** — register; new-account review + required
   closed-testing period before production. Draft listing early.
3. **Supabase** — three projects (dev / staging / prod). Enable phone/OTP auth
   (Twilio credentials), apply `supabase/migrations`, enable pg_cron and
   schedule `purge_retention()` daily. Then wire purchase notifications
   (0020): deploy `supabase/functions/send-push` and point the trigger at it.
   The endpoint and key are database settings rather than migration content,
   because a migration is committed to git and the key is a credential:

   ```sql
   alter database postgres
     set cartpool.push_endpoint = 'https://<ref>.supabase.co/functions/v1/send-push';
   alter database postgres
     set cartpool.service_role_key = '<service role key>';
   ```

   Until both are set the trigger is inert — purchases work, nothing sends.
   Note that no push can actually arrive until step 4 exists, since devices
   cannot obtain an Expo token without an EAS `projectId`.
4. **Expo / EAS** — org + project, EAS Build/Submit configured for the three
   channels; register the APNs key and FCM server key with Expo push.
5. **RevenueCat** — separate project/API keys per environment; two store
   products mapped to one `cartpool_unlimited` entitlement — v3.1: a **$10
   one-time purchase** (App Store: non-consumable; Play: one-time in-app
   product), *not* a subscription, so no billing grace periods to configure;
   point the webhook at the deployed `supabase/functions/revenuecat-webhook`
   URL and set the same Authorization value as the `REVENUECAT_WEBHOOK_AUTH`
   function secret. The 3-month free period is server-side (`trial_ends_at`),
   not a store trial — nothing to set up in the stores for it.
6. **GitHub** — repo + branch protection. DONE except branch protection: the
   repo is at github.com/norf-hub/cartpool, CI runs both jobs on push to main
   and on PRs, `package-lock.json` is committed, and CI already uses `npm ci`
   against a `postgres:17` service container.
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
