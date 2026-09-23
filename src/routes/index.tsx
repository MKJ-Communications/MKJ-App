import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

// "/" only forwards to the right page. The session lives in localStorage, so the
// route is client-only, and the check runs in an effect rather than beforeLoad: a
// redirect thrown while the page is still hydrating made React throw away the
// server HTML ("Hydration failed"). Same pattern as /auth.
export const Route = createFileRoute("/")({
  ssr: false,
  component: RootRedirect,
});

function RootRedirect() {
  const navigate = useNavigate();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      navigate({ to: data.session ? "/dashboard" : "/auth", replace: true });
    });
  }, [navigate]);

  return null;
}
