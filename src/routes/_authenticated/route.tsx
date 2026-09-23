import { useEffect } from "react";
import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  // Look the user up here, but redirect from the component. A redirect thrown in
  // beforeLoad resolves before React hydrates a direct page load, so the browser
  // renders /auth while the server sent this route's client-only placeholder —
  // "Hydration failed". The guard is navigation only either way: RLS protects the
  // data, and with no user nothing below this route renders or queries.
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    return { user: error ? null : data.user };
  },
  // ssr: false already makes the router defer this route (and everything
  // under it) to a client-only render via its own internal ClientOnly/Suspense
  // wrapping (see MatchView in @tanstack/react-router's Match.tsx, gated on
  // match.ssr === false). Wrapping the component in a second, manual
  // <ClientOnly> here stacked a redundant boundary directly on top of that
  // one on every authenticated page — which is what was producing the
  // "Hydration failed... <Suspense>" console error on load. Let the route
  // option do it once; see
  // https://tanstack.com/start/latest/docs/framework/react/guide/hydration-errors
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const { user } = Route.useRouteContext();
  const navigate = useNavigate();

  useEffect(() => {
    if (!user) navigate({ to: "/auth", replace: true });
  }, [user, navigate]);

  if (!user) return null;

  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
