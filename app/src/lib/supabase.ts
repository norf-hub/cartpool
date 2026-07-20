import { createClient } from "@supabase/supabase-js";
import Constants from "expo-constants";

const { supabaseUrl, supabaseAnonKey } = Constants.expoConfig!.extra as {
  supabaseUrl: string;
  supabaseAnonKey: string;
};

// All client RPCs live in the `api` schema (0004_auth.sql): thin SECURITY
// DEFINER wrappers that bind the acting user to auth.uid(). The public
// schema's parameterized functions are not callable with the anon key.
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  db: { schema: "api" },
});
