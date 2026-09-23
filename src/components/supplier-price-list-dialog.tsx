import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Star } from "lucide-react";

type SupplierPriceRow = {
  id: string;
  unit_cost: number;
  unit: string;
  supplier_sku: string | null;
  is_preferred: boolean;
  price_updated_at: string;
  products: { part_number: string; description: string } | null;
};

/**
 * Read-only: which parts we buy from this vendor and at what price. Editing
 * a price happens from the Products page (ProductPricesDialog) so there's
 * one write path per price row instead of two forms that could drift.
 */
export function SupplierPriceListDialog({
  open,
  onOpenChange,
  supplierId,
  supplierName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  supplierId: string;
  supplierName: string;
}) {
  const prices = useQuery({
    queryKey: ["supplier-prices-by-supplier", supplierId],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("supplier_prices")
        .select("*, products(part_number, description)")
        .eq("supplier_id", supplierId)
        .order("is_preferred", { ascending: false });
      if (error) throw error;
      return (data ?? []) as SupplierPriceRow[];
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Prices — {supplierName}</DialogTitle>
        </DialogHeader>
        <p className="-mt-2 text-sm text-muted-foreground">
          Parts bought from this vendor. To add or edit a price, open the part on the Products page.
        </p>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Part #</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead className="text-right">Cost</TableHead>
              <TableHead>Updated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {prices.data && prices.data.length > 0 ? prices.data.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-mono">
                  <div className="flex items-center gap-1.5">
                    {r.is_preferred ? <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" aria-label="Preferred" /> : null}
                    {r.products?.part_number ?? "—"}
                  </div>
                </TableCell>
                <TableCell>{r.products?.description ?? "—"}</TableCell>
                <TableCell className="font-mono text-xs">{r.supplier_sku ?? "—"}</TableCell>
                <TableCell className="text-right font-mono">${Number(r.unit_cost).toFixed(2)}/{r.unit}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{new Date(r.price_updated_at).toLocaleDateString()}</TableCell>
              </TableRow>
            )) : (
              <TableRow>
                <TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                  No prices recorded for this vendor yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </DialogContent>
    </Dialog>
  );
}
