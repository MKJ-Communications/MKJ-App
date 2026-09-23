-- ============ MANUFACTURING, PHASE 2b: HELD-STOCK FOUNDATION ============
-- Build requests hold stock from the moment they're submitted, so:
--
--   available = on hand - held by open build requests
--   held      = SUM(qty_held - qty_consumed) over lines of requests that are
--               submitted, in_progress or partially_built
--
-- This migration:
--   1. Creates the build request tables (read-only to clients, like
--      po_requests; the write RPCs arrive in phase 3). Nothing can hold stock
--      yet, so held is 0 everywhere and every existing screen behaves as before.
--   2. Adds held / available to v_project_inventory. held comes from a
--      function call rather than a join so the view keeps the exact shape it
--      had (a grouped select over inventory_adjustments) -- PostgREST relies
--      on that shape to embed products:product_id(...) through the view.
--   3. Adds guard_held_stock(), a BEFORE INSERT trigger on
--      inventory_adjustments that refuses any stock-reducing row that would
--      take a project below what builds hold. One choke point instead of
--      checks in every RPC: shipping tickets, borrow approvals and returns,
--      packing slip edits/deletes and direct inserts all pass through it.
--      Manufacturing itself must mark parts consumed (qty_consumed) BEFORE
--      inserting its manufacturing_consume rows, which releases the hold first.
--      Stock-reducing writes for one project+part are serialised with an
--      advisory lock so two concurrent writers can't both pass the check.
--   4. Adds the (project_id, product_id) index the guard and the view sum on.
--
-- Packing slip edits save their lines from the browser before syncing stock,
-- so the edit dialog also checks available stock up front
-- (assertSlipEditKeepsHeldStock in src/lib/receiving.ts).

BEGIN;

CREATE TYPE public.build_status AS ENUM ('draft', 'submitted', 'in_progress', 'partially_built', 'completed', 'rejected', 'cancelled');

-- ---- One per request: a project asking the shop to build N units of one system ----
CREATE TABLE public.build_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_number TEXT NOT NULL UNIQUE,              -- MFG-<mkj_number>-<3-digit seq>
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE RESTRICT,
  project_number TEXT NOT NULL,
  request_sequence INTEGER NOT NULL,
  template_id UUID NOT NULL REFERENCES public.system_templates(id) ON DELETE RESTRICT,
  qty INTEGER NOT NULL CHECK (qty > 0),
  status public.build_status NOT NULL DEFAULT 'draft',
  notes TEXT,
  requested_by UUID REFERENCES auth.users(id),
  submitted_by UUID REFERENCES auth.users(id),
  submitted_at TIMESTAMPTZ,
  started_by UUID REFERENCES auth.users(id),
  started_at TIMESTAMPTZ,
  completed_by UUID REFERENCES auth.users(id),
  completed_at TIMESTAMPTZ,
  rejected_by UUID REFERENCES auth.users(id),
  rejected_at TIMESTAMPTZ,
  reject_note TEXT,
  cancelled_by UUID REFERENCES auth.users(id),
  cancelled_at TIMESTAMPTZ,
  cancel_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT build_requests_project_sequence_key UNIQUE (project_id, request_sequence),
  CONSTRAINT build_requests_reject_note_check
    CHECK (status <> 'rejected' OR (reject_note IS NOT NULL AND btrim(reject_note) <> '')),
  CONSTRAINT build_requests_cancel_reason_check
    CHECK (status <> 'cancelled' OR (cancel_reason IS NOT NULL AND btrim(cancel_reason) <> ''))
);

CREATE INDEX build_requests_project_status_idx ON public.build_requests (project_id, status);
CREATE INDEX build_requests_status_idx ON public.build_requests (status);

CREATE TRIGGER trg_build_requests_upd BEFORE UPDATE ON public.build_requests
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---- The request's own copy of the parts list (template snapshot + edits) ----
CREATE TABLE public.build_request_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES public.build_requests(id) ON DELETE CASCADE,
  line_no INTEGER NOT NULL,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  qty_per_unit NUMERIC(12,2) NOT NULL CHECK (qty_per_unit > 0),
  qty_required NUMERIC(12,2) NOT NULL CHECK (qty_required > 0),
  is_key_part BOOLEAN NOT NULL DEFAULT false,
  origin TEXT NOT NULL DEFAULT 'template' CHECK (origin IN ('template', 'added', 'changed')),
  qty_held NUMERIC(12,2) NOT NULL DEFAULT 0,       -- ever held for this line
  qty_consumed NUMERIC(12,2) NOT NULL DEFAULT 0,   -- of that, used in the build
  notes TEXT,
  CONSTRAINT build_request_lines_request_product_key UNIQUE (request_id, product_id),
  CONSTRAINT build_request_lines_request_line_key UNIQUE (request_id, line_no),
  CONSTRAINT build_request_lines_held_check CHECK (qty_held >= 0 AND qty_held <= qty_required),
  CONSTRAINT build_request_lines_consumed_check CHECK (qty_consumed >= 0 AND qty_consumed <= qty_held)
);

CREATE INDEX build_request_lines_product_idx ON public.build_request_lines (product_id);

-- ---- Which serial-tracked units went into a build ----
CREATE TABLE public.build_line_serials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  line_id UUID NOT NULL REFERENCES public.build_request_lines(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id),
  serial TEXT NOT NULL CHECK (btrim(serial) <> ''),
  entered_manually BOOLEAN NOT NULL DEFAULT false,  -- stock received before serial tracking
  consumed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  consumed_by UUID REFERENCES auth.users(id),
  returned_at TIMESTAMPTZ,                         -- set when a cancelled build returns it
  returned_by UUID REFERENCES auth.users(id)
);

CREATE INDEX build_line_serials_line_idx ON public.build_line_serials (line_id);
-- A unit can be inside only one build at a time.
CREATE UNIQUE INDEX build_line_serials_in_use_key
  ON public.build_line_serials (product_id, upper(serial)) WHERE returned_at IS NULL;

-- ---- Finished units, e.g. 2403-CCTV-CAB-004 ----
CREATE TABLE public.build_units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES public.build_requests(id) ON DELETE RESTRICT,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE RESTRICT,
  template_id UUID NOT NULL REFERENCES public.system_templates(id) ON DELETE RESTRICT,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  seq INTEGER NOT NULL CHECK (seq > 0),            -- per project + system, across requests
  unit_id TEXT NOT NULL UNIQUE,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT build_units_project_template_seq_key UNIQUE (project_id, template_id, seq)
);

CREATE INDEX build_units_request_idx ON public.build_units (request_id);

-- ---- History: status changes, pull-backs, edits, notes, automatic holds ----
CREATE TABLE public.build_request_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES public.build_requests(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  note TEXT,
  payload JSONB,
  actor UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX build_request_events_request_idx ON public.build_request_events (request_id, created_at);

-- ---- Read-only to clients; visibility follows the project ----
REVOKE ALL ON public.build_requests, public.build_request_lines, public.build_line_serials,
  public.build_units, public.build_request_events FROM anon, authenticated;
GRANT SELECT ON public.build_requests, public.build_request_lines, public.build_line_serials,
  public.build_units, public.build_request_events TO authenticated;
GRANT ALL ON public.build_requests, public.build_request_lines, public.build_line_serials,
  public.build_units, public.build_request_events TO service_role;

ALTER TABLE public.build_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.build_request_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.build_line_serials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.build_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.build_request_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY build_requests_select ON public.build_requests FOR SELECT TO authenticated
USING (public.can_see_project(auth.uid(), project_id));

CREATE POLICY build_request_lines_select ON public.build_request_lines FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.build_requests r
  WHERE r.id = request_id AND public.can_see_project(auth.uid(), r.project_id)
));

CREATE POLICY build_line_serials_select ON public.build_line_serials FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.build_request_lines l
  JOIN public.build_requests r ON r.id = l.request_id
  WHERE l.id = line_id AND public.can_see_project(auth.uid(), r.project_id)
));

CREATE POLICY build_units_select ON public.build_units FOR SELECT TO authenticated
USING (public.can_see_project(auth.uid(), project_id));

CREATE POLICY build_request_events_select ON public.build_request_events FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.build_requests r
  WHERE r.id = request_id AND public.can_see_project(auth.uid(), r.project_id)
));

-- ---- Held quantity for one project + part ----
-- SECURITY DEFINER so the inventory view (which shows every project's stock
-- to any role) reports held the same way for everyone; executable by
-- authenticated because Postgres checks function privileges against the
-- person reading the view.
CREATE OR REPLACE FUNCTION public.held_stock_qty(_project_id UUID, _product_id UUID)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(l.qty_held - l.qty_consumed), 0)
  FROM public.build_request_lines l
  JOIN public.build_requests r ON r.id = l.request_id
  WHERE r.project_id = _project_id
    AND l.product_id = _product_id
    AND r.status IN ('submitted', 'in_progress', 'partially_built')
$$;

REVOKE ALL ON FUNCTION public.held_stock_qty(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.held_stock_qty(UUID, UUID) TO authenticated;

-- ---- v_project_inventory: same three columns, plus held and available ----
CREATE OR REPLACE VIEW public.v_project_inventory AS
SELECT
  ia.project_id,
  ia.product_id,
  SUM(ia.delta) AS on_hand,
  public.held_stock_qty(ia.project_id, ia.product_id) AS held,
  SUM(ia.delta) - public.held_stock_qty(ia.project_id, ia.product_id) AS available
FROM public.inventory_adjustments ia
WHERE public.has_any_role(auth.uid())
GROUP BY ia.project_id, ia.product_id;

CREATE INDEX IF NOT EXISTS inventory_adjustments_project_product_idx
  ON public.inventory_adjustments (project_id, product_id);

-- ---- Guard: stock never drops below what builds hold ----
CREATE OR REPLACE FUNCTION public.guard_held_stock()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _held NUMERIC;
  _on_hand NUMERIC;
  _part TEXT;
  _builds TEXT;
BEGIN
  IF NEW.delta >= 0 THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('stock:' || NEW.project_id::TEXT || ':' || NEW.product_id::TEXT, 0));

  _held := public.held_stock_qty(NEW.project_id, NEW.product_id);
  IF _held <= 0 THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(SUM(delta), 0) INTO _on_hand
  FROM public.inventory_adjustments
  WHERE project_id = NEW.project_id AND product_id = NEW.product_id;

  IF _on_hand + NEW.delta < _held THEN
    SELECT part_number INTO _part FROM public.products WHERE id = NEW.product_id;
    SELECT string_agg(DISTINCT r.request_number, ', ') INTO _builds
    FROM public.build_request_lines l
    JOIN public.build_requests r ON r.id = l.request_id
    WHERE r.project_id = NEW.project_id
      AND l.product_id = NEW.product_id
      AND r.status IN ('submitted', 'in_progress', 'partially_built')
      AND l.qty_held > l.qty_consumed;

    RAISE EXCEPTION 'Only % of % can be used: % held for manufacturing (%). This change needs %.',
      trim_scale(GREATEST(_on_hand - _held, 0)), COALESCE(_part, 'this part'), trim_scale(_held),
      COALESCE(_builds, 'build requests'), trim_scale(-NEW.delta);
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_held_stock() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_inventory_adjustments_held_guard
BEFORE INSERT ON public.inventory_adjustments
FOR EACH ROW EXECUTE FUNCTION public.guard_held_stock();

COMMIT;
