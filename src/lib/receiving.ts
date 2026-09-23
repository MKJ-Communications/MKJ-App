import { supabase } from "@/integrations/supabase/client";

const MAX_AUTO_PART_NUMBER_LENGTH = 60;

/** Caps a free-typed description used as a fallback part number, so a whole sentence never becomes the stored value (the full text is kept in `description` regardless). */
function truncateForPartNumber(text: string): string {
  return text.length > MAX_AUTO_PART_NUMBER_LENGTH
    ? text.slice(0, MAX_AUTO_PART_NUMBER_LENGTH - 1).trimEnd() + "…"
    : text;
}

/**
 * Packing-slip lines often come from PO lines that were typed free-hand and have
 * no product_id. Without a product we can't move inventory, so resolve (or create)
 * a catalog product from the line's part number / description.
 */
export async function resolveProductId(opts: {
  productId?: string | null;
  partNumber?: string | null;
  description: string;
  unit?: string | null;
}): Promise<string | null> {
  if (opts.productId) return opts.productId;
  const key = (opts.partNumber || opts.description || "").trim();
  if (!key) return null;

  // Two separate, properly-parameterized lookups instead of interpolating
  // free-typed text into a raw PostgREST .or() filter string -- a comma,
  // parenthesis, or dot in `key` broke that (wrong matches, or a 400).
  // .order("id") makes repeated calls with the same key deterministic when
  // more than one row matches, instead of an arbitrary one among ties.
  const { data: byPartNumber } = await supabase
    .from("products")
    .select("id")
    .ilike("part_number", key)
    .order("id")
    .limit(1)
    .maybeSingle();
  if (byPartNumber?.id) return byPartNumber.id;

  const { data: byDescription } = await supabase
    .from("products")
    .select("id")
    .ilike("description", key)
    .order("id")
    .limit(1)
    .maybeSingle();
  if (byDescription?.id) return byDescription.id;

  const partNumber = opts.partNumber?.trim() || truncateForPartNumber(key);

  const { data: created, error } = await supabase
    .from("products")
    .insert({
      part_number: partNumber,
      description: opts.description || key,
      unit: opts.unit || "ea",
    })
    .select("id")
    .single();
  if (error) throw error;
  return created.id;
}

export type SlipInventoryLine = {
  product_id: string | null;
  qty_received: number;
};

/**
 * Reconcile inventory movements for a packing slip against its current line
 * items. inventory_adjustments is an append-only ledger (no DELETE grant), so
 * this calls a SECURITY DEFINER RPC that inserts only the delta needed to
 * bring the ledger in line with `packing_slip_items` — safe to call after
 * every save, including saves that change nothing.
 */
export async function syncSlipInventory(params: {
  slipId: string;
  slipNumber: string;
  projectId: string;
  lines: SlipInventoryLine[];
  userId: string | null;
}) {
  const { error } = await supabase.rpc("sync_packing_slip_inventory", { _slip_id: params.slipId });
  if (error) throw error;
}

export function slipStatusFor(lines: { qty_ordered: number; qty_received: number }[]): "received" | "partially_received" {
  return lines.some((l) => l.qty_received < l.qty_ordered) ? "partially_received" : "received";
}

/**
 * Recompute a PO's received status from every packing slip logged against it.
 *
 * Runs in the database (refresh_po_status) rather than here: project managers
 * receive shipments but have no UPDATE rights on purchase_orders, so a direct
 * update from the browser would be silently dropped by RLS. Receiving never
 * sets Approved/Executed — those stay manual. The status from just before the
 * first receipt is kept in `pre_receipt_status` so the PO can fall back to it
 * if every receipt is later removed/zeroed out.
 */
export async function refreshPoStatus(poId: string) {
  const { error } = await supabase.rpc("refresh_po_status", { _po_id: poId });
  if (error) throw error;
}

/**
 * Lowering a slip's received quantities takes that stock back out of the
 * project. If manufacturing build requests hold it, the database refuses the
 * stock update (guard_held_stock) -- but the edit dialog saves the slip lines
 * from the browser *before* syncing stock, so a refusal there would leave the
 * slip saved with quantities the stock doesn't match. Check first, before
 * anything is written. Totals mirror sync_packing_slip_inventory: every line
 * with a product and qty_received > 0, whatever its condition.
 */
export async function assertSlipEditKeepsHeldStock(params: {
  projectId: string;
  before: SlipInventoryLine[];
  after: SlipInventoryLine[];
}) {
  const totals = (lines: SlipInventoryLine[]) => {
    const m = new Map<string, number>();
    for (const l of lines) {
      if (l.product_id && Number(l.qty_received) > 0) m.set(l.product_id, (m.get(l.product_id) ?? 0) + Number(l.qty_received));
    }
    return m;
  };
  const before = totals(params.before);
  const after = totals(params.after);
  const drops = [...before]
    .map(([productId, qty]) => ({ productId, drop: qty - (after.get(productId) ?? 0) }))
    .filter((d) => d.drop > 0);
  if (drops.length === 0) return;

  const { data, error } = await supabase
    .from("v_project_inventory")
    .select("product_id, held, available, products:product_id(part_number)")
    .eq("project_id", params.projectId)
    .in("product_id", drops.map((d) => d.productId));
  if (error) throw error;

  for (const { productId, drop } of drops) {
    const row = (data ?? []).find((r) => r.product_id === productId);
    const held = Number(row?.held ?? 0);
    const available = Number(row?.available ?? 0);
    // Only stock held for manufacturing blocks the edit; everything else behaves as before.
    if (held > 0 && drop > available) {
      const part = (row?.products as { part_number: string } | null)?.part_number ?? "A part";
      throw new Error(
        `${part}: this change takes ${drop} out of stock, but only ${available} can be used — ${held} is held for manufacturing. Nothing was saved.`,
      );
    }
  }
}

