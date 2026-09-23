-- ============================================================
-- MKJ OPS — DEMO DATA TEARDOWN (stakeholder demo, September 2026)
-- ============================================================
-- Removes everything seed_demo_data.sql created, and nothing else:
--   * the 3 demo accounts (ids d0000000-de00-4000-8000-0000000001xx)
--   * projects 2403 and 2601 created by the seed (ids ...-0000000002xx)
--     and everything recorded against them: POs, packing slips, shipping
--     tickets, borrow requests, PO requests, build requests, stock —
--     including anything added to those two projects DURING the demo
--   * the 4 demo suppliers (...-0000000003xx) and 15 demo products
--     (...-0000000004xx), with their prices and price history
--   * the 2 demo systems CCTV-WALL-8P and ACS-2DR (imported by the demo
--     warehouse account) and their finished products
--   * notifications about any of the above, including the ones sent to
--     real admins
--
-- Everything is matched by id, never by project number or name, so a real
-- project numbered 2403 or 2601 can't be touched (while the demo projects
-- exist, the app won't let anyone create a real one with those numbers).
--
-- If real data got attached to demo rows during the demo — a real
-- project's PO using a demo product or supplier, a demo product added to a
-- real system, something a demo account created on a real project — a
-- foreign key stops the delete and NOTHING is removed. The error names the
-- constraint: fix or delete that row, then run this again.
--
-- HOW TO RUN: paste into the Supabase SQL Editor and run once. Running it
-- a second time is harmless (it finds nothing to delete).
-- ============================================================

BEGIN;

CREATE TEMP TABLE demo_users ON COMMIT DROP AS
  SELECT id FROM auth.users WHERE id::text LIKE 'd0000000-de00-4000-8000-%';

CREATE TEMP TABLE demo_projects ON COMMIT DROP AS
  SELECT id FROM public.projects WHERE id::text LIKE 'd0000000-de00-4000-8000-%';

CREATE TEMP TABLE demo_templates ON COMMIT DROP AS
  SELECT id, finished_product_id FROM public.system_templates
  WHERE system_code IN ('CCTV-WALL-8P', 'ACS-2DR')
    AND created_by IN (SELECT id FROM demo_users);

-- Every record a notification link can point at
-- (/borrow-requests?request=<id>, /purchase-orders?request=<id>,
-- /manufacturing/<id>, ...).
CREATE TEMP TABLE demo_linked ON COMMIT DROP AS
  SELECT id::text AS id FROM public.borrow_requests
    WHERE source_project_id IN (SELECT id FROM demo_projects)
       OR target_project_id IN (SELECT id FROM demo_projects)
  UNION ALL SELECT id::text FROM public.po_requests      WHERE project_id IN (SELECT id FROM demo_projects)
  UNION ALL SELECT id::text FROM public.build_requests   WHERE project_id IN (SELECT id FROM demo_projects)
  UNION ALL SELECT id::text FROM public.purchase_orders  WHERE project_id IN (SELECT id FROM demo_projects)
  UNION ALL SELECT id::text FROM public.packing_slips    WHERE project_id IN (SELECT id FROM demo_projects)
  UNION ALL SELECT id::text FROM public.shipping_tickets WHERE project_id IN (SELECT id FROM demo_projects);

-- 1. Notifications: the demo accounts' own, plus the ones real admins got
--    about demo records.
DELETE FROM public.notifications n
WHERE n.recipient_user_id IN (SELECT id FROM demo_users)
   OR EXISTS (SELECT 1 FROM demo_linked d WHERE n.link LIKE '%' || d.id || '%');

-- 2. Stock ledger (RESTRICT -> products).
DELETE FROM public.inventory_adjustments WHERE project_id IN (SELECT id FROM demo_projects);

-- 3. Manufacturing. Finished units first (RESTRICT -> build_requests);
--    lines, used serials and history cascade from the request.
DELETE FROM public.build_units    WHERE project_id IN (SELECT id FROM demo_projects);
DELETE FROM public.build_requests WHERE project_id IN (SELECT id FROM demo_projects);

-- 4. Borrow requests (lent serials cascade).
DELETE FROM public.borrow_requests
WHERE source_project_id IN (SELECT id FROM demo_projects)
   OR target_project_id IN (SELECT id FROM demo_projects);

-- 5. Shipping tickets (items, serials, cached PDF rows cascade).
DELETE FROM public.shipping_tickets WHERE project_id IN (SELECT id FROM demo_projects);

-- 6. Packing slips (items, serials cascade). Before POs: RESTRICT.
DELETE FROM public.packing_slips WHERE project_id IN (SELECT id FROM demo_projects);

-- 7. Purchase orders (items, cached PDF rows cascade).
DELETE FROM public.purchase_orders WHERE project_id IN (SELECT id FROM demo_projects);

-- 8. PO requests (lines cascade).
DELETE FROM public.po_requests WHERE project_id IN (SELECT id FROM demo_projects);

-- 9. Demo systems (parts cascade), then the catalog. Prices on demo
--    products cascade with the product; a demo supplier's price on a real
--    product is removed explicitly (RESTRICT -> suppliers).
DELETE FROM public.system_templates WHERE id IN (SELECT id FROM demo_templates);
DELETE FROM public.supplier_prices WHERE supplier_id::text LIKE 'd0000000-de00-4000-8000-%';
DELETE FROM public.products
WHERE id::text LIKE 'd0000000-de00-4000-8000-%'
   OR id IN (SELECT finished_product_id FROM demo_templates);
DELETE FROM public.suppliers WHERE id::text LIKE 'd0000000-de00-4000-8000-%';

-- 10. Projects (manager/engineer assignments cascade).
DELETE FROM public.projects WHERE id IN (SELECT id FROM demo_projects);

-- 11. Demo accounts (profiles, roles, identities, sessions cascade).
DELETE FROM auth.users WHERE id IN (SELECT id FROM demo_users);

COMMIT;

-- ============================================================
-- Check: every count must be 0.
-- ============================================================
SELECT 'demo accounts' AS what, count(*) FROM auth.users WHERE id::text LIKE 'd0000000-de00-4000-8000-%'
UNION ALL SELECT 'demo projects',  count(*) FROM public.projects  WHERE id::text LIKE 'd0000000-de00-4000-8000-%'
UNION ALL SELECT 'demo suppliers', count(*) FROM public.suppliers WHERE id::text LIKE 'd0000000-de00-4000-8000-%'
UNION ALL SELECT 'demo products',  count(*) FROM public.products  WHERE id::text LIKE 'd0000000-de00-4000-8000-%'
UNION ALL SELECT 'demo systems',   count(*) FROM public.system_templates WHERE system_code IN ('CCTV-WALL-8P', 'ACS-2DR');
