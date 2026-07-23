// The List tab's hero card (mockup). Two states:
//   • pickup  — you have an item someone else already bought; show it big
//               with the buyer, so you know what's waiting to be collected.
//   • calm    — nothing waiting; a quiet "All caught up" greeting.
// Sage fill, cream text, two soft translucent circles bleeding off the
// corners. The whole pickup card is tappable (same action as the row).
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { Item } from "@/hooks/useCartpool";
import { base, colors, fonts } from "@/theme";
import { MAX_OS_FONT_SCALE } from "@/theme/accessibility";

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export default function ListHero({
  youName,
  groupCount,
  pickup,
  buyerName,
  whenText,
  scale: s,
  onPress,
}: {
  youName: string;
  groupCount: number;
  /** The item to feature, or null for the calm state. */
  pickup: Item | null;
  buyerName: string;
  /** Pre-formatted "· 3:40 PM" / "· Jul 20" fragment (may be empty). */
  whenText: string;
  scale: number;
  onPress: () => void;
}) {
  const listWord = groupCount === 1 ? "list" : "lists";

  // Decorative circles — identical in both states, just positioned to bleed
  // off the corners. Pointer-events off so taps fall through to the card.
  const circles = (
    <>
      <View style={[styles.circle, styles.circleTopRight]} pointerEvents="none" />
      <View style={[styles.circle, styles.circleBottomLeft]} pointerEvents="none" />
    </>
  );

  if (!pickup) {
    return (
      <View style={[styles.card, { paddingBottom: 30 }]}>
        {circles}
        <View style={styles.inner}>
          <Text style={[styles.greet, { fontSize: 12.5 * s }]} maxFontSizeMultiplier={MAX_OS_FONT_SCALE}>
            Hi, {youName}
          </Text>
          <Text style={[styles.calmTitle, { fontSize: 34 * s }]} maxFontSizeMultiplier={MAX_OS_FONT_SCALE}>
            All caught up
          </Text>
          <Text style={[styles.calmBody, { fontSize: 13.5 * s }]} maxFontSizeMultiplier={MAX_OS_FONT_SCALE}>
            Nothing waiting for pickup right now.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      style={styles.card}
      accessibilityRole="button"
      accessibilityLabel={`Waiting for you: ${pickup.text}, ${buyerName} bought it`}
    >
      {circles}
      <View style={styles.inner}>
        <View style={styles.topRow}>
          <Text style={[styles.greet, { fontSize: 12.5 * s }]} maxFontSizeMultiplier={MAX_OS_FONT_SCALE}>
            Hi, {youName}
          </Text>
          <Text style={[styles.greet, { fontSize: 12.5 * s }]} maxFontSizeMultiplier={MAX_OS_FONT_SCALE}>
            {groupCount} {listWord}
          </Text>
        </View>
        <Text style={[styles.eyebrow, { fontSize: 11.5 * s }]} maxFontSizeMultiplier={MAX_OS_FONT_SCALE}>
          Waiting for you
        </Text>
        <Text style={[styles.heroTitle, { fontSize: 40 * s }]} maxFontSizeMultiplier={MAX_OS_FONT_SCALE}>
          {pickup.text}
        </Text>
        <View style={styles.buyerRow}>
          <View style={[styles.avatar, { width: 30 * s, height: 30 * s, borderRadius: 15 * s }]}>
            <Text style={{ color: colors.heroText, fontSize: 13 * s, fontFamily: fonts.bodyBold }}>
              {initials(buyerName)}
            </Text>
          </View>
          <Text style={[styles.buyerText, { fontSize: 13.5 * s }]} maxFontSizeMultiplier={MAX_OS_FONT_SCALE}>
            {buyerName} bought it{whenText}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    position: "relative",
    overflow: "hidden",
    backgroundColor: colors.heroBg,
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 34,
  },
  inner: { position: "relative" },
  circle: { position: "absolute", borderRadius: 999, backgroundColor: "rgba(255,255,255,0.10)" },
  circleTopRight: { top: -70, right: -56, width: 210, height: 210 },
  circleBottomLeft: { bottom: -80, left: -46, width: 170, height: 170, backgroundColor: "rgba(255,255,255,0.08)" },
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 22,
  },
  greet: { color: colors.heroText, opacity: 0.9, fontFamily: fonts.body },
  eyebrow: {
    color: colors.heroText,
    opacity: 0.85,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    marginBottom: 8,
    fontFamily: fonts.bodyMedium,
  },
  heroTitle: {
    color: colors.heroText,
    fontFamily: fonts.heading,
  },
  buyerRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 16 },
  avatar: {
    backgroundColor: "rgba(255,255,255,0.24)",
    alignItems: "center",
    justifyContent: "center",
  },
  buyerText: { color: colors.heroText, opacity: 0.95, fontFamily: fonts.body, flex: 1 },
  calmTitle: { color: colors.heroText, fontFamily: fonts.heading, marginTop: 4 },
  calmBody: { color: colors.heroText, opacity: 0.9, fontFamily: fonts.body, marginTop: 12 },
});
