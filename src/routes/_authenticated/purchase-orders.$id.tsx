import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { POStatusBadge, PO_STATUS_OPTIONS } from "@/components/po-status-badge";
import { POEditDialog } from "@/components/po-edit-dialog";
import { PODeleteButton } from "@/components/po-delete-button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileText } from "lucide-react";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";
import { openPurchaseOrderPdf } from "@/lib/po-pdf";
import { assigneeLabel, useAssignableUsers } from "@/components/assignee-select";
import { useRoles } from "@/hooks/use-session";
import { isWarehouseOrAdmin } from "@/lib/roles";

type POStatus = Database["public"]["Enums"]["po_status"];

export const Route = createFileRoute("/_authenticated/purchase-orders/$id")({
  head: ({ params }) => ({ meta: [{ title: `PO ${params.id.slice(0, 8)} — MKJ Ops` }] }),
  component: POView,
});

function POView() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const po = useQuery({
    queryKey: ["po", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("purchase_orders").select("*, projects:project_id(mkj_number, name), suppliers:supplier_id(name, address)").eq("id", id).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const items = useQuery({
    queryKey: ["po-items", id],
    queryFn: async () => (await supabase.from("purchase_order_items").select("*").eq("po_id", id).order("line_no")).data ?? [],
  });
  const slips = useQuery({
    queryKey: ["po-slips", id],
    queryFn: async () => (await supabase.from("packing_slips").select("id, slip_number, received_date").eq("po_id", id).order("received_date", { ascending: false })).data ?? [],
  });
  const { data: assignableUsers = [] } = useAssignableUsers();
  // POs belong to warehouse managers and admins; project managers only view
  // them (and receive shipments), so the status control is theirs alone.
  const canManagePO = isWarehouseOrAdmin(useRoles().data ?? []);

  const statusMut = useMutation({
    mutationFn: async (status: POStatus) => {
      const { error } = await supabase.from("purchase_orders").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Status updated");
      qc.invalidateQueries({ queryKey: ["po", id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const pdfMut = useMutation({
    mutationFn: () => openPurchaseOrderPdf(id),
    onError: (e: Error) => toast.error(e.message),
  });

  if (po.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!po.data) return <p className="text-sm text-muted-foreground">Not found.</p>;

  const total = (items.data ?? []).reduce((s, l) => s + Number(l.qty) * Number(l.unit_cost), 0) + Number(po.data.additional_freight ?? 0);
  const assigneeUserId = po.data.assignee;
  // partially_received/received are set automatically by refreshPoStatus()
  // once a packing slip records a receipt — not manually selectable here.
  const currentStatus = po.data.status;
  const hasReceipts = currentStatus === "partially_received" || currentStatus === "received";
  const statusOptions = hasReceipts
    ? PO_STATUS_OPTIONS.filter((o) => o.value === currentStatus)
    : PO_STATUS_OPTIONS.filter((o) => o.value !== "partially_received" && o.value !== "received");

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title={`Purchase Order ${po.data.po_number}`}
        backTo="/purchase-orders"
        description={
          <>Project <Link className="font-mono text-primary hover:underline" to="/projects/$mkj" params={{ mkj: po.data.projects?.mkj_number ?? "" }}>{po.data.projects?.mkj_number}</Link> — {po.data.projects?.name}</> as unknown as string
        }
        actions={
          <div className="flex items-center gap-2">
            <POStatusBadge status={po.data.status} />
            {canManagePO ? (
              <div>
                <Select value={po.data.status} onValueChange={(v) => statusMut.mutate(v as POStatus)} disabled={hasReceipts}>
                  <SelectTrigger className="h-8 w-44"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {statusOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                {hasReceipts ? (
                  <p className="mt-1 text-xs text-muted-foreground">Set automatically from packing slips — edit or delete the slip to correct.</p>
                ) : null}
              </div>
            ) : null}
            <Button size="sm" variant="outline" onClick={() => pdfMut.mutate()} disabled={pdfMut.isPending}>
              <FileText className="mr-1 h-4 w-4" />{pdfMut.isPending ? "Opening…" : "View PO"}
            </Button>
            <POEditDialog poId={id} status={po.data.status} variant="button" />
            <PODeleteButton
              poId={id}
              poNumber={po.data.po_number}
              status={po.data.status}
              variant="button"
              onDeleted={() => navigate({ to: "/purchase-orders" })}
            />
            <Link to="/packing-slips/new" search={{ po: id }}><Button size="sm">Receive shipment</Button></Link>
          </div>
        }
      />

      <div className="grid gap-4 md:grid-cols-2">
        <Card><CardContent className="p-4 text-sm">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Supplier</div>
          <div className="font-medium">{po.data.suppliers?.name ?? "—"}</div>
          <div className="whitespace-pre-wrap text-muted-foreground">{po.data.suppliers?.address ?? ""}</div>
          <div className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Assignee</div>
          <div>{assigneeLabel(assignableUsers.find((u) => u.id === assigneeUserId))}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4 text-sm">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Delivery</div>
          <div>Ship via: {po.data.ship_via ?? "—"}</div>
          <div>Expected delivery: {po.data.delivery_date ?? "—"}</div>
          <div>Last received: {slips.data?.[0]?.received_date ?? "—"}</div>
          <div>Payment terms: {po.data.payment_terms ?? "—"}</div>
        </CardContent></Card>

      </div>

      <Card className="mt-4"><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow>
            <TableHead className="w-8">#</TableHead><TableHead>Budget code</TableHead><TableHead>Description</TableHead>
            <TableHead className="text-right">Qty</TableHead><TableHead>Unit</TableHead>
            <TableHead className="text-right">Unit cost</TableHead><TableHead className="text-right">Amount</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {(items.data ?? []).map((l) => (
              <TableRow key={l.id}>
                <TableCell>{l.line_no}</TableCell>
                <TableCell className="font-mono text-xs">{l.budget_code ?? ""}</TableCell>
                <TableCell>{l.description}</TableCell>
                <TableCell className="text-right">{Number(l.qty)}</TableCell>
                <TableCell>{l.unit}</TableCell>
                <TableCell className="text-right font-mono">${Number(l.unit_cost).toFixed(2)}</TableCell>
                <TableCell className="text-right font-mono">${(Number(l.qty) * Number(l.unit_cost)).toFixed(2)}</TableCell>
              </TableRow>
            ))}
            <TableRow>
              <TableCell colSpan={6} className="text-right font-semibold">Grand total</TableCell>
              <TableCell className="text-right font-mono font-semibold">${total.toFixed(2)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent></Card>

      <Card className="mt-4"><CardContent className="p-4">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Packing slips (receipts)</div>
        {slips.data && slips.data.length > 0 ? (
          <ul className="divide-y">
            {slips.data.map((s) => (
              <li key={s.id} className="py-2 text-sm">
                <Link to="/packing-slips/$id" params={{ id: s.id }} className="font-mono text-primary hover:underline">{s.slip_number}</Link>
                <span className="ml-2 text-muted-foreground">{s.received_date}</span>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-muted-foreground">No shipments received yet.</p>}
      </CardContent></Card>
    </div>
  );
}
