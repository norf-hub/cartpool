# Cartpool

Shared shopping lists for small groups (max 4), with bulk-item splitting.
Implements **Product Spec v3** (+ amendments through v3.6 — account deletion and
large text by default) and the Technical Addendum: React Native (Expo) client,
Supabase (Postgres + Realtime) backend, RevenueCat for the one-time unlock
purchase.

**Monetization (v3.1):** 3 months of unlimited groups from signup, then a
one-time $10 lifetime purchase for more than the 3 free groups. No recurring
subscription.

## Layout

```
app/                    Expo app (TypeScript). The four-tab shell is built:
                        List / Groups / Grabs / You, onboarding, invites,
                        bulk items, offers, settings, paywall (stubbed).
  src/screens/MainTabs.tsx    The signed-in shell; owns the single useCartpool
  src/hooks/useCartpool.ts    All client state + every mutation, via rpc.ts
  src/api/rpc.ts        Typed wrappers for the server RPCs
  src/theme/accessibility.ts  Hard a11y constraints (44pt targets, 1.4x scale, tap budgets)
supabase/
  migrations/0001_schema.sql     Tables (v3: items.group_id NOT NULL — solo list is a real group)
  migrations/0002_triggers.sql   4-member cap + bidirectional block bar (advisory-lock trigger)
  migrations/0003_functions.sql  All state-transition logic as Postgres functions
  migrations/0004_auth.sql       auth.uid() wrappers (api schema) + RLS on every table
  migrations/0005_cron.sql       pg_cron schedule for purge_retention() (NOTICE on bare Postgres)
  migrations/0006_push_and_signup.sql  push_tokens + registration RPCs; auth.users signup trigger
  migrations/0007_realtime.sql   Realtime publication for items/memberships
  migrations/0008_email_signup.sql  Dev email sign-in path alongside phone/OTP
  migrations/0009_realtime_bulk.sql  bulk_opt_ins added to the publication
  migrations/0010_set_item_bulk.sql  Flip an existing item to/from bulk, edit its note
  migrations/0011_one_time_purchase.sql  v3.1: trial_ends_at, is_entitled(), expire_trials() cron, purchase+refund-only lifecycle
  migrations/0012_offers.sql     v3.2: "up for grabs" — post surplus units, per-unit accumulating claims, price-as-label
  migrations/0013_cross_group_items.sql  v3.3: one canonical row visible to the adder's whole pool; first buyer anywhere clears it everywhere; leave re-homes instead of deleting
  migrations/0014_set_large_text.sql  Persist the large-text toggle on the profile
  migrations/0015_display_name.sql    Set display name + finish onboarding
  migrations/0016_group_names.sql  v3.4: nameable groups (any member renames; empty clears to the member-name fallback)
  migrations/0017_large_text_default.sql  v3.6: large text ON for new accounts
  migrations/0018_mute_toggles.sql  §6 setters for global_mute and the per-group override (columns existed since 0001; send-push already read them)
  migrations/0019_delete_account.sql  v3.6: in-app account deletion, hard delete, FK-safe order (App Store 5.1.1(v))
  migrations/0020_purchase_notifications.sql  §6: notify the item's ADDER when someone buys it — purchase_notice() decides recipient + mutes, trigger delivers via pg_net
  functions/revenuecat-webhook/  Edge function -> handle_entitlement_event (service_role)
  functions/send-push/           Dumb sender: resolved recipient in, Expo request out, §4.2 per-group stacking. Invoked by 0020's trigger
tests/                  Section 6 unit tests + auth tests (vitest + pg, real Postgres)
.github/workflows/ci.yml         Tests run against a postgres:17 service container
```

## Why the logic lives in Postgres

The riskiest transitions (purchase race, cap enforcement, waitlist promotion)
are only correct when serialized at the database: `mark_purchased` is a single
atomic conditional `UPDATE`, and the membership trigger takes a per-group
advisory lock. The test suite therefore runs against a real Postgres, not mocks.

**Auth model (0004_auth.sql):** the parameterized functions in `public` are not
executable by clients. The client surface is the `api` schema — `SECURITY
DEFINER` wrappers that bind the acting user to `auth.uid()` (supabase-js is
configured with `db.schema = 'api'`). Every table has RLS with read-only
policies; there are no client write policies at all, so mutation is only
possible through the wrappers. `blocks` has no policy and no grant — invisible
to both sides, per spec. Phone numbers never leave the `users` self-row policy;
co-member names come from the `api.member_profiles` view. The tests simulate
PostgREST (role + JWT-claims GUC) in `auth.test.ts`, and guarded shims let the
same migration apply to bare Postgres in CI.

## Running the tests

Run `npm install` from the **repo root**, not from `tests/` — this is an npm
workspace, and a root install covers both `app` and `tests` and produces the
single root `package-lock.json` that CI's `npm ci` expects.

```bash
npm install

# Option A: local Supabase stack. Tests use their own cartpool_test database
# (created automatically) so they never touch the app's data on the same stack.
supabase start && npm test

# Option B: any Postgres
docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:17
DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npm test
```

On Windows PowerShell the Option B env-var syntax above does not work; see
`RUN-TESTS-WALKTHROUGH.md`, which also covers the Windows-specific case where
Docker silently fails to publish 54321-54323 because WinNAT has reserved them.

On npm 11+, esbuild's postinstall is blocked by default and vitest needs it;
run `npm approve-scripts esbuild && npm rebuild esbuild` after the first
install. On Windows, keep the checkout out of any `AppData\Local\Packages\...`
container directory — npm cannot spawn child processes reliably inside one.

The suite drops and rebuilds `public` from `supabase/migrations` on each run.

## What the tests pin down (addendum §6, updated to v3)

| File | Guarantees |
|---|---|
| `purchase.test.ts` | One winner under concurrent marks; typed "already purchased by {name}"; unmark restricted to the buyer; **v3: adder may purchase their own item** |
| `leave.test.ts` | Open items vanish; purchased items survive exactly 2 days with the leaver's name; buyer leaving preserves history; last leaver soft-deletes; **v3: fresh solo group when leaving the last group** |
| `blocking.test.ts` | A leaves shared groups only; B untouched; **v3: co-placement barred both directions** at invite, link/code, and direct-insert (trigger backstop) |
| `waitlist.test.ts` | Strict FCFS by `requested_at`, ties by insertion; blocked entries (either direction) skipped, next promoted; server-side expiry; cap trigger; **v3: solo merge on first invite and at promotion**; free-tier limit at redemption *and* promotion (skipped entries stay queued); CSPRNG invite-code format; merged purchased items enter the 2-day grace purge |
| `bulk.test.ts` | Pre-commit vs retroactive flags; text edits force reconfirmation; only buyer assigns retroactively |
| `subscription.test.ts` | v3.1: signup trial allows >3 groups; `expire_trials()` freezes unpaid over-limit users (no re-freeze after a pick); refund freezes only past-trial + over-limit; **v3 freeze scope: read-only everywhere → pick 3 → excess-only**; one-time purchase clears without re-pick; subscription-era events rejected |
| `auth.test.ts` | Wrappers bind identity to `auth.uid()`; unauthenticated rejected; internal functions and direct table writes are `permission denied`; RLS row visibility incl. invisible `blocks` and phone-free profiles |
| `offers.test.ts` | v3.2 up-for-grabs: multi-unit accumulating claims (Bill takes 1, 2, or all 3); racing claims can't oversell (conservation check); unclaim restores; poster-only close with claims standing; expiry + purge; leave-group housekeeping; frozen users barred |
| `cross-group.test.ts` | v3.3: one canonical item row visible to the adder's whole pool; first buyer anywhere clears it everywhere; leaving re-homes rather than deletes |
| `provisioning.test.ts` | 0006 signup trigger provisions users row (same id) + subscription + solo group; display-name fallback; **v3.6: large text on by default**; push token upsert, re-pointing on re-login, platform validation, owner-only unregister |
| `notifications.test.ts` | §6 purchase notices: addressed to the **adder**, not the group (v3.3); silent on an open item and on checking off your own; global mute; per-group override both ways (silence one group, unmute one group under a global mute) and clearing it; the trigger never costs a purchase when push is unconfigured, and stays silent on unmark |
| `delete-account.test.ts` | v3.6 hard delete: every referencing row goes; items others added are handed back as `open`; the leaver's own items go even when someone else paid (the accepted cost); emptied groups soft-deleted while shared ones survive; blocks cleared both directions; second delete is `not_found` |

## Not yet built

Ordered by what blocks a submission. Infra/account steps are in `INFRA.md`.

- **The purchase itself.** `PaywallSheet` shows a "not available yet" alert on
  Buy. `react-native-purchases` is already a dependency, so this is wiring plus
  RevenueCat store products, which need the Apple/Google accounts first
  (INFRA.md steps 1, 2, 5). Must be real before submitting.
- **Notifications are wired but undeliverable.** 0020 added the missing
  invocation: a trigger on the open→purchased transition calls
  `purchase_notice()` (recipient + mute rules, covered by
  `notifications.test.ts`) and posts it to `send-push` via `pg_net`. What is
  still missing is a device to send to — see the next item — plus the two
  database settings in INFRA.md step 3, without which the trigger is inert.
  So the logic is proven; end-to-end delivery is not, and cannot be until EAS
  exists.
- **Push tokens can't be fetched yet.** `usePush` registers on sign-in, but
  `getExpoPushTokenAsync` needs an EAS `projectId` that does not exist until
  `eas init` (INFRA.md step 4). Until then registration logs
  `[push] registration unavailable` and returns null by design.
- **Expo push receipts** — delete `DeviceNotRegistered` tokens
  (`service_role` already has the DELETE grant for exactly this), and confirm
  Expo's field for the APNs thread-id that §4.2 stacking depends on. See the
  TODOs in `functions/send-push`.
- **Universal links** need `cartpool.app` to serve the two association files
  (INFRA.md step 7). The `cartpool://i/{code}` scheme and manual code entry
  both work today.
- **No UI is device-tested end to end.** The suite covers the server
  thoroughly; the screens are exercised by hand on a phone against the local
  stack (`docs/LOCAL-DEV.md`), not by automated tests.
