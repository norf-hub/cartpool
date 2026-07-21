// Build-time flags.

/**
 * Show the email sign-in option alongside phone.
 *
 * Phone is the account identity per spec §8 and the only sign-in method that
 * ships. This flag exists because sending SMS to US numbers requires a
 * registered A2P 10DLC sender, which a Twilio trial account cannot obtain —
 * so during development email OTP stands in.
 *
 * Defaults to on in dev, off in production builds. Set
 * EXPO_PUBLIC_DEV_EMAIL_AUTH=false in app/.env to force it off locally.
 */
export const DEV_EMAIL_AUTH =
  __DEV__ && process.env.EXPO_PUBLIC_DEV_EMAIL_AUTH !== "false";
