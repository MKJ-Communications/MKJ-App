import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { SerialPickerDialog } from "@/components/serial-picker-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { round2, type BuildRequest } from "@/lib/build-requests";
import { formatQty } from "@/lib/system-templates";

/**
 * Start a build, or install parts that arrived after it started. Either way
 * every held-but-unused part is taken out of stock, and each serial-tracked
 * unit needs its serial: picked from what the project has on hand, or typed
 * in for stock received before serial tracking (the database marks those).
 */
export function BuildConsumeDialog({
  request,
  mode,
  open,
  onOpenChange,
}: {
  request: BuildRequest;
  mode: "start" | "install";
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const [serials, setSerials] = useState<Record<string, string[]>>({});
  const [typed, setTyped] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setSerials({});
    setTyped({});
  }, [open]);

  const toUse = request.lines
    .filter((l) => l.qty_held > l.qty_consumed)
    .map((l) => ({ line: l, qty: round2(l.qty_held - l.qty_consumed) }));
  const stillPending = request.lines.filter((l) => l.qty_held < l.qty_required);
  const missingSerials = toUse.filter(({ line, qty }) => line.product?.is_serialized && (serials[line.product_id]?.length ?? 0) !== qty);

  function addTyped(productId: string, qty: number) {
    const value = (typed[productId] ?? "").trim();
    if (!value) return;
    const list = serials[productId] ?? [];
    if (list.some((s) => s.toLowerCase() === value.toLowerCase())) {
      toast.error(`${value} is already listed`);
      return;
    }
    if (list.length >= qty) {
      toast.error(`Only ${qty} serial number(s) are needed for this part`);
      return;
    }
    setSerials((m) => ({ ...m, [productId]: [...list, value] }));
    setTyped((m) => ({ ...m, [productId]: "" }));
  }

  const run = useMutation({
    mutationFn: async () => {
      const payload = Object.entries(serials).flatMap(([product_id, list]) => list.map((serial) => ({ product_id, serial }))) as unknown as Json;
      const { error } =
        mode === "start"
          ? await supabase.rpc("start_build_request", { _request_id: request.id, _serials: payload })
          : await supabase.rpc("install_build_parts", { _request_id: request.id, _serials: payload });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(mode === "start" ? `${request.request_number} started — its parts were taken out of stock` : "Parts installed");
      qc.invalidateQueries({ queryKey: ["build-request", request.id] });
      qc.invalidateQueries({ queryKey: ["build-requests"] });
      qc.invalidateQueries({ queryKey: ["inventory"] });
      qc.invalidateQueries({ queryKey: ["inventory-serials"] });
      qc.invalidateQueries({ queryKey: ["serials-available"] });
      qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{mode === "start" ? `Start building ${request.request_number}` : "Install arrived parts"}</DialogTitle>
          <DialogDescription>
            These parts are taken out of the project's stock now. Record a serial number for every serial-tracked unit —
            pick it from what's on hand, or type it if the unit was received before serials were tracked.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Part</TableHead>
                <TableHead className="text-right">Use now</TableHead>
                <TableHead>Serial numbers</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {toUse.map(({ line, qty }) => {
                const serialized = !!line.product?.is_serialized;
                const list = serials[line.product_id] ?? [];
                return (
                  <TableRow key={line.id}>
                    <TableCell>
                      <span className="font-mono text-xs">{line.product?.part_number}</span>
                      <div className="text-xs text-muted-foreground">{line.product?.description}</div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">
                      {formatQty(qty)} <span className="text-xs text-muted-foreground">{line.product?.unit}</span>
                    </TableCell>
                    <TableCell>
                      {serialized ? (
                        <div className="space-y-2">
                          <SerialPickerDialog
                            projectId={request.project_id}
                            productId={line.product_id}
                            qty={qty}
                            selected={list}
                            onChange={(next) => setSerials((m) => ({ ...m, [line.product_id]: next }))}
                            hint={`Pick up to ${formatQty(qty)} serial number(s) on hand at ${request.project_number}.`}
                          />
                          {list.length < qty ? (
                            <div className="flex gap-1">
                              <Input
                                className="h-8"
                                placeholder="Or type a serial"
                                aria-label={`Type a serial for ${line.product?.part_number}`}
                                value={typed[line.product_id] ?? ""}
                                onChange={(e) => setTyped((m) => ({ ...m, [line.product_id]: e.target.value }))}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    addTyped(line.product_id, qty);
                                  }
                                }}
                              />
                              <Button type="button" size="sm" variant="outline" className="h-8" onClick={() => addTyped(line.product_id, qty)}>
                                <Plus className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">Not serial-tracked</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {toUse.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="py-6 text-center text-sm text-muted-foreground">No held parts are waiting to be used.</TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </div>

        <p className="text-sm text-muted-foreground">
          {stillPending.length > 0
            ? `Still pending after this: ${stillPending.map((l) => `${formatQty(l.qty_required - l.qty_held)} × ${l.product?.part_number}`).join(", ")}. They're held automatically when they arrive.`
            : "Nothing else is pending — complete the build once it's assembled."}
        </p>

        <DialogFooter>
          {missingSerials.length > 0 ? (
            <span className="mr-auto self-center text-xs text-status-partial-foreground">
              Serials still needed for {missingSerials.map((m) => m.line.product?.part_number).join(", ")}
            </span>
          ) : null}
          <Button variant="outline" onClick={() => onOpenChange(false)}>Back</Button>
          <Button onClick={() => run.mutate()} disabled={run.isPending || toUse.length === 0 || missingSerials.length > 0}>
            {run.isPending ? "Saving…" : mode === "start" ? "Start build" : "Install parts"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
