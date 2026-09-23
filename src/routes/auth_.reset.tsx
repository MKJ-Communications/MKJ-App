import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import mkjLogo from "@/assets/mkj-logo-navy.png";
import { PasswordRequirements } from "@/components/password-requirements";
import { RequestPasswordResetDialog } from "@/components/request-password-reset-dialog";
import { firstPasswordError, isPasswordValid } from "@/lib/password-policy";

// Named auth_.reset.tsx, not auth.reset.tsx: the trailing underscore opts this
// route out of nesting, so /auth keeps rendering as a leaf instead of turning
// into a layout that would need an <Outlet />.
export const Route = createFileRoute("/auth_/reset")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Choose a new password — MKJ Ops" },
      { name: "description", content: "Set a new password for your MKJ Ops account." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ResetPasswordPage,
});

// Same reasoning as /auth: the server can't render recovery state, and the
// router's own ssr:false handling already defers this component to a
// client-only render — no manual <ClientOnly> wrapper needed on top of it
// (see the comment on AuthPage in auth.tsx for why one there caused a
// hydration mismatch).
type Arrival = "token" | "error" | "none";

/**
 * How the browser got here. Supabase hands the recovery token back in the URL —
 * as a fragment (`#access_token=…&type=recovery`) on the implicit flow, or
 * `?code=…` on PKCE — and supabase-js consumes and strips it as soon as the
 * client initialises, so this has to be read during the first render.
 *
 * A dead link arrives as `#error=access_denied&error_code=otp_expired` instead;
 * that is already the final answer, so it skips the wait for a session that is
 * never coming.
 */
function readArrival(): Arrival {
  if (typeof window === "undefined") return "none";
  const params = new URLSearchParams(
    window.location.hash.slice(1) || window.location.search.slice(1),
  );
  if (params.has("error") || params.has("error_code")) return "error";
  if (params.get("type") === "recovery" || params.has("code") || params.has("access_token")) {
    return "token";
  }
  return "none";
}

type Status = "checking" | "ready" | "invalid";

function ResetPasswordPage() {
  const navigate = useNavigate();
  // useState initialiser, not useEffect: this must run before anything touches
  // the Supabase client, which clears the URL on initialise.
  const [arrival] = useState(readArrival);
  const [status, setStatus] = useState<Status>("checking");
  const [resendOpen, setResendOpen] = useState(false);

  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (arrival === "error") {
      // Supabase already told us the link is dead — nothing to wait for.
      setStatus("invalid");
      return;
    }

    if (arrival === "none") {
      // No recovery token in the URL. Someone who is already signed in and
      // browsing here wants the ordinary change-password form, which asks for
      // the current password first — don't let this page bypass that check.
      supabase.auth.getSession().then(({ data }) => {
        if (data.session) navigate({ to: "/account-settings", replace: true });
        else setStatus("invalid");
      });
      return;
    }

    let settled = false;
    const settle = (s: Status) => {
      if (settled) return;
      settled = true;
      setStatus(s);
    };

    // The session arrives asynchronously once supabase-js has processed the URL.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || session) settle("ready");
    });
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) settle("ready");
    });

    // An expired or already-used link still redirects here, just without a
    // usable session — nothing further arrives, so time out rather than hang.
    const timer = setTimeout(() => settle("invalid"), 5000);

    return () => {
      sub.subscription.unsubscribe();
      clearTimeout(timer);
    };
  }, [arrival, navigate]);

  const errors = useMemo(() => {
    const e: Record<string, string | null> = {};
    e.next = !next ? "Enter a new password." : firstPasswordError(next);
    e.confirm = !confirm
      ? "Confirm your new password."
      : confirm !== next
        ? "Passwords do not match."
        : null;
    return e;
  }, [next, confirm]);

  const valid = isPasswordValid(next) && next === confirm;

  const setMut = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.auth.updateUser({ password: next });
      if (error) throw error;
    },
    onSuccess: () => {
      // The recovery link already established a session, so they're signed in.
      toast.success("Password updated. You're signed in.");
      navigate({ to: "/dashboard", replace: true });
    },
    onError: (e: unknown) => {
      const message = e instanceof Error ? e.message : "Could not update your password.";
      // The recovery session can lapse between loading this page and submitting
      // it. Drop back to the expired state so there's a way forward, rather
      // than leaving a dead form and a raw "Auth session missing!" toast.
      if (/session|jwt|expired/i.test(message)) {
        setStatus("invalid");
        toast.error("Your reset link expired before the password was saved. Request a new one.");
        return;
      }
      toast.error(message);
    },
  });

  function show(field: string) {
    return touched[field] ? errors[field] : null;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 px-4">
      <div className="w-full max-w-md">
        <Link to="/" className="mb-8 flex flex-col items-center justify-center gap-3">
          <div className="flex h-14 items-center justify-center rounded-lg bg-brand-navy px-5">
            <img src={mkjLogo} alt="MKJ Communications" className="h-8 w-auto object-contain" />
          </div>
          <span className="text-2xl font-semibold tracking-tight">MKJ Ops</span>
        </Link>

        {status === "checking" ? (
          <Card>
            <CardHeader>
              <CardTitle>Checking your link</CardTitle>
              <CardDescription>One moment…</CardDescription>
            </CardHeader>
          </Card>
        ) : status === "invalid" ? (
          <Card>
            <CardHeader>
              <CardTitle>This link has expired</CardTitle>
              <CardDescription>
                Password reset links are valid for 24 hours and can only be used once. Request a new
                one and we'll email it straight over.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button onClick={() => setResendOpen(true)}>Send a new link</Button>
              <Button variant="outline" onClick={() => navigate({ to: "/auth" })}>
                Back to sign in
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Choose a new password</CardTitle>
              <CardDescription>
                Pick something you don't use anywhere else. You'll be signed in once it's saved.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form
                className="space-y-5"
                onSubmit={(e) => {
                  e.preventDefault();
                  setTouched({ next: true, confirm: true });
                  if (valid) setMut.mutate();
                }}
              >
                <div className="space-y-2">
                  <Label htmlFor="new-password">New password</Label>
                  <Input
                    id="new-password"
                    type="password"
                    autoComplete="new-password"
                    value={next}
                    onChange={(e) => setNext(e.target.value)}
                    onBlur={() => setTouched((t) => ({ ...t, next: true }))}
                    autoFocus
                  />
                  <PasswordRequirements value={next} />
                  {show("next") ? <p className="text-xs text-destructive">{show("next")}</p> : null}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confirm-password">Confirm new password</Label>
                  <Input
                    id="confirm-password"
                    type="password"
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    onBlur={() => setTouched((t) => ({ ...t, confirm: true }))}
                  />
                  {show("confirm") ? (
                    <p className="text-xs text-destructive">{show("confirm")}</p>
                  ) : null}
                </div>

                <Button type="submit" className="w-full" disabled={!valid || setMut.isPending}>
                  {setMut.isPending ? "Saving…" : "Save new password"}
                </Button>
              </form>
            </CardContent>
          </Card>
        )}

        <RequestPasswordResetDialog open={resendOpen} onOpenChange={setResendOpen} />

        <p className="mt-6 text-center text-xs text-muted-foreground">
          © 2026 JCL Industries. All rights reserved.
        </p>
      </div>
    </div>
  );
}
