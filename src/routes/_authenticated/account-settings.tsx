import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PasswordRequirements } from "@/components/password-requirements";
import { firstPasswordError, isPasswordValid } from "@/lib/password-policy";
import { useSession } from "@/hooks/use-session";

export const Route = createFileRoute("/_authenticated/account-settings")({
  head: () => ({
    meta: [
      { title: "Account Settings — MKJ Ops" },
      { name: "description", content: "Manage your MKJ Ops account and change your password." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AccountSettingsPage,
});

function AccountSettingsPage() {
  const { email, ready, hasPassword } = useSession();
  const navigate = useNavigate();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const errors = useMemo(() => {
    const e: Record<string, string | null> = {};
    e.current = current.trim() ? null : "Enter your current password.";
    e.next = !next ? "Enter a new password." : firstPasswordError(next);
    e.confirm = !confirm ? "Confirm your new password." : confirm !== next ? "Passwords do not match." : null;
    return e;
  }, [current, next, confirm]);

  const valid = Boolean(current.trim()) && isPasswordValid(next) && next === confirm;

  const changeMut = useMutation({
    mutationFn: async () => {
      if (!email) throw new Error("No active session.");
      // Re-authenticate to verify the current password before updating.
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password: current,
      });
      if (signInError) throw new Error("Current password is incorrect.");
      const { error } = await supabase.auth.updateUser({ password: next });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Password updated.");
      setCurrent("");
      setNext("");
      setConfirm("");
      setTouched({});
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not update password."),
  });

  function show(field: string) {
    return touched[field] ? errors[field] : null;
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Account Settings"
        description={email ? `Signed in as ${email}` : undefined}
        actions={
          <Button variant="outline" onClick={() => navigate({ to: "/dashboard" })}>
            Back to dashboard
          </Button>
        }
      />

      {!ready ? null : !hasPassword ? (
        <Card>
          <CardHeader>
            <CardTitle>Password</CardTitle>
            <CardDescription>
              You sign in with your Microsoft account, so there is no MKJ Ops password to change. Manage your password
              through Microsoft 365.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Change password</CardTitle>
            <CardDescription>Enter your current password, then choose a new one.</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-5"
              onSubmit={(e) => {
                e.preventDefault();
                setTouched({ current: true, next: true, confirm: true });
                if (valid) changeMut.mutate();
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="current-password">Current password</Label>
                <Input
                  id="current-password"
                  type="password"
                  autoComplete="current-password"
                  value={current}
                  onChange={(e) => setCurrent(e.target.value)}
                  onBlur={() => setTouched((t) => ({ ...t, current: true }))}
                />
                {show("current") ? <p className="text-xs text-destructive">{show("current")}</p> : null}
              </div>

              <div className="space-y-2">
                <Label htmlFor="new-password">New password</Label>
                <Input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  value={next}
                  onChange={(e) => setNext(e.target.value)}
                  onBlur={() => setTouched((t) => ({ ...t, next: true }))}
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
                {show("confirm") ? <p className="text-xs text-destructive">{show("confirm")}</p> : null}
              </div>

              <Button type="submit" disabled={!valid || changeMut.isPending}>
                {changeMut.isPending ? "Updating…" : "Update Password"}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
