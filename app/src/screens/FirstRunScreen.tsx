// Onboarding's final beat (mockup): the "You're all set" empty personal list.
// A friendly empty-state card, an "Invite people" secondary action, and the
// primary "Add your first item" — all three just drop the user into the app,
// differing only in where they land (add bar focused, share sheet open, or
// plain list).
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import SheetButton from "@/components/SheetButton";
import { base, colors, fonts } from "@/theme";
import { MAX_OS_FONT_SCALE } from "@/theme/accessibility";

export default function FirstRunScreen({
  name,
  scale: s,
  onAddFirst,
  onInvite,
  onSkip,
}: {
  name: string;
  scale: number;
  onAddFirst: () => void;
  onInvite: () => void;
  onSkip: () => void;
}) {
  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.topRow}>
          <Text style={[styles.tag, { fontSize: base.fontSizeSmall * s }]}
            maxFontSizeMultiplier={MAX_OS_FONT_SCALE}>
            My list
          </Text>
          <Pressable
            onPress={onSkip}
            style={[styles.skip, { minHeight: base.tapTarget * s }]}
            accessibilityRole="button"
            accessibilityLabel="Skip"
          >
            <Text style={{ color: colors.accent, fontSize: base.fontSize * s, fontFamily: fonts.bodyMedium }}
              maxFontSizeMultiplier={MAX_OS_FONT_SCALE}>
              Skip
            </Text>
          </Pressable>
        </View>

        <Text style={[styles.title, { fontSize: 38 * s }]} maxFontSizeMultiplier={MAX_OS_FONT_SCALE}>
          You're all set, {name}
        </Text>
        <Text style={[styles.sub, { fontSize: 15 * s }]} maxFontSizeMultiplier={MAX_OS_FONT_SCALE}>
          This is your personal list. Add what you need, or invite the people
          who shop with you — up to 3 per group.
        </Text>

        <View style={styles.emptyCard}>
          <View style={[styles.circle, styles.circleTopRight]} />
          <View style={[styles.circle, styles.circleBottomLeft]} />
          <View style={styles.emptyInner}>
            <View style={[styles.emptyIcon, { width: 70 * s, height: 70 * s, borderRadius: 35 * s }]}>
              <Text style={{ color: colors.accent, fontSize: 32 * s }}>🛒</Text>
            </View>
            <Text style={[styles.emptyTitle, { fontSize: 22 * s }]}
              maxFontSizeMultiplier={MAX_OS_FONT_SCALE}>
              Nothing here yet
            </Text>
            <Text style={[styles.emptyBody, { fontSize: 13.5 * s }]}
              maxFontSizeMultiplier={MAX_OS_FONT_SCALE}>
              Your first item is one tap away.
            </Text>
          </View>
        </View>

        <Pressable
          onPress={onInvite}
          style={[styles.inviteRow, { minHeight: base.rowMinHeight * s }]}
          accessibilityRole="button"
          accessibilityLabel="Invite people to a list"
        >
          <View style={[styles.inviteIcon]}>
            <Text style={{ color: "#56633f", fontSize: 20 * s, fontFamily: fonts.bodyBold }}>+</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.inviteTitle, { fontSize: 15 * s }]}
              maxFontSizeMultiplier={MAX_OS_FONT_SCALE}>
              Invite people
            </Text>
            <Text style={[styles.inviteSub, { fontSize: 12.5 * s }]}
              maxFontSizeMultiplier={MAX_OS_FONT_SCALE}>
              Share a code, phone, or email — 7-day invite
            </Text>
          </View>
        </Pressable>
      </ScrollView>

      <View style={styles.footer}>
        <SheetButton label="＋ Add your first item" onPress={onAddFirst} variant="primary" scale={s} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  scroll: { paddingHorizontal: 26, paddingTop: 56, paddingBottom: 20 },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  tag: {
    color: colors.textSecondary,
    backgroundColor: colors.surface,
    fontFamily: fonts.bodyMedium,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    overflow: "hidden",
  },
  skip: { alignItems: "flex-end", justifyContent: "center", paddingHorizontal: 4 },
  title: { fontFamily: fonts.heading, color: colors.text, marginTop: 10, marginBottom: 6 },
  sub: { color: colors.textSecondary, marginBottom: 26, lineHeight: 22 },
  emptyCard: {
    position: "relative",
    overflow: "hidden",
    backgroundColor: colors.surface,
    borderRadius: 30,
    paddingVertical: 34,
    paddingHorizontal: 24,
    marginBottom: 26,
  },
  circle: { position: "absolute", borderRadius: 999 },
  circleTopRight: { top: -40, right: -30, width: 130, height: 130, backgroundColor: "#f0fae1" },
  circleBottomLeft: { bottom: -46, left: -26, width: 110, height: 110, backgroundColor: "#fff2eb" },
  emptyInner: { alignItems: "center" },
  emptyIcon: {
    backgroundColor: colors.background,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  emptyTitle: { fontFamily: fonts.heading, color: colors.text, marginBottom: 4 },
  emptyBody: { color: colors.textSecondary },
  inviteRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: base.radius,
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  inviteIcon: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: "#f0fae1", // accent-2-100
    alignItems: "center",
    justifyContent: "center",
  },
  inviteTitle: { fontFamily: fonts.bodyBold, color: colors.text },
  inviteSub: { color: colors.textSecondary, marginTop: 1 },
  footer: { paddingHorizontal: 26, paddingBottom: 40, paddingTop: 8 },
});
