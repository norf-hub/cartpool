// The trial strip above the List hero (mockup): a slim full-width tappable
// band in the accent-100 tint that shows the trial status and opens the
// paywall. "✦ {text} · Unlock →".
import { Pressable, StyleSheet, Text } from "react-native";
import { base, colors, fonts } from "@/theme";
import { MAX_OS_FONT_SCALE } from "@/theme/accessibility";

export default function TrialBanner({
  text,
  scale: s,
  onPress,
}: {
  text: string;
  scale: number;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.band, { minHeight: base.tapTarget * s * 0.72 }]}
      accessibilityRole="button"
      accessibilityLabel={`${text}. Unlock unlimited lists.`}
    >
      <Text
        style={[styles.text, { fontSize: 12.5 * s }]}
        maxFontSizeMultiplier={MAX_OS_FONT_SCALE}
      >
        ✦ {text} · Unlock →
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  band: {
    width: "100%",
    backgroundColor: "#fff2eb", // --color-accent-100
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 9,
    paddingHorizontal: 22,
  },
  text: {
    color: "#643312", // --color-accent-800
    fontFamily: fonts.bodyMedium,
    textAlign: "center",
  },
});
