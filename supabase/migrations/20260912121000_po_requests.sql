-- ============ PO REQUESTS, PHASE 2: TABLES, RPCs, NOTIFICATIONS ============
-- A PO request is a project manager (or admin) asking the warehouse to
-- write a real purchase order. It is deliberately NOT a purchase_orders row:
-- receiving, packing slips, PO PDFs and the dashboard's PO counts must never
-- see one. The Purchase Orders page merges the two lists in the browser.
--
-- Lifecycle: pending -> completed (warehouse/admin, optional free-text PO
-- reference, never a link to a PO) or pending -> cancelled (reason required,
-- by the requester side or the warehouse). Editable only while pending.
-- Numbered per project: REQ-<mkj_number>-<3-digit seq>, e.g. REQ-2403-005,
-- minted with the project row locked like create_purchase_order does.
--
-- Clients can only SELECT these tables; every write goes through the RPCs
-- below (SECURITY DEFINER), which enforce the permission rules. Notifications
-- are written by those RPCs rather than a row trigger, because a request's
-- lines are inserted after the request row and the "created" message needs
-- the line count.

BEGIN;

CREATE TYPE public.po_request_status AS ENUM ('pending', 'completed', 'cancelled');

CREATE TABLE public.po_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_number TEXT NOT NULL UNIQUE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE RESTRICT,
  project_number TEXT NOT NULL,
  request_sequence INTEGER NOT NULL,
  status public.po_request_status NOT NULL DEFAULT 'pending',
  notes TEXT,
  requested_by UUID REFERENCES auth.users(id),
  completed_by UUID REFERENCES auth.users(id),
  completed_at TIMESTAMPTZ,
  po_reference TEXT,
  cancelled_by UUID REFERENCES auth.users(id),
  cancelled_at TIMESTAMPTZ,
  cancel_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT po_requests_project_sequence_key UNIQUE (project_id, request_sequence),
  CONSTRAINT po_requests_cancel_reason_check
    CHECK (status <> 'cancelled' OR (cancel_reason IS NOT NULL AND btrim(cancel_reason) <> ''))
);

CREATE INDEX po_requests_status_idx ON public.po_requests (status);

CREATE TABLE public.po_request_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES public.po_requests(id) ON DELETE CASCADE,
  line_no INTEGER NOT NULL,
  product_id UUID REFERENCES public.products(id),
  custom_description TEXT,
  qty INTEGER NOT NULL CHECK (qty > 0),
  unit TEXT NOT NULL DEFAULT 'ea',
  CONSTRAINT po_request_lines_request_line_key UNIQUE (request_id, line_no),
  -- Exactly one of: a catalog product, or a typed item.
  CONSTRAINT po_request_lines_item_check
    CHECK ((product_id IS NOT NULL) <> (custom_description IS NOT NULL)),
  CONSTRAINT po_request_lines_custom_nonblank_check
    CHECK (custom_description IS NULL OR btrim(custom_description) <> '')
);

CREATE INDEX po_request_lines_product_idx ON public.po_request_lines (product_id);

CREATE TRIGGER trg_po_requests_upd BEFORE UPDATE ON public.po_requests
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---- Read-only to clients; visibility follows the project, like POs ----
REVOKE ALL ON public.po_requests, public.po_request_lines FROM anon, authenticated;
GRANT SELECT ON public.po_requests, public.po_request_lines TO authenticated;
GRANT ALL ON public.po_requests, public.po_request_lines TO service_role;

ALTER TABLE public.po_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.po_request_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY po_requests_select ON public.po_requests FOR SELECT TO authenticated
USING (public.can_see_project(auth.uid(), project_id));

CREATE POLICY po_request_lines_select ON public.po_request_lines FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.po_requests r
  WHERE r.id = request_id AND public.can_see_project(auth.uid(), r.project_id)
));

-- ---- Who may create/edit a request: managers of the project, and admins ----
-- Warehouse managers write real POs directly, so they don't create requests.
CREATE OR REPLACE FUNCTION public.can_request_po(_user_id UUID, _project_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.is_admin(_user_id) OR public.manages_project(_user_id, _project_id)
$$;

-- ---- Internal: validate and (re)write a request's lines ----
CREATE OR REPLACE FUNCTION public.po_request_write_lines(_request_id UUID, _lines JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _line JSONB;
  _idx BIGINT;
  _product UUID;
  _desc TEXT;
  _qty NUMERIC;
  _unit TEXT;
  _product_unit TEXT;
BEGIN
  IF _lines IS NULL OR jsonb_typeof(_lines) <> 'array' OR jsonb_array_length(_lines) = 0 THEN
    RAISE EXCEPTION 'Add at least one line to the request';
  END IF;

  DELETE FROM public.po_request_lines WHERE request_id = _request_id;

  FOR _line, _idx IN
    SELECT e.value, e.ordinality FROM jsonb_array_elements(_lines) WITH ORDINALITY AS e(value, ordinality)
  LOOP
    _product := NULLIF(_line->>'product_id', '')::UUID;
    _desc := NULLIF(btrim(COALESCE(_line->>'custom_description', '')), '');

    IF jsonb_typeof(_line->'qty') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'Line %: enter a quantity', _idx;
    END IF;
    _qty := (_line->>'qty')::NUMERIC;
    IF _qty <= 0 OR _qty <> trunc(_qty) THEN
      RAISE EXCEPTION 'Line %: quantity must be a whole number above zero', _idx;
    END IF;

    IF _product IS NOT NULL THEN
      SELECT unit INTO _product_unit FROM public.products WHERE id = _product;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Line %: that product no longer exists', _idx;
      END IF;
      _desc := NULL;
    ELSIF _desc IS NULL THEN
      RAISE EXCEPTION 'Line %: pick a product or type what you need', _idx;
    ELSE
      _product_unit := NULL;
    END IF;

    _unit := COALESCE(NULLIF(btrim(COALESCE(_line->>'unit', '')), ''), _product_unit, 'ea');

    INSERT INTO public.po_request_lines (request_id, line_no, product_id, custom_description, qty, unit)
    VALUES (_request_id, _idx, _product, _desc, _qty::INTEGER, _unit);
  END LOOP;
END;
$$;

-- ---- Internal: notifications for request events ----
-- created   -> warehouse managers + admins
-- completed -> requester + the project's managers
-- cancelled -> the other side: warehouse cancelling notifies the requester
--              side; the requester side cancelling notifies the warehouse.
-- The actor is never notified about their own action.
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
        || ' for ' || _r.project_number || ' (' || _r.request_number || '). Create the PO, then mark it completed.',
      _link
    FROM public.user_roles ur
    WHERE ur.role IN ('warehouse_manager', 'admin') AND ur.user_id IS DISTINCT FROM _actor;

  ELSIF _event = 'completed' THEN
    INSERT INTO public.notifications (recipient_user_id, type, title, body, link)
    SELECT DISTINCT s.u, 'po_request_completed',
      'PO request completed',
      _r.request_number || ' was completed by the warehouse.'
        || CASE WHEN _r.po_reference IS NOT NULL THEN ' PO: ' || _r.po_reference || '.' ELSE '' END,
      _link
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

-- ---- RPC: create ----
CREATE OR REPLACE FUNCTION public.create_po_request(_project_id UUID, _notes TEXT, _lines JSONB)
RETURNS public.po_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _project_number TEXT;
  _next_seq INTEGER;
  _req public.po_requests;
BEGIN
  IF NOT public.can_request_po(auth.uid(), _project_id) THEN
    RAISE EXCEPTION 'Only this project''s managers and admins can request a PO for it';
  END IF;

  SELECT mkj_number INTO _project_number
  FROM public.projects
  WHERE id = _project_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Project not found';
  END IF;

  SELECT COALESCE(MAX(request_sequence), 0) + 1 INTO _next_seq
  FROM public.po_requests
  WHERE project_id = _project_id;

  INSERT INTO public.po_requests (request_number, project_id, project_number, request_sequence, notes, requested_by)
  VALUES (
    'REQ-' || _project_number || '-' || LPAD(_next_seq::TEXT, 3, '0'),
    _project_id, _project_number, _next_seq, NULLIF(btrim(_notes), ''), auth.uid()
  )
  RETURNING * INTO _req;

  PERFORM public.po_request_write_lines(_req.id, _lines);
  PERFORM public.notify_po_request(_req.id, 'created');
  RETURN _req;
END;
$$;

-- ---- RPC: edit (pending only; replaces notes and all lines) ----
CREATE OR REPLACE FUNCTION public.update_po_request(_request_id UUID, _notes TEXT, _lines JSONB)
RETURNS public.po_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _req public.po_requests;
BEGIN
  SELECT * INTO _req FROM public.po_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found';
  END IF;
  IF NOT public.can_request_po(auth.uid(), _req.project_id) THEN
    RAISE EXCEPTION 'Only this project''s managers and admins can edit this request';
  END IF;
  IF _req.status <> 'pending' THEN
    RAISE EXCEPTION 'This request is already % and can no longer be edited', _req.status;
  END IF;

  UPDATE public.po_requests SET notes = NULLIF(btrim(_notes), '')
  WHERE id = _request_id
  RETURNING * INTO _req;

  PERFORM public.po_request_write_lines(_request_id, _lines);
  RETURN _req;
END;
$$;

-- ---- RPC: complete (warehouse/admin) ----
CREATE OR REPLACE FUNCTION public.complete_po_request(_request_id UUID, _po_reference TEXT)
RETURNS public.po_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _req public.po_requests;
BEGIN
  IF NOT public.is_warehouse_or_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only warehouse managers and admins can complete a PO request';
  END IF;

  SELECT * INTO _req FROM public.po_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found';
  END IF;
  IF _req.status <> 'pending' THEN
    RAISE EXCEPTION 'This request is already %', _req.status;
  END IF;

  UPDATE public.po_requests
  SET status = 'completed', completed_by = auth.uid(), completed_at = now(),
      po_reference = NULLIF(btrim(_po_reference), '')
  WHERE id = _request_id
  RETURNING * INTO _req;

  PERFORM public.notify_po_request(_request_id, 'completed');
  RETURN _req;
END;
$$;

-- ---- RPC: cancel (requester side or warehouse/admin, reason required) ----
CREATE OR REPLACE FUNCTION public.cancel_po_request(_request_id UUID, _reason TEXT)
RETURNS public.po_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _req public.po_requests;
BEGIN
  IF NULLIF(btrim(_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Give a reason for cancelling';
  END IF;

  SELECT * INTO _req FROM public.po_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found';
  END IF;
  IF NOT (public.can_request_po(auth.uid(), _req.project_id) OR public.is_warehouse_or_admin(auth.uid())) THEN
    RAISE EXCEPTION 'Not permitted to cancel this request';
  END IF;
  IF _req.status <> 'pending' THEN
    RAISE EXCEPTION 'This request is already %', _req.status;
  END IF;

  UPDATE public.po_requests
  SET status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = now(),
      cancel_reason = btrim(_reason)
  WHERE id = _request_id
  RETURNING * INTO _req;

  PERFORM public.notify_po_request(_request_id, 'cancelled');
  RETURN _req;
END;
$$;

-- ---- Function privileges ----
REVOKE ALL ON FUNCTION public.po_request_write_lines(UUID, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_po_request(UUID, TEXT) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.can_request_po(UUID, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_po_request(UUID, TEXT, JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_po_request(UUID, TEXT, JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.complete_po_request(UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_po_request(UUID, TEXT) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.can_request_po(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_po_request(UUID, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_po_request(UUID, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_po_request(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_po_request(UUID, TEXT) TO authenticated;

COMMIT;
