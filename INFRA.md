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
