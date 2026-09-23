import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useRoles, useSession } from "@/hooks/use-session";
import { isAdmin, isWarehouseOrAdmin, type AppRole } from "@/lib/roles";

export type PoRequestStatus = Database["public"]["Enums"]["po_request_status"];

export type PoRequestLine = {
  id: string;
  line_no: number;
  product_id: string | null;
  custom_description: string | null;
  qty: number;
  unit: string;
  product: { part_number: string; description: string } | null;
};

export type PoRequest = {
  id: string;
  request_number: string;
  project_id: string;
  project_number: string;
  project_name: string | null;
  status: PoRequestStatus;
  notes: string | null;
  requested_by: string | null;
  created_at: string;
  completed_by: string | null;
  completed_at: string | null;
  po_reference: string | null;
  cancelled_by: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  lines: PoRequestLine[];
  requester_name: string | null;
  completer_name: string | null;
  canceller_name: string | null;
};

export const PO_REQUEST_LIST_LIMIT = 200;

/** A line's item as people read it: the catalog product, or what was typed. */
export function lineLabel(l: PoRequestLine): string {
  return l.product ? `${l.product.part_number} — ${l.product.description}` : l.custom_description ?? "";
}

export function linesSummary(lines: PoRequestLine[]): string {
  return `${lines.length} ${lines.length === 1 ? "line" : "lines"}`;
}

/** PO requests the viewer can see (RLS: same projects as their POs), newest first. */
export function usePoRequests(opts: { projectId?: string; enabled?: boolean } = {}) {
  const { projectId, enabled = true } = opts;
  return useQuery({
    queryKey: ["po-requests", projectId ?? "all"],
    enabled,
    queryFn: async () => {
      // Fetch one past the cap so a full page can be told apart from a truncated one.
      let query = supabase
        .from("po_requests")
        .select(
          "id, request_number, project_id, project_number, status, notes, requested_by, created_at, completed_by, completed_at, po_reference, cancelled_by, cancelled_at, cancel_reason, projects:project_id(name), po_request_lines(id, line_no, product_id, custom_description, qty, unit, products:product_id(part_number, description))",
        )
        .order("created_at", { ascending: false })
        .limit(PO_REQUEST_LIST_LIMIT + 1);
      if (projectId) query = query.eq("project_id", projectId);
      const { data, error } = await query;
      if (error) throw error;
      const raw = data ?? [];

      // requested_by/completed_by/cancelled_by reference auth.users, so names
      // come from the name-only user directory.
      const ids = Array.from(
        new Set(raw.flatMap((r) => [r.requested_by, r.completed_by, r.cancelled_by]).filter((v): v is string => !!v)),
      );
      let names: Record<string, string | null> = {};
      if (ids.length > 0) {
        const { data: dir } = await supabase.from("user_directory").select("id, full_name").in("id", ids);
        names = Object.fromEntries((dir ?? []).map((d) => [d.id, d.full_name]));
      }
      const nameOf = (id: string | null) => (id ? names[id] ?? null : null);

      const rows: PoRequest[] = raw.slice(0, PO_REQUEST_LIST_LIMIT).map(({ projects, po_request_lines, ...r }) => ({
        ...r,
        project_name: projects?.name ?? null,
        lines: (po_request_lines ?? [])
          .map(({ products, ...l }) => ({ ...l, product: products ?? null }))
          .sort((a, b) => a.line_no - b.line_no),
        requester_name: nameOf(r.requested_by),
        completer_name: nameOf(r.completed_by),
        canceller_name: nameOf(r.cancelled_by),
      }));
      return { rows, truncated: raw.length > PO_REQUEST_LIST_LIMIT };
    },
  });
}

export function useMyManagedProjectIds() {
  const { userId } = useSession();
  return useQuery({
    queryKey: ["my-managed-projects", userId],
    enabled: !!userId,
    queryFn: async () =>
      (await supabase.from("project_managers").select("project_id").eq("user_id", userId!)).data?.map((r) => r.project_id) ?? [],
  });
}

/** Active projects the viewer may request a PO for: all of them for admins, managed ones for managers. */
export function useRequestableProjects(enabled: boolean) {
  const { userId } = useSession();
  const roles = useRoles().data ?? [];
  const admin = isAdmin(roles);
  const managed = useMyManagedProjectIds();
  return useQuery({
    queryKey: ["requestable-projects", userId, admin, managed.data],
    enabled: enabled && !!userId && managed.isSuccess,
    queryFn: async () => {
      const { data, error } = await supabase.from("projects").select("id, mkj_number, name").eq("status", "active").order("mkj_number");
      if (error) throw error;
      const rows = data ?? [];
      return admin ? rows : rows.filter((p) => (managed.data ?? []).includes(p.id));
    },
  });
}

/**
 * Mirrors the RPC rules (the database enforces them regardless):
 * edit — admins, or managers of the project; complete — warehouse/admin;
 * cancel — either side. Only while pending.
 */
export function requestPermissions(r: Pick<PoRequest, "status" | "project_id">, roles: AppRole[], managedProjectIds: string[]) {
  const pending = r.status === "pending";
  const canEdit = pending && (isAdmin(roles) || managedProjectIds.includes(r.project_id));
  const canComplete = pending && isWarehouseOrAdmin(roles);
  return { canEdit, canComplete, canCancel: canEdit || canComplete };
}
