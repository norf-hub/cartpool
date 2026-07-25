// Name / rename a group (0016). Opened from the Groups tab. Any member can
// rename — there's no owner role in the spec, membership is the authority.
// Clearing the field restores the automatic "With Rosa, Bill" title, so the
// empty state is a valid save rather than a validation error.
import { useState } from "react";
import { Alert, StyleSheet, Text, TextInput, View } from "react-native";
import BottomSheet from "@/components/BottomSheet";
import SheetButton from "@/components/SheetButton";
import type { GroupInfo } from "@/hooks/useCartpool";
import type { RpcResult } from "@/api/rpc";
import { base, colors, fonts } from "@/theme";
import { MAX_OS_FONT_SCALE } from "@/theme/accessibility";

const SUGGESTIONS = ["Household", "Family", "Flatmates", "Mum & Dad"];

export default function RenameGroupSheet({
  group,
  fallbackTitle,
  scale: s,
  onRename,
  onClose,
}: {
  /** The group being renamed, or null when the sheet is closed. */
  group: GroupInfo | null;
  /** What the group is called when it has no custom name. */
  fallbackTitle: string;
  scale: number;
  onRename: (groupId: string, name: string) => Promise<RpcResult>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  // Remount per group so the field always opens on the right current name.
  const key = group?.id ?? "none";

  const save = async (value: string) => {
    if (!group || busy) return;
    setBusy(true);
    const res = await onRename(group.id, value);
    setBusy(false);
    if (!res.ok) {
      Alert.alert(
        "Couldn't rename",
        res.error === "read_only"
          ? "Your account is read-only right now."
          : res.error === "not_a_member"
          ? "You're not in this group anymore."
          : "Please try again."
      );
      return;
    }
    onClose();
  };

  return (
    <BottomSheet visible={!!group} onClose={onClose} title="Name this group" scale={s}>
      {group && (
        <View key={key}>
          <Text
            style={[styles.title, { fontSize: 26 * s }]}
            maxFontSizeMultiplier={MAX_OS_FONT_SCALE}
          >
            Name this group
          </Text>
          <Text
            style={[styles.sub, { fontSize: 13.5 * s }]}
            maxFontSizeMultiplier={MAX_OS_FONT_SCALE}
          >
            Everyone in the group sees this name. Leave it empty to go back to
            “{fallbackTitle}”.
          </Text>

          <TextInput
            style={[styles.input, { fontSize: 20 * s, minHeight: base.tapTarget * s + 8 }]}
            placeholder="e.g. Household"
            placeholderTextColor={colors.textSecondary}
            defaultValue={group.name ?? ""}
            onChangeText={setDraft}
            onSubmitEditing={() => save(draft)}
            returnKeyType="done"
            autoFocus
            maxLength={40}
            accessibilityLabel="Group name"
          />

          <View style={styles.chips}>
            {SUGGESTIONS.map((sug) => (
              <SheetButton
                key={sug}
                label={sug}
                variant="secondary"
                scale={s}
                disabled={busy}
                onPress={() => save(sug)}
              />
            ))}
          </View>

          <SheetButton
            label="Save name"
            variant="primary"
            scale={s}
            disabled={busy}
            onPress={() => save(draft)}
          />
        </View>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  title: {
    fontFamily: fonts.heading,
    color: colors.text,
    marginBottom: 6,
    paddingRight: 40, // clear the ✕
  },
  sub: { color: colors.textSecondary, marginBottom: base.spacing },
  input: {
    width: "100%",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 18,
    color: colors.text,
    backgroundColor: colors.surface,
    fontFamily: fonts.body,
  },
  chips: { marginTop: 4 },
});
