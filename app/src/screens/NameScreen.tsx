// Onboarding step 3 (mockup): the display-name prompt shown right after a
// new user first signs in. Their number is their account; this is the only
// thing other members see. Submitting calls api.set_display_name, which also
// flips the onboarded flag, and advances to the first-run screen.
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import SheetButton from "@/components/SheetButton";
import { base, colors, fonts } from "@/theme";
import { MAX_OS_FONT_SCALE } from "@/theme/accessibility";
import type { RpcResult } from "@/api/rpc";

export default function NameScreen({
  scale: s,
  onSubmit,
}: {
  scale: number;
  /** Persists the name; resolves so we only advance on success. */
  onSubmit: (name: string) => Promise<RpcResult>;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const ready = name.trim().length > 0;

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    const res = await onSubmit(name.trim());
    setBusy(false);
    if (!res.ok) {
      Alert.alert("Couldn't save your name", "Please try again.");
    }
    // On success the parent advances to the first-run screen.
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.body}>
        <Text style={[styles.title, { fontSize: 34 * s }]} maxFontSizeMultiplier={MAX_OS_FONT_SCALE}>
          What should your lists call you?
        </Text>
        <Text style={[styles.sub, { fontSize: 15 * s }]} maxFontSizeMultiplier={MAX_OS_FONT_SCALE}>
          A display name — the only thing other members see.
        </Text>
        <TextInput
          style={[styles.input, { fontSize: 20 * s, minHeight: base.tapTarget * s + 8 }]}
          placeholder="e.g. Rosa"
          placeholderTextColor={colors.textSecondary}
          value={name}
          onChangeText={setName}
          onSubmitEditing={submit}
          returnKeyType="done"
          autoFocus
          maxLength={40}
          accessibilityLabel="Your display name"
        />

        <View style={styles.readyCard}>
          <Text
            style={[styles.readyKicker, { fontSize: base.fontSizeSmall * s }]}
            maxFontSizeMultiplier={MAX_OS_FONT_SCALE}
          >
            Ready
          </Text>
          <Text
            style={[styles.readyBody, { fontSize: 14 * s }]}
            maxFontSizeMultiplier={MAX_OS_FONT_SCALE}
          >
            A personal list is created just for you. Invite up to 3 people per
            list whenever you like — or keep it solo.
          </Text>
        </View>
      </View>

      <View style={styles.footer}>
        {busy ? (
          <ActivityIndicator color={colors.accent} />
        ) : (
          <SheetButton
            label="Continue"
            onPress={submit}
            variant="primary"
            scale={s}
            disabled={!ready}
          />
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  body: { flex: 1, paddingHorizontal: 30, paddingTop: 70 },
  title: { fontFamily: fonts.heading, color: colors.text, marginBottom: 10, lineHeight: 38 },
  sub: { color: colors.textSecondary, marginBottom: 30 },
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
  readyCard: {
    marginTop: 26,
    backgroundColor: "#f0fae1", // accent-2-100
    borderRadius: 22,
    padding: 20,
  },
  readyKicker: {
    color: "#56633f", // accent-2-700
    fontFamily: fonts.bodyBold,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 6,
  },
  readyBody: { color: colors.text },
  footer: { paddingHorizontal: 30, paddingBottom: 40, paddingTop: 8 },
});
