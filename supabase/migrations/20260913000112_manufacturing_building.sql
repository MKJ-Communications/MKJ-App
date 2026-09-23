-- ============ MANUFACTURING, PHASE 4: BUILDING ============
-- The warehouse side of a build request, after phase 3's submit/hold flow:
--
--   submitted --start--> in_progress --complete--> completed
--                        in_progress --mark partially built--> partially_built --complete--> completed
--                        in_progress --cancel (reason)--> cancelled
--   (install arrived parts: in_progress or partially_built, any number of times)
--
-- Warehouse managers and admins run the build. Cancel is also open to the
-- project's managers (can_request_build). Partially built can't be cancelled:
-- the units physically exist, so it can only move forward to Completed.
--
-- Using parts (start / install) goes through build_request_consume():
--   * every held-but-unused part is taken out of stock;
--   * each serial-tracked unit needs exactly one serial. A serial on hand at
--     the project is used as-is; one the system has never seen (stock received
--     before serial tracking) is accepted and flagged entered_manually; one
--     that is shipped, inside another build, or at another project is refused;
--   * qty_consumed is updated BEFORE the manufacturing_consume ledger row is
--     inserted, so guard_held_stock sees the hold released first.
--
-- Completing creates the unit IDs in build_units (<mkj_number>-<system_code>-<seq>,
-- seq per project + system across requests, at least 3 digits) and adds the
-- finished product to stock (manufacturing_output). v_project_serials now
-- lists those unit IDs as serials of the finished product, so the existing
-- shipping-ticket serial picker offers them; serials used inside a build show
-- as 'in_system', so they can't be shipped or borrowed.
--
-- Cancelling returns every used part (manufacturing_return) and serial
-- (returned_at), releases what was held but unused, and hands the freed stock
-- to other waiting builds (the allocation trigger, plus allocate_held_stock).
--
-- Also here:
--   * the warehouse can change a SUBMITTED request's parts list
--     (update_build_request): holds are recalculated, the 80% rule is checked
--     again, and the requester side is notified ('lines_changed');
--   * submit/update share build_request_take_holds + build_request_assert_rule;
--   * notify_build_request covers every event, with recipients from
--     build_request_audience().

BEGIN;

-- ---- Internal: who hears about a request ----
-- requester_side = the requester + the project's managers; warehouse =
-- warehouse managers + admins; everyone = both.
CREATE OR REPLACE FUNCTION public.build_request_audience(_r public.build_requests, _audience TEXT)
RETURNS SETOF UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT _r.requested_by WHERE _audience IN ('requester_side', 'everyone')
  UNION SELECT p.project_manager_id FROM public.projects p WHERE p.id = _r.project_id AND _audience IN ('requester_side', 'everyone')
  UNION SELECT pm.user_id FROM public.project_managers pm WHERE pm.project_id = _r.project_id AND _audience IN ('requester_side', 'everyone')
  UNION SELECT ur.user_id FROM public.user_roles ur WHERE ur.role IN ('warehouse_manager', 'admin') AND _audience IN ('warehouse', 'everyone')
$$;

-- ---- Internal: notifications for every request event (replaces phase 3's) ----
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
  _title TEXT;
  _body TEXT;
  _audience TEXT;
BEGIN
  SELECT * INTO _r FROM public.build_requests WHERE id = _request_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  SELECT system_code INTO _code FROM public.system_templates WHERE id = _r.template_id;
  SELECT NULLIF(btrim(full_name), '') INTO _who FROM public.user_directory WHERE id = _actor;
  _by_manager := public.manages_project(_actor, _r.project_id);
  _what := _r.qty || ' × ' || COALESCE(_code, 'system') || ' for ' || _r.project_number;

  CASE _event
    WHEN 'submitted' THEN
      _title := 'Build request ' || _r.request_number;
      _body := COALESCE(_who, 'Someone') || ' submitted ' || _r.request_number || ': ' || _what || '.' || COALESCE(' ' || _detail, '');
      _audience := CASE WHEN _by_manager THEN 'warehouse' ELSE 'everyone' END;
    WHEN 'pulled_back' THEN
      _title := 'Build request pulled back';
      _body := _r.request_number || ' (' || _what || ') was pulled back to draft. Its held parts were released.';
      _audience := 'warehouse';
    WHEN 'rejected' THEN
      _title := 'Build request rejected';
      _body := _r.request_number || ' (' || _what || ') was rejected: ' || COALESCE(_r.reject_note, '') || ' Edit it and submit it again.';
      _audience := 'requester_side';
    WHEN 'parts_held' THEN
      _title := 'Parts arrived for ' || _r.request_number;
      _body := COALESCE(_detail, 'Parts arrived and were held for ' || _r.request_number || '.');
      _audience := 'everyone';
    WHEN 'lines_changed' THEN
      _title := 'Parts list changed for ' || _r.request_number;
      _body := COALESCE(_who, 'The warehouse') || ' changed the parts list of ' || _r.request_number || ' (' || _what || ').' || COALESCE(' ' || _detail, '');
      _audience := 'requester_side';
    WHEN 'started' THEN
      _title := 'Build started: ' || _r.request_number;
      _body := 'The shop started building ' || _r.request_number || ' (' || _what || ').' || COALESCE(' ' || _detail, '');
      _audience := 'requester_side';
    WHEN 'partially_built' THEN
      _title := _r.request_number || ' is built, waiting on parts';
      _body := _r.request_number || ' (' || _what || ') is built but still needs ' || COALESCE(_detail, 'parts')
        || '. The units go into stock once those are installed.';
      _audience := 'requester_side';
    WHEN 'completed' THEN
      _title := _r.request_number || ' is complete';
      _body := _r.request_number || ' (' || _what || ') is complete. Now in stock: ' || COALESCE(_detail, '') || '.';
      _audience := 'requester_side';
    WHEN 'cancelled' THEN
      _title := 'Build cancelled: ' || _r.request_number;
      _body := _r.request_number || ' (' || _what || ') was cancelled: ' || COALESCE(_r.cancel_reason, '') || ' Its parts went back to stock.';
      _audience := CASE WHEN _by_manager THEN 'warehouse' ELSE 'requester_side' END;
    ELSE
      RETURN;
  END CASE;

  INSERT INTO public.notifications (recipient_user_id, type, title, body, link)
  SELECT DISTINCT u, 'build_request_' || _event, _title, _body, '/manufacturing/' || _r.id::TEXT
  FROM public.build_request_audience(_r, _audience) u
  WHERE u IS NOT NULL AND u IS DISTINCT FROM _actor;
END;
$$;

-- ---- Internal: "2 × P4-E, 1 × SW-16P-POE" — what's not installed yet ----
CREATE OR REPLACE FUNCTION public.build_request_pending_text(_request_id UUID)
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT string_agg(trim_scale(l.qty_required - l.qty_consumed) || ' × ' || p.part_number, ', ' ORDER BY l.line_no)
  FROM public.build_request_lines l
  JOIN public.products p ON p.id = l.product_id
  WHERE l.request_id = _request_id AND l.qty_consumed < l.qty_required
$$;

-- ---- Internal: hold what's available for every line (no rule check) ----
-- A request that is already open counts its own current holds as available
-- to itself, so recalculating never loses stock it had.
CREATE OR REPLACE FUNCTION public.build_request_take_holds(_request_id UUID)
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
  _key_short JSONB := '[]'::JSONB;
  _pending JSONB := '[]'::JSONB;
BEGIN
  SELECT * INTO _r FROM public.build_requests WHERE id = _request_id;

  FOR _l IN
    SELECT l.id, l.product_id, l.qty_required, l.qty_held, l.qty_consumed, l.is_key_part, p.part_number
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
    IF _r.status IN ('submitted', 'in_progress', 'partially_built') THEN
      _avail := _avail + (_l.qty_held - _l.qty_consumed);
    END IF;
    _take := LEAST(_l.qty_required, GREATEST(_avail, 0));

    UPDATE public.build_request_lines SET qty_held = _take WHERE id = _l.id;

    _total := _total + 1;
    IF _take >= _l.qty_required THEN
      _covered := _covered + 1;
    ELSE
      _pending := _pending || jsonb_build_object('part_number', _l.part_number, 'pending', _l.qty_required - _take);
      IF _l.is_key_part THEN
        _key_short := _key_short || to_jsonb(_l.part_number);
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('covered', _covered, 'total', _total, 'pending', _pending, 'key_short', _key_short);
END;
$$;

-- ---- Internal: the submit rule. Raising rolls back the holds just taken. ----
CREATE OR REPLACE FUNCTION public.build_request_assert_rule(_res JSONB)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  _total INTEGER := COALESCE((_res->>'total')::INTEGER, 0);
  _covered INTEGER := COALESCE((_res->>'covered')::INTEGER, 0);
  _short TEXT;
BEGIN
  IF _total = 0 THEN
    RAISE EXCEPTION 'Add at least one part';
  END IF;
  SELECT string_agg(value, ', ') INTO _short FROM jsonb_array_elements_text(COALESCE(_res->'key_short', '[]'::JSONB));
  IF _short IS NOT NULL THEN
    RAISE EXCEPTION 'Key parts must be fully in stock. Short on %.', _short;
  END IF;
  IF _covered * 5 < _total * 4 THEN
    RAISE EXCEPTION 'Only % of % parts (%) can be fully held right now. At least 80%% are needed.',
      _covered, _total, floor(_covered * 100.0 / _total)::TEXT || '%';
  END IF;
END;
$$;

-- ---- RPC: submit (same behavior as phase 3, now on the shared helpers) ----
CREATE OR REPLACE FUNCTION public.submit_build_request(_request_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _r public.build_requests;
  _res JSONB;
  _covered INTEGER;
  _total INTEGER;
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

  _res := public.build_request_take_holds(_request_id);
  PERFORM public.build_request_assert_rule(_res);
  _res := _res - 'key_short';
  _covered := (_res->>'covered')::INTEGER;
  _total := (_res->>'total')::INTEGER;

  UPDATE public.build_requests
  SET status = 'submitted', submitted_at = now(), submitted_by = auth.uid()
  WHERE id = _request_id;

  INSERT INTO public.build_request_events (request_id, kind, payload, actor) VALUES (_request_id, 'submitted', _res, auth.uid());
  PERFORM public.notify_build_request(_request_id, 'submitted',
    _covered || ' of ' || _total || ' parts are held'
      || CASE WHEN _total > _covered THEN '; ' || (_total - _covered) || ' pending until stock arrives.' ELSE '.' END);
  RETURN _res;
END;
$$;

-- ---- RPC: edit. Drafts/rejected by the requester side; submitted by the warehouse ----
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
  _res JSONB;
  _old UUID[];
  _p UUID;
BEGIN
  SELECT * INTO _req FROM public.build_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Build request not found';
  END IF;
  IF NOT public.can_request_build(auth.uid(), _req.project_id) THEN
    RAISE EXCEPTION 'Not permitted to edit this build request';
  END IF;
  IF _req.status = 'submitted' THEN
    IF NOT public.is_warehouse_or_admin(auth.uid()) THEN
      RAISE EXCEPTION '% is submitted. Pull it back to draft to edit it, or ask the warehouse to change it.', _req.request_number;
    END IF;
  ELSIF _req.status NOT IN ('draft', 'rejected') THEN
    RAISE EXCEPTION '% is % and can''t be edited.', _req.request_number, replace(_req.status::TEXT, '_', ' ');
  END IF;
  IF _qty IS NULL OR _qty < 1 THEN
    RAISE EXCEPTION 'Units to build must be at least 1';
  END IF;

  _was := _req.status;
  SELECT COALESCE(array_agg(product_id), '{}') INTO _old FROM public.build_request_lines WHERE request_id = _request_id;

  UPDATE public.build_requests
  SET qty = _qty,
      notes = NULLIF(btrim(COALESCE(_notes, '')), ''),
      status = CASE WHEN _was = 'submitted' THEN 'submitted'::public.build_status ELSE 'draft'::public.build_status END
  WHERE id = _request_id
  RETURNING * INTO _req;

  _summary := public.build_request_write_lines(_request_id, _req.template_id, _qty, _lines);

  IF _was = 'submitted' THEN
    -- Re-hold for the new list (the rule still applies), then offer anything
    -- this request no longer needs to other waiting builds.
    _res := public.build_request_take_holds(_request_id);
    PERFORM public.build_request_assert_rule(_res);
    FOREACH _p IN ARRAY _old LOOP
      PERFORM public.allocate_held_stock(_req.project_id, _p);
    END LOOP;
    _summary := _summary || jsonb_build_object('covered', _res->'covered', 'total', _res->'total');
  END IF;

  INSERT INTO public.build_request_events (request_id, kind, payload, actor)
  VALUES (_request_id, 'edited', _summary || jsonb_build_object('from_status', _was), auth.uid());

  IF _was = 'submitted' THEN
    PERFORM public.notify_build_request(_request_id, 'lines_changed',
      (_res->>'covered') || ' of ' || (_res->>'total') || ' parts are held.');
  END IF;
  RETURN _req;
END;
$$;

-- ---- Internal: use every held-but-unused part, recording serials ----
-- _serials: [{product_id, serial}]. Returns {used: [{part_number, qty}]}.
CREATE OR REPLACE FUNCTION public.build_request_consume(_request_id UUID, _serials JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _r public.build_requests;
  _l RECORD;
  _given TEXT[];
  _s TEXT;
  _loc RECORD;
  _manual BOOLEAN;
  _used JSONB := '[]'::JSONB;
  _actor UUID := auth.uid();
  _using UUID[] := '{}';
  _bad TEXT;
BEGIN
  SELECT * INTO _r FROM public.build_requests WHERE id = _request_id;
  IF _serials IS NULL OR jsonb_typeof(_serials) <> 'array' THEN
    _serials := '[]'::JSONB;
  END IF;

  SELECT string_agg(DISTINCT x.serial, ', ') INTO _bad
  FROM (
    SELECT btrim(e->>'serial') AS serial,
           count(*) OVER (PARTITION BY e->>'product_id', upper(btrim(e->>'serial'))) AS n
    FROM jsonb_array_elements(_serials) e
    WHERE btrim(COALESCE(e->>'serial', '')) <> ''
  ) x
  WHERE x.n > 1;
  IF _bad IS NOT NULL THEN
    RAISE EXCEPTION 'Serial % is listed more than once', _bad;
  END IF;

  FOR _l IN
    SELECT l.id, l.product_id, l.qty_held - l.qty_consumed AS q, p.part_number, p.is_serialized
    FROM public.build_request_lines l
    JOIN public.products p ON p.id = l.product_id
    WHERE l.request_id = _request_id AND l.qty_held > l.qty_consumed
    ORDER BY l.line_no
    FOR UPDATE OF l
  LOOP
    _using := _using || _l.product_id;
    SELECT COALESCE(array_agg(btrim(e->>'serial')), '{}') INTO _given
    FROM jsonb_array_elements(_serials) e
    WHERE e->>'product_id' = _l.product_id::TEXT AND btrim(COALESCE(e->>'serial', '')) <> '';

    IF _l.is_serialized THEN
      IF _l.q <> trunc(_l.q) THEN
        RAISE EXCEPTION '%: % can''t be split into serial-numbered units', _l.part_number, trim_scale(_l.q);
      END IF;
      IF COALESCE(array_length(_given, 1), 0) <> _l.q THEN
        RAISE EXCEPTION '%: record % serial number(s), one for each unit used (got %).',
          _l.part_number, trim_scale(_l.q), COALESCE(array_length(_given, 1), 0);
      END IF;
      FOREACH _s IN ARRAY _given LOOP
        -- Where does the system think this unit is? Prefer "on hand here".
        SELECT project_id, status INTO _loc
        FROM public.v_project_serials
        WHERE product_id = _l.product_id AND upper(serial) = upper(_s)
        ORDER BY (project_id = _r.project_id AND status = 'in_stock') DESC
        LIMIT 1;
        IF NOT FOUND THEN
          _manual := true;
        ELSIF _loc.status = 'in_stock' AND _loc.project_id = _r.project_id THEN
          _manual := false;
        ELSIF _loc.status = 'in_system' THEN
          RAISE EXCEPTION 'Serial "%" of % is already inside another build', _s, _l.part_number;
        ELSIF _loc.status = 'shipped' THEN
          RAISE EXCEPTION 'Serial "%" of % was already shipped', _s, _l.part_number;
        ELSE
          RAISE EXCEPTION 'Serial "%" of % is recorded at another project, not %', _s, _l.part_number, _r.project_number;
        END IF;

        INSERT INTO public.build_line_serials (line_id, product_id, serial, entered_manually, consumed_by)
        VALUES (_l.id, _l.product_id, _s, _manual, _actor);
      END LOOP;
    ELSIF COALESCE(array_length(_given, 1), 0) > 0 THEN
      RAISE EXCEPTION '% isn''t serial-tracked, so it doesn''t take serial numbers', _l.part_number;
    END IF;

    -- Mark used BEFORE the stock leaves, so guard_held_stock sees no hold on it.
    UPDATE public.build_request_lines SET qty_consumed = qty_held WHERE id = _l.id;
    INSERT INTO public.inventory_adjustments (project_id, product_id, delta, source_type, source_id, reason, created_by)
    VALUES (_r.project_id, _l.product_id, -_l.q, 'manufacturing_consume', _request_id, 'Used in ' || _r.request_number, _actor);

    _used := _used || jsonb_build_object('part_number', _l.part_number, 'qty', _l.q);
  END LOOP;

  SELECT string_agg(DISTINCT btrim(e->>'serial'), ', ') INTO _bad
  FROM jsonb_array_elements(_serials) e
  WHERE btrim(COALESCE(e->>'serial', '')) <> ''
    AND NOT (COALESCE(e->>'product_id', '') = ANY (SELECT u::TEXT FROM unnest(_using) u));
  IF _bad IS NOT NULL THEN
    RAISE EXCEPTION 'Serial numbers were given for parts that aren''t being used now: %', _bad;
  END IF;

  RETURN jsonb_build_object('used', _used);
END;
$$;

-- ---- RPC: start the build (warehouse/admin) ----
CREATE OR REPLACE FUNCTION public.start_build_request(_request_id UUID, _serials JSONB DEFAULT '[]'::JSONB)
RETURNS public.build_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _r public.build_requests;
  _res JSONB;
  _pending TEXT;
BEGIN
  IF NOT public.is_warehouse_or_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only warehouse managers and admins can start a build';
  END IF;
  SELECT * INTO _r FROM public.build_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Build request not found';
  END IF;
  IF _r.status <> 'submitted' THEN
    RAISE EXCEPTION 'Only a submitted request can be started. % is %.', _r.request_number, replace(_r.status::TEXT, '_', ' ');
  END IF;

  _res := public.build_request_consume(_request_id, _serials);

  UPDATE public.build_requests SET status = 'in_progress', started_at = now(), started_by = auth.uid()
  WHERE id = _request_id
  RETURNING * INTO _r;

  _pending := public.build_request_pending_text(_request_id);
  INSERT INTO public.build_request_events (request_id, kind, payload, actor)
  VALUES (_request_id, 'started', _res || jsonb_build_object('pending', _pending), auth.uid());
  PERFORM public.notify_build_request(_request_id, 'started',
    CASE WHEN _pending IS NULL THEN 'Every part is in; nothing is pending.' ELSE 'Still pending: ' || _pending || '.' END);
  RETURN _r;
END;
$$;

-- ---- RPC: install parts that arrived after the start (warehouse/admin) ----
CREATE OR REPLACE FUNCTION public.install_build_parts(_request_id UUID, _serials JSONB DEFAULT '[]'::JSONB)
RETURNS public.build_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _r public.build_requests;
  _res JSONB;
BEGIN
  IF NOT public.is_warehouse_or_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only warehouse managers and admins can install parts';
  END IF;
  SELECT * INTO _r FROM public.build_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Build request not found';
  END IF;
  IF _r.status NOT IN ('in_progress', 'partially_built') THEN
    RAISE EXCEPTION 'Parts can only be installed on a build that''s in progress or partially built. % is %.',
      _r.request_number, replace(_r.status::TEXT, '_', ' ');
  END IF;

  _res := public.build_request_consume(_request_id, _serials);
  IF jsonb_array_length(_res->'used') = 0 THEN
    RAISE EXCEPTION 'No arrived parts are waiting to be installed.';
  END IF;

  INSERT INTO public.build_request_events (request_id, kind, payload, actor)
  VALUES (_request_id, 'parts_installed', _res || jsonb_build_object('pending', public.build_request_pending_text(_request_id)), auth.uid());
  RETURN _r;
END;
$$;

-- ---- RPC: units assembled, parts still pending (warehouse/admin) ----
CREATE OR REPLACE FUNCTION public.mark_build_partially_built(_request_id UUID)
RETURNS public.build_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _r public.build_requests;
  _pending TEXT;
BEGIN
  IF NOT public.is_warehouse_or_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only warehouse managers and admins can update a build';
  END IF;
  SELECT * INTO _r FROM public.build_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Build request not found';
  END IF;
  IF _r.status <> 'in_progress' THEN
    RAISE EXCEPTION 'Only a build that''s in progress can be marked partially built. % is %.', _r.request_number, replace(_r.status::TEXT, '_', ' ');
  END IF;

  _pending := public.build_request_pending_text(_request_id);
  IF _pending IS NULL THEN
    RAISE EXCEPTION 'Nothing is pending. Complete the build instead.';
  END IF;

  UPDATE public.build_requests SET status = 'partially_built' WHERE id = _request_id RETURNING * INTO _r;
  INSERT INTO public.build_request_events (request_id, kind, payload, actor)
  VALUES (_request_id, 'partially_built', jsonb_build_object('pending', _pending), auth.uid());
  PERFORM public.notify_build_request(_request_id, 'partially_built', _pending);
  RETURN _r;
END;
$$;

-- ---- RPC: complete; finished units go into stock with their IDs (warehouse/admin) ----
-- Returns {unit_ids: [...]}.
CREATE OR REPLACE FUNCTION public.complete_build_request(_request_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _r public.build_requests;
  _t public.system_templates;
  _start INTEGER;
  _seq INTEGER;
  _unit TEXT;
  _ids TEXT[] := '{}';
  _pending TEXT;
BEGIN
  IF NOT public.is_warehouse_or_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only warehouse managers and admins can complete a build';
  END IF;
  SELECT * INTO _r FROM public.build_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Build request not found';
  END IF;
  IF _r.status NOT IN ('in_progress', 'partially_built') THEN
    RAISE EXCEPTION 'Only a build that''s in progress or partially built can be completed. % is %.',
      _r.request_number, replace(_r.status::TEXT, '_', ' ');
  END IF;
  IF EXISTS (SELECT 1 FROM public.build_request_lines WHERE request_id = _request_id AND qty_held > qty_consumed) THEN
    RAISE EXCEPTION 'Some parts arrived but aren''t installed yet. Install them first.';
  END IF;
  _pending := public.build_request_pending_text(_request_id);
  IF _pending IS NOT NULL THEN
    RAISE EXCEPTION 'Parts are still pending: %. A build can only be completed once everything is installed.', _pending;
  END IF;

  SELECT * INTO _t FROM public.system_templates WHERE id = _r.template_id;

  -- One sequence per project + system, across requests.
  PERFORM pg_advisory_xact_lock(hashtextextended('units:' || _r.project_id::TEXT || ':' || _r.template_id::TEXT, 0));
  SELECT COALESCE(MAX(seq), 0) INTO _start FROM public.build_units WHERE project_id = _r.project_id AND template_id = _r.template_id;

  FOR i IN 1.._r.qty LOOP
    _seq := _start + i;
    _unit := _r.project_number || '-' || _t.system_code || '-' || LPAD(_seq::TEXT, GREATEST(3, length(_seq::TEXT)), '0');
    INSERT INTO public.build_units (request_id, project_id, template_id, product_id, seq, unit_id, created_by)
    VALUES (_request_id, _r.project_id, _r.template_id, _t.finished_product_id, _seq, _unit, auth.uid());
    _ids := _ids || _unit;
  END LOOP;

  INSERT INTO public.inventory_adjustments (project_id, product_id, delta, source_type, source_id, reason, created_by)
  VALUES (_r.project_id, _t.finished_product_id, _r.qty, 'manufacturing_output', _request_id, 'Built on ' || _r.request_number, auth.uid());

  UPDATE public.build_requests SET status = 'completed', completed_at = now(), completed_by = auth.uid() WHERE id = _request_id;

  INSERT INTO public.build_request_events (request_id, kind, payload, actor)
  VALUES (_request_id, 'completed', jsonb_build_object('unit_ids', to_jsonb(_ids)), auth.uid());
  PERFORM public.notify_build_request(_request_id, 'completed', array_to_string(_ids, ', '));

  RETURN jsonb_build_object('unit_ids', to_jsonb(_ids));
END;
$$;

-- ---- RPC: cancel an in-progress build (requester side or warehouse, reason required) ----
CREATE OR REPLACE FUNCTION public.cancel_build_request(_request_id UUID, _reason TEXT)
RETURNS public.build_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _r public.build_requests;
  _l RECORD;
  _returned JSONB := '[]'::JSONB;
BEGIN
  IF NULLIF(btrim(COALESCE(_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Give a reason for cancelling';
  END IF;
  SELECT * INTO _r FROM public.build_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Build request not found';
  END IF;
  IF NOT public.can_request_build(auth.uid(), _r.project_id) THEN
    RAISE EXCEPTION 'Not permitted to cancel this build';
  END IF;
  IF _r.status = 'partially_built' THEN
    RAISE EXCEPTION '% is partially built, so the units already exist. It can''t be cancelled; install the pending parts and complete it.', _r.request_number;
  END IF;
  IF _r.status <> 'in_progress' THEN
    RAISE EXCEPTION 'Only a build that''s in progress can be cancelled. % is %.', _r.request_number, replace(_r.status::TEXT, '_', ' ');
  END IF;

  -- Leave the open statuses first, so returned stock goes to OTHER waiting builds.
  UPDATE public.build_requests
  SET status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = btrim(_reason)
  WHERE id = _request_id
  RETURNING * INTO _r;

  UPDATE public.build_line_serials SET returned_at = now(), returned_by = auth.uid()
  WHERE returned_at IS NULL AND line_id IN (SELECT id FROM public.build_request_lines WHERE request_id = _request_id);

  FOR _l IN
    SELECT l.id, l.product_id, l.qty_consumed, p.part_number
    FROM public.build_request_lines l
    JOIN public.products p ON p.id = l.product_id
    WHERE l.request_id = _request_id
    ORDER BY l.product_id
  LOOP
    UPDATE public.build_request_lines SET qty_held = 0, qty_consumed = 0 WHERE id = _l.id;
    IF _l.qty_consumed > 0 THEN
      -- The allocation trigger offers this returned stock to waiting builds.
      INSERT INTO public.inventory_adjustments (project_id, product_id, delta, source_type, source_id, reason, created_by)
      VALUES (_r.project_id, _l.product_id, _l.qty_consumed, 'manufacturing_return', _request_id,
              'Returned from cancelled ' || _r.request_number, auth.uid());
      _returned := _returned || jsonb_build_object('part_number', _l.part_number, 'qty', _l.qty_consumed);
    ELSE
      -- Held but never used: nothing moves, but the freed hold can go elsewhere.
      PERFORM public.allocate_held_stock(_r.project_id, _l.product_id);
    END IF;
  END LOOP;

  INSERT INTO public.build_request_events (request_id, kind, note, payload, actor)
  VALUES (_request_id, 'cancelled', btrim(_reason), jsonb_build_object('returned', _returned), auth.uid());
  PERFORM public.notify_build_request(_request_id, 'cancelled');
  RETURN _r;
END;
$$;

-- ---- v_project_serials: finished units as serials; used serials 'in_system' ----
-- Same columns as before (status gains a value), so CREATE OR REPLACE keeps grants.
CREATE OR REPLACE VIEW public.v_project_serials AS
WITH received AS (
  SELECT s.project_id AS home_project_id, r.product_id, r.serial
  FROM public.packing_slip_item_serials r
  JOIN public.packing_slip_items i ON i.id = r.slip_item_id
  JOIN public.packing_slips s ON s.id = i.slip_id
  WHERE r.product_id IS NOT NULL AND i.condition = 'ok'
  UNION ALL
  -- Systems built by manufacturing: the unit ID is the serial.
  SELECT bu.project_id, bu.product_id, bu.unit_id
  FROM public.build_units bu
),
lent AS (
  SELECT DISTINCT ON (b.product_id, upper(b.serial))
    b.product_id,
    upper(b.serial) AS serial_key,
    br.target_project_id
  FROM public.borrow_request_serials b
  JOIN public.borrow_requests br ON br.id = b.request_id
  WHERE b.returned_at IS NULL
    AND br.status IN ('fulfilled', 'partially_returned')
  ORDER BY b.product_id, upper(b.serial), b.lent_at DESC
)
SELECT
  COALESCE(l.target_project_id, rc.home_project_id) AS project_id,
  rc.product_id,
  rc.serial,
  CASE
    WHEN EXISTS (
      SELECT 1
      FROM public.shipping_ticket_item_serials ts
      JOIN public.shipping_ticket_items ti ON ti.id = ts.ticket_item_id
      JOIN public.shipping_tickets t ON t.id = ti.ticket_id
      WHERE ts.product_id = rc.product_id
        AND upper(ts.serial) = upper(rc.serial)
        AND t.status IN ('shipped', 'delivered')
    ) THEN 'shipped'
    WHEN EXISTS (
      SELECT 1
      FROM public.build_line_serials bs
      WHERE bs.product_id = rc.product_id
        AND upper(bs.serial) = upper(rc.serial)
        AND bs.returned_at IS NULL
    ) THEN 'in_system'
    ELSE 'in_stock'
  END AS status
FROM received rc
LEFT JOIN lent l ON l.product_id = rc.product_id AND l.serial_key = upper(rc.serial)
WHERE public.has_any_role(auth.uid());

-- ---- Function privileges ----
REVOKE ALL ON FUNCTION public.build_request_audience(public.build_requests, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.build_request_pending_text(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.build_request_take_holds(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.build_request_assert_rule(JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.build_request_consume(UUID, JSONB) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.start_build_request(UUID, JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.install_build_parts(UUID, JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mark_build_partially_built(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.complete_build_request(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_build_request(UUID, TEXT) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.start_build_request(UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.install_build_parts(UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_build_partially_built(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_build_request(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_build_request(UUID, TEXT) TO authenticated;

COMMIT;
