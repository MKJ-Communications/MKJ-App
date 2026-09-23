import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import type { AppRole } from "@/lib/roles";

export function useSession() {
  const [session, setSession] = useState<Awaited<ReturnType<typeof supabase.auth.getSession>>["data"]["session"] | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  return {
    session,
    ready,
    userId: session?.user.id ?? null,
    email: session?.user.email ?? null,
    // False for accounts that only ever signed in with Microsoft: they have no
    // password to change or reset. An email account later linked to Microsoft
    // keeps its password, so it lists both providers.
    hasPassword: session?.user.app_metadata.providers?.includes("email") ?? false,
  };
}

export function useProfile() {
  const { userId } = useSession();
  return useQuery({
    queryKey: ["profile", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("full_name, email")
        .eq("id", userId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export function useRoles() {
  const { userId } = useSession();
  return useQuery({
    queryKey: ["roles", userId],
    enabled: !!userId,
    queryFn: async (): Promise<AppRole[]> => {
      const { data, error } = await supabase.from("user_roles").select("role").eq("user_id", userId!);
      if (error) throw error;
      return (data ?? []).map((r) => r.role as AppRole);
    },
  });
}
