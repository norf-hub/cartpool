// The paywall (mockup): a bottom sheet pitching the one-time $10 unlimited
// unlock (v3.1 — non-consumable purchase, never a subscription). Icon, title,
// three perks, buy button, "Maybe later".
//
// The actual purchase is a RevenueCat call that only exists once the store
// products and API keys are configured (INFRA §5). Until then onBuy surfaces
// that it isn't wired up; the sheet's copy and layout are final so wiring the
// SDK later is a one-line swap.
import { StyleSheet, Text, View } from "react-native";
import BottomSheet from "@/components/BottomSheet";
import SheetButton from "@/components/SheetButton";
import { base, colors, fonts } from "@/theme";
import { MAX_OS_FONT_SCALE } from "@/theme/accessibility";

const PERKS = [
  "Unlimited shared & solo lists",
  "One-time payment — never a subscription",
  "Works across your devices & Family Sharing",
];

export default function PaywallSheet({
  visible,
  onClose,
  onBuy,
  scale: s,
}: {
  visible: boolean;
  onClose: () => void;
  onBuy: () => void;
  scale: number;
}) {
  return (
    <BottomSheet visible={visible} onClose={onClose} title="Unlock unlimited lists" scale={s}>
      <View style={styles.header}>
        <View style={[styles.icon, { width: 60 * s, height: 60 * s }]}>
          <Text style={{ color: colors.heroText, fontSize: 28 * s }}>✦</Text>
        </View>
        <Text
          style={[styles.title, { fontSize: 30 * s }]}
          maxFontSizeMultiplier={MAX_OS_FONT_SCALE}
        >
          Unlimited lists
        </Text>
        <Text
          style={[styles.price, { fontSize: 15 * s }]}
          maxFontSizeMultiplier={MAX_OS_FONT_SCALE}
        >
          $10 once. Yours for life.
        </Text>
        <Text
          style={[styles.fine, { fontSize: 12.5 * s }]}
          maxFontSizeMultiplier={MAX_OS_FONT_SCALE}
        >
          No subscription, no renewals, no expiry.
        </Text>
      </View>

      <View style={styles.perks}>
        {PERKS.map((p) => (
          <View key={p} style={styles.perkRow}>
            <Text style={{ color: colors.accent2, fontSize: 16 * s, fontFamily: fonts.bodyBold }}>
              ✓
            </Text>
            <Text
              style={[styles.perkText, { fontSize: 14.5 * s }]}
              maxFontSizeMultiplier={MAX_OS_FONT_SCALE}
            >
              {p}
            </Text>
          </View>
        ))}
      </View>

      <SheetButton label="Buy — $10" onPress={onBuy} variant="primary" scale={s} />
      <SheetButton label="Maybe later" onPress={onClose} variant="ghost" scale={s} />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: "center", paddingTop: 6, paddingBottom: 4 },
  icon: {
    borderRadius: 22,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  title: { fontFamily: fonts.heading, color: colors.text, marginBottom: 6 },
  price: { color: colors.textSecondary, marginBottom: 4 },
  fine: { color: colors.textSecondary, opacity: 0.8, marginBottom: 20 },
  perks: { gap: 12, marginBottom: 10, paddingHorizontal: 4 },
  perkRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  perkText: { color: colors.text, flex: 1 },
});
