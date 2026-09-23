import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Fragment, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { POStatusBadge } from "@/components/po-status-badge";
import { PORequestStatusBadge } from "@/components/po-request-status-badge";
import { lineLabel, usePoRequests } from "@/lib/po-requests";
import { toast } from "sonner";
import { openPurchaseOrderPdf } from "@/lib/po-pdf";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ProjectEditDialog } from "@/components/project-edit-dialog";
import { BorrowHistory } from "@/components/borrow-history";
import { useInventorySerials, useSerialSupport } from "@/lib/serials";

import { managerLabel, useManagers } from "@/components/project-manager-select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/projects/$mkj")({
  head: ({ params }) => ({ meta: [{ title: `${params.mkj} — MKJ Ops` }] }),
  component: ProjectDetail,
});

function ProjectDetail() {
  const { mkj } = Route.useParams();
  const { data: managers = [] } = useManagers();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const serialsOn = useSerialSupport().data === true;
  const serialsByRow = useInventorySerials(serialsOn);

  const pdfMut = useMutation({
    mutationFn: (poId: string) => openPurchaseOrderPdf(poId),
    onError: (e: Error) => toast.error(e.message),
  });

  const project = useQuery({
    queryKey: ["project", mkj],
    queryFn: async () => {
      const { data, error } = await supabase.from("projects").select("*").eq("mkj_number", mkj).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const inventory = useQuery({
    queryKey: ["inventory", project.data?.id],
    enabled: !!project.data,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_project_inventory")
        .select("product_id, on_hand, held, products:product_id(part_number, description, unit, reorder_point)")
        .eq("project_id", project.data!.id);
      if (error) throw error;
      return data as unknown as Array<{
        product_id: string;
        on_hand: number;
        held: number;
        products: { part_number: string; description: string; unit: string; reorder_point: number } | null;
      }>;
    },
  });

  const pos = useQuery({
    queryKey: ["po-list", project.data?.id],
    enabled: !!project.data,
    queryFn: async () => {
      const { data } = await supabase.from("purchase_orders").select("id, po_number, status, delivery_date, created_at").eq("project_id", project.data!.id).order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const poRequests = usePoRequests({ projectId: project.data?.id, enabled: !!project.data });

  const tickets = useQuery({
    queryKey: ["st-list", project.data?.id],
    enabled: !!project.data,
    queryFn: async () => {
      const { data } = await supabase.from("shipping_tickets").select("id, ticket_number, status, ship_date, deliver_to_name").eq("project_id", project.data!.id).order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const slips = useQuery({
    queryKey: ["packing-slips", project.data?.id],
    enabled: !!project.data,
    queryFn: async () => {
      const { data } = await supabase
        .from("packing_slips")
        .select("id, slip_number, status, received_date, vendor_slip_number, purchase_orders:po_id(po_number)")
        .eq("project_id", project.data!.id)
        .order("received_date", { ascending: false });
      return data ?? [];
    },
  });

  if (project.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!project.data) return <p className="text-sm text-muted-foreground">Project not found.</p>;
  const p = project.data;

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title={`${p.mkj_number} — ${p.name}`}
        description={p.contract_number ? `Contract ${p.contract_number}` : undefined}
        backTo="/projects"
        actions={
          <div className="flex items-center gap-2">
            <Badge variant={p.status === "active" ? "default" : "secondary"}>{p.status}</Badge>
            <ProjectEditDialog project={p} variant="button" />
          </div>
        }
      />

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="inventory">Inventory</TabsTrigger>
          <TabsTrigger value="pos">Purchase Orders</TabsTrigger>
          <TabsTrigger value="packing-slips">Packing Slips</TabsTrigger>
          <TabsTrigger value="tickets">Shipping Tickets</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="pt-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>Summary</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div><span className="text-muted-foreground">Job #: </span><span className="font-mono">{p.mkj_number}</span></div>
                <div><span className="text-muted-foreground">Contract: </span>{p.contract_number ?? "—"}</div>
                <div><span className="text-muted-foreground">Project manager: </span>{managerLabel(managers.find((m) => m.id === p.project_manager_id))}</div>
                <div><span className="text-muted-foreground">Status: </span>{p.status}</div>
                <div><span className="text-muted-foreground">Created: </span>{new Date(p.created_at).toLocaleDateString()}</div>
              </CardContent>
            </Card>
            {p.description ? (
              <Card>
                <CardHeader><CardTitle>Description</CardTitle></CardHeader>
                <CardContent className="text-sm whitespace-pre-wrap">{p.description}</CardContent>
              </Card>
            ) : null}
          </div>
        </TabsContent>

        <TabsContent value="inventory" className="space-y-4 pt-4">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Part #</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">On Hand</TableHead>
                    <TableHead className="text-right" title="Reserved for manufacturing build requests">Held</TableHead>
                    <TableHead className="text-right">Reorder Point</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {inventory.data && inventory.data.length > 0 ? (
                    inventory.data.map((r) => {
                      const key = `${p.id}:${r.product_id}`;
                      const serials = serialsByRow.data?.get(key) ?? [];
                      const isOpen = expanded.has(key);
                      return (
                        <Fragment key={r.product_id}>
                          <TableRow>
                            <TableCell className="font-mono">
                              {serialsOn && serials.length > 0 ? (
                                <button
                                  type="button"
                                  aria-label={isOpen ? "Hide serial numbers" : "Show serial numbers"}
                                  className="mr-1 align-middle text-muted-foreground"
                                  onClick={() => setExpanded((s) => {
                                    const next = new Set(s);
                                    if (next.has(key)) next.delete(key); else next.add(key);
                                    return next;
                                  })}
                                >
                                  {isOpen ? <ChevronDown className="inline h-3.5 w-3.5" /> : <ChevronRight className="inline h-3.5 w-3.5" />}
                                </button>
                              ) : null}
                              {r.products?.part_number}
                              {serialsOn && serials.length > 0 ? (
                                <Badge variant="secondary" className="ml-2">{serials.length} serials</Badge>
                              ) : null}
                            </TableCell>
                            <TableCell>{r.products?.description}</TableCell>
                            <TableCell className="text-right font-semibold">
                              {Number(r.on_hand)}
                              {r.products && Number(r.on_hand) <= (r.products.reorder_point ?? 0) ? (
                                <Badge variant="destructive" className="ml-2">Low</Badge>
                              ) : null}
                            </TableCell>
                            <TableCell className="text-right text-muted-foreground">{Number(r.held) > 0 ? Number(r.held) : "—"}</TableCell>
                            <TableCell className="text-right text-muted-foreground">{r.products?.reorder_point ?? 0}</TableCell>
                          </TableRow>
                          {serialsOn && isOpen ? (
                            <TableRow>
                              <TableCell colSpan={5} className="bg-muted/30">
                                <div className="flex flex-wrap gap-1">
                                  {serials.map((s) => (
                                    <span key={s} className="rounded-full bg-background px-2 py-0.5 font-mono text-[10px]">{s}</span>
                                  ))}
                                </div>
                              </TableCell>
                            </TableRow>
                          ) : null}
                        </Fragment>
                      );
                    })
                  ) : (
                    <TableRow><TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">No inventory yet.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          <BorrowHistory projectId={p.id} />
        </TabsContent>


        <TabsContent value="pos" className="space-y-4 pt-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">PO requests</CardTitle></CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Request #</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Items</TableHead>
                    <TableHead>Requested by</TableHead>
                    <TableHead>Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {poRequests.data && poRequests.data.rows.length > 0 ? poRequests.data.rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell><Link className="font-mono text-primary hover:underline" to="/purchase-orders" search={{ request: r.id }}>{r.request_number}</Link></TableCell>
                      <TableCell><PORequestStatusBadge status={r.status} poReference={r.po_reference} /></TableCell>
                      <TableCell><div className="max-w-xs truncate text-sm" title={r.lines.map(lineLabel).join(", ")}>{r.lines.map(lineLabel).join(", ")}</div></TableCell>
                      <TableCell>{r.requester_name ?? "—"}</TableCell>
                      <TableCell>{new Date(r.created_at).toLocaleDateString()}</TableCell>
                    </TableRow>
                  )) : <TableRow><TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">No PO requests yet.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Purchase orders</CardTitle></CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>PO #</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Delivery</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="text-right">PDF</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pos.data && pos.data.length > 0 ? pos.data.map((po) => (
                    <TableRow key={po.id}>
                      <TableCell><Link className="font-mono text-primary hover:underline" to="/purchase-orders/$id" params={{ id: po.id }}>{po.po_number}</Link></TableCell>
                      <TableCell><POStatusBadge status={po.status} /></TableCell>
                      <TableCell>{po.delivery_date ?? "—"}</TableCell>
                      <TableCell>{new Date(po.created_at).toLocaleDateString()}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => pdfMut.mutate(po.id)}
                          disabled={pdfMut.isPending && pdfMut.variables === po.id}
                        >
                          {pdfMut.isPending && pdfMut.variables === po.id ? "Opening…" : "View PO"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  )) : <TableRow><TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">No POs yet.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="packing-slips" className="pt-4">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Slip #</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>PO #</TableHead>
                    <TableHead>Vendor Slip #</TableHead>
                    <TableHead>Received</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {slips.data && slips.data.length > 0 ? slips.data.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell><Link className="font-mono text-primary hover:underline" to="/packing-slips/$id" params={{ id: s.id }}>{s.slip_number}</Link></TableCell>
                      <TableCell><Badge variant="secondary">{s.status}</Badge></TableCell>
                      <TableCell>{(s.purchase_orders as { po_number?: string } | null)?.po_number ?? "—"}</TableCell>
                      <TableCell>{s.vendor_slip_number ?? "—"}</TableCell>
                      <TableCell>{s.received_date}</TableCell>
                    </TableRow>
                  )) : <TableRow><TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">No packing slips yet.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tickets" className="pt-4">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ticket #</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Deliver to</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tickets.data && tickets.data.length > 0 ? tickets.data.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell><Link className="font-mono text-primary hover:underline" to="/shipping-tickets/$id" params={{ id: t.id }}>{t.ticket_number}</Link></TableCell>
                      <TableCell><Badge variant="secondary">{t.status}</Badge></TableCell>
                      <TableCell>{t.deliver_to_name ?? "—"}</TableCell>
                      <TableCell>{t.ship_date}</TableCell>
                    </TableRow>
                  )) : <TableRow><TableCell colSpan={4} className="py-6 text-center text-sm text-muted-foreground">No tickets yet.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
