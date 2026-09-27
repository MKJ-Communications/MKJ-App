-- ============ PRODUCTS: MANUFACTURER ============
-- Who makes the part (Axis, Etherwan, Ranco...). Free text, optional: the
-- Products page suggests values already in use so spellings stay consistent,
-- and the SharePoint cutsheet import (20260926..._sharepoint_cutsheets and
-- later) fills it from the vendor folder a cutsheet sits in.
--
-- v_products_with_cost is recreated so the Products page can show it; the
-- new column goes at the end because CREATE OR REPLACE VIEW can only append.

BEGIN;

ALTER TABLE public.products
  ADD COLUMN manufacturer TEXT,
  ADD CONSTRAINT products_manufacturer_nonblank_check CHECK (manufacturer IS NULL OR btrim(manufacturer) <> '');

CREATE OR REPLACE VIEW public.v_products_with_cost WITH (security_invoker = true) AS
SELECT p.id,
    p.part_number,
    p.description,
    p.unit,
    p.reorder_point,
    p.is_serialized,
    p.created_at,
    p.updated_at,
    c.unit_cost AS default_cost,
    c.unit AS default_cost_unit,
    c.price_updated_at AS cost_updated_at,
    c.supplier_id AS default_supplier_id,
    COALESCE(s.name, c.source_label) AS default_source,
    c.is_preferred AS default_is_preferred,
    agg.price_count,
    agg.min_cost,
    agg.max_cost,
    p.manufacturer
   FROM products p
     LEFT JOIN LATERAL ( SELECT sp.unit_cost,
            sp.unit,
            sp.price_updated_at,
            sp.supplier_id,
            sp.source_label,
            sp.is_preferred
           FROM supplier_prices sp
          WHERE sp.product_id = p.id
          ORDER BY sp.is_preferred DESC, sp.unit_cost, sp.price_updated_at DESC
         LIMIT 1) c ON true
     LEFT JOIN suppliers s ON s.id = c.supplier_id
     LEFT JOIN LATERAL ( SELECT count(*) AS price_count,
            min(sp2.unit_cost) AS min_cost,
            max(sp2.unit_cost) AS max_cost
           FROM supplier_prices sp2
          WHERE sp2.product_id = p.id) agg ON true;

COMMIT;
