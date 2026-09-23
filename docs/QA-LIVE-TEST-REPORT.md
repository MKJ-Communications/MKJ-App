# MKJ Ops — Production QA checklist

**Current stack:** Vercel `mkj-app.vercel.app` · Supabase `ujajblobqudgmdcterwe`
**Companions:** `QA-TEST-PLAN.md` (full regression suite — staging only, do not run
against production) · `QA-FINDINGS.md` (defect register) · `QA-SYSTEM-MAP.md`
(architecture)

This document tracks what's still open against the live app, plus a checklist for
verifying it by hand. Live findings are numbered **L-nn**, distinct from the static
register's **F-nn** in `QA-FINDINGS.md`.

Rewritten 2026-09-09 as a forward-looking checklist rather than a dated report —
closed findings and one-time verification history were dropped; what's below is
what a production QA pass should actually check now.

---

## 1. Open findings

Priority: **P1** high (fix soon) · **P2** moderate · **P3** low · **info** not a
defect, worth knowing about.

### L-05 (P3) — `/bulk-upload` is reachable by any signed-in user

Loads fully for an Engineer, and the page calls itself *"Admin-only tool."* The nav
hides it (`adminOnly: true`) but the route has no `beforeLoad` guard, unlike `/users`
which correctly redirects. Harmless today — the page makes no backend calls — but it
becomes a real hole the moment import is wired up.

**Fix:** copy the `beforeLoad` admin check from `/users`.

### L-06 (P3) — Engineers are offered actions they cannot complete

| Control | Result when used |
|---|---|
| **New PO** | full form loads → *"Not permitted to create a purchase order for this project"* |
| **New Ticket** | → *"Not permitted to create a shipping ticket for this project"* |
| **Receive shipment** | → *"Not permitted to create a packing slip for this project"* |

Security is intact — all refused server-side with readable messages. It is a
usability defect: the user fills in an entire purchase order before being told they
were never allowed to. The app is **inconsistent** rather than uniformly wrong —
`/packing-slips` correctly hides its create button behind `canWrite`, and PO/ticket
Edit and Delete are correctly hidden. Only the create entry points were missed.

### L-07 (info) — Bulk Upload is still a half-built feature

The page contains no Supabase calls at all; its own copy says *"Selecting a file
here doesn't validate or import anything yet."* See §4: finish it or hide it.

Proof of delivery (F-13), the other half-built feature this finding used to
cover, is now fully implemented — including the `ticket_status.closed` enum
value that was its last gap, added 2026-09-10. See `QA-FINDINGS.md`.

### L-09 (P3) — Document numbers are reused after deletion

Deleting the newest packing slip / PO / shipping ticket on a project frees its
number, because per-project sequences are computed `MAX(...)+1` from surviving
rows. The next document created on that project reissues the deleted one's number.

These numbers go out on paperwork. Two different physical documents carrying the
same number is a records problem even though the database stays internally
consistent.

### L-11 (info) — RLS-blocked writes return success

When RLS blocks an `UPDATE`/`DELETE`, PostgREST does not error — the `USING` clause
filters the rows out, so the statement affects zero rows and returns **`200`/`204`**.

| Attempt | Response | Actual effect |
|---|---|---|
| Manager updates `packing_slips.carrier` | `200` | none — carrier unchanged |
| Manager updates `packing_slip_items.qty_received` | `200` | none |
| Engineer deletes own notifications | `204` | none |
| Warehouse deletes a project | `200` | none |

Easy to miss — a `200`/`204` alone looks like success; only the affected-row count
gives it away.

It matters because **this is the exact shape of the original F-01 bug**: a `DELETE`
that silently affected zero rows because it was never checked. No user-facing
impact today, but it is a live footgun for future code — see §4.

### L-12 (P2) — Serial tracking and supplier prices have no QA coverage

Two substantial features exist with **no document in this suite covering them** —
not the system map, not the test plan, not the findings register:

| Feature | Tables | Trigger/function surface |
|---|---|---|
| Serial-number tracking | `packing_slip_item_serials`, `shipping_ticket_item_serials`, `borrow_request_serials` | `slip_serial_defaults`, `ticket_serial_defaults`, `check_slip_serial_unique`, `resync_slip_item_serial_product`, `resync_ticket_item_serial_product`, `v_project_serials` |
| Supplier prices | `supplier_prices`, `supplier_price_history` | `clear_other_preferred_prices`, `record_supplier_price_change`, `stamp_supplier_price_updated`, `v_products_with_cost` |

That is 5 tables, 8 functions, 5 triggers and 2 views with zero test cases.
`check_slip_serial_unique` in particular is a uniqueness guard on real inventory
identity — exactly the class of thing the F-01/F-03 lessons say to test for
idempotency and double-submit.

There is a partial smoke test for one half
(`supabase/maintenance/smoke_test_supplier_prices.sql`); serials have nothing.

**Needs:** new suites in `QA-TEST-PLAN.md`, and §4/§5/§6 of `QA-SYSTEM-MAP.md`
extended to describe both features.

---

## 2. Human verification checklist

Everything below needs a **person driving a real browser** — some checks need a
second account or a human eye on a printed document, and browser automation in
this environment cannot reliably open Radix dropdowns and modals (see §3).

**Legend** — 🔴 must pass · 🟡 should pass · ⚪ nice to have

### 2.1 Environment sanity

| | ID | Check | Pass looks like |
|---|---|---|---|
| ⬜ | **H-01** | Inventory project cards show a real "Last updated" time | A timestamp, not `—` |
| ⬜ | **H-02** | A user cannot forge a notification to themselves | Direct `POST /notifications` → **`403` RLS** |

### 2.2 Core forms — end to end through the real UI 🔴

These are the paths staff use daily. For each: complete the form, save, then
**re-open the record and confirm it saved**.

| | ID | Flow | Watch for |
|---|---|---|---|
| ⬜ | **H-03** | **Create a PO** — pick project + supplier from the dropdowns, add 2–3 line items, set freight, **Preview PDF**, then Create | Grand total on screen = total on the PDF, freight included |
| ⬜ | **H-04** | **Create a PO with supplier "Other…"** and a new vendor name | Vendor created once; no duplicate if you retry |
| ⬜ | **H-05** | **Receive a shipment** — project → search the PO → enter quantities → attach a scan → Record | Slip number issued; attachment opens afterwards; inventory increases |
| ⬜ | **H-06** | **Edit that packing slip, change nothing, Save. Note on-hand before and after.** | **On-hand must be identical.** This is the F-01 double-count guard — the single most important manual check |
| ⬜ | **H-07** | Edit the slip again, lower a quantity, Save | On-hand drops to match; it does not add |
| ⬜ | **H-08** | Mark a line **Damaged** or **Rejected**, Save | That quantity is **excluded** from on-hand |
| ⬜ | **H-09** | **Create a shipping ticket**, pick products, Mark shipped | On-hand decreases exactly once |
| ⬜ | **H-10** | Try to ship **more than on hand** | Blocked with a clear message; nothing deducted |
| ⬜ | **H-11** | On a shipped ticket, use the edit dialog to set status back to **Ready** | Stock returns to inventory |
| ⬜ | **H-12** | **Delete a packing slip** | Inventory reverses; the PO's status recalculates |
| ⬜ | **H-13** | **Delete a PO that has receipts** | Confirmation names the slips + inventory reversal; everything unwinds |

### 2.3 Borrowing 🟡

| | ID | Flow | Watch for |
|---|---|---|---|
| ⬜ | **H-14** | Create a borrow request via the dialog | Lending project's manager is notified |
| ⬜ | **H-15** | **Approve a partial quantity** (e.g. 3 of 5) | Status reads *Partially approved*; only 3 move |
| ⬜ | **H-16** | **Return borrowed stock** — full and partial | `X of Y returned` tracks correctly; both projects' on-hand match |

### 2.4 Cross-role checks — need a second account 🔴

Verifying non-admin views matters more than it looks: a bug here can hide
indefinitely if the only person testing is an admin, since admin always sees the
correct data. Test with a record that belongs to **someone else**, not your own.

| | ID | Check | Pass looks like |
|---|---|---|---|
| ⬜ | **H-17** | Sign in as a **non-admin** (engineer or manager). Open **Projects**. | PM names render — **not** "Unassigned" |
| ⬜ | **H-18** | Same account → open a PO **assigned to someone else** | Assignee's real name shows, not "Unassigned" |
| ⬜ | **H-19** | Trigger a borrow request affecting your account, and watch the bell | Badge increments **without** refreshing the page |

### 2.5 Documents — print and eyeball 🟡

| | ID | Check | Watch for |
|---|---|---|---|
| ⬜ | **H-20** | Open a PO PDF, **print it on paper** | Logo present; nothing clipped at the margins |
| ⬜ | **H-21** | PO with **40+ line items** | Page breaks clean; headers/footers on every page |
| ⬜ | **H-22** | Long addresses, long descriptions, unusual part numbers | No overflow or overlap |
| ⬜ | **H-23** | Shipping ticket PDF | Proof-of-delivery block is usable as a hand-signed form |
| ⬜ | **H-24** | Leave a PDF tab open ~10 min, reload | Still loads (TTL is 1 hour) |

### 2.6 Everyday robustness ⚪

| | ID | Check | Watch for |
|---|---|---|---|
| ⬜ | **H-25** | Use the app on a **phone** | Tables scroll; the menu works |
| ⬜ | **H-26** | Double-click every Save / Create / Mark-shipped button | Exactly one record; no doubled inventory |
| ⬜ | **H-27** | Browser Back after saving, then re-submit | No duplicate record |
| ⬜ | **H-28** | Turn Wi-Fi off mid-save | A real error message — never a false "saved" |
| ⬜ | **H-29** | Check dates entered after ~8pm | Date saved is **today**, not tomorrow |

---

## 3. Note: some checks need a human, not automation

Radix overlays (`Select`, `Popover`, `Dialog`) do not reliably open under browser
automation in this environment — synthetic pointer and keyboard events leave
`aria-expanded="false"` with no portal created. This is a limitation of the testing
surface, **not an application defect** — the same components work normally for a
person. Where that blocks automated coverage, exercising the same code path the
component calls is a reasonable stand-in for a one-off check, but §2 above still
needs a person clicking through the real UI at least once per release.

---

## 4. Suggestions and improvements

Beyond the open findings — themes worth acting on, roughly by value.

### Stop swallowing query failures 🔴

A failing query that silently falls back to an empty/zero state looks identical to
"no data yet." One instance of exactly this — the dashboard's stat-card queries and
the notification unread-count — was fixed 2026-09-09 (`if (error) throw error`
instead of `?? 0`/`?? []`, so React Query retries instead of caching a wrong
answer). The pattern is worth checking for anywhere else a query result feeds
straight into a fallback default.

### Make writes assert their effect 🟡

Directly from L-11. Two cheap patterns:
- Use `.select()` on mutations and assert a non-empty result wherever the caller
  depends on the write landing.
- Prefer the `SECURITY DEFINER` RPC pattern already used for the delete/sync paths —
  it raises explicit exceptions instead of silently no-op'ing.

This is the pattern that produced the worst bug in the project's history (a
double-counting inventory sync). Worth making structurally impossible rather than
fixing case by case.

### Gate what you show, not just what you allow 🟡

L-05 and L-06 are the same root idea: the server is right and the UI is optimistic.
Hide create buttons behind the same predicate the server enforces (`/packing-slips`
already does), and give every admin-only route a `beforeLoad` guard. Users should
never discover a permission boundary by filling in a form.

### Decide the fate of Bulk Upload 🟡

It renders as a working control and does nothing — before real use, either finish
it or hide it. A button that silently does nothing costs more trust than a missing
feature. (Upload Signed Ticket, the other half-built feature from the original
review, is now fully finished — see L-07.)

### Make document numbers monotonic 🟡

L-09. Numbers on paper should never be reused. A dedicated per-project sequence (or
a `deleted_at` soft delete that keeps rows reserved) removes the risk entirely.

### Give admins a supported way to correct inventory ⚪

The ledger is append-only with no UI for corrections. The `manual_adjustment`
source type exists in the enum but nothing writes it. Every correction so far has
meant editing or deleting a source document, or direct DB access.

A small admin-only "adjust stock" form writing `manual_adjustment` with a mandatory
reason would give a supported path and a better audit trail than silent DB edits.

### Keep a permanent set of QA fixtures 🟡

A standing set of one account per role, plus a scratch project, turns a full
regression pass into something you can run in an afternoon instead of arranging
logins ad hoc each time.

This is currently blocked by the outstanding custom-SMTP work (see `CLAUDE.md`'s
Pending Decisions and `supabase/templates/README.md`): on the default mailer,
Supabase delivers auth email only to addresses on the project's Team page, at
roughly 2–3 per hour — not practical for standing up several test accounts.

Consider also a dedicated staging project. Several tests in `QA-TEST-PLAN.md`
(negative stock, delete cascades, demoting the last admin) are ones you would not
want to run against real data.

### Add a "delete" path for test data ⚪

`notifications` has no `DELETE` grant, so QA probe rows can be marked read but never
removed without direct DB access. A small admin cleanup affordance — or simply
accepting DB-level cleanup as the documented route — avoids accumulating noise.

---

## 5. Recommended order

1. **Work §2**, especially **H-06** — the single most important manual check in
   this document, and the cheapest to run.
2. Fix **L-05** and **L-06** — both small, both pure UI/route gating.
3. **Settle L-09 (document numbering) before more real paperwork exists.** Cheap
   now, expensive once numbers have already gone out on real documents.
4. Decide whether Bulk Upload (L-07) ships or hides.
5. **Unblock SMTP** (§4) — it gates §2.4 (H-17/H-18, the highest-value check that
   needs a second account) as well as ordinary user onboarding.
6. **Write coverage for serials and supplier prices (L-12)** — five tables and
   eight functions currently running in production untested.
7. Then the structural suggestions in §4 that stop this class of problem
   recurring.
