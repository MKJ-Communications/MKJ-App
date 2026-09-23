import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  LayoutDashboard,
  FolderKanban,
  Package,
  Truck,
  ClipboardList,
  Warehouse,
  ArrowLeftRight,
  Factory,
  Bell,
  Users,
  Building2,
  Menu,
  LogOut,
  Settings,
  KeyRound,
  Rocket,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import mkjLogo from "@/assets/mkj-logo-navy.png";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { RequestPasswordResetDialog } from "@/components/request-password-reset-dialog";
import { useProfile, useRoles, useSession } from "@/hooks/use-session";
import { isAdmin, isWarehouseOrAdmin, highestRole, ROLE_LABELS } from "@/lib/roles";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

type NavItem = { to: string; label: string; icon: React.ComponentType<{ className?: string }>; adminOnly?: boolean; warehouseOnly?: boolean };

import { Upload } from "lucide-react";

const NAV: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/projects", label: "Projects", icon: FolderKanban },
  { to: "/purchase-orders", label: "Purchase Orders", icon: ClipboardList },
  { to: "/packing-slips", label: "Packing Slips", icon: Package },
  { to: "/shipping-tickets", label: "Shipping Tickets", icon: Truck },
  { to: "/inventory", label: "Inventory", icon: Warehouse },
  { to: "/borrow-requests", label: "Borrow Requests", icon: ArrowLeftRight },
  // Build requests; Systems (templates) is one click away from there.
  { to: "/manufacturing", label: "Manufacturing", icon: Factory },
  { to: "/products", label: "Products", icon: Package, warehouseOnly: true },
  { to: "/suppliers", label: "Suppliers", icon: Building2, warehouseOnly: true },
  { to: "/users", label: "Users & Roles", icon: Users, adminOnly: true },
  { to: "/bulk-upload", label: "Bulk Upload", icon: Upload, adminOnly: true },
  { to: "/future-development", label: "Future Development", icon: Rocket },
];

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const { pathname } = useLocation();
  const { data: roles = [] } = useRoles();
  const admin = isAdmin(roles);
  const warehouse = isWarehouseOrAdmin(roles);

  return (
    <nav className="flex flex-col gap-0.5 p-2">
      {NAV.filter((n) => (n.adminOnly ? admin : n.warehouseOnly ? warehouse : true)).map((item) => {
        const active = pathname === item.to || pathname.startsWith(item.to + "/");
        const Icon = item.icon;
        return (
          <Link
            key={item.to}
            to={item.to}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              active ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
            )}
          >
            <Icon className="h-4 w-4" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

function NotificationsBell() {
  const { userId } = useSession();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data } = useQuery({
    queryKey: ["notifications", userId, "unread-count"],
    enabled: !!userId,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("notifications")
        .select("*", { count: "exact", head: true })
        .is("read_at", null);
      if (error) throw error;
      return count ?? 0;
    },
  });

  // Live updates: refresh the badge as soon as a notification row lands.
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`notifications-${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `recipient_user_id=eq.${userId}` }, () => {
        qc.invalidateQueries({ queryKey: ["notifications"] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, qc]);

  return (
    <Button
      variant="ghost"
      size="icon"
      className="relative"
      onClick={() => {
        navigate({ to: "/notifications" });
        qc.invalidateQueries({ queryKey: ["notifications"] });
      }}
      aria-label="Notifications"
    >
      <Bell className="h-5 w-5" />
      {data && data > 0 ? (
        <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
          {data > 99 ? "99+" : data}
        </span>
      ) : null}
    </Button>
  );
}

function UserMenu() {
  const { email } = useSession();
  const { data: profile } = useProfile();
  const { data: roles = [] } = useRoles();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const top = highestRole(roles);
  const displayName = profile?.full_name?.trim() || email || "";
  const [resetOpen, setResetOpen] = useState(false);

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    // The dialog sits outside <DropdownMenu> on purpose: Radix restores focus to
    // the trigger as the menu closes, which fights a dialog rendered inside it.
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="h-9 gap-2 px-2">
            <div className="hidden text-right sm:block">
              <div className="text-xs font-medium leading-none">{displayName}</div>
              {top ? <div className="mt-0.5 text-[10px] text-muted-foreground">{ROLE_LABELS[top]}</div> : null}
            </div>
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
              {(displayName || "?").slice(0, 1).toUpperCase()}
            </div>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>
            <div className="text-sm font-medium">{displayName}</div>
            {top ? <div className="mt-0.5"><Badge variant="secondary">{ROLE_LABELS[top]}</Badge></div> : null}
          </DropdownMenuLabel>

          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => navigate({ to: "/account-settings" })}>
            <Settings className="mr-2 h-4 w-4" /> Account settings
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setResetOpen(true)} disabled={!email}>
            <KeyRound className="mr-2 h-4 w-4" /> Reset password
          </DropdownMenuItem>
          <DropdownMenuItem onClick={signOut}>
            <LogOut className="mr-2 h-4 w-4" /> Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <RequestPasswordResetDialog open={resetOpen} onOpenChange={setResetOpen} fixedEmail={email} />
    </>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  return (
    <div className="flex min-h-screen bg-muted/30">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 border-r bg-sidebar md:block">
        <div className="flex h-16 items-center justify-center border-b border-sidebar-border bg-brand-navy px-3">
          <img src={mkjLogo} alt="MKJ Communications" className="h-8 w-auto object-contain" />
        </div>
        <NavList />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open menu">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-64 bg-sidebar p-0" closeClassName="text-sidebar-foreground">
              <div className="flex h-16 items-center justify-center border-b border-sidebar-border bg-brand-navy px-3">
                <img src={mkjLogo} alt="MKJ Communications" className="h-8 w-auto object-contain" />
              </div>
              <NavList onNavigate={() => setMobileOpen(false)} />
            </SheetContent>
          </Sheet>
          <div className="flex-1" />
          <NotificationsBell />
          <UserMenu />
        </header>
        <main className="flex-1 p-4 md:p-6">{children}</main>
        <footer className="shrink-0 border-t bg-background px-4 py-3 text-center text-xs text-muted-foreground md:px-6">
          © 2026 JCL Industries. All rights reserved.
        </footer>
      </div>
    </div>
  );
}
