-- ============ PRODUCT <-> SUPPLIER PRICING ============
--
-- Until now there was no relation of any kind between products and
-- suppliers. The only cost recorded anywhere was purchase_order_items.unit_cost
-- -- a per-PO-line number on a free-text line whose product_id is nullable, so
-- it can't be read back as "what does this part cost from this vendor".
--
-- The same part is bought from several vendors at different prices, and those
-- prices drift over time, so cost cannot be a column on products. Instead:
--
--   supplier_prices          one row per (product x supplier-or-source) =
--                            the CURRENT price. Its price_updated_at is the
--                            "price last updated" date shown in the UI.
--   supplier_price_history   append-only, written by trigger whenever a
--                            unit_cost changes, so the increase/decrease
--                            history survives edits.
--   v_products_with_cost     products + the one cost to display, derived --
--                            never stored, so it can't go stale.
--
-- Parts bought off Amazon/eBay have no vendor record: supplier_id stays NULL
-- and source_label carries the marketplace name. The CHECK below requires one
-- or the other, and the two partial unique indexes keep "one current price per
-- pair" true for both shapes (a plain unique index would not, since NULLs
-- never compare equal).
--
-- Visibility: SELECT is can_write() -- admin, warehouse_manager, manager.
-- Engineers are excluded, and because the view is security_invoker they simply
-- see the products list with a blank cost column rather than an error.
-- Writing the price list is warehouse/admin only.
--
-- Safe to run more than once.

BEGIN;

-- ============ TABLES ============

CREATE TABLE IF NOT EXISTS public.supplier_prices (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id    UUID NOT NULL REFERENCES public.products(id)  ON DELETE CASCADE,
  supplier_id   UUID          REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  source_label  TEXT,
  supplier_sku  TEXT,
  unit_cost     NUMERIC(12,4) NOT NULL CHECK (unit_cost >= 0),
  unit          TEXT NOT NULL DEFAULT 'ea',
  is_preferred  BOOLEAN NOT NULL DEFAULT false,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Distinct from updated_at on purpose: updated_at moves on ANY row edit
  -- (a note, a SKU, another vendor being marked preferred), which would make
  -- the "price last updated" date shown in the UI wrong. This one moves only
  -- when unit_cost actually changes.
  price_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    UUID REFERENCES auth.users(id),
  CONSTRAINT supplier_prices_has_source
    CHECK (supplier_id IS NOT NULL OR nullif(trim(source_label), '') IS NOT NULL)
);

-- History keeps source_name as a text snapshot, not just the FK: a supplier
-- can be deleted once no current price references it, and the historical
-- series should still say who we bought from.
CREATE TABLE IF NOT EXISTS public.supplier_price_history (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_price_id  UUID REFERENCES public.supplier_prices(id) ON DELETE SET NULL,
  product_id         UUID NOT NULL REFERENCES public.products(id)  ON DELETE CASCADE,
  supplier_id        UUID          REFERENCES public.suppliers(id) ON DELETE SET NULL,
  source_name        TEXT,
  unit_cost          NUMERIC(12,4) NOT NULL,
  previous_unit_cost NUMERIC(12,4),
  unit               TEXT NOT NULL DEFAULT 'ea',
  recorded_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  recorded_by        UUID REFERENCES auth.users(id)
);

-- ============ INDEXES ============

-- One current price per (product, vendor) and per (product, marketplace).
CREATE UNIQUE INDEX IF NOT EXISTS supplier_prices_uniq_supplier
  ON public.supplier_prices (product_id, supplier_id)
  WHERE supplier_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS supplier_prices_uniq_source
  ON public.supplier_prices (product_id, lower(trim(source_label)))
  WHERE supplier_id IS NULL;

-- Safety net behind the "clear the old preferred" trigger below.
CREATE UNIQUE INDEX IF NOT EXISTS supplier_prices_one_preferred
  ON public.supplier_prices (product_id)
  WHERE is_preferred;

CREATE INDEX IF NOT EXISTS supplier_prices_product_idx  ON public.supplier_prices (product_id);
CREATE INDEX IF NOT EXISTS supplier_prices_supplier_idx ON public.supplier_prices (supplier_id);
CREATE INDEX IF NOT EXISTS supplier_price_history_product_idx
  ON public.supplier_price_history (product_id, recorded_at DESC);

-- ============ TRIGGERS ============

CREATE OR REPLACE FUNCTION public.stamp_supplier_price_updated() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.unit_cost IS DISTINCT FROM OLD.unit_cost THEN
    NEW.price_updated_at = now();
  ELSE
    NEW.price_updated_at = OLD.price_updated_at;
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.record_supplier_price_change() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.unit_cost IS NOT DISTINCT FROM OLD.unit_cost THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.supplier_price_history (
    supplier_price_id, product_id, supplier_id, source_name,
    unit_cost, previous_unit_cost, unit, recorded_by
  )
  VALUES (
    NEW.id, NEW.product_id, NEW.supplier_id,
    COALESCE((SELECT name FROM public.suppliers WHERE id = NEW.supplier_id), NEW.source_label),
    NEW.unit_cost,
    CASE WHEN TG_OP = 'UPDATE' THEN OLD.unit_cost END,
    NEW.unit,
    auth.uid()
  );

  RETURN NEW;
END; $$;

-- Lets the UI mark a preferred vendor in a single UPDATE instead of having to
-- clear the previous one first. The inner UPDATE sets is_preferred = false, so
-- the WHEN clause is false for it and it cannot recurse.
CREATE OR REPLACE FUNCTION public.clear_other_preferred_prices() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.supplier_prices
  SET is_preferred = false
  WHERE product_id = NEW.product_id
    AND id <> NEW.id
    AND is_preferred;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_supplier_prices_stamp ON public.supplier_prices;
CREATE TRIGGER trg_supplier_prices_stamp
  BEFORE INSERT OR UPDATE ON public.supplier_prices
  FOR EACH ROW EXECUTE FUNCTION public.stamp_supplier_price_updated();

DROP TRIGGER IF EXISTS trg_supplier_prices_upd ON public.supplier_prices;
CREATE TRIGGER trg_supplier_prices_upd
  BEFORE UPDATE ON public.supplier_prices
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_supplier_prices_one_preferred ON public.supplier_prices;
CREATE TRIGGER trg_supplier_prices_one_preferred
  BEFORE INSERT OR UPDATE ON public.supplier_prices
  FOR EACH ROW WHEN (NEW.is_preferred)
  EXECUTE FUNCTION public.clear_other_preferred_prices();

DROP TRIGGER IF EXISTS trg_supplier_prices_history ON public.supplier_prices;
CREATE TRIGGER trg_supplier_prices_history
  AFTER INSERT OR UPDATE ON public.supplier_prices
  FOR EACH ROW EXECUTE FUNCTION public.record_supplier_price_change();

-- Trigger-only functions get no EXECUTE grants -- Postgres does not check
-- EXECUTE to fire a trigger. Matches 20260908233505_revoke_anon_function_access.
REVOKE ALL ON FUNCTION public.stamp_supplier_price_updated() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_supplier_price_change() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.clear_other_preferred_prices() FROM PUBLIC, anon, authenticated;

-- ============ RLS ============

GRANT SELECT, INSERT, UPDATE, DELETE ON public.supplier_prices TO authenticated;
GRANT ALL ON public.supplier_prices TO service_role;
ALTER TABLE public.supplier_prices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS supplier_prices_select ON public.supplier_prices;
CREATE POLICY supplier_prices_select ON public.supplier_prices
  FOR SELECT TO authenticated
  USING (public.can_write(auth.uid()));

DROP POLICY IF EXISTS supplier_prices_write ON public.supplier_prices;
CREATE POLICY supplier_prices_write ON public.supplier_prices
  FOR ALL TO authenticated
  USING (public.is_warehouse_or_admin(auth.uid()))
  WITH CHECK (public.is_warehouse_or_admin(auth.uid()));

-- History is read-only to everyone: no INSERT grant, no write policy. Rows
-- arrive only through the SECURITY DEFINER trigger above.
GRANT SELECT ON public.supplier_price_history TO authenticated;
GRANT ALL ON public.supplier_price_history TO service_role;
ALTER TABLE public.supplier_price_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS supplier_price_history_select ON public.supplier_price_history;
CREATE POLICY supplier_price_history_select ON public.supplier_price_history
  FOR SELECT TO authenticated
  USING (public.can_write(auth.uid()));

-- ============ VIEW ============
--
-- Which of a product's prices is "the" cost: the vendor explicitly marked
-- preferred, else the cheapest, else the most recently updated. Dropped and
-- recreated rather than CREATE OR REPLACE, which cannot change a column list.
-- Adding a column to products means adding it here too.

DROP VIEW IF EXISTS public.v_products_with_cost;
CREATE VIEW public.v_products_with_cost WITH (security_invoker = true) AS
SELECT
  p.id,
  p.part_number,
  p.description,
  p.unit,
  p.reorder_point,
  p.is_serialized,
  p.created_at,
  p.updated_at,
  c.unit_cost                       AS default_cost,
  c.unit                            AS default_cost_unit,
  c.price_updated_at                AS cost_updated_at,
  c.supplier_id                     AS default_supplier_id,
  COALESCE(s.name, c.source_label)  AS default_source,
  c.is_preferred                    AS default_is_preferred,
  agg.price_count,
  agg.min_cost,
  agg.max_cost
FROM public.products p
LEFT JOIN LATERAL (
  SELECT sp.unit_cost, sp.unit, sp.price_updated_at, sp.supplier_id, sp.source_label, sp.is_preferred
  FROM public.supplier_prices sp
  WHERE sp.product_id = p.id
  ORDER BY sp.is_preferred DESC, sp.unit_cost ASC, sp.price_updated_at DESC
  LIMIT 1
) c ON true
LEFT JOIN public.suppliers s ON s.id = c.supplier_id
LEFT JOIN LATERAL (
  SELECT count(*) AS price_count, min(sp2.unit_cost) AS min_cost, max(sp2.unit_cost) AS max_cost
  FROM public.supplier_prices sp2
  WHERE sp2.product_id = p.id
) agg ON true;

GRANT SELECT ON public.v_products_with_cost TO authenticated;

COMMIT;
