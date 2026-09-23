import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { ArrowLeft, FileText, Plus, Trash } from "lucide-react";
import { previewDraftPurchaseOrderPdf } from "@/lib/po-pdf";
import { AssigneeSelect } from "@/components/assignee-select";
import { useRoles } from "@/hooks/use-session";
import { isWarehouseOrAdmin } from "@/lib/roles";

export const Route = createFileRoute("/_authenticated/purchase-orders/new")({
  head: () => ({ meta: [{ title: "New Purchase Order — MKJ Ops" }] }),
  component: NewPO,
});

type Line = { line_no: number; budget_code: string; description: string; qty: number; unit: string; unit_cost: number };

function NewPO() {
  const navigate = useNavigate();
  const roles = useRoles();
  const projects = useQuery({ queryKey: ["projects", "active"], queryFn: async () => (await supabase.from("projects").select("id, mkj_number, name, description").eq("status", "active").order("mkj_number")).data ?? [] });
  const suppliers = useQuery({ queryKey: ["suppliers"], queryFn: async () => (await supabase.from("suppliers").select("id, name, address, phone").order("name")).data ?? [] });

  const [projectId, setProjectId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [otherSupplier, setOtherSupplier] = useState("");
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [billTo, setBillTo] = useState("MKJ Communications\n850 3rd Ave., #407\nBrooklyn, NY 11232");
  const [shipTo, setShipTo] = useState("MKJ Communications\n850 3rd Ave., #407\nBrooklyn, NY 11232");
  const [deliveryDate, setDeliveryDate] = useState("");
  const [shipVia, setShipVia] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("");
  const [description, setDescription] = useState("");
  const [additionalFreight, setAdditionalFreight] = useState(0);
  const [termsConditions, setTermsConditions] = useState("");
  const [lines, setLines] = useState<Line[]>([{ line_no: 1, budget_code: "", description: "", qty: 1, unit: "ea", unit_cost: 0 }]);

  const total = lines.reduce((sum, l) => sum + Number(l.qty || 0) * Number(l.unit_cost || 0), 0) + Number(additionalFreight || 0);

  const create = useMutation({
    mutationFn: async () => {
      const project = projects.data?.find((p) => p.id === projectId);
      if (!project) throw new Error("Choose a project");
      if (supplierId === "__other__" && !otherSupplier.trim()) throw new Error("Enter the supplier name");
      // create_purchase_order mints the per-project MKJ<project>EX<seq> number,
      // creates the "Other…" supplier if any, and inserts the PO row all in
      // one atomic call — a failure partway through leaves nothing behind
      // (see migration for details).
      const { data: poRow, error: insErr } = await supabase.rpc("create_purchase_order", {
        _project_id: projectId,
        _supplier_id: supplierId === "__other__" ? null : supplierId || null,
        _bill_to: billTo || null,
        _ship_to: shipTo || null,
        _delivery_date: deliveryDate || null,
        _ship_via: shipVia || null,
        _payment_terms: paymentTerms || null,
        _description: description || null,
        _assignee: assigneeId || null,
        _additional_freight: additionalFreight || 0,
        _terms_conditions: termsConditions || null,
        _new_supplier_name: supplierId === "__other__" ? otherSupplier.trim() : null,
      } as never);
      if (insErr) throw insErr;
      const items = lines.filter((l) => l.description.trim()).map((l) => ({
        po_id: poRow!.id, line_no: l.line_no, budget_code: l.budget_code || null,
        description: l.description, qty: l.qty, unit: l.unit || "ea", unit_cost: l.unit_cost,
      }));
      if (items.length > 0) {
        const { error: iErr } = await supabase.from("purchase_order_items").insert(items);
        if (iErr) throw iErr;
      }
      return poRow!.id as string;
    },
    onSuccess: () => {
      toast.success("PO created");
      navigate({ to: "/purchase-orders" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const preview = useMutation({
    mutationFn: async () => {
      const project = projects.data?.find((p) => p.id === projectId);
      const supplier = suppliers.data?.find((s) => s.id === supplierId);
      const supplierName = supplierId === "__other__" ? otherSupplier.trim() || null : supplier?.name ?? null;
      await previewDraftPurchaseOrderPdf({
        projectLine1: project ? `${project.mkj_number} — ${project.name}` : null,
        projectLine2: project?.description ?? null,
        supplierName,
        supplierAddress: supplierId === "__other__" ? null : supplier?.address ?? null,
        supplierPhone: supplierId === "__other__" ? null : supplier?.phone ?? null,
        billTo,
        shipTo,
        deliveryDate: deliveryDate || null,
        shipVia,
        paymentTerms,
        description,
        additionalFreight,
        termsConditions,
        items: lines.filter((l) => l.description.trim()),
      });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function updateLine(i: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }
  function addLine() {
    setLines((ls) => [...ls, { line_no: ls.length + 1, budget_code: "", description: "", qty: 1, unit: "ea", unit_cost: 0 }]);
  }
  function removeLine(i: number) {
    setLines((ls) => ls.filter((_, idx) => idx !== i).map((l, idx) => ({ ...l, line_no: idx + 1 })));
  }

  // Only warehouse managers and admins create POs (create_purchase_order
  // enforces it); anyone else reaching this URL gets pointed to Request a PO.
  if (roles.isSuccess && !isWarehouseOrAdmin(roles.data)) {
    return (
      <div className="mx-auto max-w-2xl">
        <PageHeader title="New Purchase Order" backTo="/purchase-orders" />
        <Card><CardContent className="space-y-3 p-6 text-sm">
          <p>Purchase orders are created by warehouse managers and admins.</p>
          <p className="text-muted-foreground">
            To get something ordered for your project, use <strong className="text-foreground">Request a PO</strong> on the Purchase Orders page. The warehouse is notified and writes the PO.
          </p>
          <Link to="/purchase-orders"><Button>Go to Purchase Orders</Button></Link>
        </CardContent></Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="New Purchase Order" description="Fill in the details, preview the PDF to double-check everything, then create the PO." />
      <Button variant="outline" className="mb-4" onClick={() => navigate({ to: "/purchase-orders" })}>
        <ArrowLeft className="mr-2 h-4 w-4" /> Back to Purchase Orders
      </Button>
      <Card><CardContent className="space-y-4 p-4">
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <Label>Project</Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger><SelectValue placeholder="Choose project" /></SelectTrigger>
              <SelectContent>{projects.data?.map((p) => <SelectItem key={p.id} value={p.id}>{p.mkj_number} — {p.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Supplier</Label>
            <Select value={supplierId} onValueChange={setSupplierId}>
              <SelectTrigger><SelectValue placeholder="Choose supplier" /></SelectTrigger>
              <SelectContent>
                {suppliers.data?.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                <SelectItem value="__other__">Other…</SelectItem>
              </SelectContent>
            </Select>
            {supplierId === "__other__" && (
              <Input className="mt-2" placeholder="Supplier name" value={otherSupplier} onChange={(e) => setOtherSupplier(e.target.value)} />
            )}
          </div>
          <div>
            <Label htmlFor="po-assignee">Assignee</Label>
            <AssigneeSelect id="po-assignee" value={assigneeId} onChange={setAssigneeId} />
          </div>
          <div><Label>Bill to</Label><Textarea rows={3} value={billTo} onChange={(e) => setBillTo(e.target.value)} /></div>
          <div><Label>Ship to</Label><Textarea rows={3} value={shipTo} onChange={(e) => setShipTo(e.target.value)} /></div>
          <div><Label>Delivery date</Label><Input type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} /></div>
          <div><Label>Ship via</Label><Input value={shipVia} onChange={(e) => setShipVia(e.target.value)} /></div>
          <div><Label>Payment terms</Label><Input value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} /></div>
          <div><Label>Additional freight</Label><Input type="number" step="0.01" min={0} value={additionalFreight} onChange={(e) => setAdditionalFreight(Math.max(0, Number(e.target.value) || 0))} /></div>
          <div><Label>Description / notes</Label><Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></div>
          <div><Label>Terms & conditions</Label><Textarea rows={2} value={termsConditions} onChange={(e) => setTermsConditions(e.target.value)} /></div>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Line items</h3>
            <Button size="sm" variant="outline" onClick={addLine}><Plus className="mr-1 h-4 w-4" />Add line</Button>
          </div>
          <Table>
            <TableHeader><TableRow>
              <TableHead className="w-8">#</TableHead><TableHead>Budget code</TableHead><TableHead>Description</TableHead>
              <TableHead className="w-20 text-right">Qty</TableHead><TableHead className="w-16">Unit</TableHead>
              <TableHead className="w-24 text-right">Unit cost</TableHead><TableHead className="w-24 text-right">Amount</TableHead><TableHead className="w-10" />
            </TableRow></TableHeader>
            <TableBody>
              {lines.map((l, i) => (
                <TableRow key={i}>
                  <TableCell>{l.line_no}</TableCell>
                  <TableCell><Input value={l.budget_code} onChange={(e) => updateLine(i, { budget_code: e.target.value })} /></TableCell>
                  <TableCell><Input value={l.description} onChange={(e) => updateLine(i, { description: e.target.value })} /></TableCell>
                  <TableCell><Input type="number" step={1} min={0} inputMode="numeric" className="text-right" value={l.qty} onChange={(e) => updateLine(i, { qty: Math.max(0, Math.trunc(Number(e.target.value) || 0)) })} /></TableCell>
                  <TableCell><Input value={l.unit} onChange={(e) => updateLine(i, { unit: e.target.value })} /></TableCell>
                  <TableCell><Input type="number" step="0.01" className="text-right" value={l.unit_cost} onChange={(e) => updateLine(i, { unit_cost: Number(e.target.value) })} /></TableCell>
                  <TableCell className="text-right font-mono">${(Number(l.qty || 0) * Number(l.unit_cost || 0)).toFixed(2)}</TableCell>
                  <TableCell><Button variant="ghost" size="icon" onClick={() => removeLine(i)}><Trash className="h-4 w-4" /></Button></TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell colSpan={6} className="text-right font-semibold">Grand total</TableCell>
                <TableCell className="text-right font-mono font-semibold">${total.toFixed(2)}</TableCell>
                <TableCell />
              </TableRow>
            </TableBody>
          </Table>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => navigate({ to: "/purchase-orders" })}>Cancel</Button>
          <Button variant="outline" onClick={() => preview.mutate()} disabled={preview.isPending}>
            <FileText className="mr-1 h-4 w-4" />{preview.isPending ? "Rendering…" : "Preview PDF"}
          </Button>
          <Button disabled={!projectId || create.isPending} onClick={() => create.mutate()}>{create.isPending ? "Creating…" : "Create PO"}</Button>
        </div>
      </CardContent></Card>
    </div>
  );
}
