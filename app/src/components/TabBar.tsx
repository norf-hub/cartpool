// Bottom tab bar, straight from the mockup: List · Groups · Grabs · You,
// icon over a small semibold label, active in accent over the surface color.
// Tap targets stay ≥44pt and scale with large-text mode (addendum §4.1).
import { Pressable, StyleSheet, Text, View } from "react-native";
import TabIcon, { type TabIconName } from "@/components/TabIcon";
import { base, colors, fonts } from "@/theme";
import { MAX_OS_FONT_SCALE } from "@/theme/accessibility";

export type Tab = "list" | "groups" | "grabs" | "you";

const TABS: { key: Tab; icon: TabIconName; label: string }[] = [
  { key: "list", icon: "list", label: "List" },
  { key: "groups", icon: "groups", label: "Groups" },
  { key: "grabs", icon: "grabs", label: "Grabs" },
  { key: "you", icon: "you", label: "You" },
];

export default function TabBar({
  tab,
  onChange,
  scale: s,
  badges = {},
}: {
  tab: Tab;
  onChange: (t: Tab) => void;
  scale: number;
  /** e.g. open offer count on the Grabs tab. */
  badges?: Partial<Record<Tab, number>>;
}) {
  return (
    <View style={styles.bar}>
      {TABS.map(({ key, icon, label }) => {
        const on = key === tab;
        const color = on ? colors.accent : colors.textSecondary;
        const badge = badges[key];
        return (
          <Pressable
            key={key}
            onPress={() => onChange(key)}
            style={[styles.item, { minHeight: base.tapTarget * s, minWidth: base.tapTarget * s }]}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={
              badge ? `${label}, ${badge} available` : label
            }
          >
            <View>
              <TabIcon name={icon} color={color} size={22 * s} />
              {!!badge && (
                <View style={[styles.badge, { minWidth: 16 * s, height: 16 * s }]}>
                  <Text
                    style={{ color: colors.accentText, fontSize: 10 * s, fontFamily: fonts.bodyBold }}
                    maxFontSizeMultiplier={MAX_OS_FONT_SCALE}
                  >
                    {badge}
                  </Text>
                </View>
              )}
            </View>
            <Text
              style={{ color, fontSize: 10.5 * s, fontFamily: fonts.bodyMedium }}
              maxFontSizeMultiplier={MAX_OS_FONT_SCALE}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
    paddingTop: 8,
    paddingBottom: 6,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  item: {
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingHorizontal: 10,
  },
  badge: {
    position: "absolute",
    top: -6,
    right: -10,
    borderRadius: 999,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
  },
});
