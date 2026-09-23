-- ============ PO REQUESTS, PHASE 1: MANAGERS READ-ONLY ON POs + PROCORE REMOVED ============
-- Real purchase orders now belong to warehouse managers and admins only.
-- Project managers keep viewing POs (po_select unchanged) and keep receiving
-- shipments against them, but can no longer create a PO, add PO lines, or
-- update a PO in any way (status included). They ask for POs through
-- "Request a PO" instead (phase 2).
--
-- The catch: receiving used to recompute the PO's received status from the
-- browser, as the signed-in user (refreshPoStatus() in src/lib/receiving.ts),
-- which relied on po_update being open to project managers. That logic moves
-- here into refresh_po_status(), a SECURITY DEFINER function callable by
-- anyone who may receive on the project, so po_update can be tightened
-- without silently leaving a manager's receipt with a stale PO status.
--
-- "Any receipt" is defined exactly like enforce_po_status_transition does
-- (any slip line on the PO with qty_received > 0, linked to a PO line or
-- not), so this function can never compute a status that trigger rejects.
--
-- Procore is no longer used: entered_in_procore is dropped along with its
-- check in enforce_po_edit_guard. The table held no POs when this ran.

BEGIN;

-- ---- refresh_po_status: server-side port of refreshPoStatus() ----
CREATE OR REPLACE FUNCTION public.refresh_po_status(_po_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _po public.purchase_orders;
  _any_received BOOLEAN;
  _any_open BOOLEAN;
BEGIN
  SELECT * INTO _po FROM public.purchase_orders WHERE id = _po_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF NOT public.can_write_project(auth.uid(), _po.project_id) THEN
    RAISE EXCEPTION 'Not permitted to update this purchase order';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.packing_slip_items psi
    JOIN public.packing_slips ps ON ps.id = psi.slip_id
    WHERE ps.po_id = _po_id AND psi.qty_received > 0
  ) INTO _any_received;

  IF NOT _any_received THEN
    -- No receipts left: fall back to the status from before the first one.
    -- Unknown pre-receipt status (first receipt predates the column): leave
    -- it for a human to correct rather than guess.
    IF _po.pre_receipt_status IS NOT NULL THEN
      UPDATE public.purchase_orders
      SET status = _po.pre_receipt_status, pre_receipt_status = NULL
      WHERE id = _po_id;
    END IF;
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.purchase_order_items poi
    WHERE poi.po_id = _po_id
      AND COALESCE((
        SELECT SUM(psi.qty_received)
        FROM public.packing_slip_items psi
        JOIN public.packing_slips ps ON ps.id = psi.slip_id
        WHERE ps.po_id = _po_id AND psi.po_item_id = poi.id
      ), 0) < poi.qty
  ) INTO _any_open;

  UPDATE public.purchase_orders
  SET status = CASE WHEN _any_open THEN 'partially_received' ELSE 'received' END::public.po_status,
      -- Only capture the pre-receipt status on the first receipt.
      pre_receipt_status = CASE
        WHEN _po.status NOT IN ('partially_received', 'received') AND _po.pre_receipt_status IS NULL
          THEN _po.status
        ELSE _po.pre_receipt_status
      END
  WHERE id = _po_id;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_po_status(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refresh_po_status(UUID) TO authenticated;

-- ---- purchase_orders: insert/update limited to warehouse managers and admins ----
DROP POLICY IF EXISTS po_insert ON public.purchase_orders;
CREATE POLICY po_insert ON public.purchase_orders FOR INSERT TO authenticated
WITH CHECK (public.is_warehouse_or_admin(auth.uid()));

DROP POLICY IF EXISTS po_update ON public.purchase_orders;
CREATE POLICY po_update ON public.purchase_orders FOR UPDATE TO authenticated
USING (public.is_warehouse_or_admin(auth.uid()))
WITH CHECK (public.is_warehouse_or_admin(auth.uid()));

-- ---- purchase_order_items: adding lines follows PO creation ----
DROP POLICY IF EXISTS poi_insert ON public.purchase_order_items;
CREATE POLICY poi_insert ON public.purchase_order_items FOR INSERT TO authenticated
WITH CHECK (
  public.is_warehouse_or_admin(auth.uid())
  AND EXISTS (SELECT 1 FROM public.purchase_orders p WHERE p.id = po_id)
);

-- ---- create_purchase_order: same signature and body, warehouse/admin only ----
CREATE OR REPLACE FUNCTION public.create_purchase_order(
  _project_id UUID,
  _supplier_id UUID,
  _bill_to TEXT,
  _ship_to TEXT,
  _delivery_date DATE,
  _ship_via TEXT,
  _payment_terms TEXT,
  _description TEXT,
  _assignee UUID DEFAULT NULL,
  _additional_freight NUMERIC DEFAULT 0,
  _terms_conditions TEXT DEFAULT NULL,
  _new_supplier_name TEXT DEFAULT NULL
) RETURNS public.purchase_orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _project_number TEXT;
  _next_seq INTEGER;
  _po_number TEXT;
  _resolved_supplier_id UUID;
  _new_po public.purchase_orders;
BEGIN
  IF NOT public.is_warehouse_or_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only warehouse managers and admins can create purchase orders. Use "Request a PO" to ask the warehouse for one.';
  END IF;

  _resolved_supplier_id := _supplier_id;
  IF _new_supplier_name IS NOT NULL AND trim(_new_supplier_name) <> '' THEN
    INSERT INTO public.suppliers (name) VALUES (trim(_new_supplier_name))
    RETURNING id INTO _resolved_supplier_id;
  END IF;

  SELECT mkj_number INTO _project_number
  FROM public.projects
  WHERE id = _project_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Project not found';
  END IF;

  SELECT COALESCE(MAX(po_sequence), 0) + 1 INTO _next_seq
  FROM public.purchase_orders
  WHERE project_id = _project_id;

  _po_number := 'MKJ' || _project_number || 'EX' || LPAD(_next_seq::TEXT, 3, '0');

  INSERT INTO public.purchase_orders (
    project_id, project_number, po_sequence, po_number,
    supplier_id, bill_to, ship_to, delivery_date, ship_via, payment_terms, description, assignee,
    additional_freight, terms_conditions, created_by
  ) VALUES (
    _project_id, _project_number, _next_seq, _po_number,
    _resolved_supplier_id, _bill_to, _ship_to, _delivery_date, _ship_via, _payment_terms, _description, _assignee,
    COALESCE(_additional_freight, 0), _terms_conditions, auth.uid()
  )
  RETURNING * INTO _new_po;

  RETURN _new_po;
END;
$$;

-- ---- enforce_po_edit_guard: Procore check removed, edit rule unchanged ----
CREATE OR REPLACE FUNCTION public.enforce_po_edit_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (NEW.supplier_id IS DISTINCT FROM OLD.supplier_id
      OR NEW.assignee IS DISTINCT FROM OLD.assignee
      OR NEW.bill_to IS DISTINCT FROM OLD.bill_to
      OR NEW.ship_to IS DISTINCT FROM OLD.ship_to
      OR NEW.delivery_date IS DISTINCT FROM OLD.delivery_date
      OR NEW.ship_via IS DISTINCT FROM OLD.ship_via
      OR NEW.payment_terms IS DISTINCT FROM OLD.payment_terms
      OR NEW.description IS DISTINCT FROM OLD.description
      OR NEW.terms_conditions IS DISTINCT FROM OLD.terms_conditions
      OR NEW.additional_freight IS DISTINCT FROM OLD.additional_freight)
     AND NOT public.can_modify_po(auth.uid(), OLD.status)
  THEN
    RAISE EXCEPTION 'Not permitted to edit this purchase order';
  END IF;

  RETURN NEW;
END;
$$;

ALTER TABLE public.purchase_orders DROP COLUMN IF EXISTS entered_in_procore;

COMMIT;
