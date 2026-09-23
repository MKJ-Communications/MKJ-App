# MKJ Ops — System Map

**Revision 2 — 2026-08-06.** Re-derived from the full source tree, all **50**
migrations, and live introspection of the deployed Supabase project.
Companions: `QA-FINDINGS.md` (static register) · `QA-LIVE-TEST-REPORT.md` (live results).

This is a description of what exists, not a judgement of it. Where behaviour is a
known open issue it is marked ⚠️ and cross-referenced.

> **What changed since rev 1.** The architecture shifted from *direct table writes
> guarded by RLS* to *`SECURITY DEFINER` RPCs that re-check permission and enforce
> business rules server-side*. Every multi-step or cross-project operation — receiving,
> shipping, borrowing, and all three delete paths — is now a single atomic function
> call. Rev 1 documented 23 migrations, 15 tables and 3 helper functions; this
> revision covers **50 migrations, 19 tables, 4 views, 23 functions and 5 storage
> buckets**.

---

## 1. Modules / pages

All application pages sit under the `_authenticated` layout
(`src/routes/_authenticated/route.tsx`), which calls `supabase.auth.getUser()` in
`beforeLoad` and redirects to `/auth` when there is no user.

| Route | Purpose | Nav visibility | Route guard |
|---|---|---|---|
| `/` | Redirect → `/dashboard` or `/auth` | — | — |
| `/auth` | Sign in + open self-service sign-up, with password policy | — | — |
| `/dashboard` | 5 stat cards + recent projects | all | — |
| `/projects` | Project list + create dialog | all | — |
| `/projects/$mkj` | Tabs: Overview / Inventory / POs / Tickets | all | — |
| `/purchase-orders` | PO list, PDF, edit, delete | all | — |
| `/purchase-orders/new` | PO creation + draft PDF preview | all ⚠️ L-06 | — |
| `/purchase-orders/$id` | PO detail, receive, PDF | all | — |
| `/packing-slips` | Slip list | all (create: `canWrite`) | — |
| `/packing-slips/new` | Goods receipt + vendor-slip attachment | all | — |
| `/packing-slips/$id` | Slip detail, edit, delete, attachment | all | — |
| `/shipping-tickets` | Ticket list | all ⚠️ L-06 | — |
| `/shipping-tickets/new` | Ticket creation + draft PDF preview | all | — |
| `/shipping-tickets/$id` | Detail, mark shipped, **mark delivered + proof capture** | all | — |
| `/inventory` | Cross-project on-hand, last-updated, borrow history | all | — |
| `/borrow-requests` | Inter-project borrowing, approvals, **returns** | all | — |
| `/products` | Part catalog + create/edit | warehouse/admin (nav only) | none |
| `/suppliers` | Vendor catalog + create/edit | warehouse/admin (nav only) | none |
| `/users` | Roles + project assignments | admin | ✅ `beforeLoad` admin check |
| `/bulk-upload` | Excel import — **UI shell only, no backend** | admin (nav only) | ⚠️ **none** (L-05) |
| `/account-settings` | Change own password | user menu | — |

Edge functions: `po-pdf`, `shipping-ticket-pdf` (both `verify_jwt = true`).

---

## 2. Roles

`public.app_role` = `admin | warehouse_manager | manager | engineer`.
Stored in `user_roles`. **Exactly one role per user in practice** — `set_user_role()`
does a delete-all + insert-one atomically and is the only supported write path.

| Predicate | True for |
|---|---|
| `is_admin(u)` | admin |
| `is_warehouse_or_admin(u)` | admin, warehouse_manager |
| `can_write(u)` | admin, warehouse_manager, manager |
| `has_any_role(u)` | anyone with a row in `user_roles` *(new — gates the open views)* |
| `manages_project(u,p)` | row in `project_managers` |
| `can_see_project(u,p)` | warehouse/admin **or** PM **or** engineer on that project |
| `can_write_project(u,p)` | warehouse/admin **or** PM on that project |
| `can_modify_po(u,status)` | admin, **or** warehouse while status ≠ `received` *(new)* |

Client mirrors live in `src/lib/roles.ts`.
**First-ever signup is auto-promoted to admin** (`handle_new_user()`); every later
signup gets a profile and no role.

---

## 3. Permission matrix (as enforced by RLS today)

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `profiles` | self or admin | — | self, or admin | — |
| `user_directory` | any authenticated | trigger only | trigger only | — |
| `user_roles` | self or admin | admin | admin | admin |
| `projects` | `can_see_project` | warehouse/admin | admin | admin |
| `project_managers` | self / admin / project-visible | **trigger only** | **trigger only** | **trigger only** |
| `project_engineers` | self / admin / project-visible | admin | admin | admin |
| `suppliers` | `can_write` | `can_write` | `can_write` | `can_write` |
| `products` | any authenticated | `can_write` | `can_write` | `can_write` |
| `purchase_orders` | `can_see_project` | `can_write_project` | `can_write_project` + **column guard** | **`can_modify_po`** |
| `purchase_order_items` | via parent | `can_write_project` | **`can_modify_po`** | **`can_modify_po`** |
| `packing_slips` | `can_see_project` | `can_write_project` | **warehouse/admin** | **none — RPC only** |
| `packing_slip_items` | via parent | via parent | **warehouse/admin** | **none — RPC only** |
| `shipping_tickets` | `can_see_project` | `can_write_project` | `can_write_project` ⚠️ | `can_write_project` ⚠️ |
| `shipping_ticket_items` | via parent | via parent | via parent | via parent |
| `inventory_adjustments` | `can_see_project` | `can_write_project` | **none** | **none** *(append-only)* |
| `borrow_requests` | either project visible | `can_write_project(target)` | `can_write_project(source)`, or own row | — |
| `notifications` | own | **none — trigger only** | own | — |
| `purchase_order_pdfs` / `shipping_ticket_pdfs` | via parent | service_role | service_role | service_role |

⚠️ `shipping_tickets` still uses a single `FOR ALL` policy, so a project manager can
technically update a delivered ticket via the API — the UI hides it and *delete* is
protected by an RPC. This is the one table that did not get the F-05 split.

### Views — deliberately RLS-bypassing, gated by `has_any_role`

Plain (non-`security_invoker`) views run with owner privileges. Three views use this
intentionally to expose narrow, safe data across project boundaries:

| View | Exposes | Why |
|---|---|---|
| `v_project_inventory` | `project_id, product_id, on_hand` | any user must see stock anywhere to know where they could borrow from |
| `v_project_directory` | `id, mkj_number, name` | label rows for projects you're not on (borrow list, inventory) |
| `v_user_roles` | `user_id, role` | resolve people's names without `user_roles`' self-only RLS *(fixes L-04)* |
| `v_project_last_updated` | `project_id, last_updated` | per-project ledger timestamp without a full-table scan |

Full project records, ledger detail and profile emails all remain behind
`can_see_project` / self-or-admin.

### Storage buckets (all private)

| Bucket | Written by | Read policy |
|---|---|---|
| `purchase-order-pdfs` | edge fn (service_role) | via cache row + `can_see_project` |
| `shipping-ticket-pdfs` | edge fn (service_role) | via cache row + `can_see_project` |
| `app-assets` | `can_write` | any authenticated |
| `packing-slip-attachments` | client, via slip permission | via slip + `can_see_project` |
| `shipping-ticket-proofs` | client, via ticket permission | via ticket + `can_see_project` |

> Bucket creation from the SQL editor silently does nothing on this project — buckets
> must be created by hand in the Storage tab. Also note Supabase's `list` endpoint
> returns `200 []` for buckets that don't exist; only an upload attempt is authoritative.

---

## 4. Entities and relationships

```
auth.users ─1:1─ profiles ─1:1─ user_directory        (trigger-synced)
     ├─1:N─ user_roles ──────────── v_user_roles      (open view, has_any_role)
     ├─N:M─ project_managers   ← written ONLY by trg_projects_sync_pm
     └─N:M─ project_engineers
                    ▼
projects (mkj_number UNIQUE, project_manager_id)
 ├─1:N─ purchase_orders        UNIQUE(project_id, po_sequence)   → MKJ<proj>EX<nnn>
 │        ├─1:N─ purchase_order_items ──┐
 │        ├─1:1─ purchase_order_pdfs    │
 │        └─1:N─ packing_slips ◄────────┘ (po_item_id)
 │                 UNIQUE(project_id, ps_sequence) → <proj>-PS-<nnnn>
 │                 ├─1:N─ packing_slip_items → products
 │                 └─ attachment_url → packing-slip-attachments
 ├─1:N─ shipping_tickets       UNIQUE(project_id, ticket_sequence) → S<proj>-<nnn>
 │        ├─1:N─ shipping_ticket_items → products
 │        ├─1:1─ shipping_ticket_pdfs
 │        └─ signature_url → shipping-ticket-proofs
 ├─1:N─ inventory_adjustments → products     [APPEND-ONLY LEDGER]
 │        ├─ v_project_inventory     = SUM(delta) per project+product
 │        └─ v_project_last_updated  = MAX(created_at) per project
 └─N:N─ borrow_requests (source ≠ target) → products
notifications → auth.users (recipient_user_id)   [trigger-written only]
```

**The ledger is the system's backbone.** `inventory_adjustments` has no UPDATE or
DELETE path for anyone. Every correction — reversing a shipment, deleting a slip,
returning a borrow — is a *compensating row*, never a mutation. All on-hand figures
are `SUM(delta)`.

---

## 5. Write paths — what goes through an RPC

The defining change since rev 1. `SECURITY DEFINER` functions re-check permission
(because they bypass RLS) and keep multi-step work in one transaction.

| Operation | Function | Enforces |
|---|---|---|
| Create PO | `create_purchase_order` | `can_write_project`; mints `MKJ<proj>EX<nnn>` under a row lock; sets freight/terms/assignee; creates an "Other…" supplier inline |
| Delete PO | `delete_purchase_order` | `can_modify_po`; reverses slip inventory, then deletes slips → items → PO in FK-safe order |
| Create slip | `create_packing_slip` | `can_write_project`; mints `<proj>-PS-<nnnn>` atomically (no burned numbers) |
| Sync slip inventory | `sync_packing_slip_inventory` | reconciles ledger to current line items; counts only `condition='ok'`; **idempotent** |
| Delete slip | `delete_packing_slip` | warehouse/admin; reverses inventory, removes items + slip |
| Create ticket | `create_shipping_ticket` | `can_write_project`; mints `S<proj>-<nnn>`; opens as `ready` |
| Ship inventory | `ship_shipping_ticket_inventory` | reconciles to line items; **hard-blocks any product that would go negative**; idempotent |
| Reverse shipment | `reverse_shipping_ticket_inventory` | compensating rows back to net zero; idempotent |
| Delete ticket | `delete_shipping_ticket` | admin, or warehouse while not delivered; reverses inventory first |
| Decide borrow | `decide_borrow_request` | `can_write_project(source)`; rejects non-`pending`, qty > requested, qty > on-hand; writes **both** ledger rows + fulfils, atomically |
| Return borrow | `return_borrowed_stock` | target-side only; bounds by outstanding and by on-hand; sets `returned`/`partially_returned` |
| Set role | `set_user_role` | admin; atomic delete+insert; **refuses to remove the last admin** |

Still written directly from the client: projects, suppliers, products, PO header
(column-guarded) and items, slip header/items (warehouse only), ticket header/items,
borrow request creation and self-cancel, notification read-marking.

---

## 6. Triggers

| Trigger | On | Does |
|---|---|---|
| `on_auth_user_created` | `auth.users` | creates profile; first-ever user becomes admin |
| `profiles_sync_user_directory` | `profiles` | mirrors `full_name` into `user_directory` |
| `trg_projects_sync_pm` | `projects.project_manager_id` | adds the new PM to `project_managers` and **removes the outgoing one** *(F-07)* |
| `trg_po_edit_guard` | `purchase_orders` BEFORE UPDATE | blocks edits to supplier/assignee/dates/terms/freight/bill-ship-to unless `can_modify_po` *(F-05)* |
| `trg_po_status_transition` | `purchase_orders` BEFORE UPDATE | validates status against actual receipts *(F-17)* |
| `trg_poi_sync_slip_qty` | `purchase_order_items` | keeps `packing_slip_items.qty_ordered` in step *(F-23)* |
| `trg_borrow_notify` | `borrow_requests` | fans out notifications to both sides |
| `trg_*_upd` | 6 tables | maintains `updated_at` |

The PO trigger split is worth understanding: **status stays writable by any project
write-user** (receiving recomputes it automatically), while the *edit-dialog fields*
are locked to `can_modify_po`. Tightening the RLS policy itself would have broken
automatic receiving.

---

## 7. Calculations

| # | Calculation | Where | Formula |
|---|---|---|---|
| C1 | PO line amount | everywhere | `qty × unit_cost` |
| C2 | **PO grand total** | new / edit / detail / PDF — **all four agree** | `Σ(qty × unit_cost) + additional_freight` |
| C3 | Remaining to receive | new slip | `max(0, po_qty − Σ prior qty_received)` |
| C4 | Backorder per line | slip screens | `max(0, qty_ordered − total_received)` |
| C5 | Slip status | `receiving.ts` | any line short → `partially_received`, else `received` |
| C6 | PO received status | `refreshPoStatus()` | no receipts → stored `pre_receipt_status` (never a guess); any line open → `partially_received`; else `received` |
| C7 | On-hand | `v_project_inventory` | `SUM(delta)` per project+product |
| C8 | Low-stock flag | inventory screens | `on_hand ≤ reorder_point` |
| C9 | Ship deduction | `ship_shipping_ticket_inventory` | reconcile ledger to `−Σ qty_shipped`; abort if any product would go negative |
| C10 | Ship reversal | `reverse_shipping_ticket_inventory` | insert `−SUM(delta)` per product |
| C11 | Slip inventory | `sync_packing_slip_inventory` | reconcile to `+Σ qty_received` where `condition='ok'` |
| C12 | Borrow transfer | `decide_borrow_request` | `−q` source, `+q` target, one transaction |
| C13 | Borrow outstanding | `return_borrowed_stock` | `qty_approved − qty_returned` |
| C14 | Dates & windows | `src/lib/date.ts` | all `America/New_York` |

---

## 8. Document generation

Both PDF functions share `_shared/pdf/` primitives and the same shape.

**Saved document** (`{po_id}` / `{ticket_id}`):
1. Caller-scoped client reads the row → RLS decides access (404 on deny).
2. SHA-256 `content_hash` over a JSON projection of the PDF-relevant fields.
3. Compare against the `*_pdfs` cache row.
4. On miss: render → service_role upload (`{id}.pdf`, upsert) → upsert cache row.
5. Return a **3600-second** signed URL; the client opens a pre-opened blank tab.

**Draft preview** (`{draft}`): renders from the posted payload, persists nothing,
returns `application/pdf` bytes as an object URL.

- **PO PDF** — logo, bill-to/ship-to, supplier block, created-by and assignee names
  (resolved via `user_directory`), line table, `Additional Freight` + `Grand Total`,
  terms & conditions, 2-group signature block, "executed" treatment.
- **Shipping ticket PDF** — logo, deliver-to block, job/contract numbers, line table
  with shipped/backordered, and a hand-completion proof-of-delivery block. The signed
  copy is now captured back into the system on **Mark delivered** (§9).
- Logo loads from `app-assets/logo/mkj-logo.jpg`; if absent the PDF renders unbranded.

---

## 9. Statuses and workflow

### Purchase order — `po_status`
`draft → approved → executed → partially_received → received`

- Manual transitions are validated by `trg_po_status_transition` against real receipts:
  you cannot jump to a receipt status with no slips, and cannot leave one while slips
  exist. The UI renders status read-only once receipts exist, with the note
  *"Set automatically from packing slips — edit or delete the slip to correct."*
- `pre_receipt_status` snapshots the pre-receipt value so zeroing every receipt
  restores exactly what it was.

### Packing slip — text column, CHECK (`received`, `partially_received`)
Set from quantities on create; recomputed on edit.

### Shipping ticket — `ticket_status`
`draft → ready → shipped → delivered → closed`

- `create_shipping_ticket` opens tickets as **`ready`**; `draft` is only reachable by
  editing backwards, which reverses inventory.
- **Mark shipped** → `ship_shipping_ticket_inventory` (idempotent, negative-blocked).
- **Mark delivered** → dialog capturing `delivered_by`, `received_by`, `pass_number`
  and a **required** photo/scan, uploaded to `shipping-ticket-proofs` and recorded in
  `signature_url` with `received_date`.
- `closed` (added to the enum 2026-09-10) is set via the edit dialog's status
  dropdown, not a dedicated action. `canEditTicket`/`canDeleteTicket` then restrict
  the ticket to admin-only, same as `delivered`.

### Borrow request — `borrow_status`
`pending → approved | partially_approved | denied | cancelled`
→ `fulfilled` → `partially_returned` → `returned`

Approval and fulfilment happen in one call, so `approved` is transient. Returns are
**target-side only** and tracked cumulatively via `qty_returned`.

### Project — `project_status`
`active | on_hold | closed`. PO, ticket and slip pickers all filter to `active`.

---

## 10. Known gaps in this map's scope

Descriptive notes only; detail and status live in the findings documents.

| Area | Note |
|---|---|
| `/bulk-upload` | Page exists, has **no backend calls**; route is unguarded (L-05) |
| Create buttons | Shown to roles that cannot complete them (L-06) |
| Document numbers | `MAX+1` per project — freed and reused after a delete (L-09) |
| `shipping_tickets` RLS | Single `FOR ALL` policy; did not get the F-05 split (§3) |
| `project_managers` | Only the trigger can write it — no admin UI for extra rows (L-10) |
| RLS-blocked writes | Return `200`/`204` with zero rows rather than an error (L-11) |
| `manual_adjustment` | Ledger source exists in the enum; nothing writes it |
