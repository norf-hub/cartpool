// Full-width sheet buttons matching the mockup's btn-primary / btn-secondary
// / btn-ghost. Kept in one place so every sheet's actions look identical and
// respect the tap-target scale.
import { Pressable, StyleSheet, Text } from "react-native";
import { base, colors, fonts } from "@/theme";
import { MAX_OS_FONT_SCALE } from "@/theme/accessibility";

export type SheetButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export default function SheetButton({
  label,
  onPress,
  variant = "primary",
  scale: s,
  disabled,
}: {
  label: string;
  onPress: () => void;
  variant?: SheetButtonVariant;
  scale: number;
  disabled?: boolean;
}) {
  const fg =
    variant === "primary"
      ? colors.accentText
      : variant === "danger"
      ? colors.danger
      : colors.accent;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.base,
        { minHeight: base.tapTarget * s },
        variant === "primary" && styles.primary,
        variant === "secondary" && styles.secondary,
        (variant === "ghost" || variant === "danger") && styles.ghost,
        pressed && { opacity: 0.75 },
        disabled && { opacity: 0.4 },
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
    >
      <Text
        style={{ color: fg, fontSize: (base.fontSize + 1) * s, fontFamily: fonts.bodyMedium }}
        maxFontSizeMultiplier={MAX_OS_FONT_SCALE}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    width: "100%",
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 13,
    paddingHorizontal: base.spacing,
    marginTop: base.spacing,
  },
  primary: { backgroundColor: colors.accent },
  secondary: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  ghost: { backgroundColor: "transparent" },
});
