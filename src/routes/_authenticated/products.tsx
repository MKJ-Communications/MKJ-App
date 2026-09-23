import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/page-header";
import { ProductPricesDialog } from "@/components/product-prices-dialog";
import { toast } from "sonner";
import { Plus, Search, Pencil, DollarSign } from "lucide-react";
import { useRoles, useSession } from "@/hooks/use-session";
import { isWarehouseOrAdmin, canWrite as canSeeCostRoles } from "@/lib/roles";
import { useSerialSupport } from "@/lib/serials";

type Product = {
  id: string; part_number: string; description: string; unit: string; reorder_point: number;
  is_serialized?: boolean | null;
};

// Row shape of v_products_with_cost: products plus the one cost to show,
// derived from supplier_prices rather than stored. See
// supabase/migrations/20260908235000_supplier_prices.sql.
type ProductWithCost = Product & {
  default_cost: number | null;
  default_cost_unit: string | null;
  cost_updated_at: string | null;
  default_source: string | null;
  price_count: number | null;
};

export const Route = createFileRoute("/_authenticated/products")({
  head: () => ({ meta: [{ title: "Products — MKJ Ops" }] }),
  component: ProductsPage,
});

function ProductsPage() {
  const { data: roles = [] } = useRoles();
  const canWrite = isWarehouseOrAdmin(roles);
  // Same predicate as supplier_prices' SELECT policy (can_write: admin,
  // warehouse_manager, manager). Engineers never see cost data -- and even
  // without this check the view would just come back with nulls for them,
  // since it's security_invoker and RLS hides the price rows either way.
  const canSeeCost = canSeeCostRoles(roles);
  const { userId } = useSession();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [pn, setPn] = useState("");
  const [desc, setDesc] = useState("");
  const [unit, setUnit] = useState("ea");
  const [rp, setRp] = useState<number>(0);
  const [serialized, setSerialized] = useState(false);
  // Serial tracking only shows once the backend schema is in place.
  const serialsOn = useSerialSupport().data === true;
  const [pricesFor, setPricesFor] = useState<ProductWithCost | null>(null);

  // Optional "set a price while creating the part" section on the New
  // Product dialog. Left blank, product creation behaves exactly as before --
  // this never becomes a required field. Filled in, it's a second insert into
  // supplier_prices right after the product exists (that table can't be
  // written to before the product it references does).
  // "" = no vendor chosen, "__other__" = marketplace (same sentinel pattern
  // as the supplier picker on purchase-orders.new.tsx).
  const [priceSupplierId, setPriceSupplierId] = useState("");
  const [priceSourceLabel, setPriceSourceLabel] = useState("");
  const [priceCost, setPriceCost] = useState("");
  const [priceSku, setPriceSku] = useState("");

  function resetPriceFields() {
    setPriceSupplierId("");
    setPriceSourceLabel("");
    setPriceCost("");
    setPriceSku("");
  }

  const products = useQuery({
    queryKey: ["products-with-cost"],
    queryFn: async () => {
      const { data, error } = await supabase.from("v_products_with_cost").select("*").order("part_number");
      if (error) throw error;
      return data as ProductWithCost[];
    },
  });

  const suppliers = useQuery({
    queryKey: ["suppliers"],
    enabled: open && canSeeCost,
    queryFn: async () => (await supabase.from("suppliers").select("id, name").order("name")).data ?? [],
  });

  const term = q.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!products.data) return [];
    if (!term) return products.data;
    return products.data.filter((p) => {
      const hay = [p.part_number, p.description].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(term);
    });
  }, [products.data, term]);

  const priceFieldsFilled =
    priceCost.trim() !== "" && (priceSupplierId === "__other__" ? !!priceSourceLabel.trim() : !!priceSupplierId);

  const createMut = useMutation({
    mutationFn: async (): Promise<{ priceWarning?: string }> => {
      const { data: newProduct, error } = await supabase
        .from("products")
        .insert({
          part_number: pn.trim(),
          description: desc.trim(),
          unit: unit.trim() || "ea",
          reorder_point: rp,
          ...(serialsOn ? { is_serialized: serialized } : {}),
        } as never)
        .select("id")
        .single();
      if (error) throw error;

      // The product exists now, whether or not the price below succeeds --
      // so a price failure is reported, not thrown. Throwing here would tell
      // onError to treat this as "nothing happened," when the part was in
      // fact created and is sitting in the list waiting for its price to be
      // added via the $ button instead.
      if (priceFieldsFilled) {
        const { error: priceError } = await supabase.from("supplier_prices").insert({
          product_id: (newProduct as { id: string }).id,
          supplier_id: priceSupplierId === "__other__" ? null : priceSupplierId,
          source_label: priceSupplierId === "__other__" ? priceSourceLabel.trim() : null,
          supplier_sku: priceSku.trim() || null,
          unit_cost: Number(priceCost),
          unit: unit.trim() || "ea",
          is_preferred: true,
          created_by: userId,
        });
        if (priceError) return { priceWarning: priceError.message };
      }
      return {};
    },
    onSuccess: ({ priceWarning }) => {
      toast.success("Product added");
      if (priceWarning) toast.warning(`Price wasn't saved (${priceWarning}) — add it from the $ button on this part.`);
      setOpen(false);
      setPn(""); setDesc(""); setUnit("ea"); setRp(0); setSerialized(false);
      resetPriceFields();
      qc.invalidateQueries({ queryKey: ["products-with-cost"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [editing, setEditing] = useState<Product | null>(null);
  const [ePn, setEPn] = useState("");
  const [eDesc, setEDesc] = useState("");
  const [eUnit, setEUnit] = useState("ea");
  const [eRp, setERp] = useState<number>(0);
  const [eSerialized, setESerialized] = useState(false);

  function openEdit(p: Product) {
    setEditing(p);
    setEPn(p.part_number);
    setEDesc(p.description);
    setEUnit(p.unit);
    setERp(p.reorder_point);
    setESerialized(!!p.is_serialized);
  }

  const editMut = useMutation({
    mutationFn: async () => {
      if (!editing) return;
      const { error } = await supabase
        .from("products")
        .update({
          part_number: ePn.trim(), description: eDesc.trim(), unit: eUnit.trim() || "ea", reorder_point: eRp,
          ...(serialsOn ? { is_serialized: eSerialized } : {}),
        } as never)
        .eq("id", editing.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Product updated");
      setEditing(null);
      qc.invalidateQueries({ queryKey: ["products-with-cost"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Products"
        description="Catalog of parts. Inventory quantities are tracked per project."
        actions={canWrite ? (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button><Plus className="mr-1 h-4 w-4" /> New Product</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>New product</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div><Label htmlFor="pn">Part number</Label><Input id="pn" value={pn} onChange={(e) => setPn(e.target.value)} placeholder="WV-S35302-F2L" /></div>
                <div><Label htmlFor="pdesc">Description</Label><Input id="pdesc" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="2MP OUTDOOR VANDAL DOME CAM" /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label htmlFor="unit">Unit</Label><Input id="unit" value={unit} onChange={(e) => setUnit(e.target.value)} /></div>
                  <div><Label htmlFor="rp">Reorder point</Label><Input id="rp" type="number" min={0} step={1} inputMode="numeric" value={rp} onChange={(e) => setRp(Math.max(0, Math.trunc(Number(e.target.value) || 0)))} /></div>
                </div>
                {serialsOn ? (
                  <label className="flex items-start gap-2 rounded-md border p-3">
                    <Checkbox checked={serialized} onCheckedChange={(v) => setSerialized(v === true)} />
                    <span className="text-sm">
                      Serialized part
                      <span className="block text-xs text-muted-foreground">Prompt for serial numbers when receiving and shipping this part.</span>
                    </span>
                  </label>
                ) : null}

                {canSeeCost ? (
                  <div className="rounded-md border p-3">
                    <p className="text-sm font-medium">Initial cost (optional)</p>
                    <p className="mb-2 text-xs text-muted-foreground">
                      Buy this part from one place already? Set its price now. Otherwise skip this — you can add
                      pricing later, and add more vendors, from the $ button on the Products list.
                    </p>
                    <div className="space-y-2">
                      <Select value={priceSupplierId} onValueChange={setPriceSupplierId}>
                        <SelectTrigger><SelectValue placeholder="Vendor (optional)" /></SelectTrigger>
                        <SelectContent>
                          {suppliers.data?.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                          <SelectItem value="__other__">Marketplace (Amazon, eBay…)</SelectItem>
                        </SelectContent>
                      </Select>
                      {priceSupplierId === "__other__" && (
                        <Input placeholder="e.g. Amazon" value={priceSourceLabel} onChange={(e) => setPriceSourceLabel(e.target.value)} />
                      )}
                      <div className="grid grid-cols-2 gap-2">
                        <Input
                          type="number" step="0.01" min={0} inputMode="decimal"
                          placeholder="Cost"
                          value={priceCost}
                          onChange={(e) => setPriceCost(e.target.value)}
                        />
                        <Input placeholder="Vendor SKU (optional)" value={priceSku} onChange={(e) => setPriceSku(e.target.value)} />
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => { setOpen(false); resetPriceFields(); }}>Cancel</Button>
                <Button onClick={() => createMut.mutate()} disabled={!pn || !desc || createMut.isPending}>{createMut.isPending ? "Adding…" : "Add"}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        ) : null}
      />

      <div className="relative mb-4">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search part # or description…"
          className="pl-9"
        />
      </div>

      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Part #</TableHead><TableHead>Description</TableHead><TableHead>Unit</TableHead>{serialsOn ? <TableHead>Serials</TableHead> : null}<TableHead className="text-right">Reorder point</TableHead>
            {canSeeCost ? <><TableHead className="text-right">Cost</TableHead><TableHead>Updated</TableHead></> : null}
            <TableHead />
          </TableRow></TableHeader>
          <TableBody>
            {filtered.length > 0 ? filtered.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="font-mono">{p.part_number}</TableCell>
                <TableCell>{p.description}</TableCell>
                <TableCell>{p.unit}</TableCell>
                {serialsOn ? (
                  <TableCell>
                    {(p as Product).is_serialized ? <Badge variant="secondary">Serialized</Badge> : <span className="text-xs text-muted-foreground">—</span>}
                  </TableCell>
                ) : null}
                <TableCell className="text-right">{p.reorder_point}</TableCell>
                {canSeeCost ? (
                  <>
                    <TableCell className="text-right">
                      {p.default_cost != null ? (
                        <div className="font-mono">
                          ${Number(p.default_cost).toFixed(2)}/{p.default_cost_unit}
                          {p.default_source ? <div className="text-xs font-normal text-muted-foreground">{p.default_source}</div> : null}
                        </div>
                      ) : <span className="text-xs text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {p.cost_updated_at ? new Date(p.cost_updated_at).toLocaleDateString() : "—"}
                    </TableCell>
                  </>
                ) : null}
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    {canSeeCost ? (
                      <Button size="icon" variant="ghost" aria-label={`Prices for ${p.part_number}`} onClick={() => setPricesFor(p)}>
                        <DollarSign className="h-3.5 w-3.5" />
                      </Button>
                    ) : null}
                    {canWrite ? (
                      <Button size="icon" variant="ghost" aria-label="Edit product" onClick={() => openEdit(p)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    ) : null}
                  </div>
                </TableCell>
              </TableRow>
            )) : <TableRow><TableCell colSpan={serialsOn ? (canSeeCost ? 8 : 6) : (canSeeCost ? 7 : 5)} className="py-6 text-center text-sm text-muted-foreground">{term ? "No matches." : "No products yet."}</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent></Card>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit product</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label htmlFor="e-pn">Part number</Label><Input id="e-pn" value={ePn} onChange={(e) => setEPn(e.target.value)} /></div>
            <div><Label htmlFor="e-pdesc">Description</Label><Input id="e-pdesc" value={eDesc} onChange={(e) => setEDesc(e.target.value)} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label htmlFor="e-unit">Unit</Label><Input id="e-unit" value={eUnit} onChange={(e) => setEUnit(e.target.value)} /></div>
              <div><Label htmlFor="e-rp">Reorder point</Label><Input id="e-rp" type="number" min={0} step={1} inputMode="numeric" value={eRp} onChange={(e) => setERp(Math.max(0, Math.trunc(Number(e.target.value) || 0)))} /></div>
            </div>
            {serialsOn ? (
              <label className="flex items-start gap-2 rounded-md border p-3">
                <Checkbox checked={eSerialized} onCheckedChange={(v) => setESerialized(v === true)} />
                <span className="text-sm">
                  Serialized part
                  <span className="block text-xs text-muted-foreground">Prompt for serial numbers when receiving and shipping this part.</span>
                </span>
              </label>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={() => editMut.mutate()} disabled={!ePn.trim() || !eDesc.trim() || editMut.isPending}>{editMut.isPending ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {pricesFor ? (
        <ProductPricesDialog
          open={!!pricesFor}
          onOpenChange={(o) => !o && setPricesFor(null)}
          productId={pricesFor.id}
          partNumber={pricesFor.part_number}
          description={pricesFor.description}
          canEdit={canWrite}
        />
      ) : null}
    </div>
  );
}
