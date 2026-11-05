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

Last updated: **2026-11-05**

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
| 9 | Ship: GitHub, Neon, Vercel | **Done** — database live, project deployed |

`npm run build` is clean. `npm run check` reports **345 SQL statements across
110 files, 59 of 62 tables tenant-scoped, every tenant-scoped query filtering
by `tenant_id`**, and **every referenced column existing in the schema**.

### Verified against the live database, 2026-11-05

The schema has now executed against real Postgres: **62 tables, 158 indexes,
157 foreign keys, 521 check constraints**, 10 role templates and 3 subscription
plans seeded. A test company was registered end to end — provisioning wrote 9
role copies, 17 accounts, 5 leave types, 6 pipeline stages, a department, a
settings row, a subscription and the admin user with a bcrypt hash — then
deleted, confirming `ON DELETE CASCADE` cleans up completely and leaves the
platform role templates intact.

Deployed to production at
`https://office-management-system-sps-a983.vercel.app` (Ready in 36s). The
landing page and the telemetry API both verified there through
`npx vercel curl` — the serverless function reaches Neon and answers
correctly. **Vercel Deployment Protection is still ON**, so the public cannot
reach it yet; see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the one setting
to change.

All 34 signed-in routes return 200 against live data. One real bug surfaced and
was fixed: `payslips` was missing the `status` and `paid_at` columns that
`payroll.ts` selected and the payroll action updated. `scripts/check-columns.mjs`
was added to catch that class of error statically, and reports clean across all
343 statements.

### Every write path executed, 2026-11-05

**70 mutations across all nine modules ran against live Postgres** through the
real Server Actions, in three seats — 59 as the company admin, 6 as an
employee, and 5 back as the admin approving what the employee raised — so
every approval chain was exercised in both directions. **The double-entry
ledger balanced after every posting**: 175,545.45 on each side over 14
auto-posted lines, then 280,945.45 on each side over 22 lines once the
approvals had posted.

That run found and fixed **two purchase-order dead ends**, both detailed in
[CHANGELOG.md](CHANGELOG.md): a new company could not submit any order below
500,000, and an order raised by the procurement manager could never be
approved by anyone. Neither was reachable by reading code or running the
build — both needed the SQL and the approval resolution to actually execute.

### Clicked through in a browser, 2026-11-05

The whole app was then driven through a real browser against a real company —
register, employee, vendor, client, deal, room, booking, and a two-line
purchase order from draft to received — which found **six defects above the
action layer** that neither the build, the static checks nor the write-path
harness could see. All six are fixed and listed in
[CHANGELOG.md](CHANGELOG.md); the two that mattered most were that **no
company could add its first employee** (an employee code drawn from the wrong
sequence collided with the admin's, and the unique violation crashed the page
rather than reporting itself) and that **every form emptied itself when a
submission was refused** (React resets an uncontrolled form after its action,
and nothing fed the values back).

One defect is documented but deliberately **not** fixed: times are written as
UTC from a `datetime-local` field and rendered in the server's zone rather
than the tenant's. See the changelog entry — it spans every timestamp in the
app and is its own piece of work.

### Verified on the deployed app, 2026-11-05

The fixes above were then re-tested in Chrome against the live Vercel
deployment, not only locally: a refused registration keeps what was typed,
and the first employee can be added. The smoke tenant was deleted afterwards.
That run surfaced the cross-region latency problem recorded under
"Known gaps and risks".

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
- **Neon agent tooling** (added 2026-11-04): the `neon` and `neon-postgres`
  agent skills are vendored into `.claude/skills/`, and `.mcp.json` registers
  Neon's hosted MCP server at `https://mcp.neon.tech/mcp` over OAuth — URL
  only, no credential in the repo. See the CHANGELOG entry for how to refresh
  them and which of Neon's eight skills were deliberately left out.

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
- **Workplace**: meeting rooms whose overlap refusal names the clash and
  offers the room's next free windows as one-click alternatives, visitor register
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

- **Production is slow because the functions and the database are in
  different regions.** Functions run in `iad1` (Washington), the Neon database
  is in `ap-southeast-1` (Singapore), so every query crosses the Pacific at
  about 230 ms. A single-query API call takes ~400 ms to first byte and
  registering a company takes ~45 seconds, since provisioning makes ~40
  sequential writes that the HTTP driver cannot batch. Invisible in
  development, where the server is near the database. See the 2026-11-05
  changelog entry for the two ways to fix it; both are the owner's call.
- **Timezones are wrong for any tenant not on UTC.** A `datetime-local` value
  is stored as though it were UTC, and timestamps render in the server's zone
  rather than `tenants.timezone`. Production is UTC at both ends so it reads
  correctly there, but a 10:00 booking entered on an Asia/Dhaka machine
  displays as 16:00. This is the one defect found in the browser pass that
  was left unfixed, because it touches every timestamp written or rendered
  plus the attendance and tracking windows.
- **The map has not been seen with data on it.** Leaflet renders its empty
  state correctly, but no device has reported a position through the UI, so
  markers, clustering and route playback are still only exercised by the
  server-side code behind them.
- **Still no automated test suite.** Everything verified so far was verified
  once, by hand or by a throwaway harness. A regression would be caught by
  nothing. The two static checks (`npm run check`) cover tenancy and column
  existence only.
- **Two deliberate behaviours that look like bugs.** A sole company admin
  cannot *request* leave, because an approver chain needs somebody other than
  the requester — HR manual entry is the path for recording their own
  absence. And nobody can approve or reimburse their own expense claim. Both
  are separation-of-duties rules, not defects; a one-person company works
  around them through HR manual entry and the auto-release described in the
  changelog.
- **Employee location tracking is regulated.** Before enabling it the operator
  needs a written policy, employee notice and in many jurisdictions consent.
  The system supports a retention limit and a tracking time window; the policy
  is the operator's responsibility.
- **Neon HTTP driver has no multi-statement transactions**, so a few
  multi-write operations (tenant provisioning, purchase-order receipt) are
  sequential. Ordering is chosen so a partial failure is recoverable rather
  than corrupting, but it is not atomic.
