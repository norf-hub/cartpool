// Onboarding step 0 (mockup): the welcome / features intro shown before
// sign-in. Cart icon, title, one-line pitch, three feature rows, and a
// "Get started" button that hands off to the phone sign-in screen.
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import SheetButton from "@/components/SheetButton";
import { base, colors, fonts } from "@/theme";
import { MAX_OS_FONT_SCALE } from "@/theme/accessibility";

const FEATURES: { title: string; body: string; tint: string; ink: string }[] = [
  {
    title: "Keep a simple list",
    body: "Works as a plain personal shopping list from the first tap.",
    tint: "#fff2eb", // accent-100
    ink: "#8c491a", // accent-700
  },
  {
    title: "Shop for each other",
    body: "Loop in up to 3 people; anyone can pick up anyone's items.",
    tint: "#f0fae1", // accent-2-100
    ink: "#56633f", // accent-2-700
  },
  {
    title: "Split the bulk buys",
    body: "One tap to go in on a Costco pack — no quantity math.",
    tint: "#fff2eb",
    ink: "#8c491a",
  },
];

export default function WelcomeScreen({
  scale: s,
  onGetStarted,
}: {
  scale: number;
  onGetStarted: () => void;
}) {
  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={[styles.appIcon, { width: 56 * s, height: 56 * s }]}>
          <Text style={{ color: colors.heroText, fontSize: 28 * s }}>🛒</Text>
        </View>
        <Text style={[styles.title, { fontSize: 44 * s }]} maxFontSizeMultiplier={MAX_OS_FONT_SCALE}>
          Cartpool
        </Text>
        <Text style={[styles.pitch, { fontSize: 16.5 * s }]} maxFontSizeMultiplier={MAX_OS_FONT_SCALE}>
          A shopping list that's yours alone — or shared with the people who
          shop for you.
        </Text>

        <View style={styles.features}>
          {FEATURES.map((f) => (
            <View key={f.title} style={styles.featureRow}>
              <View style={[styles.featureIcon, { backgroundColor: f.tint }]}>
                <Text style={{ color: f.ink, fontSize: 20 * s, fontFamily: fonts.bodyBold }}>•</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text
                  style={[styles.featureTitle, { fontSize: 15.5 * s }]}
                  maxFontSizeMultiplier={MAX_OS_FONT_SCALE}
                >
                  {f.title}
                </Text>
                <Text
                  style={[styles.featureBody, { fontSize: 13 * s }]}
                  maxFontSizeMultiplier={MAX_OS_FONT_SCALE}
                >
                  {f.body}
                </Text>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <SheetButton label="Get started" onPress={onGetStarted} variant="primary" scale={s} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  scroll: { paddingHorizontal: 30, paddingTop: 60, paddingBottom: 20 },
  appIcon: {
    borderRadius: 20,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 26,
  },
  title: { fontFamily: fonts.heading, color: colors.text, marginBottom: 12 },
  pitch: { color: colors.textSecondary, marginBottom: 30, lineHeight: 24 },
  features: { gap: 18 },
  featureRow: { flexDirection: "row", gap: 14, alignItems: "flex-start" },
  featureIcon: {
    width: 44,
    height: 44,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  featureTitle: { fontFamily: fonts.bodyBold, color: colors.text },
  featureBody: { color: colors.textSecondary, marginTop: 2 },
  footer: { paddingHorizontal: 30, paddingBottom: 40, paddingTop: 8 },
});
