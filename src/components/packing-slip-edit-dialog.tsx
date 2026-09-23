import { Fragment, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Pencil } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useRoles } from "@/hooks/use-session";
import { isWarehouseOrAdmin } from "@/lib/roles";
import { assertSlipEditKeepsHeldStock, refreshPoStatus, resolveProductId, slipStatusFor, syncSlipInventory } from "@/lib/receiving";
import { SerialNumberInputs } from "@/components/serial-number-inputs";
import {
  countFilled, fetchSlipItemSerials, resizeSerials, saveSlipItemSerials, useSerialSupport, useSerializedProducts,
} from "@/lib/serials";

type SlipItem = {
  id: string;
  product_id: string | null;
  part_number: string | null;
  description: string;
  qty_ordered: number;
  qty_received: number;
  condition: string;
};

export function PackingSlipEditDialog({
  slip,
  items,
}: {
  slip: {
    id: string; slip_number: string; project_id: string; po_id: string | null;
    received_date: string; carrier: string | null; vendor_slip_number: string | null;
    notes: string | null; status: string;
  };
  items: SlipItem[];
}) {
  const roles = useRoles();
  const allowed = isWarehouseOrAdmin(roles.data ?? []);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [receivedDate, setReceivedDate] = useState(slip.received_date);
  const [carrier, setCarrier] = useState(slip.carrier ?? "");
  const [vendorSlip, setVendorSlip] = useState(slip.vendor_slip_number ?? "");
  const [notes, setNotes] = useState(slip.notes ?? "");
  const [status, setStatus] = useState(slip.status);
  const [lines, setLines] = useState<SlipItem[]>(items);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [serials, setSerials] = useState<Record<string, string[]>>({});

  const serialsOn = useSerialSupport().data === true;
  const serializedProducts = useSerializedProducts(serialsOn);
  const isSerialized = (productId: string | null) =>
    serialsOn && !!productId && (serializedProducts.data?.has(productId) ?? false);

  const existingSerials = useQuery({
    queryKey: ["ps-item-serials", slip.id],
    enabled: open && serialsOn,
    queryFn: () => fetchSlipItemSerials(items.map((i) => i.id)),
  });

  useEffect(() => {
    if (!open) return;
    const map: Record<string, string[]> = {};
    for (const i of items) {
      map[i.id] = resizeSerials(existingSerials.data?.get(i.id) ?? [], Number(i.qty_received));
    }
    setSerials(map);
  }, [open, items, existingSerials.data]);

  useEffect(() => {
    if (!open) return;
    setReceivedDate(slip.received_date);
    setCarrier(slip.carrier ?? "");
    setVendorSlip(slip.vendor_slip_number ?? "");
    setNotes(slip.notes ?? "");
    setStatus(slip.status);
    setLines(items.map((i) => ({ ...i, qty_ordered: Number(i.qty_ordered), qty_received: Number(i.qty_received) })));
  }, [open, slip, items]);

  const save = useMutation({
    mutationFn: async () => {
      const { data: user } = await supabase.auth.getUser();

      const resolved: SlipItem[] = [];
      for (const l of lines) {
        const product_id = await resolveProductId({
          productId: l.product_id,
          partNumber: l.part_number,
          description: l.description,
        });
        resolved.push({ ...l, product_id });
      }

      // Refuse up front if a lowered quantity would eat into stock held for
      // manufacturing; the lines below are saved before stock is synced.
      await assertSlipEditKeepsHeldStock({ projectId: slip.project_id, before: items, after: resolved });

      for (const l of resolved) {
        if (serialsOn && isSerialized(l.product_id)) {
          await saveSlipItemSerials(l.id, serials[l.id] ?? []);
        }
        const { error } = await supabase
          .from("packing_slip_items")
          .update({ qty_received: l.qty_received, condition: l.condition, product_id: l.product_id })
          .eq("id", l.id);
        if (error) throw error;
      }

      const { error: hErr } = await supabase
        .from("packing_slips")
        .update({
          received_date: receivedDate,
          carrier: carrier || null,
          vendor_slip_number: vendorSlip || null,
          notes: notes || null,
          status,
        })
        .eq("id", slip.id);
      if (hErr) throw hErr;

      await syncSlipInventory({
        slipId: slip.id,
        slipNumber: slip.slip_number,
        projectId: slip.project_id,
        lines: resolved,
        userId: user.user?.id ?? null,
      });

      if (slip.po_id) await refreshPoStatus(slip.po_id);
    },
    onSuccess: () => {
      toast.success("Packing slip updated");
      qc.invalidateQueries();
      setOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!allowed) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm"><Pencil className="mr-1.5 h-4 w-4" />Edit</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-4xl overflow-y-auto">
        <DialogHeader><DialogTitle>Edit {slip.slip_number}</DialogTitle></DialogHeader>
        <div className="grid gap-3 md:grid-cols-2">
          <div><Label>Received date</Label><Input type="date" value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)} /></div>
          <div>
            <Label>Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="received">Received</SelectItem>
                <SelectItem value="partially_received">Partially Received</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div><Label>Carrier</Label><Input value={carrier} onChange={(e) => setCarrier(e.target.value)} /></div>
          <div><Label>Vendor's slip #</Label><Input value={vendorSlip} onChange={(e) => setVendorSlip(e.target.value)} /></div>
          <div className="md:col-span-2"><Label>Notes</Label><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        </div>

        <Table>
          <TableHeader><TableRow>
            <TableHead>Description</TableHead>
            <TableHead className="text-right">Ordered</TableHead>
            <TableHead className="text-right">Received</TableHead>
            <TableHead className="text-right">Backorder</TableHead>
            <TableHead>Condition</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {lines.map((l, i) => {
              const bo = Math.max(0, l.qty_ordered - l.qty_received);
              const serialLine = isSerialized(l.product_id);
              const isOpen = expanded.has(l.id);
              return (
                <Fragment key={l.id}>
                <TableRow>
                  <TableCell>
                    {serialLine ? (
                      <button
                        type="button"
                        aria-label={isOpen ? "Hide serial numbers" : "Edit serial numbers"}
                        className="mr-1 align-middle text-muted-foreground"
                        onClick={() => setExpanded((s) => {
                          const next = new Set(s);
                          if (next.has(l.id)) next.delete(l.id); else next.add(l.id);
                          return next;
                        })}
                      >
                        {isOpen ? <ChevronDown className="inline h-3.5 w-3.5" /> : <ChevronRight className="inline h-3.5 w-3.5" />}
                      </button>
                    ) : null}
                    {l.description}
                    {serialLine ? (
                      <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                        {countFilled(serials[l.id] ?? [])}/{l.qty_received} serials
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right">{l.qty_ordered}</TableCell>
                  <TableCell>
                    <Input
                      type="number" min={0} step={1} inputMode="numeric" className="w-24 text-right"
                      value={l.qty_received}
                      onChange={(e) => {
                        const v = Math.max(0, Math.trunc(Number(e.target.value) || 0));
                        setLines((ls) => ls.map((x, idx) => (idx === i ? { ...x, qty_received: v } : x)));
                        setSerials((m) => ({ ...m, [l.id]: resizeSerials(m[l.id] ?? [], v) }));
                        setStatus(slipStatusFor(lines.map((x, idx) => (idx === i ? { ...x, qty_received: v } : x))));
                      }}
                    />
                  </TableCell>
                  <TableCell className="text-right">{bo > 0 ? bo : "—"}</TableCell>
                  <TableCell>
                    <Select value={l.condition} onValueChange={(v) => setLines((ls) => ls.map((x, idx) => (idx === i ? { ...x, condition: v } : x)))}>
                      <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ok">OK</SelectItem>
                        <SelectItem value="damaged">Damaged</SelectItem>
                        <SelectItem value="rejected">Rejected</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                </TableRow>
                {serialLine && isOpen ? (
                  <TableRow>
                    <TableCell colSpan={5} className="bg-muted/30">
                      <SerialNumberInputs
                        idPrefix={`ps-edit-${l.id}`}
                        values={serials[l.id] ?? []}
                        onChange={(next) => setSerials((m) => ({ ...m, [l.id]: next }))}
                      />
                    </TableCell>
                  </TableRow>
                ) : null}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Save changes"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
