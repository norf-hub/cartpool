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
import { DEV_EMAIL_AUTH } from "@/config";
import { base, colors } from "@/theme";
import { MAX_OS_FONT_SCALE } from "@/theme/accessibility";

// Phone is the shipping method (spec §8). The other two exist only so
// development isn't blocked: US SMS needs a registered A2P sender, and
// Supabase's built-in mailer allows 2 messages/hour. Both are gated behind
// DEV_EMAIL_AUTH and disappear from production builds.
type Mode = "phone" | "email" | "password";

export default function SignInScreen() {
  const { sendCode, verifyCode, sendEmailCode, verifyEmailCode, signInWithPassword } = useAuth();
  const [mode, setMode] = useState<Mode>("phone");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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

  const emailValid = /^\S+@\S+\.\S+$/.test(email.trim());
  const identifier = () => (mode === "phone" ? normalizedPhone() : email.trim());

  const identifierReady =
    mode === "phone"
      ? phone.trim().length >= 10
      : mode === "email"
        ? emailValid
        : emailValid && password.length > 0;

  // Password mode signs in outright; the OTP modes send a code first.
  const onSend = async () => {
    setBusy(true);
    setMessage(null);

    if (mode === "password") {
      Keyboard.dismiss();
      const { error } = await signInWithPassword(email.trim(), password);
      setBusy(false);
      if (error) setMessage(error.message);
      return;
    }

    const { error } =
      mode === "email" ? await sendEmailCode(email.trim()) : await sendCode(normalizedPhone());
    setBusy(false);
    if (error) {
      setMessage(error.message);
    } else {
      setStep("code");
      setMessage(
        mode === "email"
          ? "We emailed you a 6-digit code."
          : "We texted you a 6-digit code."
      );
    }
  };

  const onVerify = async () => {
    setBusy(true);
    setMessage(null);
    Keyboard.dismiss();
    const { error } =
      mode === "email"
        ? await verifyEmailCode(email.trim(), code.trim())
        : await verifyCode(normalizedPhone(), code.trim());
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
            ? mode === "phone"
              ? "Sign in with your phone number"
              : mode === "email"
                ? "Sign in with your email"
                : "Dev sign-in with test account"
            : `Enter the code we sent to ${identifier()}`}
        </Text>

        {step === "phone" ? (
          mode === "phone" ? (
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
            <>
              <TextInput
                style={styles.input}
                placeholder="Email address"
                placeholderTextColor={colors.textSecondary}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                value={email}
                onChangeText={setEmail}
                onSubmitEditing={onSend}
                accessibilityLabel="Email address"
              />
              {mode === "password" && (
                <TextInput
                  style={styles.input}
                  placeholder="Password"
                  placeholderTextColor={colors.textSecondary}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                  value={password}
                  onChangeText={setPassword}
                  onSubmitEditing={onSend}
                  accessibilityLabel="Password"
                />
              )}
            </>
          )
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
          disabled={busy || (step === "phone" ? !identifierReady : code.trim().length < 6)}
          accessibilityRole="button"
        >
          {busy ? (
            <ActivityIndicator color={colors.accentText} />
          ) : (
            <Text style={styles.buttonText} maxFontSizeMultiplier={MAX_OS_FONT_SCALE}>
              {step === "code" ? "Verify" : mode === "password" ? "Sign in" : "Send code"}
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
              {mode === "phone" ? "Use a different number" : "Use a different email"}
            </Text>
          </Pressable>
        )}

        {/* Dev-only mode switcher (see src/config.ts). Cycles phone -> password
            -> email -> phone; password is first because it needs no delivery. */}
        {DEV_EMAIL_AUTH && step === "phone" && (
          <Pressable
            style={styles.linkButton}
            onPress={() => {
              setMode((m) => (m === "phone" ? "password" : m === "password" ? "email" : "phone"));
              setMessage(null);
            }}
            accessibilityRole="button"
          >
            <Text style={styles.linkText} maxFontSizeMultiplier={MAX_OS_FONT_SCALE}>
              {mode === "phone"
                ? "Dev: password sign-in"
                : mode === "password"
                  ? "Dev: email code instead"
                  : "Back to phone sign-in"}
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
