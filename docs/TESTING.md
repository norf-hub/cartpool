# Getting Cartpool onto friends' phones (before the App Store)

Three ways, from zero-setup to real beta. Pick based on what you're after.

Everything here talks to the **hosted `cartpool-dev` Supabase project**, not your
PC's local stack — that's what lets friends test from their own homes, not just
on your Wi-Fi. Before any of this, make sure the hosted project is current:

```powershell
supabase db push   # applies 0009, 0010, 0011 to cartpool-dev
```

and point `app/.env` at the hosted project (the commented-out `https://…`
lines — see the note at the top of that file), then restart `npx expo start`.

---

## 1. Quick session today — Expo Go (free, no accounts, iPhone + Android)

Best for "let's all sit down and try it this afternoon." Your PC hosts the
JS bundle, so it must stay awake and running while you test.

```powershell
cd C:\dev\cartpool\app
npx expo start --tunnel
```

`--tunnel` (not the LAN URL in LOCAL-DEV.md) makes the QR reachable from any
network, so friends don't need to be on your Wi-Fi. Each friend:

1. Installs **Expo Go** from the App Store / Play Store.
2. Android: scans the QR with Expo Go. iPhone: scans with the Camera app.

Limits: no push notifications (Expo Go dropped remote push), and it all stops
when you close the dev server. Good enough to walk the core loop, invites,
joining, bulk, and realtime together.

---

## 2. Android friends — real installable app (free, keep-it-on-your-phone)

A real build they install and use independently for as long as you like. Push
works. No Google account needed on their end; no Play Store involved.

One-time setup:

```powershell
npm install -g eas-cli
cd C:\dev\cartpool\app
eas login              # create a free Expo account if you don't have one
eas init               # links this app to an EAS project, writes the projectId
```

Build and share:

```powershell
eas build -p android --profile preview
```

EAS builds on their servers (free tier is fine) and prints a URL when done.
Send that URL to your Android friends — they open it, download the APK, and
install (they may need to allow "install from this source" once). The
`preview` profile in `eas.json` is already set to output an APK.

To ship a fix, run the build again and send the new link — or wire up
`eas update` later for over-the-air JS updates without a rebuild.

---

## 3. iPhone friends — TestFlight (needs the Apple Developer Program)

There is no free way to put a lasting build on someone else's iPhone; Apple
requires the $99/year Developer Program for TestFlight or ad-hoc. TestFlight is
the good path once that account is active (it's the same enrollment you need
for launch — see INFRA.md step 1).

After enrollment:

```powershell
cd C:\dev\cartpool\app
eas build -p ios --profile production
eas submit -p ios --latest      # uploads the build to App Store Connect
```

Then in **App Store Connect → TestFlight**: add a build, fill the short beta
description, and invite friends by email (up to 100 internal testers) or a
public link. They install Apple's **TestFlight** app, tap your invite, and get
Cartpool like a normal download for 90 days per build. Push and the sandbox
purchase flow both work here.

(Ad-hoc via `--profile preview` is the no-TestFlight alternative, but you must
collect each iPhone's UDID first and it's capped at 100 devices — TestFlight is
almost always easier.)

---

## Which to use

- **This week, mixed group:** #1 for a first play together, then #2 so your
  Android friends have it standalone.
- **iPhone friends standalone:** wait on #3 until the Apple account clears —
  fold it in when you're setting up for launch anyway.
