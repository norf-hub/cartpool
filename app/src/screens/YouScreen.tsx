// The "You" tab (mockup): who you are, your plan, and the app-level
// settings — profile, plan status, the large-text toggle, the global
// notification mute (spec §6), sign out. The mockup's full history view still
// waits on its server support.
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import type { Profile, Subscription } from "@/hooks/useCartpool";
import { base, colors, fonts } from "@/theme";
import { MAX_OS_FONT_SCALE } from "@/theme/accessibility";

export default function YouScreen({
  profile,
  groupCount,
  subscription,
  scale: s,
  largeText,
  onToggleLargeText,
  onToggleGlobalMute,
  onSignOut,
}: {
  profile: Profile | null;
  groupCount: number;
  subscription: Subscription | null;
  scale: number;
  largeText: boolean;
  onToggleLargeText: (on: boolean) => void;
  /** Global notification mute (spec §6). Per-group overrides live on Groups. */
  onToggleGlobalMute: (on: boolean) => void;
  onSignOut: () => void;
}) {
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
