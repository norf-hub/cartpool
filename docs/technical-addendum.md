Cartpool

**Open Issues: Recommendations & Resolutions**

*Technical addendum to the Product Concept & Feature Spec (draft, July
19, 2026)*

Prepared July 19, 2026

This addendum resolves the open items flagged against the Cartpool spec
--- architecture, infra, data model, design specifics, spec ambiguities,
and the test plan for the trickiest logic. Each section states a
decision, not just options, so the team can start building.

1\. Architecture Decisions

1.1 Client stack: React Native (Expo)

Decision: React Native via Expo, one codebase for iOS and Android.

Rationale:

-   Two platforms from day one with a small team --- a single codebase
    beats maintaining Swift/Kotlin in parallel, and nothing in the spec
    (no ARKit-style camera work, no deep OS integration) requires
    native.

-   Expo's push module wraps both APNs and FCM behind one send API,
    which simplifies the \"instant per-item push\" requirement in
    Section 6.

-   Expo/RN has mature Dynamic Type and font-scaling support, which
    matters given accessibility is a first-class constraint.

-   EAS Build/Submit gives dev/staging/prod build pipelines without
    hand-rolling native CI.

1.2 Backend & real-time sync: Supabase (Postgres + Realtime)

Decision: Supabase --- Postgres database, Supabase Auth (phone/OTP),
Supabase Realtime, Row Level Security for access control.

Rationale:

-   The data model (Users, Groups, Items, Invites, Blocks, Entitlements)
    is inherently relational with real foreign keys and state machines
    --- a document store (Firestore) fights this; Postgres fits it
    directly.

-   Supabase Realtime streams row-level changes (via Postgres logical
    replication) to subscribed clients, satisfying \"close-to-real-time
    sync\" without a bespoke WebSocket layer.

-   Row-level transactional writes in Postgres give a clean, native
    answer to the purchase race condition (below) --- this is harder to
    express correctly in Firestore's transaction model.

-   Phone-based auth is built in (OTP via Twilio under the hood), so it
    doubles as the auth provider --- no separate Firebase Auth account
    needed.

Alternative considered: Firebase (Firestore + Cloud Functions + Firebase
Auth). Viable if the team already has deep Firebase experience ---
Firestore's offline-first mobile SDK is more mature than Supabase's. But
the relational schema and the transactional purchase-lock requirement
both favor Postgres. Recommend Supabase as the default; revisit only if
the team has a strong existing Firebase skillset.

1.3 Purchase race-condition handling

Decision: a single atomic conditional UPDATE, not application-level
locking.

-   \"Mark purchased\" executes as: UPDATE items SET
    status=\'purchased\', purchased\_by=\$user, purchased\_at=now()
    WHERE id=\$item AND status=\'open\'.

-   Postgres guarantees only one concurrent transaction wins this row.
    If 0 rows are affected, the item was already taken --- the client
    that arrives second gets a typed \"already purchased by {name}\"
    response instead of a generic error or duplicate write.

-   This needs no external lock service, distributed lock, or Firestore
    transaction retry loop --- it's a property of a single UPDATE
    statement.

-   The \"unmark\" action requires WHERE purchased\_by=\$user in
    addition to the id match, enforcing that only the original buyer can
    revert it, per spec.

2\. Data Model

Core tables below (columns abbreviated to what's decision-relevant; add
standard id/timestamps everywhere).

users

  ------------------- ------------------------ -----------------------------------------------------------------------------
  **Column**          **Type**                 **Notes**
  id                  uuid, PK                 internal user id --- this is the RevenueCat app\_user\_id
  phone\_number       text, unique, not null   account identity; never exposed to other members
  display\_name       text, not null           shown to other group members
  email               text, nullable           set if joined via email invite; must attach phone before full participation
  large\_text\_mode   boolean, default false   accessibility preference
  global\_mute        boolean, default false   notification setting
  created\_at         timestamptz              
  ------------------- ------------------------ -----------------------------------------------------------------------------

groups

  ------------- ----------------------- ----------------------------------------------------------------------------------------------------
  **Column**    **Type**                **Notes**
  id            uuid, PK                
  created\_at   timestamptz             
  deleted\_at   timestamptz, nullable   set when last member leaves; row retained for historical purchase records, hidden from all queries
  ------------- ----------------------- ----------------------------------------------------------------------------------------------------

memberships

  ---------------- ----------------------- -----------------------------------------------------
  **Column**       **Type**                **Notes**
  id               uuid, PK                
  group\_id        FK → groups             
  user\_id         FK → users              
  joined\_at       timestamptz             
  left\_at         timestamptz, nullable   null = active member
  mute\_override   boolean, nullable       per-group mute toggle; null = follow global setting
  ---------------- ----------------------- -----------------------------------------------------

Constraint: at most 4 rows per group\_id with left\_at IS NULL. No
role/admin column --- membership is symmetric by design, so there is
nothing to schematize there beyond presence.

items

  ------------------------ ---------------------------------- ---------------------------------------------------------------
  **Column**               **Type**                           **Notes**
  id                       uuid, PK                           
  group\_id                FK → groups, nullable              null for a solo (pre-merge) list item
  added\_by                FK → users                         only this user may edit text or remove
  text                     text, not null                     
  status                   enum: open → purchased → removed   state machine, see below
  purchased\_by            FK → users, nullable               
  purchased\_at            timestamptz, nullable              
  is\_bulk                 boolean, default false             
  bulk\_note               text, nullable                     free-text note, bulk items only
  bulk\_needs\_reconfirm   boolean, default false             set true when adder edits text after a pre-commit exists
  source\_left\_at         timestamptz, nullable              set if added\_by has since left; drives the 2-day grace purge
  removed\_at              timestamptz, nullable              purge target for the 2-week retention rule
  ------------------------ ---------------------------------- ---------------------------------------------------------------

Item state machine: Open → Purchased (by any member other than adder) →
Removed (by adder only), with Purchased → Open as the sole reverse
transition, restricted to purchased\_by. \"Removed\" is a soft-delete
(removed\_at set) purged after 2 weeks per Section 11 of the spec.

bulk\_opt\_ins

  ----------------------------- ------------------------ --------------------------------------------------------------
  **Column**                    **Type**                 **Notes**
  id                            uuid, PK                 
  item\_id                      FK → items               
  user\_id                      FK → users               
  committed\_before\_purchase   boolean                  true = pre-commit, false = assigned retroactively by buyer
  needs\_reconfirmation         boolean, default false   flipped true when the bulk item's text is edited post-commit
  ----------------------------- ------------------------ --------------------------------------------------------------

invites

  ------------- -------------------------- -----------------------------------------------------------------
  **Column**    **Type**                   **Notes**
  id            uuid, PK                   
  group\_id     FK → groups                tied to the group, not the inviter --- survives inviter leaving
  code          text, unique               8-char code, see Section 5
  channel       enum: phone, email, link   
  target        text, nullable             phone or email, if directed
  created\_at   timestamptz                
  expires\_at   timestamptz                created\_at + 7 days
  revoked\_at   timestamptz, nullable      
  ------------- -------------------------- -----------------------------------------------------------------

waitlist\_entries

  --------------- ----------------------- ------------------------------------------------------------
  **Column**      **Type**                **Notes**
  id              uuid, PK                
  group\_id       FK → groups             
  user\_id        FK → users              
  requested\_at   timestamptz             FCFS ordering key --- promotion strictly by this timestamp
  promoted\_at    timestamptz, nullable   
  --------------- ----------------------- ------------------------------------------------------------

blocks

  ------------- ------------- -----------------------
  **Column**    **Type**      **Notes**
  id            uuid, PK      
  blocker\_id   FK → users    the \"A\" in the spec
  blocked\_id   FK → users    the \"B\" in the spec
  created\_at   timestamptz   
  ------------- ------------- -----------------------

Checked at: invite redemption, link/code redemption, and waitlist
promotion --- a redemption or promotion that would co-place blocker\_id
and blocked\_id in one group is rejected silently to the blocked-from
side, per spec (blocking is one-directional and B is never notified).

subscriptions

  --------------------- ----------------------------------------- --------------------------------------------------------
  **Column**            **Type**                                  **Notes**
  user\_id              FK → users, PK                            RevenueCat app\_user\_id --- same id, no mapping table
  entitlement\_active   boolean                                   from cartpool\_unlimited entitlement
  store                 enum: app\_store, play\_store, nullable   
  in\_grace\_period     boolean, default false                    billing retry window (\~16--21 days)
  frozen\_read\_only    boolean, default false                    true once \>3 groups and entitlement lost
  kept\_group\_ids      uuid\[\], nullable                        the 3 groups chosen after a downgrade
  updated\_at           timestamptz                               last RevenueCat webhook or foreground re-sync
  --------------------- ----------------------------------------- --------------------------------------------------------

3\. Infra & Accounts to Set Up

  -------------------- ---------------------------------------------- -----------------------------------------------------------------------------------------------------------------
  **Item**             **Choice**                                     **Notes**
  Auth                 Supabase Auth (phone/OTP)                      Twilio underneath; no separate Firebase Auth needed since backend is Supabase
  Push notifications   Expo push service (APNs + FCM)                 still requires an Apple Push key and an FCM server key registered with Expo
  Payments             RevenueCat                                     2 store products + 1 shared entitlement (cartpool\_unlimited) + webhook endpoint on backend, per spec Section 9
  Developer accounts   Apple Developer Program, Google Play Console   needed before any TestFlight/internal track builds
  Store listings       App Store Connect + Play Console listings      draft early --- review lead times, especially Apple, are the longest pole for launch scheduling
  Environments         dev / staging / prod                           separate Supabase projects per environment; separate RevenueCat project/API keys per environment
  CI/CD                GitHub Actions + EAS Build/Submit              lint + unit tests on PR; EAS build+submit gated on tag push to a release branch
  -------------------- ---------------------------------------------- -----------------------------------------------------------------------------------------------------------------

4\. Design Work

4.1 Accessibility --- concrete specs

-   Tap targets: minimum 44×44pt (iOS) / 48×48dp (Android) for every
    interactive element, including row-level \"mark purchased\" controls
    --- no exceptions for dense list rows.

-   Large-text mode: support OS-level Dynamic Type / font scaling up to
    200%, plus an in-app \"Large text\" toggle in settings for users who
    don't know the OS setting exists --- the toggle applies a fixed 1.4×
    scale to text and row height together, not text alone, so tap
    targets grow with it.

-   Navigation depth: from app launch, adding an item is at most 2 taps
    (open app → tap add → type/confirm); marking an item purchased from
    the main list is 1 tap, no confirmation dialog (it's already
    recoverable via unmark).

-   These numbers should go directly into the wireframes as constraints,
    not aspirations --- flag any screen in review that exceeds them.

4.2 Notification copy/UX --- the \"ten pings\" case

Decision: keep instant, per-item delivery as specified (immediacy over
batching is an accepted tradeoff) --- but stack the presentation, not
the delivery.

-   Use OS-level notification grouping: iOS thread-identifier and
    Android notification channel/group, both keyed by group\_id, so 10
    pings from one Costco run collapse into a single expandable stack in
    the tray instead of 10 separate banners.

-   Individual notification copy: \"{buyer} bought {item}\" for a single
    item.

-   Stack summary copy (shown when the OS collapses the group):
    \"{buyer} bought {n} items on {group name}'s list.\"

-   This satisfies \"instant sync\" (each push fires immediately and the
    list updates in real time) while keeping the notification shade from
    being unusable after a big trip.

5\. Spec Ambiguities --- Resolved

Invite link/code format

An 8-character code, base32 alphabet with ambiguous characters (0/O,
1/I) excluded, generated server-side the moment an invite row is
created. The shareable link is https://cartpool.app/i/{code},
deep-linking straight into the app; the same code can also be typed
manually for phone/email invites sent out-of-band. Validation happens
server-side against the invites table (checks expiry and revoked\_at) at
redemption time --- never trust client-side expiry checks.

Paid-tier \"choose 3 groups\" flow

When a lapsed subscriber belongs to more than 3 groups, they see a
required selection screen listing every group (name, member avatars,
item count), and must check exactly 3 before continuing --- there is no
default or auto-selection. Confirmation is an explicit \"Keep these 3\"
button; the other groups become read-only (not deleted) so nothing is
lost if they resubscribe. The screen re-appears on every app open until
resolved.

Waitlist promotion notification

Fires immediately when a membership slot opens and a waitlist entry
exists, selecting strictly by requested\_at. Copy: \"A spot opened in
{group name} --- you're in!\" The promoted user is added directly (no
second accept step), since they already accepted the group's terms when
they joined the waitlist off a valid invite.

Blocking auditability

Stays silent to B in the product, exactly as specified --- no UI surface
for either A or B. Block events are still written to an internal,
non-user-facing audit log (blocker, blocked, timestamp) so support can
investigate abuse reports without exposing the mechanism to end users.

6\. Testing Plan

Unit-test these state transitions before any UI is built on top of them
--- they are the highest-risk logic in the app.

Purchase race condition

-   Two concurrent \"mark purchased\" calls on the same open item
    resolve to exactly one winner; the loser receives a typed \"already
    purchased by {name}\" result, not a generic error or a duplicate
    write.

-   The winning row shows exactly one purchased\_by/purchased\_at pair
    after both requests complete, regardless of arrival order.

-   \"Unmark\" succeeds only when called by purchased\_by; any other
    caller is rejected.

Leave / grace period

-   Leaving a group removes (vanishes) every open item the leaver added,
    for every remaining member.

-   Already-purchased items added by the leaver remain visible, with the
    leaver's name intact, for exactly 2 days after left\_at, then are
    purged.

-   If the buyer of one of those grace-period items also leaves before
    the 2 days elapse, the purchase record and buyer name are unaffected
    --- verify it's treated as history, not live membership state.

-   The last member leaving a group soft-deletes the group and its data.

Blocking

-   A blocking B removes A (only) from every group A and B currently
    share, applying the same vanish rule as a voluntary leave.

-   A is rejected from joining any future group containing B, via invite
    redemption, link/code redemption, and waitlist promotion --- test
    all three entry points independently.

-   B's membership, items, and notifications are completely unaffected
    by A's block action.

Waitlist

-   Promotion order strictly matches requested\_at across multiple
    waitlisted users, including ties broken by insertion order.

-   A blocked relationship (either direction) skips a waitlist entry
    rather than promoting it --- verify the next eligible entry is
    promoted instead, not that promotion simply halts.

Bulk items

-   Editing a bulk item's text after one or more pre-commits sets
    needs\_reconfirmation = true on those opt-ins rather than silently
    preserving them.

-   Retroactive opt-in assignment by the buyer after purchase is
    recorded as committed\_before\_purchase = false.

Subscription / downgrade

-   Each of expiration, cancellation, and refund webhook events
    independently triggers frozen\_read\_only = true when the user is in
    more than 3 groups.

-   Entering the billing grace period does not trigger the downgrade
    flow --- only actual entitlement loss does.

-   Restoring entitlement (renewal, resubscribe) clears
    frozen\_read\_only without requiring the user to re-pick groups.
