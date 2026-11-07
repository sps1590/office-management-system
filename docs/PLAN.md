# OMS — Implementation Plan

Derived from [SRS.md](SRS.md), which is generated from
`Master_Office_Management_System_SRS_v2.docx` — kept in this folder as the
authoritative requirement source.

Live status of every item: [../PROGRESS.md](../PROGRESS.md).
Dated record of every change: [../CHANGELOG.md](../CHANGELOG.md).

---

## 1. Scope reading of the SRS

The SRS describes an enterprise multi-tenant SaaS with nine functional areas,
a granular RBAC matrix, a global MIS dashboard with a live map, and a
background GPS telemetry engine fed by a corporate (MDM-deployed) mobile app.

### What is delivered here

| SRS section | Delivered as |
|---|---|
| 3.1 IT & MIS global dashboard | Executive dashboard, live operations map, data governance / audit screens |
| 3.2 Background GPS engine | Telemetry **ingest API**, device enrolment + token auth, route reconstruction, geofencing, deviation alerts, proof-of-presence, PWA tracker page |
| 3.3 Procurement & supply chain | Vendors, POs with multi-tier approvals, inventory + stock movements, warehouses, logistics routes |
| 3.4 HR & leave | Employee directory, geo-fenced check-in/out, 8-hour + overtime computation, multi-layer leave approvals, payroll |
| 3.5 Vehicle & fleet | Vehicle registry, driver assignment, calendar booking + approvals, trip logs, maintenance scheduling |
| 3.6 Sales / marketing / field | CRM pipeline kanban, clients, deals, activities, GPS-verified field visits |
| Finance (section 1) | Chart of accounts, double-entry journal, AR invoices, AP bills, payments, expense claims |
| Facilities (section 1) | Rooms + bookings, asset register, visitor log |
| Task execution (section 1) | Projects, tasks, comments, GPS-stamped completion |
| 2. Roles & permissions | 10 seeded system roles + editable per-role permission matrix (JSONB) |
| 4. Database schema | Full Postgres schema, a superset of the SRS tables, with every column named in the SRS present |

### Explicit scope boundary — read before sign-off

The SRS asks for a **native cross-platform mobile app distributed through
corporate MDM that collects GPS silently without prompting the user**.

That capability cannot be produced by a web project. iOS and Android both
require a signed native binary holding background-location entitlements, and
the "no repeated permission prompt" behaviour comes from an MDM configuration
profile pushed by the company's device-management server (Intune, Jamf,
Workspace ONE) — not from application code.

What this repository delivers instead is **the entire server half of that
engine, built to the contract a native client needs**:

- `POST /api/telemetry/locations` — batched, device-token-authenticated
  coordinate ingest. Accepts backdated batches, so an offline queue on the
  device flushes correctly.
- `POST /api/telemetry/enroll` — device enrolment returning a long-lived
  tracking token; the hook an MDM-managed app calls once at provisioning.
- Server-side route reconstruction, geofence evaluation, deviation alerts and
  proof-of-presence stamping.
- A **PWA tracker page** (`/tracker`) that works today: a field user opens it
  and the browser streams coordinates while the screen is on. Real tracking,
  but foreground-only — the honest web equivalent of the SRS requirement.

A native Expo client against these same endpoints, plus a sample MDM profile,
is specified in [MOBILE.md](MOBILE.md) as **Phase 9 — out of scope for this
web deliverable**. Nothing else in the SRS is deferred.

---

## 2. Technology decisions

| Concern | Choice | Why |
|---|---|---|
| Framework | Next.js 16 App Router, React 19, TypeScript strict | Server Components keep data access on the server; one deployable unit on Vercel |
| Database | Postgres on Neon, serverless HTTP driver | Works on Vercel's serverless runtime with no connection-pool exhaustion |
| Data access | Tagged-template SQL in `src/lib/`, no ORM | No query-builder overhead, and explicit `tenant_id` filters a static check can verify |
| Mutations | Server Actions in `src/lib/actions/*` | No hand-written REST layer for internal CRUD; the only public APIs are the telemetry endpoints a mobile client needs |
| Auth | Own session cookie + bcrypt, `sessions` table | No third-party auth dependency, cheap to audit, matches the SRS `users` table |
| Validation | `zod` on every action input | One source of truth for parsing and error messages |
| Styling | Tailwind CSS v4 with design tokens in `globals.css` | Tokens give light/dark theming and one consistent visual system |
| Charts | Hand-written inline SVG components | ~2 KB instead of ~120 KB for a chart library; renders on the server with no hydration cost |
| Maps | `leaflet` plus a thin own React wrapper, OpenStreetMap tiles | No API key, no billing, no `react-leaflet` version coupling |
| Icons | `lucide-react` | Tree-shaken per icon |
| Tests | `vitest` (dev dependency), against a throwaway Neon branch | See below |
| Hosting | Vercel + GitHub | As requested |

**Why `vitest` and not `node:test`** (added 2026-11-07, the project's first
test dependency — rule 5 below says a dependency needs to be smaller than the
code it replaces, so here is the accounting).

The suite has to import the product's real modules, which means three things
have to be resolvable that Node cannot resolve on its own:

- `@/*` path aliases, which Node has no tsconfig-paths support for;
- `server-only`, `next/headers`, `next/cache`, `next/navigation` and
  `next/dynamic`, which have to be swapped for stand-ins — Node would need a
  custom module loader per entry;
- `.tsx`, for the two component regression tests. Node 24 strips types but
  cannot transform JSX at all, so `node:test` could not run them.

`vitest` does all three from eight lines of `resolve.alias` in
`vitest.config.ts`, with no plugin: its esbuild transform reads `jsx` straight
out of `tsconfig.json`. The `node:test` equivalent is a loader, a JSX
transform step and a resolver — more of our own code than the config it
replaces, and all of it in the test infrastructure where a bug is silent.

It is a dev dependency: nothing in `src/` imports it and the production bundle
is unchanged. Still eight runtime dependencies.

**Optimisation rules applied throughout** (the brief asked for the most
optimised design):

1. Server Components by default. `"use client"` only on genuinely interactive
   leaves: forms, map, kanban, command palette, theme toggle.
2. One round-trip per page. Each page calls a single `src/lib/*` function that
   issues its queries with `Promise.all` — never a query inside a loop.
3. Every foreign key and every `(tenant_id, …)` lookup path is indexed.
   Telemetry gets `(tenant_id, user_id, log_timestamp DESC)` because
   "latest position per user" is the live map's hottest query.
4. Dashboard aggregates computed in SQL with `FILTER` / `GROUP BY`, not in JS.
5. No dependency added unless it is smaller than the code it replaces.

---

## 3. Phases

Each phase ends in a working, deployable state and a `PROGRESS.md` update.

### Phase 0 — Foundation
Project folder, SRS reference copy, docs set, Next.js scaffold, Tailwind
tokens, `.gitignore`, `.env.example`, dependency install, clean build.

### Phase 1 — Data core and identity
`schema.ts` as an idempotent statement list that runs on cold start (creates a
fresh database and migrates a deployed one), plus `db.ts`, `types.ts`,
`auth.ts`, `permissions.ts`, `rate-limit.ts`, `audit.ts`. Seeded system roles
and permission matrix. Tenant signup, login, logout, sessions,
suspended-tenant lockout. Super admin from `PLATFORM_ADMIN_IDENTIFIERS` only.

### Phase 2 — App shell and design system
Collapsible grouped sidebar, top bar, command palette, notification centre,
user menu, light/dark theme, responsive drawer, and the primitive set:
KPI tile, data table, badge, empty state, modal, SVG charts.

### Phase 3 — HR and attendance
Employee directory and profiles, departments, geo-fenced check-in/out,
8-hour and overtime computation, leave types and balances, multi-layer leave
approvals, holidays, payroll runs and payslips.

### Phase 4 — Fleet
Vehicle registry, driver assignment, calendar-based booking with approval,
trip logs (odometer and fuel), maintenance schedule with due alerts.

### Phase 5 — Procurement and supply chain
Vendors with ratings and price history; inventory items, warehouses, stock
movements and low-stock alerts; purchase orders with line items and
multi-tier financial approval; logistics routes tied to vehicles and GPS.

### Phase 6 — Sales, CRM and field operations
Clients, pipeline stages, deals kanban, lead sources, activities, and field
visits verified against the client's recorded coordinates.

### Phase 7 — Finance, facilities, tasks
Chart of accounts and double-entry journal with auto-posting from POs,
invoices and payroll; AR invoices, AP bills, payments, expense claims with
approval. Rooms and bookings, asset register, visitor log. Projects, tasks,
comments.

### Phase 8 — MIS, GPS engine and governance
Telemetry ingest and enrolment APIs, PWA tracker, live operations map, route
playback, geofences and deviation alerts, proof-of-presence, executive
dashboard, audit log viewer, data export.

### Phase 9 — Ship
Clean `npm run build`, green tenancy check, GitHub repository, Vercel project,
Neon database, environment variables, live smoke test, final docs.

### Out of scope, documented rather than built
Native MDM mobile app (see `MOBILE.md`); payment-gateway billing;
email/SMS delivery provider wiring — notification rows are written, only a
provider key is missing.

---

## 4. Non-negotiable engineering rules

Enforced in review and by `npm run check:tenancy`:

1. Every query against a tenant-scoped table filters by `tenant_id` taken from
   the **session** — never from form data, a URL param or a request body. A
   deliberate exception carries a `-- tenancy-ok: <reason>` comment.
2. Every mutating Server Action re-checks permission itself with
   `requirePermission(module, action)`. Hiding a button is UX only.
3. Role and permission management is reachable only by the tenant owner or
   company admin. Hard-coded — never driven by the permission matrix itself,
   which would allow privilege escalation.
4. Super admin comes only from the `PLATFORM_ADMIN_IDENTIFIERS` env var.
5. Passwords are bcrypt at cost 10, never logged and never returned to a
   client.
6. All SQL goes through the Neon tagged template, or `sql.query(text)` for
   DDL. Never string concatenation of user input.
7. `schema.ts` statements stay idempotent: `IF NOT EXISTS`, or drop-then-add.
8. Telemetry ingest authenticates with a hashed device token and rate-limits
   per device. A device may only write rows for its own enrolled user.
