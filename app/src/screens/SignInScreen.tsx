// Phone/OTP sign-in (spec §8). Two steps on one screen: enter phone, then
// enter the 6-digit code. Tap targets and type sizes follow addendum §4.1.
import { useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useAuth } from "@/hooks/useAuth";
import { base, colors } from "@/theme";
import { MAX_OS_FONT_SCALE } from "@/theme/accessibility";

export default function SignInScreen() {
  const { sendCode, verifyCode } = useAuth();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const normalizedPhone = () => {
    const digits = phone.replace(/[^\d+]/g, "");
    // Convenience: bare 10-digit US numbers get +1; anything already
    // E.164-ish passes through. Real validation happens server-side.
    if (/^\d{10}$/.test(digits)) return `+1${digits}`;
    return digits.startsWith("+") ? digits : `+${digits}`;
  };

  const onSend = async () => {
    setBusy(true);
    setMessage(null);
    const { error } = await sendCode(normalizedPhone());
    setBusy(false);
    if (error) {
      setMessage(error.message);
    } else {
      setStep("code");
      setMessage("We texted you a 6-digit code.");
    }
  };

  const onVerify = async () => {
    setBusy(true);
    setMessage(null);
    Keyboard.dismiss();
    const { error } = await verifyCode(normalizedPhone(), code.trim());
    setBusy(false);
    if (error) setMessage(error.message);
    // On success the auth listener in App.tsx swaps to the list screen.
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.card}>
        <Text style={styles.title} maxFontSizeMultiplier={MAX_OS_FONT_SCALE}>
          Cartpool
        </Text>
        <Text style={styles.subtitle} maxFontSizeMultiplier={MAX_OS_FONT_SCALE}>
          {step === "phone"
            ? "Sign in with your phone number"
            : `Enter the code we sent to ${normalizedPhone()}`}
        </Text>

        {step === "phone" ? (
          <TextInput
            style={styles.input}
            placeholder="Phone number"
            placeholderTextColor={colors.textSecondary}
            keyboardType="phone-pad"
            autoComplete="tel"
            value={phone}
            onChangeText={setPhone}
            onSubmitEditing={onSend}
            accessibilityLabel="Phone number"
          />
        ) : (
          <TextInput
            style={styles.input}
            placeholder="6-digit code"
            placeholderTextColor={colors.textSecondary}
            keyboardType="number-pad"
            autoComplete="sms-otp"
            textContentType="oneTimeCode"
            maxLength={6}
            value={code}
            onChangeText={setCode}
            onSubmitEditing={onVerify}
            accessibilityLabel="Verification code"
          />
        )}

        <Pressable
          style={({ pressed }) => [styles.button, pressed && { opacity: 0.8 }]}
          onPress={step === "phone" ? onSend : onVerify}
          disabled={busy || (step === "phone" ? phone.trim().length < 10 : code.trim().length < 6)}
          accessibilityRole="button"
        >
          {busy ? (
            <ActivityIndicator color={colors.accentText} />
          ) : (
            <Text style={styles.buttonText} maxFontSizeMultiplier={MAX_OS_FONT_SCALE}>
              {step === "phone" ? "Send code" : "Verify"}
            </Text>
          )}
        </Pressable>

        {step === "code" && (
          <Pressable
            style={styles.linkButton}
            onPress={() => {
              setStep("phone");
              setCode("");
              setMessage(null);
            }}
            accessibilityRole="button"
          >
            <Text style={styles.linkText} maxFontSizeMultiplier={MAX_OS_FONT_SCALE}>
              Use a different number
            </Text>
          </Pressable>
        )}

        {message && (
          <Text style={styles.message} maxFontSizeMultiplier={MAX_OS_FONT_SCALE}>
            {message}
          </Text>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: "center",
    padding: base.spacing * 2,
  },
  card: { gap: base.spacing },
  title: {
    fontSize: 34,
    fontWeight: "700",
    color: colors.accent,
    textAlign: "center",
    marginBottom: base.spacing,
  },
  subtitle: {
    fontSize: base.fontSize,
    color: colors.textSecondary,
    textAlign: "center",
    marginBottom: base.spacing,
  },
  input: {
    minHeight: base.tapTarget + 8,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: base.radius,
    paddingHorizontal: base.spacing,
    fontSize: base.fontSize + 2,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  button: {
    minHeight: base.tapTarget + 8,
    borderRadius: base.radius,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: { color: colors.accentText, fontSize: base.fontSize + 1, fontWeight: "600" },
  linkButton: {
    minHeight: base.tapTarget,
    alignItems: "center",
    justifyContent: "center",
  },
  linkText: { color: colors.accent, fontSize: base.fontSize },
  message: { color: colors.textSecondary, fontSize: base.fontSize, textAlign: "center" },
});
