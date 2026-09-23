-- ============================================================
-- MKJ OPS — DEMO DATA SEED (stakeholder demo, September 2026)
-- ============================================================
-- Adds a small, coherent data set to production so every feature has
-- something to show: 3 demo accounts, projects 2403 and 2601, suppliers,
-- products with prices, 2 manufacturing systems, PO requests, purchase
-- orders, packing slips (with serials), stock, build requests, shipping
-- tickets, borrow requests and the notifications they send. README.md in
-- this folder lists all of it and what to click during the demo.
--
-- Every step calls the same database functions the app's buttons call,
-- acting as the demo account that would really do it (auth.uid() comes
-- from request.jwt.claims, set per step, local to this transaction).
-- Table writes the browser makes directly (PO lines, slip and ticket
-- lines, serials, borrow requests, prices, status changes) run as the
-- authenticated role, so row level security checks them too. Numbering,
-- stock, held stock, serial locations and notifications come out exactly
-- as the app would produce them.
--
-- Rows get fixed ids starting d0000000-de00-4000-8000- (accounts 1xx,
-- projects 2xx, suppliers 3xx, products 4xx); everything else hangs off
-- the two demo projects. teardown_demo_data.sql relies on this.
--
-- Everything written in one transaction carries the same timestamp.
-- After each step, pg_temp.demo_stamp moves what that step wrote back to
-- when it "happened", so the demo reads as four weeks of work.
--
-- The accounts get a random password nobody knows. Set one with the
-- snippet in README.md.
--
-- HOW TO RUN: paste into the Supabase SQL Editor and run once. It's one
-- transaction: if any step fails, nothing is kept. A second run fails on
-- the project numbers before writing anything; run the teardown first.
-- ============================================================

BEGIN;

-- (days ago, local time) -> timestamptz in the business timezone.
CREATE FUNCTION pg_temp.demo_at(_days_ago integer, _time text)
RETURNS timestamptz LANGUAGE sql STABLE AS $$
  SELECT (((now() AT TIME ZONE 'America/New_York')::date - _days_ago) + _time::time)
         AT TIME ZONE 'America/New_York'
$$;

-- Moves every timestamp the last step wrote (= now(), this transaction's
-- start) to _ts. Earlier steps' rows were already moved, so they no longer
-- match, and no row outside this transaction can. updated_at columns are
-- left alone: their triggers reset them to now() on any update.
CREATE FUNCTION pg_temp.demo_stamp(_ts timestamptz)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  _col text;
BEGIN
  FOREACH _col IN ARRAY ARRAY[
    'profiles.created_at', 'user_roles.created_at', 'projects.created_at',
    'suppliers.created_at', 'products.created_at',
    'supplier_prices.created_at', 'supplier_price_history.recorded_at',
    'system_templates.created_at',
    'po_requests.created_at', 'po_requests.completed_at',
    'purchase_orders.created_at',
    'packing_slips.created_at', 'packing_slip_item_serials.created_at',
    'shipping_tickets.created_at', 'shipping_ticket_item_serials.created_at',
    'borrow_requests.created_at', 'borrow_requests.decided_at',
    'borrow_requests.fulfilled_at', 'borrow_requests.returned_at',
    'borrow_request_serials.lent_at', 'borrow_request_serials.returned_at',
    'build_requests.created_at', 'build_requests.submitted_at',
    'build_requests.started_at', 'build_requests.completed_at',
    'build_request_events.created_at', 'build_line_serials.consumed_at',
    'build_units.created_at',
    'inventory_adjustments.created_at', 'notifications.created_at'
  ] LOOP
    EXECUTE format('UPDATE public.%1$I SET %2$I = $1 WHERE %2$I = now()',
                   split_part(_col, '.', 1), split_part(_col, '.', 2))
    USING _ts;
  END LOOP;
END $$;

DO $seed$
DECLARE
  _admin     uuid := (SELECT id FROM auth.users WHERE email = 'cesarhmcod@gmail.com');

  _laura     uuid := 'd0000000-de00-4000-8000-000000000101';  -- manager, 2403
  _david     uuid := 'd0000000-de00-4000-8000-000000000102';  -- manager, 2601
  _marcus    uuid := 'd0000000-de00-4000-8000-000000000103';  -- warehouse manager
  _as_laura  text := json_build_object('sub', _laura,  'role', 'authenticated')::text;
  _as_david  text := json_build_object('sub', _david,  'role', 'authenticated')::text;
  _as_marcus text := json_build_object('sub', _marcus, 'role', 'authenticated')::text;

  _p2403     uuid := 'd0000000-de00-4000-8000-000000000201';
  _p2601     uuid := 'd0000000-de00-4000-8000-000000000202';

  _summit    uuid := 'd0000000-de00-4000-8000-000000000301';
  _meridian  uuid := 'd0000000-de00-4000-8000-000000000302';
  _harbor    uuid := 'd0000000-de00-4000-8000-000000000303';
  _northgate uuid := 'd0000000-de00-4000-8000-000000000304';

  _enc       uuid := 'd0000000-de00-4000-8000-000000000401';
  _sw        uuid := 'd0000000-de00-4000-8000-000000000402';
  _psu       uuid := 'd0000000-de00-4000-8000-000000000403';
  _pp        uuid := 'd0000000-de00-4000-8000-000000000404';
  _pc        uuid := 'd0000000-de00-4000-8000-000000000405';
  _tb        uuid := 'd0000000-de00-4000-8000-000000000406';
  _ct        uuid := 'd0000000-de00-4000-8000-000000000407';
  _dome      uuid := 'd0000000-de00-4000-8000-000000000408';
  _bullet    uuid := 'd0000000-de00-4000-8000-000000000409';
  _acp       uuid := 'd0000000-de00-4000-8000-000000000410';
  _rdr       uuid := 'd0000000-de00-4000-8000-000000000411';
  _fo        uuid := 'd0000000-de00-4000-8000-000000000412';
  _ups       uuid := 'd0000000-de00-4000-8000-000000000413';
  _pdu       uuid := 'd0000000-de00-4000-8000-000000000414';
  _cab       uuid := 'd0000000-de00-4000-8000-000000000415';

  _mkj_address text := E'MKJ Communications\n850 3rd Ave., #407\nBrooklyn, NY 11232';
  _today     date := (now() AT TIME ZONE 'America/New_York')::date;

  _cctv          uuid;  -- system CCTV-WALL-8P
  _acs           uuid;  -- system ACS-2DR
  _cctv_product  uuid;  -- its finished product
  _req_2403_cams uuid;
  _req_2601_mdf  uuid;
  _po_2403_cab   uuid;
  _po_2403_sec   uuid;
  _po_2601_cab   uuid;
  _mfg_2403_cab  uuid;
  _mfg_2601_cab  uuid;
  _borrow_fiber  uuid;
  _borrow_domes  uuid;

  _po     public.purchase_orders;
  _req    public.po_requests;
  _slip   public.packing_slips;
  _ticket public.shipping_tickets;
  _build  public.build_requests;
  _item   uuid;
BEGIN
  -- =================================================================
  -- 30 days ago — accounts, projects, suppliers, catalog (as postgres,
  -- like an admin setting things up)
  -- =================================================================
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  )
  SELECT '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
         extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')),  -- set a real one via README.md
         pg_temp.demo_at(30, '09:00'),
         '{"provider": "email", "providers": ["email"]}'::jsonb,
         jsonb_build_object('sub', u.id::text, 'email', u.email, 'full_name', u.full_name,
                            'email_verified', true, 'phone_verified', false),
         pg_temp.demo_at(30, '09:00'), pg_temp.demo_at(30, '09:00'),
         '', '', '', ''
  FROM (VALUES
    (_laura,  'pm2403.demo@example.com',    'Laura Mendez'),
    (_david,  'pm2601.demo@example.com',    'David Chen'),
    (_marcus, 'warehouse.demo@example.com', 'Marcus Reyes')
  ) AS u(id, email, full_name);

  INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
  SELECT u.id::text, u.id,
         jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true, 'phone_verified', false),
         'email', u.created_at, u.created_at
  FROM auth.users u
  WHERE u.id IN (_laura, _david, _marcus);

  -- Profiles come from the on_auth_user_created trigger.
  INSERT INTO public.user_roles (user_id, role) VALUES
    (_laura, 'manager'), (_david, 'manager'), (_marcus, 'warehouse_manager');

  -- project_manager_id also fills project_managers (trg_projects_sync_pm).
  INSERT INTO public.projects (id, mkj_number, name, description, contract_number, status, created_by, project_manager_id) VALUES
    (_p2403, '2403', 'Riverside Transit Center',
     'CCTV, access control and network upgrade across the platform and concourse levels.',
     'RTC-2024-117', 'active', _admin, _laura),
    (_p2601, '2601', 'Harbor Point Medical Campus',
     'Security and communications systems for the new east wing.',
     'HPM-2026-044', 'active', _admin, _david);

  INSERT INTO public.suppliers (id, name, address, phone, contact_name, email) VALUES
    (_summit,    'Summit Electrical Supply',       '4100 Industrial Pkwy, Newark, NJ 07105',    '(973) 555-0142', 'Dana Ruiz',     'orders@summit-electrical.example.com'),
    (_meridian,  'Meridian Security Distribution', '900 Panel Row, Long Island City, NY 11101', '(718) 555-0163', 'Ben Ostrander', 'sales@meridian-security.example.com'),
    (_harbor,    'Harbor Fiber & Cable Co.',       '221 Dockside Ave, Staten Island, NY 10301', '(718) 555-0187', 'Mike Ferris',   'mike@harborfiber.example.com'),
    (_northgate, 'Northgate Rack Systems',         '77 Enclosure Way, Elizabeth, NJ 07201',     '(908) 555-0119', 'Priya Nair',    'priya@northgate-racks.example.com');

  INSERT INTO public.products (id, part_number, description, unit, reorder_point, is_serialized) VALUES
    (_enc,    'ENC-WM-24',      'Wall-mount steel enclosure, NEMA 4X, 24 x 20 x 8 in', 'ea',   2, false),
    (_sw,     'SW-IND-8P',      'Industrial PoE+ switch, 8-port gigabit, DIN-rail',    'ea',   2, true),
    (_psu,    'PSU-12V-4A',     'Power supply, 12 VDC 4 A, with battery backup',       'ea',   4, false),
    (_pp,     'PP-CAT6-24',     'Cat6 patch panel, 24-port, 1U',                       'ea',   2, false),
    (_pc,     'PC-CAT6-3',      'Cat6 patch cord, 3 ft, blue',                         'ea',  20, false),
    (_tb,     'TB-DIN-2P',      'DIN-rail terminal block, 2-position',                 'ea',  25, false),
    (_ct,     'CT-8IN-100',     'Cable ties, 8 in, UV-rated (bag of 100)',             'bag',  2, false),
    (_dome,   'CAM-DOME-4MP',   'IP dome camera, 4 MP, outdoor, vandal-resistant',     'ea',   4, true),
    (_bullet, 'CAM-BULLET-8MP', 'IP bullet camera, 8 MP, 30 m IR',                     'ea',   2, true),
    (_acp,    'ACP-2DR',        'Access control panel, 2-door, networked',             'ea',   1, true),
    (_rdr,    'RDR-MULTI',      'Multi-technology card reader (prox + smart card)',    'ea',   4, false),
    (_fo,     'FO-LC-SM-2M',    'Fiber patch cord, single-mode LC/LC duplex, 2 m',     'ea',  12, false),
    (_ups,    'UPS-1500-RM',    'UPS, 1500 VA, rack-mount, line-interactive',          'ea',   1, true),
    (_pdu,    'PDU-8-RM',       'Rack PDU, 8 outlets, 1U',                             'ea',   2, false),
    (_cab,    'CAB-FLR-42U',    'Floor-standing network cabinet, 42U, 600 x 1000 mm',  'ea',   0, false);

  PERFORM pg_temp.demo_stamp(pg_temp.demo_at(30, '09:00'));

  -- =================================================================
  -- 29 days ago — Marcus loads supplier prices
  -- =================================================================
  PERFORM set_config('request.jwt.claims', _as_marcus, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.supplier_prices (product_id, supplier_id, supplier_sku, unit_cost, unit, is_preferred, created_by) VALUES
    (_enc,    _summit,    'SES-NX4-24208', 412.00,  'ea',  true,  _marcus),
    (_sw,     _summit,    'SES-IPS8G-DR',  689.00,  'ea',  true,  _marcus),
    (_sw,     _harbor,    'HFC-8PGE-IND',  715.50,  'ea',  false, _marcus),
    (_psu,    _summit,    'SES-PS124-BB',   96.40,  'ea',  true,  _marcus),
    (_pp,     _summit,    'SES-PP6-24',     58.75,  'ea',  true,  _marcus),
    (_pp,     _harbor,    'HFC-C6PP24',     54.90,  'ea',  false, _marcus),
    (_pc,     _summit,    'SES-C6PC-03B',    3.85,  'ea',  true,  _marcus),
    (_tb,     _summit,    'SES-TB2-DIN',     1.42,  'ea',  true,  _marcus),
    (_ct,     _summit,    'SES-CT8-UV',     11.60,  'bag', true,  _marcus),
    (_dome,   _meridian,  'MSD-D4MP-OD',   329.00,  'ea',  true,  _marcus),
    (_bullet, _meridian,  'MSD-B8MP-IR',   468.00,  'ea',  true,  _marcus),
    (_acp,    _meridian,  'MSD-AC2D-NET', 1245.00,  'ea',  true,  _marcus),
    (_rdr,    _meridian,  'MSD-RDR-MT',    186.00,  'ea',  true,  _marcus),
    (_fo,     _harbor,    'HFC-LCLC-SM2',    9.80,  'ea',  true,  _marcus),
    (_fo,     _summit,    'SES-FLC-SM2',    10.25,  'ea',  false, _marcus),
    (_ups,    _northgate, 'NRS-UPS15-RM',  845.00,  'ea',  true,  _marcus),
    (_pdu,    _northgate, 'NRS-PDU8-1U',   132.50,  'ea',  true,  _marcus),
    (_cab,    _northgate, 'NRS-42U-6010', 1580.00,  'ea',  true,  _marcus);
  SET LOCAL ROLE NONE;
  PERFORM pg_temp.demo_stamp(pg_temp.demo_at(29, '10:15'));

  -- =================================================================
  -- 28 days ago — Marcus imports the two standard systems
  -- =================================================================
  PERFORM set_config('request.jwt.claims', _as_marcus, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.import_system_templates(
    '[{"system_code": "CCTV-WALL-8P", "name": "CCTV wall cabinet, 8 cameras", "category": "cctv_cabinet",
       "description": "Wall-mount CCTV cabinet: 8-port PoE switch, patch panel and battery-backed power for up to 8 cameras"},
      {"system_code": "ACS-2DR", "name": "Access control panel, 2 doors", "category": "access_control",
       "description": "Networked 2-door access control panel with two card readers and backup power"}]'::jsonb,
    '[{"system_code": "CCTV-WALL-8P", "part_number": "ENC-WM-24",  "qty_per_system": 1, "is_key_part": true},
      {"system_code": "CCTV-WALL-8P", "part_number": "SW-IND-8P",  "qty_per_system": 1, "is_key_part": true},
      {"system_code": "CCTV-WALL-8P", "part_number": "PSU-12V-4A", "qty_per_system": 1, "is_key_part": false},
      {"system_code": "CCTV-WALL-8P", "part_number": "PP-CAT6-24", "qty_per_system": 1, "is_key_part": false},
      {"system_code": "CCTV-WALL-8P", "part_number": "PC-CAT6-3",  "qty_per_system": 8, "is_key_part": false, "notes": "One per camera port"},
      {"system_code": "CCTV-WALL-8P", "part_number": "TB-DIN-2P",  "qty_per_system": 6, "is_key_part": false},
      {"system_code": "CCTV-WALL-8P", "part_number": "CT-8IN-100", "qty_per_system": 1, "is_key_part": false},
      {"system_code": "ACS-2DR", "part_number": "ACP-2DR",    "qty_per_system": 1, "is_key_part": true},
      {"system_code": "ACS-2DR", "part_number": "RDR-MULTI",  "qty_per_system": 2, "is_key_part": false, "notes": "One per door"},
      {"system_code": "ACS-2DR", "part_number": "PSU-12V-4A", "qty_per_system": 1, "is_key_part": false},
      {"system_code": "ACS-2DR", "part_number": "TB-DIN-2P",  "qty_per_system": 4, "is_key_part": false},
      {"system_code": "ACS-2DR", "part_number": "CT-8IN-100", "qty_per_system": 1, "is_key_part": false}]'::jsonb,
    false);
  SELECT id, finished_product_id INTO _cctv, _cctv_product FROM public.system_templates WHERE system_code = 'CCTV-WALL-8P';
  SELECT id INTO _acs FROM public.system_templates WHERE system_code = 'ACS-2DR';
  SET LOCAL ROLE NONE;
  PERFORM pg_temp.demo_stamp(pg_temp.demo_at(28, '14:00'));

  -- =================================================================
  -- 26 days ago — Laura asks for cameras and door controllers
  -- =================================================================
  PERFORM set_config('request.jwt.claims', _as_laura, true);
  SET LOCAL ROLE authenticated;
  _req := public.create_po_request(_p2403,
    'Cameras and door controllers for the platform level. Meridian has the best lead time.',
    jsonb_build_array(
      jsonb_build_object('product_id', _dome,   'qty', 12),
      jsonb_build_object('product_id', _bullet, 'qty', 6),
      jsonb_build_object('product_id', _acp,    'qty', 2)));
  _req_2403_cams := _req.id;
  SET LOCAL ROLE NONE;
  PERFORM pg_temp.demo_stamp(pg_temp.demo_at(26, '09:20'));

  -- =================================================================
  -- 25 days ago — Marcus orders the CCTV cabinet parts for 2403
  -- =================================================================
  PERFORM set_config('request.jwt.claims', _as_marcus, true);
  SET LOCAL ROLE authenticated;
  _po := public.create_purchase_order(_p2403, _summit, _mkj_address, _mkj_address, _today - 18,
    'Supplier truck', 'Net 30', 'CCTV wall cabinet components for the platform level (2 cabinets + spares)',
    _marcus, 0, NULL, NULL);
  _po_2403_cab := _po.id;
  INSERT INTO public.purchase_order_items (po_id, line_no, budget_code, product_id, description, qty, unit, unit_cost)
  SELECT _po.id, v.line_no, v.budget, p.id, p.description, v.qty, p.unit, v.cost
  FROM (VALUES (1, '2403-CCTV', _enc, 3, 412.00), (2, '2403-CCTV', _sw, 3, 689.00), (3, '2403-CCTV', _psu, 4, 96.40),
               (4, '2403-CCTV', _pp, 3, 58.75),   (5, '2403-CCTV', _pc, 24, 3.85),  (6, '2403-CCTV', _tb, 30, 1.42),
               (7, '2403-CCTV', _ct, 5, 11.60)) AS v(line_no, budget, product_id, qty, cost)
  JOIN public.products p ON p.id = v.product_id;
  UPDATE public.purchase_orders SET status = 'approved' WHERE id = _po.id;
  UPDATE public.purchase_orders SET status = 'executed' WHERE id = _po.id;
  SET LOCAL ROLE NONE;
  PERFORM pg_temp.demo_stamp(pg_temp.demo_at(25, '11:05'));

  -- =================================================================
  -- 24 days ago — Marcus turns Laura's request into a PO and closes it
  -- =================================================================
  PERFORM set_config('request.jwt.claims', _as_marcus, true);
  SET LOCAL ROLE authenticated;
  _po := public.create_purchase_order(_p2403, _meridian, _mkj_address, _mkj_address, _today - 12,
    'FedEx Ground', 'Net 30', 'IP cameras and access control panels, per REQ-2403-001',
    _marcus, 45.00, NULL, NULL);
  _po_2403_sec := _po.id;
  INSERT INTO public.purchase_order_items (po_id, line_no, budget_code, product_id, description, qty, unit, unit_cost)
  SELECT _po.id, v.line_no, v.budget, p.id, p.description, v.qty, p.unit, v.cost
  FROM (VALUES (1, '2403-SEC', _dome, 12, 329.00), (2, '2403-SEC', _bullet, 6, 468.00),
               (3, '2403-SEC', _acp, 2, 1245.00)) AS v(line_no, budget, product_id, qty, cost)
  JOIN public.products p ON p.id = v.product_id;
  UPDATE public.purchase_orders SET status = 'approved' WHERE id = _po.id;
  UPDATE public.purchase_orders SET status = 'executed' WHERE id = _po.id;
  PERFORM public.complete_po_request(_req_2403_cams, _po.po_number);
  SET LOCAL ROLE NONE;
  PERFORM pg_temp.demo_stamp(pg_temp.demo_at(24, '10:30'));

  -- =================================================================
  -- 22 days ago — Marcus orders cabinet parts and fiber for 2601
  -- =================================================================
  PERFORM set_config('request.jwt.claims', _as_marcus, true);
  SET LOCAL ROLE authenticated;
  _po := public.create_purchase_order(_p2601, _summit, _mkj_address, _mkj_address, _today - 16,
    'Supplier truck', 'Net 30', 'CCTV cabinet components and single-mode fiber patch cords for the east wing',
    _marcus, 0, NULL, NULL);
  _po_2601_cab := _po.id;
  INSERT INTO public.purchase_order_items (po_id, line_no, budget_code, product_id, description, qty, unit, unit_cost)
  SELECT _po.id, v.line_no, v.budget, p.id, p.description, v.qty, p.unit, v.cost
  FROM (VALUES (1, '2601-CCTV', _enc, 2, 412.00), (2, '2601-CCTV', _sw, 2, 689.00), (3, '2601-CCTV', _psu, 3, 96.40),
               (4, '2601-CCTV', _pp, 2, 58.75),   (5, '2601-CCTV', _pc, 16, 3.85),  (6, '2601-CCTV', _tb, 20, 1.42),
               (7, '2601-CCTV', _ct, 4, 11.60),   (8, '2601-FIBER', _fo, 24, 10.25)) AS v(line_no, budget, product_id, qty, cost)
  JOIN public.products p ON p.id = v.product_id;
  UPDATE public.purchase_orders SET status = 'approved' WHERE id = _po.id;
  UPDATE public.purchase_orders SET status = 'executed' WHERE id = _po.id;
  SET LOCAL ROLE NONE;
  PERFORM pg_temp.demo_stamp(pg_temp.demo_at(22, '13:45'));

  -- =================================================================
  -- 18 days ago — 2403's cabinet parts arrive, switches by serial
  -- =================================================================
  PERFORM set_config('request.jwt.claims', _as_marcus, true);
  SET LOCAL ROLE authenticated;
  _slip := public.create_packing_slip(_po_2403_cab, _p2403, _today - 18, 'Supplier truck', 'SES-DN-448120',
    'All lines complete, no damage.', 'received');
  INSERT INTO public.packing_slip_items (slip_id, po_item_id, product_id, description, qty_ordered, qty_received, condition)
  SELECT _slip.id, i.id, i.product_id, i.description, i.qty, i.qty, 'ok'
  FROM public.purchase_order_items i WHERE i.po_id = _po_2403_cab ORDER BY i.line_no;
  INSERT INTO public.packing_slip_item_serials (slip_item_id, serial)
  SELECT si.id, s.serial
  FROM public.packing_slip_items si
  CROSS JOIN unnest(ARRAY['EW8P-24A0117', 'EW8P-24A0118', 'EW8P-24A0121']) AS s(serial)
  WHERE si.slip_id = _slip.id AND si.product_id = _sw;
  PERFORM public.sync_packing_slip_inventory(_slip.id);
  PERFORM public.refresh_po_status(_po_2403_cab);
  SET LOCAL ROLE NONE;
  PERFORM pg_temp.demo_stamp(pg_temp.demo_at(18, '10:10'));

  -- =================================================================
  -- 16 days ago — 2601's cabinet parts and fiber arrive
  -- =================================================================
  PERFORM set_config('request.jwt.claims', _as_marcus, true);
  SET LOCAL ROLE authenticated;
  _slip := public.create_packing_slip(_po_2601_cab, _p2601, _today - 16, 'Supplier truck', 'SES-DN-449377',
    'Complete delivery.', 'received');
  INSERT INTO public.packing_slip_items (slip_id, po_item_id, product_id, description, qty_ordered, qty_received, condition)
  SELECT _slip.id, i.id, i.product_id, i.description, i.qty, i.qty, 'ok'
  FROM public.purchase_order_items i WHERE i.po_id = _po_2601_cab ORDER BY i.line_no;
  INSERT INTO public.packing_slip_item_serials (slip_item_id, serial)
  SELECT si.id, s.serial
  FROM public.packing_slip_items si
  CROSS JOIN unnest(ARRAY['EW8P-24B0342', 'EW8P-24B0343']) AS s(serial)
  WHERE si.slip_id = _slip.id AND si.product_id = _sw;
  PERFORM public.sync_packing_slip_inventory(_slip.id);
  PERFORM public.refresh_po_status(_po_2601_cab);
  SET LOCAL ROLE NONE;
  PERFORM pg_temp.demo_stamp(pg_temp.demo_at(16, '15:20'));

  -- =================================================================
  -- 15 days ago — Laura asks the shop for two CCTV cabinets
  -- =================================================================
  PERFORM set_config('request.jwt.claims', _as_laura, true);
  SET LOCAL ROLE authenticated;
  _build := public.create_build_request(_p2403, _cctv, 2, 'Two cabinets for platform level 2, north and south ends.',
    (SELECT jsonb_agg(jsonb_build_object('product_id', product_id, 'qty_per_unit', qty_per_system) ORDER BY line_no)
     FROM public.system_template_parts WHERE template_id = _cctv));
  _mfg_2403_cab := _build.id;
  PERFORM public.submit_build_request(_build.id);
  SET LOCAL ROLE NONE;
  PERFORM pg_temp.demo_stamp(pg_temp.demo_at(15, '09:30'));

  -- =================================================================
  -- 13 days ago — the shop starts them, recording the switch serials
  -- =================================================================
  PERFORM set_config('request.jwt.claims', _as_marcus, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.start_build_request(_mfg_2403_cab, jsonb_build_array(
    jsonb_build_object('product_id', _sw, 'serial', 'EW8P-24A0117'),
    jsonb_build_object('product_id', _sw, 'serial', 'EW8P-24A0118')));
  SET LOCAL ROLE NONE;
  PERFORM pg_temp.demo_stamp(pg_temp.demo_at(13, '08:45'));

  -- =================================================================
  -- 11 days ago — cameras and panels arrive; bullet cameras backordered
  -- =================================================================
  PERFORM set_config('request.jwt.claims', _as_marcus, true);
  SET LOCAL ROLE authenticated;
  _slip := public.create_packing_slip(_po_2403_sec, _p2403, _today - 11, 'FedEx Ground', 'MSD-PK-20931',
    'Bullet cameras backordered by Meridian.', 'partially_received');
  INSERT INTO public.packing_slip_items (slip_id, po_item_id, product_id, description, qty_ordered, qty_received, condition)
  SELECT _slip.id, i.id, i.product_id, i.description, i.qty, i.qty, 'ok'
  FROM public.purchase_order_items i
  WHERE i.po_id = _po_2403_sec AND i.product_id IN (_dome, _acp) ORDER BY i.line_no;
  INSERT INTO public.packing_slip_item_serials (slip_item_id, serial)
  SELECT si.id, 'DM4-2409-' || lpad(n::text, 4, '0')
  FROM public.packing_slip_items si CROSS JOIN generate_series(1, 12) AS n
  WHERE si.slip_id = _slip.id AND si.product_id = _dome;
  INSERT INTO public.packing_slip_item_serials (slip_item_id, serial)
  SELECT si.id, s.serial
  FROM public.packing_slip_items si
  CROSS JOIN unnest(ARRAY['ACP-77310', 'ACP-77311']) AS s(serial)
  WHERE si.slip_id = _slip.id AND si.product_id = _acp;
  PERFORM public.sync_packing_slip_inventory(_slip.id);
  PERFORM public.refresh_po_status(_po_2403_sec);
  SET LOCAL ROLE NONE;
  PERFORM pg_temp.demo_stamp(pg_temp.demo_at(11, '11:30'));

  -- =================================================================
  -- 9 days ago — Laura borrows fiber from 2601, David asks for MDF
  -- power, the shop finishes the two cabinets
  -- =================================================================
  PERFORM set_config('request.jwt.claims', _as_laura, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.borrow_requests (source_project_id, target_project_id, product_id, qty_requested, reason, needed_by, requested_by)
  VALUES (_p2601, _p2403, _fo, 6, 'Short on fiber patch cords for the platform comms room tie-in this week.', _today - 7, _laura)
  RETURNING id INTO _borrow_fiber;
  SET LOCAL ROLE NONE;
  PERFORM pg_temp.demo_stamp(pg_temp.demo_at(9, '09:15'));

  PERFORM set_config('request.jwt.claims', _as_david, true);
  SET LOCAL ROLE authenticated;
  _req := public.create_po_request(_p2601, 'Power and rack for the east wing MDF.',
    jsonb_build_array(
      jsonb_build_object('product_id', _ups, 'qty', 2),
      jsonb_build_object('product_id', _pdu, 'qty', 4),
      jsonb_build_object('product_id', _cab, 'qty', 1)));
  _req_2601_mdf := _req.id;
  SET LOCAL ROLE NONE;
  PERFORM pg_temp.demo_stamp(pg_temp.demo_at(9, '11:00'));

  PERFORM set_config('request.jwt.claims', _as_marcus, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.complete_build_request(_mfg_2403_cab);  -- units 2403-CCTV-WALL-8P-001 and -002
  SET LOCAL ROLE NONE;
  PERFORM pg_temp.demo_stamp(pg_temp.demo_at(9, '16:00'));

  -- =================================================================
  -- 8 days ago — David lends the fiber; 8 dome cameras ship to site
  -- =================================================================
  PERFORM set_config('request.jwt.claims', _as_david, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.decide_borrow_request(_borrow_fiber, 'approved', 6,
    'OK. Please send them back once your own fiber arrives.', NULL);
  SET LOCAL ROLE NONE;
  PERFORM pg_temp.demo_stamp(pg_temp.demo_at(8, '10:40'));

  PERFORM set_config('request.jwt.claims', _as_marcus, true);
  SET LOCAL ROLE authenticated;
  _ticket := public.create_shipping_ticket(_p2403, _today - 8, 'Riverside Transit Center — Platform Level 2',
    '1200 Riverside Ave, Queens, NY 11101', 'Tom Alvarez', '(718) 555-0190', 'Van');
  INSERT INTO public.shipping_ticket_items (ticket_id, product_id, description, qty_shipped, qty_backordered)
  SELECT _ticket.id, id, description, 8, 0 FROM public.products WHERE id = _dome
  RETURNING id INTO _item;
  INSERT INTO public.shipping_ticket_item_serials (ticket_item_id, serial)
  SELECT _item, 'DM4-2409-' || lpad(n::text, 4, '0') FROM generate_series(1, 8) AS n;
  INSERT INTO public.shipping_ticket_items (ticket_id, product_id, description, qty_shipped, qty_backordered)
  SELECT _ticket.id, id, description, 4, 0 FROM public.products WHERE id = _pc;
  PERFORM public.ship_shipping_ticket_inventory(_ticket.id);
  UPDATE public.shipping_tickets SET status = 'shipped' WHERE id = _ticket.id;
  SET LOCAL ROLE NONE;
  PERFORM pg_temp.demo_stamp(pg_temp.demo_at(8, '14:00'));

  -- =================================================================
  -- 7 days ago — Marcus orders David's MDF power and rack
  -- =================================================================
  PERFORM set_config('request.jwt.claims', _as_marcus, true);
  SET LOCAL ROLE authenticated;
  _po := public.create_purchase_order(_p2601, _northgate, _mkj_address, _mkj_address, _today + 6,
    'Freight (LTL)', 'Net 45', 'UPS, PDUs and 42U cabinet for the east wing MDF, per REQ-2601-001',
    _marcus, 180.00, NULL, NULL);
  INSERT INTO public.purchase_order_items (po_id, line_no, budget_code, product_id, description, qty, unit, unit_cost)
  SELECT _po.id, v.line_no, v.budget, p.id, p.description, v.qty, p.unit, v.cost
  FROM (VALUES (1, '2601-MDF', _ups, 2, 845.00), (2, '2601-MDF', _pdu, 4, 132.50),
               (3, '2601-MDF', _cab, 1, 1580.00)) AS v(line_no, budget, product_id, qty, cost)
  JOIN public.products p ON p.id = v.product_id;
  UPDATE public.purchase_orders SET status = 'approved' WHERE id = _po.id;
  PERFORM public.complete_po_request(_req_2601_mdf, _po.po_number);
  SET LOCAL ROLE NONE;
  PERFORM pg_temp.demo_stamp(pg_temp.demo_at(7, '10:20'));

  -- =================================================================
  -- 6 days ago — David asks 2403 for two dome cameras and requests a
  -- cabinet of his own, with a fiber uplink added to the standard list
  -- =================================================================
  PERFORM set_config('request.jwt.claims', _as_david, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.borrow_requests (source_project_id, target_project_id, product_id, qty_requested, reason, needed_by, requested_by)
  VALUES (_p2403, _p2601, _dome, 2, 'Two cameras for the east wing lobby before Friday''s owner walkthrough.', _today - 4, _david)
  RETURNING id INTO _borrow_domes;
  SET LOCAL ROLE NONE;
  PERFORM pg_temp.demo_stamp(pg_temp.demo_at(6, '09:10'));

  PERFORM set_config('request.jwt.claims', _as_david, true);
  SET LOCAL ROLE authenticated;
  _build := public.create_build_request(_p2601, _cctv, 1,
    'Cabinet for the east wing security office. Added a fiber uplink to the IDF.',
    (SELECT jsonb_agg(l.line ORDER BY l.ord) FROM (
       SELECT jsonb_build_object('product_id', product_id, 'qty_per_unit', qty_per_system) AS line, line_no AS ord
       FROM public.system_template_parts WHERE template_id = _cctv
       UNION ALL
       SELECT jsonb_build_object('product_id', _fo, 'qty_per_unit', 2, 'notes', 'Fiber uplink to the IDF panel'), 100
     ) l));
  _mfg_2601_cab := _build.id;
  PERFORM public.submit_build_request(_build.id);
  SET LOCAL ROLE NONE;
  PERFORM pg_temp.demo_stamp(pg_temp.demo_at(6, '13:30'));

  -- =================================================================
  -- 5 days ago — the shop starts David's cabinet; Laura lends the
  -- cameras by serial
  -- =================================================================
  PERFORM set_config('request.jwt.claims', _as_marcus, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.start_build_request(_mfg_2601_cab, jsonb_build_array(
    jsonb_build_object('product_id', _sw, 'serial', 'EW8P-24B0342')));
  SET LOCAL ROLE NONE;
  PERFORM pg_temp.demo_stamp(pg_temp.demo_at(5, '08:50'));

  PERFORM set_config('request.jwt.claims', _as_laura, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.decide_borrow_request(_borrow_domes, 'approved', 2, 'Approved. We have spares from the platform order.',
    ARRAY['DM4-2409-0009', 'DM4-2409-0010']);
  SET LOCAL ROLE NONE;
  PERFORM pg_temp.demo_stamp(pg_temp.demo_at(5, '11:15'));

  -- =================================================================
  -- 4 days ago — Laura returns the fiber; 2601 ships to its IDF
  -- =================================================================
  PERFORM set_config('request.jwt.claims', _as_laura, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.return_borrowed_stock(_borrow_fiber, 6, 'Tie-in moved to next month. Returning all six.', NULL);
  SET LOCAL ROLE NONE;
  PERFORM pg_temp.demo_stamp(pg_temp.demo_at(4, '10:00'));

  PERFORM set_config('request.jwt.claims', _as_david, true);
  SET LOCAL ROLE authenticated;
  _ticket := public.create_shipping_ticket(_p2601, _today - 4, 'Harbor Point Medical Campus — East Wing IDF-2',
    '3300 Harbor Point Blvd, Jersey City, NJ 07305', 'Angela Brooks', '(201) 555-0134', 'Van');
  INSERT INTO public.shipping_ticket_items (ticket_id, product_id, description, qty_shipped, qty_backordered)
  SELECT _ticket.id, id, description, v.qty, 0
  FROM (VALUES (_fo, 12), (_pc, 4)) AS v(product_id, qty) JOIN public.products p ON p.id = v.product_id;
  PERFORM public.ship_shipping_ticket_inventory(_ticket.id);
  UPDATE public.shipping_tickets SET status = 'shipped' WHERE id = _ticket.id;
  SET LOCAL ROLE NONE;
  PERFORM pg_temp.demo_stamp(pg_temp.demo_at(4, '14:30'));

  -- =================================================================
  -- 3 days ago — Laura needs card readers, asks for an access control
  -- panel (submitted with the readers pending); 4 bullet cameras arrive
  -- =================================================================
  PERFORM set_config('request.jwt.claims', _as_laura, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.create_po_request(_p2403,
    'Card readers for MFG-2403-002; the build is waiting on them. The door switches aren''t in the catalog yet.',
    jsonb_build_array(
      jsonb_build_object('product_id', _rdr, 'qty', 4),
      jsonb_build_object('custom_description', 'Recessed door position switch, white', 'qty', 4, 'unit', 'ea')));
  SET LOCAL ROLE NONE;
  PERFORM pg_temp.demo_stamp(pg_temp.demo_at(3, '09:40'));

  PERFORM set_config('request.jwt.claims', _as_laura, true);
  SET LOCAL ROLE authenticated;
  _build := public.create_build_request(_p2403, _acs, 1, 'Panel for the platform staff room doors.',
    (SELECT jsonb_agg(jsonb_build_object('product_id', product_id, 'qty_per_unit', qty_per_system) ORDER BY line_no)
     FROM public.system_template_parts WHERE template_id = _acs));
  PERFORM public.submit_build_request(_build.id);  -- 4 of 5 parts held; RDR-MULTI pending
  SET LOCAL ROLE NONE;
  PERFORM pg_temp.demo_stamp(pg_temp.demo_at(3, '10:05'));

  PERFORM set_config('request.jwt.claims', _as_marcus, true);
  SET LOCAL ROLE authenticated;
  _slip := public.create_packing_slip(_po_2403_sec, _p2403, _today - 3, 'FedEx Ground', 'MSD-PK-21177',
    '4 of 6 bullet cameras. The last 2 are still backordered.', 'partially_received');
  INSERT INTO public.packing_slip_items (slip_id, po_item_id, product_id, description, qty_ordered, qty_received, condition)
  SELECT _slip.id, i.id, i.product_id, i.description, i.qty, 4, 'ok'
  FROM public.purchase_order_items i WHERE i.po_id = _po_2403_sec AND i.product_id = _bullet;
  INSERT INTO public.packing_slip_item_serials (slip_item_id, serial)
  SELECT si.id, 'BL8-2409-' || lpad((100 + n)::text, 4, '0')
  FROM public.packing_slip_items si CROSS JOIN generate_series(1, 4) AS n
  WHERE si.slip_id = _slip.id AND si.product_id = _bullet;
  PERFORM public.sync_packing_slip_inventory(_slip.id);
  PERFORM public.refresh_po_status(_po_2403_sec);
  SET LOCAL ROLE NONE;
  PERFORM pg_temp.demo_stamp(pg_temp.demo_at(3, '15:10'));

  -- =================================================================
  -- 2 days ago — David drafts two access control panels (can't submit:
  -- no ACP-2DR in 2601) and asks for more fiber; Meridian raises the
  -- dome camera price
  -- =================================================================
  PERFORM set_config('request.jwt.claims', _as_david, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.create_build_request(_p2601, _acs, 2,
    'Two panels for the east wing entrances. Waiting for the access control panels before submitting.',
    (SELECT jsonb_agg(jsonb_build_object('product_id', product_id, 'qty_per_unit', qty_per_system) ORDER BY line_no)
     FROM public.system_template_parts WHERE template_id = _acs));
  SET LOCAL ROLE NONE;
  PERFORM pg_temp.demo_stamp(pg_temp.demo_at(2, '09:00'));

  PERFORM set_config('request.jwt.claims', _as_david, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.create_po_request(_p2601, 'Fiber for IDF-3 on the east wing.',
    jsonb_build_array(
      jsonb_build_object('product_id', _fo, 'qty', 24),
      jsonb_build_object('custom_description', 'LC duplex coupler, single-mode', 'qty', 12, 'unit', 'ea')));
  SET LOCAL ROLE NONE;
  PERFORM pg_temp.demo_stamp(pg_temp.demo_at(2, '11:20'));

  PERFORM set_config('request.jwt.claims', _as_marcus, true);
  SET LOCAL ROLE authenticated;
  UPDATE public.supplier_prices SET unit_cost = 342.00, notes = 'Meridian price increase, September.'
  WHERE product_id = _dome AND supplier_id = _meridian;
  SET LOCAL ROLE NONE;
  PERFORM pg_temp.demo_stamp(pg_temp.demo_at(2, '16:00'));

  -- =================================================================
  -- Yesterday — two tickets staged to ship (one carries a finished
  -- cabinet by its unit ID); David asks 2403 for two bullet cameras
  -- =================================================================
  PERFORM set_config('request.jwt.claims', _as_marcus, true);
  SET LOCAL ROLE authenticated;
  _ticket := public.create_shipping_ticket(_p2403, _today + 1, 'Riverside Transit Center — Platform Level 2 North',
    '1200 Riverside Ave, Queens, NY 11101', 'Tom Alvarez', '(718) 555-0190', 'Box truck');
  INSERT INTO public.shipping_ticket_items (ticket_id, product_id, description, qty_shipped, qty_backordered)
  SELECT _ticket.id, id, description, 1, 0 FROM public.products WHERE id = _cctv_product
  RETURNING id INTO _item;
  INSERT INTO public.shipping_ticket_item_serials (ticket_item_id, serial) VALUES (_item, '2403-CCTV-WALL-8P-001');
  INSERT INTO public.shipping_ticket_items (ticket_id, product_id, description, qty_shipped, qty_backordered)
  SELECT _ticket.id, id, description, 2, 0 FROM public.products WHERE id = _bullet
  RETURNING id INTO _item;
  INSERT INTO public.shipping_ticket_item_serials (ticket_item_id, serial)
  VALUES (_item, 'BL8-2409-0101'), (_item, 'BL8-2409-0102');
  SET LOCAL ROLE NONE;
  PERFORM pg_temp.demo_stamp(pg_temp.demo_at(1, '10:30'));

  PERFORM set_config('request.jwt.claims', _as_david, true);
  SET LOCAL ROLE authenticated;
  _ticket := public.create_shipping_ticket(_p2601, _today + 2, 'Harbor Point Medical Campus — East Wing IDF-3',
    '3300 Harbor Point Blvd, Jersey City, NJ 07305', 'Angela Brooks', '(201) 555-0134', 'Van');
  INSERT INTO public.shipping_ticket_items (ticket_id, product_id, description, qty_shipped, qty_backordered)
  SELECT _ticket.id, id, description, v.qty, 0
  FROM (VALUES (_fo, 6), (_pp, 1)) AS v(product_id, qty) JOIN public.products p ON p.id = v.product_id;
  SET LOCAL ROLE NONE;
  PERFORM pg_temp.demo_stamp(pg_temp.demo_at(1, '13:00'));

  PERFORM set_config('request.jwt.claims', _as_david, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.borrow_requests (source_project_id, target_project_id, product_id, qty_requested, reason, needed_by, requested_by)
  VALUES (_p2403, _p2601, _bullet, 2, 'Parking garage entrance cameras. Ours are on backorder.', _today + 5, _david);
  SET LOCAL ROLE NONE;
  PERFORM pg_temp.demo_stamp(pg_temp.demo_at(1, '15:45'));

  -- =================================================================
  -- Finishing touches (as postgres)
  -- =================================================================
  -- The demo accounts have already read anything older than 3 days.
  UPDATE public.notifications
  SET read_at = created_at + interval '2 hours'
  WHERE recipient_user_id IN (_laura, _david, _marcus)
    AND read_at IS NULL
    AND created_at < pg_temp.demo_at(3, '00:00');

  -- "Cost updated" dates: trg_supplier_prices_stamp only lets
  -- price_updated_at move when the cost changes, so it's paused for this
  -- one update (inside this transaction) and set from the price history.
  ALTER TABLE public.supplier_prices DISABLE TRIGGER trg_supplier_prices_stamp;
  UPDATE public.supplier_prices sp
  SET price_updated_at = h.last_change
  FROM (SELECT supplier_price_id, max(recorded_at) AS last_change
        FROM public.supplier_price_history GROUP BY supplier_price_id) h
  WHERE h.supplier_price_id = sp.id
    AND sp.product_id::text LIKE 'd0000000-de00-4000-8000-%';
  ALTER TABLE public.supplier_prices ENABLE TRIGGER trg_supplier_prices_stamp;
END
$seed$;

DROP FUNCTION pg_temp.demo_stamp(timestamptz);
DROP FUNCTION pg_temp.demo_at(integer, text);

COMMIT;

-- ============================================================
-- What was created
-- ============================================================
SELECT 'accounts' AS what, count(*) FROM auth.users WHERE id::text LIKE 'd0000000-de00-4000-8000-%'
UNION ALL SELECT 'projects',         count(*) FROM public.projects WHERE id::text LIKE 'd0000000-de00-4000-8000-%'
UNION ALL SELECT 'products',         count(*) FROM public.products WHERE id::text LIKE 'd0000000-de00-4000-8000-%'
UNION ALL SELECT 'purchase orders',  count(*) FROM public.purchase_orders  WHERE project_id::text LIKE 'd0000000-de00-4000-8000-%'
UNION ALL SELECT 'packing slips',    count(*) FROM public.packing_slips    WHERE project_id::text LIKE 'd0000000-de00-4000-8000-%'
UNION ALL SELECT 'shipping tickets', count(*) FROM public.shipping_tickets WHERE project_id::text LIKE 'd0000000-de00-4000-8000-%'
UNION ALL SELECT 'po requests',      count(*) FROM public.po_requests      WHERE project_id::text LIKE 'd0000000-de00-4000-8000-%'
UNION ALL SELECT 'build requests',   count(*) FROM public.build_requests   WHERE project_id::text LIKE 'd0000000-de00-4000-8000-%'
UNION ALL SELECT 'borrow requests',  count(*) FROM public.borrow_requests  WHERE target_project_id::text LIKE 'd0000000-de00-4000-8000-%';
