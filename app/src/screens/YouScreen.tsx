// The "You" tab (mockup): who you are, your plan, and the app-level
// settings — profile, plan status, the large-text toggle, the global
// notification mute (spec §6), sign out. The mockup's full history view still
// waits on its server support.
import { useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import type { Profile, Subscription } from "@/hooks/useCartpool";
import type { RpcResult } from "@/api/rpc";
import { base, colors, fonts } from "@/theme";
import { MAX_OS_FONT_SCALE } from "@/theme/accessibility";

export default function YouScreen({
  profile,
  groupCount,
  subscription,
  scale: s,
  largeText,
  pushBlocked,
  onToggleLargeText,
  onToggleGlobalMute,
  onOpenSystemSettings,
  onSignOut,
  onDeleteAccount,
}: {
  profile: Profile | null;
  groupCount: number;
  subscription: Subscription | null;
  scale: number;
  largeText: boolean;
  /**
   * The OS is refusing notifications for this app. Distinct from the mute
   * below: the mute is the user's choice inside Cartpool and is one tap to
   * undo, whereas this can only be undone in the Settings app.
   */
  pushBlocked: boolean;
  onToggleLargeText: (on: boolean) => void;
  /** Global notification mute (spec §6). Per-group overrides live on Groups. */
  onToggleGlobalMute: (on: boolean) => void;
  /** Opens this app's page in the system Settings app. */
  onOpenSystemSettings: () => void;
  onSignOut: () => void;
  /** Delete the account and sign out. Resolves to the RPC result. */
  onDeleteAccount: () => Promise<RpcResult>;
}) {
  const [busy, setBusy] = useState(false);

  // Two steps on purpose. The first is the "did you mean to tap that" guard;
  // the second names the consequences, since this deletes items other people
  // can see and there is no undo.
  const confirmDelete = () => {
    Alert.alert(
      "Delete your account?",
      "This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Continue",
          style: "destructive",
          onPress: () =>
            Alert.alert(
              "Delete everything?",
              "Your account, your lists, and every item you added or bought will be removed for everyone — including items you bought for other people. You will be signed out.",
              [
                { text: "Keep my account", style: "cancel" },
                { text: "Delete", style: "destructive", onPress: runDelete },
              ]
            ),
        },
      ]
    );
  };

  const runDelete = async () => {
    setBusy(true);
    try {
      const res = await onDeleteAccount();
      // On success the session is gone and this screen unmounts, so there is
      // nothing to report. Only a failure needs saying.
      if (!res.ok) {
        Alert.alert(
          "Couldn't delete your account",
          "Nothing was deleted. Please check your connection and try again."
        );
      }
    } catch {
      Alert.alert(
        "Couldn't delete your account",
        "Nothing was deleted. Please check your connection and try again."
      );
    } finally {
      setBusy(false);
    }
  };
  const name = profile?.display_name ?? "You";
  const initials = name
    .split(/\s+/)
    .map((w) => w[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={{ paddingBottom: base.spacing * 4 }}
    >
      <View style={styles.profileRow}>
        <View style={[styles.avatar, { width: 64 * s, height: 64 * s, borderRadius: 32 * s }]}>
          <Text
            style={{ color: colors.accentText, fontSize: 24 * s, fontFamily: fonts.bodyBold }}
            maxFontSizeMultiplier={MAX_OS_FONT_SCALE}
          >
            {initials}
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text
            style={{ fontSize: base.fontSizeTitle * s, color: colors.text, fontFamily: fonts.heading }}
            maxFontSizeMultiplier={MAX_OS_FONT_SCALE}
          >
            {name}
          </Text>
          <Text
            style={{ fontSize: base.fontSizeSmall * s, color: colors.textSecondary }}
            maxFontSizeMultiplier={MAX_OS_FONT_SCALE}
          >
            {groupCount === 1 ? "1 group" : `${groupCount} groups`}
          </Text>
        </View>
      </View>

      <View style={styles.card}>
        <Text
          style={[styles.cardTitle, { fontSize: base.fontSizeSmall * s }]}
          maxFontSizeMultiplier={MAX_OS_FONT_SCALE}
        >
          Your plan
        </Text>
        <Text
          style={{ fontSize: base.fontSize * s, color: colors.text }}
          maxFontSizeMultiplier={MAX_OS_FONT_SCALE}
        >
          {planLine(subscription)}
        </Text>
      </View>

      <View style={styles.card}>
        <Text
          style={[styles.cardTitle, { fontSize: base.fontSizeSmall * s }]}
          maxFontSizeMultiplier={MAX_OS_FONT_SCALE}
        >
          Settings
        </Text>
        <View style={[styles.settingRow, { minHeight: base.rowMinHeight * s }]}>
          <View style={{ flex: 1 }}>
            <Text
              style={{ fontSize: base.fontSize * s, color: colors.text }}
              maxFontSizeMultiplier={MAX_OS_FONT_SCALE}
            >
              Large text
            </Text>
            <Text
              style={{ fontSize: base.fontSizeSmall * s, color: colors.textSecondary }}
              maxFontSizeMultiplier={MAX_OS_FONT_SCALE}
            >
              Bigger text and buttons everywhere
            </Text>
          </View>
          <Switch
            value={largeText}
            onValueChange={onToggleLargeText}
            trackColor={{ true: colors.accent, false: colors.border }}
            thumbColor={colors.background}
            accessibilityLabel="Large text mode"
          />
        </View>

        {/* Global mute (spec §6). Phrased as the mute rather than as
            "notifications on", so the switch being on always means "quieter"
            — same direction as the per-group toggle on the Groups tab. */}
        <View style={[styles.settingRow, { minHeight: base.rowMinHeight * s }]}>
          <View style={{ flex: 1 }}>
            <Text
              style={{ fontSize: base.fontSize * s, color: colors.text }}
              maxFontSizeMultiplier={MAX_OS_FONT_SCALE}
            >
              Mute notifications
            </Text>
            <Text
              style={{ fontSize: base.fontSizeSmall * s, color: colors.textSecondary }}
              maxFontSizeMultiplier={MAX_OS_FONT_SCALE}
            >
              No pings when someone buys something. You can still un-mute a
              single group on the Groups tab.
            </Text>
          </View>
          <Switch
            value={profile?.global_mute ?? false}
            onValueChange={onToggleGlobalMute}
            trackColor={{ true: colors.accent, false: colors.border }}
            thumbColor={colors.background}
            accessibilityLabel="Mute all notifications"
          />
        </View>

        {/* Only when the OS is blocking us. The mute switch above still reads
            "off", which is true of the Cartpool setting and misleading about
            what the user will actually receive — so say what is really
            happening and give the one route back, since iOS will not show its
            permission dialog a second time. */}
        {pushBlocked && (
          <Pressable
            onPress={onOpenSystemSettings}
            style={[styles.settingRow, { minHeight: base.rowMinHeight * s }]}
            accessibilityRole="button"
            accessibilityLabel="Turn on notifications in Settings"
          >
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  fontSize: base.fontSize * s,
                  color: colors.text,
                  fontFamily: fonts.bodyMedium,
                }}
                maxFontSizeMultiplier={MAX_OS_FONT_SCALE}
              >
                Notifications are blocked
              </Text>
              <Text
                style={{ fontSize: base.fontSizeSmall * s, color: colors.textSecondary }}
                maxFontSizeMultiplier={MAX_OS_FONT_SCALE}
              >
                Your phone is set to block Cartpool notifications, so you will
                not hear when someone buys something for you. Tap to open
                Settings.
              </Text>
            </View>
          </Pressable>
        )}
      </View>

      <Pressable
        onPress={() =>
          Alert.alert("Sign out?", undefined, [
            { text: "Cancel", style: "cancel" },
            { text: "Sign out", style: "destructive", onPress: onSignOut },
          ])
        }
        style={[styles.signOut, { minHeight: base.tapTarget * s }]}
        accessibilityRole="button"
        accessibilityLabel="Sign out"
      >
        <Text
          style={{ color: colors.danger, fontSize: base.fontSize * s, fontFamily: fonts.bodyMedium }}
          maxFontSizeMultiplier={MAX_OS_FONT_SCALE}
        >
          Sign out
        </Text>
      </Pressable>

      {/* Account deletion, required in-app by App Store guideline 5.1.1(v).
          Two confirmations, because it cannot be undone and the second dialog
          is the one that spells out what actually goes. Kept visually quieter
          than Sign out so it isn't hit by accident, but not hidden. */}
      <Pressable
        onPress={confirmDelete}
        disabled={busy}
        style={[styles.deleteAccount, { minHeight: base.tapTarget * s }]}
        accessibilityRole="button"
        accessibilityLabel="Delete my account"
      >
        <Text
          style={{ color: colors.textSecondary, fontSize: base.fontSizeSmall * s }}
          maxFontSizeMultiplier={MAX_OS_FONT_SCALE}
        >
          {busy ? "Deleting…" : "Delete my account"}
        </Text>
      </Pressable>
    </ScrollView>
  );
}

function planLine(sub: Subscription | null): string {
  if (!sub) return "Free — up to 3 groups.";
  if (sub.entitlement_active) return "Unlimited groups — unlocked. Thank you!";
  const msLeft = new Date(sub.trial_ends_at).getTime() - Date.now();
  if (msLeft > 0) {
    const days = Math.ceil(msLeft / 86_400_000);
    return `Unlimited groups free for ${days === 1 ? "1 more day" : `${days} more days`}, then up to 3 (or a one-time unlock).`;
  }
  if (sub.frozen_read_only) return "Read-only: your free period ended with more than 3 groups. Pick 3 to keep, or unlock unlimited.";
  return "Free — up to 3 groups. A one-time purchase unlocks unlimited.";
}

const styles = StyleSheet.create({
  deleteAccount: { alignItems: "center", justifyContent: "center", paddingBottom: base.spacing },
  root: { flex: 1, backgroundColor: colors.background },
  profileRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: base.spacing,
    padding: base.spacing,
    paddingTop: base.spacing * 1.5,
  },
  avatar: {
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  card: {
    marginHorizontal: base.spacing,
    marginTop: base.spacing,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: base.radius,
    backgroundColor: colors.surface,
    padding: base.spacing,
    gap: 6,
  },
  cardTitle: {
    color: colors.textSecondary,
    fontFamily: fonts.bodyBold,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  settingRow: { flexDirection: "row", alignItems: "center", gap: base.spacing },
  signOut: {
    marginTop: base.spacing * 2,
    alignItems: "center",
    justifyContent: "center",
  },
});
