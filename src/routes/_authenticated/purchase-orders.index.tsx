import { useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { POStatusBadge } from "@/components/po-status-badge";
import { POEditDialog } from "@/components/po-edit-dialog";
import { PODeleteButton } from "@/components/po-delete-button";
import { PORequestStatusBadge, RowTypeChip } from "@/components/po-request-status-badge";
import { PORequestFormDialog } from "@/components/po-request-form-dialog";
import { PORequestViewDialog, type RequestAction } from "@/components/po-request-view-dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { FileText, Plus, Search, Send } from "lucide-react";
import { openPurchaseOrderPdf } from "@/lib/po-pdf";
import { useRoles, useSession } from "@/hooks/use-session";
import { isAdmin, isWarehouseOrAdmin } from "@/lib/roles";
import {
  PO_REQUEST_LIST_LIMIT,
  lineLabel,
  linesSummary,
  requestPermissions,
  useMyManagedProjectIds,
  usePoRequests,
  type PoRequest,
} from "@/lib/po-requests";

const LIST_TABS = ["all", "pos", "requests", "pending"] as const;
type ListTab = (typeof LIST_TABS)[number];

export const Route = createFileRoute("/_authenticated/purchase-orders/")({
  head: () => ({ meta: [{ title: "Purchase Orders — MKJ Ops" }] }),
  // ?request=<id> opens that request (notification links land here);
  // ?tab=pending is where the dashboard's Pending PO Requests card points.
  validateSearch: (s: Record<string, unknown>): { request?: string; tab?: ListTab } => ({
    request: typeof s.request === "string" ? s.request : undefined,
    tab: LIST_TABS.includes(s.tab as ListTab) ? (s.tab as ListTab) : undefined,
  }),
  component: POList,
});

const PO_LIST_LIMIT = 200;

function POList() {
  const navigate = useNavigate({ from: Route.fullPath });
  const { request: focusedId, tab: tabParam } = Route.useSearch();
  const tab: ListTab = tabParam ?? "all";
  const { userId } = useSession();
  const roles = useRoles().data ?? [];
  const warehouse = isWarehouseOrAdmin(roles);
  const canRequest = isAdmin(roles) || roles.includes("manager");
  const managed = useMyManagedProjectIds().data ?? [];

  const pos = useQuery({
    queryKey: ["pos"],
    queryFn: async () => {
      // Fetch one past the cap so a full page can be told apart from a
      // truncated one, instead of silently dropping anything past the limit.
      const { data } = await supabase
        .from("purchase_orders")
        .select("id, po_number, status, delivery_date, created_at, projects:project_id(mkj_number, name), suppliers:supplier_id(name)")
        .order("created_at", { ascending: false })
        .limit(PO_LIST_LIMIT + 1);
      const rows = data ?? [];
      return { rows: rows.slice(0, PO_LIST_LIMIT), truncated: rows.length > PO_LIST_LIMIT };
    },
  });
  const requests = usePoRequests();

  // Sorted so the query key is stable regardless of the order pos.data
  // happens to come back in — an unsorted array of the same IDs in a
  // different order hashes to a different key, triggering a pointless refetch.
  const poIds = useMemo(() => (pos.data?.rows ?? []).map((p) => p.id).sort(), [pos.data]);
  const receipts = useQuery({
    enabled: poIds.length > 0,
    queryKey: ["po-last-receipt", poIds],
    queryFn: async () => {
      const { data } = await supabase
        .from("packing_slips")
        .select("po_id, received_date")
        .in("po_id", poIds);
      const map: Record<string, string> = {};
      (data ?? []).forEach((s) => {
        if (!s.po_id || !s.received_date) return;
        if (!map[s.po_id] || s.received_date > map[s.po_id]) map[s.po_id] = s.received_date;
      });
      return map;
    },
  });

  const pdfMut = useMutation({
    mutationFn: (poId: string) => openPurchaseOrderPdf(poId),
    onError: (e: Error) => toast.error(e.message),
  });

  const [q, setQ] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<PoRequest | null>(null);
  const [initialAction, setInitialAction] = useState<RequestAction>(null);

  const poRows = pos.data?.rows ?? [];
  const reqRows = requests.data?.rows ?? [];
  const pendingCount = reqRows.filter((r) => r.status === "pending").length;

  const rows = useMemo(() => {
    const poItems = poRows.map((po) => ({ kind: "po" as const, id: po.id, created_at: po.created_at, po }));
    const reqItems = reqRows.map((req) => ({ kind: "request" as const, id: req.id, created_at: req.created_at, req }));
    const picked =
      tab === "pos" ? poItems
      : tab === "requests" ? reqItems
      : tab === "pending" ? reqItems.filter((r) => r.req.status === "pending")
      : [...poItems, ...reqItems];
    const merged = [...picked].sort((a, b) => b.created_at.localeCompare(a.created_at));
    const needle = q.trim().toLowerCase();
    if (!needle) return merged;
    return merged.filter((row) => {
      const fields =
        row.kind === "po"
          ? [row.po.po_number, row.po.projects?.mkj_number, row.po.projects?.name, row.po.suppliers?.name, row.po.status]
          : [row.req.request_number, row.req.project_number, row.req.project_name, row.req.requester_name, row.req.status, row.req.notes, row.req.po_reference, ...row.req.lines.map(lineLabel)];
      return fields.some((v) => (v ?? "").toLowerCase().includes(needle));
    });
  }, [poRows, reqRows, tab, q]);

  const focused = focusedId ? reqRows.find((r) => r.id === focusedId) ?? null : null;

  function setTab(next: ListTab) {
    navigate({ search: (prev) => ({ ...prev, tab: next === "all" ? undefined : next }) });
  }
  function openRequest(id: string, action: RequestAction = null) {
    setInitialAction(action);
    navigate({ search: (prev) => ({ ...prev, request: id }) });
  }
  function closeRequest() {
    navigate({ search: (prev) => ({ ...prev, request: undefined }) });
  }
  function startEdit(r: PoRequest) {
    closeRequest();
    setEditing(r);
    setFormOpen(true);
  }

  const emptyMessage =
    tab === "pending" ? "No pending PO requests."
    : tab === "requests" ? "No PO requests yet."
    : tab === "pos" ? "No purchase orders yet."
    : "No purchase orders or PO requests yet.";

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Purchase Orders"
        description={warehouse ? "All POs and PO requests across projects you can see." : "POs and PO requests for your projects."}
        actions={
          <>
            {canRequest ? (
              <Button variant={warehouse ? "outline" : "default"} onClick={() => { setEditing(null); setFormOpen(true); }}>
                <Send className="mr-1 h-4 w-4" />Request a PO
              </Button>
            ) : null}
            {warehouse ? (
              <Link to="/purchase-orders/new"><Button><Plus className="mr-1 h-4 w-4" />New PO</Button></Link>
            ) : null}
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Tabs value={tab} onValueChange={(v) => setTab(v as ListTab)}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="pos">POs<span className="ml-1.5 text-xs text-muted-foreground">{poRows.length}</span></TabsTrigger>
            <TabsTrigger value="requests">Requests<span className="ml-1.5 text-xs text-muted-foreground">{reqRows.length}</span></TabsTrigger>
            <TabsTrigger value="pending">
              Pending requests
              <span className={pendingCount > 0 ? "ml-1.5 text-xs font-semibold text-status-partial-foreground" : "ml-1.5 text-xs text-muted-foreground"}>{pendingCount}</span>
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative min-w-[16rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search number, project, supplier, requester or item…"
            className="pl-9"
          />
        </div>
      </div>

      {pos.data?.truncated || requests.data?.truncated ? (
        <p className="mb-3 text-xs text-muted-foreground">
          Showing the most recent {PO_LIST_LIMIT} purchase orders and {PO_REQUEST_LIST_LIMIT} requests — search above to narrow results.
        </p>
      ) : null}

      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Type</TableHead><TableHead>Number</TableHead><TableHead>Project</TableHead><TableHead>Supplier / requested by</TableHead><TableHead>Status</TableHead><TableHead>Expected</TableHead><TableHead>Received</TableHead><TableHead className="text-right">Actions</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {rows.length > 0 ? rows.map((row) => {
              if (row.kind === "po") {
                const po = row.po;
                return (
                  <TableRow key={`po-${po.id}`}>
                    <TableCell><RowTypeChip kind="po" /></TableCell>
                    <TableCell><Link className="font-mono text-primary hover:underline" to="/purchase-orders/$id" params={{ id: po.id }}>{po.po_number}</Link></TableCell>
                    <TableCell><span className="font-mono text-xs">{po.projects?.mkj_number}</span></TableCell>
                    <TableCell>{po.suppliers?.name ?? "—"}</TableCell>
                    <TableCell><POStatusBadge status={po.status} /></TableCell>
                    <TableCell>{po.delivery_date ?? "—"}</TableCell>
                    <TableCell>{receipts.data?.[po.id] ?? "—"}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => pdfMut.mutate(po.id)}
                          disabled={pdfMut.isPending && pdfMut.variables === po.id}
                        >
                          <FileText className="mr-1 h-4 w-4" />
                          {pdfMut.isPending && pdfMut.variables === po.id ? "Opening…" : "View PO"}
                        </Button>
                        <POEditDialog poId={po.id} status={po.status} />
                        <PODeleteButton poId={po.id} poNumber={po.po_number} status={po.status} />
                      </div>
                    </TableCell>
                  </TableRow>
                );
              }
              const r = row.req;
              const perms = requestPermissions(r, roles, managed);
              return (
                <TableRow key={`req-${r.id}`} className="bg-primary/5 hover:bg-primary/10">
                  <TableCell><RowTypeChip kind="request" /></TableCell>
                  <TableCell>
                    <button type="button" className="font-mono text-primary hover:underline" onClick={() => openRequest(r.id)}>{r.request_number}</button>
                  </TableCell>
                  <TableCell><span className="font-mono text-xs">{r.project_number}</span></TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    requested by <span className="font-medium text-foreground">{r.requested_by === userId ? "you" : r.requester_name ?? "unknown user"}</span> · {linesSummary(r.lines)}
                  </TableCell>
                  <TableCell><PORequestStatusBadge status={r.status} poReference={r.po_reference} /></TableCell>
                  <TableCell className="text-muted-foreground">—</TableCell>
                  <TableCell className="text-muted-foreground">—</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button size="sm" variant="outline" onClick={() => openRequest(r.id)}>View</Button>
                      {perms.canEdit ? <Button size="sm" variant="outline" onClick={() => startEdit(r)}>Edit</Button> : null}
                      {perms.canComplete ? <Button size="sm" onClick={() => openRequest(r.id, "complete")}>Mark completed</Button> : null}
                      {perms.canCancel ? <Button size="sm" variant="ghost" onClick={() => openRequest(r.id, "cancel")}>Cancel</Button> : null}
                    </div>
                  </TableCell>
                </TableRow>
              );
            }) : <TableRow><TableCell colSpan={8} className="py-6 text-center text-sm text-muted-foreground">{emptyMessage}</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent></Card>

      <PORequestFormDialog open={formOpen} onOpenChange={setFormOpen} request={editing} />
      <PORequestViewDialog
        request={focused}
        open={!!focused}
        onOpenChange={(o) => { if (!o) closeRequest(); }}
        initialAction={initialAction}
        onEdit={startEdit}
      />
    </div>
  );
}
