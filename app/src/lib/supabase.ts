import { createClient } from "@supabase/supabase-js";
import Constants from "expo-constants";

const { supabaseUrl, supabaseAnonKey } = (Constants.expoConfig?.extra ?? {}) as {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
};

// Fail loudly and specifically: a missing .env produces an undefined URL, and
// every request then dies as an opaque "connection failed".
if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Supabase config missing. Expected app/.env with EXPO_PUBLIC_SUPABASE_URL " +
      "and EXPO_PUBLIC_SUPABASE_ANON_KEY, and `npx expo start` run from the " +
      "app/ directory (Expo only loads .env from the project root it starts in)."
  );
}

// All client RPCs live in the `api` schema (0004_auth.sql): thin SECURITY
// DEFINER wrappers that bind the acting user to auth.uid(). The public
// schema's parameterized functions are not callable with the anon key.
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  db: { schema: "api" },
});
