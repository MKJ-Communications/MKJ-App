-- ============ MANUFACTURING, PHASE 3: BUILD REQUESTS ============
-- A build request asks the shop to build N units of one system for one
-- project, from that project's stock. Tables were created in phase 2
-- (manufacturing_held_stock); this adds every write, all through SECURITY
-- DEFINER RPCs (clients only SELECT), following the po_requests conventions:
-- the RPC that makes a change also sends its notifications.
--
-- Lifecycle in this phase:
--   draft --submit--> submitted --pull back--> draft
--                     submitted --reject----> rejected --edit--> draft
--   (in_progress / partially_built / completed / cancelled arrive in phase 4)
--
-- Who: the requester side is the project's managers, warehouse managers and
-- admins (can_request_build): create, edit, submit, pull back. Only warehouse
-- managers and admins reject. Engineers read only (RLS from phase 2).
--
-- The submit rule (agreed 2026-09-11/12): each line is one part. At submit,
-- every line holds LEAST(needed, available) under a per project+part advisory
-- lock (same key as guard_held_stock). The request is accepted only if at
-- least 80% of the lines are fully held AND every key part is fully held;
-- otherwise the whole call fails and nothing is held. Whether a line is a key
-- part always comes from the system -- the requester can't change it or drop
-- a key part, so the rule can't be sidestepped.
--
-- Held stock follows stock, never POs or borrows:
--   * allocate_held_stock(project, part) gives available stock to open
--     requests with pending lines, oldest submission first, logs a
--     'parts_held' event and notifies the requester side and the warehouse.
--   * trg_inventory_adjustments_allocate runs it whenever stock arrives
--     (any positive ledger row: packing slip, borrow, return, count...).
--   * release_build_holds() runs it after a pull-back or rejection so the
--     freed stock goes straight to other waiting builds.
-- Status is changed BEFORE releasing, so a released request never re-grabs
-- its own parts.

BEGIN;

-- ---- Who may create / edit / submit / pull back ----
CREATE OR REPLACE FUNCTION public.can_request_build(_user_id UUID, _project_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.is_warehouse_or_admin(_user_id) OR public.manages_project(_user_id, _project_id)
$$;

-- ---- Internal: notifications for request events ----
-- submitted   -> warehouse managers + admins; plus the project's managers and
--                the requester when the warehouse side submitted it
-- pulled_back -> warehouse managers + admins
-- rejected    -> requester + the project's managers
-- parts_held  -> requester + the project's managers + warehouse managers + admins
-- The actor is never notified about their own action.
CREATE OR REPLACE FUNCTION public.notify_build_request(_request_id UUID, _event TEXT, _detail TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _r public.build_requests;
  _actor UUID := auth.uid();
  _by_manager BOOLEAN;
  _code TEXT;
  _who TEXT;
  _what TEXT;
  _link TEXT;
BEGIN
  SELECT * INTO _r FROM public.build_requests WHERE id = _request_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  SELECT system_code INTO _code FROM public.system_templates WHERE id = _r.template_id;
  SELECT NULLIF(btrim(full_name), '') INTO _who FROM public.user_directory WHERE id = _actor;
  _by_manager := public.manages_project(_actor, _r.project_id);
  _what := _r.qty || ' × ' || COALESCE(_code, 'system') || ' for ' || _r.project_number;
  _link := '/manufacturing/' || _r.id::TEXT;

  IF _event = 'submitted' THEN
    INSERT INTO public.notifications (recipient_user_id, type, title, body, link)
    SELECT DISTINCT s.u, 'build_request_submitted', 'Build request ' || _r.request_number,
      COALESCE(_who, 'Someone') || ' submitted ' || _r.request_number || ': ' || _what || '.' || COALESCE(' ' || _detail, ''),
      _link
    FROM (
      SELECT user_id AS u FROM public.user_roles WHERE role IN ('warehouse_manager', 'admin')
      UNION SELECT project_manager_id FROM public.projects WHERE id = _r.project_id AND NOT _by_manager
      UNION SELECT user_id FROM public.project_managers WHERE project_id = _r.project_id AND NOT _by_manager
      UNION SELECT _r.requested_by WHERE NOT _by_manager
    ) s
    WHERE s.u IS NOT NULL AND s.u IS DISTINCT FROM _actor;

  ELSIF _event = 'pulled_back' THEN
    INSERT INTO public.notifications (recipient_user_id, type, title, body, link)
    SELECT DISTINCT ur.user_id, 'build_request_pulled_back', 'Build request pulled back',
      _r.request_number || ' (' || _what || ') was pulled back to draft. Its held parts were released.',
      _link
    FROM public.user_roles ur
    WHERE ur.role IN ('warehouse_manager', 'admin') AND ur.user_id IS DISTINCT FROM _actor;

  ELSIF _event = 'rejected' THEN
    INSERT INTO public.notifications (recipient_user_id, type, title, body, link)
    SELECT DISTINCT s.u, 'build_request_rejected', 'Build request rejected',
      _r.request_number || ' (' || _what || ') was rejected: ' || COALESCE(_r.reject_note, '') || ' Edit it and submit it again.',
      _link
    FROM (
      SELECT _r.requested_by AS u
      UNION SELECT project_manager_id FROM public.projects WHERE id = _r.project_id
      UNION SELECT user_id FROM public.project_managers WHERE project_id = _r.project_id
    ) s
    WHERE s.u IS NOT NULL AND s.u IS DISTINCT FROM _actor;

  ELSIF _event = 'parts_held' THEN
    INSERT INTO public.notifications (recipient_user_id, type, title, body, link)
    SELECT DISTINCT s.u, 'build_request_parts_held', 'Parts arrived for ' || _r.request_number,
      COALESCE(_detail, 'Parts arrived and were held for ' || _r.request_number || '.'),
      _link
    FROM (
      SELECT _r.requested_by AS u
      UNION SELECT project_manager_id FROM public.projects WHERE id = _r.project_id
      UNION SELECT user_id FROM public.project_managers WHERE project_id = _r.project_id
      UNION SELECT user_id FROM public.user_roles WHERE role IN ('warehouse_manager', 'admin')
    ) s
    WHERE s.u IS NOT NULL AND s.u IS DISTINCT FROM _actor;
  END IF;
END;
$$;

-- ---- Internal: give available stock of one part to waiting requests ----
CREATE OR REPLACE FUNCTION public.allocate_held_stock(_project_id UUID, _product_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _available NUMERIC;
  _l RECORD;
  _take NUMERIC;
  _part TEXT;
BEGIN
  -- Cheap exit for the common case: nothing is waiting on this part.
  IF NOT EXISTS (
    SELECT 1
    FROM public.build_request_lines l
    JOIN public.build_requests r ON r.id = l.request_id
    WHERE r.project_id = _project_id AND l.product_id = _product_id
      AND r.status IN ('submitted', 'in_progress', 'partially_built')
      AND l.qty_held < l.qty_required
  ) THEN
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('stock:' || _project_id::TEXT || ':' || _product_id::TEXT, 0));

  SELECT COALESCE(SUM(delta), 0) - public.held_stock_qty(_project_id, _product_id) INTO _available
  FROM public.inventory_adjustments
  WHERE project_id = _project_id AND product_id = _product_id;
  IF _available <= 0 THEN
    RETURN;
  END IF;

  SELECT part_number INTO _part FROM public.products WHERE id = _product_id;

  FOR _l IN
    SELECT l.id, l.request_id, l.qty_required - l.qty_held AS pending, r.request_number, r.project_number
    FROM public.build_request_lines l
    JOIN public.build_requests r ON r.id = l.request_id
    WHERE r.project_id = _project_id AND l.product_id = _product_id
      AND r.status IN ('submitted', 'in_progress', 'partially_built')
      AND l.qty_held < l.qty_required
    ORDER BY r.submitted_at NULLS LAST, r.request_sequence
    FOR UPDATE OF l
  LOOP
    EXIT WHEN _available <= 0;
    _take := LEAST(_l.pending, _available);
    UPDATE public.build_request_lines SET qty_held = qty_held + _take WHERE id = _l.id;
    _available := _available - _take;

    INSERT INTO public.build_request_events (request_id, kind, payload, actor)
    VALUES (_l.request_id, 'parts_held',
      jsonb_build_object('part_number', _part, 'qty', _take, 'still_pending', _l.pending - _take), auth.uid());

    PERFORM public.notify_build_request(_l.request_id, 'parts_held',
      trim_scale(_take) || ' × ' || COALESCE(_part, 'part') || ' arrived in ' || _l.project_number
        || ' and was held for ' || _l.request_number
        || CASE WHEN _l.pending - _take > 0
             THEN ' (' || trim_scale(_l.pending - _take) || ' still pending).'
             ELSE '. Nothing of this part is pending now.' END);
  END LOOP;
END;
$$;

-- ---- Stock arriving from anywhere is offered to waiting requests ----
CREATE OR REPLACE FUNCTION public.allocate_arriving_stock()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.delta > 0 THEN
    PERFORM public.allocate_held_stock(NEW.project_id, NEW.product_id);
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_inventory_adjustments_allocate
AFTER INSERT ON public.inventory_adjustments
FOR EACH ROW EXECUTE FUNCTION public.allocate_arriving_stock();

-- ---- Internal: drop a request's unconsumed holds and pass the stock on ----
-- Call only after the request has left the open statuses.
CREATE OR REPLACE FUNCTION public.release_build_holds(_request_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _project UUID;
  _p UUID;
BEGIN
  SELECT project_id INTO _project FROM public.build_requests WHERE id = _request_id;
  UPDATE public.build_request_lines SET qty_held = qty_consumed WHERE request_id = _request_id;
  FOR _p IN SELECT product_id FROM public.build_request_lines WHERE request_id = _request_id ORDER BY product_id LOOP
    PERFORM public.allocate_held_stock(_project, _p);
  END LOOP;
END;
$$;

-- ---- Internal: validate and (re)write a request's parts list ----
-- _lines: [{product_id, qty_per_unit, notes?}]. Key-part flag and origin
-- (template / changed / added) are derived from the system, never trusted
-- from the client. Returns {removed: [part numbers left out of the system's list]}.
CREATE OR REPLACE FUNCTION public.build_request_write_lines(_request_id UUID, _template_id UUID, _qty INTEGER, _lines JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _line JSONB;
  _idx BIGINT;
  _product UUID;
  _pn TEXT;
  _per NUMERIC;
  _tp public.system_template_parts;
  _finished UUID;
  _seen UUID[] := '{}';
  _missing TEXT;
  _removed JSONB;
BEGIN
  IF _lines IS NULL OR jsonb_typeof(_lines) <> 'array' OR jsonb_array_length(_lines) = 0 THEN
    RAISE EXCEPTION 'Add at least one part';
  END IF;

  SELECT finished_product_id INTO _finished FROM public.system_templates WHERE id = _template_id;
  DELETE FROM public.build_request_lines WHERE request_id = _request_id;

  FOR _line, _idx IN
    SELECT e.value, e.ordinality FROM jsonb_array_elements(_lines) WITH ORDINALITY AS e(value, ordinality)
  LOOP
    _product := NULLIF(_line->>'product_id', '')::UUID;
    IF _product IS NULL THEN
      RAISE EXCEPTION 'Part %: pick a product', _idx;
    END IF;
    SELECT part_number INTO _pn FROM public.products WHERE id = _product;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Part %: that product no longer exists', _idx;
    END IF;
    IF _product = _finished THEN
      RAISE EXCEPTION '%: a system can''t be built from itself', _pn;
    END IF;
    IF _product = ANY (_seen) THEN
      RAISE EXCEPTION '% is listed twice. Raise its quantity instead.', _pn;
    END IF;
    _seen := _seen || _product;

    IF jsonb_typeof(_line->'qty_per_unit') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION '%: enter a quantity per unit', _pn;
    END IF;
    _per := (_line->>'qty_per_unit')::NUMERIC;
    IF _per <= 0 OR _per <> round(_per, 2) THEN
      RAISE EXCEPTION '%: quantity per unit must be above 0, with at most 2 decimals', _pn;
    END IF;

    SELECT * INTO _tp FROM public.system_template_parts WHERE template_id = _template_id AND product_id = _product;

    INSERT INTO public.build_request_lines (request_id, line_no, product_id, qty_per_unit, qty_required, is_key_part, origin, notes)
    VALUES (
      _request_id, _idx, _product, _per, _per * _qty,
      COALESCE(_tp.is_key_part, false),
      CASE WHEN _tp.id IS NULL THEN 'added' WHEN _tp.qty_per_system = _per THEN 'template' ELSE 'changed' END,
      NULLIF(btrim(COALESCE(_line->>'notes', '')), '')
    );
  END LOOP;

  -- The 80% rule relies on key parts, so they can't be dropped.
  SELECT string_agg(p.part_number, ', ' ORDER BY tp.line_no) INTO _missing
  FROM public.system_template_parts tp
  JOIN public.products p ON p.id = tp.product_id
  WHERE tp.template_id = _template_id AND tp.is_key_part AND NOT (tp.product_id = ANY (_seen));
  IF _missing IS NOT NULL THEN
    RAISE EXCEPTION 'Key parts can''t be removed from a build request: %', _missing;
  END IF;

  SELECT COALESCE(jsonb_agg(p.part_number ORDER BY tp.line_no), '[]'::JSONB) INTO _removed
  FROM public.system_template_parts tp
  JOIN public.products p ON p.id = tp.product_id
  WHERE tp.template_id = _template_id AND NOT (tp.product_id = ANY (_seen));

  RETURN jsonb_build_object('removed', _removed);
END;
$$;

-- ---- RPC: create a draft ----
-- Numbered per project: MFG-<mkj_number>-<3-digit seq>, minted with the
-- project row locked, like create_po_request.
CREATE OR REPLACE FUNCTION public.create_build_request(_project_id UUID, _template_id UUID, _qty INTEGER, _notes TEXT, _lines JSONB)
RETURNS public.build_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _mkj TEXT;
  _pstatus public.project_status;
  _t public.system_templates;
  _seq INTEGER;
  _req public.build_requests;
  _summary JSONB;
BEGIN
  IF NOT public.can_request_build(auth.uid(), _project_id) THEN
    RAISE EXCEPTION 'Only this project''s managers, warehouse managers and admins can request a build for it';
  END IF;
  IF _qty IS NULL OR _qty < 1 THEN
    RAISE EXCEPTION 'Units to build must be at least 1';
  END IF;

  SELECT mkj_number, status INTO _mkj, _pstatus FROM public.projects WHERE id = _project_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Project not found';
  END IF;
  IF _pstatus <> 'active' THEN
    RAISE EXCEPTION 'Project % isn''t active', _mkj;
  END IF;

  SELECT * INTO _t FROM public.system_templates WHERE id = _template_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'System not found';
  END IF;
  IF NOT _t.active THEN
    RAISE EXCEPTION 'System % is inactive', _t.system_code;
  END IF;

  SELECT COALESCE(MAX(request_sequence), 0) + 1 INTO _seq FROM public.build_requests WHERE project_id = _project_id;

  INSERT INTO public.build_requests (request_number, project_id, project_number, request_sequence, template_id, qty, notes, requested_by)
  VALUES ('MFG-' || _mkj || '-' || LPAD(_seq::TEXT, 3, '0'), _project_id, _mkj, _seq, _template_id, _qty,
          NULLIF(btrim(COALESCE(_notes, '')), ''), auth.uid())
  RETURNING * INTO _req;

  _summary := public.build_request_write_lines(_req.id, _template_id, _qty, _lines);
  INSERT INTO public.build_request_events (request_id, kind, payload, actor) VALUES (_req.id, 'created', _summary, auth.uid());
  RETURN _req;
END;
$$;

-- ---- RPC: edit a draft or rejected request (a rejected one returns to draft) ----
CREATE OR REPLACE FUNCTION public.update_build_request(_request_id UUID, _qty INTEGER, _notes TEXT, _lines JSONB)
RETURNS public.build_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _req public.build_requests;
  _was public.build_status;
  _summary JSONB;
BEGIN
  SELECT * INTO _req FROM public.build_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Build request not found';
  END IF;
  IF NOT public.can_request_build(auth.uid(), _req.project_id) THEN
    RAISE EXCEPTION 'Not permitted to edit this build request';
  END IF;
  IF _req.status NOT IN ('draft', 'rejected') THEN
    RAISE EXCEPTION '% is % and can''t be edited. Pull it back to draft first.', _req.request_number, replace(_req.status::TEXT, '_', ' ');
  END IF;
  IF _qty IS NULL OR _qty < 1 THEN
    RAISE EXCEPTION 'Units to build must be at least 1';
  END IF;

  _was := _req.status;
  UPDATE public.build_requests
  SET qty = _qty, notes = NULLIF(btrim(COALESCE(_notes, '')), ''), status = 'draft'
  WHERE id = _request_id
  RETURNING * INTO _req;

  _summary := public.build_request_write_lines(_request_id, _req.template_id, _qty, _lines);
  INSERT INTO public.build_request_events (request_id, kind, payload, actor)
  VALUES (_request_id, 'edited', _summary || jsonb_build_object('from_status', _was), auth.uid());
  RETURN _req;
END;
$$;

-- ---- RPC: submit (hold what's available; 80% of parts + every key part) ----
-- Returns {covered, total, pending: [{part_number, pending}]}.
CREATE OR REPLACE FUNCTION public.submit_build_request(_request_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _r public.build_requests;
  _l RECORD;
  _avail NUMERIC;
  _take NUMERIC;
  _total INTEGER := 0;
  _covered INTEGER := 0;
  _key_short TEXT[] := '{}';
  _pending JSONB := '[]'::JSONB;
  _pct TEXT;
  _detail TEXT;
BEGIN
  SELECT * INTO _r FROM public.build_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Build request not found';
  END IF;
  IF NOT public.can_request_build(auth.uid(), _r.project_id) THEN
    RAISE EXCEPTION 'Not permitted to submit this build request';
  END IF;
  IF _r.status NOT IN ('draft', 'rejected') THEN
    RAISE EXCEPTION '% is already %', _r.request_number, replace(_r.status::TEXT, '_', ' ');
  END IF;

  -- product_id order keeps lock acquisition consistent between concurrent submits.
  FOR _l IN
    SELECT l.id, l.product_id, l.qty_required, l.is_key_part, p.part_number
    FROM public.build_request_lines l
    JOIN public.products p ON p.id = l.product_id
    WHERE l.request_id = _request_id
    ORDER BY l.product_id
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('stock:' || _r.project_id::TEXT || ':' || _l.product_id::TEXT, 0));
    SELECT COALESCE(SUM(delta), 0) INTO _avail
    FROM public.inventory_adjustments
    WHERE project_id = _r.project_id AND product_id = _l.product_id;
    _avail := _avail - public.held_stock_qty(_r.project_id, _l.product_id);
    _take := LEAST(_l.qty_required, GREATEST(_avail, 0));

    UPDATE public.build_request_lines SET qty_held = _take, qty_consumed = 0 WHERE id = _l.id;

    _total := _total + 1;
    IF _take >= _l.qty_required THEN
      _covered := _covered + 1;
    ELSE
      _pending := _pending || jsonb_build_object('part_number', _l.part_number, 'pending', _l.qty_required - _take);
      IF _l.is_key_part THEN
        _key_short := _key_short || _l.part_number;
      END IF;
    END IF;
  END LOOP;

  -- Any failure below rolls back the holds taken above.
  IF _total = 0 THEN
    RAISE EXCEPTION 'Add at least one part before submitting';
  END IF;
  IF array_length(_key_short, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'Can''t submit yet: key parts must be fully in stock. Short on %.', array_to_string(_key_short, ', ');
  END IF;
  IF _covered * 5 < _total * 4 THEN
    _pct := floor(_covered * 100.0 / _total)::TEXT || '%';
    RAISE EXCEPTION 'Can''t submit yet: only % of % parts (%) can be fully held right now. At least 80%% are needed.', _covered, _total, _pct;
  END IF;

  UPDATE public.build_requests
  SET status = 'submitted', submitted_at = now(), submitted_by = auth.uid()
  WHERE id = _request_id;

  INSERT INTO public.build_request_events (request_id, kind, payload, actor)
  VALUES (_request_id, 'submitted', jsonb_build_object('covered', _covered, 'total', _total, 'pending', _pending), auth.uid());

  _detail := _covered || ' of ' || _total || ' parts are held'
    || CASE WHEN _total > _covered THEN '; ' || (_total - _covered) || ' pending until stock arrives.' ELSE '.' END;
  PERFORM public.notify_build_request(_request_id, 'submitted', _detail);

  RETURN jsonb_build_object('covered', _covered, 'total', _total, 'pending', _pending);
END;
$$;

-- ---- RPC: pull a submitted request back to draft (requester side) ----
CREATE OR REPLACE FUNCTION public.pull_back_build_request(_request_id UUID)
RETURNS public.build_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _r public.build_requests;
BEGIN
  SELECT * INTO _r FROM public.build_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Build request not found';
  END IF;
  IF NOT public.can_request_build(auth.uid(), _r.project_id) THEN
    RAISE EXCEPTION 'Not permitted to pull back this build request';
  END IF;
  IF _r.status <> 'submitted' THEN
    RAISE EXCEPTION 'Only a submitted request can be pulled back. % is %.', _r.request_number, replace(_r.status::TEXT, '_', ' ');
  END IF;

  UPDATE public.build_requests SET status = 'draft', submitted_at = NULL, submitted_by = NULL
  WHERE id = _request_id
  RETURNING * INTO _r;

  PERFORM public.release_build_holds(_request_id);
  INSERT INTO public.build_request_events (request_id, kind, actor) VALUES (_request_id, 'pulled_back', auth.uid());
  PERFORM public.notify_build_request(_request_id, 'pulled_back');
  RETURN _r;
END;
$$;

-- ---- RPC: reject a submitted request (warehouse/admin, reason required) ----
CREATE OR REPLACE FUNCTION public.reject_build_request(_request_id UUID, _note TEXT)
RETURNS public.build_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _r public.build_requests;
BEGIN
  IF NOT public.is_warehouse_or_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only warehouse managers and admins can reject build requests';
  END IF;
  IF NULLIF(btrim(COALESCE(_note, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Give a reason for rejecting';
  END IF;

  SELECT * INTO _r FROM public.build_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Build request not found';
  END IF;
  IF _r.status <> 'submitted' THEN
    RAISE EXCEPTION 'Only a submitted request can be rejected. % is %.', _r.request_number, replace(_r.status::TEXT, '_', ' ');
  END IF;

  UPDATE public.build_requests
  SET status = 'rejected', rejected_at = now(), rejected_by = auth.uid(), reject_note = btrim(_note),
      submitted_at = NULL, submitted_by = NULL
  WHERE id = _request_id
  RETURNING * INTO _r;

  PERFORM public.release_build_holds(_request_id);
  INSERT INTO public.build_request_events (request_id, kind, note, actor) VALUES (_request_id, 'rejected', btrim(_note), auth.uid());
  PERFORM public.notify_build_request(_request_id, 'rejected');
  RETURN _r;
END;
$$;

-- ---- Function privileges ----
REVOKE ALL ON FUNCTION public.notify_build_request(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.allocate_held_stock(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.allocate_arriving_stock() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_build_holds(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.build_request_write_lines(UUID, UUID, INTEGER, JSONB) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.can_request_build(UUID, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_build_request(UUID, UUID, INTEGER, TEXT, JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_build_request(UUID, INTEGER, TEXT, JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.submit_build_request(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pull_back_build_request(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reject_build_request(UUID, TEXT) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.can_request_build(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_build_request(UUID, UUID, INTEGER, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_build_request(UUID, INTEGER, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_build_request(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pull_back_build_request(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_build_request(UUID, TEXT) TO authenticated;

COMMIT;
