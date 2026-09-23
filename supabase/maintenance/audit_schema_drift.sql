-- ============================================================================
-- SCHEMA DRIFT AUDIT — read-only. Safe to run against production any time.
-- ============================================================================
-- Why this exists: the schema reached the live project via Lovable's own sync
-- rather than the Supabase CLI for a long stretch, so the CLI's own migration
-- ledger (supabase_migrations.schema_migrations) tracked nothing even though
-- the schema itself was current. Two objects were found missing this way and
-- had to be recreated by hand (20260908231923 on_auth_user_created,
-- 20260908233520 trg_poi_sync_slip_qty) — both silent: no error, just wrong
-- data. This script asserts that every function, trigger, view, enum value
-- and bucket the repo's 58 migrations expect actually exists live.
--
-- 2026-09-09: the ledger itself was reconciled — `supabase migration repair
-- --status applied` was run for all 58 versions after this script came back
-- clean (aside from the one already-tracked ticket_status.closed gap below),
-- so `supabase migration list` now shows local == remote throughout. This
-- script stays useful regardless: the ledger only proves the CLI *thinks*
-- everything is applied, not that the objects are still there — it doesn't
-- protect against a future direct SQL edit (Lovable's sync or otherwise)
-- dropping or altering something after the fact.
--
-- Run in the Supabase SQL Editor. Every section returns only MISSING rows —
-- an empty result for all six sections means no drift.
-- ============================================================================


-- ── 1. FUNCTIONS ────────────────────────────────────────────────────────────
-- 39 functions defined across the migrations. A missing SECURITY DEFINER RPC
-- surfaces as a runtime "function does not exist" error; a missing trigger
-- function is worse — see section 2.
--
-- Not listed: gen_po_number(), profiles_directory and v_borrow_project_options
-- (section 3) were all created by an earlier migration and deliberately
-- DROPped by a later one in the same history — superseded by
-- create_purchase_order(), then removed one migration later, and by
-- v_project_directory respectively. A first run of this audit flagged all
-- three as "missing," which sent a false-positive chase before the DROPs
-- were found (2026-09-09) — they were never a gap, just objects this
-- script's expected-list didn't know had been retired on purpose.
SELECT 'MISSING FUNCTION' AS problem, expected AS name
FROM unnest(ARRAY[
  'borrow_notify_recipients','can_modify_po','can_see_project','can_write',
  'can_write_project','check_slip_serial_unique','clear_other_preferred_prices',
  'create_packing_slip','create_purchase_order','create_shipping_ticket',
  'decide_borrow_request','delete_packing_slip','delete_purchase_order',
  'delete_shipping_ticket','enforce_po_edit_guard','enforce_po_status_transition',
  'gen_ticket_number','handle_new_user','has_any_role','has_role',
  'is_admin','is_warehouse_or_admin','manages_project','notify_borrow_request',
  'record_supplier_price_change','resync_slip_item_serial_product',
  'resync_ticket_item_serial_product','return_borrowed_stock',
  'reverse_shipping_ticket_inventory','set_updated_at','set_user_role',
  'ship_shipping_ticket_inventory','slip_serial_defaults',
  'stamp_supplier_price_updated','sync_packing_slip_inventory',
  'sync_packing_slip_item_qty_ordered','sync_project_manager_assignment',
  'sync_user_directory','ticket_serial_defaults'
]) AS expected
WHERE NOT EXISTS (
  SELECT 1 FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = expected
);


-- ── 2. TRIGGERS ─────────────────────────────────────────────────────────────
-- The highest-risk section. A trigger function can exist while its trigger
-- does not — exactly the trg_poi_sync_slip_qty case. Nothing errors; the
-- data just quietly goes wrong. Both objects already lost this way live here.
SELECT 'MISSING TRIGGER' AS problem, expected AS name
FROM unnest(ARRAY[
  'on_auth_user_created','profiles_sync_user_directory','trg_borrow_notify',
  'trg_po_edit_guard','trg_po_status_transition','trg_po_upd',
  'trg_poi_sync_slip_qty','trg_products_upd','trg_profiles_upd',
  'trg_projects_sync_pm','trg_projects_upd','trg_psi_product_resync',
  'trg_psis_10_defaults','trg_psis_20_unique','trg_st_upd',
  'trg_sti_product_resync','trg_stis_10_defaults','trg_supplier_prices_history',
  'trg_supplier_prices_one_preferred','trg_supplier_prices_stamp',
  'trg_supplier_prices_upd','trg_suppliers_upd'
]) AS expected
WHERE NOT EXISTS (
  SELECT 1 FROM pg_trigger t
  WHERE NOT t.tgisinternal AND t.tgname = expected
);


-- ── 3. VIEWS ────────────────────────────────────────────────────────────────
-- L-01 was a missing view: the query threw, React Query swallowed it, and every
-- Inventory card silently rendered "—" for days.
--
-- Not listed: profiles_directory and v_borrow_project_options — see the note
-- on section 1. Both were intentionally DROPped by a later migration than the
-- one that created them, so they are not expected to exist live.
SELECT 'MISSING VIEW' AS problem, expected AS name
FROM unnest(ARRAY[
  'v_products_with_cost','v_project_directory','v_project_inventory',
  'v_project_last_updated','v_project_serials','v_user_roles'
]) AS expected
WHERE NOT EXISTS (
  SELECT 1 FROM pg_views  WHERE schemaname = 'public' AND viewname = expected
  UNION ALL
  SELECT 1 FROM pg_matviews WHERE schemaname = 'public' AND matviewname = expected
);


-- ── 4. ENUM VALUES ──────────────────────────────────────────────────────────
-- Enum values added by a later ALTER TYPE are easy to lose in a sync.
-- ticket_status.'closed' (F-13 / L-07) was exactly this kind of gap — the
-- frontend listed it in SHIPPING_TICKET_STATUSES and the edit/delete guards
-- already treated it as a real terminal state, but no migration had ever
-- added it. Fixed 2026-09-10 by migration 20260910012232. Left in this list
-- so a future sync that drops it again doesn't go unnoticed a second time.
SELECT 'MISSING ENUM VALUE' AS problem, e.typname || '.' || e.val AS name
FROM (VALUES
  ('borrow_status','cancelled'),
  ('borrow_status','partially_returned'),
  ('borrow_status','returned'),
  ('ticket_status','closed')
) AS e(typname, val)
WHERE NOT EXISTS (
  SELECT 1 FROM pg_enum en
  JOIN pg_type ty ON ty.oid = en.enumtypid
  WHERE ty.typname = e.typname AND en.enumlabel = e.val
);


-- ── 5. STORAGE BUCKETS ──────────────────────────────────────────────────────
-- L-08: a bucket was missing entirely. Note storage's list endpoint returns
-- 200 [] for a bucket that does not exist, so only this table (or an upload
-- attempt) is authoritative.
SELECT 'MISSING BUCKET' AS problem, expected AS name
FROM unnest(ARRAY[
  'packing-slip-attachments','shipping-ticket-proofs'
]) AS expected
WHERE NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = expected);


-- ── 6. RLS ENABLED ON EVERY BUSINESS TABLE ──────────────────────────────────
-- A table that arrives without RLS is readable by every authenticated user.
SELECT 'RLS DISABLED' AS problem, c.relname AS name
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND NOT c.relrowsecurity;


-- ── 7. STALE PROJECT MANAGERS (F-07 back-fill, data not schema) ─────────────
-- The F-07 trigger only fires on an actual change to project_manager_id, so
-- rows predating it were never cleaned. L-10 found three managers on one
-- project. Any row here is someone holding write access they may not warrant —
-- review before real data goes in, then DELETE the ones that are wrong.
SELECT 'EXTRA PROJECT MANAGER' AS problem,
       p.mkj_number, pm.user_id, ud.full_name
FROM public.project_managers pm
JOIN public.projects p ON p.id = pm.project_id
LEFT JOIN public.user_directory ud ON ud.id = pm.user_id
WHERE pm.user_id IS DISTINCT FROM p.project_manager_id;
