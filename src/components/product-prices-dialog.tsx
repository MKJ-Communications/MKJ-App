import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/use-session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Star } from "lucide-react";

type PriceRow = {
  id: string;
  product_id: string;
  supplier_id: string | null;
  source_label: string | null;
  supplier_sku: string | null;
  unit_cost: number;
  unit: string;
  is_preferred: boolean;
  notes: string | null;
  price_updated_at: string;
  suppliers: { name: string } | null;
};

type FormState = {
  vendorMode: "supplier" | "other";
  supplierId: string;
  sourceLabel: string;
  supplierSku: string;
  unitCost: string;
  unit: string;
  isPreferred: boolean;
  notes: string;
};

const emptyForm: FormState = {
  vendorMode: "supplier",
  supplierId: "",
  sourceLabel: "",
  supplierSku: "",
  unitCost: "",
  unit: "ea",
  isPreferred: false,
  notes: "",
};

function rowVendorLabel(r: PriceRow) {
  return r.suppliers?.name ?? r.source_label ?? "Unknown";
}

/**
 * Maps a Postgres error from the supplier_prices constraints back to a
 * message that means something to whoever is filling in the form. Without
 * this, a duplicate vendor price surfaces as a raw
 * "duplicate key value violates unique constraint ..." string.
 */
function friendlyPriceError(e: { code?: string; message: string }): string {
  if (e.code === "23505") {
    return "This vendor (or source) already has a price for this part — edit that row instead of adding a new one.";
  }
  if (e.code === "23514") {
    if (e.message.includes("supplier_prices_has_source")) return "Choose a vendor or enter a source (Amazon, eBay…).";
    if (e.message.includes("unit_cost")) return "Cost must be zero or more.";
  }
  return e.message;
}

export function ProductPricesDialog({
  open,
  onOpenChange,
  productId,
  partNumber,
  description,
  canEdit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productId: string;
  partNumber: string;
  description: string;
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const { userId } = useSession();
  const [formMode, setFormMode] = useState<"closed" | "add" | string>("closed");
  const [form, setForm] = useState<FormState>(emptyForm);
  const [deleteTarget, setDeleteTarget] = useState<PriceRow | null>(null);

  const prices = useQuery({
    queryKey: ["supplier-prices", productId],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("supplier_prices")
        .select("*, suppliers(name)")
        .eq("product_id", productId)
        .order("is_preferred", { ascending: false })
        .order("unit_cost", { ascending: true });
      if (error) throw error;
      return (data ?? []) as PriceRow[];
    },
  });

  const suppliers = useQuery({
    queryKey: ["suppliers"],
    enabled: open,
    queryFn: async () => (await supabase.from("suppliers").select("id, name").order("name")).data ?? [],
  });

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["supplier-prices", productId] });
    qc.invalidateQueries({ queryKey: ["products-with-cost"] });
  }

  function openAdd() {
    setForm(emptyForm);
    setFormMode("add");
  }

  function openEdit(r: PriceRow) {
    setForm({
      vendorMode: r.supplier_id ? "supplier" : "other",
      supplierId: r.supplier_id ?? "",
      sourceLabel: r.source_label ?? "",
      supplierSku: r.supplier_sku ?? "",
      unitCost: String(r.unit_cost),
      unit: r.unit,
      isPreferred: r.is_preferred,
      notes: r.notes ?? "",
    });
    setFormMode(r.id);
  }

  function closeForm() {
    setFormMode("closed");
    setForm(emptyForm);
  }

  function buildPayload() {
    return {
      product_id: productId,
      supplier_id: form.vendorMode === "supplier" ? form.supplierId || null : null,
      source_label: form.vendorMode === "other" ? form.sourceLabel.trim() || null : null,
      supplier_sku: form.supplierSku.trim() || null,
      unit_cost: Number(form.unitCost),
      unit: form.unit.trim() || "ea",
      is_preferred: form.isPreferred,
      notes: form.notes.trim() || null,
    };
  }

  const createMut = useMutation({
    mutationFn: async () => {
      // created_by only makes sense on the initial insert -- an edit doesn't
      // change who first recorded this vendor's price for the part.
      const { error } = await supabase.from("supplier_prices").insert({ ...buildPayload(), created_by: userId });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Price added");
      closeForm();
      invalidate();
    },
    onError: (e: { code?: string; message: string }) => toast.error(friendlyPriceError(e)),
  });

  const updateMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("supplier_prices").update(buildPayload()).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Price updated");
      closeForm();
      invalidate();
    },
    onError: (e: { code?: string; message: string }) => toast.error(friendlyPriceError(e)),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("supplier_prices").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Price removed");
      setDeleteTarget(null);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const isEditing = formMode !== "closed" && formMode !== "add";
  const formValid =
    (form.vendorMode === "supplier" ? !!form.supplierId : !!form.sourceLabel.trim()) &&
    form.unitCost.trim() !== "" &&
    Number(form.unitCost) >= 0;
  const saving = createMut.isPending || updateMut.isPending;

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) closeForm(); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Prices — {partNumber}</DialogTitle>
          </DialogHeader>
          <p className="-mt-2 text-sm text-muted-foreground">{description}</p>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Vendor / source</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead>Updated</TableHead>
                {canEdit ? <TableHead className="w-20" /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {prices.data && prices.data.length > 0 ? prices.data.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      {r.is_preferred ? <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" aria-label="Preferred" /> : null}
                      <span className="font-medium">{rowVendorLabel(r)}</span>
                      {!r.suppliers ? <Badge variant="secondary" className="text-[10px]">marketplace</Badge> : null}
                    </div>
                    {r.notes ? <div className="mt-0.5 text-xs text-muted-foreground">{r.notes}</div> : null}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{r.supplier_sku ?? "—"}</TableCell>
                  <TableCell className="text-right font-mono">${Number(r.unit_cost).toFixed(2)}/{r.unit}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{new Date(r.price_updated_at).toLocaleDateString()}</TableCell>
                  {canEdit ? (
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="icon" variant="ghost" aria-label={`Edit price from ${rowVendorLabel(r)}`} onClick={() => openEdit(r)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" aria-label={`Remove price from ${rowVendorLabel(r)}`} onClick={() => setDeleteTarget(r)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  ) : null}
                </TableRow>
              )) : (
                <TableRow>
                  <TableCell colSpan={canEdit ? 5 : 4} className="py-6 text-center text-sm text-muted-foreground">
                    No prices recorded for this part yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>

          {canEdit ? (
            formMode === "closed" ? (
              <Button variant="outline" onClick={openAdd}>
                <Plus className="mr-1 h-4 w-4" /> Add price
              </Button>
            ) : (
              <>
                <Separator />
                <div className="space-y-3">
                  <p className="text-sm font-medium">{isEditing ? "Edit price" : "Add price"}</p>

                  <div>
                    <Label>Vendor</Label>
                    <Select
                      value={form.vendorMode === "supplier" ? form.supplierId : "__other__"}
                      onValueChange={(v) =>
                        v === "__other__"
                          ? setForm((f) => ({ ...f, vendorMode: "other", supplierId: "" }))
                          : setForm((f) => ({ ...f, vendorMode: "supplier", supplierId: v }))
                      }
                    >
                      <SelectTrigger><SelectValue placeholder="Choose a vendor" /></SelectTrigger>
                      <SelectContent>
                        {suppliers.data?.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                        <SelectItem value="__other__">Marketplace (Amazon, eBay…)</SelectItem>
                      </SelectContent>
                    </Select>
                    {form.vendorMode === "other" && (
                      <Input
                        className="mt-2"
                        placeholder="e.g. Amazon"
                        value={form.sourceLabel}
                        onChange={(e) => setForm((f) => ({ ...f, sourceLabel: e.target.value }))}
                      />
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Cost</Label>
                      <Input
                        type="number" step="0.01" min={0} inputMode="decimal"
                        value={form.unitCost}
                        onChange={(e) => setForm((f) => ({ ...f, unitCost: e.target.value }))}
                      />
                    </div>
                    <div>
                      <Label>Unit</Label>
                      <Input value={form.unit} onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))} />
                    </div>
                  </div>

                  <div>
                    <Label>Vendor SKU / ASIN (optional)</Label>
                    <Input value={form.supplierSku} onChange={(e) => setForm((f) => ({ ...f, supplierSku: e.target.value }))} />
                  </div>

                  <div>
                    <Label>Notes (optional)</Label>
                    <Textarea rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
                  </div>

                  <label className="flex items-start gap-2 rounded-md border p-3">
                    <Checkbox
                      checked={form.isPreferred}
                      onCheckedChange={(v) => setForm((f) => ({ ...f, isPreferred: v === true }))}
                    />
                    <span className="text-sm">
                      Preferred vendor
                      <span className="block text-xs text-muted-foreground">
                        Shown as this part's cost on the Products page. Only one vendor can be preferred per part.
                      </span>
                    </span>
                  </label>

                  <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={closeForm}>Cancel</Button>
                    <Button
                      disabled={!formValid || saving}
                      onClick={() => (isEditing ? updateMut.mutate(formMode) : createMut.mutate())}
                    >
                      {saving ? "Saving…" : isEditing ? "Save" : "Add"}
                    </Button>
                  </div>
                </div>
              </>
            )
          ) : null}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this price?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes the {deleteTarget ? rowVendorLabel(deleteTarget) : ""} price for {partNumber}. The price
              history for it is kept for reference, but this row won't be selectable anymore.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteMut.isPending}
              onClick={() => deleteTarget && deleteMut.mutate(deleteTarget.id)}
            >
              {deleteMut.isPending ? "Removing…" : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
