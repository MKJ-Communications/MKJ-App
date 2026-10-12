-- ============ PO REQUESTS: CREATE THE PO FROM THE REQUEST ============
-- Until now the warehouse wrote a PO by hand, then went back to the request
-- and marked it completed with a free-text PO reference. Now the request's
-- "Create PO" action opens the New PO form pre-filled with the request's
-- project and lines; the warehouse adds supplier, prices, budget codes and
-- the rest, and create_po_from_request() does everything in one transaction:
--   1. creates the PO through create_purchase_order() (same numbering,
--      same "Other..." supplier handling, same permission check),
--   2. inserts its lines (catalog lines keep their product_id, so receiving
--      lands stock on the requested product instead of guessing from text),
--   3. completes the request, with po_reference = the new PO number and
--      purchase_order_id pointing at the PO,
--   4. notifies the requester side.
-- A failure anywhere leaves nothing behind, and the request row is locked
-- so two people can't turn the same request into two POs.
--
-- purchase_order_id is the request's only link to a PO. It is ON DELETE SET
-- NULL: deleting a draft PO keeps the request completed with its text
-- po_reference. Receiving, PDFs and PO counts still never read requests.
--
-- complete_po_request() is left in place but the app no longer calls it.

BEGIN;

ALTER TABLE public.po_requests
  ADD COLUMN purchase_order_id UUID REFERENCES public.purchase_orders(id) ON DELETE SET NULL;

CREATE INDEX po_requests_purchase_order_idx ON public.po_requests (purchase_order_id);

-- ---- RPC: create a PO from a pending request (warehouse/admin) ----
CREATE OR REPLACE FUNCTION public.create_po_from_request(
  _request_id UUID,
  _supplier_id UUID,
  _bill_to TEXT,
  _ship_to TEXT,
  _delivery_date DATE,
  _ship_via TEXT,
  _payment_terms TEXT,
  _description TEXT,
  _assignee UUID,
  _additional_freight NUMERIC,
  _terms_conditions TEXT,
  _new_supplier_name TEXT,
  _items JSONB
)
RETURNS public.purchase_orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _req public.po_requests;
  _po public.purchase_orders;
  _item JSONB;
  _idx BIGINT;
  _desc TEXT;
  _product UUID;
BEGIN
  IF NOT public.is_warehouse_or_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only warehouse managers and admins can create a PO from a request';
  END IF;

  SELECT * INTO _req FROM public.po_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found';
  END IF;
  IF _req.status <> 'pending' THEN
    RAISE EXCEPTION '% is already %', _req.request_number, _req.status;
  END IF;

  IF _items IS NULL OR jsonb_typeof(_items) <> 'array' OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'Add at least one line to the PO';
  END IF;

  _po := public.create_purchase_order(
    _req.project_id, _supplier_id, _bill_to, _ship_to, _delivery_date, _ship_via,
    _payment_terms, _description, _assignee, _additional_freight, _terms_conditions,
    _new_supplier_name
  );

  FOR _item, _idx IN
    SELECT e.value, e.ordinality FROM jsonb_array_elements(_items) WITH ORDINALITY AS e(value, ordinality)
  LOOP
    _desc := NULLIF(btrim(COALESCE(_item->>'description', '')), '');
    IF _desc IS NULL THEN
      RAISE EXCEPTION 'Line %: enter a description', _idx;
    END IF;
    IF jsonb_typeof(_item->'qty') IS DISTINCT FROM 'number' OR (_item->>'qty')::NUMERIC < 0 THEN
      RAISE EXCEPTION 'Line %: enter a quantity', _idx;
    END IF;
    IF _item ? 'unit_cost' AND jsonb_typeof(_item->'unit_cost') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'Line %: enter a unit cost', _idx;
    END IF;

    _product := NULLIF(_item->>'product_id', '')::UUID;
    IF _product IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.products WHERE id = _product) THEN
      RAISE EXCEPTION 'Line %: that product no longer exists', _idx;
    END IF;

    INSERT INTO public.purchase_order_items (po_id, line_no, budget_code, product_id, description, qty, unit, unit_cost)
    VALUES (
      _po.id, _idx,
      NULLIF(btrim(COALESCE(_item->>'budget_code', '')), ''),
      _product, _desc,
      (_item->>'qty')::NUMERIC,
      COALESCE(NULLIF(btrim(COALESCE(_item->>'unit', '')), ''), 'ea'),
      COALESCE((_item->>'unit_cost')::NUMERIC, 0)
    );
  END LOOP;

  UPDATE public.po_requests
  SET status = 'completed', completed_by = auth.uid(), completed_at = now(),
      po_reference = _po.po_number, purchase_order_id = _po.id
  WHERE id = _request_id;

  PERFORM public.notify_po_request(_request_id, 'completed');
  RETURN _po;
END;
$$;

-- ---- Notifications: new wording, and "completed" links to the PO ----
CREATE OR REPLACE FUNCTION public.notify_po_request(_request_id UUID, _event TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _r public.po_requests;
  _actor UUID := auth.uid();
  _link TEXT;
  _who TEXT;
  _line_count INTEGER;
  _by_warehouse BOOLEAN;
BEGIN
  SELECT * INTO _r FROM public.po_requests WHERE id = _request_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  _link := '/purchase-orders?request=' || _r.id::TEXT;

  IF _event = 'created' THEN
    SELECT count(*) INTO _line_count FROM public.po_request_lines WHERE request_id = _r.id;
    SELECT NULLIF(btrim(full_name), '') INTO _who FROM public.user_directory WHERE id = _r.requested_by;

    INSERT INTO public.notifications (recipient_user_id, type, title, body, link)
    SELECT DISTINCT ur.user_id, 'po_request_created',
      'PO request from ' || _r.project_number,
      COALESCE(_who, 'A project manager') || ' requested ' || _line_count
        || CASE WHEN _line_count = 1 THEN ' item' ELSE ' items' END
        || ' for ' || _r.project_number || ' (' || _r.request_number || '). Open it and choose Create PO.',
      _link
    FROM public.user_roles ur
    WHERE ur.role IN ('warehouse_manager', 'admin') AND ur.user_id IS DISTINCT FROM _actor;

  ELSIF _event = 'completed' THEN
    INSERT INTO public.notifications (recipient_user_id, type, title, body, link)
    SELECT DISTINCT s.u, 'po_request_completed',
      CASE WHEN _r.purchase_order_id IS NOT NULL THEN 'PO created from your request' ELSE 'PO request completed' END,
      CASE WHEN _r.purchase_order_id IS NOT NULL
        THEN _r.po_reference || ' was created from ' || _r.request_number || '.'
        ELSE _r.request_number || ' was completed by the warehouse.'
          || CASE WHEN _r.po_reference IS NOT NULL THEN ' PO: ' || _r.po_reference || '.' ELSE '' END
      END,
      CASE WHEN _r.purchase_order_id IS NOT NULL THEN '/purchase-orders/' || _r.purchase_order_id::TEXT ELSE _link END
    FROM (
      SELECT _r.requested_by AS u
      UNION SELECT project_manager_id FROM public.projects WHERE id = _r.project_id
      UNION SELECT user_id FROM public.project_managers WHERE project_id = _r.project_id
    ) s
    WHERE s.u IS NOT NULL AND s.u IS DISTINCT FROM _actor;

  ELSIF _event = 'cancelled' THEN
    _by_warehouse := public.is_warehouse_or_admin(_actor)
      AND _actor IS DISTINCT FROM _r.requested_by
      AND NOT public.manages_project(_actor, _r.project_id);

    IF _by_warehouse THEN
      INSERT INTO public.notifications (recipient_user_id, type, title, body, link)
      SELECT DISTINCT s.u, 'po_request_cancelled',
        'PO request cancelled by the warehouse',
        _r.request_number || ': ' || _r.cancel_reason,
        _link
      FROM (
        SELECT _r.requested_by AS u
        UNION SELECT project_manager_id FROM public.projects WHERE id = _r.project_id
        UNION SELECT user_id FROM public.project_managers WHERE project_id = _r.project_id
      ) s
      WHERE s.u IS NOT NULL AND s.u IS DISTINCT FROM _actor;
    ELSE
      INSERT INTO public.notifications (recipient_user_id, type, title, body, link)
      SELECT DISTINCT ur.user_id, 'po_request_cancelled',
        'PO request cancelled',
        _r.request_number || ' was withdrawn. Reason: ' || _r.cancel_reason,
        _link
      FROM public.user_roles ur
      WHERE ur.role IN ('warehouse_manager', 'admin') AND ur.user_id IS DISTINCT FROM _actor;
    END IF;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.create_po_from_request(UUID, UUID, TEXT, TEXT, DATE, TEXT, TEXT, TEXT, UUID, NUMERIC, TEXT, TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_po_from_request(UUID, UUID, TEXT, TEXT, DATE, TEXT, TEXT, TEXT, UUID, NUMERIC, TEXT, TEXT, JSONB) TO authenticated;

COMMIT;
