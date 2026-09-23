# CLAUDE.md

## Project Overview

This project is an application initially developed using Lovable.dev and synchronized through GitHub.

Lovable no longer manages any part of the app: the frontend and backend are fully owned in this repository (own Supabase project + Vercel hosting). Claude should help extend, improve, and maintain the application.

The project uses Supabase as the backend platform, including database, authentication, storage, and backend services where applicable.

---

# Development Philosophy

Prioritize clean, maintainable, production-ready code.

Before making significant architectural changes:
1. Explain the proposed approach.
2. Explain possible impacts.
3. Wait for confirmation before implementing large changes.

Prefer small, focused changes that are easy to review and revert.

---

# Role of Claude

Claude should primarily assist with:

- Backend development
- Database logic
- Supabase configuration
- Authentication flows
- API integrations
- Business logic
- Data processing
- Security improvements
- Performance optimization
- Debugging
- Code reviews
- Refactoring

---

# Frontend Guidelines

Avoid unnecessary modifications to frontend components, styling, or layouts unless explicitly requested.

When frontend changes are required:
- Preserve existing design patterns.
- Reuse existing components.
- Avoid rewriting large sections of UI code.

---

# Supabase Guidelines

Before modifying database-related functionality:

- Inspect the existing schema.
- Understand relationships between tables.
- Check existing Row Level Security (RLS) policies.
- Avoid destructive database changes without confirmation.

Prefer migrations or reversible changes.

---

# Authentication Guidelines

Treat authentication and user data as critical functionality.

Before modifying authentication:
- Review the existing authentication flow.
- Consider security implications.
- Preserve existing user sessions and permissions.

---

# Code Quality

When writing code:

- Follow the existing coding style.
- Avoid unnecessary dependencies.
- Prefer simple and maintainable solutions.
- Add comments only where they provide meaningful context.
- Explain complex logic.

---

# Git Workflow

Before making large changes:

Explain:
- Which files will change.
- Why the changes are needed.
- Possible side effects.

Do not make unrelated changes.

Keep commits focused and descriptive.

---

# Testing

Before suggesting completion of a feature:

- Verify the implementation.
- Identify possible edge cases.
- Explain how the change can be tested.

---

# Communication Style

When working on tasks:

1. First explain the plan.
2. Identify affected files.
3. Implement changes.
4. Summarize what changed.
5. Mention any recommended next steps.

Avoid assuming requirements that were not provided.
Ask questions when requirements are unclear.

---

# Purchase Orders and PO Requests

- Real POs belong to warehouse managers and admins. Project managers can view POs and receive shipments against them, but can't create, edit, delete, or change the status of one. This is enforced by RLS and `create_purchase_order`, not only by hidden buttons.
- Receiving recomputes a PO's status through the `refresh_po_status` RPC ([src/lib/receiving.ts](src/lib/receiving.ts)), never a direct UPDATE: managers have no UPDATE rights on `purchase_orders`, so a browser-side update would be silently dropped.
- Managers (their projects) and admins (any project) ask for POs with **Request a PO**: `po_requests` + `po_request_lines`, numbered `REQ-<project>-<seq>`. Pending → completed (warehouse/admin, optional free-text PO reference) or cancelled (reason required). A request is never linked to a PO row and never shows up in receiving, PDFs, or PO counts. Clients only SELECT these tables; every write goes through the `create/update/complete/cancel_po_request` RPCs, which also send the notifications.
- Procore tracking was removed entirely on 2026-09-12. Don't reintroduce `entered_in_procore`.

---

# Manufacturing

Managers ask the shop to build standard systems (CCTV cabinets, data cabinets, access control, fiber enclosures…) from a project's stock; the warehouse builds them and the finished units go back into that project's stock as ordinary products that ship on a shipping ticket. Built across migrations `20260912215212_manufacturing_templates` → `20260913000112_manufacturing_building`; the migration headers explain each piece in detail.

- **Systems (templates)** live at `/manufacturing/systems`: a system's parts for ONE unit, with key parts flagged. They're imported from [public/manufacturing-systems-template.xlsx](public/manufacturing-systems-template.xlsx) through `import_system_templates` — a dry run first (the preview), then all or nothing. Re-importing a `system_code` replaces its whole parts list; a `system_code` matching an existing part number (ignoring case) is rejected; unknown part numbers become products. This is separate from Bulk Upload. Each system owns a finished product whose part number is the `system_code` (serial-tracked). Systems are deactivated, never deleted.
- **Build requests** (`/manufacturing`, numbered `MFG-<project>-<seq>`): draft → submitted → in progress → (partially built) → completed. Submitted can be pulled back to draft or rejected (note required; editing a rejected request returns it to draft). Cancel only from in progress, reason required, and every used part and serial goes back to stock. Partially built can't be cancelled — the units exist — and units only enter stock at Completed.
- **Who**: the project's managers, warehouse managers and admins create, edit, submit and pull back (`can_request_build`). Only warehouse managers and admins reject, start, install arrived parts, mark partially built, complete, and change the parts list of a submitted request. Cancel is either side. Engineers are read-only. Warehouse managers CAN create build requests even though they can't create PO requests — intentional.
- **Submit rule** (also re-checked when the warehouse changes a submitted request): at least 80% of the request's lines — parts, not units — fully held, and every key part fully held. The key flag always comes from the system and key parts can't be removed from a request (`build_request_write_lines`), so the rule can't be sidestepped.
- **Held stock**: `v_project_inventory` has `held` and `available` (= on hand − held, via `held_stock_qty`). The `guard_held_stock` trigger on `inventory_adjustments` refuses any stock-reducing row that would take a project below what builds hold — one choke point for shipping, borrowing, packing slip edits/deletes and direct inserts. **Any new code that consumes held stock must set `qty_consumed` on the build line BEFORE inserting its negative ledger row**, or the guard will refuse it. The packing slip edit dialog pre-checks with `assertSlipEditKeepsHeldStock` ([src/lib/receiving.ts](src/lib/receiving.ts)) because it saves slip lines from the browser before syncing stock.
- **Stock is the only truth.** Manufacturing never reads POs, PO requests or borrow requests. Any stock arriving in a project (any positive ledger row) is held automatically for the oldest waiting request that needs it (`trg_inventory_adjustments_allocate` → `allocate_held_stock`), and stock freed by a pull-back, rejection or cancel is offered the same way.
- **Serials**: starting a build or installing arrived parts needs exactly one serial per serial-tracked unit used — on hand at that project, or never seen before (stock received before serial tracking; stored `entered_manually`). Shipped units, units inside another build, and units at another project are refused. Finished units get IDs `<project>-<system_code>-NNN` (sequence per project + system, across requests) in `build_units`, and `v_project_serials` lists them as serials of the finished product, so the existing shipping-ticket picker offers them. Serials used inside a build have status `in_system` (alongside `in_stock` / `shipped`). Because the view is now a UNION, PostgREST can't embed `products` through `v_project_serials`.
- **Writes**: clients only SELECT the manufacturing tables; every write goes through the RPCs (`create/update/submit/pull_back/reject/start/install/complete/cancel_build_request`, `install_build_parts`, `mark_build_partially_built`, `import_system_templates`, `set_system_template_active`), which also send the notifications (`notify_build_request`).
- **Dependency**: `read-excel-file` reads the spreadsheet in the browser (import from `read-excel-file/browser`). Bun 1.4's `bun add` and `bun remove` prune other platforms' esbuild/rollup entries from `bun.lock`, which Vercel needs — edit the lockfile by hand to add or drop only that package's own entries, and confirm with `bun install --frozen-lockfile`.

---

# Pending Decisions

- **Email confirmation on sign-up**: Supabase's "Confirm email" toggle (Dashboard → Authentication → Providers → Email) is active, and `signUp` in [src/routes/auth.tsx](src/routes/auth.tsx) assumes confirmation is required (shows a "check your email" toast). Staying that way. All five auth emails (confirm signup, reset password, magic link, invite, email change) are branded and generated from one layout — see [supabase/templates/README.md](supabase/templates/README.md).

- **Custom SMTP**: still outstanding, and the biggest launch blocker — worse than originally scoped. Confirmed directly from Supabase's own API: on the free tier, auth email templates can't be edited *at all* while the project is on the default mailer (`push_auth_email_templates.sh` fails with HTTP 400 until this is fixed), on top of the default mailer only delivering to addresses on the project's Team page and the ~2-3/hour rate limit. [`configure_smtp.sh`](supabase/maintenance/configure_smtp.sh) is built and tested (dry-run only, not yet run against the live project) to wire up Resend and fix all of it in one PATCH — needs a Resend account, an API key, and a verified sending domain. See [supabase/templates/README.md](supabase/templates/README.md#sending-limits-and-why-templates-may-refuse-to-push-at-all).

- **Supabase redirect allow-list**: the reset link only lands on `/auth/reset` if that URL is on the project's allow-list — Dashboard → Authentication → URL Configuration → Redirect URLs. `https://mkj-app.vercel.app/**` covers production; add `http://localhost:8080/**` for local testing. Without it Supabase silently falls back to the Site URL and the user lands on the dashboard instead of the reset form, with no error anywhere.

- **Manufacturing hasn't run end to end with real data yet**: every RPC was tested on the live database with rolled-back SQL (2026-09-12/13) and every screen renders, but no request has gone through the UI while the database had projects and stock. First real run: submit a request, start it with serials, receive a pending part on a packing slip, install it, complete it, and ship a finished unit by its ID.

- **Demo data is live on production** (seeded 2026-09-13 for the stakeholder demo): 3 `@example.com` accounts that share one deliberately simple password (set 2026-09-13; kept out of the repo, ask Cesar), projects 2403 and 2601 and everything on them, 4 suppliers, 15 products and the CCTV-WALL-8P / ACS-2DR systems. None of it is real — it doesn't count as the first real manufacturing run above. Remove it with [supabase/demo-data/teardown_demo_data.sql](supabase/demo-data/teardown_demo_data.sql) when the demo is over, and before creating the real 2403/2601, whose numbers it holds. See [supabase/demo-data/README.md](supabase/demo-data/README.md).

- **Invited users have no way to set a first password**: `/auth/reset` handles recovery links, but a Supabase invite drops the user on the app with a session and no password. Sending them to `/auth/reset` would work — the page only needs a session — but nothing routes them there yet.
