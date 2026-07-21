# Running the app against the local Supabase stack

How to get Cartpool running on a real phone, talking to the Supabase stack on
your PC. Assumes `supabase start` already works (see README for the test
suite).

Two things that trip people up, up front:

- **A phone cannot reach `127.0.0.1`.** That address means "this device", so on
  your phone it means the phone. The app must point at your PC's address on the
  local network instead. This is step 2.
- **`app/.env` is read once, when Expo starts.** Change it and you must stop
  and restart `npx expo start`. Reloading the app is not enough.

---

## 1. Save your current .env values

`app/.env` currently points at the hosted Supabase project. That file is
gitignored, so nothing is backed up. Open `app/.env`, copy both lines into a
scratch note, and keep them — that's how you get back to the hosted project
later.

## 2. Find your PC's address on the network

In PowerShell:

```powershell
ipconfig
```

Look for your active adapter (usually **Wireless LAN adapter Wi-Fi**) and its
**IPv4 Address**. It looks like `192.168.1.42` or `10.0.0.15`. That number is
referred to below as `YOUR-PC-IP`.

Your phone must be on the same Wi-Fi network as the PC.

## 3. Point the app at the local stack

Edit `app/.env` to:

```
EXPO_PUBLIC_SUPABASE_URL=http://YOUR-PC-IP:54321
EXPO_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH
```

Substitute the real IP. Note `http`, not `https` — local has no certificate.

The key is the **Publishable** key printed by `supabase start`. It's a shared
default for local development, identical on every machine, and safe in a
gitignored file. Never use a hosted project's key this way.

If you'd rather test on the Android emulator or iOS simulator instead of a
physical phone, the URL differs:

| Target | URL |
|---|---|
| Physical phone | `http://YOUR-PC-IP:54321` |
| Android emulator | `http://10.0.2.2:54321` |
| iOS simulator | `http://127.0.0.1:54321` |

## 4. Let the firewall through

The first time something off-machine hits port 54321, Windows Defender may
silently block it. If the app hangs on sign-in, this is the most likely cause.
To pre-empt it, in an **Administrator** PowerShell:

```powershell
New-NetFirewallRule -DisplayName "Supabase local 54321" -Direction Inbound -LocalPort 54321 -Protocol TCP -Action Allow
```

Quick check from the PC that the API is actually up:

```powershell
curl http://YOUR-PC-IP:54321/rest/v1/
```

Anything other than a hang or connection error means it's reachable.

## 5. Install Expo Go on the phone

Get **Expo Go** from the App Store or Play Store. It's the sandbox that runs
the app without building a native binary.

## 6. Start the dev server

```powershell
cd C:\dev\cartpool\app
npx expo start
```

A QR code appears. On **Android**, scan it with the Expo Go app itself. On
**iOS**, scan with the built-in Camera app and tap the notification.

The app loads over Wi-Fi from your PC. Shaking the phone opens the Expo dev
menu (reload, etc.).

## 7. Sign in

Phone/SMS won't work locally — `supabase start` printed *"no SMS provider is
enabled"*, which is the same A2P 10DLC constraint described in
`app/src/config.ts`. Use one of the dev-only modes instead. The sign-in screen
has a small link at the bottom that cycles **phone → password → email**.

**Email OTP (closest to the real flow):**

1. Cycle to email mode, enter any address — `a@example.com` is fine, it doesn't
   need to exist.
2. Tap Send code.
3. On your **PC**, open <http://127.0.0.1:54324> — that's Mailpit, which
   catches every outbound local email.
4. Read the 6-digit code from the message, type it into the app.

If the email shows a **"Sign in" link instead of a code**, the custom template
isn't loaded — restart the stack (`supabase stop` then `supabase start`), since
`config.toml` is only read at startup. Don't click the link: it redirects to a
web app this project doesn't have, so it will fail with
`ERR_CONNECTION_REFUSED`.

**Password (fastest for repeat sign-ins):**

1. On the PC, open Studio at <http://127.0.0.1:54323>.
2. Authentication → Users → Add user. Enter an email and password, and tick
   **Auto Confirm User**.
3. Cycle the app to password mode and sign in.

Either way, the `0006` signup trigger provisions your `users` row, a
subscription row, and a solo group automatically — the same path
`provisioning.test.ts` covers. You should land on an empty list titled
"My list".

## 8. Make a second account

Most of what's worth testing — invites, joining, bulk opt-ins, member lists —
needs two people. Create a second user in Studio (step 7, password method) and
sign in as them on a second device or an emulator. Signing out and back in on
one phone works too, just slower.

---

## What to walk through

Roughly in order, since each step sets up the next:

1. **Core loop** — add an item, tap to mark purchased, tap again to unmark.
2. **Invite** — Share → Invite on a list → the OS share sheet opens. Send the
   code to yourself somehow (or just read it off the screen).
3. **Join** — as the second account, Share → type the code → Join. The lists
   merge: your solo items move across, per spec §2.
4. **Realtime** — with both devices on the same list, add an item on one. It
   should appear on the other within a second, no refresh.
5. **Bulk** — add an item with the Bulk chip on. As the other account, tap
   "I'm in" and watch the roster line update on both.
6. **Reconfirm** — as the adder, long-press the bulk item → Edit text →
   change it. The other account's chip should flip to a red "Still in?".
7. **Retroactive assign** — mark a bulk item purchased, then long-press it →
   "Add someone to this bulk item".
8. **Members** — tap any section header → the member roster, with Leave.
9. **Deep link** — see below.

### Testing the deep link

Universal links (`https://cartpool.app/i/CODE`) need the domain's association
files, which don't exist yet (INFRA.md step 7). The custom scheme works now:

```powershell
npx uri-scheme open "cartpool://i/ABCD2345" --android
```

Use a real 8-character code from a live invite. The app should open with the
join field prefilled and **not** auto-join — accepting is always a deliberate
tap, per spec §3.

### Not testable yet

- **Push notifications** — `registerForPush()` exists but nothing calls it, and
  Expo Go dropped remote push support anyway. Needs a development build.
- **Subscribing** — the paywall is a stub until RevenueCat is configured
  (INFRA.md step 5).
- **The pick-3 downgrade screen** — needs a frozen account. To force one, in
  Studio's SQL editor: `update subscriptions set frozen_read_only = true where
  user_id = '<your-uuid>';` — but you need more than 3 groups for it to be
  meaningful, so this is easier to leave until you have test data.

---

## When something breaks

**Red screen: "Supabase config missing"** — Expo wasn't started from `app/`, or
`.env` is malformed. Restart `npx expo start` from `C:\dev\cartpool\app`.

**Sign-in hangs, or "Network request failed"** — the phone can't reach the PC.
Check in order: same Wi-Fi network, IP still correct (`ipconfig` — DHCP
reassigns these), firewall rule from step 4, `supabase status` shows running.

**App loads but every list is empty and errors mention permissions** — you're
likely still pointed at the hosted project, which may not have migrations
0008/0009 applied. Recheck the URL in `.env`.

**"Email rate limit exceeded"** — Supabase's built-in mailer caps at ~2/hour.
Locally you're using Mailpit, which has no limit, so if you see this you're
talking to the hosted project rather than local.

**Changes to `.env` seem ignored** — stop `npx expo start` with Ctrl+C and
start it again. It's read at boot.

## Going back to the hosted project

Restore the two lines you saved in step 1 and restart `npx expo start`. To shut
the local stack down: `supabase stop` (add `--no-backup` to discard the local
database).
