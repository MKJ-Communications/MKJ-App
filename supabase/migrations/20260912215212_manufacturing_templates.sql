-- ============ MANUFACTURING, PHASE 1: SYSTEM TEMPLATES ============
-- The standard systems the shop builds (CCTV cabinets, data cabinets, access
-- control, fiber enclosures...) and the parts that go into ONE unit of each.
-- Build requests (phase 3) start from these lists and copy them, so editing a
-- template never changes a request that already exists.
--
-- Each template owns a finished product: part_number = system_code, serial-
-- tracked, created by the import. Built units will be stocked as that product
-- with unit IDs like 2403-CCTV-CAB-001 stored as its serials (phase 4).
--
-- Follows the po_requests conventions: clients can only SELECT these tables
-- (Supabase's default write grants are revoked), and every write goes through
-- the SECURITY DEFINER RPCs below. Managers, warehouse managers and admins
-- manage templates -- exactly public.can_write(). Engineers can read them.
--
-- Import rules (agreed 2026-09-12):
--   * Re-importing an existing system_code replaces its name, category,
--     description and its WHOLE parts list.
--   * A system_code that matches an existing part number (ignoring case) is
--     rejected, unless it is that system's own finished product.
--   * Unknown part numbers are created as products from the row's
--     description / unit / is_serialized; existing products are left as-is.
--   * All or nothing. _dry_run => validate and return a preview, write nothing.
--     The Systems page shows that preview before the real import.
--
-- No stock impact: nothing here touches inventory_adjustments.

BEGIN;

CREATE TYPE public.system_category AS ENUM ('cctv_cabinet', 'data_cabinet', 'access_control', 'fiber_enclosure', 'other');

CREATE TABLE public.system_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  system_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category public.system_category NOT NULL,
  description TEXT,
  finished_product_id UUID NOT NULL UNIQUE REFERENCES public.products(id) ON DELETE RESTRICT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES auth.users(id),
  updated_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Becomes part of every unit ID, so keep it URL- and label-safe.
  CONSTRAINT system_templates_code_format_check CHECK (system_code ~ '^[A-Z0-9]+(-[A-Z0-9]+)*$'),
  CONSTRAINT system_templates_name_nonblank_check CHECK (btrim(name) <> '')
);

CREATE TABLE public.system_template_parts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES public.system_templates(id) ON DELETE CASCADE,
  line_no INTEGER NOT NULL,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  -- Per ONE unit, in the product's stocking unit. Same precision as the ledger.
  qty_per_system NUMERIC(12,2) NOT NULL CHECK (qty_per_system > 0),
  is_key_part BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  CONSTRAINT system_template_parts_template_product_key UNIQUE (template_id, product_id),
  CONSTRAINT system_template_parts_template_line_key UNIQUE (template_id, line_no)
);

CREATE INDEX system_template_parts_product_idx ON public.system_template_parts (product_id);

CREATE TRIGGER trg_system_templates_upd BEFORE UPDATE ON public.system_templates
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---- Read-only to clients; templates are company-wide, not per project ----
REVOKE ALL ON public.system_templates, public.system_template_parts FROM anon, authenticated;
GRANT SELECT ON public.system_templates, public.system_template_parts TO authenticated;
GRANT ALL ON public.system_templates, public.system_template_parts TO service_role;

ALTER TABLE public.system_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_template_parts ENABLE ROW LEVEL SECURITY;

CREATE POLICY system_templates_select ON public.system_templates FOR SELECT TO authenticated
USING (public.has_any_role(auth.uid()));

CREATE POLICY system_template_parts_select ON public.system_template_parts FOR SELECT TO authenticated
USING (public.has_any_role(auth.uid()));

-- ---- RPC: import (or preview) systems from the spreadsheet ----
-- _systems: [{row_no, system_code, name, category, description}]
-- _parts:   [{row_no, system_code, part_number, qty_per_system, is_key_part,
--             description, unit, is_serialized, notes}]
-- row_no is the spreadsheet row, used only to point errors at the right cell.
-- Returns {imported, errors[], systems[], new_products[]}.
CREATE OR REPLACE FUNCTION public.import_system_templates(_systems JSONB, _parts JSONB, _dry_run BOOLEAN DEFAULT true)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _actor UUID := auth.uid();
  _categories TEXT[] := enum_range(NULL::public.system_category)::TEXT[];
  _errors TEXT[] := '{}';
  _codes TEXT[];
  _systems_out JSONB := '[]'::JSONB;
  _new_products JSONB := '[]'::JSONB;
  _new_pns TEXT[] := '{}';
  _s JSONB;
  _p JSONB;
  _idx BIGINT;
  _where TEXT;
  _code TEXT;
  _name TEXT;
  _cat TEXT;
  _desc TEXT;
  _pn TEXT;
  _qty NUMERIC;
  _clash TEXT;
  _tmpl public.system_templates;
  _prod_id UUID;
  _count INTEGER;
  _key_count INTEGER;
  _dup TEXT;
  _inserted INTEGER;
BEGIN
  IF NOT public.can_write(_actor) THEN
    RAISE EXCEPTION 'Only managers, warehouse managers and admins can import systems';
  END IF;
  IF _systems IS NULL OR jsonb_typeof(_systems) <> 'array' OR jsonb_array_length(_systems) = 0 THEN
    RAISE EXCEPTION 'Tab "1 Systems" has no rows to import';
  END IF;
  IF _parts IS NULL OR jsonb_typeof(_parts) <> 'array' THEN
    _parts := '[]'::JSONB;
  END IF;

  -- Codes on tab 1, normalised exactly as below, for the cross-tab checks.
  SELECT COALESCE(array_agg(DISTINCT upper(btrim(e->>'system_code'))), '{}') INTO _codes
  FROM jsonb_array_elements(_systems) e
  WHERE btrim(COALESCE(e->>'system_code', '')) <> '';

  -- ---------- Tab 1: systems ----------
  FOR _s, _idx IN SELECT e.value, e.ordinality FROM jsonb_array_elements(_systems) WITH ORDINALITY AS e(value, ordinality) LOOP
    _where := '1 Systems, row ' || COALESCE(_s->>'row_no', _idx::TEXT);
    _code := upper(btrim(COALESCE(_s->>'system_code', '')));
    _name := btrim(COALESCE(_s->>'name', ''));
    _cat := lower(btrim(COALESCE(_s->>'category', '')));

    IF _code = '' THEN
      _errors := _errors || (_where || ': system_code is blank');
      CONTINUE;
    END IF;
    IF _code !~ '^[A-Z0-9]+(-[A-Z0-9]+)*$' THEN
      _errors := _errors || (_where || ': system_code "' || _code || '" can only use letters, numbers and single dashes');
    END IF;
    IF _name = '' THEN
      _errors := _errors || (_where || ': name is blank');
    END IF;
    IF NOT (_cat = ANY (_categories)) THEN
      _errors := _errors || (_where || ': category must be one of ' || array_to_string(_categories, ', '));
    END IF;

    SELECT * INTO _tmpl FROM public.system_templates WHERE system_code = _code;

    -- The code becomes a part number, so it may not collide with one
    -- (ignoring case) -- except this system's own finished product.
    SELECT part_number INTO _clash FROM public.products
    WHERE upper(part_number) = _code AND id IS DISTINCT FROM _tmpl.finished_product_id
    LIMIT 1;
    IF _clash IS NOT NULL THEN
      _errors := _errors || (_where || ': system_code "' || _code || '" matches the existing part number "' || _clash || '". Pick a different code.');
    END IF;

    SELECT count(*), count(*) FILTER (WHERE e->>'is_key_part' = 'true') INTO _count, _key_count
    FROM jsonb_array_elements(_parts) e
    WHERE upper(btrim(COALESCE(e->>'system_code', ''))) = _code;
    IF _count = 0 THEN
      _errors := _errors || (_where || ': "' || _code || '" has no parts on tab "2 System Parts"');
    END IF;

    _systems_out := _systems_out || jsonb_build_object(
      'row_no', _s->'row_no',
      'system_code', _code,
      'name', _name,
      'category', _cat,
      'action', CASE WHEN _tmpl.id IS NULL THEN 'create' ELSE 'replace' END,
      'part_count', _count,
      'key_part_count', _key_count
    );
  END LOOP;

  FOR _dup IN
    SELECT upper(btrim(e->>'system_code'))
    FROM jsonb_array_elements(_systems) e
    WHERE btrim(COALESCE(e->>'system_code', '')) <> ''
    GROUP BY 1 HAVING count(*) > 1
  LOOP
    _errors := _errors || ('1 Systems: "' || _dup || '" is listed more than once');
  END LOOP;

  -- ---------- Tab 2: parts ----------
  FOR _p, _idx IN SELECT e.value, e.ordinality FROM jsonb_array_elements(_parts) WITH ORDINALITY AS e(value, ordinality) LOOP
    _where := '2 System Parts, row ' || COALESCE(_p->>'row_no', _idx::TEXT);
    _code := upper(btrim(COALESCE(_p->>'system_code', '')));
    _pn := btrim(COALESCE(_p->>'part_number', ''));

    IF _code = '' THEN
      _errors := _errors || (_where || ': system_code is blank');
    ELSIF NOT (_code = ANY (_codes)) THEN
      _errors := _errors || (_where || ': system_code "' || _code || '" isn''t on tab "1 Systems"');
    END IF;

    IF jsonb_typeof(_p->'qty_per_system') IS DISTINCT FROM 'number' THEN
      _errors := _errors || (_where || ': qty_per_system must be a number');
    ELSE
      _qty := (_p->>'qty_per_system')::NUMERIC;
      IF _qty <= 0 THEN
        _errors := _errors || (_where || ': qty_per_system must be greater than 0');
      ELSIF _qty <> round(_qty, 2) THEN
        _errors := _errors || (_where || ': qty_per_system can have at most 2 decimals');
      END IF;
    END IF;

    IF COALESCE(jsonb_typeof(_p->'is_key_part'), 'null') NOT IN ('boolean', 'null') THEN
      _errors := _errors || (_where || ': is_key_part must be TRUE or FALSE');
    END IF;
    IF COALESCE(jsonb_typeof(_p->'is_serialized'), 'null') NOT IN ('boolean', 'null') THEN
      _errors := _errors || (_where || ': is_serialized must be TRUE or FALSE');
    END IF;

    IF _pn = '' THEN
      _errors := _errors || (_where || ': part_number is blank');
      CONTINUE;
    END IF;
    IF upper(_pn) = _code THEN
      _errors := _errors || (_where || ': a system can''t list itself as a part');
      CONTINUE;
    END IF;
    -- Another system from this file used as a part: its product is created
    -- by this import with the code in uppercase, so the casing must match.
    IF upper(_pn) = ANY (_codes) THEN
      IF _pn <> upper(_pn) THEN
        _errors := _errors || (_where || ': write the system part as "' || upper(_pn) || '"');
      END IF;
      CONTINUE;
    END IF;

    SELECT id INTO _prod_id FROM public.products WHERE part_number = _pn;
    IF _prod_id IS NOT NULL OR _pn = ANY (_new_pns) THEN
      CONTINUE;
    END IF;

    -- New part. Catch a casing slip before it becomes a duplicate product.
    SELECT part_number INTO _clash FROM public.products WHERE upper(part_number) = upper(_pn) LIMIT 1;
    IF _clash IS NOT NULL THEN
      _errors := _errors || (_where || ': part "' || _pn || '" isn''t in the app, but "' || _clash || '" is. Use that exact casing.');
      CONTINUE;
    END IF;

    _desc := btrim(COALESCE(_p->>'description', ''));
    IF _desc = '' THEN
      _errors := _errors || (_where || ': part "' || _pn || '" isn''t in the app yet, so description is required');
      CONTINUE;
    END IF;

    _new_pns := _new_pns || _pn;
    _new_products := _new_products || jsonb_build_object(
      'part_number', _pn,
      'description', _desc,
      'unit', COALESCE(NULLIF(btrim(COALESCE(_p->>'unit', '')), ''), 'ea'),
      'is_serialized', CASE WHEN jsonb_typeof(_p->'is_serialized') = 'boolean' THEN (_p->'is_serialized')::BOOLEAN ELSE false END
    );
  END LOOP;

  FOR _dup IN
    SELECT upper(btrim(e->>'system_code')) || ' / ' || btrim(e->>'part_number')
    FROM jsonb_array_elements(_parts) e
    WHERE btrim(COALESCE(e->>'system_code', '')) <> '' AND btrim(COALESCE(e->>'part_number', '')) <> ''
    GROUP BY upper(btrim(e->>'system_code')), btrim(e->>'part_number')
    HAVING count(*) > 1
  LOOP
    _errors := _errors || ('2 System Parts: ' || _dup || ' is listed more than once. Raise the quantity instead.');
  END LOOP;

  IF _dry_run OR array_length(_errors, 1) IS NOT NULL THEN
    IF NOT _dry_run THEN
      RAISE EXCEPTION 'Nothing was imported: % problem(s) found. First: %', array_length(_errors, 1), _errors[1];
    END IF;
    RETURN jsonb_build_object('imported', false, 'errors', to_jsonb(_errors), 'systems', _systems_out, 'new_products', _new_products);
  END IF;

  -- ---------- Write: templates and their finished products ----------
  FOR _s IN SELECT value FROM jsonb_array_elements(_systems) LOOP
    _code := upper(btrim(_s->>'system_code'));
    _name := btrim(_s->>'name');
    _cat := lower(btrim(_s->>'category'));
    _desc := NULLIF(btrim(COALESCE(_s->>'description', '')), '');

    SELECT * INTO _tmpl FROM public.system_templates WHERE system_code = _code FOR UPDATE;
    IF _tmpl.id IS NULL THEN
      INSERT INTO public.products (part_number, description, unit, is_serialized)
      VALUES (_code, COALESCE(_desc, _name), 'ea', true)
      RETURNING id INTO _prod_id;

      INSERT INTO public.system_templates (system_code, name, category, description, finished_product_id, created_by, updated_by)
      VALUES (_code, _name, _cat::public.system_category, _desc, _prod_id, _actor, _actor);
    ELSE
      UPDATE public.system_templates
      SET name = _name, category = _cat::public.system_category, description = _desc, updated_by = _actor
      WHERE id = _tmpl.id;

      UPDATE public.products SET description = COALESCE(_desc, _name) WHERE id = _tmpl.finished_product_id;

      DELETE FROM public.system_template_parts WHERE template_id = _tmpl.id;
    END IF;
  END LOOP;

  -- ---------- Write: components new to the app ----------
  INSERT INTO public.products (part_number, description, unit, is_serialized)
  SELECT x->>'part_number', x->>'description', x->>'unit', (x->>'is_serialized')::BOOLEAN
  FROM jsonb_array_elements(_new_products) x
  ON CONFLICT (part_number) DO NOTHING;

  -- ---------- Write: parts lists, in spreadsheet order ----------
  INSERT INTO public.system_template_parts (template_id, line_no, product_id, qty_per_system, is_key_part, notes)
  SELECT
    t.id,
    row_number() OVER (PARTITION BY t.id ORDER BY x.ord),
    p.id,
    (x.value->>'qty_per_system')::NUMERIC,
    COALESCE((x.value->>'is_key_part')::BOOLEAN, false),
    NULLIF(btrim(COALESCE(x.value->>'notes', '')), '')
  FROM jsonb_array_elements(_parts) WITH ORDINALITY AS x(value, ord)
  JOIN public.system_templates t ON t.system_code = upper(btrim(x.value->>'system_code'))
  JOIN public.products p ON p.part_number = btrim(x.value->>'part_number');

  GET DIAGNOSTICS _inserted = ROW_COUNT;
  IF _inserted <> jsonb_array_length(_parts) THEN
    RAISE EXCEPTION 'Import stopped: % of % part rows could be matched to a product', _inserted, jsonb_array_length(_parts);
  END IF;

  RETURN jsonb_build_object('imported', true, 'errors', '[]'::JSONB, 'systems', _systems_out, 'new_products', _new_products);
END;
$$;

-- ---- RPC: hide / show a template without deleting it ----
-- Build requests will reference templates, so they are never deleted.
CREATE OR REPLACE FUNCTION public.set_system_template_active(_template_id UUID, _active BOOLEAN)
RETURNS public.system_templates
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _t public.system_templates;
BEGIN
  IF NOT public.can_write(auth.uid()) THEN
    RAISE EXCEPTION 'Only managers, warehouse managers and admins can change systems';
  END IF;

  UPDATE public.system_templates
  SET active = COALESCE(_active, active), updated_by = auth.uid()
  WHERE id = _template_id
  RETURNING * INTO _t;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'System not found';
  END IF;
  RETURN _t;
END;
$$;

-- ---- Function privileges ----
REVOKE ALL ON FUNCTION public.import_system_templates(JSONB, JSONB, BOOLEAN) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_system_template_active(UUID, BOOLEAN) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.import_system_templates(JSONB, JSONB, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_system_template_active(UUID, BOOLEAN) TO authenticated;

COMMIT;
