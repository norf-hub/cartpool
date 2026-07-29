// Client-side push registration + per-group Android channels (§4.2).
// Server-side fan-out lives in supabase/functions/send-push.
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { registerPushToken, unregisterPushToken } from "@/api/rpc";

// Foreground: list updates in real time via Supabase Realtime; banners are
// for people NOT looking at the app.
// SDK 54's expo-notifications replaced the single `shouldShowAlert` with
// `shouldShowBanner` (heads-up) and `shouldShowList` (notification center).
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: false,
    shouldShowList: false,
    shouldPlaySound: false,
    shouldSetBadge: true,
  }),
});

/**
 * The token this device last registered, kept so sign-out can withdraw it
 * (§4.2: a handed-on phone must stop receiving the previous account's
 * notifications). Module-scoped rather than React state because sign-out runs
 * from useAuth, outside any component that would own it.
 */
let currentToken: string | null = null;

/**
 * "unsupported" covers web and simulators — a device that can never receive a
 * push, which is not the same as a user who said no.
 */
export type PushPermission = "granted" | "denied" | "undetermined" | "unsupported";

/**
 * Read the OS permission WITHOUT prompting. Needed because iOS shows its
 * system dialog exactly once per install: after a decline the app cannot ask
 * again, and the only route back is the Settings app. Something has to notice
 * that state, or "notifications are on by default" is quietly false for that
 * user with nothing in the UI to explain why.
 */
export async function getPushPermission(): Promise<PushPermission> {
  if (Platform.OS !== "ios" && Platform.OS !== "android") return "unsupported";
  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status === "granted") return "granted";
    return status === "denied" ? "denied" : "undetermined";
  } catch {
    return "unsupported";
  }
}

/**
 * Ask for permission and register this device's token against the signed-in
 * user. Returns null — never throws — when push isn't available, which is the
 * normal case in Expo Go and on simulators, and also until the EAS project
 * exists (getExpoPushTokenAsync needs its projectId; see INFRA.md step 4).
 * Callers treat null as "no push on this device", not as an error.
 */
export async function registerForPush(): Promise<string | null> {
  if (Platform.OS !== "ios" && Platform.OS !== "android") return null;
  try {
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== "granted") return null;
    const token = (await Notifications.getExpoPushTokenAsync()).data;
    await registerPushToken(token, Platform.OS); // upserts; re-points on re-login
    currentToken = token;
    return token;
  } catch (e) {
    // Expected without a development build or an EAS projectId. Logged rather
    // than surfaced: push is additive, and the app is fully usable without it.
    console.warn("[push] registration unavailable:", e);
    return null;
  }
}

/**
 * Withdraw this device's token. Must run BEFORE supabase.auth.signOut(), since
 * api.unregister_push_token resolves the caller from the live session.
 */
export async function unregisterCurrentPush(): Promise<void> {
  if (!currentToken) return;
  const token = currentToken;
  currentToken = null; // sign-out proceeds regardless of what happens below
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // Bounded, because sign-out awaits this: a flaky connection must not leave
    // the button looking stuck. Giving up is safe — a token left registered is
    // re-pointed at whoever signs in next (0006 upserts on conflict), so it
    // can't keep delivering to the wrong account indefinitely.
    await Promise.race([
      unregisterPushToken(token),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("unregister timed out")), 3000);
      }),
    ]);
  } catch (e) {
    console.warn("[push] unregister failed:", e);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Expo can rotate a device's token at any time; the stored one is then a dead
 * address. Re-register on rotation. Returns an unsubscribe function.
 */
export function watchPushTokenRotation(): () => void {
  // The listener hands back the *device* (APNs/FCM) token, while push_tokens
  // stores ExponentPushToken values — so re-run registration to fetch the new
  // Expo token rather than forwarding this one. Permission is already granted
  // by this point, so the re-request resolves immediately.
  const sub = Notifications.addPushTokenListener(() => {
    void registerForPush();
  });
  return () => sub.remove();
}

/**
 * One Android notification channel per group, so a 10-item Costco run
 * collapses into a single expandable stack keyed by that group.
 */
export async function ensureGroupChannel(groupId: string, groupName: string) {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync(`group-${groupId}`, {
    name: groupName,
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}
