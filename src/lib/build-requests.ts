import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useRoles, useSession } from "@/hooks/use-session";
import { isWarehouseOrAdmin, type AppRole } from "@/lib/roles";
import { useMyManagedProjectIds } from "@/lib/po-requests";

export type BuildStatus = Database["public"]["Enums"]["build_status"];
export type LineOrigin = "template" | "added" | "changed";

export const BUILD_STATUS_LABELS: Record<BuildStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  in_progress: "In progress",
  partially_built: "Partially built",
  completed: "Completed",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

/** Requests whose lines hold stock (see held_stock_qty in the database). */
export const OPEN_BUILD_STATUSES: BuildStatus[] = ["submitted", "in_progress", "partially_built"];

export type BuildLineSerial = { serial: string; entered_manually: boolean; returned_at: string | null };

export type BuildLine = {
  id: string;
  line_no: number;
  product_id: string;
  qty_per_unit: number;
  qty_required: number;
  is_key_part: boolean;
  origin: LineOrigin;
  qty_held: number;
  qty_consumed: number;
  notes: string | null;
  product: { part_number: string; description: string; unit: string; is_serialized: boolean } | null;
  serials: BuildLineSerial[];
};

export type BuildEvent = {
  id: string;
  kind: string;
  note: string | null;
  payload: Record<string, unknown> | null;
  actor: string | null;
  actor_name: string | null;
  created_at: string;
};

export type BuildRequest = {
  id: string;
  request_number: string;
  project_id: string;
  project_number: string;
  project_name: string | null;
  template_id: string;
  template: { system_code: string; name: string } | null;
  qty: number;
  status: BuildStatus;
  notes: string | null;
  requested_by: string | null;
  requester_name: string | null;
  submitted_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  rejected_by: string | null;
  rejecter_name: string | null;
  rejected_at: string | null;
  reject_note: string | null;
  cancelled_by: string | null;
  canceller_name: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  created_at: string;
  updated_at: string;
  lines: BuildLine[];
  units: { unit_id: string; seq: number }[];
};

type RawLine = Omit<BuildLine, "product" | "serials"> & {
  products: BuildLine["product"];
  build_line_serials: BuildLineSerial[] | null;
};
type RawRequest = Omit<BuildRequest, "project_name" | "template" | "requester_name" | "rejecter_name" | "canceller_name" | "lines" | "units"> & {
  projects: { name: string } | null;
  system_templates: { system_code: string; name: string } | null;
  build_request_lines: RawLine[] | null;
  build_units: { unit_id: string; seq: number }[] | null;
};

const REQUEST_SELECT =
  "id, request_number, project_id, project_number, template_id, qty, status, notes, requested_by, submitted_at, started_at, completed_at, rejected_by, rejected_at, reject_note, cancelled_by, cancelled_at, cancel_reason, created_at, updated_at, projects:project_id(name), system_templates:template_id(system_code, name), build_units(unit_id, seq), build_request_lines(id, line_no, product_id, qty_per_unit, qty_required, is_key_part, origin, qty_held, qty_consumed, notes, products:product_id(part_number, description, unit, is_serialized), build_line_serials(serial, entered_manually, returned_at))";

/** requested_by etc. reference auth.users, so names come from the name-only user directory. */
async function namesFor(ids: (string | null | undefined)[]): Promise<Record<string, string | null>> {
  const unique = Array.from(new Set(ids.filter((v): v is string => !!v)));
  if (unique.length === 0) return {};
  const { data } = await supabase.from("user_directory").select("id, full_name").in("id", unique);
  return Object.fromEntries((data ?? []).map((d) => [d.id, d.full_name]));
}

function toRequest(raw: RawRequest, names: Record<string, string | null>): BuildRequest {
  const { projects, system_templates, build_request_lines, build_units, ...r } = raw;
  const nameOf = (id: string | null) => (id ? names[id] ?? null : null);
  return {
    ...r,
    project_name: projects?.name ?? null,
    template: system_templates ?? null,
    requester_name: nameOf(r.requested_by),
    rejecter_name: nameOf(r.rejected_by),
    canceller_name: nameOf(r.cancelled_by),
    units: [...(build_units ?? [])].sort((a, b) => a.seq - b.seq),
    lines: (build_request_lines ?? [])
      .map(({ products, build_line_serials, ...l }) => ({
        ...l,
        qty_per_unit: Number(l.qty_per_unit),
        qty_required: Number(l.qty_required),
        qty_held: Number(l.qty_held),
        qty_consumed: Number(l.qty_consumed),
        product: products ?? null,
        serials: [...(build_line_serials ?? [])].sort((a, b) => a.serial.localeCompare(b.serial)),
      }))
      .sort((a, b) => a.line_no - b.line_no),
  };
}

export const BUILD_REQUEST_LIST_LIMIT = 200;

/** Build requests the viewer can see (RLS: same projects as the rest of the app), newest first. */
export function useBuildRequests() {
  return useQuery({
    queryKey: ["build-requests"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("build_requests")
        .select(REQUEST_SELECT)
        .order("created_at", { ascending: false })
        .limit(BUILD_REQUEST_LIST_LIMIT + 1);
      if (error) throw error;
      const raw = (data ?? []) as unknown as RawRequest[];
      const names = await namesFor(raw.flatMap((r) => [r.requested_by, r.rejected_by, r.cancelled_by]));
      return {
        rows: raw.slice(0, BUILD_REQUEST_LIST_LIMIT).map((r) => toRequest(r, names)),
        truncated: raw.length > BUILD_REQUEST_LIST_LIMIT,
      };
    },
  });
}

/** One request with its parts, serials, units and history. */
export function useBuildRequest(id: string) {
  return useQuery({
    queryKey: ["build-request", id],
    queryFn: async (): Promise<{ request: BuildRequest; events: BuildEvent[] } | null> => {
      const [req, ev] = await Promise.all([
        supabase.from("build_requests").select(REQUEST_SELECT).eq("id", id).maybeSingle(),
        supabase
          .from("build_request_events")
          .select("id, kind, note, payload, actor, created_at")
          .eq("request_id", id)
          .order("created_at", { ascending: true }),
      ]);
      if (req.error) throw req.error;
      if (ev.error) throw ev.error;
      if (!req.data) return null;
      const raw = req.data as unknown as RawRequest;
      const events = (ev.data ?? []) as unknown as Omit<BuildEvent, "actor_name">[];
      const names = await namesFor([raw.requested_by, raw.rejected_by, raw.cancelled_by, ...events.map((e) => e.actor)]);
      return {
        request: toRequest(raw, names),
        events: events.map((e) => ({ ...e, actor_name: e.actor ? names[e.actor] ?? null : null })),
      };
    },
  });
}

/** Stock a project can still use (on hand minus what builds already hold), by product. */
export function useProjectAvailable(projectId: string | null | undefined) {
  return useQuery({
    queryKey: ["inventory", "available", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase.from("v_project_inventory").select("product_id, available").eq("project_id", projectId!);
      if (error) throw error;
      return new Map((data ?? []).map((r) => [r.product_id as string, Number(r.available)]));
    },
  });
}

/** Active projects the viewer may request builds for: all for warehouse managers/admins, managed ones for managers. */
export function useBuildableProjects(enabled = true) {
  const { userId } = useSession();
  const roles = useRoles().data ?? [];
  const all = isWarehouseOrAdmin(roles);
  const managed = useMyManagedProjectIds();
  return useQuery({
    queryKey: ["buildable-projects", userId, all, managed.data],
    enabled: enabled && !!userId && managed.isSuccess,
    queryFn: async () => {
      const { data, error } = await supabase.from("projects").select("id, mkj_number, name").eq("status", "active").order("mkj_number");
      if (error) throw error;
      const rows = data ?? [];
      return all ? rows : rows.filter((p) => (managed.data ?? []).includes(p.id));
    },
  });
}

/**
 * Mirrors the RPC rules (the database enforces them regardless). The
 * requester side is the project's managers, warehouse managers and admins;
 * running the build is the warehouse's (warehouse managers and admins).
 */
export function buildPermissions(r: Pick<BuildRequest, "status" | "project_id" | "lines">, roles: AppRole[], managedProjectIds: string[]) {
  const warehouse = isWarehouseOrAdmin(roles);
  const requesterSide = warehouse || managedProjectIds.includes(r.project_id);
  const editable = r.status === "draft" || r.status === "rejected";
  const building = r.status === "in_progress" || r.status === "partially_built";
  // Held after the start but not used yet: parts that arrived and wait to be installed.
  const hasArrived = r.lines.some((l) => l.qty_held > l.qty_consumed);
  const needsParts = r.lines.some((l) => l.qty_consumed < l.qty_required);
  return {
    canEdit: (requesterSide && editable) || (warehouse && r.status === "submitted"),
    canSubmit: requesterSide && editable,
    canPullBack: requesterSide && r.status === "submitted",
    canReject: warehouse && r.status === "submitted",
    canStart: warehouse && r.status === "submitted",
    canInstall: warehouse && building && hasArrived,
    canMarkPartial: warehouse && r.status === "in_progress" && needsParts,
    canComplete: warehouse && building,
    readyToComplete: !needsParts,
    canCancel: requesterSide && r.status === "in_progress",
    hasArrived,
    needsParts,
  };
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

export type CoverageInput = { product_id: string; part_number: string; is_key_part: boolean; required: number };
export type CoverageRow = CoverageInput & { available: number; canHold: number; covered: boolean };
export type Coverage = {
  rows: CoverageRow[];
  total: number;
  covered: number;
  pct: number;
  keyShort: string[];
  passes: boolean;
  reason: string | null;
};

/**
 * The submit rule, as the database applies it: at least 80% of the parts
 * (lines, not units) fully held, and every key part fully held.
 */
export function computeCoverage(lines: CoverageInput[], availableById: Map<string, number>): Coverage {
  const rows = lines.map((l) => {
    const available = Math.max(0, availableById.get(l.product_id) ?? 0);
    const canHold = Math.min(l.required, available);
    return { ...l, available, canHold, covered: canHold >= l.required };
  });
  const total = rows.length;
  const covered = rows.filter((r) => r.covered).length;
  const pct = total > 0 ? Math.floor((covered * 100) / total) : 0;
  const keyShort = rows.filter((r) => r.is_key_part && !r.covered).map((r) => r.part_number);
  let reason: string | null = null;
  if (total === 0) reason = "Add at least one part.";
  else if (keyShort.length > 0) reason = `Key parts must be fully in stock — short on ${keyShort.join(", ")}.`;
  else if (covered * 5 < total * 4) reason = `Only ${covered} of ${total} parts (${pct}%) can be fully held — at least 80% are needed.`;
  return { rows, total, covered, pct, keyShort, passes: reason === null, reason };
}

export function lineOrigin(template: { qty: number } | null, qtyPerUnit: number): LineOrigin {
  if (!template) return "added";
  return template.qty === qtyPerUnit ? "template" : "changed";
}
