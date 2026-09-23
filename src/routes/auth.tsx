import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import mkjLogo from "@/assets/mkj-logo-navy.png";
import { PasswordRequirements } from "@/components/password-requirements";
import { RequestPasswordResetDialog } from "@/components/request-password-reset-dialog";
import { PASSWORD_MIN_LENGTH, isPasswordValid } from "@/lib/password-policy";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Sign in — MKJ Ops" },
      { name: "description", content: "Sign in to MKJ Ops." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AuthPage,
});

// This route is ssr: false — the server can't render sign-in state (session
// check, form) meaningfully anyway. The router already defers this component
// to a client-only render on its own (see MatchView in
// @tanstack/react-router's Match.tsx, gated on the route's ssr:false option),
// so no manual <ClientOnly> wrapper is needed here — one used to sit around
// this function's return value and stacked a redundant boundary on top of the
// router's own, which is what was producing the "Hydration failed...
// <Suspense>" console error on load; see
// https://tanstack.com/start/latest/docs/framework/react/guide/hydration-errors
function AuthPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [resetOpen, setResetOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("signin");
  const submitting = useRef(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/dashboard", replace: true });
    });
  }, [navigate]);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    submitting.current = false;
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Welcome back");
    navigate({ to: "/dashboard", replace: true });
  }

  async function signUp(e: React.FormEvent) {
    e.preventDefault();
    if (submitting.current) return;
    if (!isPasswordValid(password)) return toast.error("Password does not meet the requirements.");
    submitting.current = true;
    setLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: window.location.origin,
        data: { full_name: fullName },
      },
    });
    if (error) {
      submitting.current = false;
      setLoading(false);
      return toast.error(error.message);
    }
    if (data.session) {
      submitting.current = false;
      setLoading(false);
      toast.success("Account created. Welcome!");
      navigate({ to: "/dashboard", replace: true });
      return;
    }
    // Supabase returns a session-less "success" with an empty identities array
    // (no error, to avoid leaking which emails are registered) when the email
    // already belongs to a confirmed account. Try the password the user just
    // entered — if it's their real password, sign them in instead of lying
    // that we sent a confirmation email.
    if (data.user && data.user.identities?.length === 0) {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      submitting.current = false;
      setLoading(false);
      if (!signInError) {
        toast.success("Welcome back");
        navigate({ to: "/dashboard", replace: true });
        return;
      }
      toast.error("An account with this email already exists. Sign in with your existing password.");
      setActiveTab("signin");
      return;
    }
    submitting.current = false;
    setLoading(false);
    toast.success("Account created. Check your email to confirm before signing in.");
    setActiveTab("signin");
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

        <Card>
          <CardHeader>
            <CardTitle>Sign in</CardTitle>
            <CardDescription>Access the operations dashboard.</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="signin">Sign in</TabsTrigger>
                <TabsTrigger value="signup">Create account</TabsTrigger>
              </TabsList>
              <TabsContent value="signin">
                <form className="space-y-4" onSubmit={signIn}>
                  <div className="space-y-2">
                    <Label htmlFor="email-in">Email</Label>
                    <Input id="email-in" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="pw-in">Password</Label>
                      <button type="button" onClick={() => setResetOpen(true)} className="text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
                        Forgot password?
                      </button>
                    </div>
                    <Input id="pw-in" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
                  </div>
                  <Button type="submit" className="w-full" disabled={loading}>{loading ? "Signing in…" : "Sign in"}</Button>
                </form>
              </TabsContent>
              <TabsContent value="signup">
                <form className="space-y-4" onSubmit={signUp}>
                  <div className="space-y-2">
                    <Label htmlFor="name-up">Full name</Label>
                    <Input id="name-up" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email-up">Email</Label>
                    <Input id="email-up" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="pw-up">Password</Label>
                    <Input id="pw-up" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={PASSWORD_MIN_LENGTH} autoComplete="new-password" />
                    <PasswordRequirements value={password} />
                  </div>
                  <Button type="submit" className="w-full" disabled={loading}>{loading ? "Creating…" : "Create account"}</Button>
                  <p className="text-xs text-muted-foreground">
                    The first account created becomes the Admin. Ask your admin to assign role and projects for later accounts.
                  </p>
                </form>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
        <RequestPasswordResetDialog open={resetOpen} onOpenChange={setResetOpen} defaultEmail={email} />

        <p className="mt-6 text-center text-xs text-muted-foreground">
          © 2026 JCL Industries. All rights reserved.
        </p>
      </div>
    </div>
  );
}
