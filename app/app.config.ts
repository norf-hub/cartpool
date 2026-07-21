import { ExpoConfig } from "expo/config";

const config: ExpoConfig = {
  name: "Cartpool",
  slug: "cartpool",
  scheme: "cartpool", // deep links: cartpool.app/i/{code}
  version: "0.1.0",
  orientation: "portrait",
  ios: {
    bundleIdentifier: "app.cartpool",
    supportsTablet: false,
    // Universal links for https://cartpool.app/i/{code}. Requires the domain
    // to serve /.well-known/apple-app-site-association (see INFRA.md) —
    // until then the cartpool:// scheme still works for testing.
    associatedDomains: ["applinks:cartpool.app"],
  },
  android: {
    package: "app.cartpool",
    // App Links for the same URLs. autoVerify needs
    // /.well-known/assetlinks.json on cartpool.app (see INFRA.md).
    intentFilters: [
      {
        action: "VIEW",
        autoVerify: true,
        data: [{ scheme: "https", host: "cartpool.app", pathPrefix: "/i/" }],
        category: ["BROWSABLE", "DEFAULT"],
      },
    ],
  },
  plugins: ["expo-notifications"],
  extra: {
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  },
};

export default config;
