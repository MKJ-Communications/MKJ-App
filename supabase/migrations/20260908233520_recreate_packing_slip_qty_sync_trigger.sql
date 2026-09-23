-- DATA-CORRECTNESS FIX: migration 20260801221700 (F-23) defined this
-- function/trigger to keep packing_slip_items.qty_ordered in sync when a
-- purchase-order line's quantity is edited after a slip already references
-- it, but neither exists live (confirmed via pg_proc / pg_trigger) --
-- another casualty of schema having been pushed via Lovable's own sync
-- rather than the Supabase CLI. Without it, editing a PO line's qty leaves
-- every slip already recorded against it holding a stale qty_ordered, so
-- backorder/status calculations silently drift from the real order.
--
-- Identical to the original migration's definition. Safe to run more than
-- once.

CREATE OR REPLACE FUNCTION public.sync_packing_slip_item_qty_ordered()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.qty IS DISTINCT FROM OLD.qty THEN
    UPDATE public.packing_slip_items
    SET qty_ordered = NEW.qty
    WHERE po_item_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_poi_sync_slip_qty ON public.purchase_order_items;
CREATE TRIGGER trg_poi_sync_slip_qty
AFTER UPDATE OF qty ON public.purchase_order_items
FOR EACH ROW EXECUTE FUNCTION public.sync_packing_slip_item_qty_ordered();

-- CREATE FUNCTION grants EXECUTE to PUBLIC by default. This is a
-- trigger-only function (never called directly by a client), so close that
-- straight back off -- consistent with 20260908233505's anon-access fix.
REVOKE ALL ON FUNCTION public.sync_packing_slip_item_qty_ordered() FROM PUBLIC, anon, authenticated;
