import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertTriangle, FileSpreadsheet } from "lucide-react";
import { useRoles } from "@/hooks/use-session";
import { isWarehouseOrAdmin } from "@/lib/roles";
import {
  DEFAULT_SOV_COST_CODE,
  DEFAULT_SOV_COST_TYPE,
  buildSovRows,
  downloadSovCsv,
  money,
  sovFileName,
  sovTotals,
  type SovSourceLine,
} from "@/lib/procore-sov";

/**
 * "Procore CSV": previews a PO's lines as a Procore Schedule of Values and
 * downloads it. Warehouse managers and admins only — they're the ones who
 * enter POs in Procore.
 */
export function POSovDialog({ poId, variant = "icon" }: { poId: string; variant?: "icon" | "button" }) {
  const roles = useRoles().data ?? [];
  const [open, setOpen] = useState(false);

  if (!isWarehouseOrAdmin(roles)) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {variant === "icon" ? (
          <Button size="icon" variant="ghost" aria-label="Download Procore SOV CSV" title="Procore SOV CSV"><FileSpreadsheet className="h-4 w-4" /></Button>
        ) : (
          <Button size="sm" variant="outline"><FileSpreadsheet className="mr-1 h-4 w-4" />Procore CSV</Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
        {open ? <POSovForm poId={poId} onDone={() => setOpen(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function POSovForm({ poId, onDone }: { poId: string; onDone: () => void }) {
  const po = useQuery({
    queryKey: ["po-sov", poId],
    queryFn: async () => {
      const { data, error } = await supabase.from("purchase_orders").select("po_number, additional_freight").eq("id", poId).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const items = useQuery({
    queryKey: ["po-sov-items", poId],
    queryFn: async (): Promise<SovSourceLine[]> => {
      const { data, error } = await supabase
        .from("purchase_order_items")
        .select("id, line_no, description, qty, unit, unit_cost, products:product_id(part_number)")
        .eq("po_id", poId)
        .order("line_no");
      if (error) throw error;
      return (data ?? []).map((l) => ({
        id: l.id, line_no: l.line_no, description: l.description, qty: Number(l.qty), unit: l.unit,
        unit_cost: Number(l.unit_cost), part_number: l.products?.part_number ?? null,
      }));
    },
  });

  const [costCode, setCostCode] = useState(DEFAULT_SOV_COST_CODE);
  const [costType, setCostType] = useState(DEFAULT_SOV_COST_TYPE);
  // Per-line overrides; a line without one follows the whole-order values above.
  const [overrides, setOverrides] = useState<Record<string, { costCode?: string; costType?: string }>>({});

  const lines = useMemo(() => items.data ?? [], [items.data]);
  const rows = useMemo(() => buildSovRows(lines, costCode, costType, overrides), [lines, costCode, costType, overrides]);
  const totals = sovTotals(lines, rows);
  const freight = Number(po.data?.additional_freight ?? 0);
  const warningCount = rows.filter((r) => r.warnings.length > 0).length;

  function setOverride(id: string, patch: { costCode?: string; costType?: string }) {
    setOverrides((o) => ({ ...o, [id]: { ...o[id], ...patch } }));
  }

  if (po.isLoading || items.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (po.error || items.error || !po.data) return <p className="text-sm text-destructive">Could not load this purchase order.</p>;

  return (
    <>
      <DialogHeader>
        <DialogTitle>Procore SOV — {po.data.po_number}</DialogTitle>
        <DialogDescription>
          Schedule of Values to import into Procore. Downloads as <span className="font-mono">{sovFileName(po.data.po_number)}</span>.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="sov-cost-code">Cost code (all lines)</Label>
          <Input id="sov-cost-code" value={costCode} onChange={(e) => setCostCode(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="sov-cost-type">Cost type (all lines)</Label>
          <Input id="sov-cost-type" value={costType} onChange={(e) => setCostType(e.target.value)} />
        </div>
      </div>

      {lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">This PO has no line items, so there's nothing to export.</p>
      ) : (
        <Table>
          <TableHeader><TableRow>
            <TableHead className="w-8">#</TableHead><TableHead className="w-32">Cost code</TableHead><TableHead className="w-20">Type</TableHead>
            <TableHead>Description</TableHead><TableHead className="text-right">Qty</TableHead><TableHead>UOM</TableHead>
            <TableHead className="text-right">Unit price</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id} className="align-top">
                <TableCell>{r.line_no}</TableCell>
                <TableCell>
                  <Input className="h-8 font-mono text-xs" aria-label={`Cost code for line ${r.line_no}`} value={overrides[r.id]?.costCode ?? costCode} onChange={(e) => setOverride(r.id, { costCode: e.target.value })} />
                </TableCell>
                <TableCell>
                  <Input className="h-8 font-mono text-xs" aria-label={`Cost type for line ${r.line_no}`} value={overrides[r.id]?.costType ?? costType} onChange={(e) => setOverride(r.id, { costType: e.target.value })} />
                </TableCell>
                <TableCell>
                  <div className="text-xs">{r.description}</div>
                  {r.warnings.map((w) => (
                    <div key={w} className="mt-1 flex items-center gap-1 text-xs text-amber-600 dark:text-amber-500">
                      <AlertTriangle className="h-3 w-3 shrink-0" />{w}
                    </div>
                  ))}
                </TableCell>
                <TableCell className="text-right">{r.qty}</TableCell>
                <TableCell>ea</TableCell>
                <TableCell className="text-right font-mono">{r.unitPrice.toFixed(2)}</TableCell>
              </TableRow>
            ))}
            <TableRow>
              <TableCell colSpan={6} className="text-right font-semibold">SOV total</TableCell>
              <TableCell className="text-right font-mono font-semibold">{money(totals.sovTotal)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      )}

      <div className="space-y-1 text-sm">
        {totals.mismatch ? (
          <p className="flex items-center gap-1 font-medium text-destructive">
            <AlertTriangle className="h-4 w-4" />
            SOV total {money(totals.sovTotal)} doesn't match the PO's line total {money(totals.poSubtotal)} — some unit costs have more than two decimals.
          </p>
        ) : null}
        {warningCount > 0 ? (
          <p className="text-muted-foreground">{warningCount} line{warningCount === 1 ? "" : "s"} flagged above. The file still downloads; check them in Procore.</p>
        ) : null}
        {freight > 0 ? (
          <p className="text-muted-foreground">Additional freight ({money(freight)}) isn't an SOV line and is left out of the file.</p>
        ) : null}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onDone}>Close</Button>
        <Button disabled={rows.length === 0} onClick={() => downloadSovCsv(rows, po.data!.po_number)}>
          <FileSpreadsheet className="mr-1 h-4 w-4" />Download CSV
        </Button>
      </DialogFooter>
    </>
  );
}
