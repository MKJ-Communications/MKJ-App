import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ProjectMultiSelect } from "@/components/project-multiselect";
import { toast } from "sonner";
import { ROLE_LABELS, type AppRole } from "@/lib/roles";
import { Pencil } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_authenticated/users")({
  head: () => ({ meta: [{ title: "Users & Roles — MKJ Ops" }] }),
  // Redirect from the component, not beforeLoad — see _authenticated/route.tsx.
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    // No user: the parent layout sends them to /auth and never renders this page.
    if (!data.user) return { isAdmin: false };
    const { data: adminRow } = await supabase
      .from("user_roles").select("role").eq("user_id", data.user.id).eq("role", "admin").maybeSingle();
    return { isAdmin: !!adminRow };
  },
  component: UsersRoute,
});

function UsersRoute() {
  const { isAdmin } = Route.useRouteContext();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isAdmin) navigate({ to: "/dashboard", replace: true });
  }, [isAdmin, navigate]);

  return isAdmin ? <UsersPage /> : null;
}

const ALL_ROLES: AppRole[] = ["admin", "warehouse_manager", "manager", "engineer"];

function UsersPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);



  const users = useQuery({
    queryKey: ["all-users"],
    queryFn: async () => {
      const [profilesRes, rolesRes, pmRes, peRes, projectsRes] = await Promise.all([
        supabase.from("profiles").select("id, email, full_name").order("full_name"),
        supabase.from("user_roles").select("user_id, role"),
        supabase.from("project_managers").select("user_id, project_id"),
        supabase.from("project_engineers").select("user_id, project_id"),
        supabase.from("projects").select("id, mkj_number, name").order("mkj_number"),
      ]);
      if (profilesRes.error) throw profilesRes.error;
      const rolesByUser = new Map<string, AppRole[]>();
      (rolesRes.data ?? []).forEach((r) => {
        const arr = rolesByUser.get(r.user_id) ?? [];
        arr.push(r.role as AppRole);
        rolesByUser.set(r.user_id, arr);
      });
      const managerProjects = new Map<string, string[]>();
      (pmRes.data ?? []).forEach((r) => {
        const arr = managerProjects.get(r.user_id) ?? [];
        arr.push(r.project_id);
        managerProjects.set(r.user_id, arr);
      });
      const engineerProjects = new Map<string, string[]>();
      (peRes.data ?? []).forEach((r) => {
        const arr = engineerProjects.get(r.user_id) ?? [];
        arr.push(r.project_id);
        engineerProjects.set(r.user_id, arr);
      });
      return {
        profiles: profilesRes.data ?? [],
        roles: rolesByUser,
        managerProjects,
        engineerProjects,
        projects: projectsRes.data ?? [],
      };
    },
  });

  const setRoleMut = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: AppRole }) => {
      const { error } = await supabase.rpc("set_user_role" as never, { _user_id: userId, _role: role } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Role updated");
      qc.invalidateQueries({ queryKey: ["all-users"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [demoteConfirm, setDemoteConfirm] = useState<{ userId: string; name: string; role: AppRole } | null>(null);

  function handleRoleChange(userId: string, name: string, currentRole: AppRole | undefined, role: AppRole) {
    if (currentRole === "admin" && role !== "admin") {
      setDemoteConfirm({ userId, name, role });
    } else {
      setRoleMut.mutate({ userId, role });
    }
  }

  const renameMut = useMutation({
    mutationFn: async ({ userId, fullName }: { userId: string; fullName: string }) => {
      const { error } = await supabase.from("profiles").update({ full_name: fullName }).eq("id", userId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Name updated");
      setEditing(null);
      qc.invalidateQueries({ queryKey: ["all-users"] });
      qc.invalidateQueries({ queryKey: ["profile"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleAssignmentMut = useMutation({
    mutationFn: async ({ userId, projectId, table, on }: { userId: string; projectId: string; table: "project_managers" | "project_engineers"; on: boolean }) => {
      if (on) {
        const { error } = await supabase.from(table).insert({ user_id: userId, project_id: projectId });
        if (error && !error.message.includes("duplicate")) throw error;
      } else {
        const { error } = await supabase.from(table).delete().eq("user_id", userId).eq("project_id", projectId);
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["all-users"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title="Users & Roles" description="Admin-only. Assign each user a role and the projects they work on." />
      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow>
            <TableHead>User</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Project assignments</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {users.data ? users.data.profiles.map((u) => {
              const rs = users.data.roles.get(u.id) ?? [];
              const currentRole = rs[0];
              const isManager = currentRole === "manager";
              const isEngineer = currentRole === "engineer";
              const assigned = new Set(
                isManager ? users.data.managerProjects.get(u.id) ?? []
                : isEngineer ? users.data.engineerProjects.get(u.id) ?? []
                : []
              );
              return (
                <TableRow key={u.id}>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <div className="font-medium">{u.full_name ?? u.email}</div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        title="Edit name"
                        onClick={() => setEditing({ id: u.id, name: u.full_name ?? "" })}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    <div className="text-xs text-muted-foreground">{u.email}</div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {currentRole ? <Badge>{ROLE_LABELS[currentRole]}</Badge> : <Badge variant="outline">None</Badge>}
                      <Select value={currentRole ?? ""} onValueChange={(v) => handleRoleChange(u.id, u.full_name ?? u.email ?? "this user", currentRole, v as AppRole)}>
                        <SelectTrigger className="h-8 w-40"><SelectValue placeholder="Set role" /></SelectTrigger>
                        <SelectContent>
                          {ALL_ROLES.map((r) => <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </TableCell>
                  <TableCell>
                    {isManager ? (
                      <div className="text-xs text-muted-foreground">
                        {users.data.projects.filter((p) => assigned.has(p.id)).map((p) => p.mkj_number).join(", ") || "No projects yet"}
                        <div>Set via each project's edit dialog — a project has one manager.</div>
                      </div>
                    ) : isEngineer ? (
                      <ProjectMultiSelect
                        projects={users.data.projects}
                        selected={assigned}
                        onToggle={(projectId, on) => toggleAssignmentMut.mutate({ userId: u.id, projectId, table: "project_engineers", on })}
                      />
                    ) : (
                      <span className="text-xs text-muted-foreground">Admins & Warehouse Managers see every project.</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            }) : <TableRow><TableCell colSpan={3} className="py-6 text-center text-sm text-muted-foreground">Loading…</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent></Card>
      <p className="mt-3 text-xs text-muted-foreground">Users appear here once they create an account from the sign-in page.</p>
      <div className="mt-2"><Button variant="outline" size="sm" onClick={() => qc.invalidateQueries({ queryKey: ["all-users"] })}>Refresh</Button></div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Edit user name</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="full_name">Full name</Label>
            <Input
              id="full_name"
              value={editing?.name ?? ""}
              onChange={(e) => setEditing((p) => (p ? { ...p, name: e.target.value } : p))}
              placeholder="Jane Doe"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button
              disabled={!editing?.name.trim() || renameMut.isPending}
              onClick={() => editing && renameMut.mutate({ userId: editing.id, fullName: editing.name.trim() })}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!demoteConfirm} onOpenChange={(o) => !o && setDemoteConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove admin from {demoteConfirm?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This changes their role to {demoteConfirm ? ROLE_LABELS[demoteConfirm.role] : ""}. If they're the only
              admin, this will be rejected — the system never allows the last admin to be removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={setRoleMut.isPending}
              onClick={() => demoteConfirm && setRoleMut.mutate({ userId: demoteConfirm.userId, role: demoteConfirm.role }, { onSuccess: () => setDemoteConfirm(null) })}
            >
              {setRoleMut.isPending ? "Saving…" : "Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
