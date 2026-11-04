# PROGRESS — Office Management System (OMS)

**The living source of truth for this repository.** Read this first. Anyone
(human or agent) picking the project up should be able to tell from this file
alone what exists, what does not, and why decisions were made.

- Requirements: [docs/SRS.md](docs/SRS.md) (generated from the Word SRS in
  `docs/`) — authoritative.
- Plan and scope boundaries: [docs/PLAN.md](docs/PLAN.md).
- Database reference: [docs/DATABASE.md](docs/DATABASE.md) (generated).
- Deployment: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
- Mobile / GPS scope: [docs/MOBILE.md](docs/MOBILE.md).
- Dated history of changes: [CHANGELOG.md](CHANGELOG.md).
- Conventions an agent must follow: [CLAUDE.md](CLAUDE.md).

Last updated: **2026-11-04**

---

## Current state

| Phase | Area | Status |
|---|---|---|
| 0 | Foundation: folder, docs, scaffold, Tailwind tokens | **Done** |
| 1 | Data core, identity, RBAC | **Done** |
| 2 | App shell and design system | **Done** |
| 3 | HR, attendance, leave, payroll | **Done** |
| 4 | Fleet and vehicle management | **Done** |
| 5 | Procurement and supply chain | **Done** |
| 6 | Sales, CRM, field operations | **Done** |
| 7 | Finance, facilities, tasks | **Done** |
| 8 | IT/MIS, GPS engine, governance | **Done** |
| 9 | Ship: GitHub, Neon, Vercel | **Code pushed; database and Vercel project not yet created** |

`npm run build` is clean. `npm run check:tenancy` reports **340 SQL statements
across 108 files, 59 of 62 tables tenant-scoped, every tenant-scoped query
filtering by `tenant_id`**.

## What's built

**Foundation**
- 62-table Postgres schema in `src/lib/schema/`, one ordered list of idempotent
  statements that both creates a fresh database and migrates a deployed one on
  cold start. 69 reviewed indexes. UUID primary keys, per the SRS.
- `docs/DATABASE.md` generated from that schema (`npm run docs:schema`), and
  `docs/SRS.md` generated from the Word brief (`npm run docs:srs`), so neither
  document can drift.
- `scripts/check-tenancy.mjs`: derives the tenant-scoped table list from the
  schema and fails the build if a query omits `tenant_id`.

**Identity and access**
- Cookie sessions with bcrypt (cost 10), Postgres-backed rate limiting on
  sign-in and signup, generic login errors, suspended-tenant lockout that also
  revokes live sessions.
- Ten SRS roles seeded as editable per-tenant permission matrices
  (23 modules × 5 actions). Role and permission editing hard-coded to the
  company admin; Super Admin only from `PLATFORM_ADMIN_IDENTIFIERS`.
- Company registration provisions roles, chart of accounts, leave types, sales
  pipeline, settings and approval tiers in one step.

**Modules** — every one has list, create, filter and the lifecycle actions:
- **HR**: directory with full profiles and salary structure, departments,
  geo-fenced check-in/out with the fence decision made server side, 8-hour and
  overtime computation from tenant settings, HR manual entry, configurable
  multi-stage leave approval with entitlement enforcement, payroll generation
  from attendance with approve-then-pay posting to the ledger.
- **Fleet**: registry with document-expiry warnings, requisition workflow
  (request → approve → start → close with odometer and fuel), maintenance
  schedule, running-cost chart. Trip closure updates the odometer and posts
  fuel and tolls.
- **Supply chain**: vendors with rating and blacklist, warehouses, inventory
  with reorder alerts and an append-only movement ledger, purchase orders with
  line items and value-threshold approval tiers, receipt into stock that writes
  vendor price history and posts accounts payable, logistics routes.
- **CRM and field**: clients with coordinates, pipeline kanban that closes a
  deal when it reaches a won or lost stage, activity log, weighted forecast,
  GPS-verified field visits that store the distance from the client's address.
- **Finance**: double-entry ledger with auto-posting from payroll, purchase
  receipts, invoices, payments, trip costs and expense claims; trial balance
  and profit-and-loss derived from the journal; multi-line invoices,
  purchase-order-aware bills, receipts and payments, expense claims with a
  two-step approve-then-reimburse treatment, manual journal entry.
- **Workplace**: meeting rooms with overlap-checked booking, visitor register
  that notifies the host, asset register with chain-of-custody history,
  projects and tasks with GPS-stamped completion.
- **IT/MIS and GPS**: executive dashboard with an operational-bottleneck list,
  live operations map (Leaflet + OpenStreetMap, no API key) with route
  playback, device enrolment and revocation, circular geofences with
  assignment, enter/exit/deviation events with manager notifications,
  retention purge, audit log viewer, cross-module reports.
- **Telemetry API**: `POST /api/telemetry/enroll` and
  `POST /api/telemetry/locations` — batched, backdated, idempotent on
  (device, timestamp), rate limited per device, tenant and user derived from a
  hashed device token. `/tracker` PWA streams to the same endpoint.
- **Platform console** at `/platform`: every tenant, user counts, telemetry
  volume, suspend/reactivate, subscription plans.

**UI**
- Tailwind v4 design tokens with light/dark/system theming resolved before
  first paint. Collapsible grouped sidebar built from the user's permissions,
  command palette, notification centre, mobile drawer.
- Charts are hand-written inline SVG rendered on the server — area, bar, row
  bars, donut, sparkline — with native `<title>` tooltips and no client JS.
- One spec-driven `AutoForm` behind the straightforward CRUD screens, so
  validation, alerts, spacing and pending states cannot drift between modules.

## What's not built

- **Native MDM mobile app** — specified in [docs/MOBILE.md](docs/MOBILE.md),
  not built. The server half is complete and the PWA tracker works, but it
  reports only while its page is open. This was flagged before any code was
  written; see [docs/PLAN.md](docs/PLAN.md#explicit-scope-boundary--read-before-sign-off).
- **Neon database and Vercel project** — both need one browser authorisation
  from the account owner. [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) has the
  exact commands.
- **Email and SMS delivery.** Notification rows are written and shown in the
  in-app notification centre; sending needs a provider key.
- **Payment gateway.** Plans and subscriptions are modelled; nothing bills.
- **Polygon geofence editor.** The schema and the evaluation engine handle
  polygons; the UI creates circles only.
- **Attachment uploads.** Expense receipts and avatars have URL columns but no
  upload pipeline (Vercel Blob would be the natural fit).

## Decisions made with the user

| Date | Decision |
|---|---|
| 2026-11-04 | Repository is `https://github.com/sps1590/office-management-system` (user created it empty; we push to it). |
| 2026-11-04 | Database and Vercel to be set up as automatically as possible. Both turned out to need one browser sign-in each; everything after that is scripted in `docs/DEPLOYMENT.md`. |
| 2026-11-04 | Stack mirrors the user's proven farm-manager stack: Next.js 16 App Router, Neon over the serverless HTTP driver, Server Actions, own cookie session auth with bcrypt, Tailwind v4 tokens. No ORM, no auth library. |
| 2026-11-04 | UUID primary keys, because SRS section 4 specifies them. |
| 2026-11-04 | Hand-written SVG charts and a thin own Leaflet wrapper instead of a chart library and `react-leaflet` — the brief asked for the most optimised design. Eight runtime dependencies in total. |
| 2026-11-04 | The SRS requirement for silent background GPS on an MDM-deployed native app cannot be met by a web app. We built the complete server side plus a foreground PWA tracker, and specified the native client in `docs/MOBILE.md`. Flagged up front. |
| 2026-11-04 | User is on the Claude **Pro** plan, not Max. Work is paced against the 5-hour usage window and paused when it runs out. |

## Known gaps and risks

- **No live database yet**, so the schema has been verified by the TypeScript
  build and the tenancy lint but not yet executed against Postgres. The first
  run will exercise all 62 `CREATE TABLE` statements; expect to fix anything it
  rejects at that point.
- **Employee location tracking is regulated.** Before enabling it the operator
  needs a written policy, employee notice and in many jurisdictions consent.
  The system supports a retention limit and a tracking time window; the policy
  is the operator's responsibility.
- **Neon HTTP driver has no multi-statement transactions**, so a few
  multi-write operations (tenant provisioning, purchase-order receipt) are
  sequential. Ordering is chosen so a partial failure is recoverable rather
  than corrupting, but it is not atomic.
