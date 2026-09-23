# MKJ Ops — QA test plan

Scope: full pre-production pass over purchase orders, packing slips, inventory,
shipping tickets, borrowing, roles, and PDF generation.
Companion documents: `QA-SYSTEM-MAP.md` (what exists), `QA-FINDINGS.md` (defect
register with current status — F-nn references below point there).

> **Revision 2 — 2026-08-05, against `3fec1c7`.** Rewritten after the F-01…F-40
> remediation round. Three things changed from revision 1:
> 1. The old **Risk** column is now **Watch**, and its meaning has changed — see
>    the legend below. A tag no longer means "this is broken."
> 2. Cases covering behaviour the owner has since **accepted** were reframed as
>    expected-result checks, not open questions. This affects **PS-04** most.
> 3. New suites were added for work that did not exist in revision 1: packing-slip
>    delete, PO status-transition guard, last-admin guard, borrow returns, the
>    negative-stock guard, slip attachments, and account/password management.

### Watch legend

| Tag | Meaning | What a failure means |
|---|---|---|
| **R** *(F-nn)* | **Regression watch.** This was broken, was fixed, and must stay fixed. | File as a **regression** against the named finding — highest priority. |
| **A** *(F-nn)* | **Accepted behaviour.** Reviewed and deliberately left as-is. | The expected result *is* the accepted behaviour. Do **not** re-file. If you disagree, raise it as a product question. |
| **O** *(F-nn)* | **Known open.** Not implemented yet. | Expected to fail. Confirm it fails the documented way; do not file a duplicate. |
| *(blank)* | Ordinary coverage. | File normally. |

---

## 1. Test environment

Do **not** run this plan against the production Supabase project. The suite
deliberately drives stock to its limits, deletes receipt history, and demotes
admins.

Required setup:
1. A separate Supabase project with **all** migrations applied in filename order
   (through `20260801222400`). Note that `20260801221000` and `20260801221100`
   add enum values — `ALTER TYPE … ADD VALUE` cannot share a transaction with a
   write that uses the new value, so apply them as their own statements.
2. Buckets created **manually** via the Storage tab — `purchase-order-pdfs`,
   `shipping-ticket-pdfs`, `app-assets`, `packing-slip-attachments`
   (SQL-editor bucket inserts have not taken effect on this project; see the note
   in migration `20260801211252`).
3. `app-assets/logo/mkj-logo.jpg` uploaded, plus one run with it **absent** to
   confirm PDFs still render.
4. Both edge functions deployed with `verify_jwt = true`.
5. Browser with popup blocking **on** (both PDF paths depend on the
   pre-opened-tab trick) and a second run with it off.

### Role fixtures

| Fixture | Setup | Notes |
|---|---|---|
| `admin@` | first account created — auto-admin | |
| `admin2@` | second admin | required for the last-admin tests (US-03) |
| `wh@` | role `warehouse_manager` | no project assignments needed |
| `pm-a@` | role `manager`, PM of project **A** only | |
| `pm-b@` | role `manager`, PM of project **B** only | needed for borrow tests |
| `eng-a@` | role `engineer`, assigned to project **A** | |
| `none@` | signed up, **no role assigned** | gates the F-06 boundary |

### Data fixtures

- Projects **A** (`9001`, active), **B** (`9002`, active), **C** (`9003`, closed).
- Suppliers: one full record, one name-only.
- Products: `P-100` (reorder point 5), `P-200` (reorder point 0), plus one with
  a comma and a dot in the part number, e.g. `P,300.X` — for PS-11.
- One PO per status value on project A.

---

## 2. Suite 1 — Authentication and access control

| ID | Test | Expected | Watch |
|---|---|---|---|
| A-01 | First-ever signup | Becomes admin; `user_roles` has exactly one row | |
| A-02 | Second signup | Profile created, no role; app still loads | |
| A-03 | Sign in with wrong password | Toast shows the error, no navigation | |
| A-04 | Visit `/dashboard` signed out | Redirects to `/auth` | |
| A-05 | Visit `/users` as non-admin | Redirects to `/dashboard` | |
| A-06 | **`none@` opens `/projects`** | Empty — no project records readable | **R** (F-06) |
| A-07 | **`none@` opens `/inventory`** | Empty — `has_any_role()` blocks the aggregate | **R** (F-06) |
| A-08 | `eng-a@` opens project B by URL | "Project not found" — full records stay behind `can_see_project` | **R** (F-06) |
| A-09 | `eng-a@` opens `/inventory` | **Sees on-hand for every project**, including B | **A** (F-06) |
| A-10 | `eng-a@` opens `/borrow-requests` | Sees project numbers/names for projects they're not on | **A** (F-06) |
| A-11 | Sign out, then Back button | No cached data; redirected to `/auth` | |
| A-12 | Expired/refreshed token during a save | Save either succeeds after refresh or fails cleanly | |
| A-13 | Non-admin opens `/bulk-upload` by URL | Should redirect — the nav hides it but the route has **no `beforeLoad` guard** | |
| A-14 | Sign-up password below policy | Rejected; `PasswordRequirements` shows which rule failed | |

### Suite 1b — Server-side permission probes (API, not UI)

Run with `curl`/Postman using each fixture's JWT. The UI hides these actions; the
point is to prove the database also refuses.

| ID | Test | Expected | Watch |
|---|---|---|---|
| A-20 | `pm-a@` DELETEs a `received` PO on project A | Rejected by `po_delete` / `can_modify_po` | **R** (F-05) |
| A-21 | `pm-a@` UPDATEs a `received` PO's guarded fields | Rejected by `trg_po_edit_guard` | **R** (F-05) |
| A-22 | `pm-a@` UPDATEs a `received` PO's **status** only | **Allowed** — status stays open so receiving can recompute it | **R** (F-05) |
| A-23 | `pm-a@` UPDATEs a packing slip on project A | Rejected by `ps_update` (warehouse/admin only) | **R** (F-05) |
| A-24 | Replaced PM writes a PO on their old project | Rejected — trigger revoked the `project_managers` row | **R** (F-07) |
| A-25 | `none@` selects from `inventory_adjustments` | Rejected by `inv_select` | **R** (F-06) |
| A-26 | Any user inserts a notification (self or other) | Rejected — `notif_insert_self` was dropped | **R** (F-33) |
| A-27 | `pm-b@` calls `decide_borrow_request` on a request they don't lend | Rejected — `can_write_project(source)` | **R** (F-02) |
| A-28 | `eng-a@` calls `delete_packing_slip` | Rejected — warehouse/admin only | **R** (F-16) |
| A-29 | `wh@` calls `set_user_role` | Rejected — admin only | **R** (F-18) |

---

## 3. Suite 2 — Purchase orders

| ID | Test | Expected | Watch |
|---|---|---|---|
| PO-01 | Create PO on project A | Number `MKJ9001EX001`; sequence per project | |
| PO-02 | Create a second PO on B | `MKJ9002EX001` — sequences independent | |
| PO-03 | Two users create a PO on A simultaneously | Distinct sequences, no unique violation | |
| PO-04 | Create with supplier "Other…", then force the PO to fail | **No orphan supplier row** — creation is inside the RPC | **R** (F-26) |
| PO-05 | Create with an assignee | Assignee set by `create_purchase_order`, no follow-up UPDATE | **R** (F-05) |
| PO-06 | Line qty `0`, negative, `1e9`, non-numeric | Clamps to ≥0 integers; totals stay finite | |
| PO-07 | Unit cost `0.005`, `-5`, `999999999.99` | `NUMERIC(12,2)` overflow gives a readable message | |
| PO-08 | Enter additional freight | Field present on new-PO **and** edit dialog | **R** (F-14) |
| PO-09 | **Totals with freight: new screen vs edit vs detail vs PDF** | All four agree | **R** (F-14) |
| PO-10 | Edit PO: change, remove, add lines | Line numbers renumber contiguously; totals recalc | |
| PO-11 | Edit PO, remove a line a packing slip references | Receipt history must not silently break | |
| PO-12 | Status `draft → received` directly | **Rejected** by `enforce_po_status_transition` | **R** (F-17) |
| PO-13 | Status `received → draft` with receipts present | **Rejected** — real receipt data is the authority | **R** (F-17) |
| PO-14 | Status change consistent with receipts | Allowed | **R** (F-17) |
| PO-15 | `refreshPoStatus` after zeroing every receipt | Reverts to the true `pre_receipt_status`, never a blanket `executed` | **R** (F-11) |
| PO-16 | **Delete a PO that has packing slips (admin)** | Succeeds; slips deleted, their inventory reversed; no FK error | **R** (F-04) |
| PO-17 | Confirmation dialog before PO-16 | Text names the line items, the packing slips **and** the inventory reversal | **R** (F-04) |
| PO-18 | On-hand after PO-16 | Back to its pre-receipt value; no ledger rows left pointing at a deleted PO | **R** (F-04) |
| PO-19 | `wh@` deletes a `received` PO | Refused by the RPC, not just hidden | **R** (F-05) |
| PO-20 | List with more POs than the cap | Explicit truncation indicator, not a silent drop | **R** (F-30) |

---

## 4. Suite 3 — Packing slips / receiving

Historically the highest-risk area. **PS-05 remains the single most important
test in the plan.**

| ID | Test | Expected | Watch |
|---|---|---|---|
| PS-01 | Receive full quantity | Slip `received`; PO `received`; on-hand += qty | |
| PS-02 | Receive partial | Slip + PO `partially_received`; backorder shown | |
| PS-03 | Second slip completing the balance | PO flips to `received`; "prev. received" prefilled | |
| PS-04 | **Receive more than ordered** | **Allowed.** The "over" hint shows, `qty_received` is not capped, and the PO may reach `received` with an over-received line. A vendor can legitimately over-ship; blocking would reject a valid receipt. | **A** (F-22) |
| PS-05 | **Open a saved slip, Save with no changes** | On-hand **unchanged** | **R** (F-01) |
| PS-06 | Edit a slip, lower a quantity | Ledger nets to the new quantity | **R** (F-01) |
| PS-07 | Edit a slip, zero every line | PO reverts to its pre-receipt status | **R** (F-11) |
| PS-08 | Receive a line marked `rejected` | **Not** added to on-hand | **R** (F-08) |
| PS-09 | Receive a line marked `damaged` | **Not** added to on-hand (only `ok` counts) | **R** (F-08) |
| PS-10 | Mixed conditions on one slip | Only the `ok` quantities move stock | **R** (F-08) |
| PS-11 | Line description containing `,` `.` `(` | No 400, no unintended product match — parameterised `.ilike()` | **R** (F-21) |
| PS-12 | Create a slip, then edit it, same line | Both resolve to the **same** product | **R** (F-21) |
| PS-13 | Two users receive against the same PO simultaneously | Distinct slip numbers; `create_packing_slip` is atomic | **R** (F-20) |
| PS-14 | Force the slip insert to fail | **No sequence number burned**, no orphan header | **R** (F-20) |
| PS-15 | Change a PO line qty after a partial receipt | Slip's `qty_ordered` re-syncs via trigger; backorder recomputes | **R** (F-23) |
| PS-16 | **Delete a slip (`wh@`)** | Slip + items removed, inventory reversed, PO status recomputed | **R** (F-16) |
| PS-17 | `eng-a@` / `pm-a@` sees the delete button | Hidden, **and** the RPC refuses | **R** (F-16) |
| PS-18 | On-hand after PS-16 | Exactly the pre-slip value | **R** (F-16) |
| PS-19 | **Attach the scanned vendor slip** | Uploads to the private bucket; `attachment_url` stored | **R** (F-40) |
| PS-20 | View an attachment | Opens via a short-lived signed URL; not publicly reachable | **R** (F-40) |
| PS-21 | Attach to a slip, then delete the slip | No orphaned/unreachable object left behind | **R** (F-40) |
| PS-22 | Receive against a `closed` project (C) | Picker filters to `active` only | **R** (F-35) |
| PS-23 | Received date entered at 21:00 ET | Defaults to **today** in ET, not tomorrow | **R** (F-29) |
| PS-24 | Slip detail for a bad/inaccessible ID | "Not found.", never a permanent "Loading…" | **R** (F-24) |

---

## 5. Suite 4 — Shipping tickets

| ID | Test | Expected | Watch |
|---|---|---|---|
| ST-01 | Create a ticket | Number `S9001-001`; status `ready` | |
| ST-02 | Two simultaneous creations on one project | Distinct sequences | |
| ST-03 | Mark shipped | On-hand -= qty_shipped exactly once | |
| ST-04 | **Double-click Mark shipped** | Deducted **once**; button disables while pending | **R** (F-03) |
| ST-05 | **Ship more than on-hand** | **Hard block** — the whole call aborts, nothing deducted | **R** (F-10) |
| ST-06 | Create a ticket for stock not yet received | **Allowed** — that is what `qty_backordered` is for; the block lives at ship time, not create time | **A** (F-10) |
| ST-07 | Multi-product ticket where one product would go negative | Entire call aborts; no partial deduction | **R** (F-10) |
| ST-08 | Edit dialog: shipped → `draft` | Inventory fully returned | |
| ST-09 | Edit dialog: shipped → **`ready`** | Inventory fully returned | **R** (F-09) |
| ST-10 | Edit dialog: change qty on a shipped ticket | Ledger reconciles to the new quantity | |
| ST-11 | Edit dialog: remove a line from a shipped ticket | That product's deduction is reversed | |
| ST-12 | Ready → shipped → delivered via buttons | Status and `received_date` correct in ET | **R** (F-29) |
| ST-13 | Delete a shipped ticket (`wh@`) | Inventory returned; items and ticket removed | |
| ST-14 | Delete a **delivered** ticket as `wh@` | Refused by the RPC, not just hidden | |
| ST-15 | Delete a delivered ticket as `admin@` | Allowed; inventory returned | |
| ST-16 | Ticket detail for a bad/inaccessible ID | "Not found." | **R** (F-24) |
| ST-17 | **Mark delivered — who received it?** | Requires `delivered_by`, `received_by` and a photo/scan before it will save (`pass_number` optional); all four columns plus `received_date` are written in one step | **R** (F-13) |
| ST-18 | **Mark delivered with no proof photo/scan attached** | Rejected — *"A photo or scan of the signed ticket is required"*. Nothing saved | **R** (F-13) |
| ST-19 | Move a ticket to status `closed` via the edit dialog | **Reachable.** Saves; `canEditTicket`/`canDeleteTicket` then restrict it to admin-only | **R** (F-13) |

---

## 6. Suite 5 — Inventory ledger

| ID | Test | Expected | Watch |
|---|---|---|---|
| IN-01 | On-hand = Σ deltas | Cross-check `v_project_inventory` against a manual sum after each PS/ST/borrow | |
| IN-02 | Low-stock badge at exactly the reorder point | `on_hand ≤ reorder_point` → "Low" | |
| IN-03 | Any path that would drive on-hand negative | Blocked at ship and at borrow approval | **R** (F-10) |
| IN-04 | **Full lifecycle:** receive 100 → ship 30 → borrow out 20 → return 20 → delete the ticket | Ends at **100** on the source project | **R** (F-01/03/04/12) |
| IN-05 | Inventory search by project, part #, description | Matches all four fields | |
| IN-06 | "Last updated" per project card | Correct timestamp from `v_project_last_updated`; no full-table scan | **R** (F-31) |
| IN-07 | "Last updated" for a project you're not on | Shows `—` (ledger detail stays scoped) while the on-hand total still shows | **A** (F-06) |
| IN-08 | Ledger after any delete RPC | Reversal is a compensating row; original rows never mutated | **R** (F-01/04/16) |

---

## 7. Suite 6 — Borrow requests

| ID | Test | Expected | Watch |
|---|---|---|---|
| BR-01 | `pm-b@` requests stock from project A | Created; A's manager + oversight notified | |
| BR-02 | **`pm-a@` (source manager only) approves** | Transfer completes atomically — both ledger rows written | **R** (F-02) |
| BR-03 | Approve more than on-hand | Blocked with the "only N on hand" message | |
| BR-04 | **Approve more than requested** | Blocked client-side **and** by the RPC (`Cannot approve % — only % was requested.`) | **R** (F-27) |
| BR-05 | Partial approval | Recorded as `partially_approved`, quantity respected | |
| BR-06 | **Two managers approve the same request simultaneously** | Second is rejected: *"already been decided"*; **one** transfer only | **R** (F-02) |
| BR-07 | Replay `decide_borrow_request` on a fulfilled request | Rejected by the `status <> 'pending'` guard | **R** (F-02) |
| BR-08 | Deny | No inventory movement; requester notified | |
| BR-09 | Requester cancels a pending request | `cancelled`; lending side notified | |
| BR-10 | Cancel an already-approved request | Refused | |
| BR-11 | Source = target | Rejected (CHECK + client guard) | |
| BR-12 | **Return the full borrowed quantity** | Status `returned`; `borrow_return_*` rows move stock back | **R** (F-12) |
| BR-13 | **Return part of it** | Status `partially_returned`; outstanding balance tracked | **R** (F-12) |
| BR-14 | Return more than outstanding | Rejected: *"Only N still outstanding"* | **R** (F-12) |
| BR-15 | Return more than the borrowing project has on hand | Rejected: *"Only N on hand to return"* | **R** (F-12) |
| BR-16 | Return qty ≤ 0 | Rejected | **R** (F-12) |
| BR-17 | Who may return | Target-side manager or oversight only (`canReturn`) | **R** (F-12) |
| BR-18 | Return against a non-fulfilled request | Rejected: *"no outstanding stock to return"* | **R** (F-12) |
| BR-19 | Engineer opens the page | No "New Request" button; API also refuses | |
| BR-20 | Deep link `?request=<id>` from a notification | Opens the detail dialog, marks the notification read | |
| BR-21 | Project names in the list | **From** and **To** both populated, via `v_project_directory` | **R** (F-06) |

---

## 8. Suite 7 — PDF generation

| ID | Test | Expected | Watch |
|---|---|---|---|
| PDF-01 | View a saved PO PDF | Opens in a new tab within the signed window | |
| PDF-02 | View twice without editing | Second call serves the cache | |
| PDF-03 | Edit the PO, view again | Hash changes; PDF reflects the edit | |
| PDF-04 | Change the project's name only | PO PDF re-renders | |
| PDF-05 | **View as `pm-a@` / `eng-a@`** | Created-by and Assignee names **present** (via `user_directory`) | **R** (F-15) |
| PDF-06 | View a PO on a project you cannot see | 404, no information leaked | |
| PDF-07 | Draft preview from the new-PO screen | Renders, persists nothing, marked "DRAFT" | |
| PDF-08 | Draft preview with popups blocked | Graceful failure, no dangling blank tab | |
| PDF-09 | Logo missing from `app-assets` | Still renders, unbranded | |
| PDF-10 | 60+ line items | Pagination, headers, footers correct on every page | |
| PDF-11 | Long multi-line bill-to / ship-to / description | No overflow past the margins | |
| PDF-12 | Unicode and long part numbers | No missing glyphs or overlap | |
| PDF-13 | **Freight and grand total** | PDF matches detail page and editor exactly | **R** (F-14) |
| PDF-14 | Ticket PDF: contract number changed on the project | Cache invalidates | |
| PDF-15 | Leave the tab, reload after ~10 minutes | Still valid — TTL is 3600s | **R** (F-37) |
| PDF-16 | Ticket PDF proof-of-delivery block, on a delivered ticket | Delivered by / Received by / Pass # / Print name / Date are filled from the ticket's captured data, not blank | **R** (F-13) |
| PDF-17 | Concurrent views of the same stale PO | Both succeed; no upload conflict | |

---

## 9. Suite 8 — Users, roles, notifications

| ID | Test | Expected | Watch |
|---|---|---|---|
| US-01 | Assign each role in turn | Nav, buttons and API access all follow | |
| US-02 | Assign projects to a manager / engineer | `ProjectMultiSelect` state persists; access follows | |
| US-03 | **Sole admin demotes themselves** | **Rejected** — last admin cannot be removed | **R** (F-18) |
| US-04 | With `admin2@` present, demote `admin@` | Allowed; one admin remains | **R** (F-18) |
| US-05 | Two admins demote each other simultaneously | `FOR UPDATE` serialises; one succeeds, one is rejected | **R** (F-18) |
| US-06 | Role change is atomic | Never leaves a user role-less mid-change | **R** (F-18/F-28) |
| US-07 | A user ends up with two roles | Not possible via `set_user_role` (delete-all + insert-one) | **R** (F-28) |
| US-08 | Rename a user | `profiles` and `user_directory` both update | |
| US-09 | **Change a project's manager** | Old manager's `project_managers` row is removed | **R** (F-07) |
| US-10 | Change the manager back and forth | No stale rows accumulate | **R** (F-07) |
| US-11 | New signup appears on `/users` | Appears after Refresh | **O** (F-39) |
| US-12 | **Borrow notification arrives** | Badge increments live, without a manual refresh | **R** (F-19) |
| US-13 | Mark all as read | Badge clears; count is per-recipient | |
| US-14 | Notification deep links | Every `link` value routes correctly | |
| US-15 | More notifications than the cap | Explicit truncation indicator | **R** (F-30) |
| US-16 | Change own password in `/account-settings` | Requires current password; new one must satisfy `PASSWORD_RULES` | |
| US-17 | New password failing each rule in turn | `PasswordRequirements` marks exactly the failing rule | |
| US-18 | Sign in with the new password | Works; old password rejected | |

---

## 10. Suite 9 — Cross-cutting

| ID | Test | Expected | Watch |
|---|---|---|---|
| X-01 | Every list/detail page at 375 px | Tables scroll; sidebar sheet works | |
| X-02 | Every destructive action | Confirmation dialog naming the **full** effect; disabled while pending | **R** (F-04) |
| X-03 | Every mutation with the network offline | Real message; no silent success | |
| X-04 | Every "not found" ID in a URL | Real empty state, never a permanent "Loading…" | **R** (F-24) |
| X-05 | Browser Back after each create flow | No duplicate submission | |
| X-06 | Double-click every submit button | Exactly one record created | **R** (F-03) |
| X-07 | Keyboard-only navigation of each dialog | Focus trapped and returned | |
| X-08 | Console during a full happy-path run | No errors, no failed requests | |
| X-09 | All dates displayed anywhere | America/New_York, consistent format | **R** (F-29) |
| X-10 | Currency formatting | Two decimals everywhere, no floating-point drift | |
| X-11 | Every list at its cap | Truncation indicator, never a silent drop | **R** (F-30) |
| X-12 | `/bulk-upload` as admin | Template download works; file picker opens; **import is not wired to a backend** | |

---

## 11. Suggested execution order

1. **Suite 1 + 1b** — access control gates everything else, and the server-side
   probes are the cheapest way to confirm the F-05/F-06/F-07 hardening held.
2. **The regression core:** PS-05, PS-06, PS-08, ST-04, ST-05, ST-09, BR-02,
   BR-06. These cover the defects that could corrupt the ledger irreversibly.
3. **IN-04** — the full lifecycle reconciliation, which exercises most of the
   above end to end.
4. Suites 2, 3, 4 in full, then 5, 6, 7, 8.
5. Suite 9 as a final sweep.

Run the **O**-tagged cases last, in one pass — they are documentation of known
gaps, not defect hunting.

## 12. Exit criteria for production

- Every **R**-tagged case passes. Any failure is a regression against a
  previously closed finding and blocks release.
- **IN-04** passes three consecutive times on a freshly seeded database.
- The **A**-tagged cases behave as documented; if any surprises the business,
  raise it as a product question rather than a defect.
- The F-07 stale-`project_managers` audit has been run against production.
- A documented backup/restore path for the Supabase project, since the ledger is
  append-only and there is no way to undo a corrupted inventory history from
  inside the app.
