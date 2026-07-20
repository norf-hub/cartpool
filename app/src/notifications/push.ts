// Client-side push registration + per-group Android channels (§4.2).
// Server-side fan-out lives in supabase/functions/send-push.
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { registerPushToken } from "@/api/rpc";

// Foreground: list updates in real time via Supabase Realtime; banners are
// for people NOT looking at the app.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: false,
    shouldPlaySound: false,
    shouldSetBadge: true,
  }),
});

export async function registerForPush(): Promise<string | null> {
  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== "granted") return null;
  const token = (await Notifications.getExpoPushTokenAsync()).data;
  if (Platform.OS === "ios" || Platform.OS === "android") {
    await registerPushToken(token, Platform.OS); // upserts; re-points on re-login
  }
  return token;
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
