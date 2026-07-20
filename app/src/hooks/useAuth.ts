// Phone/OTP auth state (spec §8). Supabase Auth handles the OTP send/verify;
// the 0006 signup trigger provisions the users row + solo group server-side,
// so the client has nothing to create on first sign-in.
import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return {
    session,
    loading,
    userId: session?.user.id ?? null,
    /** Step 1: send the SMS code. E.164 phone, e.g. +15551234567. */
    sendCode: (phone: string) => supabase.auth.signInWithOtp({ phone }),
    /** Step 2: verify the 6-digit code. */
    verifyCode: (phone: string, token: string) =>
      supabase.auth.verifyOtp({ phone, token, type: "sms" }),
    signOut: () => supabase.auth.signOut(),
  };
}
