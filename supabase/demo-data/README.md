# Demo data for the stakeholder walkthrough

Temporary, hand-run and reversible. This is **not** a migration: nothing here
runs automatically (`config.toml` has no seed path pointing at this folder), and
it never becomes part of the schema history. It adds rows to production and
`teardown_demo_data.sql` takes them out again.

## What the seed creates

Everything is created through the app's own database functions
(`create_purchase_order`, `create_packing_slip`, `sync_packing_slip_inventory`,
`refresh_po_status`, `create_shipping_ticket`, `ship_shipping_ticket_inventory`,
`decide_borrow_request`, `return_borrowed_stock`, `create/complete_po_request`,
`import_system_templates`, `create/submit/start/complete_build_request`), acting
as the demo account that would really do each step. Direct inserts (PO lines,
slip lines, ticket lines, serials, borrow requests, prices) run as the
`authenticated` role, so row level security checks them just like the browser.
Numbering, stock, held stock, serials and notifications therefore come out
exactly as the app would produce them. Timestamps are then moved back so the
story runs over the past four weeks.

| Area | What's there |
|---|---|
| Accounts | 3 (below) |
| Projects | **2403** Riverside Transit Center (Laura), **2601** Harbor Point Medical Campus (David) |
| Suppliers | Summit Electrical Supply, Meridian Security Distribution, Harbor Fiber & Cable Co., Northgate Rack Systems |
| Products | 15 parts (cameras, switches, enclosures, access control, fiber, power…) with prices; 1 price change in the history |
| Systems | **CCTV-WALL-8P** (7 parts, 2 key) and **ACS-2DR** (5 parts, 1 key), next to the 2 real ones |
| PO requests | REQ-2403-001 completed → MKJ2403EX002 · REQ-2601-001 completed → MKJ2601EX002 · REQ-2403-002 pending · REQ-2601-002 pending (one free-text line each) |
| Purchase orders | MKJ2403EX001 received · MKJ2403EX002 partially received (2 bullet cameras backordered) · MKJ2601EX001 received · MKJ2601EX002 approved |
| Packing slips | 2403-PS-0001, 2403-PS-0002 (partial), 2403-PS-0003 (partial, this week), 2601-PS-0001 — switches, cameras and panels arrive with serial numbers |
| Build requests | MFG-2403-001 completed (units 2403-CCTV-WALL-8P-001/002) · MFG-2601-001 in progress, nothing pending · MFG-2403-002 submitted, waiting on card readers · MFG-2601-002 draft |
| Shipping tickets | S2403-001 shipped (8 cameras by serial) · S2601-001 shipped · S2403-002 ready (carries built unit 2403-CCTV-WALL-8P-001) · S2601-002 ready |
| Borrow requests | 2403 ← 2601 fiber cords, returned · 2601 ← 2403 two dome cameras by serial, on loan · 2601 ← 2403 two bullet cameras, pending |
| Notifications | Whatever the steps above sent. Demo accounts' older ones are marked read, and your admin account gets the warehouse/admin ones |

## Logins

| Name | Email | Role | Sees |
|---|---|---|---|
| Laura Mendez | `pm2403.demo@example.com` | Manager | 2403 |
| David Chen | `pm2601.demo@example.com` | Manager | 2601 |
| Marcus Reyes | `warehouse.demo@example.com` | Warehouse manager | everything |

**The seed sets no usable password.** These are live accounts on production
with real permissions, and this repo is on GitHub, so a password written here
would be one anyone could use. Pick one yourself and run this in the SQL editor
(it sets the same password on all three):

```sql
UPDATE auth.users
SET encrypted_password = extensions.crypt('PICK-A-PASSWORD', extensions.gen_salt('bf')),
    updated_at = now()
WHERE id::text LIKE 'd0000000-de00-4000-8000-%';
```

**Done on 2026-09-13:** all three accounts now share one simple password.
It's kept out of the repo on purpose, so ask Cesar for it. Running the
snippet again replaces it.

`example.com` is reserved, so no mail can be sent to these addresses. That
rules out "forgot password" on them, but it also means nobody can take them
over through a reset email.

## Worth doing live

Everything below is left one click away on purpose:

1. **Marcus → Manufacturing → MFG-2601-001 → Complete.** Every part is
   installed, so unit `2601-CCTV-WALL-8P-001` goes straight into 2601's stock.
2. **Marcus → S2403-002 → Mark shipped.** It ships built unit
   `2403-CCTV-WALL-8P-001` by its unit ID. The unit then shows as shipped.
3. **Marcus → Add packing slip on MKJ2403EX002.** Receive the 2 backordered
   bullet cameras (with serials) and the PO turns Received.
4. **Laura → Borrow requests → approve David's 2 bullet cameras.**
5. **David → MFG-2601-002 → Submit.** It's refused because key part ACP-2DR
   isn't in stock, which shows the 80% / key-part rule in action.
6. **Marcus → Purchase Orders → complete REQ-2403-002 or REQ-2601-002.**

"Mark delivered" needs a photo of the signed ticket, so it only works through
the browser. Any file will do.

## Removing it

Run **`teardown_demo_data.sql`** in the SQL editor. It removes the accounts, both
projects and everything recorded against them (including anything added during
the demo), the demo suppliers, products and systems, and the notifications about
them. It matches by id, never by project number, and aborts without deleting
anything if real data was attached to demo rows. The header explains how.

What it can't reach:

- **Files in Storage.** PO and shipping-ticket PDFs cached while clicking around,
  and any proof photo uploaded for "Mark delivered". Their database rows go with
  the tickets/POs, so nothing in the app links to them any more. To find them
  before running the teardown:
  ```sql
  SELECT storage_path FROM public.purchase_order_pdfs
  WHERE po_id IN (SELECT id FROM public.purchase_orders WHERE project_id::text LIKE 'd0000000-de00-4000-8000-%')
  UNION ALL
  SELECT storage_path FROM public.shipping_ticket_pdfs
  WHERE ticket_id IN (SELECT id FROM public.shipping_tickets WHERE project_id::text LIKE 'd0000000-de00-4000-8000-%')
  UNION ALL
  SELECT signature_url FROM public.shipping_tickets
  WHERE signature_url IS NOT NULL AND project_id::text LIKE 'd0000000-de00-4000-8000-%';
  ```
- **Anything created outside the two demo projects during the demo:** new
  projects, products, suppliers or systems added by hand. Delete those in the
  app.

**Run the teardown before creating the real projects 2403/2601.** While the demo
projects exist, those numbers are taken.

## Running the seed again

It isn't meant to run twice: the unique project numbers make a second run fail
before anything is written. Run the teardown first, then the seed.
