# Cartpool

Shared shopping lists for small groups (max 4), with bulk-item splitting.
Implements **Product Spec v3** (+ amendments through v3.3 — cross-group items) and the
Technical Addendum: React Native (Expo) client, Supabase (Postgres + Realtime)
backend, RevenueCat for the one-time unlock purchase.

**Monetization (v3.1):** 3 months of unlimited groups from signup, then a
one-time $10 lifetime purchase for more than the 3 free groups. No recurring
subscription.

## Layout

```
app/                    Expo app (TypeScript). Placeholder shell — no UI is
                        built until the tests below pass (addendum §6).
  src/api/rpc.ts        Typed wrappers for the server RPCs
  src/theme/accessibility.ts  Hard a11y constraints (44pt targets, 1.4x scale, tap budgets)
supabase/
  migrations/0001_schema.sql     Tables (v3: items.group_id NOT NULL — solo list is a real group)
  migrations/0002_triggers.sql   4-member cap + bidirectional block bar (advisory-lock trigger)
  migrations/0003_functions.sql  All state-transition logic as Postgres functions
  migrations/0004_auth.sql       auth.uid() wrappers (api schema) + RLS on every table
  migrations/0005_cron.sql       pg_cron schedule for purge_retention() (NOTICE on bare Postgres)
  migrations/0006_push_and_signup.sql  push_tokens + registration RPCs; auth.users signup trigger
  migrations/0011_one_time_purchase.sql  v3.1: trial_ends_at, is_entitled(), expire_trials() cron, purchase+refund-only lifecycle
  migrations/0012_offers.sql     v3.2: "up for grabs" — post surplus units, per-unit accumulating claims, price-as-label
  migrations/0013_cross_group_items.sql  Cross-group items: one canonical row visible to the adder's whole pool; first buyer anywhere clears it everywhere; leave re-homes instead of deleting
  functions/revenuecat-webhook/  Edge function -> handle_entitlement_event (service_role)
  functions/send-push/           Purchase push fan-out with §4.2 per-group stacking
tests/                  Section 6 unit tests + auth tests (vitest + pg, real Postgres)
.github/workflows/ci.yml         Tests run against a postgres:15 service container
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
docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:15
DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npm test
```

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

## Not yet built (deliberately)

UI screens and wireframes (gated on the a11y constants in
`app/src/theme/accessibility.ts`), Expo push-receipt handling (delete
`DeviceNotRegistered` tokens), and verification of Expo Push API support for
APNs thread-id — see TODO in `functions/send-push`. Infra/account steps are
listed in `INFRA.md`.

`0006_push_and_signup.sql` closed the two former gaps: `push_tokens` +
`api.register_push_token`/`api.unregister_push_token` (client wired in
`app/src/notifications/push.ts`), and the `auth.users` signup trigger that
provisions users with `users.id = auth.uid()` (a minimal `auth.users` shim
lets `provisioning.test.ts` exercise the real trigger on bare Postgres).
