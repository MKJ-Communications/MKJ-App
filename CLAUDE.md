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
- Managers (their projects) and admins (any project) ask for POs with **Request a PO**: `po_requests` + `po_request_lines`, numbered `REQ-<project>-<seq>`. Pending → completed or cancelled (reason required). The warehouse/admin completes a request with **Create PO**: `/purchase-orders/new?request=<id>` pre-fills the project (locked) and lines (catalog lines keep `product_id`), and `create_po_from_request` creates the PO + lines, completes the request (`po_reference` = PO number, `purchase_order_id` = the PO, `ON DELETE SET NULL`) and notifies, all in one transaction (migration `20261012232859_po_requests_create_po`). `complete_po_request` (manual completion with free text) still exists but the UI no longer calls it. Requests never show up in receiving, PDFs, or PO counts. Clients only SELECT these tables; every write goes through the `create/update/cancel_po_request` and `create_po_from_request` RPCs, which also send the notifications.
- Procore tracking was removed entirely on 2026-09-12. Don't reintroduce `entered_in_procore`.
- **Procore SOV export** (added 2026-10-12): warehouse managers and admins get a **Procore CSV** button on the PO detail page and each PO list row ([src/components/po-sov-dialog.tsx](src/components/po-sov-dialog.tsx)). It previews the PO's lines as a Procore commitment Schedule of Values and downloads `PO_SOV_<po_number>.csv`, which the warehouse imports into Procore. It's a download only — nothing about Procore is stored, so this doesn't bring back the tracking above. The format rules live in [src/lib/procore-sov.ts](src/lib/procore-sov.ts) and are fixed by Procore's importer: header `Cost Code,Cost Type,Description,Quantity,UOM,Unit Price,Subtotal Override`, UOM always `ea`, Subtotal Override always blank, prices to two decimals with no `$` or `,`, RFC 4180 quoting, UTF-8 with no BOM. Freight stays out of the file.
  - Cost code and cost type default to `01-91-01` / `M` and can be changed for the whole PO or per line in the dialog; they aren't saved. `purchase_order_items.budget_code` is **not** the Procore cost code (it holds things like `2403-CCTV`), so don't map it.
  - Description is `<PART NUMBER> - <DESCRIPTION>` in caps when the line is linked to a product, otherwise the line's description cleaned up. The original spec wanted `MANUFACTURER MODEL - DESCRIPTION`; `products.manufacturer` exists now but the export doesn't use it yet.
  - Lines aren't blocked, only flagged: units other than ea, zero qty or price, unit costs with more than two decimals (and the SOV total no longer matching the PO's line total), blank cost code or type.
  - Only the spec's writer step was built. The warehouse types PO lines in, so the parts of the spec about reading vendor quote PDFs and markups don't apply. Not yet tested against a real Procore import as of 2026-10-12, because production had no POs.

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
- **Dependency**: `read-excel-file` reads the spreadsheet in the browser (import from `read-excel-file/browser`). Changing dependencies has a `bun.lock` trap — see Dependencies below.

---

# Cutsheets (SharePoint)

Vendor cutsheets stay in SharePoint (`mkjcommunications.sharepoint.com`, library `Wiki`, folder `Vendor Docs, Cuts & CAD Blocks/Vendor Product Cutsheets & Docs`, subfolders are usually vendors); the app indexes them and never stores copies. Agreed plan (2026-09-26), in stages:

1. **Index** — done: the `sharepoint-cutsheets` edge function (`action: "sync"`, admins only) lists the folder as the "MKJ App – SharePoint reader" Entra app — client credentials, `Sites.Selected` with read on the root site only — and hands the whole listing to `record_sharepoint_sync` (`sharepoint_files`, `cutsheet_sync_runs`; migration `20260926232554_sharepoint_cutsheets`). Files are keyed by SharePoint drive + item id, which survives renames and moves; files that disappear get `removed_at`, never deleted. One-time Microsoft setup: [supabase/functions/sharepoint-cutsheets/README.md](supabase/functions/sharepoint-cutsheets/README.md). Admin page: `/cutsheets`.
2. **Create products from the files** — next, after looking at the real file names: derive a part number from each name, show a preview on `/cutsheets` to edit/exclude, import all or nothing. Several files with the same part number become one product with several documents; an existing part number gets linked instead of duplicated. `products.manufacturer` (added for this, filled from the vendor folder) is a free-text column.
3. **Open cutsheets** from the Products list, streamed through the function so no SharePoint login is needed. Only Microsoft users from MKJ's tenant (check the identity's tenant against `MS_TENANT_ID`) who have a role, and admins.
4. **Keep in sync**: nightly run via `pg_cron` + `pg_net`, auto-link new files to existing products, list unmatched new files for import, manual link/unlink.

---

# Deployment

- Code lives in `MKJ-Communications/MKJ-App`. Vercel (free plan, which can't connect to an organization's repo) deploys from a personal mirror instead: [.github/workflows/mirror-to-vercel.yml](.github/workflows/mirror-to-vercel.yml) force-pushes every branch there. `main` goes live; other branches get preview deployments. Never commit to the mirror directly.
- On the free plan Vercel only deploys a private repo's commits authored by the account owner (Cesar), so a push whose latest commit is someone else's won't deploy.
- The workflow file is mirrored too, so its job is guarded with `if: github.repository == 'MKJ-Communications/MKJ-App'`; in the mirror it shows as skipped. Without the guard it fails there ("Set the MIRROR_SSH_KEY secret and the MIRROR_REPO variable first"), because the secret and variable only exist on the company repo — don't remove it. The mirror's deploy key (write access) is on `cesar77muse/mkj-app`; `MIRROR_REPO` is `cesar77muse/mkj-app`.
- Pushes to the company repo need the `cesar77muse` GitHub account; `cesar7MKJ` has no write access and gets a 403.
- If `main` doesn't go live, check the deployment's build log in Vercel before suspecting the mirror. A build that fails within a few seconds was refused before building — e.g. on 2026-10-12 Vercel blocked a known-vulnerable TanStack Start version (below). Each failed deploy is caught up by the next one that succeeds; there's no need to redeploy old commits.

---

# Dependencies

- **`bun.lock`**: Bun 1.4's `bun add`, `bun remove` and `bun update` prune other platforms' esbuild/rollup entries (`@esbuild/*`, `@rollup/rollup-*`, plus `esbuild`, `rollup`, `tsx` and the `tsx/esbuild/*` entries), which Vercel needs. Run the command on a copy of `package.json` + `bun.lock` in a scratch folder, take the new lockfile, put back every entry it dropped that the upgrade didn't actually replace, and edit only the changed version lines in `package.json`. Confirm with `bun install --frozen-lockfile` (it must leave the lockfile untouched) and `bun run build`.
- **TanStack**: `@tanstack/react-start`, `@tanstack/react-router` and `@tanstack/router-plugin` must be upgraded together. `react-start` depends on an exact router version; upgrading it alone installs a second, nested copy of `react-router`, which breaks routing at runtime even though the build passes. After upgrading, check `bun.lock` has no nested `…/@tanstack/react-router` or `…/@tanstack/router-core` entries. Upgraded to react-start 1.168.61 / react-router 1.170.42 / router-plugin 1.168.43 on 2026-10-12 because Vercel refuses to build react-start below 1.168.60 (CVE-2026-102989). Never use `DANGEROUSLY_DEPLOY_VULNERABLE_TANSTACK_START_XSS`; upgrade instead.
- A router upgrade can tighten types (this one made `ErrorComponentProps.error` `unknown`) and reorders `src/routeTree.gen.ts`; commit the regenerated file with the upgrade. Vercel only runs `vite build`, which doesn't type-check, so run `bunx tsc --noEmit -p .` yourself.

---

# Pending Decisions

- **Email confirmation on sign-up**: Supabase's "Confirm email" toggle (Dashboard → Authentication → Providers → Email) is active, and `signUp` in [src/routes/auth.tsx](src/routes/auth.tsx) assumes confirmation is required (shows a "check your email" toast). Staying that way. All five auth emails (confirm signup, reset password, magic link, invite, email change) are branded and generated from one layout — see [supabase/templates/README.md](supabase/templates/README.md).

- **Custom SMTP**: still outstanding, and the biggest launch blocker — worse than originally scoped. Confirmed directly from Supabase's own API: on the free tier, auth email templates can't be edited *at all* while the project is on the default mailer (`push_auth_email_templates.sh` fails with HTTP 400 until this is fixed), on top of the default mailer only delivering to addresses on the project's Team page and the ~2-3/hour rate limit. [`configure_smtp.sh`](supabase/maintenance/configure_smtp.sh) is built and tested (dry-run only, not yet run against the live project) to wire up Resend and fix all of it in one PATCH — needs a Resend account, an API key, and a verified sending domain. See [supabase/templates/README.md](supabase/templates/README.md#sending-limits-and-why-templates-may-refuse-to-push-at-all).

- **Supabase redirect allow-list**: the reset link only lands on `/auth/reset` if that URL is on the project's allow-list — Dashboard → Authentication → URL Configuration → Redirect URLs. `https://mkj-app.vercel.app/**` covers production; add `http://localhost:8080/**` for local testing. Without it Supabase silently falls back to the Site URL and the user lands on the dashboard instead of the reset form, with no error anywhere.

- **Manufacturing hasn't run end to end with real data yet**: every RPC was tested on the live database with rolled-back SQL (2026-09-12/13) and every screen renders, but no request has gone through the UI while the database had projects and stock. First real run: submit a request, start it with serials, receive a pending part on a packing slip, install it, complete it, and ship a finished unit by its ID.

- **Production data was wiped on 2026-09-26**: the stakeholder demo (projects 2403/2601, its suppliers, products and systems, the 3 `@example.com` accounts) and every other test record are gone, including the CCTV-CAB-FLOOR-AC / CCTV-CAB-WALL-AC systems and the `cesar@mkjcomm.com` account. Projects, catalog, suppliers and systems start empty, and the only account is `cesarhmcod@gmail.com` (admin). [supabase/demo-data/](supabase/demo-data/README.md) can seed the demo again, but only while no real project is numbered 2403 or 2601.

- **Invited users have no way to set a first password**: `/auth/reset` handles recovery links, but a Supabase invite drops the user on the app with a session and no password. Sending them to `/auth/reset` would work — the page only needs a session — but nothing routes them there yet.
