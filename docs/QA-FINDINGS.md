# MKJ Ops — Defect register (open items)

> **Trimmed 2026-09-09.** This register originally tracked 40 findings (F-01–F-40)
> from the pre-production review. 34 are fixed and no longer listed here — see
> `QA-TEST-PLAN.md`'s **R**-tagged suites for the regression test that guards each
> one, or git history at or before commit `67c28f9` for the original write-ups.
> The 6 below are what's still open or deliberately left as-is, and are what a
> production QA pass should actually check.

Severity: **S1** ships-blocking (data corruption / security), **S2** major
(workflow broken or missing), **S3** moderate, **S4** minor/polish.

---

## S1 — Blocking

### F-06 Project and inventory visibility is wide open

> **Status (F-06):** 🤝 **Accepted as designed** (owner decision) — role-less signups are blocked via `has_any_role()`; any user holding a role sees on-hand totals and project names across all projects, which the borrow flow depends on. Full project records stay behind `can_see_project`.

```sql
CREATE POLICY inv_select   ON inventory_adjustments FOR SELECT USING (true);
CREATE POLICY projects_select ON projects           FOR SELECT USING (true);
```

Any authenticated account holding a role can list every project and every
inventory movement in the company. The Users page still tells admins that
"Admins & Warehouse Managers see every project," which undersells this.

---

## S2 — Major

### F-13 Proof of delivery is never captured

> **Status (F-13):** ✅ **Fixed** — `shipping-tickets.$id.tsx` requires a
> photo/scan, uploads it to `shipping-ticket-proofs`, and writes all four
> columns (`delivered_by`, `received_by`, `pass_number`, `signature_url`)
> alongside `received_date`. The last gap — `closed` missing from the
> `ticket_status` enum, which left `SHIPPING_TICKET_STATUSES` and the
> `canEditTicket`/`canDeleteTicket` guards pointing at an unreachable state —
> was closed 2026-09-10 (migration `20260910012232`). Not yet confirmed by a
> human clicking through the edit dialog's status dropdown end to end — see
> `QA-LIVE-TEST-REPORT.md` §2.

`shipping_tickets.received_by / delivered_by / signature_url / pass_number`

---

## S3 — Moderate

### F-22 Over-receipt is silently allowed

> **Status (F-22):** ✅ **Accepted by design, no fix needed** — reviewed and deliberately left as warn-only. A vendor can legitimately ship more than was ordered, so blocking (or requiring confirmation) would reject a valid receipt. The "over" hint stays informational; `qty_received` is not capped, and the PO can still land on `received` with an over-received line. Do not re-flag as open.

`packing-slips.new.tsx` shows an "over" hint but nothing prevents receiving
more than was ordered, and the PO still lands on `received`.

### F-25 Two sources of truth for project manager

> **Status (F-25):** ➖ **Open by design** — the two sources coexist; the access
> consequence (a replaced manager keeping write access) is closed separately —
> the sync trigger revokes the outgoing manager's `project_managers` row on
> change.

`projects.project_manager_id` vs. the `project_managers` table. The Projects
list and detail read the column; every permission check reads the table. They
can disagree if one is edited without the other.

---

## S4 — Minor

- **F-34** Products have no delete (edit exists).
  **Status:** ✅ **Resolved (edit), delete deferred by design** — a `part_number`
  typo is no longer permanent, since it can now be corrected directly. Delete
  was scoped out deliberately: products are referenced by inventory history, PO
  items, etc., and a real delete needs its own decision about what happens to
  that history (block if referenced vs. cascade/detach). Revisit only if
  removing a product entirely (not just correcting one) becomes a real need.
- **F-39** No user invitation flow — every user must self-register, then wait
  for an admin to notice them on `/users` (which has a manual "Refresh"
  button).
  **Status:** ❌ **OPEN** — still no invitation flow.
