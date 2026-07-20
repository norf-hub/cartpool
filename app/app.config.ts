import { ExpoConfig } from "expo/config";

const config: ExpoConfig = {
  name: "Cartpool",
  slug: "cartpool",
  scheme: "cartpool", // deep links: cartpool.app/i/{code}
  version: "0.1.0",
  orientation: "portrait",
  ios: { bundleIdentifier: "app.cartpool", supportsTablet: false },
  android: { package: "app.cartpool" },
  plugins: ["expo-notifications"],
  extra: {
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  },
};

export default config;
