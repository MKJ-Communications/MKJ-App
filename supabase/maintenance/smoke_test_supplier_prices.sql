-- Smoke test for 20260908235000_supplier_prices.sql
--
-- Run in the Supabase SQL Editor AFTER applying that migration. Paste the
-- whole file and run it. Every line should read PASS, except one known SKIP
-- (see the comment on check 3).
--
-- Nothing is left behind. All the test data is written inside a subtransaction
-- that is deliberately rolled back; the results survive because they are
-- accumulated in a plpgsql variable, which is memory, not table data. That is
-- also why this is a temp function rather than a plain BEGIN/ROLLBACK script --
-- a trailing ROLLBACK would discard the result grid before you could read it.
--
-- Self-contained: it creates its own throwaway product and two suppliers, so it
-- works on an empty database and never touches real catalog data. Those are
-- rolled back with everything else.
--
-- NOTE: the SQL Editor connects as `postgres`, which BYPASSES row level
-- security. This proves the triggers, constraints and view are correct. It does
-- NOT test the RLS policies -- those are only exercised by signing into the app
-- as a real user, which needs the Phase 2 UI.

CREATE OR REPLACE FUNCTION pg_temp.smoke_supplier_prices()
RETURNS SETOF text LANGUAGE plpgsql AS $fn$
DECLARE
  -- Every append to out_lines must yield a definitely-typed text value. A bare
  -- string literal (`out_lines || 'done'`) is ambiguous and Postgres resolves it
  -- as text[], failing with "malformed array literal" -- hence the ::text casts
  -- on the literal-only lines below.
  out_lines text[] := '{}';
  v_price_id   uuid;
  v_product_id uuid;
  v_supplier_a uuid;
  v_supplier_b uuid;
  v_part       constant text := '__SMOKE_TEST_PART__';
  v_hist_n     int;
  v_pref_n     int;
  v_total_n    int;
  v_prev       numeric;
  v_view       record;
BEGIN
  BEGIN
    -------------------------------------------------- 0. throwaway fixtures
    INSERT INTO public.products (part_number, description, unit, reorder_point)
    VALUES (v_part, 'smoke test product', 'ea', 0)
    RETURNING id INTO v_product_id;

    INSERT INTO public.suppliers (name) VALUES ('__SMOKE_TEST_VENDOR_A__') RETURNING id INTO v_supplier_a;
    INSERT INTO public.suppliers (name) VALUES ('__SMOKE_TEST_VENDOR_B__') RETURNING id INTO v_supplier_b;

    ---------------------------------------------------------------- 1. insert
    INSERT INTO public.supplier_prices (product_id, supplier_id, unit_cost, unit, is_preferred, notes)
    VALUES (v_product_id, v_supplier_a, 100.0000, 'ea', true, 'smoke test')
    RETURNING id INTO v_price_id;

    out_lines := out_lines || (
      CASE WHEN v_price_id IS NOT NULL THEN 'PASS' ELSE 'FAIL' END
      || ' | insert a supplier price | linked to part ' || v_part);

    ------------------------------------------------- 2. price change + history
    UPDATE public.supplier_prices SET unit_cost = 125.0000 WHERE id = v_price_id;

    SELECT count(*) INTO v_hist_n
    FROM public.supplier_price_history WHERE supplier_price_id = v_price_id;
    out_lines := out_lines || (
      CASE WHEN v_hist_n = 2 THEN 'PASS' ELSE 'FAIL' END
      || ' | price change appends history | ' || v_hist_n || ' row(s), expected 2 (the insert, then the change)');

    SELECT previous_unit_cost INTO v_prev
    FROM public.supplier_price_history
    WHERE supplier_price_id = v_price_id AND previous_unit_cost IS NOT NULL
    ORDER BY recorded_at DESC LIMIT 1;
    out_lines := out_lines || (
      CASE WHEN v_prev = 100.0000 THEN 'PASS' ELSE 'FAIL' END
      || ' | history records the old price | previous_unit_cost = ' || COALESCE(v_prev::text, 'null') || ', expected 100.0000');

    --------------------------------------- 3. a note edit must not move dates
    -- NOT TESTABLE HERE, and reported as SKIP rather than a misleading PASS.
    -- now() returns TRANSACTION start time, so every timestamp written in this
    -- rolled-back test is identical -- an assertion that price_updated_at
    -- "held" would pass even against a broken trigger, and one that updated_at
    -- "moved" can never pass at all. Observing either needs two separate
    -- transactions, which means committed data. This gets verified for real in
    -- the app, where each edit is its own transaction.
    UPDATE public.supplier_prices SET notes = 'typo fixed' WHERE id = v_price_id;
    out_lines := out_lines || 'SKIP | note edit does not move the price date | needs 2 transactions to observe; now() is transaction-scoped'::text;

    SELECT count(*) INTO v_hist_n
    FROM public.supplier_price_history WHERE supplier_price_id = v_price_id;
    out_lines := out_lines || (
      CASE WHEN v_hist_n = 2 THEN 'PASS' ELSE 'FAIL' END
      || ' | note edit adds no history | ' || v_hist_n || ' row(s), expected still 2');

    ------------------------------------------- 4. one preferred vendor per part
    INSERT INTO public.supplier_prices (product_id, supplier_id, unit_cost, is_preferred, notes)
    VALUES (v_product_id, v_supplier_b, 90.0000, true, 'smoke test 2');

    SELECT count(*) FILTER (WHERE is_preferred), count(*) INTO v_pref_n, v_total_n
    FROM public.supplier_prices WHERE product_id = v_product_id;
    out_lines := out_lines || (
      CASE WHEN v_pref_n = 1 THEN 'PASS' ELSE 'FAIL' END
      || ' | only one preferred vendor per product | ' || v_total_n || ' price(s), '
      || v_pref_n || ' preferred, expected exactly 1 (vendor B took over from A)');

    ----------------------------------- 5. marketplace row with no supplier_id
    INSERT INTO public.supplier_prices (product_id, supplier_id, source_label, unit_cost, notes)
    VALUES (v_product_id, NULL, 'Amazon', 88.0000, 'smoke test 3');

    SELECT count(*) INTO v_total_n
    FROM public.supplier_prices WHERE product_id = v_product_id AND supplier_id IS NULL;
    out_lines := out_lines || (
      CASE WHEN v_total_n = 1 THEN 'PASS' ELSE 'FAIL' END
      || ' | marketplace price with no supplier | ' || v_total_n || ' row(s) with source_label and no supplier_id');

    ------------------------------------------------ 6. the view resolves a cost
    SELECT * INTO v_view FROM public.v_products_with_cost WHERE id = v_product_id;
    out_lines := out_lines || (
      CASE WHEN v_view.default_cost IS NOT NULL AND v_view.default_source IS NOT NULL
           THEN 'PASS' ELSE 'FAIL' END
      || ' | view resolves one cost per product | ' || v_view.part_number || ' -> '
      || COALESCE(v_view.default_cost::text, 'null') || ' from ' || COALESCE(v_view.default_source, 'null')
      || ' (' || v_view.price_count || ' price(s), range '
      || COALESCE(v_view.min_cost::text, '-') || ' - ' || COALESCE(v_view.max_cost::text, '-') || ')');

    -- undo everything above
    RAISE EXCEPTION 'smoke-test-rollback';

  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'smoke-test-rollback' THEN
      out_lines := out_lines || ('ERROR | test aborted | ' || SQLERRM);
    END IF;
  END;

  out_lines := out_lines || 'INFO | all test data rolled back | nothing was left in the database, including the throwaway product and vendors'::text;
  RETURN QUERY SELECT unnest(out_lines);
END $fn$;

SELECT * FROM pg_temp.smoke_supplier_prices() AS "check";
